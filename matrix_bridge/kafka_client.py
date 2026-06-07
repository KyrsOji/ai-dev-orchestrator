"""Kafka client for matrix_bridge.

- Honors KAFKA_BOOTSTRAP and KAFKA_CLIENT_CONFIG env vars.
- Prefers Kafka CLI tools and falls back to kafka-python (kafka-python package).
- Preserves dry-run for publish by printing [KAFKA-PUBLISH].
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
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            return json.loads(line)
        except Exception:
            continue
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
    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self.bootstrap = os.environ.get("KAFKA_BOOTSTRAP", "kafka.yahlife.com:9095")
        self.client_config = os.environ.get("KAFKA_CLIENT_CONFIG")
        self.producer_cli = _find_cli(("kafka-console-producer.sh", "kafka-console-producer"))
        self.consumer_cli = _find_cli(("kafka-console-consumer.sh", "kafka-console-consumer"))

    def publish(self, topic: str, message: Dict[str, Any]) -> Tuple[bool, Dict[str, Any]]:
        payload = json.dumps(message, ensure_ascii=False)
        if self.dry_run:
            print(f"[KAFKA-PUBLISH] topic={topic} message={payload}")
            return True, {"dry_run": True}

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
                }
                return proc.returncode == 0, meta
            except Exception as exc:
                logger.debug("Producer CLI failed: %s", exc)

        try:
            import importlib
            if importlib.util.find_spec("kafka") is None:
                return False, {"error": "kafka-python-not-installed"}
            from kafka import KafkaProducer

            producer = KafkaProducer(bootstrap_servers=[self.bootstrap], value_serializer=lambda v: json.dumps(v, ensure_ascii=False).encode("utf-8"))
            future = producer.send(topic, message)
            producer.flush(timeout=10)
            try:
                rec = future.get(timeout=10)
                meta = {"topic": topic, "partition": getattr(rec, "partition", None), "offset": getattr(rec, "offset", None), "used_python_client": True}
            except Exception:
                meta = {"topic": topic, "used_python_client": True}
            return True, meta
        except Exception as exc:
            logger.exception("kafka publish failed")
            return False, {"topic": topic, "error": str(exc), "errorType": type(exc).__name__}

    def consume_one(self, topic: str = "ai.dev.approval.required", timeout_s: int = 10, from_beginning: bool = False) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
        if self.consumer_cli:
            cmd = [self.consumer_cli, "--bootstrap-server", self.bootstrap, "--topic", topic, "--max-messages", "1", "--timeout-ms", str(timeout_s * 1000)]
            if from_beginning:
                cmd.extend(["--from-beginning", "--group", "ai-dev-matrix-bridge-group"])
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
                    return None, {"error": "json_parse_error", "detail": str(exc)}
            return None, {"error": "no_message", "timeout_s": timeout_s}
        except Exception as exc:
            logger.exception("kafka consume failed")
            return None, {"error": str(exc), "errorType": type(exc).__name__}
