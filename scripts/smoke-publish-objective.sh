#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
TOPIC="${1:-objectives}"
MESSAGE="${2:-{\"objective\":\"smoke-test\"}}"

PRODUCER="$(command -v kafka-console-producer.sh || command -v kafka-console-producer || true)"
if [ -n "$PRODUCER" ]; then
  echo "Using Kafka CLI producer: $PRODUCER (bounded 30s)"
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    echo "$MESSAGE" | timeout 30s "$PRODUCER" --bootstrap-server "$BOOTSTRAP" --producer.config "$KAFKA_CLIENT_CONFIG" --topic "$TOPIC" || { echo "Producer failed or timed out" >&2; exit 2; }
  else
    echo "$MESSAGE" | timeout 30s "$PRODUCER" --bootstrap-server "$BOOTSTRAP" --topic "$TOPIC" || { echo "Producer failed or timed out" >&2; exit 2; }
  fi
  exit 0
fi

# Try python kafka client (kafka-python)
export SMOKE_TOPIC="$TOPIC"
export SMOKE_MESSAGE="$MESSAGE"
python3 - <<'PY'
import os, sys, importlib
if importlib.util.find_spec('kafka') is None:
    sys.exit(2)
from kafka import KafkaProducer
b=os.environ.get('KAFKA_BOOTSTRAP','localhost:9092')
topic=os.environ.get('SMOKE_TOPIC','objectives')
msg=os.environ.get('SMOKE_MESSAGE','{"objective":"smoke-test"}')
try:
    p = KafkaProducer(bootstrap_servers=[b])
    p.send(topic, msg.encode('utf-8'))
    p.flush()
    print('Produced via kafka-python')
except Exception as e:
    print('Produce failed:', e, file=sys.stderr)
    sys.exit(3)
PY
PY_EXIT=$?
if [ $PY_EXIT -eq 0 ]; then
  exit 0
fi
if [ $PY_EXIT -eq 2 ]; then
  echo "No kafka client available: install kafka-python or Kafka CLI" >&2
  exit 1
fi
echo "Python producer failed (exit $PY_EXIT)" >&2
exit 1
