Matrix Approval Bridge — Real Mode Integration Report

Summary
-------
Added a minimal real Matrix client and integrated it into the existing
matrix_bridge package. The bridge can now run in either mock mode (default)
or in real mode when MATRIX_MODE=real and the following environment variables
are configured:

- MATRIX_HOMESERVER_URL (e.g. https://matrix.example.org)
- MATRIX_ACCESS_TOKEN (access token for a Matrix user/device)
- MATRIX_ROOM_ID (room id, e.g. !abcdef:example.org)

Behavior
--------
- The bridge consumes approval requests from Kafka topic: ai.dev.approval.required
- It posts approval requests to the configured Matrix room
- It polls Matrix /sync for room messages and parses simple textual commands:
  - approve TASK_ID
  - deny TASK_ID
  - status TASK_ID
  - auto-approve POLICY
  - require-approval POLICY
- Approval decisions are published to ai.dev.review.out

Security & Safety
-----------------
- Matrix access token is never logged or printed
- Only task IDs, policy names and decision summaries are logged
- If MATRIX_MODE=real but required configuration is missing, the bridge
  refuses to start (fail-closed)

Files Added/Modified
--------------------
- Added: matrix_bridge/matrix_client.py
- Modified: matrix_bridge/bridge.py (choose mock/real, use MatrixClient, poll/sync)
- Added: scripts/matrix-real-smoke.sh (smoke test; falls back to mock)
- Added: systemd/ai-dev-matrix-bridge.service (unit template)
- Added: reports/MATRIX_REAL_BRIDGE_REPORT.md (this file)

Environment variables
---------------------
Required for real mode:
- MATRIX_MODE=real
- MATRIX_HOMESERVER_URL
- MATRIX_ACCESS_TOKEN
- MATRIX_ROOM_ID

Optional:
- KAFKA_BOOTSTRAP (default used by existing Kafka clients)
- KAFKA_CLIENT_CONFIG

Validation commands to run locally
----------------------------------
1. Python compile check:
   python3 -m compileall matrix_bridge

2. Shell lint for scripts:
   bash -n scripts/*.sh

3. Mock smoke run (no Matrix credentials required):
   bash scripts/matrix-real-smoke.sh

4. Real-mode manual smoke (requires credentials and a Matrix user to send a command):
   export MATRIX_MODE=real
   export MATRIX_HOMESERVER_URL=https://your.homeserver
   export MATRIX_ACCESS_TOKEN=<TOKEN>    # keep secret
   export MATRIX_ROOM_ID=!roomid:example.org
   export KAFKA_BOOTSTRAP=localhost:9092
   bash scripts/matrix-real-smoke.sh

Next steps for live deployment
-----------------------------
1. Place credentials in a secure EnvironmentFile, for example /etc/ai-dev-orchestrator/matrix.env:
   MATRIX_MODE=real
   MATRIX_HOMESERVER_URL=https://matrix.example.org
   MATRIX_ACCESS_TOKEN=<TOKEN>   # keep file readable only by service user
   MATRIX_ROOM_ID=!abc:example.org

2. Create a systemd service drop-in to point to that EnvironmentFile:
   # Example
   EnvironmentFile=/etc/ai-dev-orchestrator/matrix.env

3. Enable and start the service:
   sudo cp systemd/ai-dev-matrix-bridge.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now ai-dev-matrix-bridge.service

Risks & Remaining gaps
----------------------
- The Matrix client implemented here is intentionally minimal for portability.
  For production reliability consider using matrix-nio or another well-tested
  Matrix SDK (including handling of backoff, large sync, push rules, CSRF
  nuances and rate limits).
- The smoke test for real mode requires a human or another client to post the
  approval command into the Matrix room (automation of that step requires a
  second user/token and is not implemented here).
- No persistent storage for sync tokens: long-running bridge will work within
  a single process lifetime; restarting the bridge may reprocess a small
  window of messages depending on the server response.

Contact
-------
This change was implemented by an OpenHands agent on behalf of the user.
