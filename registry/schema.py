"""Agent status schema and helpers.
"""
from __future__ import annotations

import dataclasses
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any


@dataclass
class AgentStatus:
    agentId: str
    hostname: str
    roles: List[str]
    status: str
    cpuCount: int
    memoryGb: float
    diskFreeGb: float
    loadAverage: float
    lastSeen: str

    def to_json(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def now(cls, agentId: str, hostname: str, roles: List[str], status: str, cpuCount: int, memoryGb: float, diskFreeGb: float, loadAverage: float) -> "AgentStatus":
        # ISO8601 UTC with Z
        last_seen = datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace('+00:00','Z')
        return cls(agentId=agentId, hostname=hostname, roles=roles, status=status, cpuCount=cpuCount, memoryGb=memoryGb, diskFreeGb=diskFreeGb, loadAverage=loadAverage, lastSeen=last_seen)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AgentStatus":
        # perform basic normalization
        roles = d.get("roles") or []
        if isinstance(roles, str):
            roles = [r.strip() for r in roles.split(",") if r.strip()]
        return cls(
            agentId=str(d.get("agentId")),
            hostname=str(d.get("hostname")),
            roles=list(roles),
            status=str(d.get("status")),
            cpuCount=int(d.get("cpuCount", 0)),
            memoryGb=float(d.get("memoryGb", 0.0)),
            diskFreeGb=float(d.get("diskFreeGb", 0.0)),
            loadAverage=float(d.get("loadAverage", 0.0)),
            lastSeen=str(d.get("lastSeen")),
        )
