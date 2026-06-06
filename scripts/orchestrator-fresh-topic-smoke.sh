#!/usr/bin/env bash
set -euo pipefail

# Ensure local kafka CLI is in PATH
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"

: "${KAFKA_BOOTSTRAP:?KAFKA_BOOTSTRAP must be set}"
: "${KAFKA_CLIENT_CONFIG:?KAFKA_CLIENT_CONFIG must be set}"

TS=$(date +%s)
OBJECTIVE_TOPIC="ai.dev.objective.smoke.${TS}"
TASK_TOPIC="ai.dev.task.smoke.${TS}"

TOPICS_CMD="$(command -v kafka-topics.sh || command -v kafka-topics || true)"
if [ -z "$TOPICS_CMD" ]; then
  echo "kafka-topics CLI not found in PATH" >&2
  exit 1
fi

# Create topics (bounded 30s)
echo "Creating topics: $OBJECTIVE_TOPIC and $TASK_TOPIC (bounded 30s)"
if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
  CMD1=("$TOPICS_CMD" --bootstrap-server "$KAFKA_BOOTSTRAP" --command-config "$KAFKA_CLIENT_CONFIG" --create --if-not-exists --topic "$OBJECTIVE_TOPIC" --partitions 1 --replication-factor 1)
  CMD2=("$TOPICS_CMD" --bootstrap-server "$KAFKA_BOOTSTRAP" --command-config "$KAFKA_CLIENT_CONFIG" --create --if-not-exists --topic "$TASK_TOPIC" --partitions 1 --replication-factor 1)
else
  CMD1=("$TOPICS_CMD" --bootstrap-server "$KAFKA_BOOTSTRAP" --create --if-not-exists --topic "$OBJECTIVE_TOPIC" --partitions 1 --replication-factor 1)
  CMD2=("$TOPICS_CMD" --bootstrap-server "$KAFKA_BOOTSTRAP" --create --if-not-exists --topic "$TASK_TOPIC" --partitions 1 --replication-factor 1)
fi

if ! timeout 30s "${CMD1[@]}"; then
  echo "Warning: creating topic $OBJECTIVE_TOPIC failed or timed out" >&2
fi
if ! timeout 30s "${CMD2[@]}"; then
  echo "Warning: creating topic $TASK_TOPIC failed or timed out" >&2
fi

# Prepare a valid objective JSON
OBJECTIVE_ID="smoke-${TS}"
OBJECTIVE_JSON=$(cat <<JSON
{"objectiveId":"${OBJECTIVE_ID}","title":"fresh-topic-smoke","description":"fresh-topic smoke objective","targetSystems":["ofbiz"]}
JSON
)

# Publish objective to OBJECTIVE_TOPIC
PRODUCER="$(command -v kafka-console-producer.sh || command -v kafka-console-producer || true)"
PUBLISH_OK=0
if [ -n "$PRODUCER" ]; then
  echo "Publishing objective to $OBJECTIVE_TOPIC using $PRODUCER"
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    if timeout 30s printf '%s' "$OBJECTIVE_JSON" | "$PRODUCER" --bootstrap-server "$KAFKA_BOOTSTRAP" --producer.config "$KAFKA_CLIENT_CONFIG" --topic "$OBJECTIVE_TOPIC"; then
      PUBLISH_OK=1
    else
      echo "Producer failed or timed out" >&2
    fi
  else
    if timeout 30s printf '%s' "$OBJECTIVE_JSON" | "$PRODUCER" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "$OBJECTIVE_TOPIC"; then
      PUBLISH_OK=1
    else
      echo "Producer failed or timed out" >&2
    fi
  fi
else
  echo "No kafka-console-producer found" >&2
fi

# Run orchestrator once (bounded)
echo "Running orchestrator to process one objective from $OBJECTIVE_TOPIC and publish to $TASK_TOPIC"
# Use the explicit module target
timeout 30s python3 -m orchestrator.main --once --once-timeout 20 --from-beginning --objective-topic "$OBJECTIVE_TOPIC" --task-topic "$TASK_TOPIC" || true

# Consume one task from TASK_TOPIC and save output
mkdir -p logs
OUTFILE="logs/fresh-topic-task-output.json"
ERRFILE="logs/fresh-topic-task-stderr.log"

CONSUMER="$(command -v kafka-console-consumer.sh || command -v kafka-console-consumer || true)"
if [ -n "$CONSUMER" ]; then
  echo "Consuming one message from $TASK_TOPIC using $CONSUMER (bounded 10s)"
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    # Use explicit timeout-ms to ensure bounded CLI consumer
    if timeout 20s "$CONSUMER" --bootstrap-server "$KAFKA_BOOTSTRAP" --consumer.config "$KAFKA_CLIENT_CONFIG" --topic "$TASK_TOPIC" --from-beginning --max-messages 1 --timeout-ms 10000 > "$OUTFILE" 2> "$ERRFILE"; then
      echo "Consumed task saved to $OUTFILE"
    else
      echo "Consumer returned non-zero or timed out; check $ERRFILE" >&2 || true
    fi
  else
    if timeout 20s "$CONSUMER" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "$TASK_TOPIC" --from-beginning --max-messages 1 --timeout-ms 10000 > "$OUTFILE" 2> "$ERRFILE"; then
      echo "Consumed task saved to $OUTFILE"
    else
      echo "Consumer returned non-zero or timed out; check $ERRFILE" >&2 || true
    fi
  fi
else
  echo "No kafka-console-consumer found; skipping consume" >&2
  echo "" > "$OUTFILE"
  echo "consumer-missing" > "$ERRFILE"
fi

# Save smoke report
REPORT="ORCHESTRATOR_FRESH_TOPIC_SMOKE_REPORT.md"
cat > "$REPORT" <<REPORT_EOF
ORCHESTRATOR FRESH TOPIC SMOKE REPORT

OBJECTIVE_TOPIC: $OBJECTIVE_TOPIC
TASK_TOPIC: $TASK_TOPIC

PUBLISH_OK: $PUBLISH_OK

Objective JSON published:
$OBJECTIVE_JSON

Contents of $OUTFILE:

$(sed -n '1,200p' "$OUTFILE" 2>/dev/null || true)

Contents of $ERRFILE:

$(sed -n '1,200p' "$ERRFILE" 2>/dev/null || true)

REPORT_EOF


echo "Smoke completed. Report saved to $REPORT"

# Do not delete topics per instructions
exit 0
