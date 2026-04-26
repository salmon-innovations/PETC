"""SQLite-backed outbox for offline buffering and retry-with-backoff."""
from __future__ import annotations

import contextlib
import json
import logging
import sqlite3
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Callable, Iterator, Optional

logger = logging.getLogger(__name__)

DB_PATH = Path("petc_outbox.db")

_DDL = """
CREATE TABLE IF NOT EXISTS outbox (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type  TEXT    NOT NULL,
    payload     TEXT    NOT NULL,          -- JSON
    status      TEXT    NOT NULL DEFAULT 'PENDING',
    attempts    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL,
    next_retry  TEXT    NOT NULL,
    last_error  TEXT
);
CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox(status, next_retry);
"""

_BACKOFF_SECONDS = [5, 15, 60, 300, 900]  # attempts 1-5; cap at 15 min


class OutboxStatus(str, Enum):
    PENDING = "PENDING"
    IN_FLIGHT = "IN_FLIGHT"
    DONE = "DONE"
    DEAD = "DEAD"


@dataclass
class OutboxEntry:
    id: int
    event_type: str
    payload: dict
    status: OutboxStatus
    attempts: int
    created_at: datetime
    next_retry: datetime
    last_error: Optional[str]


class Outbox:
    """
    Thread-safe SQLite outbox.
    The sync worker calls `poll_pending` in a loop; each item is passed to
    a user-supplied `sender` callable.  On success the item is marked DONE;
    on failure it is re-queued with exponential back-off (max 5 attempts
    before DEAD).
    """

    MAX_ATTEMPTS = 5

    def __init__(self, db_path: Path = DB_PATH) -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        self._init_db()

    # ------------------------------------------------------------------ public

    def enqueue(self, event_type: str, payload: dict) -> int:
        now = datetime.utcnow().isoformat()
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO outbox(event_type, payload, created_at, next_retry) VALUES(?,?,?,?)",
                (event_type, json.dumps(payload), now, now),
            )
            return cur.lastrowid

    def poll_pending(self, sender: Callable[[OutboxEntry], None], batch: int = 10) -> int:
        """
        Fetch up to `batch` PENDING entries whose next_retry <= now,
        call `sender` for each, and update status.  Returns the count processed.
        """
        now = datetime.utcnow().isoformat()
        processed = 0
        with self._lock:
            with self._conn() as conn:
                rows = conn.execute(
                    """SELECT id, event_type, payload, status, attempts, created_at, next_retry, last_error
                       FROM outbox
                       WHERE status = 'PENDING' AND next_retry <= ?
                       ORDER BY next_retry
                       LIMIT ?""",
                    (now, batch),
                ).fetchall()

            for row in rows:
                entry = self._row_to_entry(row)
                self._mark_in_flight(entry.id)
                try:
                    sender(entry)
                    self._mark_done(entry.id)
                except Exception as exc:
                    logger.warning("Outbox send failed id=%d: %s", entry.id, exc)
                    self._mark_failed(entry.id, str(exc))
                processed += 1
        return processed

    def pending_count(self) -> int:
        with self._conn() as conn:
            return conn.execute(
                "SELECT COUNT(*) FROM outbox WHERE status = 'PENDING'"
            ).fetchone()[0]

    # ----------------------------------------------------------------- private

    def _init_db(self) -> None:
        with self._conn() as conn:
            conn.executescript(_DDL)

    @contextlib.contextmanager
    def _conn(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(self._db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def _mark_in_flight(self, entry_id: int) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE outbox SET status='IN_FLIGHT' WHERE id=?", (entry_id,)
            )

    def _mark_done(self, entry_id: int) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE outbox SET status='DONE' WHERE id=?", (entry_id,)
            )

    def _mark_failed(self, entry_id: int, error: str) -> None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT attempts FROM outbox WHERE id=?", (entry_id,)
            ).fetchone()
            attempts = row["attempts"] + 1
            if attempts >= self.MAX_ATTEMPTS:
                conn.execute(
                    "UPDATE outbox SET status='DEAD', attempts=?, last_error=? WHERE id=?",
                    (attempts, error, entry_id),
                )
            else:
                delay = _BACKOFF_SECONDS[min(attempts - 1, len(_BACKOFF_SECONDS) - 1)]
                next_retry = datetime.utcfromtimestamp(time.time() + delay).isoformat()
                conn.execute(
                    """UPDATE outbox
                       SET status='PENDING', attempts=?, last_error=?, next_retry=?
                       WHERE id=?""",
                    (attempts, error, next_retry, entry_id),
                )

    @staticmethod
    def _row_to_entry(row: sqlite3.Row) -> OutboxEntry:
        return OutboxEntry(
            id=row["id"],
            event_type=row["event_type"],
            payload=json.loads(row["payload"]),
            status=OutboxStatus(row["status"]),
            attempts=row["attempts"],
            created_at=datetime.fromisoformat(row["created_at"]),
            next_retry=datetime.fromisoformat(row["next_retry"]),
            last_error=row["last_error"],
        )
