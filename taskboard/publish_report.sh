#!/bin/bash
# Publish integration_report.json to Kafka topic ai.dev.approval.required
BASE_DIR="$(dirname "$0")"
FILE="$BASE_DIR/integration_report.json"
TOPIC="ai.dev.approval.required"
BOOTSTRAP="kafka.yahlife.com:9095"
CONF="/opt/ai-dev-runner/certs/kafka-client.properties"

if command -v kafka-console-producer >/dev/null 2>&1; then
  cat "$FILE" | kafka-console-producer --broker-list "$BOOTSTRAP" --topic "$TOPIC" --producer.config "$CONF"
else
  echo "kafka-console-producer not found. Please run this script on a machine with Kafka tools available."
  echo "Report file: $FILE"
  echo "Example publish command:" 
  echo "cat $FILE | kafka-console-producer --broker-list $BOOTSTRAP --topic $TOPIC --producer.config $CONF"
fi
