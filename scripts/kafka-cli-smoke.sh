#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

# Source runtime env if present (redacted values are fine)
if [ -f /home/kojiyah/dev/ai-dev-orchestrator/config/kafka-client-runtime.env ]; then
  # shellcheck disable=SC1090
  . /home/kojiyah/dev/ai-dev-orchestrator/config/kafka-client-runtime.env
fi

export KAFKA_BOOTSTRAP="${KAFKA_BOOTSTRAP:-kafka.yahlife.com:9095}"
export KAFKA_CLIENT_CONFIG="/home/kojiyah/dev/ai-dev-orchestrator/config/kafka-client.properties"

TMP_TOPICS_FILE="$(mktemp /tmp/ai_dev_smoke_topics.XXXXXX.yaml)"
trap 'rm -f "$TMP_TOPICS_FILE"' EXIT

cat > "$TMP_TOPICS_FILE" <<EOF
name: ai.dev.smoke.test
EOF

echo "Creating topic ai.dev.smoke.test (bounded 30s)"
# Try to create via helper (will use CLI if available)
if ! timeout 30s /home/kojiyah/dev/ai-dev-orchestrator/scripts/create-topics.sh "$TMP_TOPICS_FILE"; then
  echo "Topic creation via create-topics.sh failed or CLI missing; will attempt to produce (may auto-create topic)" >&2
fi

echo "Producing one test message (bounded 30s)"
if ! timeout 30s /home/kojiyah/dev/ai-dev-orchestrator/scripts/smoke-publish-objective.sh "ai.dev.smoke.test" '{"smoke":"test"}'; then
  echo "Produce failed or timed out" >&2
  exit 2
fi

echo "Consuming one message (bounded 30s)"
if ! timeout 30s /home/kojiyah/dev/ai-dev-orchestrator/scripts/smoke-consume-one.sh "ai.dev.smoke.test" 30; then
  echo "Consume failed or timed out" >&2
  exit 3
fi

echo "Smoke test completed"
exit 0
