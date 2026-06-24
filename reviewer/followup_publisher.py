"""Publish approved follow-up suggestions to ai.dev.approval.required.

Functions:
- get_approved_suggestions(limit: int | None = 50) -> list[dict]
- publish_approved_suggestion(suggestion: dict, publisher=None, topic: str | None = None) -> (bool, dict)

Tracking file: /var/lib/ai-dev-runner/followup_published.jsonl (override via FOLLOWUP_PUBLISHED_FILE)
"""
from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Dict, List, Optional, Set, Tuple


DEFAULT_PUBLISHED_PATH = "/var/lib/ai-dev-runner/followup_published.jsonl"


def _get_published_path() -> str:
    return os.environ.get("FOLLOWUP_PUBLISHED_FILE", DEFAULT_PUBLISHED_PATH)


def _read_published_ids() -> Set[str]:
    path = _get_published_path()
    if not os.path.exists(path):
        return set()
    ids = set()
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    sid = obj.get("suggestionId")
                    if sid:
                        ids.add(sid)
                except Exception:
                    continue
    except Exception:
        return set()
    return ids


def _append_published_record(suggestion_id: str, topic: str) -> Dict[str, object]:
    path = _get_published_path()
    record = {
        "suggestionId": suggestion_id,
        "publishedAt": datetime.utcnow().isoformat() + "Z",
        "topic": topic,
    }
    dirn = os.path.dirname(path)
    if dirn:
        try:
            os.makedirs(dirn, exist_ok=True)
        except Exception:
            pass
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
        fh.flush()
        try:
            os.fsync(fh.fileno())
        except Exception:
            pass
    return record


def get_approved_suggestions(limit: Optional[int] = 50) -> List[Dict[str, object]]:
    """Return approved suggestions that have not yet been published.

    Newest suggestions first. If limit is None, return all.
    """
    # local imports to avoid top-level dependencies in tests
    from reviewer import followup_store, followup_approval

    suggestions = followup_store.list_suggestions(limit=None)
    decisions = followup_approval.list_decisions(limit=None)

    # Build mapping of latest decision per suggestionId (newest first in decisions)
    latest_decision: Dict[str, Dict[str, object]] = {}
    for d in decisions:
        sid = d.get("suggestionId")
        if not sid:
            continue
        if sid in latest_decision:
            continue
        latest_decision[sid] = d

    approved_ids: Set[str] = {sid for sid, d in latest_decision.items() if d.get("decision") == "approved"}

    published_ids = _read_published_ids()

    filtered = [s for s in suggestions if s.get("suggestionId") in approved_ids and s.get("suggestionId") not in published_ids]

    if limit is None:
        return filtered
    return filtered[:limit]


def publish_approved_suggestion(suggestion: Dict[str, object], publisher: Optional[callable] = None, topic: Optional[str] = None) -> Tuple[bool, Dict[str, object]]:
    """Publish a single approved suggestion to the approval topic.

    Returns (success: bool, meta: dict).
    """
    if not isinstance(suggestion, dict):
        return False, {"error": "invalid_suggestion"}
    sid = suggestion.get("suggestionId")
    if not sid:
        return False, {"error": "missing_suggestionId"}

    if topic is None:
        topic = os.environ.get("FOLLOWUP_APPROVAL_TOPIC", "ai.dev.approval.required")

    # Prevent duplicate publish
    published_ids = _read_published_ids()
    if sid in published_ids:
        return False, {"error": "already_published", "suggestionId": sid}

    # Prepare payload
    payload = {
        "source": suggestion.get("source", "auto-followup"),
        "parentTaskId": suggestion.get("parentTaskId"),
        "conversationId": suggestion.get("conversationId"),
        "title": suggestion.get("title"),
        "description": suggestion.get("description"),
        "reason": suggestion.get("reason"),
        "suggestionId": sid,
        "approvalRequired": True,
    }

    # Default publisher uses runner.result_publisher.publish_result if available
    if publisher is None:
        try:
            from runner import result_publisher as _rp

            publisher = _rp.publish_result
        except Exception:
            # No default publisher available in test/runtime-free environments
            publisher = None

    if publisher is None:
        return False, {"error": "no_publisher_available"}

    try:
        success, meta = publisher(payload, topic=topic)
    except TypeError:
        # Some publishers may not accept topic kwarg
        try:
            success, meta = publisher(payload, topic)
        except Exception as e:
            return False, {"error": "publisher_exception", "exception": str(e)}
    except Exception as e:
        return False, {"error": "publisher_exception", "exception": str(e)}

    if success:
        rec = _append_published_record(sid, topic)
        return True, {"published_record": rec, "publisher_meta": meta}
    return False, {"publisher_meta": meta}
