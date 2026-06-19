"""Agent registry service: maintains in-memory view of agents and persists to storage file.

Stale agents are those not seen for STALE_SECONDS (default 300s)
"""
from __future__ import annotations

import json
import logging
import threading
import time
from datetime import datetime, timezone
from typing import Dict, Optional, Any, List

from registry.schema import AgentStatus

logger = logging.getLogger(__name__)

STALE_SECONDS = 300  # 5 minutes


class AgentRegistry:
    def __init__(self, storage_path: Optional[str] = None) -> None:
        self._agents: Dict[str, AgentStatus] = {}
        self._lock = threading.Lock()
        self.storage_path = storage_path

    def ingest_heartbeat(self, payload: Dict[str, Any]) -> None:
        try:
            status = AgentStatus.from_dict(payload)
        except Exception as exc:
            logger.exception("Invalid heartbeat payload: %s", exc)
            return
        with self._lock:
            self._agents[status.agentId] = status
            if self.storage_path:
                try:
                    self._persist_unlocked()
                except Exception:
                    logger.exception("Failed to persist registry to %s", self.storage_path)

    def _persist_unlocked(self) -> None:
        # write out as JSON mapping agentId -> object
        data = {aid: a.to_json() for aid, a in self._agents.items()}
        with open(self.storage_path, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2)

    def load_storage(self) -> None:
        if not self.storage_path:
            return
        try:
            with open(self.storage_path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            with self._lock:
                for aid, obj in data.items():
                    try:
                        self._agents[aid] = AgentStatus.from_dict(obj)
                    except Exception:
                        logger.exception("Failed to parse agent entry %s", aid)
        except FileNotFoundError:
            return
        except Exception:
            logger.exception("Failed to load storage from %s", self.storage_path)

    def list_agents(self) -> List[AgentStatus]:
        with self._lock:
            # Perform stale cleanup
            now = datetime.utcnow().replace(tzinfo=timezone.utc)
            to_delete = []
            for aid, a in list(self._agents.items()):
                try:
                    last = datetime.fromisoformat(a.lastSeen.replace('Z', '+00:00'))
                except Exception:
                    continue
                age = (now - last).total_seconds()
                if age > STALE_SECONDS:
                    to_delete.append(aid)
            for aid in to_delete:
                logger.info("Marking agent %s stale and removing", aid)
                del self._agents[aid]
                if self.storage_path:
                    try:
                        self._persist_unlocked()
                    except Exception:
                        logger.exception("Failed to persist registry after removing %s", aid)
            return list(self._agents.values())

    def get_agent(self, agent_id: str) -> Optional[AgentStatus]:
        with self._lock:
            return self._agents.get(agent_id)
