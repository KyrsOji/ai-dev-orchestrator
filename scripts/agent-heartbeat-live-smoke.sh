#!/usr/bin/env bash
set -euo pipefail

# Publish one heartbeat to ai.dev.agent.status and verify it is visible
# Expects KAFKA_BOOTSTRAP and optionally KAFKA_CLIENT_CONFIG in the environment.

TOPIC="ai.dev.agent.status"
: "${KAFKA_BOOTSTRAP:?KAFKA_BOOTSTRAP must be set (e.g. kafka.yahlife.com:9095)}"
# KAFKA_CLIENT_CONFIG may be empty

AGENT_ID_DEFAULT="ofbiz-dev-01"
AGENT_ROLES_DEFAULT="ofbiz,java,openhands-runner"
AGENT_STATUS_DEFAULT="idle"
HOSTNAME_DEFAULT="ubuntu-16gb-sin-1"

AGENT_ID="${AGENT_ID:-$AGENT_ID_DEFAULT}"
AGENT_ROLES="${AGENT_ROLES:-$AGENT_ROLES_DEFAULT}"
AGENT_STATUS="${AGENT_STATUS:-$AGENT_STATUS_DEFAULT}"
HOSTNAME="${HOSTNAME:-$HOSTNAME_DEFAULT}"

# create an ISO8601 UTC timestamp that we can match exactly
TIMESTAMP=$(python3 - <<'PY'
from datetime import datetime, timezone
print(datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace('+00:00','Z'))
PY
)

# Build JSON payload with explicit fields (use fixed roles array for determinism)
# Use single-line compact JSON
PAYLOAD=$(cat <<JSON
{"agentId":"${AGENT_ID}","hostname":"${HOSTNAME}","roles":["ofbiz","java","openhands-runner"],"status":"${AGENT_STATUS}","lastSeen":"${TIMESTAMP}"}
JSON
)


echo "Publishing heartbeat to ${TOPIC}: ${PAYLOAD}"

# Prefer kafka-console-producer if available
PRODUCER_BIN=$(command -v kafka-console-producer.sh || true)
if [ -n "$PRODUCER_BIN" ]; then
  CMD=("$PRODUCER_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "$TOPIC")
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    CMD+=("--producer.config" "$KAFKA_CLIENT_CONFIG")
  fi
  printf "%s\n" "$PAYLOAD" | "${CMD[@]}"
else
  echo "kafka-console-producer not found in PATH; attempting python publish via matrix_bridge KafkaClient"
  python3 - <<PY
import json
from matrix_bridge.kafka_client import KafkaClient
c=KafkaClient()
ok,_=c.publish('$TOPIC', json.loads('''$PAYLOAD'''))
print('PUBLISH_OK' if ok else 'PUBLISH_FAILED')
PY
fi

# Now consume messages and look for our unique timestamp
CONSUMER_BIN=$(command -v kafka-console-consumer.sh || true)
if [ -n "$CONSUMER_BIN" ]; then
  GROUP="${AGENT_REGISTRY_CONSUMER_GROUP:-ai-dev-agent-registry-group}"
  CMD=("$CONSUMER_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "$TOPIC" --group "$GROUP" --max-messages 50 --timeout-ms 90000)
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    CMD+=("--consumer.config" "$KAFKA_CLIENT_CONFIG")
  fi
  echo "Consuming up to 50 messages (90s timeout) to find our heartbeat..."
  OUT=$("${CMD[@]}" 2>&1 || true)
  echo "$OUT" | grep -q "${TIMESTAMP}" && { echo "Found expected heartbeat (timestamp ${TIMESTAMP})"; exit 0; }
  echo "Did not find expected heartbeat. Consumer output:" >&2
  echo "$OUT" >&2
  exit 2
else
  echo "kafka-console-consumer not found; attempting python consume via matrix_bridge KafkaClient"
  python3 - <<PY
from matrix_bridge.kafka_client import KafkaClient
c=KafkaClient()
msg,meta=c.consume_one(topic='$TOPIC', timeout_s=30, from_beginning=False)
print('GOT', msg, meta)
if msg and msg.get('lastSeen')=='$TIMESTAMP':
    print('FOUND')
    raise SystemExit(0)
print('NOTFOUND')
raise SystemExit(2)
PY
fi
