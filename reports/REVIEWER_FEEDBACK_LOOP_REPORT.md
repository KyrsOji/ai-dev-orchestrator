AI Dev Reviewer Feedback Loop

Overview

This reviewer service implements a deterministic, rule-based feedback loop that inspects runner results and decides next actions. It is intentionally dry-run and does not call external APIs.

Goals

- Classify runner results into one of: completed, failed, needs_more_info, unsafe, ready_to_commit, ready_to_push, requires_human_approval
- Enforce safety rules:
  - never auto-run sudo
  - never auto-push to master
  - never enable execute mode
  - never modify systemd without approval
  - never touch secrets/certs
  - commits require approval
  - deploy/restart requires approval

Behavior

- For safety-sensitive classifications (unsafe, requires_human_approval) the reviewer publishes an approval request to topic: ai.dev.approval.request
- For safe auto-approve cases (docs-only or dry-run-mode) the reviewer publishes an OFBiz follow-up task to topic: ai.dev.task.ofbiz to perform the commit/push action
- For completed or failed results the reviewer may not publish additional tasks; it will return the classification for visibility.

Files added

- reviewer/service.py -- deterministic reviewer CLI and logic
- scripts/reviewer-smoke.sh -- local smoke test that validates classification and publishing behaviour
- systemd/ai-dev-reviewer.service.template -- example systemd unit template for a future real deployment (dry-run by default)
- reports/REVIEWER_FEEDBACK_LOOP_REPORT.md -- this document

How to test

- python3 -m compileall reviewer runner
- bash -n scripts/*.sh
- bash scripts/reviewer-smoke.sh

Notes

- This implementation is intentionally simple and deterministic. When ready to integrate with production systems, replace the KafkaMock with a real Kafka client, add authentication for any external services, and add unit tests for the classification rules.
