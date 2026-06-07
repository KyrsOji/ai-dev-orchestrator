from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


def prepare_run_directory(task: Dict[str, Any], base_dir: str | None = None) -> Dict[str, Any]:
    task_id = str(task.get("taskId") or task.get("task_id") or "unknown-task")
    root = Path(base_dir or Path.home() / "openhands-runs")
    run_dir = root / task_id
    run_dir.mkdir(parents=True, exist_ok=True)

    task_json = run_dir / "task.json"
    task_md = run_dir / "task.md"

    task_json.write_text(json.dumps(task, indent=2, sort_keys=True) + "\n")

    title = task.get("title", task_id)
    description = task.get("description", "")
    instructions = task.get("instructions", "")

    task_md.write_text(
        f"# {title}\n\n"
        f"Task ID: `{task_id}`\n\n"
        f"## Description\n\n{description}\n\n"
        f"## Instructions\n\n{instructions}\n"
    )

    return {
        "taskId": task_id,
        "runDirectory": str(run_dir),
        "taskJson": str(task_json),
        "taskMarkdown": str(task_md),
    }
