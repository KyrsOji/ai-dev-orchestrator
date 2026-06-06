#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

echo "=== ai-dev-orchestrator: diagnose-kafka-client.sh ==="

echo "KAFKA_BOOTSTRAP=${KAFKA_BOOTSTRAP:-<not set>}"
BOOTSTRAP="${KAFKA_BOOTSTRAP:-localhost:9092}"
# Use first host:port if comma-separated
FIRST_HOSTPORT="$(echo "$BOOTSTRAP" | awk -F',' '{print $1}')"
HOST="$(echo "$FIRST_HOSTPORT" | awk -F':' '{print $1}')"
PORT="$(echo "$FIRST_HOSTPORT" | awk -F':' '{print $2}')"
if [ -z "$PORT" ]; then PORT=9092; fi

echo "Bootstrap target: $HOST:$PORT"

echo "\n-- Kafka CLI tools availability --"
check_cli() {
  cmd="$1"
  alt="$2"
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "$cmd: $(command -v $cmd)"
  elif [ -n "$alt" ] && command -v "$alt" >/dev/null 2>&1; then
    echo "$alt: $(command -v $alt)"
  else
    echo "$cmd / $alt: NOT FOUND"
  fi
}

check_cli kafka-topics.sh kafka-topics
check_cli kafka-console-producer.sh kafka-console-producer
check_cli kafka-console-consumer.sh kafka-console-consumer


echo "\n-- Python packages (system python3) --"
python3 - <<'PY'
import importlib,sys
checks = {
    'kafka (kafka-python)': 'kafka',
    'confluent_kafka (confluent-kafka)': 'confluent_kafka',
    'PyYAML (yaml)': 'yaml',
}
for label,module in checks.items():
    found = importlib.util.find_spec(module) is not None
    print(f"{label}: {'FOUND' if found else 'NOT FOUND'}")
PY


echo "\n-- TCP reachability to bootstrap host (3s timeout) --"
python3 - <<PY
import socket,os
bs=os.environ.get('KAFKA_BOOTSTRAP','localhost:9092').split(',')[0]
parts=bs.split(':')
host=parts[0]
port=int(parts[1]) if len(parts)>1 and parts[1] else 9092
s=socket.socket(socket.AF_INET,socket.SOCK_STREAM)
s.settimeout(3.0)
try:
    s.connect((host,port))
    print('TCP connect: SUCCESS')
except Exception as e:
    print('TCP connect: FAILED -', e)
finally:
    s.close()
PY


echo "\n-- SSL/SASL indicators --"
SSLEnvVars=(KAFKA_SSL KAFKA_SSL_TRUSTSTORE_LOCATION KAFKA_SSL_TRUSTSTORE_PASSWORD KAFKA_SASL_MECHANISM KAFKA_SASL_USERNAME KAFKA_SASL_PASSWORD KAFKA_SECURITY_PROTOCOL)
found_any=false
for v in "${SSLEnvVars[@]}"; do
  if [ -n "${!v-}" ]; then
    echo "$v is set"
    found_any=true
  fi
done
if [ "$found_any" = false ]; then
  echo "No SSL/SASL environment variables detected."
fi

echo "\n-- Search config/ for ssl/sasl keywords --"
if [ -d config ]; then
  grep -R --line-number -E "ssl|sasl|security.protocol|sasl.mechanism" config || echo "No matches in config/"
else
  echo "No config/ directory present"
fi

# If kafka-topics CLI is available, try a bounded list (timeout 30s)
if command -v kafka-topics.sh >/dev/null 2>&1 || command -v kafka-topics >/dev/null 2>&1; then
  echo "\n-- Attempting kafka-topics --list (bounded to 30s) --"
  echo "Running: timeout 30s kafka-topics.sh --bootstrap-server \"$BOOTSTRAP\" --list"
  # prefer kafka-topics.sh if present
  if command -v kafka-topics.sh >/dev/null 2>&1; then
    timeout 30s kafka-topics.sh --bootstrap-server "$BOOTSTRAP" --list || echo "kafka-topics.sh: failed or timed out"
  else
    timeout 30s kafka-topics --bootstrap-server "$BOOTSTRAP" --list || echo "kafka-topics: failed or timed out"
  fi
else
  echo "Kafka CLI not available; skipping kafka-topics invocation."
fi

echo "\nDiagnostic complete."
