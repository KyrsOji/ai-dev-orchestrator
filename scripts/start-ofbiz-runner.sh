#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PYTHON=${PYTHON:-python3}
PIDFILE=${PIDFILE:-/tmp/ofbiz-runner.pid}
KAFKA_BOOTSTRAP=${KAFKA_BOOTSTRAP:-kafka.yahlife.com:9095}
KAFKA_CLIENT_CONFIG=${KAFKA_CLIENT_CONFIG:-/opt/ai-dev-runner/certs/kafka-client.properties}
KAFKA_FORCE_CLI=${KAFKA_FORCE_CLI:-1}

LOG_DIR="$REPO_ROOT/logs"
mkdir -p "$LOG_DIR"

if [ -f "$PIDFILE" ]; then
  PID=$(cat "$PIDFILE" || true)
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "Service already running with PID $PID"
    exit 0
  else
    echo "Stale PID file found. Removing."
    rm -f "$PIDFILE"
  fi
fi

echo "Starting OFBiz continuous runner (dry-run)"
nohup env KAFKA_BOOTSTRAP="$KAFKA_BOOTSTRAP" KAFKA_CLIENT_CONFIG="$KAFKA_CLIENT_CONFIG" KAFKA_FORCE_CLI="$KAFKA_FORCE_CLI" \
  "$PYTHON" -m runner.service >> "$LOG_DIR/ofbiz-runner.log" 2>&1 &

echo $! > "$PIDFILE"
PID=$(cat "$PIDFILE")
# Give it a moment to start
sleep 1
if kill -0 "$PID" 2>/dev/null; then
  echo "Started with PID $PID"
else
  echo "Failed to start runner; check logs at $LOG_DIR/ofbiz-runner.log"
  exit 1
fi
