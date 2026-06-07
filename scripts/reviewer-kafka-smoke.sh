#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
RESULT_TOPIC="ai.dev.result.out"
TASK_TOPIC="ai.dev.task.ofbiz"
APPROVAL_TOPIC="ai.dev.approval.request"
TIMEOUT=20

# Sample messages
DOCS_MSG='{"taskId":"rev-doc-kafka-1","status":"success","metadata":{"change_type":"docs-only"}}'
SECRETS_MSG='{"taskId":"rev-secret-kafka-1","status":"success","metadata":{"contains_secrets":true}}'

PRODUCER_CMD="$(command -v kafka-console-producer.sh || command -v kafka-console-producer || true)"
CONSUMER_CMD="$(command -v kafka-console-consumer.sh || command -v kafka-console-consumer || true)"

echo "=== reviewer-kafka-smoke ==="

echo "Bootstrap: ${BOOTSTRAP}"

publish_via_cli() {
  local topic="$1"; local message="$2"; local t=${3:-$TIMEOUT}
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    echo "$message" | timeout "${t}s" "$PRODUCER_CMD" --bootstrap-server "$BOOTSTRAP" --producer.config "$KAFKA_CLIENT_CONFIG" --topic "$topic"
  else
    echo "$message" | timeout "${t}s" "$PRODUCER_CMD" --bootstrap-server "$BOOTSTRAP" --topic "$topic"
  fi
}

publish_via_python() {
  local topic="$1"; local message="$2"
  export SMOKE_TOPIC="$topic"
  export SMOKE_MESSAGE="$message"
  python3 - <<'PY'
import os,sys,importlib
if importlib.util.find_spec('kafka') is None:
    print('kafka-python not installed', file=sys.stderr)
    sys.exit(2)
from kafka import KafkaProducer
b=os.environ.get('KAFKA_BOOTSTRAP','localhost:9092')
topic=os.environ.get('SMOKE_TOPIC')
msg=os.environ.get('SMOKE_MESSAGE')
try:
    p = KafkaProducer(bootstrap_servers=[b])
    p.send(topic, msg.encode('utf-8'))
    p.flush()
    print('Produced via kafka-python')
except Exception as e:
    print('Produce failed:', e, file=sys.stderr)
    sys.exit(3)
PY
}

consume_via_cli() {
  local topic="$1"; local t=${2:-$TIMEOUT}
  if [ -n "${KAFKA_CLIENT_CONFIG:-}" ]; then
    if timeout "${t}s" "$CONSUMER_CMD" --bootstrap-server "$BOOTSTRAP" --consumer.config "$KAFKA_CLIENT_CONFIG" --topic "$topic" --from-beginning --max-messages 1; then
      return 0
    else
      return 2
    fi
  else
    if timeout "${t}s" "$CONSUMER_CMD" --bootstrap-server "$BOOTSTRAP" --topic "$topic" --from-beginning --max-messages 1; then
      return 0
    else
      return 2
    fi
  fi
}

consume_via_python() {
  local topic="$1"; local t=${2:-$TIMEOUT}
  export SMOKE_TOPIC="$topic"
  export SMOKE_TIMEOUT="$t"
  python3 - <<'PY'
import os,sys,importlib
if importlib.util.find_spec('kafka') is None:
    sys.exit(2)
from kafka import KafkaConsumer
b=os.environ.get('KAFKA_BOOTSTRAP','localhost:9092')
topic=os.environ.get('SMOKE_TOPIC')
timeout_s=int(os.environ.get('SMOKE_TIMEOUT','10'))
try:
    c = KafkaConsumer(topic, bootstrap_servers=[b], consumer_timeout_ms=timeout_s*1000)
    for msg in c:
        print(msg.value.decode('utf-8') if isinstance(msg.value, bytes) else str(msg.value))
        sys.exit(0)
    else:
        print('No message received within timeout', file=sys.stderr)
        sys.exit(3)
except Exception as e:
    print('Consume failed:', e, file=sys.stderr)
    sys.exit(4)
PY
}

# Determine available producer/consumer
HAVE_PYTHON_CLIENT=0
if python3 - <<'PY'
import importlib,sys
sys.exit(0 if importlib.util.find_spec('kafka') is not None else 1)
PY
then
  HAVE_PYTHON_CLIENT=1
fi

if [ -z "$PRODUCER_CMD" ] && [ "$HAVE_PYTHON_CLIENT" -ne 1 ]; then
  echo "No Kafka producer available: install kafka-console-producer or kafka-python" >&2
  exit 2
fi

if [ -z "$CONSUMER_CMD" ] && [ "$HAVE_PYTHON_CLIENT" -ne 1 ]; then
  echo "No Kafka consumer available: install kafka-console-consumer or kafka-python" >&2
  exit 2
fi

PASS=0; FAIL=0

# Test 1: docs-only -> expect ai.dev.task.ofbiz
echo "[test] docs-only -> expect publish on ${TASK_TOPIC}"
if [ -n "$PRODUCER_CMD" ]; then
  publish_via_cli "$RESULT_TOPIC" "$DOCS_MSG" || { echo "publish failed" >&2; exit 3; }
else
  publish_via_python "$RESULT_TOPIC" "$DOCS_MSG" || { echo "publish failed" >&2; exit 3; }
fi

# Run reviewer to consume one message (non-dry-run to exercise Kafka transport)
python3 -m reviewer.service --consume-topic "$RESULT_TOPIC" --timeout 20 || true
# Now verify published to TASK_TOPIC
if [ -n "$CONSUMER_CMD" ]; then
  if consume_via_cli "$TASK_TOPIC" 10; then
    echo "[ok] task topic published"
    PASS=$((PASS+1))
  else
    echo "[fail] task topic not published or consume failed"
    FAIL=$((FAIL+1))
  fi
else
  if consume_via_python "$TASK_TOPIC" 10; then
    echo "[ok] task topic published (python consumer)"
    PASS=$((PASS+1))
  else
    echo "[fail] task topic not published (python consumer)"
    FAIL=$((FAIL+1))
  fi
fi

# Test 2: secrets -> expect ai.dev.approval.request
echo "[test] secrets -> expect publish on ${APPROVAL_TOPIC}"
if [ -n "$PRODUCER_CMD" ]; then
  publish_via_cli "$RESULT_TOPIC" "$SECRETS_MSG" || { echo "publish failed" >&2; exit 3; }
else
  publish_via_python "$RESULT_TOPIC" "$SECRETS_MSG" || { echo "publish failed" >&2; exit 3; }
fi

python3 -m reviewer.service --consume-topic "$RESULT_TOPIC" --timeout 20 || true

if [ -n "$CONSUMER_CMD" ]; then
  if consume_via_cli "$APPROVAL_TOPIC" 10; then
    echo "[ok] approval topic published"
    PASS=$((PASS+1))
  else
    echo "[fail] approval topic not published or consume failed"
    FAIL=$((FAIL+1))
  fi
else
  if consume_via_python "$APPROVAL_TOPIC" 10; then
    echo "[ok] approval topic published (python consumer)"
    PASS=$((PASS+1))
  else
    echo "[fail] approval topic not published (python consumer)"
    FAIL=$((FAIL+1))
  fi
fi

# Summary
echo "[smoke] PASS: $PASS, FAIL: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "[smoke] ALL TESTS PASS"
  exit 0
else
  echo "[smoke] SOME TESTS FAILED"
  exit 1
fi
