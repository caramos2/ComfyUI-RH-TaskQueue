"""SQLite store for workflow execution duration samples.

Scope is deliberately narrow: this store knows nothing about task state,
queues or outputs. It only remembers "how long did this workflow take the
last time it ran successfully", so the UI can show a reference duration.

Concurrency notes:
  * one connection, guarded by a re-entrant lock (ComfyUI serves routes from
    a single asyncio loop but may call this from worker threads),
  * WAL journal so a reader never blocks the writer,
  * every write runs inside an explicit BEGIN IMMEDIATE transaction so an
    interrupted write can never leave a half-updated row behind.
"""

import os
import sqlite3
import threading
import time

from .fingerprint import is_valid_signature, is_valid_version

_SCHEMA = """
CREATE TABLE IF NOT EXISTS workflow_duration_history (
    signature         TEXT PRIMARY KEY,
    signature_version INTEGER NOT NULL,
    last_duration     REAL NOT NULL,
    avg_duration      REAL NOT NULL,
    sample_count      INTEGER NOT NULL DEFAULT 1,
    last_prompt_id    TEXT,
    updated_at        REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wdh_updated_at
    ON workflow_duration_history(updated_at DESC);

-- Guards against counting the same execution twice. The plugin rebuilds
-- its view from the backend history after a reload, so the same job can
-- be reported again and must not add a second sample.
CREATE TABLE IF NOT EXISTS recorded_prompts (
    prompt_id   TEXT PRIMARY KEY,
    signature   TEXT NOT NULL,
    recorded_at REAL NOT NULL
);
"""


class DurationStore:
    """Persistent map of workflow signature -> duration statistics."""

    def __init__(self, db_path: str):
        self.db_path = os.path.abspath(db_path)
        parent = os.path.dirname(self.db_path)
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._lock = threading.RLock()
        # isolation_level=None -> we drive transactions by hand.
        self._conn = sqlite3.connect(
            self.db_path, check_same_thread=False, timeout=5.0, isolation_level=None
        )
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA busy_timeout=5000")
            self._conn.executescript(_SCHEMA)

    # -- internal helpers -------------------------------------------------

    def _execute_write(self, sql, params):
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                cursor = self._conn.execute(sql, params)
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
            self._conn.execute("COMMIT")
            return cursor

    # -- public API --------------------------------------------------------

    def _row(self, signature):
        """Fetch one row without taking the lock.

        Called from inside an open transaction where the caller already owns
        the lock.
        """
        if not is_valid_signature(signature):
            return None
        row = self._conn.execute(
            "SELECT * FROM workflow_duration_history WHERE signature = ?",
            (signature,),
        ).fetchone()
        return dict(row) if row is not None else None

    def get(self, signature):
        """Return the stored record for signature, or None."""
        with self._lock:
            return self._row(signature)

    def record(self, signature, duration, prompt_id=None, signature_version=1):
        """Store one successful execution duration and return the new row."""
        if not is_valid_signature(signature):
            raise ValueError("signature must be 64 lowercase hex characters")
        if not is_valid_version(signature_version):
            raise ValueError("signature_version must be an integer >= 1")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)):
            raise ValueError("duration must be a number")
        duration = float(duration)
        if duration < 0:
            raise ValueError("duration must be >= 0")

        now = time.time()
        with self._lock:
            self._conn.execute("BEGIN IMMEDIATE")
            try:
                if prompt_id:
                    seen = self._conn.execute(
                        "SELECT 1 FROM recorded_prompts WHERE prompt_id = ?", (prompt_id,)
                    ).fetchone()
                    if seen is not None:
                        existing = self._row(signature)
                        if existing is not None:
                            # Already counted: do not add a second sample.
                            self._conn.execute("COMMIT")
                            return existing
                        # The idempotency row outlived its duration row (the
                        # history entry was deleted in between). Fall through
                        # and store the sample again instead of returning
                        # None, which used to turn into a 500 on the route.
                    self._conn.execute(
                        "INSERT OR REPLACE INTO recorded_prompts (prompt_id, signature, recorded_at) "
                        "VALUES (?, ?, ?)",
                        (prompt_id, signature, now),
                    )
                self._conn.execute(
                    """
                    INSERT INTO workflow_duration_history (
                        signature, signature_version, last_duration, avg_duration,
                        sample_count, last_prompt_id, updated_at
                    ) VALUES (?, ?, ?, ?, 1, ?, ?)
                    ON CONFLICT(signature) DO UPDATE SET
                        signature_version = excluded.signature_version,
                        last_duration    = excluded.last_duration,
                        avg_duration     = ((avg_duration * sample_count) + excluded.last_duration)
                                           / (sample_count + 1),
                        sample_count     = sample_count + 1,
                        last_prompt_id   = excluded.last_prompt_id,
                        updated_at       = excluded.updated_at
                    """,
                    (signature, int(signature_version), duration, duration, prompt_id, now),
                )
            except Exception:
                self._conn.execute("ROLLBACK")
                raise
            self._conn.execute("COMMIT")
        return self.get(signature)

    def list(self, limit=50, offset=0):
        """Return {"records": [...], "total": n} ordered by most recent first."""
        limit = max(1, min(int(limit), 500))
        offset = max(0, int(offset))
        with self._lock:
            total = self._conn.execute(
                "SELECT COUNT(*) FROM workflow_duration_history"
            ).fetchone()[0]
            rows = self._conn.execute(
                "SELECT * FROM workflow_duration_history "
                "ORDER BY updated_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        return {"records": [dict(r) for r in rows], "total": total}

    def delete(self, signature) -> bool:
        """Delete one signature. Returns True when a row was actually removed."""
        if not is_valid_signature(signature):
            return False
        cursor = self._execute_write(
            "DELETE FROM workflow_duration_history WHERE signature = ?", (signature,)
        )
        return cursor.rowcount > 0

    def count(self) -> int:
        with self._lock:
            return self._conn.execute(
                "SELECT COUNT(*) FROM workflow_duration_history"
            ).fetchone()[0]

    def health(self):
        return {"ok": True, "path": self.db_path, "count": self.count()}

    def close(self):
        with self._lock:
            try:
                self._conn.close()
            except Exception:
                pass
