"""python -m content_gen <command>  (run from game-api/tools; inside the container: cd /app/tools)

  status                              counts per stage and status, tokens used
  run --stage S [--only GLOB] [--limit N] [--force] [--dry-run] [--concurrency N] [--budget-tokens N]
  review --stage S                    writes work/review/S.csv and prints one line per item
  approve --stage S [--only GLOB]     marks done items approved; the next stage builds on approved ones
  reject ITEM_ID --note "..."         queues an item for regeneration with the note in the prompt
  diff [--stage S]                    what the current config would make stale
  assemble [--dry-run]                writes approved content into gameConfig
  validate                            runs the content gates on gameConfig
"""

import argparse
import asyncio
import csv
import fnmatch
import json
import sys
from pathlib import Path

from content_gen.context import DEFAULT_WORK, Context
from content_gen.ledger import Ledger
from content_gen.stages import ORDER, STAGES


def _llm(args):
    from content_gen.llm import LangchainLLM

    return LangchainLLM(model_name=args.model)


def cmd_status(ctx, ledger, args) -> int:
    counts = ledger.counts()
    for stage in ORDER:
        c = counts.get(stage, {})
        line = ", ".join(f"{k} {v}" for k, v in sorted(c.items())) or "nothing yet"
        print(f"{stage:11} {line}")
    tin, tout = ledger.usage()
    print(f"tokens      in {tin}, out {tout}")
    return 0


def cmd_run(ctx, ledger, args) -> int:
    from content_gen.runner import RunOptions, run_stage

    stage = STAGES[args.stage]
    opts = RunOptions(only=args.only, limit=args.limit, force=args.force, dry_run=args.dry_run,
                      concurrency=args.concurrency, budget_tokens=args.budget_tokens)
    llm = _llm(args) if not args.dry_run else type("DryLLM", (), {"model_id": args.model or "dry-run"})()
    report = asyncio.run(run_stage(stage, ctx, ledger, llm, opts))
    print(f"{stage.name}: planned {report.planned}, to do {report.todo}, done {len(report.done)}, "
          f"failed {len(report.failed)}, skipped {len(report.skipped)}, tokens in {report.tokens_in} out {report.tokens_out}")
    for item_id, err in report.failed.items():
        print(f"  FAILED {item_id}: {err[:300]}")
    if report.stopped:
        print(f"stopped: {report.stopped}")
    return 1 if report.failed else 0


def cmd_review(ctx, ledger, args) -> int:
    stage = STAGES[args.stage]
    path = ctx.work_dir / "review" / f"{stage.name}.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["item_id", "status", "summary", "error", "note", "output_file"])
        for row in ledger.rows(stage.name):
            summary = ""
            if row.output_path and (ctx.work_dir / row.output_path).exists():
                rec = json.loads((ctx.work_dir / row.output_path).read_text(encoding="utf-8"))
                summary = stage.summary(rec["output"])
            w.writerow([row.item_id, row.status, summary, row.error, row.note, row.output_path])
            print(f"{row.status:9} {row.item_id}: {summary[:110]}")
    print(f"wrote {path}")
    return 0


def cmd_approve(ctx, ledger, args) -> int:
    ids = [r.item_id for r in ledger.rows(args.stage) if not args.only or fnmatch.fnmatch(r.item_id, args.only)]
    print(f"approved {ledger.approve(ids)} item(s)")
    return 0


def cmd_reject(ctx, ledger, args) -> int:
    ledger.reject(args.item_id, args.note)
    print(f"rejected {args.item_id}; the next run regenerates it with your note")
    return 0


def cmd_diff(ctx, ledger, args) -> int:
    model = args.model or _llm(args).model_id
    for name in ([args.stage] if args.stage else ORDER):
        stage = STAGES[name]
        for item in stage.plan(ctx):
            row = ledger.get(item.item_id)
            if row is None:
                print(f"new    {item.item_id}")
            elif item.input_hash(stage.prompt_version, model, row.note) != row.input_hash:
                print(f"stale  {item.item_id} ({row.status})")
    return 0


def cmd_assemble(ctx, ledger, args) -> int:
    from content_gen.assemble import AssemblyError, assemble

    try:
        summary = assemble(ctx, dry_run=args.dry_run)
    except AssemblyError as e:
        print(e)
        return 1
    print(json.dumps(summary, indent=1))
    if not args.dry_run:
        print("assembled; run `validate` next")
    return 0


def cmd_validate(ctx, ledger, args) -> int:
    from content_gen.gates import run_gates

    report = run_gates(ctx.config_dir, ctx.work_dir, ctx.scope_name)
    for w in report.warnings:
        print(f"WARN  {w}")
    for e in report.errors:
        print(f"ERROR {e}")
    print("gates passed" if report.ok else f"{len(report.errors)} gate error(s)")
    return 0 if report.ok else 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="content_gen", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=None)
    parser.add_argument("--work", type=Path, default=DEFAULT_WORK)
    parser.add_argument("--scope", default="tier0")
    parser.add_argument("--model", default=None, help="override the model id")
    sub = parser.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    p = sub.add_parser("run")
    p.add_argument("--stage", required=True, choices=ORDER)
    p.add_argument("--only")
    p.add_argument("--limit", type=int)
    p.add_argument("--force", action="store_true")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--concurrency", type=int, default=3)
    p.add_argument("--budget-tokens", type=int)
    p = sub.add_parser("review")
    p.add_argument("--stage", required=True, choices=ORDER)
    p = sub.add_parser("approve")
    p.add_argument("--stage", required=True, choices=ORDER)
    p.add_argument("--only")
    p = sub.add_parser("reject")
    p.add_argument("item_id")
    p.add_argument("--note", required=True)
    p = sub.add_parser("diff")
    p.add_argument("--stage", choices=ORDER)
    p = sub.add_parser("assemble")
    p.add_argument("--dry-run", action="store_true")
    sub.add_parser("validate")
    args = parser.parse_args(argv)

    ctx = Context.load(args.config, args.work, args.scope)
    ledger = Ledger(ctx.ledger_path)
    try:
        return globals()[f"cmd_{args.cmd}"](ctx, ledger, args)
    finally:
        ledger.close()


if __name__ == "__main__":
    sys.exit(main())
