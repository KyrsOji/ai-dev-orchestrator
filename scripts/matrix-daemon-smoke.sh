#!/usr/bin/env bash
# Smoke test for matrix bridge daemon mode
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-kafka.yahlife.com:9095}"
CLIENT_CONFIG="${KAFKA_CLIENT_CONFIG:-/opt/ai-dev-runner/certs/kafka-client.properties}"

HOMESERVER="${MATRIX_HOMESERVER_URL:-}"
TOKEN="${MATRIX_ACCESS_TOKEN:-}"
ROOM_ID="${MATRIX_ROOM_ID:-}"

if [ -z "$HOMESERVER" ] || [ -z "$TOKEN" ] || [ -z "$ROOM_ID" ]; then
  if [ -f /etc/ai-dev-orchestrator/matrix.env ]; then
    HOMESERVER="$(grep -E '^MATRIX_HOMESERVER_URL=' /etc/ai-dev-orchestrator/matrix.env | sed -E 's/^MATRIX_HOMESERVER_URL=//')"
    TOKEN="$(grep -E '^MATRIX_ACCESS_TOKEN=' /etc/ai-dev-orchestrator/matrix.env | sed -E 's/^MATRIX_ACCESS_TOKEN=//')"
    ROOM_ID="$(grep -E '^MATRIX_ROOM_ID=' /etc/ai-dev-orchestrator/matrix.env | sed -E 's/^MATRIX_ROOM_ID=//')"
  fi
fi

WAIT_SECS=${WAIT_SECS:-120}
TOTAL_TIMEOUT=${TOTAL_TIMEOUT:-180}

SAMPLE_TASK='{"taskId":"MATRIX-DAEMON-SMOKE-001","title":"Matrix daemon smoke","status":"success","metadata":{"change_type":"commit"}}'

PRODUCER_CMD="$(command -v kafka-console-producer.sh || command -v kafka-console-producer || true)"
CONSUMER_CMD="$(command -v kafka-console-consumer.sh || command -v kafka-console-consumer || true)"
PYTHON=${PYTHON:-python3}

publish_via_cli() {
  local topic="$1"; local message="$2"; local t=${3:-20}
  if [ -n "$CLIENT_CONFIG" ]; then
    echo "$message" | timeout "${t}s" "$PRODUCER_CMD" --bootstrap-server "$BOOTSTRAP" --producer.config "$CLIENT_CONFIG" --topic "$topic"
  else
    echo "$message" | timeout "${t}s" "$PRODUCER_CMD" --bootstrap-server "$BOOTSTRAP" --topic "$topic"
  fi
}

publish_via_python() {
  local topic="$1"; local message="$2"
  export SMOKE_TOPIC="$topic"
  export SMOKE_MESSAGE="$message"
  $PYTHON - <<'PY'
import os,sys,importlib,json
topic=os.environ['SMOKE_TOPIC']
message=os.environ['SMOKE_MESSAGE']
if importlib.util.find_spec('kafka') is None:
    print('kafka-python not installed', file=sys.stderr)
    sys.exit(2)
from kafka import KafkaProducer
producer=KafkaProducer(bootstrap_servers=[os.environ.get('KAFKA_BOOTSTRAP','localhost:9092')], value_serializer=lambda v: json.dumps(v).encode('utf-8'))
producer.send(topic, json.loads(message))
producer.flush()
print('published')
PY
}

publish() {
  local topic="$1"; local message="$2"
  if [ -n "$PRODUCER_CMD" ]; then
    publish_via_cli "$topic" "$message"
  else
    publish_via_python "$topic" "$message"
  fi
}

if [ -z "$HOMESERVER" ] || [ -z "$TOKEN" ] || [ -z "$ROOM_ID" ]; then
  echo "Missing Matrix credentials. Please populate /etc/ai-dev-orchestrator/matrix.env or export MATRIX_* env vars." >&2
  echo "Expected values: MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, MATRIX_ROOM_ID" >&2
  exit 2
fi

# Start bridge daemon in background
TMPLOG=$(mktemp)
trap 'rc=$?; echo "Cleaning up..."; if [ -n "${BRIDGE_PID:-}" ]; then kill "$BRIDGE_PID" 2>/dev/null || true; fi; rm -f "$TMPLOG"; exit "$rc"' EXIT

env MATRIX_MODE=real MATRIX_HOMESERVER_URL="$HOMESERVER" MATRIX_ACCESS_TOKEN="$TOKEN" MATRIX_ROOM_ID="$ROOM_ID" KAFKA_BOOTSTRAP="$BOOTSTRAP" KAFKA_CLIENT_CONFIG="$CLIENT_CONFIG" $PYTHON -m matrix_bridge.bridge --daemon --matrix-mode real >"$TMPLOG" 2>&1 &
BRIDGE_PID=$!

