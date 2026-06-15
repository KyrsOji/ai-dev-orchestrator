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
from typing import Any, Dict, Optional, Tuple, Callable

from . import run_directory
from . import result_publisher
from . import openhands_executor
from . import execution_guard
from matrix_bridge.kafka_client import KafkaClient


# Configuration
TASK_TOPIC = os.environ.get("TASK_TOPIC", "ai.dev.task.ofbiz")
RESULT_TOPIC = os.environ.get("RESULT_TOPIC", "ai.dev.result.out")
CONSUMER_GROUP = os.environ.get("CONSUMER_GROUP", "ai-dev-runner-ofbiz-group")
KAFKA_BOOTSTRAP = os.environ.get("KAFKA_BOOTSTRAP", "kafka.yahlife.com:9095")
KAFKA_CLIENT_CONFIG = os.environ.get("KAFKA_CLIENT_CONFIG")
KAFKA_FORCE_CLI = os.environ.get("KAFKA_FORCE_CLI", "1")

# Runner mode controls whether the service attempts execution
# 'dry-run' (default) or 'execute'
RUNNER_MODE = os.environ.get("RUNNER_MODE", "dry-run")
# OpenHands adapter mode: the executor itself also checks this variable
OPENHANDS_MODE = os.environ.get("OPENHANDS_MODE", "dry-run")
try:
    OPENHANDS_TIMEOUT_SECONDS = int(os.environ.get("OPENHANDS_TIMEOUT_SECONDS", "1800"))
except Exception:
    OPENHANDS_TIMEOUT_SECONDS = 1800

# Logging path (default repo-root/logs/ofbiz-runner.log) - can be overridden with RUNNER_LOG_DIR
REPO_ROOT = os.path.dirname(os.path.dirname(__file__))
RUNNER_LOG_DIR = os.environ.get("RUNNER_LOG_DIR", "")
if RUNNER_LOG_DIR:
    LOG_DIR = RUNNER_LOG_DIR
else:
    LOG_DIR = os.path.join(REPO_ROOT, "logs")
LOG_PATH = os.path.join(LOG_DIR, "ofbiz-runner.log")

# Control flag for graceful shutdown
_running = True


def _iso_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _setup_logging() -> None:
    # Attempt to create the log directory; if this fails, fall back to stdout-only logging
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
    except Exception as e:
        # Cannot create the log directory (e.g. read-only FS). Fall back to stream-only logging.
        print(f"[warning] Could not create log directory {LOG_DIR}: {e}", file=sys.stderr)
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s %(message)s",
            handlers=[logging.StreamHandler(sys.stdout)],
        )
        return

    handlers = []
    # Try to add a file handler; if that fails, keep stream-only handler
    try:
        fh = logging.FileHandler(LOG_PATH, encoding="utf-8")
        handlers.append(fh)
    except Exception as e:
        print(f"[warning] Could not open log file {LOG_PATH}: {e}", file=sys.stderr)

    handlers.append(logging.StreamHandler(sys.stdout))

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=handlers,
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
    # Read KAFKA_CLIENT_CONFIG at runtime to pick up environment changes
    client_config = os.environ.get("KAFKA_CLIENT_CONFIG")
    if client_config:
        cmd.extend(["--consumer.config", client_config])

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



