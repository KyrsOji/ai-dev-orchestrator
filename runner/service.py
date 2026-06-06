"""Continuous OFBiz runner service (dry-run only).

Starts a loop that consumes tasks from the ai.dev.task.ofbiz topic one at a
time, prepares a run directory, publishes a dry-run result, and continues.

This module intentionally uses the kafka-console-consumer/producer CLI when
KAFKA_FORCE_CLI=1 (the systemd unit will set this). The code is defensive and
logs important lifecycle events.

Usage:
  python3 -m runner.service
"""

from __future__ import annotations

import json
import logging
import os
import signal
import subprocess
import sys
import time
import uuid
from datetime import datetime
from typing import Any, Dict, Optional, Tuple

from . import run_directory
from . import result_publisher


# Configuration
TASK_TOPIC = os.environ.get("TASK_TOPIC", "ai.dev.task.ofbiz")
RESULT_TOPIC = os.environ.get("RESULT_TOPIC", "ai.dev.result.out")
CONSUMER_GROUP = os.environ.get("CONSUMER_GROUP", "ai-dev-runner-ofbiz-group")
KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "kafka.yahlife.com:9095")
KAFKA_CLIENT_CONFIG = os.environ.get("KAFKA_CLIENT_CONFIG")
KAFKA_FORCE_CLI = os.environ.get("KAFKA_FORCE_CLI", "1")

# Logging path (repo-root/logs/ofbiz-runner.log)
REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
LOG_DIR = os.path.join(REPO_ROOT, "logs")
LOG_PATH = os.path.join(LOG_DIR, "ofbiz-runner.log")

# Control flag for graceful shutdown
_running = True


def _iso_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _setup_logging() -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    # Basic file logging; also write a short message to stdout so systemd/users
    # see immediate feedback when starting manually.
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(LOG_PATH, encoding="utf-8"),
            logging.StreamHandler(sys.stdout),
        ],
    )


def _find_consumer_cli() -> Optional[str]:
    import shutil

    for name in ("kafka-console-consumer.sh", "kafka-console-consumer"):
        path = shutil.which(name)
        if path:
            return path
    return None


def _parse_first_json_from_text(text: str) -> Optional[Dict[str, Any]]:
    # Try line-by-line JSON parsing first
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except Exception:
            continue
    # Fallback: try to find a {...} substring
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1 and end > start:
        snippet = text[start : end + 1]
        try:
            return json.loads(snippet)
        except Exception:
            return None
    return None


def _consume_one_task_cli(topic: str, timeout_ms: int = 10000) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """Consume a single message using the kafka-console-consumer CLI and return parsed JSON.

    Returns (task_json_or_None, metadata).
    """
    if KAFKA_FORCE_CLI != "1":
        return None, {"error": "kafka_force_cli_not_set", "detail": "Set KAFKA_FORCE_CLI=1 to enable CLI consumption"}

    consumer = _find_consumer_cli()
    if not consumer:
        return None, {"error": "kafka_consumer_cli_missing", "detail": "kafka-console-consumer not found in PATH"}

    cmd = [
        consumer,
        "--bootstrap-server",
        KAFKA_BOOTSTRAP,
        "--topic",
        topic,
        "--max-messages",
        "1",
        "--timeout-ms",
        str(timeout_ms),
        "--group",
        CONSUMER_GROUP,
    ]
    if KAFKA_CLIENT_CONFIG:
        cmd.extend(["--consumer.config", KAFKA_CLIENT_CONFIG])

    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=(timeout_ms / 1000.0 + 5))
    except Exception as e:
        return None, {"error": "kafka_cli_execution_failed", "detail": str(e), "cmd": cmd}

    stdout = proc.stdout or ""
    stderr = proc.stderr or ""

    if proc.returncode != 0 and not stdout:
        return None, {"error": "kafka_cli_nonzero_exit", "rc": proc.returncode, "stderr": stderr.strip(), "cmd": cmd}

    parsed = _parse_first_json_from_text(stdout)
    if not parsed:
        return None, {"error": "json_parse_error", "raw_stdout": stdout.strip(), "stderr": stderr.strip(), "cmd": cmd}

    return parsed, {"used_cli": True, "cmd": cmd}


def build_result_message(task: Dict[str, Any], run_dir: Optional[str], *, status: str = "dry_run_completed", summary: str = "") -> Dict[str, Any]:
    result = {
        "resultId": str(uuid.uuid4()),
        "taskId": task.get("taskId"),
        "objectiveId": task.get("objectiveId"),
        "targetSystem": "ofbiz",
        "status": status,
        "summary": summary or ("Task consumed and run directory prepared." if status == "dry_run_completed" else "Task processing failed."),
        "runDirectory": run_dir,
        "createdAt": _iso_now(),
    }
    return result


def _shutdown(signum: int, frame: object) -> None:
    global _running
    logging.info("Shutdown signal received: %s", signum)
    _running = False


def main() -> int:
    _setup_logging()

    logging.info("Starting OFBiz continuous runner service (dry-run only)")
    logging.info("Task topic=%s Result topic=%s Consumer group=%s", TASK_TOPIC, RESULT_TOPIC, CONSUMER_GROUP)

    # Install signal handlers
    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # Main loop
    try:
        while _running:
            try:
                task, meta = _consume_one_task_cli(TASK_TOPIC, timeout_ms=10000)
            except Exception as e:  # Defensive: any unexpected exception should not crash the service
                logging.exception("Unexpected error while attempting to consume task: %s", e)
                time.sleep(2)
                continue

            if task is None:
                # No task received; meta explains why (timeout, parse error, etc.)
                logging.debug("No task consumed: %s", meta)
                time.sleep(1)
                continue

            task_id = task.get("taskId") or task.get("id")
            logging.info("Task received: %s", task_id)

            run_dir = None
            try:
                # Step 1: Prepare run directory
                rd_meta = run_directory.prepare_run_directory(task)
                run_dir = rd_meta.get("runDirectory")
                logging.info("Run directory created: %s", run_dir)

                # Step 2: Dry-run: do not invoke OpenHands; create placeholder dispatch (already handled by run_directory)
                # Step 3: Build and publish result
                result_msg = build_result_message(task, run_dir, status="dry_run_completed")

                success, pub_meta = result_publisher.publish_result(result_msg, topic=RESULT_TOPIC)
                if success:
                    logging.info("Result published successfully for task %s", task_id)
                else:
                    logging.error("Failed to publish result for task %s: %s", task_id, pub_meta)

            except Exception as e:
                # On any failure, publish a failed result and continue
                logging.exception("Error processing task %s: %s", task_id, e)
                summary = str(e)
                if len(summary) > 1000:
                    summary = summary[:1000] + "..."
                failed_result = build_result_message(task, run_dir, status="failed", summary=summary)
                try:
                    success, pub_meta = result_publisher.publish_result(failed_result, topic=RESULT_TOPIC)
                    if success:
                        logging.info("Published failure result for task %s", task_id)
                    else:
                        logging.error("Failed to publish failure result for task %s: %s", task_id, pub_meta)
                except Exception:
                    logging.exception("Exception while attempting to publish failure result for task %s", task_id)

            # Continue to next message
            time.sleep(0.2)

    finally:
        # As we invoke the console consumer per-message there is no long-lived consumer
        logging.info("Shutting down OFBiz continuous runner service")

    return 0


if __name__ == "__main__":
    sys.exit(main())
