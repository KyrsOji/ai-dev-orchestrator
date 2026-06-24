"""Heartbeat publisher for agent status.

Publishes ai.dev.agent.status at regular intervals.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import socket
import subprocess
import sys
import time
from typing import Any, Dict, List, Optional

from datetime import datetime, timezone

try:
    import psutil  # type: ignore
    _HAS_PSUTIL = True
except Exception:
    _HAS_PSUTIL = False

# Reuse existing KafkaClient from matrix_bridge for consistent CLI usage
try:
    from matrix_bridge.kafka_client import KafkaClient
except Exception:
    KafkaClient = None  # type: ignore

logger = logging.getLogger(__name__)

DEFAULT_INTERVAL = 60


def _get_cpu_count() -> int:
    try:
        return int(os.cpu_count() or 1)
    except Exception:
        return 1


def _get_memory_gb() -> float:
    try:
        if _HAS_PSUTIL:
            return round(psutil.virtual_memory().total / (1024.0 ** 3), 2)
        # Fallback: read /proc/meminfo on Linux
        if sys.platform.startswith("linux"):
            with open("/proc/meminfo", "r") as fh:
                for line in fh:
                    if line.startswith("MemTotal:"):
                        parts = line.split()
                        # value in kB
                        kb = int(parts[1])
                        return round(kb / (1024.0 ** 1), 2) / 1024.0
    except Exception:
        logger.debug("Failed to get memory via fallback")
    return 0.0


def _get_disk_free_gb(path: str = "/") -> float:
    try:
        du = shutil.disk_usage(path)
        return round(du.free / (1024.0 ** 3), 2)
    except Exception:
        return 0.0


def _get_load_average() -> float:
    try:
        if hasattr(os, "getloadavg"):
            one, _, _ = os.getloadavg()
            return float(one)
    except Exception:
        pass
    return 0.0


def _get_uptime() -> float:
    try:
        if _HAS_PSUTIL:
            return float(time.time() - psutil.boot_time())
        # linux /proc/uptime
        if sys.platform.startswith("linux"):
            with open("/proc/uptime", "r") as fh:
                content = fh.read().split()
                return float(content[0])
    except Exception:
        pass
    return 0.0


def _iso_now() -> str:
    return datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace('+00:00','Z')


class HeartbeatPublisher:
    def __init__(self, agent_id: str, roles: List[str], interval: int = DEFAULT_INTERVAL, dry_run: bool = False, kafka_client: Optional[KafkaClient] = None) -> None:
        self.agent_id = agent_id
        self.roles = roles
        self.interval = interval
        self.dry_run = dry_run
        self.kafka = kafka_client if kafka_client is not None else (KafkaClient(dry_run=dry_run) if KafkaClient is not None else None)

    def build_payload(self) -> Dict[str, Any]:
        hostname = socket.gethostname()
        cpu = _get_cpu_count()
        mem = _get_memory_gb()
        disk = _get_disk_free_gb("/")
        load = _get_load_average()
        payload = {
            "agentId": self.agent_id,
            "hostname": hostname,
            "roles": self.roles,
            "status": "idle",
            "cpuCount": cpu,
            "memoryGb": mem,
            "diskFreeGb": disk,
            "loadAverage": load,
            "lastSeen": _iso_now(),
        }
        return payload

    def publish_once(self) -> bool:
        payload = self.build_payload()
        if not self.kafka:
            print("[HEARTBEAT]", payload)
            return True
        ok, meta = self.kafka.publish("ai.dev.agent.status", payload)
        if not ok:
            logger.error("Failed to publish heartbeat: %s", meta)
            return False
        return True

    def run(self) -> None:
        try:
            while True:
                self.publish_once()
                time.sleep(self.interval)
        except KeyboardInterrupt:
            logger.info("Heartbeat publisher stopping")


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="agent-heartbeat", description="Publish agent heartbeat to ai.dev.agent.status topic")
    parser.add_argument("--agent-id", help="Agent ID (env: AGENT_ID)")
    parser.add_argument("--roles", help="Comma-separated roles (env: AGENT_ROLES)")
    parser.add_argument("--interval", type=int, default=DEFAULT_INTERVAL, help="Heartbeat interval seconds")
    parser.add_argument("--once", action="store_true", help="Publish one heartbeat and exit")
    parser.add_argument("--dry-run", action="store_true", help="Do not send to Kafka; print payload")

    args = parser.parse_args(argv)
    agent_id = args.agent_id or os.environ.get("AGENT_ID")
    roles_str = args.roles or os.environ.get("AGENT_ROLES", "")
    if not agent_id:
        parser.error("--agent-id or AGENT_ID env var required")
    roles = [r.strip() for r in roles_str.split(",") if r.strip()]
    hb = HeartbeatPublisher(agent_id=agent_id, roles=roles, interval=args.interval, dry_run=args.dry_run)
    if args.once:
        ok = hb.publish_once()
        return 0 if ok else 2
    hb.run()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
