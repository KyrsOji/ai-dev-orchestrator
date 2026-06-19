Matrix Approval Bridge (mock/dry-run)

Overview

This component provides a bridge between Kafka approval request topics and a Matrix room used for human approvals. The initial implementation in this repository is intentionally mocked/dry-run: it does not perform any network I/O and instead prints Matrix posts and Kafka publishes to stdout for testing.

Design

- Kafka topics:
  - consume: ai.dev.approval.required
  - publish: ai.dev.review.out
- Matrix commands supported (mocked):
  - approve TASK_ID
  - deny TASK_ID
  - status TASK_ID
  - auto-approve POLICY
  - require-approval POLICY

Approval policy (default rules):
- docs-only: auto-approve
- dry-run: auto-approve
- commits: require approval
- pushes: require approval
- sudo: require approval
- systemd changes: require approval
- execute mode: require approval
- secrets/certs: always deny

Files added
- matrix_bridge/ - Python package implementing the mock bridge
  - bridge.py - main implementation and CLI (dry-run)
- config/matrix-approval.yaml.template - configuration template
- systemd/ai-dev-matrix-approval.service.template - systemd unit template
- scripts/matrix-approval-smoke.sh - smoke test that validates common flows
- reports/MATRIX_APPROVAL_BRIDGE_REPORT.md - this document

Usage

- The bridge can be exercised locally in dry-run (mock) mode by running the smoke script:

  bash scripts/matrix-approval-smoke.sh

- When integrating for real deployments, replace the mock implementations with real Matrix and Kafka clients, and update the systemd unit template accordingly.

Security and safety

- This mocked implementation intentionally avoids contacting external services.
- Do NOT enable execute mode when testing approvals until integrations are validated.
