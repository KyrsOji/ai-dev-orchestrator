"""Manual approval actions for staged follow-up suggestions.

Decisions are appended to a JSONL file (default: /var/lib/ai-dev-runner/followup_decisions.jsonl).
Environment override: FOLLOWUP_DECISIONS_FILE

Functions:
- approve_suggestion(suggestion_id) -> dict
- reject_suggestion(suggestion_id) -> dict
- list_decisions(limit: int = 100) -> list[dict]
- get_decided_suggestion_ids() -> set
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Dict, List, Set


DEFAULT_PATH = "/var/lib/ai-dev-runner/followup_decisions.jsonl"


def _get_path() -> str:
    return os.environ.get("FOLLOWUP_DECISIONS_FILE", DEFAULT_PATH)


def _append_decision(decision: Dict[str, object]) -> Dict[str, object]:
    path = _get_path()
    stored = dict(decision)
    if "decidedAt" not in stored or not stored.get("decidedAt"):
        stored["decidedAt"] = datetime.utcnow().isoformat() + "Z"
    if "decisionId" not in stored:
        stored["decisionId"] = str(uuid.uuid4())

    dirn = os.path.dirname(path)
    if dirn:
        try:
            os.makedirs(dirn, exist_ok=True)
        except Exception:
            pass

    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(stored, ensure_ascii=False) + "\n")
        fh.flush()
        try:
            os.fsync(fh.fileno())
        except Exception:
            pass

    return stored


def approve_suggestion(suggestion_id: str) -> Dict[str, object]:
    decision = {
        "suggestionId": suggestion_id,
        "decision": "approved",
        "source": "manual-review",
    }
    return _append_decision(decision)


def reject_suggestion(suggestion_id: str) -> Dict[str, object]:
    decision = {
        "suggestionId": suggestion_id,
        "decision": "rejected",
        "source": "manual-review",
    }
    return _append_decision(decision)


def list_decisions(limit: int = 100) -> List[Dict[str, object]]:
    path = _get_path()
    if not os.path.exists(path):
        return []
    results: List[Dict[str, object]] = []
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                    if isinstance(obj, dict):
                        results.append(obj)
                except Exception:
                    continue
    except Exception:
        return []

    results.reverse()
    if limit is not None:
        return results[:limit]
    return results


def get_decided_suggestion_ids() -> Set[str]:
    ids: Set[str] = set()
    for d in list_decisions(limit=None):
        sid = d.get("suggestionId")
        if sid:
            ids.add(sid)
    return ids
