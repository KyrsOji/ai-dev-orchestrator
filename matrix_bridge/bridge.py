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
import time


from matrix_bridge.kafka_client import KafkaClient

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


# Real Matrix integration
try:
    from matrix_bridge.matrix_client import MatrixClient
except Exception:
    MatrixClient = None  # type: ignore


class MatrixBridge:
    """Bridge logic for approval requests and responses. Supports mock and real Matrix clients."""

    def __init__(self, config: Optional[Dict[str, Any]] = None, dry_run: bool = True, kafka_client: Optional[KafkaClient] = None) -> None:
        self.config = config or {}
        self.dry_run = dry_run
        # Topics - do NOT change defaults (must match orchestrator mappings)
        self.kafka_consume_topic = self.config.get("kafka_consume_topic", "ai.dev.approval.required")
        self.kafka_publish_topic = self.config.get("kafka_publish_topic", "ai.dev.review.out")

        # Matrix config can be provided in config file or via environment
        env_mode = os.environ.get("MATRIX_MODE")
        cfg_mode = self.config.get("matrix_mode")
        self.matrix_mode = (env_mode or cfg_mode or "mock").lower()

        self.matrix_room = self.config.get("matrix_room") or os.environ.get("MATRIX_ROOM_ID") or "!approvals:example"

        # Initialize Matrix client depending on mode
        if self.matrix_mode == "real":
            homeserver = self.config.get("matrix_homeserver") or os.environ.get("MATRIX_HOMESERVER_URL")
            token = self.config.get("matrix_access_token") or os.environ.get("MATRIX_ACCESS_TOKEN")
            if not homeserver or not token or not self.matrix_room:
                # Fail-closed: required configuration missing for real mode
                raise RuntimeError("MATRIX_MODE=real requires MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN and MATRIX_ROOM_ID to be set")
            if MatrixClient is None:
                raise RuntimeError("MatrixClient implementation not available; install dependencies or enable matrix_bridge.matrix_client")
            # Create Matrix client (do not log the token)
            self.matrix = MatrixClient(homeserver, token, self.matrix_room)
            # Try to determine our own user id for message filtering
            try:
                self._bot_user = self.matrix.whoami()
                logger.info("MatrixBridge running in real mode for room=%s", self.matrix_room)
            except Exception:
                self._bot_user = None
        else:
            # Mock mode
            self.matrix = MatrixMock(room=self.matrix_room)
            self._bot_user = None
            logger.info("MatrixBridge running in mock mode for room=%s", self.matrix_room)

        # Kafka client
        if kafka_client is not None:
            self.kafka = kafka_client
        else:
            self.kafka = KafkaClient(dry_run=dry_run)

    def post_task_summary(self, task: Dict[str, Any]) -> None:
        summary = f"Task {task.get('taskId')} - {task.get('title', '')}"
        # Log a short summary, do not print secrets
        logger.info("Posting task summary for task=%s to matrix room=%s", task.get("taskId"), self.matrix_room)
        self.matrix.post_message(summary)

    def post_approval_request(self, task: Dict[str, Any]) -> None:
        body = (
            f"Approval request for task {task.get('taskId')}: {task.get('title', '')} "
            f"metadata={task.get('metadata', {})}"
        )
        logger.info("Posting approval request task=%s to matrix room=%s", task.get("taskId"), self.matrix_room)
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
        # Log topic, task id and decision (do not log any secrets)
        logger.info("Publishing decision for task=%s decision=%s to topic=%s", resp.taskId, resp.decision, self.kafka_publish_topic)
        success, meta = self.kafka.publish(self.kafka_publish_topic, payload)
        # Log a small subset of meta for debugging without exposing sensitive data
        try:
            safe_keys = ("topic", "partition", "offset", "used_cli", "used_python_client", "dry_run", "returnCode")
            safe_meta = {k: meta[k] for k in safe_keys if isinstance(meta, dict) and k in meta}
        except Exception:
            safe_meta = {}
        logger.info("Publish meta for task=%s: %s", resp.taskId, safe_meta)

    def handle_command(self, cmd: str, task_id: Optional[str] = None, sender: Optional[str] = None) -> Optional[ApprovalResponse]:
        parts = cmd.strip().split()
        if not parts:
            return None
        verb = parts[0].lower()
        if verb in ("approve", "deny", "status") and len(parts) >= 2:
            target = parts[1]
            if task_id and target != task_id:
                return None
            if verb == "approve":
                resp = ApprovalResponse(taskId=target, decision="approved", approver=sender or "matrix-user")
                self.publish_response(resp)
                return resp
            if verb == "deny":
                resp = ApprovalResponse(taskId=target, decision="denied", approver=sender or "matrix-user")
                self.publish_response(resp)
                return resp
            if verb == "status":
                # For real mode, we post a status message back to the room
                self.matrix.post_message(f"Status for {target}: pending")
                return None
        if verb in ("auto-approve", "require-approval") and len(parts) >= 2:
            policy = parts[1].lower()
            self.matrix.post_message(f"Policy change request: {verb} {policy}")
            return None
        return None

    def _process_incoming_matrix_messages(self, msgs: List[Dict[str, Any]], task_id: Optional[str] = None) -> Optional[ApprovalResponse]:
        # Iterate messages and handle commands. Ignore messages sent by the bot itself.
        for m in msgs:
            sender = m.get("sender")
            body = m.get("body", "")
            # Ignore empty
            if not body:
                continue
            if self._bot_user and sender == self._bot_user:
                # ignore our own messages
                continue
            try:
                res = self.handle_command(body, task_id=task_id, sender=sender)
                if isinstance(res, ApprovalResponse):
                    logger.info("Processed command from %s for task=%s decision=%s", sender, res.taskId, res.decision)
                    return res
            except Exception:
                logger.exception("Failed to handle matrix command")
        return None

    def process_approval_request(self, task: Dict[str, Any], mock_commands: Optional[List[str]] = None, wait_seconds: int = 30) -> ApprovalResponse:
        """Process a single approval request. In real mode this will post to Matrix and
        poll for a command for up to wait_seconds before returning a pending decision.
        """
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

        # If mock commands are supplied (mock mode), process them immediately
        if mock_commands:
            for c in mock_commands:
                res = self.handle_command(c, task_id=task.get("taskId"))
                if isinstance(res, ApprovalResponse):
                    return res
            return evaluated

        # If running in real mode, poll Matrix for commands for wait_seconds
        if self.matrix_mode == "real":
            start = time.time()
            deadline = start + max(0, int(wait_seconds))
            while time.time() < deadline:
                msgs, meta = self.matrix.poll_commands(timeout_s=2)
                if msgs:
                    res = self._process_incoming_matrix_messages(msgs, task_id=task.get("taskId"))
                    if res:
                        return res
                # small sleep to avoid busy loop
                time.sleep(1)
            # timeout - return pending
            return evaluated

        # default (mock) returns evaluated pending
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
    parser = argparse.ArgumentParser(prog="matrix-approval-bridge", description="Matrix approval bridge CLI")
    parser.add_argument("--config", help="Path to YAML config (optional)")
    parser.add_argument("--dry-run", action="store_true", help="Run in dry-run/mock mode (default behavior)")
    parser.add_argument("--matrix-mode", choices=("mock", "real"), help="Override matrix mode (mock or real)")
    parser.add_argument("--sample-task-file", help="Path to a JSON file containing a single approval request task")
    parser.add_argument("--mock-commands-file", help="Path to a file containing newline-separated mock Matrix commands")
    parser.add_argument("--consume-topic", help="Consume a single message from a Kafka topic and process it")
    parser.add_argument("--daemon", action="store_true", help="Run as long-running daemon consuming approvals")
    parser.add_argument("--timeout", type=int, default=10, help="Timeout seconds for Kafka consume")
    parser.add_argument("--wait-seconds", type=int, default=30, help="Seconds to wait for a Matrix command in real mode")

    args = parser.parse_args(argv)
    cfg = load_config(args.config)

    if args.sample_task_file and args.consume_topic:
        parser.error("Specify only one of --sample-task-file or --consume-topic")

    # Respect CLI override for matrix mode
    if args.matrix_mode:
        cfg["matrix_mode"] = args.matrix_mode

    # If running as a daemon, subscribe continuously and process messages
    if args.daemon:
        kafka = KafkaClient(dry_run=args.dry_run)
        bridge = MatrixBridge(cfg, dry_run=args.dry_run, kafka_client=kafka)
        # Install simple signal handlers for graceful shutdown
        import signal, sys

        signal.signal(signal.SIGINT, lambda *a: sys.exit(0))
        signal.signal(signal.SIGTERM, lambda *a: sys.exit(0))

        # Poll loop
        topic = bridge.kafka_consume_topic
        logger.info("Starting daemon to consume topic=%s", topic)
        try:
            while True:
                try:
                    logger.info("Attempting to consume one message from topic=%s (timeout=%s, from_beginning=%s)", topic, max(1, args.timeout), False)
                    msg, meta = kafka.consume_one(topic=topic, timeout_s=max(1, args.timeout), from_beginning=False)
                except SystemExit:
                    raise
                except Exception:
                    logger.exception("Error while consuming message; will retry after backoff")
                    time.sleep(5)
                    continue

                if msg is None:
                    # no message within timeout
                    logger.info("No message received from consume_one; meta=%s", meta)
                    # If available, show the CLI command used for diagnosis (do not print credentials)
                    if isinstance(meta, dict) and meta.get('cmd'):
                        try:
                            cmd = meta.get('cmd')
                            if isinstance(cmd, list):
                                logger.info("Consumer CLI command: %s", " ".join(cmd))
                            else:
                                logger.info("Consumer CLI command: %s", str(cmd))
                        except Exception:
                            pass
                    # Brief sleep to avoid busy looping
                    time.sleep(0.1)
                    continue

                try:
                    # Log safe fields from the message (taskId)
                    task_id = msg.get('taskId') if isinstance(msg, dict) else None
                    logger.info("Received message from topic=%s taskId=%s; processing...", topic, task_id)
                    resp = bridge.process_approval_request(msg, wait_seconds=args.wait_seconds)
                    # Print a short summary to stdout for scripts to inspect
                    print(f"[BRIDGE] processed task={msg.get('taskId')} decision={resp.decision}")
                except Exception:
                    logger.exception("Failed to process approval request")
        except SystemExit:
            logger.info("Daemon exiting on signal")
            return 0

    # If consuming from Kafka once
    if args.consume_topic:
        kafka = KafkaClient(dry_run=args.dry_run)
        msg, meta = kafka.consume_one(topic=args.consume_topic, timeout_s=args.timeout, from_beginning=True)
        if msg is None:
            print(json.dumps({"error": "no_message", "meta": meta}))
            return 2
        bridge = MatrixBridge(cfg, dry_run=args.dry_run, kafka_client=kafka)

        mock_cmds = None
        if args.mock_commands_file:
            try:
                with open(args.mock_commands_file, "r", encoding="utf-8") as fh:
                    mock_cmds = [ln.strip() for ln in fh if ln.strip()]
            except FileNotFoundError:
                mock_cmds = None

        resp = bridge.process_approval_request(msg, mock_commands=mock_cmds, wait_seconds=args.wait_seconds)
        print(f"[BRIDGE] processed task={msg.get('taskId')} decision={resp.decision}")
        return 0

    # Process a local sample file (previous behavior)
    bridge = MatrixBridge(cfg, dry_run=args.dry_run)

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

    resp = bridge.process_approval_request(task, mock_commands=mock_cmds, wait_seconds=args.wait_seconds)
    # Print a short summary to stdout for smoke scripts to inspect
    print(f"[BRIDGE] processed task={task.get('taskId')} decision={resp.decision}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
