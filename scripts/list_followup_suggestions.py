#!/usr/bin/env python3
"""List staged follow-up suggestions (read-only).

Usage examples:
  scripts/list_followup_suggestions.py --limit 10
  scripts/list_followup_suggestions.py --file /path/to/file.jsonl --json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from typing import List, Dict

# Ensure repo root is on sys.path so the 'reviewer' package can be imported
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
    parser = argparse.ArgumentParser(prog="list_followup_suggestions")
    parser.add_argument("--limit", type=int, default=50, help="Maximum number of suggestions to list")
    parser.add_argument("--file", help="Path to followup suggestions JSONL file (overrides FOLLOWUP_SUGGESTIONS_FILE)")
    parser.add_argument("--json", dest="as_json", action="store_true", help="Output JSON array of suggestions")
    args = parser.parse_args(argv)

    # If file override provided, set env var used by followup_store
    if args.file:
        os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = args.file

    try:
        from reviewer import followup_store
    except Exception as exc:
        print(f"Failed to import followup_store: {exc}", file=sys.stderr)
        return 2

    try:
        suggestions = followup_store.list_suggestions(limit=args.limit)
    except Exception as exc:
        # Per requirements, missing file should not error; report and return empty
        print(f"[]" if args.as_json else "", end="")
        return 0

    if args.as_json:
        print(json.dumps(suggestions, ensure_ascii=False, indent=2))
        return 0

    # Human-readable output (one line per suggestion)
    for s in suggestions:
        print(_human_line(s))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
