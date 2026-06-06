# OFBiz Runner Dry Run Report

consumed_task: true
taskId: routing-smoke-task-ofbiz-c4643c32
runDirectory: /home/kojiyah/openhands-runs/routing-smoke-task-ofbiz-c4643c32

result_message:
```
{
  "resultId": "0dd066a4-2d74-4e88-87b5-3be37f6521f5",
  "taskId": "routing-smoke-task-ofbiz-c4643c32",
  "objectiveId": "routing-smoke",
  "targetSystem": "ofbiz",
  "status": "dry_run_completed",
  "summary": "Task consumed and run directory prepared.",
  "runDirectory": "/home/kojiyah/openhands-runs/routing-smoke-task-ofbiz-c4643c32",
  "createdAt": "2026-06-06T16:58:06.682834Z"
}
```

## Validation Summary

- Kafka mTLS connectivity: succeeded
- ACL authorization: succeeded. Actual Kafka principal is: `User:ai-dev-runner-ofbiz` (NOT `User:CN=ai-dev-runner-ofbiz`)
- Truststore: original contained 0 entries; fixed truststore contains: `yahlife-root-ca`
- Runner fixes applied: `runner/task_consumer.py` was verified to use `cmd.extend(["--from-beginning", "--group", "ai-dev-runner-ofbiz-group"])` when consuming from beginning.

Validation completed: Kafka mTLS connectivity, ACL authorization, Task consumption, Run directory creation, Result publication.