# Wait for the daemon to print its startup line
TRIES=0
MAX_TRIES=20
while [ $TRIES -lt $MAX_TRIES ]; do
  if grep -q "Starting daemon to consume topic=" "$TMPLOG"; then
    break
  fi
  if ! kill -0 "$BRIDGE_PID" 2>/dev/null; then
    echo "Bridge daemon failed to start; see $TMPLOG" >&2
    cat "$TMPLOG" >&2 || true
    exit 3
  fi
  TRIES=$((TRIES+1))
  sleep 0.5
done

if [ $TRIES -ge $MAX_TRIES ]; then
  echo "Timed out waiting for daemon to be ready; see $TMPLOG" >&2
  cat "$TMPLOG" >&2 || true
  kill "$BRIDGE_PID" || true
  wait "$BRIDGE_PID" 2>/dev/null || true
  rm -f "$TMPLOG"
  exit 3
fi

echo "Bridge daemon started (pid=$BRIDGE_PID). Publishing sample approval request to ai.dev.approval.required"
publish ai.dev.approval.required "$SAMPLE_TASK"

echo "Bridge will post to Matrix room ${ROOM_ID}. Please send the Matrix command in that room: approve MATRIX-DAEMON-SMOKE-001"

# Attempt to consume decision from ai.dev.review.out
echo "Consuming decision from ai.dev.review.out (bounded wait)"
if [ -n "$CONSUMER_CMD" ]; then
  if [ -n "$CLIENT_CONFIG" ]; then
    OUT=$(timeout 60s "$CONSUMER_CMD" --bootstrap-server "$BOOTSTRAP" --topic ai.dev.review.out --max-messages 1 --consumer.config "$CLIENT_CONFIG" 2>&1 || true)
  else
    OUT=$(timeout 60s "$CONSUMER_CMD" --bootstrap-server "$BOOTSTRAP" --topic ai.dev.review.out --max-messages 1 --timeout-ms 60000 2>&1 || true)
  fi
  echo "Raw consumer output:"
  echo "$OUT"
  TASK_ID=""
  DECISION=""
  if echo "$OUT" | grep -q 'MATRIX-DAEMON-SMOKE-001'; then
    TASK_ID="MATRIX-DAEMON-SMOKE-001"
  fi
  DECISION=$(echo "$OUT" | $PYTHON - <<'PY'
import sys,json,re
text=sys.stdin.read()
m=re.search(r"\{.*\}", text, re.S)
if not m:
    sys.exit(0)
try:
    obj=json.loads(m.group(0))
    print(obj.get('decision') or '')
except Exception:
    sys.exit(0)
PY
  )
  if [ -n "$DECISION" ]; then
    echo "Observed decision for task MATRIX-DAEMON-SMOKE-001: $DECISION"
    if [ "$DECISION" = "approved" ]; then
      echo "Matrix daemon smoke: SUCCESS"
      kill "$BRIDGE_PID" || true
      wait "$BRIDGE_PID" 2>/dev/null || true
      rm -f "$TMPLOG"
      exit 0
    else
      echo "Matrix daemon smoke: FAILED (decision=$DECISION)" >&2
      kill "$BRIDGE_PID" || true
      wait "$BRIDGE_PID" 2>/dev/null || true
      rm -f "$TMPLOG"
      exit 4
    fi
  else
    # Fallback: inspect daemon stdout for processed marker
    if grep -q '\[BRIDGE\] processed task=MATRIX-DAEMON-SMOKE-001 decision=approved' "$TMPLOG"; then
      echo "Observed daemon-processed approval in daemon logs; treating as success (ai.dev.review.out verification unavailable)"
      kill "$BRIDGE_PID" || true
      wait "$BRIDGE_PID" 2>/dev/null || true
      rm -f "$TMPLOG"
      exit 0
    fi
    echo "Could not parse decision message from ai.dev.review.out" >&2
    cat "$TMPLOG" >&2 || true
    kill "$BRIDGE_PID" || true
    wait "$BRIDGE_PID" 2>/dev/null || true
    rm -f "$TMPLOG"
    exit 5
  fi
else
  echo "No kafka-console-consumer available; cannot validate ai.dev.review.out topic from this host." >&2
  echo "Bridge daemon started; please verify decision was published to ai.dev.review.out from a host with Kafka access." >&2
  kill "$BRIDGE_PID" || true
  wait "$BRIDGE_PID" 2>/dev/null || true
  rm -f "$TMPLOG"
  exit 6
fi
