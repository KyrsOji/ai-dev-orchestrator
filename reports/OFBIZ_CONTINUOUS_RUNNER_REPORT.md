# OFBiz Continuous Runner (Dry-Run) Report

## Overview

This document describes the continuous OFBiz runner service (dry-run only). The
service consumes tasks from Kafka, prepares run directories for each consumed
task, publishes a dry-run result message, and continues polling indefinitely.

This implementation is intentionally a dry-run prototype and does not invoke
OpenHands or modify OFBiz.

## Architecture

- Runner service (python module: `runner.service`) runs as a long-lived
  process.
- Consumption: `ai.dev.task.ofbiz` topic is consumed one message at a time.
  The service prefers the kafka-console-consumer CLI when `KAFKA_FORCE_CLI=1`.
- Consumer group: `ai-dev-runner-ofbiz-group` (ensures offset tracking).
- Run directories: created under the runner user's home `~/openhands-runs/<taskId>`.
- Result publication: published to `ai.dev.result.out` using the kafka-console-producer CLI (when requested).
- Logging: runtime logs are written to `logs/ofbiz-runner.log` in the repository.

## Startup

Systemd unit: `systemd/ai-dev-runner-ofbiz.service`

Key environment variables (systemd sets these in the unit file):

- `KAFKA_BOOTSTRAP` — Kafka bootstrap server (default: kafka.yahlife.com:9095)
- `KAFKA_CLIENT_CONFIG` — Path to kafka client properties (optional)
- `KAFKA_FORCE_CLI=1` — Prefer console CLI tools for Kafka I/O

Manual start: See `scripts/start-ofbiz-runner.sh`.

The service logs startup and configuration to `logs/ofbiz-runner.log`.

## Shutdown

The service handles `SIGTERM` and `SIGINT` for graceful shutdown. On shutdown it
will log a shutdown message and exit cleanly with status 0. When using the
console-based per-message consumption approach there is no long-lived network
consumer to close; the service simply stops the main loop.

Use `scripts/stop-ofbiz-runner.sh` to stop a manually started instance.

## Recovery

- The service runs inside a systemd unit configured with `Restart=on-failure`
  and `RestartSec=10` to automatically recover transient failures.
- Kafka consumer group `ai-dev-runner-ofbiz-group` ensures offsets are tracked so
  that restart will resume at committed offsets.

## Monitoring

- Logs: `logs/ofbiz-runner.log` (the repository contains `.gitignore` to avoid
  committing runtime logs).
- Healthcheck script: `scripts/healthcheck-ofbiz-runner.sh` verifies process
  presence, Kafka connectivity (via CLI), and the presence of the log file.
- Management scripts: `scripts/status-ofbiz-runner.sh`,
  `scripts/start-ofbiz-runner.sh`, `scripts/stop-ofbiz-runner.sh`,
  `scripts/tail-ofbiz-runner.sh`.

## Troubleshooting

- If tasks are not being consumed:
  - Confirm Kafka CLI tools are installed and `KAFKA_FORCE_CLI=1` (the service
    uses the console consumer for this prototype).
  - Verify `KAFKA_CLIENT_CONFIG` points to a valid keystore/truststore-aware
    properties file, when using mTLS.
  - Check `logs/ofbiz-runner.log` for errors.

- If result publication fails:
  - Confirm `kafka-console-producer.sh` is in PATH and accessible by the
    runner user.
  - Check producer-side CLI logs; the service logs the result publisher metadata
    for diagnosis.

- If you need to inspect run artifacts:
  - Look under `~/openhands-runs/<taskId>` for `task.json`, `task.md`, and
    `runner-report.json`.

## Security notes

- This implementation does not write secrets into the repository.
- Do not commit keystores, truststores, passwords, or runtime logs.

## Next steps

- Implement the OpenHands execution flow (disabled in this dry-run version).
- Replace CLI-based consumption with a long-lived Python consumer (librdkafka)
  for better efficiency and control (optional).

