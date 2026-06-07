#!/usr/bin/env python3
"""Mock Matrix approval bridge.

This module implements a dry-run/mock bridge that demonstrates how approval
requests would be routed between Kafka and a Matrix room. It intentionally
does not open network connections; Matrix posts and Kafka publishes are
printed to stdout for testing and smoke runs.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)
logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)


@dataclass
class ApprovalResponse:
    taskId: str
    decision: str  # 'approved', 'denied', 'pending'
    policy: Optional[str] = None
    reason: Optional[str] = None
    approver: Optional[str] = None


class MatrixMock:
    """A simple mock that prints Matrix messages to stdout."""

    def __init__(self, room: str = "!approvals:example", user: str = "@bot:example") -> None:
        self.room = room
        self.user = user

    def post_message(self, content: str) -> None:
        print(f"[MATRIX-MOCK] room={self.room} user={self.user} message={content}")


class KafkaMock:
    """A simple mock that prints Kafka publishes to stdout."""

    def publish(self, topic: str, message: Dict[str, Any]) -> None:
        payload = json.dumps(message, ensure_ascii=False)
        print(f"[KAFKA-PUBLISH] topic={topic} message={payload}")


class MatrixBridge:
    """Bridge logic (mocked) for approval requests and responses."""

    def __init__(self, config: Optional[Dict[str, Any]] = None, dry_run: bool = True) -> None:
        self.config = config or {}
        self.dry_run = dry_run
        self.matrix_room = self.config.get("matrix_room", "!approvals:example")
        self.kafka_consume_topic = self.config.get("kafka_consume_topic", "ai.dev.approval.request")
        self.kafka_publish_topic = self.config.get("kafka_publish_topic", "ai.dev.approval.response")
        self.matrix = MatrixMock(room=self.matrix_room)
        self.kafka = KafkaMock()

    def post_task_summary(self, task: Dict[str, Any]) -> None:
        summary = f"Task {task.get('taskId')} - {task.get('title', '')}"
        self.matrix.post_message(summary)

    def post_approval_request(self, task: Dict[str, Any]) -> None:
        body = (
            f"Approval request for task {task.get('taskId')}: {task.get('title', '')} "
            f"metadata={task.get('metadata', {})}"
        )
        self.matrix.post_message(body)

    def evaluate_policy(self, task: Dict[str, Any]) -> ApprovalResponse:
        meta = task.get("metadata", {}) or {}
        task_id = task.get("taskId", "unknown")

        # Secrets/certs always deny
        if meta.get("contains_secrets") or meta.get("modifies_certs"):
            return ApprovalResponse(taskId=task_id, decision="denied", reason="secrets/certs change")

        change_type = (meta.get("change_type") or "").lower()

        # Policies that auto-approve
        if change_type in ("docs-only", "docs"):
            return ApprovalResponse(taskId=task_id, decision="approved", reason="docs-only auto-approve", policy="docs-only")
        if meta.get("dry_run"):
            return ApprovalResponse(taskId=task_id, decision="approved", reason="dry-run auto-approve", policy="dry-run")

        # Policies that require approval
        if change_type in ("commit", "push", "sudo", "systemd", "execute"):
            return ApprovalResponse(taskId=task_id, decision="pending", reason=f"{change_type} requires approval", policy=change_type)

        # Unknown defaults to pending
        return ApprovalResponse(taskId=task_id, decision="pending", reason="unknown change type - require approval")

    def publish_response(self, resp: ApprovalResponse) -> None:
        payload = {
            "taskId": resp.taskId,
            "decision": resp.decision,
            "policy": resp.policy,
            "reason": resp.reason,
            "approver": resp.approver,
        }
        self.kafka.publish(self.kafka_publish_topic, payload)

    def handle_command(self, cmd: str, task_id: Optional[str] = None) -> Optional[ApprovalResponse]:
        parts = cmd.strip().split()
        if not parts:
            return None
        verb = parts[0].lower()
        if verb in ("approve", "deny", "status") and len(parts) >= 2:
            target = parts[1]
            if task_id and target != task_id:
                return None
            if verb == "approve":
                resp = ApprovalResponse(taskId=target, decision="approved", approver="matrix-user")
                self.publish_response(resp)
                return resp
            if verb == "deny":
                resp = ApprovalResponse(taskId=target, decision="denied", approver="matrix-user")
                self.publish_response(resp)
                return resp
            if verb == "status":
                self.matrix.post_message(f"Status for {target}: pending")
                return None
        if verb in ("auto-approve", "require-approval") and len(parts) >= 2:
            policy = parts[1].lower()
            self.matrix.post_message(f"Policy change request (mock): {verb} {policy}")
            return None
        return None

    def process_approval_request(self, task: Dict[str, Any], mock_commands: Optional[List[str]] = None) -> ApprovalResponse:
        self.post_task_summary(task)
        evaluated = self.evaluate_policy(task)
        if evaluated.decision == "approved":
            self.publish_response(evaluated)
            return evaluated
        if evaluated.decision == "denied":
            self.publish_response(evaluated)
            return evaluated

        # pending
        self.post_approval_request(task)
        if mock_commands:
            for c in mock_commands:
                res = self.handle_command(c, task_id=task.get("taskId"))
                if isinstance(res, ApprovalResponse):
                    return res
        return evaluated


def load_config(path: Optional[str]) -> Dict[str, Any]:
    if not path:
        return {}
    try:
        with open(path, "r", encoding="utf-8") as fh:
            import yaml  # type: ignore

            return yaml.safe_load(fh) or {}
    except Exception:
        # If PyYAML is not available or file missing, fall back to empty config
        logger.warning("Could not load config %s; continuing with defaults (mock).", path)
        return {}


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="matrix-approval-bridge", description="Mock Matrix approval bridge CLI (dry-run)")
    parser.add_argument("--config", help="Path to YAML config (optional)")
    parser.add_argument("--dry-run", action="store_true", help="Run in dry-run/mock mode (default behavior)")
    parser.add_argument("--sample-task-file", help="Path to a JSON file containing a single approval request task")
    parser.add_argument("--mock-commands-file", help="Path to a file containing newline-separated mock Matrix commands")

    args = parser.parse_args(argv)
    cfg = load_config(args.config)
    bridge = MatrixBridge(cfg, dry_run=args.dry_run)

    # load sample task
    if not args.sample_task_file:
        logger.error("No --sample-task-file provided; nothing to do in smoke mode")
        return 2
    with open(args.sample_task_file, "r", encoding="utf-8") as fh:
        task = json.load(fh)

    mock_cmds = None
    if args.mock_commands_file:
        try:
            with open(args.mock_commands_file, "r", encoding="utf-8") as fh:
                mock_cmds = [ln.strip() for ln in fh if ln.strip()]
        except FileNotFoundError:
            mock_cmds = None

    resp = bridge.process_approval_request(task, mock_commands=mock_cmds)
    # Print a short summary to stdout for smoke scripts to inspect
    print(f"[BRIDGE] processed task={task.get('taskId')} decision={resp.decision}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
