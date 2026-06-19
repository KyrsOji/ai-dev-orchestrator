Taskboard Widget MVP

This repository contains a minimal Element widget (React + TypeScript) and a small Express server that persists task state to /tmp/taskboard-mvp.json. The goal is a quick MVP for local testing and Element installation.

Features
- Task list (Pending Review / Approved / Completed)
- Task detail view
- Edit/add proposed actions
- Approve / Deny / Defer actions
- Persists changes to /tmp/taskboard-mvp.json

Quick start
1. Install dependencies:
   cd taskboard-widget-mvp
   npm install

2. Development (Vite):
   npm run dev
   - Open http://localhost:5173 to view the widget in a browser (dev mode).

3. Production-like server:
   npm run build
   npm start
   - The Express server will serve the built widget at http://localhost:3000 and provide the API.

Element installation (test room)
- In Element, open the target room (!TfEGkzunrhJbGlUNBy:stream.yahlife.com) and add a Custom Integration / Widget (iframe) pointing to:
  http://<your-host>:3000
- Configure widget name and permissions. The widget will use the server API to read/write tasks (/api/tasks and /api/task/save).

Notes
- This is an MVP: it uses a local file /tmp/taskboard-mvp.json for persistence. Do not use in production.
- The widget includes basic matrix-widget-api detection and will attempt to send structured Matrix events when the client exposes the widget API. For environments where matrix-widget-api is not available, the widget will fall back to local save behavior.

Matrix integration & testing
- Expected Matrix event type: ai.dev.taskboard.action
- Event content schema:
  {
    "taskId": "...",
    "decision": "approved|denied|deferred|edited|new_action",
    "policy": "commit|push|docs|test|manual",
    "selectedAction": {},
    "editedAction": {},
    "newAction": {},
    "notes": "...",
    "source": "element-widget",
    "createdAt": "ISO8601"
  }

How the widget sends events:
- If matrix-widget-api is present, the widget will call the host client to send an ai.dev.taskboard.action event into the current room. No access tokens are required by the widget; the host (Element) will send the event and sign it with the approver's Matrix identity.
- If matrix-widget-api is not available, the widget will save changes locally to /tmp/taskboard-mvp.json and show a notice: "Matrix widget API unavailable; changes saved locally only."  

Testing:
1. Start the aggregator & widget server as described above.
2. In Element, install the widget iframe for the target room.
3. Open the widget in the room and click Approve/Deny/Defer or Add/Edit action.  
   - If matrix-widget-api is available, you should see a notice "Action sent to Matrix" and the bridge will receive an ai.dev.taskboard.action event (verify via room timeline or bridge logs).
   - If not available, the widget will display "Matrix widget API unavailable; changes saved locally only." and persist to /tmp/taskboard-mvp.json.

Note: The widget will not publish to Kafka directly; the Matrix bridge remains the authoritative path for approvals.

Example task data file: /tmp/taskboard-mvp.json

Security
- Serve the widget over HTTPS when deploying to production and configure CSP and trusted domains.

