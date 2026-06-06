#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

PIDFILE=${PIDFILE:-/tmp/ofbiz-runner.pid}

if [ ! -f "$PIDFILE" ]; then
  echo "No PID file found ($PIDFILE). Service may not be running."
  exit 1
fi

PID=$(cat "$PIDFILE" || true)
if [ -z "$PID" ]; then
  echo "PID file empty; removing and exiting"
  rm -f "$PIDFILE"
  exit 1
fi

if ! kill -0 "$PID" 2>/dev/null; then
  echo "Process $PID not running; removing PID file"
  rm -f "$PIDFILE"
  exit 0
fi

echo "Stopping process $PID"
kill -TERM "$PID"
# Wait up to 10 seconds
for i in $(seq 1 10); do
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Stopped"
    rm -f "$PIDFILE"
    exit 0
  fi
  sleep 1
done

echo "Process did not exit after SIGTERM; sending SIGKILL"
kill -KILL "$PID" || true
sleep 1
rm -f "$PIDFILE" || true

