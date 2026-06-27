REVIEWER Kafka Integration Report

This report documents the changes made to allow the reviewer to use real Kafka transport.

What was added
- reviewer/kafka_client.py: small CLI-first Kafka client with kafka-python fallback. Honors KAFKA_BOOTSTRAP and KAFKA_CLIENT_CONFIG.
- reviewer/service.py: replaced the internal KafkaMock with KafkaClient integration; added --consume-topic support to consume one message from a Kafka topic.
- scripts/reviewer-kafka-smoke.sh: smoke test that publishes sample results to ai.dev.result.out, runs the reviewer to consume them and checks for expected publishes to ai.dev.task.ofbiz and ai.dev.approval.required.
- reports/REVIEWER_KAFKA_INTEGRATION_REPORT.md (this file)

Design notes
- The Kafka client mirrors the existing configuration patterns used by runner (KAFKA_BOOTSTRAP, optional KAFKA_CLIENT_CONFIG, prefer CLI tools).
- Dry-run mode is preserved: when the reviewer is run with --dry-run, the client prints the same `[KAFKA-PUBLISH]` lines the previous mock produced.
- The consumer prefers kafka-console-consumer when available and falls back to kafka-python. Producer behaves similarly.

Environment variables respected
- KAFKA_BOOTSTRAP: bootstrap server(s)
- KAFKA_CLIENT_CONFIG: path to Kafka client config file (used with CLI tools)

Notes / next steps
- This change does not connect Matrix or other external systems yet.
- The smoke script is best-effort and requires either Kafka CLI tools or the kafka-python library and a reachable Kafka broker.
