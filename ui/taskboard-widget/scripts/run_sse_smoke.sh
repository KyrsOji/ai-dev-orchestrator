#!/usr/bin/env bash
set -euo pipefail

# Move to widget root (script is in scripts/)
cd "$(dirname "$0")/.."

PORT=${PORT:-3010}
export TB_BASE=${TB_BASE:-http://127.0.0.1:$PORT/taskboard-v2}

SERVER_LOG="/tmp/taskboard-sse-smoke-server.log"

# Start server in background
echo "Starting Taskboard server on PORT=$PORT (log -> $SERVER_LOG)"
PORT=$PORT node server.js > "$SERVER_LOG" 2>&1 &
SERVER_PID=$!

echo "Server PID: $SERVER_PID"

cleanup() {
  echo "Cleaning up: stopping server PID $SERVER_PID"
  if ps -p "$SERVER_PID" > /dev/null 2>&1; then
    kill "$SERVER_PID" || true
    # Wait briefly for the process to exit
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

# Wait up to 30 seconds for TB_BASE to be reachable
MAX_WAIT=30
COUNT=0
echo "Waiting for $TB_BASE to become reachable (max ${MAX_WAIT}s)"
while ! curl -sSf -o /dev/null "$TB_BASE"; do
  COUNT=$((COUNT+1))
  if [ "$COUNT" -ge "$MAX_WAIT" ]; then
    echo "Timeout waiting for $TB_BASE to become reachable"
    echo "----- Server log (last 200 lines) -----"
    tail -n 200 "$SERVER_LOG" || true
    exit 3
  fi
  sleep 1
done

echo "$TB_BASE is reachable after ${COUNT}s"

# Run the Playwright SSE smoke test (expects TB_BASE exported)
npm run test:sse-live || TEST_RC=$?
TEST_RC=${TEST_RC:-0}

# Print outputs
echo "\n===== Smoke run summary ====="
echo "Server log path: $SERVER_LOG"

SCREENSHOT_PATHS=(/tmp/playwright-screenshot-desktop.png /tmp/playwright-screenshot-tablet.png /tmp/playwright-screenshot-mobile.png)
echo "Screenshots:"
for p in "${SCREENSHOT_PATHS[@]}"; do
  if [ -f "$p" ]; then
    echo " - $p"
  else
    echo " - $p  (missing)"
  fi
done

echo "TB_BASE: $TB_BASE"

echo "----- Server log (last 200 lines) -----"
tail -n 200 "$SERVER_LOG" || true

echo "================================\n"

# Exit with the test return code
exit "$TEST_RC"
