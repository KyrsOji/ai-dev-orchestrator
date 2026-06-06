#!/usr/bin/env bash
set -euo pipefail

# Ensure local kafka CLI is in PATH
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"

: "${KAFKA_BOOTSTRAP:?KAFKA_BOOTSTRAP must be set}"
: "${KAFKA_CLIENT_CONFIG:?KAFKA_CLIENT_CONFIG must be set}"

# Force using CLI consumer/producer
export KAFKA_FORCE_CLI=1

# Create a unique objectiveId using timestamp
OBJECTIVE_ID="smoke-$(date +%s)"
OBJECTIVE_JSON=$(cat <<JSON
{"objectiveId":"${OBJECTIVE_ID}", "title":"smoke test", "description":"smoke test objective", "targetSystems":["ofbiz"]}
JSON
)

echo "Publishing objective ${OBJECTIVE_ID} to ai.dev.objective.in"
PRODUCER="$(command -v kafka-console-producer.sh || command -v kafka-console-producer || true)"
if [ -n "$PRODUCER" ]; then
  echo "Using Kafka CLI producer: $PRODUCER"
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    printf '%s' "$OBJECTIVE_JSON" | timeout 30s "$PRODUCER" --bootstrap-server "$KAFKA_BOOTSTRAP" --producer.config "$KAFKA_CLIENT_CONFIG" --topic "ai.dev.objective.in"
  else
    printf '%s' "$OBJECTIVE_JSON" | timeout 30s "$PRODUCER" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "ai.dev.objective.in"
  fi
else
  echo "No producer available" >&2
  exit 1
fi

# Run orchestrator once in smoke mode (bounded)
echo "Running orchestrator --once"
python3 -m orchestrator.main --once --once-timeout 20 --from-beginning || true

# Consume exactly one message from ai.dev.task from beginning and save
mkdir -p logs
OUTFILE="logs/task-smoke-output.json"
ERRFILE="logs/task-smoke-stderr.log"

echo "Consuming one message from ai.dev.task and saving to ${OUTFILE}"
CONSUMER="$(command -v kafka-console-consumer.sh || command -v kafka-console-consumer || true)"
if [ -n "$CONSUMER" ]; then
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    timeout 20s "$CONSUMER" --bootstrap-server "$KAFKA_BOOTSTRAP" --consumer.config "$KAFKA_CLIENT_CONFIG" --topic "ai.dev.task" --from-beginning --max-messages 1 > "$OUTFILE" 2> "$ERRFILE" || true
  else
    timeout 20s "$CONSUMER" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "ai.dev.task" --from-beginning --max-messages 1 > "$OUTFILE" 2> "$ERRFILE" || true
  fi
else
  # Use project helper
  scripts/smoke-consume-one.sh "ai.dev.task" 20 > "$OUTFILE" 2> "$ERRFILE" || true
fi

echo "Smoke run complete. Output saved to ${OUTFILE}. Stderr saved to ${ERRFILE}."
