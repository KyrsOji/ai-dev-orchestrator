#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIDFILE=${PIDFILE:-/tmp/ofbiz-runner.pid}
KAFKA_BOOTSTRAP=${KAFKA_BOOTSTRAP:-kafka.yahlife.com:9095}
KAFKA_CLIENT_CONFIG=${KAFKA_CLIENT_CONFIG:-/opt/ai-dev-runner/certs/kafka-client.properties}

LOG_FILE="$REPO_ROOT/logs/ofbiz-runner.log"

# 1) Check process running
if [ ! -f "$PIDFILE" ]; then
  echo "UNHEALTHY: pidfile missing ($PIDFILE)"
  exit 1
fi
PID=$(cat "$PIDFILE" || true)
if [ -z "$PID" ] || ! kill -0 "$PID" 2>/dev/null; then
  echo "UNHEALTHY: process not running (PID $PID)"
  exit 2
fi

# 2) Check kafka connectivity (try kafka-topics.sh --list)
TOPICS_BIN=$(command -v kafka-topics.sh || true)
if [ -z "$TOPICS_BIN" ]; then
  # If kafka-topics not available, fall back to producer binary presence
  PRODUCER_BIN=$(command -v kafka-console-producer.sh || true)
  if [ -z "$PRODUCER_BIN" ]; then
    echo "UNHEALTHY: kafka CLI not found in PATH"
    exit 3
  fi
else
  # Try listing topics (fast connectivity check)
  if [ -n "$KAFKA_CLIENT_CONFIG" ]; then
    if ! "$TOPICS_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --command-config "$KAFKA_CLIENT_CONFIG" --list >/dev/null 2>&1; then
      echo "UNHEALTHY: kafka topics list failed"
      exit 4
    fi
  else
    if ! "$TOPICS_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --list >/dev/null 2>&1; then
      echo "UNHEALTHY: kafka topics list failed"
      exit 4
    fi
  fi
fi

# 3) Check log file exists
if [ ! -f "$LOG_FILE" ]; then
  echo "UNHEALTHY: log file missing ($LOG_FILE)"
  exit 5
fi

# If we reached here, we're healthy
echo "HEALTHY"
exit 0
