#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
TOPICS_FILE="${1:-config/topics.yaml}"

if ! command -v kafka-topics.sh >/dev/null 2>&1 && ! command -v kafka-topics >/dev/null 2>&1; then
  echo "Missing Kafka CLI (kafka-topics.sh). Please install Kafka CLI tools or install kafka-python." >&2
  exit 1
fi

TOPICS_CMD="$(command -v kafka-topics.sh || command -v kafka-topics)"

if [ ! -f "$TOPICS_FILE" ]; then
  echo "Topics file $TOPICS_FILE not found" >&2
  exit 1
fi

# Parse topics: simple grep for 'name: <topic>' lines
mapfile -t TOPIC_NAMES < <(grep -E '^\s*name:\s*' "$TOPICS_FILE" | awk '{print $2}')
if [ ${#TOPIC_NAMES[@]} -eq 0 ]; then
  echo "No topics found in $TOPICS_FILE" >&2
  exit 1
fi

for t in "${TOPIC_NAMES[@]}"; do
  echo "Creating topic $t (bounded 30s)"
  # use external timeout to guard against hangs and allow command-config
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    CMD=( "$TOPICS_CMD" --bootstrap-server "$BOOTSTRAP" --command-config "$KAFKA_CLIENT_CONFIG" --create --topic "$t" --partitions 1 --replication-factor 1 )
  else
    CMD=( "$TOPICS_CMD" --bootstrap-server "$BOOTSTRAP" --create --topic "$t" --partitions 1 --replication-factor 1 )
  fi
  if ! timeout 30s "${CMD[@]}"; then
    echo "Failed or timed out creating topic $t" >&2
  fi
done

exit 0
