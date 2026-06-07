#!/usr/bin/env bash
set -euo pipefail

UNIT_FILE="${UNIT_FILE:-/home/kojiyah/dev/ai-dev-orchestrator/systemd/ai-dev-runner-ofbiz-sandboxed.service}"
RUN_USER="${RUN_USER:-openhands-runner}"
RUN_DIR="${RUN_DIR:-/home/openhands-runner/openhands-runs}"
RUNTIME_DIR="${RUNTIME_DIR:-/opt/ai-dev-orchestrator}"
WARN=0

echo "[smoke] Inspecting unit file: $UNIT_FILE"

if [ ! -f "$UNIT_FILE" ]; then
  echo "[smoke][error] Unit file not found: $UNIT_FILE" >&2
  exit 1
fi

if command -v systemd-analyze >/dev/null 2>&1; then
  echo "[smoke] Running systemd-analyze verify..."
  if systemd-analyze verify "$UNIT_FILE"; then
    echo "[smoke] systemd-analyze verify: OK"
  else
    echo "[smoke][error] systemd-analyze verify failed" >&2
    exit 2
  fi
else
  echo "[smoke][warning] systemd-analyze not found; skipping unit syntax verification"
  WARN=1
fi

if id "$RUN_USER" >/dev/null 2>&1; then
  echo "[smoke] User $RUN_USER exists"
else
  echo "[smoke][warning] User $RUN_USER does not exist. Run install-sandboxed-runner-user.sh as root to create it." >&2
  WARN=1
fi

if [ -d "$RUN_DIR" ]; then
  OWNER="$(stat -c '%U:%G' "$RUN_DIR")"
  PERMS="$(stat -c '%a' "$RUN_DIR")"
  echo "[smoke] Run dir $RUN_DIR exists (owner: $OWNER, perms: $PERMS)"
elif command -v sudo >/dev/null 2>&1 && sudo test -d "$RUN_DIR"; then
  OWNER="$(sudo stat -c '%U:%G' "$RUN_DIR")"
  PERMS="$(sudo stat -c '%a' "$RUN_DIR")"
  echo "[smoke] Run dir $RUN_DIR exists (verified with sudo; owner: $OWNER, perms: $PERMS)"
else
  echo "[smoke][warning] Run dir $RUN_DIR does not exist or is not accessible" >&2
  WARN=1
fi

# Validate runtime directory used by the sandboxed unit
if [ -d "$RUNTIME_DIR" ]; then
  OWNER_RD="$(stat -c '%U:%G' "$RUNTIME_DIR")"
  PERMS_RD="$(stat -c '%a' "$RUNTIME_DIR")"
  echo "[smoke] Runtime dir $RUNTIME_DIR exists (owner: $OWNER_RD, perms: $PERMS_RD)"
elif command -v sudo >/dev/null 2>&1 && sudo test -d "$RUNTIME_DIR"; then
  OWNER_RD="$(sudo stat -c '%U:%G' "$RUNTIME_DIR")"
  PERMS_RD="$(sudo stat -c '%a' "$RUNTIME_DIR")"
  echo "[smoke] Runtime dir $RUNTIME_DIR exists (verified with sudo; owner: $OWNER_RD, perms: $PERMS_RD)"
else
  echo "[smoke][error] Runtime dir $RUNTIME_DIR does not exist or is not accessible" >&2
  exit 5
fi

if grep -q "^WorkingDirectory=${RUNTIME_DIR}$" "$UNIT_FILE"; then
  echo "[smoke] Unit WorkingDirectory set to $RUNTIME_DIR - OK"
else
  echo "[smoke][error] Unit WorkingDirectory not set to $RUNTIME_DIR" >&2
  exit 6
fi

if grep -q "^ReadOnlyPaths=${RUNTIME_DIR}$" "$UNIT_FILE"; then
  echo "[smoke] Unit ReadOnlyPaths includes $RUNTIME_DIR - OK"
else
  echo "[smoke][error] Unit ReadOnlyPaths does not include $RUNTIME_DIR" >&2
  exit 7
fi

for directive in \
  "NoNewPrivileges" \
  "PrivateTmp" \
  "ProtectSystem" \
  "ProtectHome" \
  "PrivateNetwork" \
  "RestrictAddressFamilies" \
  "ReadWritePaths"
do
  if grep -q "^${directive}=" "$UNIT_FILE"; then
    echo "[smoke] Unit contains $directive - OK"
  else
    echo "[smoke][warning] Unit missing $directive" >&2
    WARN=1
  fi
done

if grep -q '^Environment=RUNNER_MODE=dry-run' "$UNIT_FILE"; then
  echo "[smoke] RUNNER_MODE=dry-run enforced in unit - OK"
else
  echo "[smoke][error] RUNNER_MODE=dry-run not found in unit" >&2
  exit 3
fi

if grep -q '^Environment=OPENHANDS_MODE=dry-run' "$UNIT_FILE"; then
  echo "[smoke] OPENHANDS_MODE=dry-run enforced in unit - OK"
else
  echo "[smoke][error] OPENHANDS_MODE=dry-run not found in unit" >&2
  exit 4
fi

if [ "$WARN" -eq 0 ]; then
  echo "[smoke] Systemd sandbox smoke checks passed"
else
  echo "[smoke] Some checks raised warnings. Please review above messages."
  exit 3
fi
