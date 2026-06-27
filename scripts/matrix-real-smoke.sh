#!/usr/bin/env bash
# Smoke test for Matrix bridge - tries real mode when credentials present,
# otherwise falls back to mock mode. Does not require live Matrix creds for
# basic repository validation.
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
MODE="${MATRIX_MODE:-mock}"
HOMESERVER="${MATRIX_HOMESERVER_URL:-}"
TOKEN="${MATRIX_ACCESS_TOKEN:-}"
ROOM_ID="${MATRIX_ROOM_ID:-!approvals:example}"
WAIT_SECS=${WAIT_SECS:-30}

SAMPLE_TASK='{"taskId":"matrix-smoke-1","title":"Matrix smoke","status":"success","metadata":{"change_type":"commit"}}'

PRODUCER_CMD="$(command -v kafka-console-producer.sh || command -v kafka-console-producer || true)"
CONSUMER_CMD="$(command -v kafka-console-consumer.sh || command -v kafka-console-consumer || true)"
PYTHON=${PYTHON:-python3}

echo "=== matrix-real-smoke ==="
echo "Bootstrap: ${BOOTSTRAP}"
echo "Matrix mode: ${MODE}"

publish_via_cli() {
  local topic="$1"; local message="$2"; local t=${3:-20}
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    echo "$message" | timeout "${t}s" "$PRODUCER_CMD" --bootstrap-server "$BOOTSTRAP" --producer.config "$KAFKA_CLIENT_CONFIG" --topic "$topic"
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

# If matrix real mode but missing creds, fail closed
if [ "$MODE" = "real" ] && { [ -z "$HOMESERVER" ] || [ -z "$TOKEN" ] || [ -z "$ROOM_ID" ]; }; then
  echo "MATRIX_MODE=real but missing MATRIX_HOMESERVER_URL, MATRIX_ACCESS_TOKEN or MATRIX_ROOM_ID. Failing-closed." >&2
  exit 2
fi

# If not real mode or no Kafka client installed, run mock smoke (no network)
if [ "$MODE" != "real" ] || [ -z "$PRODUCER_CMD" -a -z "$(python3 - <<'PY'
import importlib,sys
print('kafka' if importlib.util.find_spec('kafka') else '')
PY
)" ]; then
  echo "Running mock-mode smoke test"
  TMP=$(mktemp -d)
  TASK_FILE="$TMP/sample_task.json"
  CMDS_FILE="$TMP/cmds.txt"
  echo "$SAMPLE_TASK" > "$TASK_FILE"
  # Create a mock command that approves the sample task
  echo "approve matrix-smoke-1" > "$CMDS_FILE"
  $PYTHON -m matrix_bridge.bridge --sample-task-file "$TASK_FILE" --mock-commands-file "$CMDS_FILE" --dry-run
  rm -rf "$TMP"
  exit 0
fi

# Real-mode attempt: publish a sample approval request to ai.dev.approval.required and start bridge
echo "Publishing sample approval request to ai.dev.approval.required"
publish ai.dev.approval.required "$SAMPLE_TASK"

# Start bridge consuming one message and waiting for a command (interactive)
echo "Now starting matrix_bridge to consume one message and wait for a Matrix command (see room=${ROOM_ID})."
echo "If you have a Matrix client, please send the command: approve matrix-smoke-1"

# Run bridge in foreground so we can observe output
MATRIX_MODE=real MATRIX_HOMESERVER_URL="$HOMESERVER" MATRIX_ACCESS_TOKEN="$TOKEN" MATRIX_ROOM_ID="$ROOM_ID" python3 -m matrix_bridge.bridge --consume-topic ai.dev.approval.required --matrix-mode real --wait-seconds "$WAIT_SECS"

# Note: we deliberately do not export the token to the environment when echoing commands

exit 0
