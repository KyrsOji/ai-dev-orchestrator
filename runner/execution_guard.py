"""Execution guard for OpenHands execution safety.

Enforces:
- task executionApproved flag (or EXECUTION_APPROVED env var)
- allowed commands via ALLOWED_OPENHANDS_COMMANDS (comma-separated)
- max runtime via MAX_EXECUTION_SECONDS
- max run directory size via MAX_RUN_DIRECTORY_MB (in MB)
- max run directory file count via MAX_RUN_FILES

This module is conservative by default and is intended to be used by the
runner/service before any real OpenHands execution is attempted.
"""

from __future__ import annotations

import os
import shlex
import logging
from typing import Any, Dict, Tuple


LOG = logging.getLogger(__name__)


def _is_execution_approved(task: Dict[str, Any]) -> bool:
    """Return True when the task or environment explicitly approves execution.

    Checks task['executionApproved'] first (boolean or truthy string), then
    falls back to the EXECUTION_APPROVED environment variable.
    """
    v = task.get("executionApproved")
    if v is True:
        return True
    if isinstance(v, str) and v.lower() in ("1", "true", "yes", "y"):
        return True
    env_v = os.environ.get("EXECUTION_APPROVED", "").lower()
    if env_v in ("1", "true", "yes", "y"):
        return True
    return False


def _parse_allowed_commands() -> list[str]:
    """Return a list of allowed command strings from env var.

    The environment variable ALLOWED_OPENHANDS_COMMANDS is expected to be a
    comma-separated list of allowed commands. Entries are compared against the
    full command string and against the base executable token.
    """
    raw = os.environ.get("ALLOWED_OPENHANDS_COMMANDS", "")
    if not raw:
        return []
    parts = [p.strip() for p in raw.split(",") if p.strip()]
    return parts


def _is_command_allowed() -> Tuple[bool, Dict[str, Any]]:
    """Validate the configured OPENHANDS command/args against the whitelist.

    Returns (True, meta) when allowed, otherwise (False, meta) with a reason.
    """
    cmd = os.environ.get("OPENHANDS_CMD", "python3 -m openhands")
    args = os.environ.get("OPENHANDS_ARGS", "")
    try:
        cmd_list = shlex.split(cmd) + shlex.split(args)
    except Exception:
        cmd_list = [cmd] + (shlex.split(args) if args else [])
    full_cmd = " ".join(cmd_list)

    allowed_list = _parse_allowed_commands()
    if not allowed_list:
        return False, {"reason": "no_allowed_commands_configured", "detail": "ALLOWED_OPENHANDS_COMMANDS is empty"}

    # Exact match or prefix match or base executable match
    for allowed in allowed_list:
        if full_cmd == allowed:
            return True, {"allowed_command": allowed}
        if full_cmd.startswith(allowed + " "):
            return True, {"allowed_command": allowed}
        if cmd_list and cmd_list[0] == allowed:
            return True, {"allowed_command": allowed}
    # Also allow if an allowed entry matches the first two tokens
    for allowed in allowed_list:
        if " " in allowed and full_cmd.startswith(allowed):
            return True, {"allowed_command": allowed}

    return False, {"reason": "command_not_allowed", "full_cmd": full_cmd, "allowed": allowed_list}


def _dir_size_and_count(path: str) -> Tuple[int, int]:
    """Return (total_bytes, file_count) for path (recurses into subdirs).

    Errors reading individual files are ignored; they are skipped.
    """
    total = 0
    files = 0
    for root, _dirs, filenames in os.walk(path):
        for fn in filenames:
            fp = os.path.join(root, fn)
            try:
                st = os.stat(fp)
            except Exception:
                continue
            total += st.st_size
            files += 1
    return total, files


def guard_execution(task: Dict[str, Any], run_dir: str) -> Tuple[bool, Dict[str, Any]]:
    """Run all guard checks and return (allowed, meta).

    meta contains diagnostic information and a 'reason' key when blocked.
    """
    # 1) execution approved
    if not _is_execution_approved(task):
        return False, {"reason": "execution_not_approved", "detail": "Task missing executionApproved=true and EXECUTION_APPROVED env var not set."}

    # 2) allowed command
    ok_cmd, cmd_meta = _is_command_allowed()
    if not ok_cmd:
        return False, cmd_meta

    # 3) run directory size and file count
    try:
        max_mb = int(os.environ.get("MAX_RUN_DIRECTORY_MB", "100"))
    except Exception:
        max_mb = 100
    try:
        max_files = int(os.environ.get("MAX_RUN_FILES", "1000"))
    except Exception:
        max_files = 1000

    try:
        total_bytes, file_count = _dir_size_and_count(run_dir)
    except Exception as e:
        return False, {"reason": "run_dir_unreadable", "detail": str(e)}

    size_mb = total_bytes / (1024.0 * 1024.0)
    if size_mb > max_mb:
        return False, {"reason": "run_directory_too_large", "size_mb": round(size_mb, 2), "max_mb": max_mb}
    if file_count > max_files:
        return False, {"reason": "run_directory_too_many_files", "file_count": file_count, "max_files": max_files}

    # 4) execution timeout
    try:
        requested_timeout = int(os.environ.get("OPENHANDS_TIMEOUT_SECONDS", str(os.environ.get("OPENHANDS_TIMEOUT_SECONDS", "1800"))))
    except Exception:
        requested_timeout = int(os.environ.get("OPENHANDS_TIMEOUT_SECONDS", "1800"))
    try:
        max_exec = int(os.environ.get("MAX_EXECUTION_SECONDS", str(requested_timeout)))
    except Exception:
        max_exec = requested_timeout
    if requested_timeout > max_exec:
        return False, {"reason": "timeout_exceeds_max", "requested_timeout": requested_timeout, "max_allowed": max_exec}

    # All checks passed
    meta = {
        "reason": "allowed",
        "allowed_command_meta": cmd_meta,
        "size_mb": round(size_mb, 2),
        "file_count": file_count,
        "requested_timeout": requested_timeout,
    }
    return True, meta
