"""Consume a single OFBiz task from Kafka (prefers CLI when requested).

This module will attempt to use the kafka-console-consumer.sh CLI when
KAFKA_FORCE_CLI=1. If the CLI is missing or KAFKA_FORCE_CLI!=1, the
function will return (None, metadata) describing the failure so the
caller can report it instead of faking a success.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from typing import Any, Dict, Optional, Tuple


def _find_consumer_cli() -> Optional[str]:
    # Try both common names
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


def consume_one_task(
    topic: str = "ai.dev.task.ofbiz",
    from_beginning: bool = False,
    timeout_ms: int = 10000,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
    """Consume exactly one task message from Kafka and return parsed JSON.

    Returns (task_json, metadata). If task_json is None, metadata explains why.
    """
    use_cli = os.environ.get("KAFKA_FORCE_CLI", "0") == "1"
    kafka_bootstrap = os.environ.get("KAFKA_BOOTSTRAP", "kafka.yahlife.com:9095")
    kafka_client_config = os.environ.get("KAFKA_CLIENT_CONFIG")

    if use_cli:
        consumer = _find_consumer_cli()
        if not consumer:
            return None, {"error": "kafka_cli_missing", "detail": "kafka-console-consumer not found in PATH"}

        cmd = [
            consumer,
            "--bootstrap-server",
            kafka_bootstrap,
            "--topic",
            topic,
            "--max-messages",
            "1",
            "--timeout-ms",
            str(timeout_ms),
        ]
        if from_beginning:
            cmd.extend(["--from-beginning", "--group", "ai-dev-runner-ofbiz-group"])
        if kafka_client_config:
            cmd.extend(["--consumer.config", kafka_client_config])

        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=(timeout_ms / 1000.0 + 5))
        except Exception as e:
            return None, {"error": "kafka_cli_execution_failed", "detail": str(e), "cmd": cmd}

        stdout = proc.stdout or ""
        stderr = proc.stderr or ""

        if proc.returncode != 0 and not stdout:
            return None, {
                "error": "kafka_cli_nonzero_exit",
                "rc": proc.returncode,
                "stderr": stderr.strip(),
                "cmd": cmd,
            }

        # Parse JSON
        parsed = _parse_first_json_from_text(stdout)
        if not parsed:
            return None, {"error": "json_parse_error", "raw_stdout": stdout.strip(), "stderr": stderr.strip()}

        return parsed, {"used_cli": True, "cmd": cmd}

    # If not using CLI, report that the CLI preference was not set.
    return None, {"error": "kafka_force_cli_not_set", "detail": "Set KAFKA_FORCE_CLI=1 to enable CLI consumption"}
