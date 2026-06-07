#!/usr/bin/env bash
# Smoke test: guarded execute-mode simulation for OFBiz runner
# - Stops systemd runner if running
# - Configures environment to run in execute mode using /bin/echo as OpenHands
# - Uses fake kafka console consumer/producer in PATH to avoid touching real Kafka
# - Runs `python3 -m runner.service` with a timeout
# - Verifies run directory and execution-report.json created and result published
# - Restarts systemd runner back in dry-run mode

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
UNIT_NAME="ai-dev-runner-ofbiz.service"

echo "[smoke] Starting execute-mode simulation smoke test"

# Try to stop systemd unit if active (user unit preferred)
STOPPED_UNIT=false
if command -v systemctl >/dev/null 2>&1; then
  if systemctl --user is-active --quiet "$UNIT_NAME" 2>/dev/null; then
    echo "[smoke] Stopping user unit $UNIT_NAME"
    systemctl --user stop "$UNIT_NAME" || true
    STOPPED_UNIT=true
  elif systemctl is-active --quiet "$UNIT_NAME" 2>/dev/null; then
    echo "[smoke] Stopping system unit $UNIT_NAME"
    systemctl stop "$UNIT_NAME" || true
    STOPPED_UNIT=true
  else
    echo "[smoke] No active $UNIT_NAME unit found; nothing to stop"
  fi
else
  echo "[smoke] systemctl not available; skipping stop step"
fi

# Create a temporary bin directory to host fake kafka console consumer/producer
TMPDIR="$(mktemp -d)"
FAKE_BIN="$TMPDIR/fakebin"
mkdir -p "$FAKE_BIN"

# Choose a deterministic task id for verification
TASK_ID="execute-smoke-$(date +%s)"
RUN_BASE="$HOME/openhands-runs"
RUN_DIR="$RUN_BASE/$TASK_ID"

echo "[smoke] Using TMPDIR=$TMPDIR"
echo "[smoke] TASK_ID=$TASK_ID"

# Create fake kafka-console-consumer that prints one JSON task and exits
cat > "$FAKE_BIN/kafka-console-consumer.sh" <<EOF
#!/usr/bin/env bash
# Fake kafka-console-consumer: prints a single JSON task then exits
# Arguments are ignored. This script is intentionally simple.
echo '{"taskId":"$TASK_ID","title":"Execute mode simulation","description":"Smoke test run","executionApproved":true}'
exit 0
EOF

# Provide also the alternate binary name without .sh
ln -s "$FAKE_BIN/kafka-console-consumer.sh" "$FAKE_BIN/kafka-console-consumer" || true

# Create fake kafka-console-producer that writes the published payload to a file
PUBLISHED_FILE="$TMPDIR/published_results.jsonl"
cat > "$FAKE_BIN/kafka-console-producer.sh" <<EOF
#!/usr/bin/env bash
# Fake kafka-console-producer: write stdin to PUBLISHED_FILE and exit 0
cat - > "$PUBLISHED_FILE"
# Mirror stdout/stderr behavior
echo "[fake-producer] wrote to $PUBLISHED_FILE" >&2
exit 0
EOF
ln -s "$FAKE_BIN/kafka-console-producer.sh" "$FAKE_BIN/kafka-console-producer" || true

chmod +x "$FAKE_BIN"/*

# Prepend fake bin to PATH so runner finds our fake kafka tools
export PATH="$FAKE_BIN:$PATH"

# Set guarded execute-mode environment variables (do not run real OpenHands)
export RUNNER_MODE="execute"
export OPENHANDS_MODE="execute"
export OPENHANDS_CMD="/bin/echo"
export OPENHANDS_ARGS="SIMULATED_OPENHANDS_EXECUTION"
export ALLOWED_OPENHANDS_COMMANDS="/bin/echo"
export EXECUTION_APPROVED="true"
# Ensure CLI consumer is used
export KAFKA_FORCE_CLI=1

# Run the service with timeout (will be killed after timeout)
TIMEOUT_SECONDS=20
echo "[smoke] Running runner.service for ${TIMEOUT_SECONDS}s (timeout)"
if command -v timeout >/dev/null 2>&1; then
  timeout --preserve-status ${TIMEOUT_SECONDS}s python3 -m runner.service > "$TMPDIR/runner_stdout.log" 2>&1 || true
else
  # Fallback: run and allow user to interrupt; this should not hang in CI
  python3 -m runner.service > "$TMPDIR/runner_stdout.log" 2>&1 &
  PID=$!
  sleep ${TIMEOUT_SECONDS}
  kill -TERM "$PID" 2>/dev/null || true
fi

# Verification
echo "[smoke] Verifying run directory and execution report"
if [ -d "$RUN_DIR" ]; then
  echo "[smoke] Run directory exists: $RUN_DIR"
else
  echo "[smoke][error] Run directory not created: $RUN_DIR" >&2
  exit 2
fi

if [ -f "$RUN_DIR/execution-report.json" ]; then
  echo "[smoke] execution-report.json found"
else
  echo "[smoke][error] execution-report.json missing in $RUN_DIR" >&2
  echo "Contents of $TMPDIR/runner_stdout.log:" >&2
  sed -n '1,200p' "$TMPDIR/runner_stdout.log" >&2 || true
  exit 3
fi

# Verify the result was published via fake producer
if [ -f "$PUBLISHED_FILE" ]; then
  echo "[smoke] Result published file exists: $PUBLISHED_FILE"
  # Quick check: ensure the published JSON references the run directory path
  if grep -q "$(echo "$RUN_DIR" | sed 's/\//\\\//g')" "$PUBLISHED_FILE"; then
    echo "[smoke] Published result references run directory"
  else
    echo "[smoke][error] Published result does not reference run directory" >&2
    echo "Published content:" >&2
    sed -n '1,200p' "$PUBLISHED_FILE" >&2 || true
    exit 4
  fi
else
  echo "[smoke][error] No published result file found: $PUBLISHED_FILE" >&2
  exit 5
fi

# Teardown: restart systemd runner if we stopped it earlier
if [ "$STOPPED_UNIT" = true ]; then
  echo "[smoke] Restarting $UNIT_NAME in its default (dry-run) mode"
  if command -v systemctl >/dev/null 2>&1; then
    if systemctl --user status "$UNIT_NAME" >/dev/null 2>&1; then
      systemctl --user start "$UNIT_NAME" || systemctl start "$UNIT_NAME" || true
    else
      # Try non-user start
      systemctl start "$UNIT_NAME" || true
    fi
  else
    echo "[smoke] systemctl not available; cannot restart $UNIT_NAME. Please restart manually."
  fi
fi

# Success
echo "[smoke] Execute-mode simulation smoke test completed successfully"

echo "[smoke] Temporary artifacts in $TMPDIR (remove when no longer needed)"
exit 0
