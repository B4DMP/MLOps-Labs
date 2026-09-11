"""Runs a stage: generate, check against the game's own gates, retry with the errors as feedback.

Nothing that fails its checks is ever written. Output file first, ledger second, so a crash in
between costs one regeneration and never leaves a corrupt set. SIGINT lets in-flight items finish.
"""

import asyncio
import fnmatch
import json
import signal
from dataclasses import dataclass, field
from typing import Optional

from content_gen.ledger import Ledger, WorkItem
from content_gen.llm import LLM


@dataclass
class RunOptions:
    only: Optional[str] = None
    limit: Optional[int] = None
    force: bool = False
    dry_run: bool = False
    concurrency: int = 3
    max_attempts: int = 3
    budget_tokens: Optional[int] = None
    retries_on_error: int = 3


@dataclass
class RunReport:
    planned: int = 0
    todo: int = 0
    done: list[str] = field(default_factory=list)
    failed: dict[str, str] = field(default_factory=dict)
    skipped: list[str] = field(default_factory=list)
    tokens_in: int = 0
    tokens_out: int = 0
    stopped: Optional[str] = None


class Stop:
    def __init__(self):
        self.reason: Optional[str] = None

    def set(self, reason: str) -> None:
        self.reason = self.reason or reason


def _install_sigint(stop: Stop):
    try:
        return signal.signal(signal.SIGINT, lambda *_: stop.set("interrupted"))
    except ValueError:  # not in the main thread (tests)
        return None


async def run_stage(stage, ctx, ledger: Ledger, llm: LLM, opts: RunOptions, stop: Optional[Stop] = None) -> RunReport:
    stop = stop or Stop()
    items: list[WorkItem] = stage.plan(ctx)
    if opts.only:
        items = [i for i in items if fnmatch.fnmatch(i.item_id, opts.only)]
    report = RunReport(planned=len(items))
    ledger.sync(items, stage.prompt_version, llm.model_id)
    todo_ids = ledger.todo([i.item_id for i in items], opts.max_attempts, force=opts.force)
    if opts.limit is not None:
        todo_ids = todo_ids[: opts.limit]
    report.todo = len(todo_ids)
    if opts.dry_run or not todo_ids:
        return report

    by_id = {i.item_id: i for i in items}
    sem = asyncio.Semaphore(max(1, opts.concurrency))
    previous = _install_sigint(stop)

    async def one(item: WorkItem) -> None:
        async with sem:
            if stop.reason:
                report.skipped.append(item.item_id)
                return
            if opts.budget_tokens is not None and report.tokens_in + report.tokens_out >= opts.budget_tokens:
                stop.set("budget reached")
                report.skipped.append(item.item_id)
                return
            ledger.claim(item.item_id)
            row = ledger.get(item.item_id)
            note: list[str] = [f"Reviewer note: {row.note}"] if row and row.note else []
            feedback = list(note)
            used_in = used_out = 0
            last_errors: list[str] = []
            for attempt in range(1, opts.max_attempts + 1):
                output = None
                for retry in range(opts.retries_on_error):
                    try:
                        output, usage = await stage.generate(item, ctx, llm, feedback)
                        used_in += usage.tokens_in
                        used_out += usage.tokens_out
                        break
                    except Exception as e:  # rate limits, parse failures
                        last_errors = [f"generation error: {e}"]
                        await asyncio.sleep(min(30, 2 ** retry))
                if output is None:
                    continue
                last_errors = stage.check(output, item, ctx)
                if not last_errors:
                    path = ctx.out_path(stage.name, item.item_id)
                    path.parent.mkdir(parents=True, exist_ok=True)
                    record = {
                        "item_id": item.item_id,
                        "stage": stage.name,
                        "input_hash": ledger.get(item.item_id).input_hash,
                        "model": llm.model_id,
                        "attempts": attempt,
                        "inputs": item.inputs,
                        "output": output,
                    }
                    path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
                    ledger.finish(item.item_id, path.relative_to(ctx.work_dir).as_posix(), used_in, used_out, llm.model_id, attempt)
                    report.done.append(item.item_id)
                    break
                feedback = note + [
                    "Your previous answer was rejected by the game's checks. Fix exactly these problems:",
                    *last_errors,
                ]
            else:
                ledger.fail(item.item_id, "; ".join(last_errors), used_in, used_out, opts.max_attempts)
                report.failed[item.item_id] = "; ".join(last_errors)
            report.tokens_in += used_in
            report.tokens_out += used_out

    try:
        await asyncio.gather(*(one(by_id[i]) for i in todo_ids))
    finally:
        if previous is not None:
            signal.signal(signal.SIGINT, previous)
        for item_id in report.skipped:
            row = ledger.get(item_id)
            if row and row.status == "running":
                ledger.release(item_id)
    report.stopped = stop.reason
    return report
