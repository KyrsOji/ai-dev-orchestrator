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
import uuid
import re




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

    def post_message(self, content: str):
        """Post a message and return a fake send response including event_id."""
        evt = f"$mock{uuid.uuid4().hex}"
        print(f"[MATRIX-MOCK] room={self.room} user={self.user} message={content} event_id={evt}")
        return True, {"event_id": evt}, {}


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
                logger.info("MatrixBridge bot user id=%s", self._bot_user)
            except Exception:
                self._bot_user = None
        else:
            # Mock mode
            self.matrix = MatrixMock(room=self.matrix_room)
            self._bot_user = None
            logger.info("MatrixBridge running in mock mode for room=%s", self.matrix_room)


        # In-memory mappings to resolve reply-only approvals: approval_event_id -> taskId and vice-versa
        self._approval_event_to_task: Dict[str, str] = {}
        self._task_to_approval_event: Dict[str, str] = {}
        # Pending approvals per Matrix room. Each entry: {'taskId': str, 'timestamp': float, 'event_id': Optional[str]}
        self._pending_approvals: Dict[str, List[Dict[str, Any]]] = {}

        # Kafka client
        if kafka_client is not None:
            self.kafka = kafka_client
        else:
            self.kafka = KafkaClient(dry_run=dry_run)

    def post_task_summary(self, task: Dict[str, Any]) -> None:
        # Determine display identifier: prefer taskId, then suggestionId, then parentTaskId
        display_id = task.get("taskId") or task.get("suggestionId") or task.get("parentTaskId") or "unknown"
        summary = f"Task {display_id} - {task.get('title', '')}"
        # Log a short summary, do not print secrets
        logger.info("Posting task summary for task=%s display_id=%s to matrix room=%s", task.get("taskId"), display_id, self.matrix_room)
        self.matrix.post_message(summary)

    def post_approval_request(self, task: Dict[str, Any]) -> None:
        # Compute display id for compatibility and traceability
        display_id = task.get("taskId") or task.get("suggestionId") or task.get("parentTaskId") or "unknown"
        # Build metadata to include in the matrix message body
        metadata = dict(task.get("metadata", {}) or {})
        for k in ("suggestionId", "parentTaskId", "conversationId", "source"):
            v = task.get(k)
            if v is not None:
                metadata[k] = v
        body = (
            f"Approval request for task {display_id}: {task.get('title', '')} "
            f"metadata={json.dumps(metadata, ensure_ascii=False)}\n\n"
            "Quick mobile approval:\n"
            "Type:\n"
            "a = approve latest pending request\n"
            "d = deny latest pending request\n\n"
            "Safer explicit:\n"
            "a TASK_ID\n"
            "d TASK_ID"
        )
        logger.info("Posting approval request task=%s display_id=%s to matrix room=%s", task.get("taskId"), display_id, self.matrix_room)
        try:
            success, parsed, meta = self.matrix.post_message(body)
        except Exception:
            # Backwards compatibility: client may return (True, meta)
            parsed = None
            success = False
            meta = {}
        event_id = None
        if success and isinstance(parsed, dict):
            event_id = parsed.get("event_id")
            if event_id:
                try:
                    # Map approval event to the display id (preserve real taskId if present)
                    self._approval_event_to_task[event_id] = display_id
                    self._task_to_approval_event[display_id] = event_id
                    logger.info("Stored approval mapping event=%s -> task=%s", (event_id[-8:] if isinstance(event_id, str) else event_id), display_id)
                except Exception:
                    logger.exception("Failed to store approval event mapping")
        # Record pending approval for room-level shortcuts
        try:
            entry = {"taskId": display_id, "timestamp": time.time(), "event_id": event_id}
            pending = self._pending_approvals.get(self.matrix_room)
            if pending is None:
                self._pending_approvals[self.matrix_room] = [entry]
            else:
                pending.append(entry)
            logger.info("Added pending approval for task=%s room=%s pendingCount=%d", display_id, self.matrix_room, len(self._pending_approvals.get(self.matrix_room, [])))
        except Exception:
            logger.exception("Failed to record pending approval in memory")

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
        # Remove pending approvals for this task (if tracked) and clear cached mappings
        try:
            room_pending = self._pending_approvals.get(self.matrix_room, [])
            before = len(room_pending)
            room_pending = [e for e in room_pending if e.get("taskId") != resp.taskId]
            self._pending_approvals[self.matrix_room] = room_pending
            if before != len(room_pending):
                logger.info("Removed task=%s from pending approvals for room=%s", resp.taskId, self.matrix_room)
            # Remove cached approval event mapping if present
            event = self._task_to_approval_event.pop(resp.taskId, None)
            if event:
                self._approval_event_to_task.pop(event, None)
        except Exception:
            logger.exception("Failed to remove pending approval mapping")
        # Log a small subset of meta for debugging without exposing sensitive data
        try:
            safe_keys = ("topic", "partition", "offset", "used_cli", "used_python_client", "dry_run", "returnCode")
            safe_meta = {k: meta[k] for k in safe_keys if isinstance(meta, dict) and k in meta}
        except Exception:
            safe_meta = {}
        logger.info("Publish meta for task=%s: %s", resp.taskId, safe_meta)
        if isinstance(meta, dict) and 'returnCode' in meta:
            logger.info("Publish meta returnCode=%s", meta.get('returnCode'))

    def handle_command(self, cmd: str, task_id: Optional[str] = None, sender: Optional[str] = None) -> Optional[ApprovalResponse]:
        parts = cmd.strip().split()
        if not parts:
            return None
        verb = parts[0].lower()
        # Support short aliases 'a' => approve, 'd' => deny when followed by a task id
        if verb in ("approve", "a", "deny", "d", "status") and len(parts) >= 2:
            target = parts[1]
            if task_id and target != task_id:
                return None
            if verb in ("approve", "a"):
                resp = ApprovalResponse(taskId=target, decision="approved", approver=sender or "matrix-user")
                self.publish_response(resp)
                return resp
            if verb in ("deny", "d"):
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
            # Support structured widget events (ai.dev.taskboard.action) in addition to plain text m.room.message
            event_type = m.get("type") or m.get("event_type")
            # If this is a Taskboard action event, process it specially (do not require 'body')
            if event_type == "ai.dev.taskboard.action":
                # Extract content dict from event
                content = m.get("content") if isinstance(m.get("content"), dict) else None
                # If 'content' is not present, try parsing JSON from body
                if content is None:
                    try:
                        body_text = m.get("body", "")
                        if isinstance(body_text, str) and body_text.strip():
                            content = json.loads(body_text)
                    except Exception:
                        content = None
                # Validate required fields: taskId and decision, and source must be 'element-widget'
                if not content or not isinstance(content, dict):
                    logger.warning("Ignored invalid taskboard action event sender=%s reason=no_content_or_invalid_json", sender)
                    continue
                task_id = content.get("taskId")
                decision = content.get("decision")
                source = content.get("source")
                policy = content.get("policy")
                if not task_id or not decision or source != "element-widget":
                    logger.warning("Ignored invalid taskboard action event sender=%s reason=missing_or_invalid_fields taskId=%s decision=%s source=%s", sender, task_id, decision, source)
                    continue
                # Log the action capture
                logger.info("Taskboard action received taskId=%s decision=%s policy=%s sender=%s", task_id, decision, policy, sender)
                # Map widget event to review message and publish to Kafka
                review_msg = {
                    "taskId": task_id,
                    "decision": decision,
                    "policy": policy,
                    "reason": content.get("notes") or None,
                    "approver": sender or None,
                    "source": source,
                    "selectedAction": content.get("selectedAction") or None,
                    "editedAction": content.get("editedAction") or None,
                    "newAction": content.get("newAction") or None,
                    "createdAt": content.get("createdAt") or None,
                }
                try:
                    logger.info("Publishing taskboard action taskId=%s decision=%s policy=%s to %s", task_id, decision, policy, self.kafka_publish_topic)
                    success, meta = self.kafka.publish(self.kafka_publish_topic, review_msg)
                    logger.info("Publish meta for taskboard action taskId=%s: %s", task_id, meta)
                except Exception:
                    logger.exception("Failed to publish taskboard action for task=%s", task_id)
                # consume the event (do not return an ApprovalResponse here)
                continue
            # Fallback to legacy text body handling for m.room.message
            body = m.get("body", "")
            try:
                # Reply-only handling: if message is a reply to a known approval event and body is exactly 'a' or 'd'
                in_reply_to = None
                if isinstance(m.get("in_reply_to"), str):
                    in_reply_to = m.get("in_reply_to")
                else:
                    relates = m.get("relates_to")
                    if isinstance(relates, dict):
                        in_reply = relates.get("m.in_reply_to")
                        if isinstance(in_reply, dict):
                            in_reply_to = in_reply.get("event_id")
                        else:
                            # support alternative rel_type/event_id shape
                            rel_type = relates.get("rel_type")
                            if rel_type == "m.in_reply_to" and isinstance(relates.get("event_id"), str):
                                in_reply_to = relates.get("event_id")
                body_stripped = body.strip().lower() if isinstance(body, str) else ""

                # 1) Reply-only: resolve from referenced approval event when possible
                if in_reply_to and body_stripped in ("a", "d"):
                    resolved_task = self._approval_event_to_task.get(in_reply_to)
                    # If we already have a mapping, log the resolution
                    if resolved_task:
                        logger.info("Resolved reply event_id=%s taskId=%s", in_reply_to, resolved_task)
                    # fallback: fetch the referenced event and try to parse a taskId from its body
                    if not resolved_task:
                        try:
                            event_json = self.matrix.get_event(in_reply_to)
                            if event_json and isinstance(event_json, dict):
                                content = event_json.get("content", {}) or {}
                                orig_body = content.get("body", "") or ""
                                mobj = re.search(r"task\\s+([A-Za-z0-9\\-_]+)", orig_body, flags=re.I)
                                if mobj:
                                    resolved_task = mobj.group(1)
                                    # cache mapping for future replies
                                    self._approval_event_to_task[in_reply_to] = resolved_task
                                    self._task_to_approval_event[resolved_task] = in_reply_to
                                    logger.info("Resolved task=%s from referenced event=%s", resolved_task, (in_reply_to[-8:] if isinstance(in_reply_to, str) else in_reply_to))
                                    logger.info("Resolved reply event_id=%s taskId=%s", in_reply_to, resolved_task)
                        except Exception:
                            logger.exception("Failed to fetch referenced Matrix event for reply-only processing")
                    if resolved_task:
                        decision = "approved" if body_stripped == "a" else "denied"
                        resp = ApprovalResponse(taskId=resolved_task, decision=decision, approver=sender or "matrix-user")
                        # publish the decision
                        self.publish_response(resp)
                        # safe logs: include reply event id truncated and referenced event id truncated
                        def _short(e):
                            return (e[-8:] if isinstance(e, str) and len(e) > 8 else e)
                        logger.info("Reply event=%s referenced=%s resolved_task=%s decision=%s sender=%s", _short(m.get("event_id")), _short(in_reply_to), resolved_task, decision, sender)
                        logger.info("Processed command from %s for task=%s decision=%s", sender, resolved_task, decision)
                        return resp

                # 2) Room-level shortcut fallback: if body is exactly 'a' or 'd' and no explicit task id and no reply metadata
                parts = body.strip().split()
                if (not in_reply_to) and len(parts) == 1 and body_stripped in ("a", "d"):
                    room = self.matrix_room
                    pending = self._pending_approvals.get(room, [])
                    if not pending:
                        logger.info("No pending approval found for room-level shortcut")
                    else:
                        # choose the newest pending approval (by timestamp)
                        pending_count = len(pending)
                        chosen = max(pending, key=lambda e: e.get("timestamp", 0))
                        task_to_resolve = chosen.get("taskId")
                        # remove chosen from pending list
                        try:
                            self._pending_approvals[room] = [e for e in pending if e.get("taskId") != task_to_resolve]
                        except Exception:
                            logger.exception("Failed to remove pending entry for task %s", task_to_resolve)
                        logger.info("Resolved room shortcut body=%s taskId=%s pendingCount=%s", body_stripped, task_to_resolve, pending_count)
                        decision = "approved" if body_stripped == "a" else "denied"
                        resp = ApprovalResponse(taskId=task_to_resolve, decision=decision, approver=sender or "matrix-user")
                        # publish the decision
                        self.publish_response(resp)
                        logger.info("Processed command from %s for task=%s decision=%s", sender, task_to_resolve, decision)
                        return resp

                # 3) Fallback to standard command handling (explicit 'a TASK_ID' etc.)
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
            logger.info("Entering Matrix wait loop for task=%s room=%s wait_seconds=%s deadline=%s", task.get('taskId'), self.matrix_room, int(wait_seconds), time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(deadline)))
            poll_attempt = 0
            while time.time() < deadline:
                poll_attempt += 1
                try:
                    logger.info("Matrix poll attempt=%d since_token_present=%s timeout_s=%s", poll_attempt, bool(getattr(self.matrix, '_last_batch', None)), 2)
                    ignore_last = (poll_attempt == 1)
                    msgs, meta = self.matrix.poll_commands(timeout_s=2, ignore_last_batch=ignore_last)
                    meta_status = None
                    try:
                        if isinstance(meta, dict):
                            meta_status = meta.get('status_code')
                    except Exception:
                        meta_status = None
                    if not msgs:
                        logger.info("Matrix poll attempt=%d returned 0 messages; meta.status=%s", poll_attempt, meta_status)
                    else:
                        logger.info("Matrix poll attempt=%d returned %d message(s); meta.status=%s", poll_attempt, len(msgs), meta_status)
                        for m in msgs:
                            try:
                                sender = m.get('sender')
                                body = m.get('body', '')
                                if not isinstance(body, str):
                                    continue
                                verb = body.strip().split()[0].lower() if body.strip() else ''
                                if verb in ("approve", "a", "deny", "d", "status", "auto-approve", "require-approval"):
                                    logger.info("Matrix potential command from=%s body=%s", sender, body[:500])
                            except Exception:
                                logger.exception("Error reading message for diagnostics")
                        res = self._process_incoming_matrix_messages(msgs, task_id=task.get("taskId"))
                        if res:
                            return res
                except Exception:
                    logger.exception("Error while polling Matrix commands")
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
    parser.add_argument("--consume-from-beginning", action="store_true", help="When running as daemon, consume from beginning (smoke/testing)")
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

        # Persistent consumer loop
        topic = bridge.kafka_consume_topic
        logger.info("Starting daemon to consume topic=%s", topic)
        try:
            while True:
                try:
                    from_beginning = bool(getattr(args, 'consume_from_beginning', False))
                    logger.info("Starting persistent consumer for topic=%s (from_beginning=%s)", topic, from_beginning)
                    # iterate over messages; listen() will restart CLI consumer on failure
                    for msg, meta in kafka.listen(topic=topic, group="ai-dev-matrix-bridge-group", from_beginning=from_beginning):
                        try:
                            if msg is None:
                                continue
                            # Log safe fields from the message (taskId)
                            task_id = msg.get('taskId') if isinstance(msg, dict) else None
                            logger.info("Received message from topic=%s taskId=%s; processing...", topic, task_id)
                            resp = bridge.process_approval_request(msg, wait_seconds=args.wait_seconds)
                            # Print a short summary to stdout for scripts to inspect
                            print(f"[BRIDGE] processed task={msg.get('taskId')} decision={resp.decision}")
                        except Exception:
                            logger.exception("Failed to process approval request")
                    # listen returned (consumer died); restart after a short backoff
                    logger.warning("Persistent consumer stopped unexpectedly; will restart after backoff")
                    time.sleep(2)
                    continue
                except SystemExit:
                    raise
                except Exception:
                    logger.exception("Error in persistent consumer; will retry after backoff")
                    time.sleep(5)
                    continue
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
