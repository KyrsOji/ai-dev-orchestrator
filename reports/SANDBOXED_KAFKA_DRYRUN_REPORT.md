SANDBOXED KAFKA DRY-RUN VALIDATION

Purpose
- Verify the sandboxed systemd runner (ai-dev-runner-ofbiz-sandboxed.service) consumes a Kafka task in dry-run mode and produces run artifacts under the host-writable run base directory.

What the smoke script does
- scripts/sandboxed-kafka-dryrun-smoke.sh validates:
  - The systemd unit is running (systemctl is-active)
  - The unit enforces RUNNER_MODE=dry-run and OPENHANDS_MODE=dry-run
  - The unit exposes a RUNNER_BASE_DIR (defaults to /var/lib/ai-dev-runner/openhands-runs)
  - The run directory /var/lib/ai-dev-runner/openhands-runs/$TASK_ID exists
  - task.json and task.md exist inside the run directory
  - runner-report.json is reported if present
  - No files were written under /home/kojiyah/openhands-runs (ensures we are using FHS paths, not home)

How to run this test
1) Publish a test task to the Kafka topic the runner subscribes to. Example (replace with your cluster and credentials):

   # Example: publish a single JSON task with kafka-console-producer
   cat <<'JSON' | kafka-console-producer.sh --bootstrap-server kafka.example.com:9092 --topic ai.dev.task.ofbiz
{"taskId": "test-task-123", "title": "Smoke test task", "description": "Smoke test"}
JSON

   Wait a few seconds for the runner to consume the message. The runner is configured in the unit to use RUNNER_MODE=dry-run by default; it will prepare a run directory and not execute any destructive actions.

2) Run the smoke script (replace TASK_ID with the taskId you published):

   TASK_ID=test-task-123 bash scripts/sandboxed-kafka-dryrun-smoke.sh

Interpreting results
- PASS: all required artifacts are present in /var/lib/ai-dev-runner/openhands-runs/$TASK_ID and no files were written to /home/kojiyah/openhands-runs.
- FAIL: one or more checks failed; the script prints diagnostic messages.

Notes
- This test assumes the systemd unit at /etc/systemd/system/ai-dev-runner-ofbiz-sandboxed.service is the one in this repository and that it sets RUNNER_BASE_DIR and RUNNER_LOG_DIR to the host-writable FHS locations.
- Do NOT switch RUNNER_MODE to 'execute' during this test. Keep both RUNNER_MODE and OPENHANDS_MODE as 'dry-run' to avoid executing tasks for real.
- The smoke script does not modify any data; it only inspects the filesystem and the unit.