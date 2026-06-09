"""Matrix client for the approval bridge.

This module implements a thin, dependency-free Matrix client using the
Client-Server REST API. It prefers the requests package when available and
falls back to urllib. The client supports posting messages to a room and
polling /sync for new room messages.

Security notes:
- The access token is never logged or printed.
- Only task IDs, policies and short decision summaries are logged.

The client is intentionally minimal and suitable for smoke-testing and
simple bridge use-cases. For production deployments a full-featured
Matrix client library (e.g. matrix-nio) is recommended.
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple

try:
    import requests  # type: ignore
    _HAS_REQUESTS = True
except Exception:
    _HAS_REQUESTS = False

import urllib.request
import urllib.parse

logger = logging.getLogger(__name__)


class MatrixClient:
    """Minimal Matrix client using REST API.

    Methods:
    - post_message(room_id, body) -> (success, meta)
    - sync(since=None, timeout_ms=30000) -> (sync_json, next_batch or None)
    - get_room_messages_from_sync(sync_json, room_id) -> list of message events
    - whoami() -> user_id or None
    """

    def __init__(
        self,
        homeserver: str,
        access_token: str,
        room_id: str,
        timeout_s: int = 10,
        verify_ssl: bool = True,
    ) -> None:
        self.homeserver = homeserver.rstrip("/")
        self._token = access_token
        self.room_id = room_id
        self.timeout_s = timeout_s
        self.verify_ssl = verify_ssl
        # cache last sync token
        self._last_batch: Optional[str] = None
        self._user_id: Optional[str] = None

    # Internal helper to perform HTTP requests without leaking token
    def _request(self, method: str, path: str, params: Optional[Dict[str, Any]] = None, data: Optional[Any] = None, timeout: Optional[int] = None) -> Tuple[Optional[Dict[str, Any]], Dict[str, Any]]:
        url = f"{self.homeserver}{path}"
        headers = {"Authorization": f"Bearer {self._token}", "Content-Type": "application/json"}
        timeout = timeout or self.timeout_s
        meta: Dict[str, Any] = {"url": url, "method": method}

        try:
            if _HAS_REQUESTS:
                opts: Dict[str, Any] = {"headers": headers, "timeout": timeout}
                if not self.verify_ssl:
                    opts["verify"] = False
                if method.upper() == "GET":
                    resp = requests.get(url, params=params, **opts)
                else:
                    payload = json.dumps(data) if data is not None else None
                    resp = requests.request(method.upper(), url, params=params, data=payload, **opts)
                meta.update({"status_code": resp.status_code})
                try:
                    return resp.json(), meta
                except Exception:
                    return None, meta

            # Fallback: urllib
            if params:
                query = urllib.parse.urlencode(params)
                url = f"{url}?{query}"
            req = urllib.request.Request(url, method=method.upper())
            for k, v in headers.items():
                req.add_header(k, v)
            if data is not None:
                body = json.dumps(data).encode("utf-8")
            else:
                body = None
            with urllib.request.urlopen(req, data=body, timeout=timeout) as fh:  # type: ignore
                raw = fh.read()
                try:
                    parsed = json.loads(raw.decode("utf-8"))
                    meta.update({"status_code": fh.getcode()})
                    return parsed, meta
                except Exception:
                    meta.update({"status_code": fh.getcode()})
                    return None, meta
        except Exception as exc:
            logger.debug("Matrix HTTP request failed: %s", exc)
            meta.update({"error": str(exc), "errorType": type(exc).__name__})
            return None, meta

    def post_message(self, body: str) -> Tuple[bool, Optional[Dict[str, Any]], Dict[str, Any]]:
        """Post a simple text message to the configured room.

        Returns (success, parsed_response_or_None, meta).
        parsed response may include 'event_id' when the homeserver returns it.
        """
        txn = uuid.uuid4().hex
        path = f"/_matrix/client/v3/rooms/{urllib.parse.quote(self.room_id)}/send/m.room.message/{txn}"
        content = {"msgtype": "m.text", "body": body}
        # Do not log the content if it may contain secrets; assume body is safe to log as short summary
        logger.info("Posting message to Matrix room=%s summary=%s", self.room_id, (body[:120] + "...") if len(body) > 120 else body)
        parsed, meta = self._request("PUT", path, data=content)
        if parsed is None:
            return False, None, meta
        return True, parsed, meta

    def sync(self, timeout_ms: int = 30000) -> Tuple[Optional[Dict[str, Any]], Optional[str], Dict[str, Any]]:
        """Call /sync and return (parsed_json_or_None, next_batch_or_None, meta).
        """
        params = {"timeout": timeout_ms}
        if self._last_batch:
            params["since"] = self._last_batch
        logger.debug("Matrix.sync called for room=%s since_set=%s timeout_ms=%s", self.room_id, bool(self._last_batch), timeout_ms)
        parsed, meta = self._request("GET", "/_matrix/client/v3/sync", params=params, timeout=timeout_ms // 1000)
        if parsed and isinstance(parsed, dict):
            next_batch = parsed.get("next_batch")
            # update last_batch only when we get a next_batch token
            if next_batch:
                self._last_batch = next_batch
            logger.debug("Matrix.sync returned next_batch_set=%s meta_status=%s", bool(next_batch), (meta.get('status_code') if isinstance(meta, dict) else None))
            return parsed, next_batch, meta
        return None, None, meta

    def get_event(self, event_id: str) -> Optional[Dict[str, Any]]:
        """Fetch a single event by id from the configured room.

        Returns the event JSON (including 'content') or None.
        """
        if not event_id:
            return None
        path = f"/_matrix/client/v3/rooms/{urllib.parse.quote(self.room_id)}/event/{urllib.parse.quote(event_id)}"
        parsed, meta = self._request("GET", path)
        if parsed and isinstance(parsed, dict):
            return parsed
        return None


    def get_room_messages_from_sync(self, sync_json: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Extract m.room.message events from a sync JSON for the configured room.

        Returns a list of events with keys: event_id, sender, body, origin_server_ts
        """
        out: List[Dict[str, Any]] = []
        if not sync_json:
            return out
        rooms = sync_json.get("rooms", {})
        join = rooms.get("join", {})
        room = join.get(self.room_id, {})
        timeline = room.get("timeline", {})
        events = timeline.get("events", [])
        for ev in events:
            if ev.get("type") != "m.room.message":
                continue
            content = ev.get("content", {})
            body = content.get("body")
            if not body:
                continue
            # Try to extract reply-to information if present
            in_reply_to = None
            relates_to = content.get("m.relates_to")
            if isinstance(relates_to, dict):
                # First, support the nested m.in_reply_to shape
                in_reply = relates_to.get("m.in_reply_to")
                if isinstance(in_reply, dict):
                    in_reply_to = in_reply.get("event_id")
                else:
                    # Also support the alternative rel_type/event_id shape:
                    # {"rel_type": "m.in_reply_to", "event_id": "$..."}
                    rel_type = relates_to.get("rel_type")
                    if rel_type == "m.in_reply_to" and isinstance(relates_to.get("event_id"), str):
                        in_reply_to = relates_to.get("event_id")
            out.append({
                "event_id": ev.get("event_id"),
                "sender": ev.get("sender"),
                "body": body,
                "origin_server_ts": ev.get("origin_server_ts"),
                "in_reply_to": in_reply_to,
                "relates_to": relates_to if isinstance(relates_to, dict) else None,
            })
        return out

    def whoami(self) -> Optional[str]:
        """Try to return the user id for the configured access token. Caches the value."""
        if self._user_id:
            return self._user_id
        parsed, meta = self._request("GET", "/_matrix/client/v3/account/whoami")
        if parsed and isinstance(parsed, dict):
            uid = parsed.get("user_id")
            if uid:
                self._user_id = uid
                return uid
        return None

    def poll_commands(self, timeout_s: int = 10, ignore_last_batch: bool = False) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Poll for new room messages using /sync and return parsed message objects and meta.

        This is a convenience wrapper that calls sync(timeout_ms=timeout_s*1000)
        and extracts room messages.
        """
        # Optionally ignore any stored last_batch for this poll so callers can perform a full timeline sync
        orig_batch = self._last_batch
        if ignore_last_batch:
            logger.debug("MatrixClient.poll_commands: ignoring stored last_batch for this call")
            self._last_batch = None
        timeout_ms = max(1000, int(timeout_s * 1000))
        logger.debug("MatrixClient.poll_commands calling sync timeout_ms=%s ignore_last_batch=%s", timeout_ms, ignore_last_batch)
        parsed, next_batch, meta = self.sync(timeout_ms=timeout_ms)
        logger.debug("MatrixClient.poll_commands sync returned next_batch_set=%s meta_status=%s", bool(next_batch), (meta.get('status_code') if isinstance(meta, dict) else None))
        if parsed is None:
            # restore original batch if sync did not return a next_batch
            if ignore_last_batch and not next_batch:
                self._last_batch = orig_batch
            return [], meta
        msgs = self.get_room_messages_from_sync(parsed)
        logger.debug("MatrixClient.poll_commands extracted %d room messages", len(msgs))
        # If we ignored the previous last_batch and the sync did not provide a next_batch, restore original token
        if ignore_last_batch and not next_batch:
            self._last_batch = orig_batch
        return msgs, meta
