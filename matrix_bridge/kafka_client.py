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
import time
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


import threading
import signal

class KafkaClient:
    def __init__(self, dry_run: bool = False) -> None:
        self.dry_run = dry_run
        self.bootstrap = os.environ.get("KAFKA_BOOTSTRAP", "kafka.yahlife.com:9095")
        self.client_config = os.environ.get("KAFKA_CLIENT_CONFIG")
        # Discovery order for CLI tools:
        # 1) Explicit environment variable pointing to executable
        # 2) PATH discovery (shutil.which)
        # 3) kafka-python fallback
        prod_env = os.environ.get("KAFKA_PRODUCER_CMD")
        cons_env = os.environ.get("KAFKA_CONSUMER_CMD")

        def _is_executable(path: Optional[str]) -> bool:
            if not path:
                return False
            try:
                p = os.path.expanduser(path)
                p = os.path.abspath(p)
                return os.path.isfile(p) and os.access(p, os.X_OK)
            except Exception:
                return False

        producer_cli = None
        if prod_env:
            if _is_executable(prod_env):
                producer_cli = os.path.abspath(os.path.expanduser(prod_env))
            else:
                logger.warning("KAFKA_PRODUCER_CMD is set but not executable: %s", prod_env)
        if not producer_cli:
            producer_cli = _find_cli(("kafka-console-producer.sh", "kafka-console-producer"))

        consumer_cli = None
        if cons_env:
            if _is_executable(cons_env):
                consumer_cli = os.path.abspath(os.path.expanduser(cons_env))
            else:
                logger.warning("KAFKA_CONSUMER_CMD is set but not executable: %s", cons_env)
        if not consumer_cli:
            consumer_cli = _find_cli(("kafka-console-consumer.sh", "kafka-console-consumer"))

        self.producer_cli = producer_cli
        self.consumer_cli = consumer_cli

        # Safe startup logging (do not log secrets)
        logger.info("Resolved kafka producer command: %s", self.producer_cli or "(none)")
        logger.info("Resolved kafka consumer command: %s", self.consumer_cli or "(none)")

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

    def _read_and_log_stream(self, stream, level=logging.INFO):
        for ln in iter(stream.readline, ""):
            ln = ln.rstrip("\n")
            if ln:
                logger.log(level, "kafka-consumer-cli: %s", ln)
        stream.close()

    def listen(self, topic: str = "ai.dev.approval.required", group: str = "ai-dev-matrix-bridge-group", from_beginning: bool = False):
        """Persistent iterator that yields (payload_dict, meta).

        Prefers kafka-console-consumer CLI (so KAFKA_CLIENT_CONFIG works). Falls back
        to kafka-python consumer when available and CLI not usable.
        """
        backoff = 1
        # If CLI available, use it (so Java-style client config files work)
        if self.consumer_cli:
            logger.info("Using kafka-console-consumer CLI for persistent consumption topic=%s group=%s", topic, group)
            while True:
                cmd = [self.consumer_cli, "--bootstrap-server", self.bootstrap, "--topic", topic, "--group", group]
                if from_beginning:
                    cmd.append("--from-beginning")
                if self.client_config:
                    cmd.extend(["--consumer.config", self.client_config])
                try:
                    logger.info("Starting kafka-console-consumer: %s", " ".join(cmd))
                    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1, preexec_fn=os.setsid)

                    # Start thread to read stderr so process doesn't block
                    stderr_thread = threading.Thread(target=self._read_and_log_stream, args=(proc.stderr, logging.ERROR), daemon=True)
                    stderr_thread.start()

                    assert proc.stdout is not None
                    for raw in iter(proc.stdout.readline, ""):
                        if raw is None:
                            break
                        line = raw.strip()
                        if not line:
                            continue
                        logger.debug("Raw Kafka line: %s", line[:500])
                        payload = _parse_first_json_from_text(line)
                        if not payload:
                            logger.debug("Non-JSON or unparsable line from consumer: %s", line)
                            continue
                        logger.info("Parsed Kafka message topic=%s taskId=%s", topic, (payload.get("taskId") if isinstance(payload, dict) else None))
                        yield payload, {"used_cli": True}

                    rc = proc.poll()
                    logger.warning("kafka-console-consumer terminated with rc=%s; restarting after %s seconds", rc, backoff)
                    try:
                        os.killpg(proc.pid, signal.SIGTERM)
                    except Exception:
                        try:
                            proc.kill()
                        except Exception:
                            pass
                    # If the runner is shutting down, do not restart the consumer loop
                    try:
                        if os.environ.get("RUNNER_SHUTTING_DOWN") == "1":
                            logger.info("Shutdown requested; not restarting kafka-console-consumer")
                            return
                    except Exception:
                        pass
                    time.sleep(backoff)
                    backoff = min(30, backoff * 2)
                    continue
                except KeyboardInterrupt:
                    logger.info("Stopping kafka persistent consumer (keyboard interrupt)")
                    try:
                        os.killpg(proc.pid, signal.SIGTERM)
                    except Exception:
                        try:
                            proc.terminate()
                        except Exception:
                            pass
                    return
                except Exception:
                    logger.exception("Error while running kafka persistent consumer; retrying")
                    time.sleep(backoff)
                    backoff = min(30, backoff * 2)
                    continue

        # CLI not available; try kafka-python persistent consumer if installed
        try:
            import importlib
            if importlib.util.find_spec("kafka") is None:
                logger.error("No viable Kafka consumer available: install kafka-python or ensure kafka-console-consumer is on PATH; cannot consume from Kafka")
                return
            from kafka import KafkaConsumer

            logger.info("Using kafka-python KafkaConsumer for persistent consumption topic=%s group=%s", topic, group)
            auto_offset = "earliest" if from_beginning else "latest"
            try:
                # Create consumer without directly subscribing so we can attach a rebalance listener
                class _RebalanceListener:
                    def on_partitions_assigned(self, assigned):
                        logger.info("Consumer assigned partitions: %s", assigned)
                    def on_partitions_revoked(self, revoked):
                        logger.info("Consumer revoked partitions: %s", revoked)
                consumer = KafkaConsumer(bootstrap_servers=[self.bootstrap], group_id=group, auto_offset_reset=auto_offset, enable_auto_commit=True)
                consumer.subscribe([topic], listener=_RebalanceListener())
                logger.info("Consumer connected")
                for msg in consumer:
                    try:
                        val = msg.value
                        if isinstance(val, (bytes, bytearray)):
                            txt = val.decode("utf-8")
                        else:
                            txt = str(val)
                        payload = json.loads(txt)
                        yield payload, {"used_python_client": True, "partition": getattr(msg, 'partition', None), "offset": getattr(msg, 'offset', None)}
                    except Exception:
                        logger.exception("Failed to parse/ingest message from kafka-python consumer")
            except Exception:
                logger.exception("kafka-python persistent consumer failed")
                return
        except Exception:
            logger.exception("No viable Kafka consumer available: install kafka-python or ensure kafka-console-consumer is on PATH; cannot consume from Kafka")
            return

    def consume_one(self, topic: str = "ai.dev.approval.required", timeout_s: int = 10, from_beginning: bool = False) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
        # Preserve existing consume_one behavior for compatibility
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
                # CLI failed without producing stdout; fall back to python client for robustness
                logger.debug("Consumer CLI failed (rc=%s); stderr=%s; falling back to python client", proc.returncode, stderr.strip())
            else:
                parsed = _parse_first_json_from_text(stdout)
                if parsed:
                    return parsed, {"used_cli": True, "cmd": cmd}
                # No JSON parsed from CLI output; fall back to python client
                logger.debug("Consumer CLI returned no JSON; stdout=%s stderr=%s; falling back to python client", stdout.strip(), stderr.strip())

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
