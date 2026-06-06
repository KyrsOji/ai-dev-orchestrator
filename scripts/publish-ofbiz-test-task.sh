#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

# Publish a smoke test OFBiz task to the task topic using kafka-console-producer
TASK_TOPIC=${TASK_TOPIC:-ai.dev.task.ofbiz}
KAFKA_BOOTSTRAP=${KAFKA_BOOTSTRAP:-kafka.yahlife.com:9095}
KAFKA_CLIENT_CONFIG=${KAFKA_CLIENT_CONFIG:-}
KAFKA_FORCE_CLI=${KAFKA_FORCE_CLI:-1}

if [ "${KAFKA_FORCE_CLI}" != "1" ]; then
  echo "KAFKA_FORCE_CLI != 1; aborting to avoid using Python-only producer"
  exit 2
fi

PRODUCER_BIN=$(command -v kafka-console-producer.sh || true)
if [ -z "$PRODUCER_BIN" ]; then
  echo "kafka-console-producer.sh not found in PATH; cannot publish test task"
  exit 3
fi

read -r -d '' MSG <<'EOF'
{
  "taskId":"ofbiz-dry-run-test",
  "objectiveId":"runner-smoke",
  "title":"OFBiz Runner Dry Run",
  "description":"Verify OFBiz runner consumes task and prepares run directory.",
  "targetSystem":"ofbiz",
  "instructions":"Do not modify OFBiz."
}
EOF

if [ -n "$KAFKA_CLIENT_CONFIG" ]; then
  echo "$MSG" | "$PRODUCER_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --producer.config "$KAFKA_CLIENT_CONFIG" --topic "$TASK_TOPIC"
else
  echo "$MSG" | "$PRODUCER_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "$TASK_TOPIC"
fi

echo "Published test task to topic $TASK_TOPIC" 
