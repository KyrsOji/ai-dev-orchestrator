#!/usr/bin/env python3
"""Publish approved follow-up suggestions to approval topic.

Usage:
  scripts/publish_followups.py --dry-run --limit 10
  scripts/publish_followups.py --limit 10
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List

# Ensure repo root is importable
repo_root = os.path.dirname(os.path.dirname(__file__))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="publish_followups")
    parser.add_argument("--dry-run", action="store_true", help="Only show what would be published")
    parser.add_argument("--limit", type=int, default=50, help="Maximum number of suggestions to publish")
    parser.add_argument("--file", help="Path to followup suggestions JSONL file (overrides FOLLOWUP_SUGGESTIONS_FILE)")
    parser.add_argument("--decisions-file", help="Path to decisions JSONL file (overrides FOLLOWUP_DECISIONS_FILE)")
    parser.add_argument("--published-file", help="Path to published tracking JSONL file (overrides FOLLOWUP_PUBLISHED_FILE)")
    args = parser.parse_args(argv)

    # Apply overrides
    if args.file:
        os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = args.file
    if args.decisions_file:
        os.environ["FOLLOWUP_DECISIONS_FILE"] = args.decisions_file
    if args.published_file:
        os.environ["FOLLOWUP_PUBLISHED_FILE"] = args.published_file

    try:
        from reviewer import followup_publisher
    except Exception as exc:
        print(f"Failed to import followup_publisher: {exc}", file=sys.stderr)
        return 2

    try:
        suggestions = followup_publisher.get_approved_suggestions(limit=args.limit)
    except Exception as exc:
        print(f"Failed to list approved suggestions: {exc}", file=sys.stderr)
        return 3

    if args.dry_run:
        for s in suggestions:
            # show payload
            payload = {
                "source": s.get("source", "auto-followup"),
                "parentTaskId": s.get("parentTaskId"),
                "conversationId": s.get("conversationId"),
                "title": s.get("title"),
                "description": s.get("description"),
                "reason": s.get("reason"),
                "suggestionId": s.get("suggestionId"),
                "approvalRequired": True,
            }
            print(json.dumps(payload, ensure_ascii=False))
        return 0

    all_ok = True
    for s in suggestions:
        ok, meta = followup_publisher.publish_approved_suggestion(s)
        if ok:
            print(f"Published suggestion {s.get('suggestionId')}")
        else:
            print(f"Failed to publish {s.get('suggestionId')}: {meta}", file=sys.stderr)
            all_ok = False

    return 0 if all_ok else 1


if __name__ == "__main__":
    raise SystemExit(main())