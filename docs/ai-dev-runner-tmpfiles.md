# AI Dev Runner tmpfiles.d permissions (ops note)

Purpose

This document records the tmpfiles.d configuration and validation steps used to make the runner dedupe SQLite database (/var/lib/ai-dev-runner/processed_tasks.db) writable by the sandboxed runner service across reboots and deployments.

Important

- Do NOT apply these files to /etc from this repository automatically. Use the commands shown on the target host as root/with sudo.
- Do not modify runner code, systemd units, reviewer, taskboard UI, Kafka topics, OFBiz, Matrix bridge, or execution mode.

tmpfiles configuration (file to create on host)

File path (on host): /etc/tmpfiles.d/ai-dev-runner.conf

Contents:

```
d /var/lib/ai-dev-runner 2770 root openhands-runner -
d /var/lib/ai-dev-runner/openhands-runs 2750 openhands-runner openhands-runner -
```

Explanation:
- The first line ensures /var/lib/ai-dev-runner exists with owner root and group openhands-runner, mode 2770 (setgid + group write). This lets the runner (user `openhands-runner`) create SQLite locking/WAL files in the directory.
- The second line ensures the run directories folder exists owned by the runner user and group with mode 2750.

Commands to apply on host

Run as root or with sudo on the target machine:

```
# create the tmpfiles config
sudo tee /etc/tmpfiles.d/ai-dev-runner.conf > /dev/null <<'EOF'
d /var/lib/ai-dev-runner 2770 root openhands-runner -
d /var/lib/ai-dev-runner/openhands-runs 2750 openhands-runner openhands-runner -
EOF

# apply the tmpfiles rules immediately
sudo systemd-tmpfiles --create /etc/tmpfiles.d/ai-dev-runner.conf

# verify permissions
sudo ls -ld /var/lib/ai-dev-runner
sudo ls -ld /var/lib/ai-dev-runner/openhands-runs
```

Validation (DB write smoke test)

Run the following as the service user (openhands-runner) on the host to confirm SQLite can write:

```
sudo -u openhands-runner python3 - <<'PY'
import sqlite3,sys
p='/var/lib/ai-dev-runner/processed_tasks.db'
conn=sqlite3.connect(p)
conn.execute("create table if not exists permission_smoke(id text primary key)")
conn.execute("insert or replace into permission_smoke values('ok')")
conn.commit()
conn.close()
print('DB_WRITE_OK')
PY
```

Expected output: DB_WRITE_OK

Test task used for verification

We validated this patch using a dry-run test task published through the taskboard API.

- Task ID: PWA-TMPFILES-SMOKE-001

Evidence (excerpts)

Reviewer received and handled the published decision:

```
Jun 17 22:19:19  INFO Parsed Kafka message topic=ai.dev.review.out taskId=PWA-TMPFILES-SMOKE-001
Jun 17 22:19:21  INFO Handled review response for task PWA-TMPFILES-SMOKE-001: {'taskId': 'PWA-TMPFILES-SMOKE-001', 'published': True, 'action': 'manual'}
```

Runner processed the task without SQLite readonly errors and recorded completion:

```
Jun 17 22:19:37  INFO Parsed Kafka message topic=ai.dev.task.ofbiz taskId=PWA-TMPFILES-SMOKE-001
Jun 17 22:19:37  INFO Task received: PWA-TMPFILES-SMOKE-001
Jun 17 22:19:37  INFO Run directory created: /var/lib/ai-dev-runner/openhands-runs/PWA-TMPFILES-SMOKE-001
Jun 17 22:19:39  INFO Result published successfully for task PWA-TMPFILES-SMOKE-001
Jun 17 22:19:39  INFO Recorded completed task: PWA-TMPFILES-SMOKE-001
```

Result endpoint returned found:true:

```
GET /taskboard/api/results/PWA-TMPFILES-SMOKE-001
{
  "taskId": "PWA-TMPFILES-SMOKE-001",
  "found": true,
  "runDirectory": "/var/lib/ai-dev-runner/openhands-runs/PWA-TMPFILES-SMOKE-001",
  "status": "prepared",
  "summary": "Runner prepared task artifacts.",
  "updatedAt": "2026-06-17T22:19:37.051Z"
}
```

Notes and recommendations

- The root cause was that SQLite needs to create lock/WAL files in the parent directory. If the parent directory does not allow the service user to create these files (group write), SQLite raises "attempt to write a readonly database".
- The tmpfiles.d entry ensures the directory has the correct owner/group and permissions at boot and after deployment scripts that might recreate the directory.
- If your provisioning recreates /var/lib/ai-dev-runner after tmpfiles runs (rare), ensure your provisioning applies correct ownership/permissions or keep this tmpfiles.d under your configuration management so it is applied before the service starts.
- If your storage is NFS or has root_squash, tmpfiles cannot fix mount-level write restrictions  ensure underlying storage supports Unix permission semantics.
- Consider adding a boot-time check in your deployment pipeline that verifies /var/lib/ai-dev-runner has the correct ownership and mode (2770 root:openhands-runner).

Ops checklist (summary)

1. Add /etc/tmpfiles.d/ai-dev-runner.conf with contents above.
2. Run: sudo systemd-tmpfiles --create /etc/tmpfiles.d/ai-dev-runner.conf
3. Verify directory perms and run the DB write smoke test as openhands-runner.
4. Restart runner service if already running: sudo systemctl restart ai-dev-runner-ofbiz-sandboxed.service
5. Submit a small dry-run task and confirm via logs and GET /taskboard/api/results/<taskId>.

References

- This repo keeps systemd unit templates under systemd/. The tmpfiles.d entry is an ops artifact and should be applied on the host.


(End of document)
