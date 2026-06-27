#!/usr/bin/env python3
"""OpenHands real stub for sandbox validation.

This script is intentionally minimal and safe. It writes a validation.txt file
in the current working directory (which is the run directory created by the
sandbox). It reads task.json (if present) to extract taskId.
"""
from __future__ import annotations

import json
import socket
import uuid
from datetime import datetime, timezone
from pathlib import Path
import sys


def main() -> int:
    run_path = Path('.')
    task_id = None
    task_file = run_path / 'task.json'
    if task_file.exists():
        try:
            data = json.loads(task_file.read_text(encoding='utf-8'))
            task_id = data.get('taskId') or data.get('task_id') or data.get('id')
        except Exception:
            task_id = None

    now = datetime.now(timezone.utc).isoformat()
    hostname = socket.gethostname()

    # Read any stdin content (simulate receiving task instructions)
    stdin_content = None
    try:
        # If stdin is not a TTY, attempt to read any piped content.
        if not sys.stdin.isatty():
            stdin_content = sys.stdin.read()
    except Exception:
        stdin_content = None

    # If stdin contains content, write a smoke markdown file in the run directory.
    if stdin_content:
        try:
            smoke_path = run_path / "real-oh-smoke-003.md"
            # Normalize to expected test content; write exactly what was received.
            smoke_path.write_text(stdin_content.strip() + "\n", encoding='utf-8')
        except Exception as exc:
            print(f"[openhands-real-stub] Failed to write smoke file: {exc}", file=sys.stderr)

    val_path = run_path / 'validation.txt'
    try:
        with val_path.open('w', encoding='utf-8') as fh:
            fh.write(f"timestamp: {now}\n")
            fh.write(f"taskId: {task_id or 'unknown'}\n")
            fh.write(f"hostname: {hostname}\n")
            fh.write("OPENHANDS_REAL_EXECUTION_VALIDATED\n")
    except Exception as exc:
        print(f"[openhands-real-stub] Failed to write validation.txt: {exc}", file=sys.stderr)
        return 1

    conv = uuid.uuid4().hex
    print(f"Initialized conversation {conv}")
    print(f"[openhands-real-stub] Wrote validation.txt for task {task_id}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
