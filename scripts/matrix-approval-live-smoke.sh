#!/usr/bin/env bash
# Live smoke for Matrix approval bridge (OFBiz room)
# Publishes a single approval request and runs the bridge to await human approval.
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-kafka.yahlife.com:9095}"
CLIENT_CONFIG="${KAFKA_CLIENT_CONFIG:-/opt/ai-dev-runner/certs/kafka-client.properties}"

# Prefer env, otherwise try to source /etc/ai-dev-orchestrator/matrix.env if present
HOMESERVER="${MATRIX_HOMESERVER_URL:-}"
TOKEN="${MATRIX_ACCESS_TOKEN:-}"
ROOM_ID="${MATRIX_ROOM_ID:-}"

# If values are not set in environment, attempt to source the file (without printing secrets)
if [ -z "$HOMESERVER" ] || [ -z "$TOKEN" ] || [ -z "$ROOM_ID" ]; then
  if [ -f /etc/ai-dev-orchestrator/matrix.env ]; then
    # shellcheck disable=SC1090
    # Source the file in a subshell to avoid exporting secrets to stdout
    HOMESERVER="$(grep -E '^MATRIX_HOMESERVER_URL=' /etc/ai-dev-orchestrator/matrix.env | sed -E 's/^MATRIX_HOMESERVER_URL=//')"
    TOKEN="$(grep -E '^MATRIX_ACCESS_TOKEN=' /etc/ai-dev-orchestrator/matrix.env | sed -E 's/^MATRIX_ACCESS_TOKEN=//')"
    ROOM_ID="$(grep -E '^MATRIX_ROOM_ID=' /etc/ai-dev-orchestrator/matrix.env | sed -E 's/^MATRIX_ROOM_ID=//')"
  fi
fi

WAIT_SECS=${WAIT_SECS:-120}
TOTAL_TIMEOUT=${TOTAL_TIMEOUT:-180}

SAMPLE_TASK='{"taskId":"MATRIX-LIVE-SMOKE-001","title":"Matrix live smoke","status":"success","metadata":{"change_type":"commit"}}'

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

# Fail closed if running in real mode but missing creds
if [ -z "$HOMESERVER" ] || [ -z "$TOKEN" ] || [ -z "$ROOM_ID" ]; then
  echo "Missing Matrix credentials. Please populate /etc/ai-dev-orchestrator/matrix.env or export MATRIX_* env vars." >&2
  echo "Expected values: MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN, MATRIX_ROOM_ID" >&2
  exit 2
fi

# Publish sample approval request
echo "Publishing sample approval request to ai.dev.approval.required (taskId=MATRIX-LIVE-SMOKE-001)"
publish ai.dev.approval.required "$SAMPLE_TASK"

echo "Bridge will consume one message and wait up to ${WAIT_SECS}s for approval in room=${ROOM_ID}."
echo "Please send the Matrix command in that room: approve MATRIX-LIVE-SMOKE-001"

# Run bridge in foreground with total timeout
set +e
timeout "${TOTAL_TIMEOUT}s" env MATRIX_MODE=real MATRIX_HOMESERVER_URL="$HOMESERVER" MATRIX_ACCESS_TOKEN="$TOKEN" MATRIX_ROOM_ID="$ROOM_ID" $PYTHON -m matrix_bridge.bridge --consume-topic ai.dev.approval.required --matrix-mode real --wait-seconds "$WAIT_SECS"
BRIDGE_RC=$?
set -e

if [ $BRIDGE_RC -ne 0 ]; then
  echo "Matrix bridge did not complete successfully within ${TOTAL_TIMEOUT}s (rc=${BRIDGE_RC})." >&2
  exit 3
fi

# Attempt to consume a single decision from ai.dev.review.out to validate bridge output
echo "Consuming decision from ai.dev.review.out (bounded wait)"
if [ -n "$CONSUMER_CMD" ]; then
  if [ -n "$CLIENT_CONFIG" ]; then
    OUT=$(timeout 30s "$CONSUMER_CMD" --bootstrap-server "$BOOTSTRAP" --topic ai.dev.review.out --max-messages 1 --consumer.config "$CLIENT_CONFIG" 2>&1 || true)
  else
    OUT=$(timeout 30s "$CONSUMER_CMD" --bootstrap-server "$BOOTSTRAP" --topic ai.dev.review.out --max-messages 1 --timeout-ms 30000 2>&1 || true)
  fi
  echo "Raw consumer output:"
  echo "$OUT"
  # Try to extract JSON from output
  TASK_ID=""
  DECISION=""
  if echo "$OUT" | grep -q 'MATRIX-LIVE-SMOKE-001'; then
    TASK_ID="MATRIX-LIVE-SMOKE-001"
  fi
  # Use python to safely extract decision field if JSON can be found
  DECISION=$(echo "$OUT" | $PYTHON - <<'PY'
import sys,json,re
text=sys.stdin.read()
# find first JSON object
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
    echo "Observed decision for task MATRIX-LIVE-SMOKE-001: $DECISION"
    if [ "$DECISION" = "approved" ]; then
      echo "Live Matrix approval smoke: SUCCESS"
      exit 0
    else
      echo "Live Matrix approval smoke: FAILED (decision=$DECISION)" >&2
      exit 4
    fi
  else
    echo "Could not parse decision message from ai.dev.review.out" >&2
    exit 5
  fi
else
  echo "No kafka-console-consumer available; cannot validate ai.dev.review.out topic from this host." >&2
  echo "Bridge run completed; please verify decision was published to ai.dev.review.out from a host with Kafka access." >&2
  exit 6
fi
