MATRIX Kafka Integration Report

This report documents the changes made to let the Matrix approval bridge use Kafka transport.

What was added
- matrix_bridge/kafka_client.py: CLI-first Kafka client with kafka-python fallback; honors KAFKA_BOOTSTRAP and KAFKA_CLIENT_CONFIG.
- matrix_bridge/bridge.py: now consumes ai.dev.approval.request and publishes ai.dev.approval.response using KafkaClient when run with --consume-topic. Matrix remains mocked.
- scripts/matrix-kafka-smoke.sh: smoke test publishing approval requests and checking for expected approval responses.
- reports/MATRIX_KAFKA_INTEGRATION_REPORT.md (this file)

Design notes
- The matrix bridge mirrors reviewer patterns for Kafka: CLI-first, optional kafka-python fallback, and environment variables KAFKA_BOOTSTRAP and KAFKA_CLIENT_CONFIG are supported.
- Dry-run mode preserves mocked Matrix behavior; Kafka publish in dry-run prints [KAFKA-PUBLISH] lines instead of sending messages.
- The consumer still operates when run in dry-run mode (to allow end-to-end smoke tests without enabling Matrix network connectivity).

How to run
- Consume one approval request and process it in dry-run:
  python3 -m matrix_bridge.bridge --consume-topic ai.dev.approval.request --dry-run

Notes and constraints
- This change does not connect to real Matrix yet; Matrix posting is still mocked and printed to stdout.
- Kafka ACLs were not changed.
- The smoke test requires either Kafka CLI tools installed or the kafka-python package available, and a reachable Kafka broker.
