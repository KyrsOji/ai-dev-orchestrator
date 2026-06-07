from __future__ import annotations

import json
import os
import shlex
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict


def execute_task(run_dir: str, task: Dict[str, Any]) -> Dict[str, Any]:
    mode = os.environ.get("OPENHANDS_MODE", "dry-run")
    timeout = int(os.environ.get("OPENHANDS_TIMEOUT_SECONDS", "1800"))
    command = os.environ.get("OPENHANDS_CMD", "python3 -m openhands")
    args = os.environ.get("OPENHANDS_ARGS", "")

    run_path = Path(run_dir)
    task_md = run_path / "task.md"
    report_path = run_path / "execution-report.json"

    if mode != "execute":
        result = {
            "mode": mode,
            "status": "dry_run_skipped",
            "taskId": task.get("taskId") or task.get("task_id"),
            "runDirectory": str(run_path),
            "taskMarkdown": str(task_md),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        report_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        return result

    cmd = shlex.split(command) + shlex.split(args)
    # If SANDBOX_WRAPPER is provided, run the command via the sandbox wrapper.
    # The wrapper is expected to accept: <run_dir> -- <command> [args...]
    sandbox = os.environ.get("SANDBOX_WRAPPER")
    if sandbox:
        # Allow sandbox to be a command string with args; split it safely.
        sandbox_parts = shlex.split(sandbox)
        cmd = sandbox_parts + [str(run_path), "--"] + cmd

    proc = subprocess.run(
        cmd,
        cwd=str(run_path),
        text=True,
        capture_output=True,
        timeout=timeout,
        check=False,
    )

    result = {
        "mode": mode,
        "status": "completed" if proc.returncode == 0 else "failed",
        "returnCode": proc.returncode,
        "taskId": task.get("taskId") or task.get("task_id"),
        "runDirectory": str(run_path),
        "stdout": proc.stdout[-20000:],
        "stderr": proc.stderr[-20000:],
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    report_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result