def process_task(task: Dict[str, Any], publisher: Optional[Callable[[Dict[str, Any], str], Tuple[bool, Dict[str, Any]]]] = None, db_path: Optional[str] = None) -> Dict[str, Any]:
    """Process a single task payload. Returns a dict describing outcome.

    publisher: callable(result_dict, topic) -> (success: bool, meta: dict)
    """
    # Local import to avoid top-level dependency ordering issues in tests
    try:
        from .dedup import init_db, get_task_status, upsert_processed_task, is_terminal_status
    except Exception:
        # If dedup module missing, behave without persistence
        init_db = lambda *a, **k: None
        get_task_status = lambda *a, **k: None
        upsert_processed_task = lambda *a, **k: False
        is_terminal_status = lambda s: False

    if publisher is None:
        publisher = result_publisher.publish_result

    # Ensure DB initialized (no-op if already present)
    try:
        init_db(db_path)
    except Exception:
        logging.exception("Could not initialize dedup DB; continuing without persistence")

    task_id = task.get("taskId") or task.get("id")
    if not task_id:
        logging.error("Received task payload missing taskId: %s", task)
        return {"error": "missing_task_id"}

    # Check for duplicates
    try:
        existing_status = get_task_status(task_id, db_path)
    except Exception:
        existing_status = None

    if existing_status and is_terminal_status(existing_status):
        logging.info("Duplicate task detected: %s", task_id)
        logging.info("Skipping previously completed task")
        return {"skipped": True, "task_id": task_id, "status": existing_status}

    run_dir = None
    try:
        # Prepare run directory
        rd_meta = run_directory.prepare_run_directory(task)
        run_dir = rd_meta.get("runDirectory")
        logging.info("Run directory created: %s", run_dir)

        # Build result message (dry-run by default)
        execution_mode = RUNNER_MODE
        if execution_mode == "execute":
            logging.info("OpenHands execution mode: execute (timeout=%s seconds)", OPENHANDS_TIMEOUT_SECONDS)
            allowed, guard_meta = execution_guard.guard_execution(task, run_dir)
            if not allowed:
                reason = guard_meta.get("reason", "blocked_by_execution_guard")
                logging.error("Execution guard blocked execution: %s", reason)
                result_msg = build_result_message(task, run_dir, status="failed", summary=f"Execution blocked by guard: {reason}")
            else:
                exec_meta = openhands_executor.execute_task(run_dir, task)
                exec_status = exec_meta.get("status")
                if exec_status in ("completed", "executed"):
                    status = "executed"
                elif exec_status in ("failed", "error", "timeout"):
                    status = "failed"
                else:
                    status = exec_status or "failed"
                summary = exec_meta.get("summary", "") or exec_meta.get("stdout", "")[:1000]
                result_msg = build_result_message(task, run_dir, status=status, summary=summary)
        else:
            logging.info("OpenHands execution mode: dry-run; skipping execution")
            result_msg = build_result_message(task, run_dir, status="dry_run_completed")

        # Publish result
        try:
            success, pub_meta = publisher(result_msg, topic=RESULT_TOPIC)
        except TypeError:
            # Some publisher implementations may not accept topic kwarg
            success, pub_meta = publisher(result_msg, RESULT_TOPIC)

        if success:
            logging.info("Result published successfully for task %s", task_id)
            # Record in dedup DB only for terminal statuses
            if is_terminal_status(result_msg.get("status")):
                try:
                    ok = upsert_processed_task(task_id, result_msg.get("status"), result_msg.get("resultId"), db_path)
                    if ok:
                        logging.info("Recorded completed task: %s", task_id)
                except Exception:
                    logging.exception("Failed to record processed task %s", task_id)
        else:
            logging.error("Failed to publish result for task %s: %s", task_id, pub_meta)

        return {"processed": True, "published": success, "pub_meta": pub_meta, "result_id": result_msg.get("resultId")}

    except Exception as e:
        logging.exception("Error processing task %s: %s", task_id, e)
        return {"processed": False, "error": str(e)}



def main() -> int:
    _setup_logging()

    logging.info("Starting OFBiz continuous runner service (dry-run only)")
    logging.info("Starting OFBiz continuous runner service (RUNNER_MODE=%s OPENHANDS_MODE=%s)", RUNNER_MODE, OPENHANDS_MODE)
    logging.info("Task topic=%s Result topic=%s Consumer group=%s", TASK_TOPIC, RESULT_TOPIC, CONSUMER_GROUP)

    # Install signal handlers
    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    # Initialize Kafka client for persistent consumption
    try:
        client = KafkaClient(dry_run=(RUNNER_MODE == "dry-run"))
    except Exception:
        logging.exception("Failed to initialize Kafka client")
        return 1

    logging.info("Starting persistent Kafka consumer for topic=%s group=%s", TASK_TOPIC, CONSUMER_GROUP)

    # Use the KafkaClient.listen generator to receive messages continuously
    try:
        gen = client.listen(topic=TASK_TOPIC, group=CONSUMER_GROUP)
    except Exception:
        logging.exception("Failed to start Kafka consumer generator")
        return 1

    try:
        logging.info("Consumer connected")
        for payload, meta in gen:
            if not _running:
                break

            # 'payload' is expected to be a dict representing the task
            if not payload:
                logging.debug("Received empty payload: %s", meta)
                continue

            task = payload
            task_id = task.get("taskId") or task.get("id")
            logging.info("Task received: %s", task_id)

            try:
                res = process_task(task)
                if res.get("skipped"):
                    continue
                if res.get("processed"):
                    if res.get("published"):
                        logging.info("Result published successfully for task %s", task_id)
                    else:
                        logging.error("Failed to publish result for task %s: %s", task_id, res.get("pub_meta"))
                else:
                    logging.error("Processing returned error for task %s: %s", task_id, res.get("error"))
            except Exception as e:
                logging.exception("Unexpected error while handling task %s: %s", task_id, e)

    except Exception as e:
        logging.exception("Unexpected error in consumer loop: %s", e)
    finally:
        logging.info("Shutting down OFBiz continuous runner service")

    return 0


if __name__ == "__main__":
    sys.exit(main())
