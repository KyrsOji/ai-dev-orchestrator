"""Consumer that updates AgentRegistry from ai.dev.agent.status topic or a tail file.

This module implements a production-safe, long-running Kafka consumer.
Behavior:
- If --file-path is provided, tail that file (unchanged behavior for smoke tests).
- Otherwise, prefer a long-running kafka-console-consumer subprocess (so existing
  KAFKA_CLIENT_CONFIG Java-style properties continue to work with mTLS) and
  fall back to kafka-python if the CLI is unavailable and kafka-python is
  installed AND no KAFKA_CLIENT_CONFIG is set.

Design choices:
- Persistent consumer process (not repeated one-shot CLI calls) to avoid
  frequent startup/shutdown and ConsoleConsumer TimeoutException observed when
  using short-lived invocations.
- Use a consumer group so offsets are managed by the broker.
- Default offset behavior: start from latest (do not replay history) unless
  --from-beginning is provided.
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import os
import shutil
import subprocess
import signal
import time
import threading
from typing import Optional

from registry.service import AgentRegistry
from registry.schema import AgentStatus

logger = logging.getLogger(__name__)


def _parse_first_json_from_text(text: str) -> Optional[dict]:
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


def tail_file(path: str, callback, poll_interval: float = 0.5):
    # Open file and seek to end, then read newlines (existing behavior)
    with open(path, "r", encoding="utf-8") as fh:
        fh.seek(0, io.SEEK_END)
        while True:
            line = fh.readline()
            if not line:
                time.sleep(poll_interval)
                continue
            line = line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except Exception:
                logger.exception("Failed to parse JSON line: %s", line)
                continue
            try:
                # If callback returns truthy, stop tailing and return
                should_stop = callback(payload)
                if should_stop:
                    logger.info("tail_file: callback requested stop; exiting tail loop")
                    return
            except Exception:
                logger.exception("Error in heartbeat callback; continuing")
                continue


def _find_consumer_cli() -> Optional[str]:
    for name in ("kafka-console-consumer.sh", "kafka-console-consumer"):
        path = shutil.which(name)
        if path:
            return path
    return None


def _read_and_log_stream(stream, level=logging.INFO):
    # Helper: read a process stream line-by-line and log it
    for ln in iter(stream.readline, ""):
        ln = ln.rstrip("\n")
        if ln:
            logger.log(level, "kafka-consumer-cli: %s", ln)
    stream.close()


def consume_kafka_persistent(topic: str, registry: AgentRegistry, *, timeout_s: int = 5, from_beginning: bool = False, run_mode: str = "service", expected_agent_id: Optional[str] = None) -> None:
    """Long-running consumer that ingests JSON heartbeats into the registry.

    Strategy:
    - Prefer the kafka-console-consumer CLI (so Java-style client config files
      including mTLS keystore/truststore work without conversion).
    - If CLI is not available and kafka-python is installed and no
      KAFKA_CLIENT_CONFIG is set, use kafka-python for a persistent consumer.

    Behavior:
    - In 'service' run_mode (default) the function will restart the consumer on any exit
      with an exponential backoff (intended for long-running production processes).
    - In 'smoke' run_mode the function treats a clean exit (rc == 0) as success and
      returns to the caller; non-zero exits are treated as failures and trigger restart
      with exponential backoff (intended for bounded smoke/test runs).
    """
    bootstrap = os.environ.get("KAFKA_BOOTSTRAP", "kafka.yahlife.com:9095")
    client_config = os.environ.get("KAFKA_CLIENT_CONFIG")
    group = os.environ.get("AGENT_REGISTRY_CONSUMER_GROUP", "ai-dev-agent-registry-group")

    run_mode_norm = (run_mode or os.environ.get("AGENT_REGISTRY_RUN_MODE", "service")).lower()
    if run_mode_norm not in ("service", "smoke"):
        run_mode_norm = "service"

    consumer_cli = _find_consumer_cli()

    # If CLI available, use it so KAFKA_CLIENT_CONFIG (Java client properties)
    # can be passed through directly.
    if consumer_cli:
        logger.info("Using kafka-console-consumer CLI for persistent consumption")
        # Build base command
        cmd = [consumer_cli, "--bootstrap-server", bootstrap, "--topic", topic, "--group", group]
        if from_beginning:
            cmd.append("--from-beginning")
        if client_config:
            cmd.extend(["--consumer.config", client_config])
        # In smoke run mode, bound the CLI itself with --max-messages and --timeout-ms
        if run_mode_norm == "smoke":
            # limit messages and add an internal consumer timeout to ensure CLI exits
            # Allow overriding via environment variables for live smoke determinism
            max_msgs = os.environ.get("AGENT_REGISTRY_CONSUMER_MAX_MESSAGES", "1")
            timeout_ms = os.environ.get("AGENT_REGISTRY_CONSUMER_TIMEOUT_MS", "5000")
            try:
                max_msgs_int = int(max_msgs)
            except Exception:
                max_msgs_int = 1
            try:
                timeout_ms_int = int(timeout_ms)
            except Exception:
                timeout_ms_int = 5000
            cmd.extend(["--max-messages", str(max_msgs_int), "--timeout-ms", str(timeout_ms_int)])

        backoff = 1
        while True:
            try:
                logger.info("Starting kafka-console-consumer: %s", " ".join(cmd))
                proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1, preexec_fn=os.setsid)

                # Start threads to read stderr and log it so the subprocess doesn't block
                stderr_thread = threading.Thread(target=_read_and_log_stream, args=(proc.stderr, logging.ERROR), daemon=True)
                stderr_thread.start()

                # Read stdout line-by-line and parse JSON heartbeats
                assert proc.stdout is not None
                for raw in iter(proc.stdout.readline, ""):
                    if raw is None:
                        break
                    line = raw.strip()
                    if not line:
                        continue
                    payload = _parse_first_json_from_text(line)
                    if not payload:
                        logger.debug("Non-JSON or unparsable line from consumer: %s", line)
                        continue
                    try:
                        registry.ingest_heartbeat(payload)
                    except Exception:
                        logger.exception("Failed to ingest heartbeat")
                    # If smoke mode and expected agent specified, exit early when observed
                    if run_mode_norm == "smoke" and expected_agent_id:
                        try:
                            agent_id = None
                            try:
                                st = AgentStatus.from_dict(payload)
                                agent_id = st.agentId
                            except Exception:
                                agent_id = payload.get("agentId")
                            if agent_id == expected_agent_id:
                                logger.info("Expected agent '%s' observed in CLI consumer; persisting and exiting", expected_agent_id)
                                try:
                                    os.killpg(proc.pid, signal.SIGTERM)
                                except Exception:
                                    try:
                                        proc.kill()
                                    except Exception:
                                        pass
                                return
                        except Exception:
                            logger.exception("Error while checking expected agent id")

                # If we exit the loop, process likely terminated
                rc = proc.poll()
                # If in smoke/test mode and the consumer exited cleanly (rc == 0),
                # treat as successful completion and return to caller (no restart).
                if run_mode_norm == "smoke" and rc == 0:
                    logger.info("kafka-console-consumer exited cleanly (rc=%s); run_mode=%s -> stopping persistent consumer", rc, run_mode_norm)
                    try:
                        os.killpg(proc.pid, signal.SIGTERM)
                    except Exception:
                        try:
                            proc.kill()
                        except Exception:
                            pass
                    return
                logger.warning("kafka-console-consumer terminated with rc=%s; restarting after %s seconds (run_mode=%s)", rc, backoff, run_mode_norm)
                try:
                    os.killpg(proc.pid, signal.SIGTERM)
                except Exception:
                    try:
                        proc.kill()
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

    # CLI not available; try kafka-python if installed and no client_config (since
    # we cannot easily translate Java keystore/truststore properties)
    try:
        import importlib
        if importlib.util.find_spec("kafka") is None or client_config:
            raise ImportError
        from kafka import KafkaConsumer

        logger.info("Using kafka-python KafkaConsumer for persistent consumption")
        auto_offset = "earliest" if from_beginning else "latest"
        consumer = KafkaConsumer(topic, bootstrap_servers=[bootstrap], group_id=group, auto_offset_reset=auto_offset, enable_auto_commit=True)
        for msg in consumer:
            try:
                val = msg.value
                if isinstance(val, (bytes, bytearray)):
                    txt = val.decode("utf-8")
                else:
                    txt = str(val)
                payload = json.loads(txt)
                registry.ingest_heartbeat(payload)
                # If smoke mode and expected agent specified, exit early when observed
                if run_mode_norm == "smoke" and expected_agent_id:
                    try:
                        agent_id = None
                        try:
                            st = AgentStatus.from_dict(payload)
                            agent_id = st.agentId
                        except Exception:
                            agent_id = payload.get("agentId")
                        if agent_id == expected_agent_id:
                            logger.info("Expected agent '%s' observed in kafka-python consumer; persisting and exiting", expected_agent_id)
                            try:
                                consumer.close()
                            except Exception:
                                pass
                            return
                    except Exception:
                        logger.exception("Error while checking expected agent id")
            except Exception:
                logger.exception("Failed to parse/ingest message from kafka-python consumer")
    except ImportError:
        logger.error("No viable Kafka consumer available: install kafka-python or ensure kafka-console-consumer is on PATH; cannot consume from Kafka")
        return


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(prog="agent-registry-consumer")
    parser.add_argument("--storage", default="/tmp/ai-dev-agent-registry.json", help="Path to storage file for registry state")
    parser.add_argument("--file-path", help="If provided, tail this file for JSON heartbeats (newline-delimited)")
    parser.add_argument("--topic", default="ai.dev.agent.status", help="Kafka topic to consume")
    parser.add_argument("--timeout", type=int, default=5, help="Kafka consume timeout s (unused for persistent consumer)")
    parser.add_argument("--from-beginning", action="store_true", help="If set, consume from beginning on first start (useful for initial population)")
    parser.add_argument("--run-mode", choices=("service","smoke"), default=os.environ.get("AGENT_REGISTRY_RUN_MODE","service"), help="Run mode: 'service' (persistent) or 'smoke' (bounded)")
    parser.add_argument("--expect-agent-id", default=os.environ.get("AGENT_REGISTRY_EXPECT_AGENT_ID"), help="Expected agent ID to wait for (smoke mode only)")

    args = parser.parse_args(argv)
    registry = AgentRegistry(storage_path=args.storage)
    # load any previous state
    registry.load_storage()

    logger.info("Starting AgentRegistry consumer storage=%s", args.storage)
    if args.file_path:
        if not os.path.exists(args.file_path):
            # create empty file
            open(args.file_path, "a").close()
        try:
            def _on_payload(payload):
                try:
                    registry.ingest_heartbeat(payload)
                except Exception:
                    logger.exception("Failed to ingest heartbeat (file-tail)")
                # If smoke mode and expected agent is set, return True to stop tailing when seen
                if args.run_mode == "smoke" and args.expect_agent_id:
                    try:
                        agent_id = None
                        try:
                            st = AgentStatus.from_dict(payload)
                            agent_id = st.agentId
                        except Exception:
                            agent_id = payload.get("agentId")
                        if agent_id == args.expect_agent_id:
                            logger.info("Expected agent '%s' observed in file-tail; persisting and exiting", args.expect_agent_id)
                            return True
                    except Exception:
                        logger.exception("Error while checking expected agent id")
                return False

            tail_file(args.file_path, _on_payload)
        except KeyboardInterrupt:
            logger.info("Stopping file-tail consumer")
            return 0
    else:
        try:
            consume_kafka_persistent(args.topic, registry, timeout_s=args.timeout, from_beginning=args.from_beginning, run_mode=args.run_mode, expected_agent_id=args.expect_agent_id)
        except KeyboardInterrupt:
            logger.info("Stopping kafka consumer")
            return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
