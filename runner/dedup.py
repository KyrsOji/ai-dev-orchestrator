"""Deduplication helper for runner service.

Provides SQLite-backed persistence of processed task IDs and statuses.
"""
from __future__ import annotations

import logging
import os
import sqlite3
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

DEFAULT_DB_PATH = "/var/lib/ai-dev-runner/processed_tasks.db"
TERMINAL_STATUSES = {"completed", "dry_run_completed", "execution_completed"}


def _get_db_path(provided: Optional[str] = None) -> str:
    if provided:
        return provided
    return os.environ.get("PROCESSED_TASKS_DB", DEFAULT_DB_PATH)


def init_db(db_path: Optional[str] = None) -> None:
    """Initialize the SQLite database and ensure parent dir exists."""
    path = _get_db_path(db_path)
    parent = os.path.dirname(path)
    try:
        if parent:
            os.makedirs(parent, exist_ok=True)
    except Exception as exc:
        logger.warning("Could not create parent dir for processed tasks DB %s: %s", parent, exc)
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS processed_tasks (
                task_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                processed_at TEXT NOT NULL,
                result_id TEXT
            )
            """
        )
        conn.commit()
    except Exception as exc:
        logger.exception("Failed to initialize processed tasks DB at %s: %s", path, exc)
    finally:
        try:
            conn.close()
        except Exception:
            pass


def get_task_status(task_id: str, db_path: Optional[str] = None) -> Optional[str]:
    path = _get_db_path(db_path)
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        cur.execute("SELECT status FROM processed_tasks WHERE task_id = ?", (task_id,))
        row = cur.fetchone()
        return row[0] if row else None
    except Exception as exc:
        logger.debug("Could not read processed tasks DB %s: %s", path, exc)
        return None
    finally:
        try:
            conn.close()
        except Exception:
            pass


def is_terminal_status(status: Optional[str]) -> bool:
    return status in TERMINAL_STATUSES


def upsert_processed_task(task_id: str, status: str, result_id: Optional[str] = None, db_path: Optional[str] = None) -> bool:
    """Insert or update a processed task record. Returns True on success."""
    path = _get_db_path(db_path)
    processed_at = datetime.utcnow().isoformat() + "Z"
    try:
        conn = sqlite3.connect(path)
        cur = conn.cursor()
        # Use UPSERT (INSERT ... ON CONFLICT DO UPDATE) for clarity
        cur.execute(
            """
            INSERT INTO processed_tasks(task_id, status, processed_at, result_id)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(task_id) DO UPDATE SET
                status = excluded.status,
                processed_at = excluded.processed_at,
                result_id = excluded.result_id
            """,
            (task_id, status, processed_at, result_id),
        )
        conn.commit()
        logger.info("Recorded completed task: %s", task_id)
        return True
    except Exception as exc:
        logger.exception("Failed to upsert processed task %s to DB %s: %s", task_id, path, exc)
        return False
    finally:
        try:
            conn.close()
        except Exception:
            pass
