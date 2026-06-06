#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
TOPIC="${1:-results}"
TIMEOUT="${2:-30}"

CONSUMER="$(command -v kafka-console-consumer.sh || command -v kafka-console-consumer || true)"
if [ -n "$CONSUMER" ]; then
  echo "Using Kafka CLI consumer: $CONSUMER (bounded ${TIMEOUT}s)"
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    if timeout "${TIMEOUT}s" "$CONSUMER" --bootstrap-server "$BOOTSTRAP" --consumer.config "$KAFKA_CLIENT_CONFIG" --topic "$TOPIC" --from-beginning --max-messages 1; then
      exit 0
    else
      echo "Consumer failed or timed out" >&2
      exit 2
    fi
  else
    if timeout "${TIMEOUT}s" "$CONSUMER" --bootstrap-server "$BOOTSTRAP" --topic "$TOPIC" --from-beginning --max-messages 1; then
      exit 0
    else
      echo "Consumer failed or timed out" >&2
      exit 2
    fi
  fi
fi

# Try kafka-python
export SMOKE_TOPIC="$TOPIC"
export SMOKE_TIMEOUT="$TIMEOUT"
python3 - <<'PY'
import os, sys, importlib
if importlib.util.find_spec('kafka') is None:
    print('kafka-python not installed', file=sys.stderr)
    sys.exit(2)
from kafka import KafkaConsumer
b=os.environ.get('KAFKA_BOOTSTRAP','localhost:9092')
topic=os.environ.get('SMOKE_TOPIC','results')
timeout_s = int(os.environ.get('SMOKE_TIMEOUT','10'))
try:
    c = KafkaConsumer(topic, bootstrap_servers=[b], consumer_timeout_ms=timeout_s*1000)
    for msg in c:
        print(msg.value.decode('utf-8') if isinstance(msg.value, bytes) else str(msg.value))
        break
    else:
        print('No message received within timeout', file=sys.stderr)
        sys.exit(3)
except Exception as e:
    print('Consume failed:', e, file=sys.stderr)
    sys.exit(4)
PY
PY_EXIT=$?
if [ $PY_EXIT -eq 0 ]; then
  exit 0
fi
if [ $PY_EXIT -eq 2 ]; then
  echo "No Kafka client available to consume messages (install kafka-python or Kafka CLI)" >&2
  exit 1
fi
# Other non-zero code indicates failure
exit 2
