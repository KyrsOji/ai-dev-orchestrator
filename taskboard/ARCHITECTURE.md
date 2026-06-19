Taskboard Aggregation Service — Architecture

Goal
----
Provide a lightweight read-only aggregation service that consumes existing Kafka topics
and exposes a simple HTTP API for the Taskboard widget to render live orchestrator
tasks. No persistence is used; the aggregator holds an in-memory read model.

Topics consumed
---------------
- ai.dev.approval.required
- ai.dev.review.out
- ai.dev.task.ofbiz
- ai.dev.result.out

Design
------
- A background Python component (task_aggregator.py) consumes the listed Kafka topics
  and merges incoming messages into an in-memory dict keyed by taskId.
- A small HTTP API (task_api.py) exposes two endpoints:
  - GET /tasks  -> list of aggregated tasks
  - GET /task/{taskId} -> detailed view for a single task
- The existing widget server (taskboard-widget-mvp/server.js) will attempt to proxy
  /api/tasks to the local aggregator (http://127.0.0.1:8000/tasks). If the aggregator
  is not available, the server falls back to the original /tmp persistence.

Aggregation rules (high level)
-----------------------------
- ai.dev.approval.required: marks a task as requiring approval; populate
  openhandsResponse, reviewerSummary and proposedAction when present.
- ai.dev.review.out: reviewer/bridge decisions; update status and latestReviewerDecision.
- ai.dev.task.ofbiz: authoritative orchestrator state snapshots (status, title, action).
- ai.dev.result.out: execution results; set completed/failed accordingly.

Read model
----------
The API returns records matching this shape:
{
  "taskId": "...",
  "status": "...",
  "approvalRequired": true|false,
  "openhandsResponse": "...",
  "reviewerSummary": "...",
  "proposedAction": { ... },
  "lastUpdated": "ISO8601"
}

Operational notes
-----------------
- The aggregator attempts to use confluent_kafka if available; otherwise the
  aggregation loop is a no-op and the read model will be empty. This avoids
  introducing system dependencies into the repo while allowing immediate
  deployment on environments with Kafka access.
- No new Kafka topics are created.
- This service is a read-only view; it does not modify any orchestrator state.

Run (developer)
---------------
1. Install dependencies (if you want the Kafka consumer):
   pip install confluent-kafka flask
2. Start aggregator+API:
   python3 task_api.py
   (default: listens on 127.0.0.1:8000)
3. Start the widget server (in taskboard-widget-mvp):
   npm run build && npm start
4. Add widget iframe in Element pointing at http://<host>:3000

