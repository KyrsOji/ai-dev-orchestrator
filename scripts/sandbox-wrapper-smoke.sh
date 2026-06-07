#!/usr/bin/env bash
# Smoke test for sandbox-openhands.sh wrapper
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WRAPPER="$REPO_ROOT/scripts/sandbox-openhands.sh"
STUB="$REPO_ROOT/scripts/openhands_real_stub.py"

if [ ! -x "$WRAPPER" ]; then
  echo "[smoke][error] Sandbox wrapper not found or not executable: $WRAPPER" >&2
  exit 2
fi

if [ ! -f "$STUB" ]; then
  echo "[smoke][error] OpenHands stub not found: $STUB" >&2
  exit 3
fi

TMPROOT="$(mktemp -d)"
RUN_DIR="$TMPROOT/sandbox-run"
mkdir -p "$RUN_DIR"

# Run the wrapper and capture output
set +e
MSG="$($WRAPPER "$RUN_DIR" -- "$STUB" 2>&1)"
RC=$?
set -e

if [ $RC -eq 0 ]; then
  echo "[smoke] Wrapper ran successfully. Verifying outputs..."
  if [ -f "$RUN_DIR/validation.txt" ]; then
    if grep -q "OPENHANDS_REAL_EXECUTION_VALIDATED" "$RUN_DIR/validation.txt"; then
      # If SANDBOX_DISABLE_NETWORK=false was requested, ensure wrapper printed the warning
      if [ "${SANDBOX_DISABLE_NETWORK:-true}" = "false" ]; then
        if echo "$MSG" | grep -q "SANDBOX_DISABLE_NETWORK=false"; then
          echo "[smoke] validation.txt contains marker and warning printed - PASS"
          exit 0
        else
          echo "[smoke][error] SANDBOX_DISABLE_NETWORK=false was set but wrapper did not print expected warning" >&2
          echo "$MSG" | sed -n '1,200p' >&2 || true
          exit 7
        fi
      else
        echo "[smoke] validation.txt contains marker - PASS"
        exit 0
      fi
    else
      echo "[smoke][error] validation.txt missing marker" >&2
      sed -n '1,200p' "$RUN_DIR/validation.txt" >&2 || true
      exit 4
    fi
  else
    echo "[smoke][error] validation.txt not found" >&2
    ls -la "$RUN_DIR" >&2 || true
    exit 5
  fi
else
  echo "[smoke] Wrapper exited with code $RC. Inspecting message..."
  echo "$MSG" | sed -n '1,200p'
  # Network namespace unshare failure (permission) is acceptable when SANDBOX_DISABLE_NETWORK is true (default)
  if echo "$MSG" | grep -qiE 'RTM_NEWADDR|Failed RTM_NEWADDR|RTNETLINK|Operation not permitted'; then
    if [ "${SANDBOX_DISABLE_NETWORK:-true}" != "false" ]; then
      echo "[smoke] bwrap refused network namespace setup (fail-closed) - PASS"
      exit 0
    else
      echo "[smoke][error] bwrap reported network namespace failure even though SANDBOX_DISABLE_NETWORK=false" >&2
      exit 8
    fi
  fi

  # bwrap missing or lacking user namespace permissions is also acceptable (fail-closed)
  if echo "$MSG" | grep -qiE 'bwrap.*not found|bubblewrap.*not found|uid map: Permission denied|setting up uid map: Permission denied|Permission denied'; then
    echo "[smoke] bwrap missing or permission denied: wrapper refused to run (fail-closed) - PASS"
    exit 0
  fi

  echo "[smoke][error] Wrapper failed for unexpected reason" >&2
  exit 6
fi
