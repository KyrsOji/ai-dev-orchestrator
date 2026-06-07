"""CLI entrypoint for registry package.

Usage:
  python -m registry list [--storage /tmp/ai-dev-agent-registry.json]
  python -m registry consume --storage /tmp/ai-dev-agent-registry.json [--file-path /tmp/hb.txt]
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import datetime, timezone
from typing import Optional

from registry.service import AgentRegistry

logger = logging.getLogger(__name__)


def format_age(last_seen_iso: str) -> str:
    try:
        last = datetime.fromisoformat(last_seen_iso.replace('Z', '+00:00'))
        now = datetime.utcnow().replace(tzinfo=timezone.utc)
        age = int((now - last).total_seconds())
        if age < 60:
            return f"{age}s"
        if age < 3600:
            return f"{age//60}m"
        return f"{age//3600}h"
    except Exception:
        return "?"


def cmd_list(storage: str) -> int:
    reg = AgentRegistry(storage_path=storage)
    reg.load_storage()
    agents = reg.list_agents()
    # Print table header
    print("## AGENT ID          STATUS   LAST SEEN")
    for a in agents:
        print(f"{a.agentId:18} {a.status:7} {format_age(a.lastSeen):>8}")
    return 0


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(prog="registry", description="Agent Registry CLI")
    sub = parser.add_subparsers(dest="cmd")

    p_list = sub.add_parser("list", help="List registered agents")
    p_list.add_argument("--storage", default="/tmp/ai-dev-agent-registry.json", help="Path to registry storage file")

    p_consume = sub.add_parser("consume", help="Start consumer (blocking)")
    p_consume.add_argument("--storage", default="/tmp/ai-dev-agent-registry.json", help="Path to registry storage file")
    p_consume.add_argument("--file-path", help="Tail a file for heartbeat JSON lines (useful for smoke tests)")
    p_consume.add_argument("--topic", default="ai.dev.agent.status", help="Kafka topic to consume")

    args = parser.parse_args(argv)

    if args.cmd == "list":
        return cmd_list(args.storage)
    if args.cmd == "consume":
        # Delegate to consumer module
        from registry.consumer import main as consumer_main

        # Build args for consumer
        cons_args = ["--storage", args.storage]
        if args.file_path:
            cons_args.extend(["--file-path", args.file_path])
        cons_args.extend(["--topic", args.topic])
        return consumer_main(cons_args)

    parser.print_help()
    return 2


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    raise SystemExit(main())
