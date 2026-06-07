#!/usr/bin/env bash
# Real execute validation (filesystem-only)
# - Runs runner.service in execute mode and invokes a harmless OpenHands stub
# - Verifies run directory, execution-report.json, validation.txt and success

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_NAME="ai-dev-runner-ofbiz.service"

# Unique task id
TASK_ID="real-execute-$(date +%s)"
RUN_BASE="$HOME/openhands-runs"
RUN_DIR="$RUN_BASE/$TASK_ID"

echo "[validate] Starting real-execute validation smoke test"

# Stop systemd unit if active
STOPPED_UNIT=false
if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
    echo "[validate] Stopping user unit $UNIT_NAME"
    systemctl --user stop "$UNIT_NAME" || true
    STOPPED_UNIT=true
  elif systemctl is-active --quiet "$UNIT_NAME" 2>/dev/null; then
    echo "[validate] Stopping system unit $UNIT_NAME"
    sudo --non-interactive systemctl stop "$UNIT_NAME" || true
    STOPPED_UNIT=true
  else
    echo "[validate] No active $UNIT_NAME unit found; nothing to stop"
  fi
else
  echo "[validate] systemctl not available; skipping stop step"
fi

# Prepare temporary fake kafka CLI tools so we don't touch real Kafka
TMPDIR="$(mktemp -d)"
FAKE_BIN="$TMPDIR/fakebin"
mkdir -p "$FAKE_BIN"

PUBLISHED_FILE="$TMPDIR/published_results.jsonl"

# Create fake kafka-console-consumer that prints a single JSON task and exits
cat > "$FAKE_BIN/kafka-console-consumer.sh" <<EOF
#!/usr/bin/env bash
# This consumer prints exactly one task JSON and exits
# The TASK_ID variable will be expanded by the creator script when written

echo '{"taskId":"'"$TASK_ID"'","title":"Real execute validation","description":"Filesystem-only OpenHands execution validation","executionApproved":true}'
exit 0
EOF
ln -s "$FAKE_BIN/kafka-console-consumer.sh" "$FAKE_BIN/kafka-console-consumer" || true

# Create fake kafka-console-producer that writes stdin to a file
cat > "$FAKE_BIN/kafka-console-producer.sh" <<EOF
#!/usr/bin/env bash
# Fake producer: write stdin to a published file for inspection
cat - > "$PUBLISHED_FILE"
echo "[fake-producer] wrote to $PUBLISHED_FILE" >&2
exit 0
EOF
ln -s "$FAKE_BIN/kafka-console-producer.sh" "$FAKE_BIN/kafka-console-producer" || true

chmod +x "$FAKE_BIN"/*

# Ensure our fake kafka tools are used
export PATH="$FAKE_BIN:$PATH"

# Ensure the openhands stub exists
OPENHANDS_STUB="$REPO_ROOT/scripts/openhands_stub.py"
if [ ! -f "$OPENHANDS_STUB" ]; then
  echo "[validate][error] missing openhands stub at $OPENHANDS_STUB" >&2
  exit 1
fi
chmod +x "$OPENHANDS_STUB"

# Configure guarded execute-mode environment variables
export RUNNER_MODE="execute"
export OPENHANDS_MODE="execute"
export OPENHANDS_CMD="$OPENHANDS_STUB"
export OPENHANDS_ARGS=""
# Allow the stub path as an allowed command
export ALLOWED_OPENHANDS_COMMANDS="$OPENHANDS_STUB"
export EXECUTION_APPROVED="true"
# Use CLI consumer
export KAFKA_FORCE_CLI=1
# Short timeout to keep test fast
export OPENHANDS_TIMEOUT_SECONDS=10

# Run the runner service in background and wait for execution-report.json
MAX_WAIT_SECONDS=20
echo "[validate] Starting runner.service in background (waiting up to ${MAX_WAIT_SECONDS}s for execution-report.json)"
python3 -m runner.service > "$TMPDIR/runner_stdout.log" 2>&1 &
RUNNER_PID=$!

END_TIME=$((SECONDS + MAX_WAIT_SECONDS))
while [ $SECONDS -lt $END_TIME ]; do
  if [ -f "$RUN_DIR/execution-report.json" ]; then
    echo "[validate] execution-report.json detected"
    break
  fi
  sleep 0.5
done

# Give a moment for any final I/O
sleep 0.5

# Stop the runner process
kill -TERM "$RUNNER_PID" 2>/dev/null || true
wait "$RUNNER_PID" 2>/dev/null || true


# Verification
echo "[validate] Verifying run directory and outputs"
if [ -d "$RUN_DIR" ]; then
  echo "[validate] Run directory exists: $RUN_DIR"
else
  echo "[validate][error] Run directory not created: $RUN_DIR" >&2
  echo "Runner stdout:" >&2
  sed -n '1,200p' "$TMPDIR/runner_stdout.log" >&2 || true
  exit 2
fi

if [ -f "$RUN_DIR/execution-report.json" ]; then
  echo "[validate] execution-report.json found"
else
  echo "[validate][error] execution-report.json missing in $RUN_DIR" >&2
  sed -n '1,200p' "$TMPDIR/runner_stdout.log" >&2 || true
  exit 3
fi

if [ -f "$RUN_DIR/validation.txt" ]; then
  echo "[validate] validation.txt found"
else
  echo "[validate][error] validation.txt missing in $RUN_DIR" >&2
  sed -n '1,200p' "$TMPDIR/runner_stdout.log" >&2 || true
  exit 4
fi

# Check execution-report.json contains completed status
if grep -q '"status"[[:space:]]*:[[:space:]]*"completed"' "$RUN_DIR/execution-report.json"; then
  echo "[validate] execution-report.json indicates completed"
else
  echo "[validate][error] execution-report.json does not indicate completed" >&2
  echo "execution-report.json contents:" >&2
  sed -n '1,200p' "$RUN_DIR/execution-report.json" >&2 || true
  exit 5
fi

# Verify result published by fake producer references run dir
if [ -f "$PUBLISHED_FILE" ]; then
  echo "[validate] Published result captured at $PUBLISHED_FILE"
  if grep -q "$(echo "$RUN_DIR" | sed 's/\//\\\//g')" "$PUBLISHED_FILE"; then
    echo "[validate] Published result references run directory"
  else
    echo "[validate][error] Published result does not reference run directory" >&2
    sed -n '1,200p' "$PUBLISHED_FILE" >&2 || true
    exit 6
  fi
else
  echo "[validate][error] No published result file found: $PUBLISHED_FILE" >&2
  exit 7
fi

# Teardown: restart systemd runner if we stopped it earlier
if [ "$STOPPED_UNIT" = true ]; then
  echo "[validate] Restarting $UNIT_NAME in its default (dry-run) mode"
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl --user status "$UNIT_NAME" >/dev/null 2>&1; then
      systemctl --user start "$UNIT_NAME" || systemctl start "$UNIT_NAME" || true
    else
      systemctl start "$UNIT_NAME" || true
    fi
  else
    echo "[validate] systemctl not available; cannot restart $UNIT_NAME. Please restart manually."
  fi
fi

# Success
echo "[validate] Real execute validation completed successfully"

echo "[validate] Temporary artifacts in $TMPDIR (remove when no longer needed)"
exit 0
