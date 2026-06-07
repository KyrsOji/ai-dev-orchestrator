"""Simple Kafka client used by the reviewer service.

Behavior:
- Honors KAFKA_BOOTSTRAP and KAFKA_CLIENT_CONFIG environment variables (same patterns as runner/)
- Prefers Kafka CLI tools (kafka-console-producer.sh / kafka-console-consumer.sh)
- Falls back to kafka-python when CLI is not available
- Preserves dry-run mode by printing [KAFKA-PUBLISH] instead of sending

This module provides a small, test-friendly surface used by reviewer.service.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import logging
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)


def _find_cli(name_candidates: tuple[str, ...]) -> Optional[str]:
    for name in name_candidates:
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


class KafkaClient:
    """Small Kafka transport wrapper.

    Methods return (success, meta) for publish and (message_or_none, meta) for consume.
    """

    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self.bootstrap = os.environ.get("KAFKA_BOOTSTRAP", "kafka.yahlife.com:9095")
        self.client_config = os.environ.get("KAFKA_CLIENT_CONFIG")
        # prefer the shell script names first, fall back to alternate names
        self.producer_cli = _find_cli(("kafka-console-producer.sh", "kafka-console-producer"))
        self.consumer_cli = _find_cli(("kafka-console-consumer.sh", "kafka-console-consumer"))

    def publish(self, topic: str, message: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
        """Publish a single JSON message to Kafka.

        Returns (success, metadata).
        """
        payload = json.dumps(message, ensure_ascii=False)
        if self.dry_run:
            # Preserve existing dry-run output format used by reviewer tests
            print(f"[KAFKA-PUBLISH] topic={topic} message={payload}")
            return True, {"dry_run": True}

        # Try CLI producer first
        if self.producer_cli:
            cmd = [self.producer_cli, "--bootstrap-server", self.bootstrap, "--topic", topic]
            if self.client_config:
                cmd.extend(["--producer.config", self.client_config])
            try:
                proc = subprocess.run(cmd, input=payload + "\n", text=True, capture_output=True, timeout=30)
                meta = {
                    "topic": topic,
                    "returnCode": proc.returncode,
                    "stdout": (proc.stdout or "")[-4000:],
                    "stderr": (proc.stderr or "")[-4000:],
                    "used_cli": True,
                    "cmd": cmd,
                }
                return proc.returncode == 0, meta
            except Exception as exc:
                logger.debug("Producer CLI failed: %s", exc)
                # fall through to python client

        # Fallback: kafka-python
        try:
            import importlib

            if importlib.util.find_spec("kafka") is None:
                return False, {"error": "kafka-python-not-installed"}
            from kafka import KafkaProducer

            # kafka-python expects byte payloads; use json dumps
            producer = KafkaProducer(bootstrap_servers=[self.bootstrap], value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"))
            future = producer.send(topic, message)
            producer.flush(timeout=10)
            # Try to get metadata from the future if available
            try:
                rec_meta = future.get(timeout=10)
                meta = {"topic": topic, "partition": getattr(rec_meta, "partition", None), "offset": getattr(rec_meta, "offset", None), "used_python_client": True}
            except Exception:
                meta = {"topic": topic, "used_python_client": True}
            return True, meta
        except Exception as exc:
            logger.exception("kafka publish failed")
            return False, {"topic": topic, "error": str(exc), "errorType": type(exc).__name__}

    def consume_one(self, topic: str = "ai.dev.result.out", timeout_s: int = 10, from_beginning: bool = False) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
        """Consume a single JSON message from Kafka.

        Returns (message_dict_or_None, metadata).
        """
        # Try CLI consumer first
        if self.consumer_cli:
            cmd = [self.consumer_cli, "--bootstrap-server", self.bootstrap, "--topic", topic, "--max-messages", "1", "--timeout-ms", str(timeout_s * 1000)]
            if from_beginning:
                cmd.extend(["--from-beginning", "--group", "ai-dev-reviewer-group"])
            if self.client_config:
                cmd.extend(["--consumer.config", self.client_config])
            try:
                proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout_s + 5)
            except Exception as exc:
                return None, {"error": "kafka_cli_execution_failed", "detail": str(exc), "cmd": cmd}

            stdout = proc.stdout or ""
            stderr = proc.stderr or ""

            if proc.returncode != 0 and not stdout:
                return None, {"error": "kafka_cli_nonzero_exit", "rc": proc.returncode, "stderr": stderr.strip(), "cmd": cmd}

            parsed = _parse_first_json_from_text(stdout)
            if not parsed:
                return None, {"error": "json_parse_error", "raw_stdout": stdout.strip(), "stderr": stderr.strip(), "cmd": cmd}

            return parsed, {"used_cli": True, "cmd": cmd}

        # Fallback: kafka-python
        try:
            import importlib

            if importlib.util.find_spec("kafka") is None:
                return None, {"error": "kafka-python-not-installed"}
            from kafka import KafkaConsumer

            consumer = KafkaConsumer(topic, bootstrap_servers=[self.bootstrap], consumer_timeout_ms=timeout_s * 1000, auto_offset_reset=("earliest" if from_beginning else "latest"))
            for msg in consumer:
                try:
                    val = msg.value
                    if isinstance(val, (bytes, bytearray)):
                        txt = val.decode("utf-8")
                    else:
                        txt = str(val)
                    return json.loads(txt), {"used_python_client": True}
                except Exception as exc:
                    # Return parse error metadata instead of raising
                    return None, {"error": "json_parse_error", "detail": str(exc)}
            return None, {"error": "no_message", "timeout_s": timeout_s}
        except Exception as exc:
            logger.exception("kafka consume failed")
            return None, {"error": str(exc), "errorType": type(exc).__name__}
