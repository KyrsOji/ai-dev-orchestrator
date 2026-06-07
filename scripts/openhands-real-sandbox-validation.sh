#!/usr/bin/env bash
# OpenHands real sandbox validation
# - Runs a real (but harmless) OpenHands process inside a disposable run directory
# - Ensures execution_guard checks are enforced and the process only writes inside run dir
# - Verifies execution-report.json, validation.txt, and a recorded result publication

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMPROOT="$(mktemp -d)"
FAKE_BIN="$TMPROOT/fakebin"
mkdir -p "$FAKE_BIN"
PUBLISHED_FILE="$TMPROOT/published_results.jsonl"

echo "[sandbox] TMPROOT=$TMPROOT"

# Ensure our OpenHands stub exists and is executable
OPENHANDS_STUB="$REPO_ROOT/scripts/openhands_real_stub.py"
if [ ! -f "$OPENHANDS_STUB" ]; then
  echo "[sandbox][error] openhands stub not found at $OPENHANDS_STUB" >&2
  exit 1
fi
chmod +x "$OPENHANDS_STUB"

# Create fake kafka-console-producer to capture published result (no network)
cat > "$FAKE_BIN/kafka-console-producer.sh" <<EOF
#!/usr/bin/env bash
# Fake producer: capture stdin to file
cat - > "$PUBLISHED_FILE"
echo "[fake-producer] wrote to $PUBLISHED_FILE" >&2
exit 0
EOF
ln -s "$FAKE_BIN/kafka-console-producer.sh" "$FAKE_BIN/kafka-console-producer" || true
chmod +x "$FAKE_BIN"/*
export PATH="$FAKE_BIN:$PATH"

# Prepare disposable run directory
TASK_ID="real-sandbox-$(date +%s)-$RANDOM"
RUN_DIR="$TMPROOT/$TASK_ID"
mkdir -p "$RUN_DIR"

# Write a task.json with executionApproved true
cat > "$RUN_DIR/task.json" <<JSON
{
  "taskId": "$TASK_ID",
  "title": "OpenHands real sandbox validation",
  "description": "Sandboxed OpenHands invocation - filesystem-only",
  "executionApproved": true
}
JSON

# Environment configuration for guard and executor
export EXECUTION_APPROVED="true"
export OPENHANDS_CMD="$OPENHANDS_STUB"
export OPENHANDS_ARGS=""
export ALLOWED_OPENHANDS_COMMANDS="$OPENHANDS_STUB"
export RUNNER_MODE="execute"
export OPENHANDS_MODE="execute"
# Requested timeout for the OpenHands process (seconds) - keep short for test
export OPENHANDS_TIMEOUT_SECONDS="30"
# Enforce maximum allowed execution time
export MAX_EXECUTION_SECONDS="300"
# Use CLI producer behavior in result publisher (not strictly necessary here)
export KAFKA_FORCE_CLI=1

# Run guarded execution using the runner modules in a short Python program
echo "[sandbox] Running guarded OpenHands execution inside sandbox run dir: $RUN_DIR"
python3 - <<PY
from __future__ import annotations
import json, os, sys
from pathlib import Path

# Ensure repo root is in path (script invoked from repo root but be explicit)
ROOT = "${REPO_ROOT}"
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from runner import execution_guard, openhands_executor, result_publisher

run_dir = Path(r"$RUN_DIR")
# Load task.json
with (run_dir / 'task.json').open('r', encoding='utf-8') as fh:
    task = json.load(fh)

# Run execution guard
allowed, meta = execution_guard.guard_execution(task, str(run_dir))
if not allowed:
    print('[sandbox][error] execution_guard blocked execution:', meta, file=sys.stderr)
    sys.exit(2)
print('[sandbox] execution_guard allowed execution:', meta)

# Execute the OpenHands process (this will run the stub in cwd=run_dir)
exec_meta = openhands_executor.execute_task(str(run_dir), task)
print('[sandbox] openhands_executor returned:', exec_meta)

# Build a minimal published result similar to runner.service
import uuid
from datetime import datetime, timezone
result = {
    'resultId': str(uuid.uuid4()),
    'taskId': task.get('taskId'),
    'status': 'executed' if exec_meta.get('status') in ('completed','executed') else 'failed',
    'summary': exec_meta.get('stdout','')[:1000] or exec_meta.get('stderr','')[:1000],
    'runDirectory': str(run_dir),
    'createdAt': datetime.now(timezone.utc).isoformat(),
}

# Publish result (will use our fake kafka-console-producer in PATH)
success, pub_meta = result_publisher.publish_result(result)
print('[sandbox] publish_result ->', success, pub_meta)
if not success:
    print('[sandbox][error] publish_result failed:', pub_meta, file=sys.stderr)
    sys.exit(3)

# Exit with non-zero if execution failed
if exec_meta.get('status') not in ('completed','executed'):
    sys.exit(4)

sys.exit(0)
PY

PY_EXIT=$?
if [ $PY_EXIT -ne 0 ]; then
  echo "[sandbox][error] Guarded execution Python returned exit code $PY_EXIT" >&2
  exit $PY_EXIT
fi

# Verification
if [ -d "$RUN_DIR" ]; then
  echo "[sandbox] Run directory exists: $RUN_DIR"
else
  echo "[sandbox][error] Run directory missing: $RUN_DIR" >&2
  exit 10
fi

if [ -f "$RUN_DIR/validation.txt" ]; then
  echo "[sandbox] validation.txt exists"
else
  echo "[sandbox][error] validation.txt missing" >&2
  exit 11
fi

if [ -f "$RUN_DIR/execution-report.json" ]; then
  echo "[sandbox] execution-report.json exists"
else
  echo "[sandbox][error] execution-report.json missing" >&2
  exit 12
fi

# Check execution-report.json status is completed
if grep -q '"status"[[:space:]]*:[[:space:]]*"completed"' "$RUN_DIR/execution-report.json"; then
  echo "[sandbox] execution-report.json indicates completed"
else
  echo "[sandbox][error] execution-report.json does not indicate completed" >&2
  echo "Contents:"
  sed -n '1,200p' "$RUN_DIR/execution-report.json" >&2 || true
  exit 13
fi

# Verify the stub wrote the expected marker
if grep -q "OPENHANDS_REAL_EXECUTION_VALIDATED" "$RUN_DIR/validation.txt"; then
  echo "[sandbox] validation.txt contains marker"
else
  echo "[sandbox][error] validation.txt does not contain marker" >&2
  sed -n '1,200p' "$RUN_DIR/validation.txt" >&2 || true
  exit 14
fi

# Verify result published to fake producer
if [ -f "$PUBLISHED_FILE" ]; then
  echo "[sandbox] Published result captured at $PUBLISHED_FILE"
  if grep -q "$(echo "$RUN_DIR" | sed 's/\//\\\//g')" "$PUBLISHED_FILE"; then
    echo "[sandbox] Published result references run directory"
  else
    echo "[sandbox][error] Published result does not reference run dir" >&2
    sed -n '1,200p' "$PUBLISHED_FILE" >&2 || true
    exit 15
  fi
else
  echo "[sandbox][error] No published result file found: $PUBLISHED_FILE" >&2
  exit 16
fi

# Success
echo "[sandbox] OpenHands real sandbox validation completed successfully"

echo "[sandbox] Sandbox artifacts in $TMPROOT (remove when no longer needed)"
exit 0
