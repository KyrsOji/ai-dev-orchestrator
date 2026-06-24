#!/usr/bin/env python3
"""CLI to manually approve/reject staged follow-up suggestions.

Usage examples:
  scripts/review_followup.py --approve <suggestionId> --file /tmp/followups.jsonl --decisions-file /tmp/decisions.jsonl
  scripts/review_followup.py --list-pending --file /tmp/followups.jsonl --decisions-file /tmp/decisions.jsonl --json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List, Dict

# Ensure repo root is importable
repo_root = os.path.dirname(os.path.dirname(__file__))
if repo_root not in sys.path:
    sys.path.insert(0, repo_root)


def _human_line(s: Dict[str, object]) -> str:
    sid = s.get("suggestionId", "")
    pid = s.get("parentTaskId", "")
    cid = s.get("conversationId", "")
    title = s.get("title", "")
    reason = s.get("reason", "")
    gen = s.get("generatedAt", "")
    return f"{sid} | {pid} | {cid} | {title} | {reason} | {gen}"


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="review_followup")
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--approve", help="Approve suggestionId")
    group.add_argument("--reject", help="Reject suggestionId")
    group.add_argument("--list-pending", action="store_true", help="List pending suggestions")
    parser.add_argument("--file", help="Path to followup suggestions JSONL file (overrides FOLLOWUP_SUGGESTIONS_FILE)")
    parser.add_argument("--decisions-file", help="Path to decisions JSONL file (overrides FOLLOWUP_DECISIONS_FILE)")
    parser.add_argument("--json", dest="as_json", action="store_true", help="Output JSON for list-pending")
    args = parser.parse_args(argv)

    if args.file:
        os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = args.file
    if args.decisions_file:
        os.environ["FOLLOWUP_DECISIONS_FILE"] = args.decisions_file

    try:
        from reviewer import followup_store, followup_approval
    except Exception as exc:
        print(f"Failed to import reviewer modules: {exc}", file=sys.stderr)
        return 2

    try:
        if args.approve:
            stored = followup_approval.approve_suggestion(args.approve)
            print(json.dumps(stored, ensure_ascii=False))
            return 0
        if args.reject:
            stored = followup_approval.reject_suggestion(args.reject)
            print(json.dumps(stored, ensure_ascii=False))
            return 0
        if args.list_pending:
            suggestions = followup_store.list_suggestions()
            decided_ids = followup_approval.get_decided_suggestion_ids()
            pending = [s for s in suggestions if s.get("suggestionId") not in decided_ids]
            if args.as_json:
                print(json.dumps(pending, ensure_ascii=False, indent=2))
                return 0
            for s in pending:
                print(_human_line(s))
            return 0
    except Exception as exc:
        print(f"Operation failed: {exc}", file=sys.stderr)
        return 3

    return 0


if __name__ == "__main__":
    raise SystemExit(main())