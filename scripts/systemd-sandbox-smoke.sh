#!/usr/bin/env bash
# Smoke checks for the sandboxed systemd unit and supporting user
# - Validate unit file syntax (if systemd-analyze available)
# - Verify user exists
# - Verify run directory ownership and permissions
# - Inspect unit file for required hardening directives
# This script does NOT start the unit and does not enable execute mode.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_FILE="$REPO_ROOT/systemd/ai-dev-runner-ofbiz-sandboxed.service"
SMOKE_OK=0

if [ ! -f "$UNIT_FILE" ]; then
  echo "[smoke][error] Unit file not found: $UNIT_FILE" >&2
  exit 2
fi

echo "[smoke] Inspecting unit file: $UNIT_FILE"

# 1) systemd-analyze verify if available
if command -v systemd-analyze >/dev/null 2>&1; then
  echo "[smoke] Running systemd-analyze verify..."
  if systemd-analyze verify "$UNIT_FILE"; then
    echo "[smoke] systemd-analyze verify: OK"
  else
    echo "[smoke][warning] systemd-analyze reported issues parsing the unit file (see above)" >&2
    SMOKE_OK=1
  fi
else
  echo "[smoke] systemd-analyze not available; skipping unit syntax verification"
fi

# 2) Check user exists
USER=openhands-runner
if getent passwd "$USER" >/dev/null 2>&1; then
  echo "[smoke] User $USER exists"
else
  echo "[smoke][warning] User $USER does not exist. Run install-sandboxed-runner-user.sh as root to create it." >&2
  SMOKE_OK=1
fi

# 3) Check run directory ownership/permissions
RUN_DIR="/home/$USER/openhands-runs"
if [ -d "$RUN_DIR" ]; then
  OWNER="$(stat -c '%U:%G' "$RUN_DIR")"
  PERMS="$(stat -c '%a' "$RUN_DIR")"
  echo "[smoke] Run dir $RUN_DIR exists (owner: $OWNER, perms: $PERMS)"
  if [ "${OWNER%%:*}" != "$USER" ]; then
    echo "[smoke][warning] $RUN_DIR owner is not $USER" >&2
    SMOKE_OK=1
  fi
else
  echo "[smoke][warning] Run dir $RUN_DIR does not exist" >&2
  SMOKE_OK=1
fi

# 4) Check for required hardening directives in unit file
check_directive() {
  local name="$1"; shift
  if grep -Eq "^\s*${name}[[:space:]]*=" "$UNIT_FILE"; then
    echo "[smoke] Unit contains ${name} - OK"
  else
    echo "[smoke][warning] Unit missing ${name} directive" >&2
    SMOKE_OK=1
  fi
}

# List of directives to check
REQUIRED=("NoNewPrivileges" "PrivateTmp" "ProtectSystem" "ProtectHome" "PrivateNetwork" "RestrictAddressFamilies" "ReadWritePaths")
for d in "${REQUIRED[@]}"; do
  check_directive "$d"
done

# 5) Check that default runtime mode env vars are set to dry-run
if grep -Eq "^\s*Environment=RUNNER_MODE=dry-run" "$UNIT_FILE"; then
  echo "[smoke] RUNNER_MODE=dry-run enforced in unit - OK"
else
  echo "[smoke][warning] RUNNER_MODE not set to dry-run in unit file" >&2
  SMOKE_OK=1
fi
if grep -Eq "^\s*Environment=OPENHANDS_MODE=dry-run" "$UNIT_FILE"; then
  echo "[smoke] OPENHANDS_MODE=dry-run enforced in unit - OK"
else
  echo "[smoke][warning] OPENHANDS_MODE not set to dry-run in unit file" >&2
  SMOKE_OK=1
fi

# Summarize
if [ "$SMOKE_OK" -eq 0 ]; then
  echo "[smoke] All checks passed (note: some checks are advisory on this host)."
  exit 0
else
  echo "[smoke] Some checks raised warnings. Please review above messages." >&2
  exit 3
fi
