#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
# create-ai-dev-topics.sh
# Idempotent topic creation for ai.dev.* topics
# Requirements:
# - KAFKA_BOOTSTRAP must be set (e.g., kafka.yahlife.com:9095)
# - KAFKA_CLIENT_CONFIG may point to a kafka client properties file (optional)
# - kafka-topics.sh must be on PATH or available at /home/kojiyah/tools/kafka/bin/kafka-topics.sh
# - Each kafka CLI command is bounded by timeout 30s

set -euo pipefail

KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP:-}"
KAFKA_CLIENT_CONFIG="${KAFKA_CLIENT_CONFIG:-}"
AI_DEV_TASK_TOPICS="${AI_DEV_TASK_TOPICS:-}"

if [[ -z "$KAFKA_BOOTSTRAP" ]]; then
  echo "KAFKA_BOOTSTRAP not set. Export KAFKA_BOOTSTRAP=something:9095" >&2
  exit 2
fi

# Locate kafka-topics.sh
if command -v kafka-topics.sh >/dev/null 2>&1; then
  TOPIC_CMD="$(command -v kafka-topics.sh)"
elif [[ -x "/home/kojiyah/tools/kafka/bin/kafka-topics.sh" ]]; then
  TOPIC_CMD="/home/kojiyah/tools/kafka/bin/kafka-topics.sh"
else
  echo "kafka-topics.sh not found on PATH and not at /home/kojiyah/tools/kafka/bin" >&2
  exit 3
fi

# Build optional command-config args
CMD_CONFIG_ARGS=()
if [[ -n "$KAFKA_CLIENT_CONFIG" ]]; then
  CMD_CONFIG_ARGS=(--command-config "$KAFKA_CLIENT_CONFIG")
fi

# Default topics to ensure
TOPICS=(
  "ai.dev.objective.in"
  # Per-server task topics
  "ai.dev.task.ofbiz"
  "ai.dev.task.liferay"
  "ai.dev.task.kafka"
  "ai.dev.task.cyclos"
  "ai.dev.task.exo"
  "ai.dev.task.jitsi"
  "ai.dev.task.matrix"
  # Generic / backwards compatible task topic
  "ai.dev.task"
  "ai.dev.result.out"
  "ai.dev.review.out"
  "ai.dev.approval.required"
  "ai.dev.audit.log"
  "ai.dev.deadletter"
  # Agent registry status topic
  "ai.dev.agent.status"
)

# Append any additional task topics provided via AI_DEV_TASK_TOPICS (comma-separated)
if [[ -n "$AI_DEV_TASK_TOPICS" ]]; then
  IFS=',' read -r -a EXTRA_TASKS <<< "$AI_DEV_TASK_TOPICS"
  for t in "${EXTRA_TASKS[@]}"; do
    [[ -n "$t" ]] && TOPICS+=("$t")
  done
fi

for topic in "${TOPICS[@]}"; do
  echo "Ensuring topic exists: $topic (bounded 30s)"
  # Check existence
  if timeout 30s "$TOPIC_CMD" --describe --topic "$topic" --bootstrap-server "$KAFKA_BOOTSTRAP" ${CMD_CONFIG_ARGS[@]:+${CMD_CONFIG_ARGS[@]}} >/dev/null 2>&1; then
    echo "Topic $topic already exists"
    continue
  fi

  echo "Creating topic $topic"
  # Create with sensible defaults; adjust partitions/replication as your environment requires
  # replication-factor=1 used to avoid failures on small test clusters
  if ! timeout 30s "$TOPIC_CMD" --create --topic "$topic" --partitions 3 --replication-factor 1 --bootstrap-server "$KAFKA_BOOTSTRAP" ${CMD_CONFIG_ARGS[@]:+${CMD_CONFIG_ARGS[@]}}; then
    echo "Create attempt for $topic failed; verifying existence (bounded 30s)" >&2
    if timeout 30s "$TOPIC_CMD" --describe --topic "$topic" --bootstrap-server "$KAFKA_BOOTSTRAP" ${CMD_CONFIG_ARGS[@]:+${CMD_CONFIG_ARGS[@]}} >/dev/null 2>&1; then
      echo "$topic exists after create attempt"
    else
      echo "Failed to create $topic" >&2
    fi
  else
    echo "Created topic $topic"
  fi
done

exit 0
