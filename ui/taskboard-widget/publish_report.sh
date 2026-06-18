#!/bin/bash
# Helper: publish progress-report.json to Kafka (if kafka-console-producer available).
FILE="$(dirname "$0")/progress-report.json"
TOPIC="ai.dev.approval.required"
BOOTSTRAP="kafka.yahlife.com:9095"
CONF="/opt/ai-dev-runner/certs/kafka-client.properties"

if command -v kafka-console-producer >/dev/null 2>&1; then
  cat "$FILE" | kafka-console-producer --broker-list "$BOOTSTRAP" --topic "$TOPIC" --producer.config "$CONF"
else
  echo "kafka-console-producer not found."
  echo "Please publish $FILE to Kafka topic $TOPIC using your environment."
  echo "Example: cat $FILE | kafka-console-producer --broker-list $BOOTSTRAP --topic $TOPIC --producer.config $CONF"
fi
