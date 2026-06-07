#!/usr/bin/env bash
# Smoke test to validate the sandboxed systemd runner consumed a Kafka task
# and produced run artifacts under the host-writable RUNNER_BASE_DIR.
set -euo pipefail

UNIT_NAME="${UNIT_NAME:-ai-dev-runner-ofbiz-sandboxed.service}"
TASK_ID="${TASK_ID:-}"

if [ -z "$TASK_ID" ]; then
  echo "[usage] TASK_ID environment variable must be set. Example: TASK_ID=abcd-1234 $0"
  exit 2
fi

PASS=0
FAIL=0

echo "[smoke] Validating systemd unit: $UNIT_NAME"
if systemctl is-active --quiet "$UNIT_NAME"; then
  echo "[smoke] Service $UNIT_NAME is running"
else
  echo "[smoke][FAIL] Service $UNIT_NAME is not active"
  exit 1
fi

# Inspect configured Environment properties from systemd
ENV_LINE="$(systemctl show -p Environment "$UNIT_NAME" | sed 's/^Environment=//')"
# Parse space-separated key=value pairs
RUNNER_MODE_SET=0
OPENHANDS_MODE_SET=0
RUNNER_BASE=""
RUNNER_LOG_DIR=""
for kv in $ENV_LINE; do
  case "$kv" in
    RUNNER_MODE=*)
      val="${kv#RUNNER_MODE=}"
      if [ "$val" = "dry-run" ]; then
        RUNNER_MODE_SET=1
      fi
      ;;
    OPENHANDS_MODE=*)
      val="${kv#OPENHANDS_MODE=}"
      if [ "$val" = "dry-run" ]; then
        OPENHANDS_MODE_SET=1
      fi
      ;;
    RUNNER_BASE_DIR=*)
      RUNNER_BASE="${kv#RUNNER_BASE_DIR=}"
      ;;
    RUNNER_LOG_DIR=*)
      RUNNER_LOG_DIR="${kv#RUNNER_LOG_DIR=}"
      ;;
  esac
done

if [ "$RUNNER_MODE_SET" -eq 1 ]; then
  echo "[smoke] RUNNER_MODE=dry-run enforced in unit - OK"
else
  echo "[smoke][FAIL] RUNNER_MODE=dry-run not found in unit Environment"; FAIL=$((FAIL+1))
fi

if [ "$OPENHANDS_MODE_SET" -eq 1 ]; then
  echo "[smoke] OPENHANDS_MODE=dry-run enforced in unit - OK"
else
  echo "[smoke][FAIL] OPENHANDS_MODE=dry-run not found in unit Environment"; FAIL=$((FAIL+1))
fi

# Determine run base directory: prefer RUNNER_BASE_DIR from unit, otherwise default
if [ -z "$RUNNER_BASE" ]; then
  RUNNER_BASE="/var/lib/ai-dev-runner/openhands-runs"
  echo "[smoke] RUNNER_BASE_DIR not set in unit; defaulting to $RUNNER_BASE"
else
  echo "[smoke] RUNNER_BASE_DIR from unit: $RUNNER_BASE"
fi

RUN_DIR="$RUNNER_BASE/$TASK_ID"

echo "[smoke] Checking run directory: $RUN_DIR"
if [ -d "$RUN_DIR" ]; then
  echo "[smoke] Run directory exists: $RUN_DIR"
else
  echo "[smoke][FAIL] Run directory not found: $RUN_DIR"; FAIL=$((FAIL+1))
fi

# Check expected files
TASK_JSON="$RUN_DIR/task.json"
TASK_MD="$RUN_DIR/task.md"
REPORT_JSON="$RUN_DIR/runner-report.json"

if [ -f "$TASK_JSON" ]; then
  echo "[smoke] Found task.json"
  # Optionally validate JSON
  if python3 -m json.tool "$TASK_JSON" >/dev/null 2>&1; then
    echo "[smoke] task.json appears to be valid JSON"
  else
    echo "[smoke][warning] task.json is not valid JSON or python3 json.tool failed"
  fi
else
  echo "[smoke][FAIL] task.json missing in run directory"; FAIL=$((FAIL+1))
fi

if [ -f "$TASK_MD" ]; then
  echo "[smoke] Found task.md"
else
  echo "[smoke][FAIL] task.md missing in run directory"; FAIL=$((FAIL+1))
fi

if [ -f "$REPORT_JSON" ]; then
  echo "[smoke] Found runner-report.json (optional): $REPORT_JSON"
else
  echo "[smoke] runner-report.json not present (optional)"
fi

# Verify no files were written under /home/kojiyah/openhands-runs
ALT_HOME_RUNS="/home/kojiyah/openhands-runs"
if [ -d "$ALT_HOME_RUNS" ]; then
  if find "$ALT_HOME_RUNS" -mindepth 1 -print -quit | grep -q .; then
    echo "[smoke][FAIL] Unexpected files found under $ALT_HOME_RUNS"; FAIL=$((FAIL+1))
  else
    echo "[smoke] No files under $ALT_HOME_RUNS - OK"
  fi
else
  echo "[smoke] $ALT_HOME_RUNS not present - OK"
fi

# Optionally check journal for evidence the runner created the run dir
if command -v journalctl >/dev/null 2>&1; then
  if journalctl -u "$UNIT_NAME" --since "5 minutes ago" | grep -q "Run directory created: .*${TASK_ID}"; then
    echo "[smoke] Journal shows runner created run directory for $TASK_ID"
  else
    echo "[smoke] No explicit 'Run directory created' message for $TASK_ID in recent journal (this is informational)"
  fi
fi

if [ "$FAIL" -eq 0 ]; then
  echo "[smoke] PASS: Kafka dry-run artifacts verified for TASK_ID=$TASK_ID"
  exit 0
else
  echo "[smoke] FAIL: One or more checks failed (count=$FAIL)"
  exit 1
fi
