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

# Run the wrapper
set +e
"$WRAPPER" "$RUN_DIR" -- "$STUB"
RC=$?
set -e

if [ $RC -eq 0 ]; then
  echo "[smoke] Wrapper ran successfully. Verifying outputs..."
  if [ -f "$RUN_DIR/validation.txt" ]; then
    if grep -q "OPENHANDS_REAL_EXECUTION_VALIDATED" "$RUN_DIR/validation.txt"; then
      echo "[smoke] validation.txt contains marker - PASS"
      exit 0
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
  # Expect wrapper to fail closed if bwrap missing; check error message
  echo "[smoke] Wrapper exited with code $RC. Checking for expected fail-closed message..."
  # We run wrapper directly, so its stderr went to console; re-run it in capture mode to inspect message
  MSG="$($WRAPPER "$RUN_DIR" -- "$STUB" 2>&1 || true)"
  echo "$MSG" | sed -n '1,200p'
  if echo "$MSG" | grep -q -i "bubblewrap\|bwrap.*not found"; then
    echo "[smoke] bwrap missing: wrapper refused to run (fail-closed) - PASS"
    exit 0
  else
    echo "[smoke][error] Wrapper failed for unexpected reason" >&2
    exit 6
  fi
fi
