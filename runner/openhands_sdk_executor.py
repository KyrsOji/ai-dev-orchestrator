from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict

from openhands_cli.tui.settings.store import AgentStore
from openhands.sdk.conversation.conversation import Conversation


def execute_task(run_dir: str, task: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a task using the OpenHands SDK (minimal, POC-style).

    - Loads AgentStore
    - Disables tools on the agent
    - Creates a Conversation(workspace=run_dir, max_iteration_per_run=1)
    - Sends task text into the conversation
    - Calls agent.step()
    - Writes execution-report.json into run_dir
    """
    mode = os.environ.get("OPENHANDS_MODE", "dry-run")
    run_path = Path(run_dir)
    report_path = run_path / "execution-report.json"

    # Prepare stdin-like input text (same priority as CLI executor)
    input_text = ""
    input_source = None
    try:
        instructions_val = task.get("instructions") or task.get("instruction")
        if instructions_val:
            input_text = str(instructions_val)
            input_source = "instructions" if task.get("instructions") else "instruction"
        else:
            pa = task.get("proposedAction")
            if isinstance(pa, dict) and pa.get("description"):
                input_text = str(pa.get("description"))
                input_source = "proposedAction.description"
            else:
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
                    description = task.get("description")
                    if description:
                        input_text = str(description)
                        input_source = "description"
                    else:
                        task_md = run_path / "task.md"
                        if task_md.exists():
                            input_text = task_md.read_text(encoding="utf-8")
                            input_source = "task.md"
                        else:
                            parts = []
                            title = task.get("title")
                            if title:
                                parts.append(f"# {title}")
                            input_text = "\n\n".join(parts).strip()
                            input_source = "title" if title else "none"
    except Exception:
        input_text = ""
        input_source = None

    if mode != "execute":
        result = {
            "mode": mode,
            "status": "dry_run_skipped",
            "taskId": task.get("taskId") or task.get("task_id"),
            "runDirectory": str(run_path),
            "taskMarkdown": str(run_path / "task.md"),
            "inputSource": input_source,
            "inputLength": len(input_text) if input_text is not None else 0,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
        report_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
        return result

    # Load the agent from AgentStore
    agent = AgentStore().load(session_id="sdk-poc6")
    if not agent:
        raise SystemExit("AgentStore returned no agent")

    # Disable tools and any mcp config for this first version
    agent = agent.model_copy(update={"tools": [], "mcp_config": {}})

    conversation = Conversation(
        agent=agent,
        workspace=str(run_path),
        max_iteration_per_run=1,
        visualizer=None,
    )

    # Send the prepared task text into the conversation
    conversation.send_message(input_text)

    # Collect minimal event info
    def on_event(event: object) -> None:
        try:
            conversation.state.events.append(event)
        except Exception:
            # Best-effort; do not fail the run for non-serializable events
            pass

    error_type = None
    error_message = None
    return_code = 0
    status = "completed"

    try:
        agent.step(conversation, on_event=on_event)
    except Exception as e:
        status = "failed"
        return_code = 1
        error_type = type(e).__name__
        error_message = str(e)

    result = {
        "mode": mode,
        "status": status,
        "taskId": task.get("taskId") or task.get("task_id"),
        "runDirectory": str(run_path),
        "conversationId": str(getattr(conversation, "id", "")),
        "executionStatus": str(getattr(conversation.state, "execution_status", "")),
        "eventsCount": len(getattr(conversation.state, "events", [])),
        "returnCode": return_code,
        "summary": f"SDK runner completed with status: {status}",
        "errorType": error_type,
        "errorMessage": error_message,
        "inputSource": input_source,
        "inputLength": len(input_text) if input_text is not None else 0,
        "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    report_path.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n")
    return result
