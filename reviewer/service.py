#!/usr/bin/env python3
"""Dry-run reviewer service for AI Dev feedback loop.

This module classifies runner results and decides next actions:
- classification categories: completed, failed, needs_more_info, unsafe,
  ready_to_commit, ready_to_push, requires_human_approval
- It publishes mock Kafka messages to ai.dev.task.ofbiz and ai.dev.approval.request

This is intentionally deterministic and does not call external services.
"""
from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass, asdict
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)
logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)


@dataclass
class ReviewResult:
    taskId: str
    classification: str
    reason: Optional[str] = None
    details: Optional[Dict[str, Any]] = None


class KafkaMock:
    def publish(self, topic: str, message: Dict[str, Any]) -> None:
        payload = json.dumps(message, ensure_ascii=False)
        print(f"[KAFKA-PUBLISH] topic={topic} message={payload}")


class Reviewer:
    """Deterministic rule-based reviewer."""

    def __init__(self, dry_run: bool = True) -> None:
        self.dry_run = dry_run
        self.kafka = KafkaMock()
        self.approval_topic = "ai.dev.approval.request"
        self.task_topic = "ai.dev.task.ofbiz"

    def classify(self, result: Dict[str, Any]) -> ReviewResult:
        task_id = result.get("taskId") or result.get("id") or "unknown"
        status = (result.get("status") or result.get("result") or "").lower()
        meta = result.get("metadata") or {}

        # Safety overrides
        if meta.get("contains_secrets") or meta.get("modifies_certs"):
            return ReviewResult(taskId=task_id, classification="unsafe", reason="secrets/certs change", details={"metadata": meta})

        if status in ("failed", "error"):
            # If we have an explicit request for more info
            if meta.get("needs_more_info"):
                return ReviewResult(taskId=task_id, classification="needs_more_info", reason="runner requested more info", details={"metadata": meta})
            return ReviewResult(taskId=task_id, classification="failed", reason="runner reported failure", details={"metadata": meta})

        # Never enable execute mode automatically
        if meta.get("execute_mode"):
            return ReviewResult(taskId=task_id, classification="requires_human_approval", reason="execute mode requires approval", details={"metadata": meta})

        # Never auto-run sudo
        if meta.get("requests_sudo"):
            return ReviewResult(taskId=task_id, classification="requires_human_approval", reason="sudo requires approval", details={"metadata": meta})

        # Never modify systemd without approval
        if meta.get("modifies_systemd"):
            return ReviewResult(taskId=task_id, classification="requires_human_approval", reason="systemd modifications require approval", details={"metadata": meta})

        # Deploy/restart and pushes require approval
        action = (meta.get("action") or "").lower()
        if action in ("deploy", "restart"):
            return ReviewResult(taskId=task_id, classification="requires_human_approval", reason=f"action {action} requires approval", details={"metadata": meta})

        change_type = (meta.get("change_type") or "").lower()
        # commits require approval per rules
        if change_type in ("commit", "push"):
            return ReviewResult(taskId=task_id, classification="requires_human_approval", reason=f"{change_type} requires approval", details={"metadata": meta})

        # docs-only and dry-run can be auto-committed
        if change_type in ("docs-only", "docs"):
            return ReviewResult(taskId=task_id, classification="ready_to_commit", reason="docs-only auto-commit", details={"metadata": meta})

        if meta.get("dry_run"):
            return ReviewResult(taskId=task_id, classification="ready_to_commit", reason="dry-run auto-commit", details={"metadata": meta})

        # Successful and no special flags -> completed
        return ReviewResult(taskId=task_id, classification="completed", reason="no further action", details={"metadata": meta})

    def handle(self, result: Dict[str, Any]) -> ReviewResult:
        review = self.classify(result)
        logger.info("Review for %s: %s (%s)", review.taskId, review.classification, review.reason)

        # Decide publishes based on classification
        if review.classification in ("requires_human_approval", "unsafe"):
            payload = {
                "taskId": review.taskId,
                "classification": review.classification,
                "reason": review.reason,
                "details": review.details,
            }
            # Publish approval request (mock)
            self.kafka.publish(self.approval_topic, payload)

        if review.classification in ("ready_to_commit", "ready_to_push"):
            # Publish a follow-up OFBiz task to perform the commit/push (mock)
            payload = {
                "taskId": review.taskId,
                "action": "commit" if review.classification == "ready_to_commit" else "push",
                "details": review.details,
            }
            self.kafka.publish(self.task_topic, payload)

        # For completed/failed/needs_more_info we do not publish additional tasks here
        return review


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(prog="reviewer-service", description="Dry-run reviewer service CLI")
    parser.add_argument("--sample-result-file", help="JSON file containing a single runner result", required=True)
    parser.add_argument("--dry-run", action="store_true", help="Run in dry-run/mock mode (default)")
    args = parser.parse_args(argv)

    with open(args.sample_result_file, "r", encoding="utf-8") as fh:
        result = json.load(fh)

    rev = Reviewer(dry_run=args.dry_run)
    review = rev.handle(result)
    print(json.dumps({"taskId": review.taskId, "classification": review.classification, "reason": review.reason}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
