"""The work ledger: one row per generated item, keyed by a hash of everything that went into it.

Resume is the default. A changed prompt, model, input or reviewer note changes the hash and marks
exactly that item stale. Rows stuck in `running` (a killed process) go back to `pending`.
"""

import hashlib
import json
import sqlite3
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Optional

STATUSES = ("pending", "running", "done", "approved", "failed", "stale", "rejected")
# A "running" row this old with no heartbeat is presumed abandoned (a killed process). Short and
# frequent rather than one long timeout (code-review finding: the old 15-minute value had to be
# longer than the worst-case single-item time, which made "genuinely dead" detection slow) -
# runner.py's HEARTBEAT_INTERVAL_S ticks every item still being worked on well inside this window,
# however long the underlying LLM call itself takes, so this can stay short.
RUNNING_TIMEOUT_S = 90


@dataclass
class WorkItem:
    stage: str
    item_id: str
    inputs: dict[str, Any]
    depends_on: list[str] = field(default_factory=list)

    def input_hash(self, prompt_version: str, model: str, note: str = "") -> str:
        payload = json.dumps(
            {"stage": self.stage, "prompt": prompt_version, "model": model, "inputs": self.inputs, "note": note},
            sort_keys=True,
            default=str,
        )
        return hashlib.sha256(payload.encode("utf-8")).hexdigest()


@dataclass
class Row:
    item_id: str
    stage: str
    input_hash: str
    status: str
    attempts: int
    tokens_in: int
    tokens_out: int
    model: str
    output_path: str
    error: str
    note: str
    updated_at: float


