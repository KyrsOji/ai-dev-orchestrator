#!/usr/bin/env bash
# Live smoke test for Agent Registry using Kafka
# 1) Start registry consumer (Kafka mode) in background
# 2) Publish a heartbeat to ai.dev.agent.status
# 3) Wait for registry to persist the heartbeat and verify via registry CLI

set -euo pipefail

TMP_DIR="$(mktemp -d --tmpdir agent-registry-live-XXXX)"
STORAGE_FILE="$TMP_DIR/registry.json"
LOG_FILE="$TMP_DIR/registry.log"

echo "Using tmp dir: $TMP_DIR"
# Run mode: smoke (bounded) or service (long-running)
AGENT_REGISTRY_RUN_MODE="${AGENT_REGISTRY_RUN_MODE:-smoke}"
echo "Run mode: ${AGENT_REGISTRY_RUN_MODE} (smoke=bounded, service=long-running)"

: "Ensure KAFKA_BOOTSTRAP is set"
: "KAFKA_CLIENT_CONFIG may be set for mTLS"
if [[ -z "${KAFKA_BOOTSTRAP:-}" ]]; then
  echo "KAFKA_BOOTSTRAP must be set to run live smoke test" >&2
  exit 2
fi

PRODUCER_CMD="$(command -v kafka-console-producer.sh || true)"
if [[ -z "$PRODUCER_CMD" ]]; then
  echo "kafka-console-producer.sh not found on PATH" >&2
  exit 3
fi

# Start registry consumer in background (consumes from Kafka)
if [[ "${AGENT_REGISTRY_RUN_MODE:-smoke}" == "service" ]]; then
  # Service mode: long-running consumer (no internal timeout)
  python3 -m registry.consumer --storage "$STORAGE_FILE" --topic ai.dev.agent.status --from-beginning > "$LOG_FILE" 2>&1 &
  REG_PID=$!
else
  # Smoke mode: bounded consumer using timeout and a reaper (bounded 60s)
  timeout --kill-after=5s 60s python3 -m registry.consumer --storage "$STORAGE_FILE" --topic ai.dev.agent.status --from-beginning > "$LOG_FILE" 2>&1 &
  REG_PID=$!
  # Reaper to ensure the consumer is killed if timeout fails to stop it
  ( sleep 65; echo "Reaper: killing registry consumer pid $REG_PID"; kill -TERM "$REG_PID" 2>/dev/null || true; sleep 2; kill -KILL "$REG_PID" 2>/dev/null || true ) &
  REAPER_PID=$!
fi

echo "Started registry consumer pid=$REG_PID (logs -> $LOG_FILE)"

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

# Give consumer time to start
sleep 2

# Build a unique heartbeat payload
TIMESTAMP="$(python3 - <<'PY'
from datetime import datetime, timezone
print(datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace('+00:00','Z'))
PY
)"
AGENT_ID="agent-registry-live-$(date +%s)"
PAYLOAD=$(cat <<EOF
{"agentId": "$AGENT_ID", "hostname": "live-smoke-host", "roles": ["ofbiz","java"], "status": "idle", "cpuCount": 2, "memoryGb": 4.0, "diskFreeGb": 20.0, "loadAverage": 0.01, "lastSeen": "$TIMESTAMP"}
EOF
)

echo "Publishing heartbeat AGENT_ID=$AGENT_ID to ai.dev.agent.status"
# Use producer with client config if set
if [[ -n "${KAFKA_CLIENT_CONFIG:-}" ]]; then
  echo "$PAYLOAD" | "$PRODUCER_CMD" --bootstrap-server "$KAFKA_BOOTSTRAP" --producer.config "$KAFKA_CLIENT_CONFIG" --topic ai.dev.agent.status
else
  echo "$PAYLOAD" | "$PRODUCER_CMD" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic ai.dev.agent.status
fi

# Wait up to 20s for registry to observe the heartbeat
MAX_WAIT=20
SLEEP=1
WAITED=0
FOUND=0
while [[ "$WAITED" -lt "$MAX_WAIT" ]]; do
  if python3 - <<PY
import json
try:
  s=json.load(open('$STORAGE_FILE'))
except Exception:
  print('')
  raise SystemExit(2)
print('$AGENT_ID' in s)
PY
  then
    FOUND=1
    break
  fi
  sleep $SLEEP
  WAITED=$((WAITED + SLEEP))
done

if [[ "$FOUND" -eq 1 ]]; then
  echo "Live smoke OK: agent found in registry storage"
  echo "Registry entries:"
  python3 -m registry list --storage "$STORAGE_FILE"
  exit 0
else
  echo "Live smoke FAILED: agent not found after ${MAX_WAIT}s" >&2
  echo "--- registry log ---"
  sed -n '1,200p' "$LOG_FILE" || true
  exit 2
fi
