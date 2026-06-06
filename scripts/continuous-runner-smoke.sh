#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUBLISH_SCRIPT="$REPO_ROOT/scripts/publish-ofbiz-test-task.sh"
STATUS_SCRIPT="$REPO_ROOT/scripts/status-ofbiz-runner.sh"
PIDFILE=${PIDFILE:-/tmp/ofbiz-runner.pid}

TASK_ID="ofbiz-dry-run-test"
RUN_DIR="$HOME/openhands-runs/$TASK_ID"
RESULT_TOPIC=${RESULT_TOPIC:-ai.dev.result.out}
KAFKA_BOOTSTRAP=${KAFKA_BOOTSTRAP:-kafka.yahlife.com:9095}
KAFKA_CLIENT_CONFIG=${KAFKA_CLIENT_CONFIG:-/opt/ai-dev-runner/certs/kafka-client.properties}

# Pre-check: service should be running
if command -v systemctl >/dev/null 2>&1 && systemctl is-active --quiet ai-dev-runner-ofbiz.service; then
  echo "Runner service is active via systemd"
elif [ -f "$PIDFILE" ]; then
  echo "Runner service is active via PID file"
else
  echo "Runner service does not appear to be running. Please start it first." >&2
  exit 1
fi

# Publish test task
echo "Publishing test task..."
"$PUBLISH_SCRIPT"

# Wait for run directory to appear (up to 30s)
echo "Waiting for run directory: $RUN_DIR"
for i in {1..30}; do
  if [ -d "$RUN_DIR" ]; then
    echo "Run directory found"
    FOUND_RUN_DIR=1
    break
  fi
  sleep 1
done
if [ -z "${FOUND_RUN_DIR:-}" ]; then
  echo "Run directory not created within timeout"
  exit 3
fi

# Check result published: attempt to read recent messages from result topic and search for taskId
CONSUMER_BIN=$(command -v kafka-console-consumer.sh || true)
if [ -z "$CONSUMER_BIN" ]; then
  echo "kafka-console-consumer.sh not found; cannot verify result publication"
  exit 4
fi

TMP_OUT="$(mktemp)"
# Consume up to 100 messages from the result topic (fast check)
if [ -n "$KAFKA_CLIENT_CONFIG" ]; then
  "$CONSUMER_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "$RESULT_TOPIC" --from-beginning --max-messages 100 --consumer.config "$KAFKA_CLIENT_CONFIG" > "$TMP_OUT" 2>/dev/null || true
else
  "$CONSUMER_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "$RESULT_TOPIC" --from-beginning --max-messages 100 > "$TMP_OUT" 2>/dev/null || true
fi

if grep -q '"taskId"\s*:\s*"$TASK_ID"' "$TMP_OUT"; then
  echo "Result for task $TASK_ID found in topic $RESULT_TOPIC"
else
  echo "Result for task $TASK_ID not found in topic $RESULT_TOPIC"
  rm -f "$TMP_OUT"
  exit 5
fi
rm -f "$TMP_OUT"

# Ensure service still running
if "$STATUS_SCRIPT" >/dev/null 2>&1; then
  echo "Service remains running"
else
  echo "Service is not running after processing task"
  exit 6
fi

echo "Smoke test completed successfully"
exit 0
