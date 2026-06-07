#!/usr/bin/env bash
set -euo pipefail

UNIT_FILE="${UNIT_FILE:-/home/kojiyah/dev/ai-dev-orchestrator/systemd/ai-dev-runner-ofbiz-sandboxed.service}"
LOG_DIR="${LOG_DIR:-/home/openhands-runner/ai-dev-runner-logs}"
WARN=0

echo "[logging-smoke] Inspecting unit file: $UNIT_FILE"

if [ ! -f "$UNIT_FILE" ]; then
  echo "[logging-smoke][error] Unit file not found: $UNIT_FILE" >&2
  exit 1
fi

# Check unit contains Environment=RUNNER_LOG_DIR
if grep -q "^Environment=RUNNER_LOG_DIR=${LOG_DIR}$" "$UNIT_FILE"; then
  echo "[logging-smoke] Unit contains Environment=RUNNER_LOG_DIR=$LOG_DIR - OK"
else
  echo "[logging-smoke][error] Unit does not set RUNNER_LOG_DIR=$LOG_DIR" >&2
  exit 2
fi

# Check unit contains ReadWritePaths including the log dir
if grep -q "^ReadWritePaths=.*${LOG_DIR}" "$UNIT_FILE"; then
  echo "[logging-smoke] Unit ReadWritePaths includes $LOG_DIR - OK"
else
  echo "[logging-smoke][error] Unit ReadWritePaths does not include $LOG_DIR" >&2
  exit 3
fi

# Check that log directory exists and is accessible
if [ -d "$LOG_DIR" ]; then
  OWNER="$(stat -c '%U:%G' "$LOG_DIR")"
  PERMS="$(stat -c '%a' "$LOG_DIR")"
  echo "[logging-smoke] Log dir $LOG_DIR exists (owner: $OWNER, perms: $PERMS)"
elif command -v sudo >/dev/null 2>&1 && sudo test -d "$LOG_DIR"; then
  OWNER="$(sudo stat -c '%U:%G' "$LOG_DIR")"
  PERMS="$(sudo stat -c '%a' "$LOG_DIR")"
  echo "[logging-smoke] Log dir $LOG_DIR exists (verified with sudo; owner: $OWNER, perms: $PERMS)"
else
  echo "[logging-smoke][error] Log dir $LOG_DIR does not exist or is not accessible" >&2
  exit 4
fi

# If the openhands-runner user exists, verify they can write to the directory
if id "openhands-runner" >/dev/null 2>&1; then
  if sudo -u openhands-runner test -w "$LOG_DIR"; then
    echo "[logging-smoke] openhands-runner can write to $LOG_DIR - OK"
  else
    echo "[logging-smoke][warning] openhands-runner cannot write to $LOG_DIR" >&2
    WARN=1
  fi
else
  echo "[logging-smoke][warning] User openhands-runner does not exist" >&2
  WARN=1
fi

if [ "$WARN" -eq 0 ]; then
  echo "[logging-smoke] Logging smoke checks passed"
  exit 0
else
  echo "[logging-smoke] Logging smoke checks passed with warnings"
  exit 0
fi
