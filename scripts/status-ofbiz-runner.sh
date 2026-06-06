#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

PIDFILE=${PIDFILE:-/tmp/ofbiz-runner.pid}

if [ ! -f "$PIDFILE" ]; then
  echo "NOT RUNNING (no PID file at $PIDFILE)"
  exit 3
fi

PID=$(cat "$PIDFILE" || true)
if [ -z "$PID" ]; then
  echo "NOT RUNNING (empty PID file)"
  exit 3
fi

if kill -0 "$PID" 2>/dev/null; then
  echo "RUNNING (PID $PID)"
  ps -o pid,cmd -p "$PID"
  exit 0
else
  echo "NOT RUNNING (stale PID $PID)"
  exit 2
fi
