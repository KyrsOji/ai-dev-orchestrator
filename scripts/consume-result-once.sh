#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

# Consume exactly one message from the result topic to verify runner output
RESULT_TOPIC=${RESULT_TOPIC:-ai.dev.result.out}
KAFKA_BOOTSTRAP=${KAFKA_BOOTSTRAP:-kafka.yahlife.com:9095}
KAFKA_CLIENT_CONFIG=${KAFKA_CLIENT_CONFIG:-}
KAFKA_FORCE_CLI=${KAFKA_FORCE_CLI:-1}

if [ "${KAFKA_FORCE_CLI}" != "1" ]; then
  echo "KAFKA_FORCE_CLI != 1; aborting to avoid using Python-only consumer"
  exit 2
fi

CONSUMER_BIN=$(command -v kafka-console-consumer.sh || true)
if [ -z "$CONSUMER_BIN" ]; then
  echo "kafka-console-consumer.sh not found in PATH; cannot consume result"
  exit 3
fi

if [ -n "$KAFKA_CLIENT_CONFIG" ]; then
  "$CONSUMER_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --consumer.config "$KAFKA_CLIENT_CONFIG" --topic "$RESULT_TOPIC" --from-beginning --max-messages 1 --timeout-ms 10000
else
  "$CONSUMER_BIN" --bootstrap-server "$KAFKA_BOOTSTRAP" --topic "$RESULT_TOPIC" --from-beginning --max-messages 1 --timeout-ms 10000
fi
