#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
REQ_TOPIC="ai.dev.approval.required"
RESP_TOPIC="ai.dev.review.out"
TIMEOUT=20

# Sample approval request messages
APPROVAL_REQ_AUTO='{"taskId":"mx-auto-1","status":"success","title":"Auto docs","metadata":{"change_type":"docs-only"}}'
APPROVAL_REQ_PENDING='{"taskId":"mx-pend-1","status":"success","title":"Requires human","metadata":{"change_type":"commit"}}'

PRODUCER_CMD="$(command -v kafka-console-producer.sh || command -v kafka-console-producer || true)"
CONSUMER_CMD="$(command -v kafka-console-consumer.sh || command -v kafka-console-consumer || true)"

echo "=== matrix-kafka-smoke ==="

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

# Test 1: auto-approve docs-only -> expect response on RESP_TOPIC
echo "[test] docs-only -> expect publish on ${RESP_TOPIC}"
if [ -n "$PRODUCER_CMD" ]; then
  publish_via_cli "$REQ_TOPIC" "$APPROVAL_REQ_AUTO" || { echo "publish failed" >&2; exit 3; }
else
  publish_via_python "$REQ_TOPIC" "$APPROVAL_REQ_AUTO" || { echo "publish failed" >&2; exit 3; }
fi

# Run bridge to consume and process (non-dry-run to exercise Kafka transport)
python3 -m matrix_bridge.bridge --consume-topic "$REQ_TOPIC" --timeout 20 || true

# Now verify published to RESP_TOPIC
if [ -n "$CONSUMER_CMD" ]; then
  if consume_via_cli "$RESP_TOPIC" 10; then
    echo "[ok] response topic published"
    PASS=$((PASS+1))
  else
    echo "[fail] response topic not published or consume failed"
    FAIL=$((FAIL+1))
  fi
else
  if consume_via_python "$RESP_TOPIC" 10; then
    echo "[ok] response topic published (python consumer)"
    PASS=$((PASS+1))
  else
    echo "[fail] response topic not published (python consumer)"
    FAIL=$((FAIL+1))
  fi
fi

# Test 2: pending requires approval -> bridge will post to Matrix (mock) and not auto-approve
# We still expect no automatic response for pending
# Publish pending request
if [ -n "$PRODUCER_CMD" ]; then
  publish_via_cli "$REQ_TOPIC" "$APPROVAL_REQ_PENDING" || { echo "publish failed" >&2; exit 3; }
else
  publish_via_python "$REQ_TOPIC" "$APPROVAL_REQ_PENDING" || { echo "publish failed" >&2; exit 3; }
fi

python3 -m matrix_bridge.bridge --consume-topic "$REQ_TOPIC" --timeout 20 || true

# Try to consume a response from RESP_TOPIC; if there's one, that's unexpected for pending
if [ -n "$CONSUMER_CMD" ]; then
  if consume_via_cli "$RESP_TOPIC" 5; then
    echo "[fail] unexpected response published for pending request"
    FAIL=$((FAIL+1))
  else
    echo "[ok] no auto-response for pending request"
    PASS=$((PASS+1))
  fi
else
  if consume_via_python "$RESP_TOPIC" 5; then
    echo "[fail] unexpected response published for pending request (python consumer)"
    FAIL=$((FAIL+1))
  else
    echo "[ok] no auto-response for pending request (python consumer)"
    PASS=$((PASS+1))
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
