#!/usr/bin/env bash
set -euo pipefail

# ORCH-E2E-SMOKE-014
# Bounded end-to-end smoke: start the runner locally with a test consumer group,
# publish a single task, expect a result on RESULT_TOPIC within timeout.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$REPO_ROOT/.venv"
PY="$VENV/bin/python3"
PIP="$VENV/bin/pip"

TASK_TOPIC="${TASK_TOPIC:-ai.dev.task.ofbiz}"
RESULT_TOPIC="${RESULT_TOPIC:-ai.dev.result.out}"
CONSUMER_GROUP="orch-e2e-smoke-014-group"
TIMEOUT=${TIMEOUT:-30}

if [ ! -x "$PY" ]; then
  echo "Virtualenv python not found at $PY" >&2
  echo "Create it with: python3 -m venv $REPO_ROOT/.venv && $REPO_ROOT/.venv/bin/pip install -r $REPO_ROOT/requirements.txt" >&2
  exit 2
fi

# Create a unique task payload
TASK_ID="ORCH-E2E-SMOKE-014-$(date +%s)"
TASK_PAYLOAD="{\"taskId\":\"$TASK_ID\",\"objectiveId\":\"orch-smoke\",\"payload\":{}}"

LOGFILE="/tmp/orch-e2e-smoke-014-runner.log"
rm -f "$LOGFILE"

# Start runner with test consumer group in background
export CONSUMER_GROUP
export RUNNER_MODE="dry-run"
export OPENHANDS_MODE="dry-run"
export RUNNER_LOG_DIR=""

echo "Starting runner (background)..."
# Start runner and redirect stdout/stderr to logfile
$PY -m runner.service >> "$LOGFILE" 2>&1 &
PID=$!

echo "Runner PID: $PID"

# Wait a bit for consumer to connect
sleep 2

# Publish test task using python kafka producer from venv
echo "Publishing test task $TASK_ID to $TASK_TOPIC"
$PY - <<PY
import os,sys,json
try:
    from kafka import KafkaProducer
except ImportError:
    print('kafka-python not installed in venv', file=sys.stderr)
    sys.exit(2)
from kafka import KafkaProducer
b=os.environ.get('KAFKA_BOOTSTRAP','kafka.yahlife.com:9095')
producer=KafkaProducer(bootstrap_servers=[b], value_serializer=lambda v: json.dumps(v).encode('utf-8'))
msg = json.loads('$TASK_PAYLOAD')
producer.send(os.environ.get('TASK_TOPIC','$TASK_TOPIC'), msg)
producer.flush(timeout=10)
print('Published')
PY

# Wait up to TIMEOUT seconds for result on RESULT_TOPIC
echo "Waiting up to $TIMEOUT seconds for result on $RESULT_TOPIC"
FOUND=0
start=$(date +%s)
while [ $(($(date +%s) - start)) -lt $TIMEOUT ]; do
  # try consume via python
  RES=$($PY - <<PY 2>/dev/null
import os,sys,json
try:
    from kafka import KafkaConsumer
except ImportError:
    sys.exit(2)
b=os.environ.get('KAFKA_BOOTSTRAP','kafka.yahlife.com:9095')
try:
    c = KafkaConsumer(os.environ.get('RESULT_TOPIC','$RESULT_TOPIC'), bootstrap_servers=[b], consumer_timeout_ms=1000, group_id=None, auto_offset_reset='earliest')
    for msg in c:
        try:
            v = msg.value
            if isinstance(v, (bytes, bytearray)):
                txt = v.decode('utf-8')
            else:
                txt = str(v)
            j = json.loads(txt)
            if j.get('taskId') == '$TASK_ID':
                print(json.dumps(j))
                sys.exit(0)
        except Exception:
            continue
    sys.exit(1)
except Exception as e:
    print('consume error', e, file=sys.stderr)
    sys.exit(3)
PY
)
  if [ $? -eq 0 ] && [ -n "$RES" ]; then
    echo "Found result: $RES"
    FOUND=1
    break
  fi
  sleep 1
done

# Request runner logs to show consumer connection and assignment
echo "--- Runner log tail ---"
tail -n 200 "$LOGFILE" || true

# Stop runner
kill $PID || true
sleep 1
kill -9 $PID 2>/dev/null || true

if [ "$FOUND" -eq 1 ]; then
  echo "[ORCH-E2E-SMOKE-014] SUCCESS"
  exit 0
else
  echo "[ORCH-E2E-SMOKE-014] FAILURE: result not found"
  exit 1
fi