class Ledger:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), timeout=30)
        # The work dir is often a Windows bind mount into the container, where SQLite's journal
        # file fails intermittently ("disk I/O error"). Keep the journal in memory instead.
        self.conn.execute("PRAGMA journal_mode=MEMORY")
        self.conn.execute(
            """CREATE TABLE IF NOT EXISTS items (
                item_id TEXT PRIMARY KEY, stage TEXT NOT NULL, input_hash TEXT NOT NULL,
                status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
                tokens_in INTEGER NOT NULL DEFAULT 0, tokens_out INTEGER NOT NULL DEFAULT 0,
                model TEXT NOT NULL DEFAULT '', output_path TEXT NOT NULL DEFAULT '',
                error TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', updated_at REAL NOT NULL
            )"""
        )
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # ---- reads ----

    def get(self, item_id: str) -> Optional[Row]:
        cur = self.conn.execute("SELECT * FROM items WHERE item_id = ?", (item_id,))
        r = cur.fetchone()
        return Row(*r) if r else None

    def rows(self, stage: Optional[str] = None) -> list[Row]:
        if stage:
            cur = self.conn.execute("SELECT * FROM items WHERE stage = ? ORDER BY item_id", (stage,))
        else:
            cur = self.conn.execute("SELECT * FROM items ORDER BY stage, item_id")
        return [Row(*r) for r in cur.fetchall()]

    def counts(self) -> dict[str, dict[str, int]]:
        out: dict[str, dict[str, int]] = {}
        for stage, status, n in self.conn.execute("SELECT stage, status, COUNT(*) FROM items GROUP BY stage, status"):
            out.setdefault(stage, {})[status] = n
        return out

    def usage(self) -> tuple[int, int]:
        tin, tout = self.conn.execute("SELECT COALESCE(SUM(tokens_in),0), COALESCE(SUM(tokens_out),0) FROM items").fetchone()
        return int(tin), int(tout)

    # ---- writes ----

    def _set(self, item_id: str, **fields: Any) -> None:
        fields["updated_at"] = time.time()
        cols = ", ".join(f"{k} = ?" for k in fields)
        for attempt in range(5):
            try:
                self.conn.execute(f"UPDATE items SET {cols} WHERE item_id = ?", (*fields.values(), item_id))
                self.conn.commit()
                return
            except sqlite3.OperationalError:
                if attempt == 4:
                    raise
                time.sleep(0.2 * (attempt + 1))

    def sync(self, items: Iterable[WorkItem], prompt_version: str, model: str) -> None:
        """Registers planned items; marks changed ones stale and self-heals abandoned runs."""
        now = time.time()
        for item in items:
            row = self.get(item.item_id)
            if row is None:
                self.conn.execute(
                    "INSERT INTO items (item_id, stage, input_hash, status, updated_at) VALUES (?, ?, ?, 'pending', ?)",
                    (item.item_id, item.stage, item.input_hash(prompt_version, model), now),
                )
                continue
            new_hash = item.input_hash(prompt_version, model, row.note)
            if row.status == "running" and now - row.updated_at > RUNNING_TIMEOUT_S:
                self._set(item.item_id, status="pending")
                row = self.get(item.item_id)
            if new_hash != row.input_hash and row.status in ("done", "approved", "failed"):
                self._set(item.item_id, status="stale", input_hash=new_hash)
            elif new_hash != row.input_hash:
                self._set(item.item_id, input_hash=new_hash)
        self.conn.commit()

    def todo(self, item_ids: Iterable[str], max_attempts: int, force: bool = False) -> list[str]:
        out = []
        for item_id in item_ids:
            row = self.get(item_id)
            if row is None:
                continue
            if force and row.status != "running":
                out.append(item_id)
            elif row.status in ("pending", "stale", "rejected"):
                out.append(item_id)
            elif row.status == "failed" and row.attempts < max_attempts:
                out.append(item_id)
        return out

    def claim(self, item_id: str) -> None:
        self._set(item_id, status="running")

    def heartbeat(self, item_id: str) -> None:
        """Bumps `updated_at` without touching status - a live worker's periodic "still working
        on this" signal, so `sync()` (via `RUNNING_TIMEOUT_S`) can tell a genuinely stuck item
        (a killed process, no more heartbeats) apart from one that is merely slow."""
        self._set(item_id)

    def finish(self, item_id: str, output_path: str, tokens_in: int, tokens_out: int, model: str, attempts: int) -> None:
        row = self.get(item_id)
        self._set(
            item_id,
            status="done",
            output_path=output_path,
            error="",
            tokens_in=row.tokens_in + tokens_in,
            tokens_out=row.tokens_out + tokens_out,
            model=model,
            attempts=attempts,
        )

    def fail(self, item_id: str, error: str, tokens_in: int, tokens_out: int, attempts: int) -> None:
        row = self.get(item_id)
        self._set(
            item_id,
            status="failed",
            error=error[:4000],
            tokens_in=row.tokens_in + tokens_in,
            tokens_out=row.tokens_out + tokens_out,
            attempts=row.attempts + attempts,
        )

    def unstick(self) -> int:
        """Items a killed run left in `running` go back to pending."""
        cur = self.conn.execute("UPDATE items SET status = 'pending' WHERE status = 'running'")
        self.conn.commit()
        return cur.rowcount

    def release(self, item_id: str) -> None:
        """An item interrupted before it started stays pending."""
        self._set(item_id, status="pending")

    def approve(self, item_ids: Iterable[str]) -> int:
        n = 0
        for item_id in item_ids:
            row = self.get(item_id)
            if row and row.status == "done":
                self._set(item_id, status="approved")
                n += 1
        return n

    def freeze(self, item_id: str, input_hash: str) -> None:
        """Keeps the content this item already has: approved, and its hash pinned to the current
        inputs so a later prompt or template change does not queue a regeneration of it."""
        self._set(item_id, status="approved", input_hash=input_hash, error="")

    def reject(self, item_id: str, note: str) -> None:
        """Queues the item for regeneration with the reviewer note fed back into the prompt."""
        row = self.get(item_id)
        if row is None:
            raise KeyError(item_id)
        self._set(item_id, status="rejected", note=note, attempts=0)

    def drop(self, item_ids: Iterable[str]) -> int:
        """Forgets items entirely. Used when a stage's plan no longer contains them, for instance
        after the challenge templates were rewritten and the old slugs no longer exist: their
        approved rows would otherwise keep feeding orphan work into the stages downstream."""
        ids = list(item_ids)
        if not ids:
            return 0
        with self.conn:
            cur = self.conn.execute(
                f"DELETE FROM items WHERE item_id IN ({','.join('?' * len(ids))})", ids
            )
        return cur.rowcount
