from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


def prepare_run_directory(task: Dict[str, Any], base_dir: str | None = None) -> str:
    task_id = str(task.get("taskId") or task.get("task_id") or "unknown-task")
    root = Path(base_dir or Path.home() / "openhands-runs")
    run_dir = root / task_id
    run_dir.mkdir(parents=True, exist_ok=True)

    (run_dir / "task.json").write_text(json.dumps(task, indent=2, sort_keys=True) + "\n")

    title = task.get("title", task_id)
    description = task.get("description", "")
    instructions = task.get("instructions", "")

    (run_dir / "task.md").write_text(
        f"# {title}\n\n"
        f"Task ID: `{task_id}`\n\n"
        f"## Description\n\n{description}\n\n"
        f"## Instructions\n\n{instructions}\n",
    )

    return str(run_dir)
