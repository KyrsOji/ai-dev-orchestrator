"""Consumer that updates AgentRegistry from ai.dev.agent.status topic or a tail file.

If --file-path is provided, the consumer tails the file for newline-delimited JSON
heartbeats (useful for smoke tests). Otherwise it consumes from Kafka.
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import os
import time
from typing import Optional

from registry.service import AgentRegistry

try:
    from matrix_bridge.kafka_client import KafkaClient
except Exception:
    KafkaClient = None  # type: ignore

logger = logging.getLogger(__name__)


def tail_file(path: str, callback, poll_interval: float = 0.5):
    # Open file and seek to end, then read newlines
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
            callback(payload)


def consume_kafka(topic: str, registry: AgentRegistry, timeout_s: int = 5):
    if KafkaClient is None:
        logger.error("KafkaClient not available; cannot consume from Kafka")
        return
    kc = KafkaClient(dry_run=False)
    while True:
        msg, meta = kc.consume_one(topic=topic, timeout_s=timeout_s, from_beginning=False)
        if msg is None:
            # no message
            time.sleep(0.1)
            continue
        registry.ingest_heartbeat(msg)


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(prog="agent-registry-consumer")
    parser.add_argument("--storage", default="/tmp/ai-dev-agent-registry.json", help="Path to storage file for registry state")
    parser.add_argument("--file-path", help="If provided, tail this file for JSON heartbeats (newline-delimited)")
    parser.add_argument("--topic", default="ai.dev.agent.status", help="Kafka topic to consume")
    parser.add_argument("--timeout", type=int, default=5, help="Kafka consume timeout s")

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
            tail_file(args.file_path, lambda payload: registry.ingest_heartbeat(payload))
        except KeyboardInterrupt:
            logger.info("Stopping file-tail consumer")
            return 0
    else:
        try:
            consume_kafka(args.topic, registry, timeout_s=args.timeout)
        except KeyboardInterrupt:
            logger.info("Stopping kafka consumer")
            return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
