"""Local JSONL staging store for auto-generated follow-up suggestions.

Default path: /var/lib/ai-dev-runner/followup_suggestions.jsonl
Override with environment variable: FOLLOWUP_SUGGESTIONS_FILE

Functions:
- append_suggestion(suggestion: dict) -> dict
- list_suggestions(limit: int = 50) -> list[dict]

The module tolerates missing files and ignores malformed lines on read.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime
from typing import Dict, List, Optional


DEFAULT_PATH = "/var/lib/ai-dev-runner/followup_suggestions.jsonl"


def _get_path() -> str:
    return os.environ.get("FOLLOWUP_SUGGESTIONS_FILE", DEFAULT_PATH)


def append_suggestion(suggestion: Dict[str, object]) -> Dict[str, object]:
    """Append a suggestion dict to the JSONL store.

    Ensures suggestionId and generatedAt exist; returns the stored suggestion.
    May raise exceptions on write failure.
    """
    path = _get_path()
    # Make a shallow copy to avoid mutating caller's dict
    stored: Dict[str, object] = dict(suggestion)

    if "generatedAt" not in stored or not stored.get("generatedAt"):
        stored["generatedAt"] = datetime.utcnow().isoformat() + "Z"
    if "suggestionId" not in stored or not stored.get("suggestionId"):
        stored["suggestionId"] = str(uuid.uuid4())

    # Ensure parent directory exists
    dirn = os.path.dirname(path)
    if dirn:
        try:
            os.makedirs(dirn, exist_ok=True)
        except Exception:
            # Let the caller decide how to handle permission errors
            pass

    # Append JSON line
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(stored, ensure_ascii=False) + "\n")
        fh.flush()
        try:
            os.fsync(fh.fileno())
        except Exception:
            # Ignore fsync errors
            pass

    return stored


def list_suggestions(limit: int = 50) -> List[Dict[str, object]]:
    """Return newest suggestions first, up to `limit`.

    Ignores malformed JSONL lines and tolerates missing file.
    """
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
                    # ignore malformed line
                    continue
    except Exception:
        # If the file cannot be read, return empty list
        return []

    # Return newest first (file is append-only, so reverse)
    results.reverse()
    if limit is not None:
        return results[:limit]
    return results
