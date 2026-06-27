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

    # Prepare stdin input for OpenHands. Priority (first available):
    # 1. task.instructions
    # 2. task.instruction
    # 3. task.proposedAction.description
    # 4. selected proposedActions description (task.proposedActions + task.selectedAction)
    # 5. task.description
    # 6. task.md
    # 7. title fallback
    input_text = ""
    input_source = None
    try:
        # 1 & 2: explicit instructions fields
        instructions_val = task.get("instructions") or task.get("instruction")
        if instructions_val:
            input_text = str(instructions_val)
            input_source = "instructions" if task.get("instructions") else "instruction"
        else:
            # 3: single proposedAction object
            pa = task.get("proposedAction")
            if isinstance(pa, dict) and pa.get("description"):
                input_text = str(pa.get("description"))
                input_source = "proposedAction.description"
            else:
                # 4: proposedActions list with optional selectedAction
                pas = task.get("proposedActions") or task.get("proposed_actions")
                selected_id = task.get("selectedAction") or task.get("selected_action")
                selected_desc = None
                if isinstance(pas, list) and pas:
                    if selected_id:
                        for a in pas:
                            try:
                                if a and (a.get("id") == selected_id or str(a.get("id")) == str(selected_id)):
                                    selected_desc = a.get("description")
                                    break
                            except Exception:
                                continue
                    if not selected_desc:
                        first = pas[0]
                        if first and isinstance(first, dict) and first.get("description"):
                            selected_desc = first.get("description")
                if selected_desc:
                    input_text = str(selected_desc)
                    input_source = "proposedActions.selected" if selected_id else "proposedActions.first"
                else:
                    # 5: task.description
                    description = task.get("description")
                    if description:
                        input_text = str(description)
                        input_source = "description"
                    elif task_md.exists():
                        # 6: markdown fallback
                        input_text = task_md.read_text(encoding="utf-8")
                        input_source = "task.md"
                    else:
                        # 7: title fallback
                        parts = []
                        title = task.get("title")
                        if title:
                            parts.append(f"# {title}")
                        input_text = "\n\n".join(parts).strip()
                        input_source = "title" if title else "none"
    except Exception:
        input_text = ""
        input_source = None

    # Run the command, feeding the task content into stdin so interactive prompts receive it.
    proc = subprocess.run(
        cmd,
        cwd=str(run_path),
        text=True,
        input=input_text,
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
        # Metadata about which field was used for stdin (no secrets)
        "inputSource": input_source,
        "inputLength": len(input_text) if input_text is not None else 0,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }
    report_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result
