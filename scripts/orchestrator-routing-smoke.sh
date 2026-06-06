#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

# Deterministic routing smoke script
# Creates a fresh objective/topic pair, publishes an objective targeting OFBiz,
# runs the orchestrator once, and verifies a task was produced to ai.dev.task.ofbiz.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP:-}"
KAFKA_CLIENT_CONFIG="${KAFKA_CLIENT_CONFIG:-}"

if [[ -z "$KAFKA_BOOTSTRAP" ]]; then
  echo "KAFKA_BOOTSTRAP must be set to run the routing smoke test. Example: export KAFKA_BOOTSTRAP=kafka.yahlife.com:9095" >&2
  exit 2
fi

# Locate kafka CLI tools
TOPICS_CMD="$(command -v kafka-topics.sh || command -v kafka-topics || true)"
PRODUCER_CMD="$(command -v kafka-console-producer.sh || command -v kafka-console-producer || true)"
CONSUMER_CMD="$(command -v kafka-console-consumer.sh || command -v kafka-console-consumer || true)"

if [[ -z "$TOPICS_CMD" || -z "$PRODUCER_CMD" || -z "$CONSUMER_CMD" ]]; then
  echo "Kafka CLI tools not found (kafka-topics.sh / kafka-console-producer / kafka-console-consumer). Install Kafka CLI or set PATH." >&2
  exit 3
fi

TS=$(date +%s)
OBJ_TOPIC="ai.dev.objective.routing.smoke.${TS}"
TASK_TOPIC="ai.dev.task.routing.smoke.${TS}"

CMD_CONFIG_ARGS=()
if [[ -n "$KAFKA_CLIENT_CONFIG" ]]; then
  CMD_CONFIG_ARGS=(--command-config "$KAFKA_CLIENT_CONFIG")
fi

# Create the fresh topics (bounded)
for t in "$OBJ_TOPIC" "$TASK_TOPIC"; do
  echo "Ensuring topic exists: $t"
  if timeout 30s "$TOPICS_CMD" --describe --topic "$t" --bootstrap-server "$KAFKA_BOOTSTRAP" ${CMD_CONFIG_ARGS[@]:+${CMD_CONFIG_ARGS[@]}} >/dev/null 2>&1; then
    echo "Topic $t exists"
  else
    echo "Creating $t"
    if ! timeout 30s "$TOPICS_CMD" --create --topic "$t" --partitions 1 --replication-factor 1 --bootstrap-server "$KAFKA_BOOTSTRAP" ${CMD_CONFIG_ARGS[@]:+${CMD_CONFIG_ARGS[@]}}; then
      echo "Create attempt for $t failed; continuing" >&2
    fi
  fi
done

# Publish objective JSON to the objective topic
OBJ_JSON='{"objectiveId":"routing-smoke","title":"Routing Smoke Test","description":"Verify OFBiz routing","targetSystems":["ofbiz"] }'

if ! timeout 10s $PRODUCER_CMD --bootstrap-server "$KAFKA_BOOTSTRAP" ${KAFKA_CLIENT_CONFIG:+--producer.config "$KAFKA_CLIENT_CONFIG"} --topic "$OBJ_TOPIC" <<< "$OBJ_JSON"; then
  echo "Failed to publish objective to $OBJ_TOPIC" >&2
  exit 4
fi

echo "Published objective to $OBJ_TOPIC"

# Run orchestrator once - it will consume from $OBJ_TOPIC and should publish to ai.dev.task.ofbiz
export AI_DEV_OBJECTIVE_IN_TOPIC="$OBJ_TOPIC"
# Use default routing (no --out-topic override)
if ! python3 -m orchestrator.main --once --once-timeout 20 --from-beginning --objective-topic "$OBJ_TOPIC"; then
  echo "Orchestrator run failed or returned non-zero" >&2
  # continue to attempt to consume for diagnostics
fi

# Attempt to consume from ai.dev.task.ofbiz (bounded)
mkdir -p logs
OUT_FILE="logs/routing-smoke-output.json"
if timeout 20s $CONSUMER_CMD --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "ai.dev.task.ofbiz" --max-messages 1 --timeout-ms $((20*1000)) ${KAFKA_CLIENT_CONFIG:+--consumer.config "$KAFKA_CLIENT_CONFIG"} > "$OUT_FILE" 2>/dev/null; then
  echo "Routing smoke: consumed task from ai.dev.task.ofbiz and saved to $OUT_FILE"
  cat "$OUT_FILE"
  exit 0
else
  echo "Routing smoke: no message found on ai.dev.task.ofbiz within timeout. Check orchestrator logs or broker." >&2
  exit 5
fi
