#!/usr/bin/env bash
# Smoke test for agent registry
# 1) start registry in file-tail mode (background)
# 2) publish a sample heartbeat to the tail file
# 3) wait a bit and verify that `python -m registry list` shows the agent

set -euo pipefail

TMP_DIR="$(mktemp -d --tmpdir agent-registry-XXXX)"
HEARTBEAT_FILE="$TMP_DIR/heartbeats.ndjson"
STORAGE_FILE="$TMP_DIR/registry.json"

echo "Using tmp dir: $TMP_DIR"

# Mode: file (default) or kafka (live test)
AGENT_REGISTRY_MODE="${AGENT_REGISTRY_MODE:-file}"
# Run mode: smoke (bounded) or service (long-running)
AGENT_REGISTRY_RUN_MODE="${AGENT_REGISTRY_RUN_MODE:-smoke}"
if [[ "$AGENT_REGISTRY_MODE" == "kafka" ]]; then
  echo "Running agent-registry smoke in KAFKA mode"
  if [[ -z "${KAFKA_BOOTSTRAP:-}" ]]; then
    echo "KAFKA_BOOTSTRAP not set. Export KAFKA_BOOTSTRAP=something:9095" >&2
    exit 2
  fi
  CMD_CONSUMER="$(command -v kafka-console-consumer.sh || true)"
  CMD_PRODUCER="$(command -v kafka-console-producer.sh || true)"
  if [[ -z "$CMD_PRODUCER" || -z "$CMD_CONSUMER" ]]; then
    echo "kafka console tools not found on PATH" >&2
    exit 3
  fi
  # Build heartbeat payload
  TIMESTAMP=$(python3 - <<'PY'
from datetime import datetime, timezone
print(datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace('+00:00','Z'))
PY
)
  AGENT_ID="ofbiz-dev-01"
  HOSTNAME="test-host"
  PAYLOAD=$(cat <<EOF
{"agentId": "$AGENT_ID", "hostname": "$HOSTNAME", "roles": ["ofbiz","java"], "status": "idle", "cpuCount": 4, "memoryGb": 8.0, "diskFreeGb": 100.0, "loadAverage": 0.12, "lastSeen": "$TIMESTAMP"}
EOF
)
  echo "Publishing to Kafka topic ai.dev.agent.status"
  echo "$PAYLOAD" | "$CMD_PRODUCER" --bootstrap-server "$KAFKA_BOOTSTRAP" --producer.config "$KAFKA_CLIENT_CONFIG" --topic ai.dev.agent.status
  echo "Consuming from Kafka to verify message (bounded 15s)"
  # Capture consumer output to file, then grep (timeout in pipeline can kill JVM before output flushes)
  "$CMD_CONSUMER" --bootstrap-server "$KAFKA_BOOTSTRAP" --consumer.config "$KAFKA_CLIENT_CONFIG" --topic ai.dev.agent.status --from-beginning --max-messages 50 --timeout-ms 15000 > "$TMP_DIR/consumer.out" 2>&1 || true
  if grep -q "$AGENT_ID" "$TMP_DIR/consumer.out"; then
    echo "Smoke test OK: agent found in Kafka topic"
    exit 0
  else
    echo "Smoke test FAILED: agent not found in Kafka topic" >&2
    echo "----- consumer output -----"
    sed -n '1,200p' "$TMP_DIR/consumer.out" || true
    exit 2
  fi
fi


# Start registry consumer in background (tails HEARTBEAT_FILE and writes storage)
# Redirect output to log
if [[ "${AGENT_REGISTRY_RUN_MODE:-smoke}" == "service" ]]; then
  # Service mode: long-running consumer (no internal timeout)
  python3 -m registry consume --storage "$STORAGE_FILE" --file-path "$HEARTBEAT_FILE" --run-mode "$AGENT_REGISTRY_RUN_MODE" > "$TMP_DIR/registry.log" 2>&1 &
  REG_PID=$!
else
  # Smoke mode: bounded consumer using timeout and a reaper
  timeout --kill-after=5s 30s python3 -m registry consume --storage "$STORAGE_FILE" --file-path "$HEARTBEAT_FILE" --run-mode "$AGENT_REGISTRY_RUN_MODE" > "$TMP_DIR/registry.log" 2>&1 &
  REG_PID=$!
  # Reaper to ensure the consumer is killed if timeout fails to stop it
  ( sleep 35; echo "Reaper: killing registry consumer pid $REG_PID"; kill -TERM "$REG_PID" 2>/dev/null || true; sleep 2; kill -KILL "$REG_PID" 2>/dev/null || true ) &
  REAPER_PID=$!
fi

# Ensure background process and reaper are killed on exit
cleanup_registry_consumer() {
  echo 'Cleaning up'
  if [[ -n "${REAPER_PID:-}" ]]; then
    kill "${REAPER_PID}" 2>/dev/null || true
  fi
  if [[ -n "${REG_PID:-}" ]]; then
    kill "${REG_PID}" 2>/dev/null || true
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup_registry_consumer EXIT

# Wait a bit for consumer to start
sleep 1

# Build sample heartbeat payload
TIMESTAMP="$(python3 - <<'PY'
from datetime import datetime, timezone
print(datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace('+00:00','Z'))
PY
)"

AGENT_ID="ofbiz-dev-01"
HOSTNAME="test-host"
ROLES="[\"ofbiz\", \"java\"]"

PAYLOAD=$(cat <<EOF
{"agentId": "$AGENT_ID", "hostname": "$HOSTNAME", "roles": ["ofbiz","java"], "status": "idle", "cpuCount": 4, "memoryGb": 8.0, "diskFreeGb": 100.0, "loadAverage": 0.12, "lastSeen": "$TIMESTAMP"}
EOF
)
# Append to heartbeat file (newline-delimited JSON)
echo "$PAYLOAD" >> "$HEARTBEAT_FILE"

# Wait for consumer to pick it up
sleep 1

# Now run CLI to list agents
echo "Registry CLI output:"
python3 -m registry list --storage "$STORAGE_FILE"

# Check that agent ID appears in storage
if python3 - <<PY
import json
s = json.load(open('$STORAGE_FILE'))
print('$AGENT_ID' in s)
PY
then
  echo "Smoke test OK: agent found in registry storage"
  exit 0
else
  echo "Smoke test FAILED: agent not found" >&2
  cat "$TMP_DIR/registry.log" || true
  exit 2
fi
