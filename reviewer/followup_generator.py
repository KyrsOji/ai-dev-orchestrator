"""Rule-based follow-up suggestion generator for completed/failed SDK tasks.

Deterministic, no LLM calls. Uses responsePreview and status to produce
a suggested follow-up object and logs it (does not publish to Kafka).

API:
    generate_followup(result: dict) -> dict | None

The returned dict follows the required shape:
{
  "parentTaskId": "...",
  "conversationId": "...",
  "title": "...",
  "description": "...",
  "reason": "...",
  "source": "auto-followup",
}

If the input is insufficient (missing taskId), returns None.
"""
from __future__ import annotations

import json
import logging
from typing import Optional, Dict

logger = logging.getLogger(__name__)


COMPLETED_STATUSES = {"completed", "executed", "finished", "success"}
FAILED_STATUSES = {"failed", "error", "timeout"}


def _normalize_text(s: Optional[str]) -> str:
    if not s:
        return ""
    return str(s).strip()


def generate_followup(result: Dict[str, object]) -> Optional[Dict[str, object]]:
    """Generate a deterministic follow-up suggestion from a result message.

    The function never publishes; it logs the suggestion and returns it.
    """
    if not isinstance(result, dict):
        return None

    task_id = result.get("taskId") or result.get("id")
    if not task_id:
        # Nothing to base a follow-up on
        return None

    conv_id = result.get("conversationId")
    status = _normalize_text(result.get("status")).lower()
    response = _normalize_text(result.get("responsePreview") or result.get("response") or result.get("response_preview"))
    summary = _normalize_text(result.get("summary"))

    suggestion: Dict[str, object] = {
        "parentTaskId": task_id,
        "conversationId": conv_id or "",
        "title": "",
        "description": "",
        "reason": "",
        "source": "auto-followup",
    }

    low = response.lower()

    # Missing responsePreview
    if not response:
        suggestion["title"] = "Review execution output"
        suggestion["reason"] = "Missing responsePreview"
        suggestion["description"] = (
            f"No responsePreview was recorded for task {task_id}. Check conversation {conv_id or '(unknown)'} and logs. Summary: {summary}"
        )
        logger.info("Auto-followup suggestion: %s", json.dumps(suggestion, ensure_ascii=False))
        return suggestion

    # Completed/executed tasks
    if status in COMPLETED_STATUSES:
        # Heuristic rules based on responsePreview content
        if "sdk executor" in low or ("sdk" in low and "executor" in low):
            suggestion["title"] = "Validate SDK executor through Kafka"
            suggestion["reason"] = "Execution implementation completed."
            suggestion["description"] = (
                f"The agent reported: {response}. Suggested next step: verify the task was published to ai.dev.result.out and that the execution-report.json contains conversationId and returnCode=0. Summary: {summary}"
            )
        elif "pong" in low or low.startswith("pong"):
            suggestion["title"] = "Confirm SDK response and integration"
            suggestion["reason"] = "Agent responded with a verification acknowledgement."
            suggestion["description"] = (
                f"Agent reply: {response}. Consider confirming end-to-end integration (SDK output, run directory, and metadata). Summary: {summary}"
            )
        else:
            suggestion["title"] = "Review completed execution"
            suggestion["reason"] = "Execution completed; review results."
            suggestion["description"] = (
                f"Response preview: {response}. Summary: {summary}. Conversation: {conv_id or '(unknown)'}"
            )

        logger.info("Auto-followup suggestion: %s", json.dumps(suggestion, ensure_ascii=False))
        return suggestion

    # Failed tasks
    if status in FAILED_STATUSES:
        suggestion["title"] = "Investigate failed execution"
        reason_text = summary or response or "Task failed without summary"
        suggestion["reason"] = f"Execution failed: {reason_text}"
        suggestion["description"] = (
            f"Task {task_id} failed. Response preview: {response}. Conversation: {conv_id or '(unknown)'}"
        )
        logger.info("Auto-followup suggestion: %s", json.dumps(suggestion, ensure_ascii=False))
        return suggestion

    # Fallback: no strong signal
    suggestion["title"] = "Review execution outcome"
    suggestion["reason"] = "No definitive rule matched; manual review recommended."
    suggestion["description"] = f"Response preview: {response}. Summary: {summary}."
    logger.info("Auto-followup suggestion: %s", json.dumps(suggestion, ensure_ascii=False))
    return suggestion
