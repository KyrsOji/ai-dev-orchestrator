# AGENTS - Engineering Workspace (taskboard-v2) notes

Date: 2026-06-27

Summary:
- Verified Taskboard V2 UI already contained the requested UX/product upgrades for ENG-WORKSPACE-V3-UX-001:
  1. Live Execution Monitor (src/v2/ExecutionMonitor.tsx) is implemented and rendered in the selected task detail pane (ConversationTimeline).
  2. PWA support exists (public/manifest.webmanifest, public/sw.js, public/offline.html) and service worker is registered safely (src/main.tsx registers /taskboard-v2/sw.js).
  3. Collapsible side panels implemented in TaskboardV2 (left/right panels with localStorage persistence and mobile-default collapse behavior).

Actions performed:
- Built the UI bundle: `npm run build` (ui/taskboard-widget)
- Ran followup and render-safety tests: `npm run test:followups` and `npm run test:render-safe` (all passed)
- Executed Playwright smoke against https://obiz.yahlife.com/taskboard-v2/?v=v3-ux-001 and saved screenshot to /tmp/playwright_v3_ux_001.png

Key files verified/added:
- src/v2/ExecutionMonitor.tsx (live monitor implementation)
- src/v2/ExecutionDetailsDrawer.tsx (execution detail drawer)
- src/main.tsx (service worker registration)
- public/manifest.webmanifest (PWA metadata)
- public/sw.js (service worker)
- public/offline.html (offline fallback)
- public/assets/icons/icon.svg (icon used by manifest)

Build / Test results summary:
- Build: success. Dist files created under ui/taskboard-widget/dist/. Main JS bundle: dist/assets/index-Ceg1HMPI.js
- test:followups: ALL TESTS PASSED
- test:render-safe: ALL RENDER-SAFE TESTS PASSED
- Playwright smoke: pageStatus 200, execMonitorPresent true, manifest reachable, screenshot saved /tmp/playwright_v3_ux_001.png

Notes / Recommendations:
- No backend changes were necessary; frontend already consumed executionReport fields. Ensure backend taskboard API continues to supply executionReport fields for monitor to populate.
- Consider adding a dedicated small icon PNG sizes to public/assets/icons to improve install UX on some platforms.
- Consider exposing a "view full logs" link in ExecutionMonitor that opens the runDirectory in a new tab (if served) for easier troubleshooting.

Recorded-by: OpenHands agent (on behalf of user)


Date: 2026-06-27 (update)

Summary:
- Implemented UX/accessibility improvements to TaskboardV2:
  - clearer collapsed visuals for left/right panels (background and border when collapsed)
  - improved toggle aria-labels and titles to be more descriptive
  - added hidden attribute on panel content to avoid aria-hidden hiding focusable children incorrectly

- Verified ExecutionMonitor (src/v2/ExecutionMonitor.tsx) already provides production-useful fields:
  - task-specific phase, last runner update, elapsed duration, stdout/stderr preview, polling timeout state
  - "Open execution details" integrates with ExecutionDetailsDrawer
  - runDirectory links are only exposed as web links; filesystem paths are shown shortened and copyable (no unsafe file:// links)

- PWA icons: public/assets/icons/icon-192.png and icon-512.png already present; manifest references them.

Actions performed:
- Built UI: `npm run build` (ui/taskboard-widget) - success
- Ran tests: `npm run test:followups` and `npm run test:render-safe` - all passed
- Ran Playwright smoke (scripts/smoke_v3_ux_001.js) against https://obiz.yahlife.com/taskboard-v2/?v=v3-ux-001 - smoke passed; screenshot saved to /tmp/playwright_v3_ux_001.png

Files changed:
- ui/taskboard-widget/src/TaskboardV2.tsx (collapse UX + accessibility polish)

Commit:
- Branch: taskboard-session-chain
- Commit: 1a68cf1e2d8872a91d5586433eaa04518ffd6cff (pushed)

Notes / Next steps (runner investigation):
- BUG-RUNNER-NOT-CONSUMING-NEW-TASK-001 is open. Recommended next steps (recorded here):
  - Run the exact kafka-console-consumer CLI used by the runner with --consumer.config against ai.dev.task.ofbiz to reproduce the TimeoutException
  - Inspect systemd unit/environment for KAFKA_FORCE_CLI, KAFKA_BOOTSTRAP, and TLS consumer args
  - Check runner run directories for any artifacts for task PWA-20260627-202805
  - Collect journal logs around TimeoutException and validate connectivity to kafka.yahlife.com:9095

Recorded-by: OpenHands agent (on behalf of user)



Date: 2026-06-27 (v3-ux patch)

Summary:
- Polished ExecutionMonitor UI (phase, runner last update, elapsed duration, stdout/stderr preview, sanitized runDirectory display, polling timeout state, openExecutionDetails hook).
- Improved panel toggles: clearer labels/tooltips, visual collapsed state; defaults remain collapsed on mobile.

Actions performed:
- Built UI: `npm run build` (ui/taskboard-widget) - success
- Ran tests: `npm run test:followups` and `npm run test:render-safe` - all passed
- Ran Playwright smoke: scripts/smoke_v3_ux_001.js - smoke passed; screenshot: /tmp/playwright_v3_ux_001.png

Files changed:
- ui/taskboard-widget/src/TaskboardV2.tsx
- ui/taskboard-widget/src/v2/ExecutionMonitor.tsx

Commit:
- Branch: taskboard-session-chain
- Commit: 25fccbed184aa1c8118522853f93700c590207a3 (pushed to origin)

Recorded-by: OpenHands agent (on behalf of user)


Date: 2026-06-27 (engineering-sessions-model)

Summary:
- Introduced a first-class "Engineering Sessions" / Execution Cycle model for Taskboard V2.
  - Conversation -> sessions[] (ordered oldest->newest) -> each session is an Execution Cycle containing prompt, messages, reviewDecision/proposals, approval, dispatch, executionReport, artifacts, status, immutable flag.
- Follow-up decisions now create a new Execution Cycle instead of mutating completed executions.

Actions performed:
- Added ui/taskboard-widget/src/v2/sessionModel.ts with helpers for normalizing legacy tasks into sessions, creating follow-up sessions, attaching execution reports, and safe helpers for adding messages/decisions to the active session.
- Updated front-end components to use sessions where appropriate:
  - ui/taskboard-widget/src/v2/ConversationPanel.tsx  uses sessionModel helpers when creating messages and review decisions; follow-ups on completed sessions create a new session.
  - ui/taskboard-widget/src/v2/ConversationTimeline.tsx  renders sessions newest-first; active session expanded, previous sessions shown as read-only history.
  - ui/taskboard-widget/src/v2/ConversationActionCard.tsx  creates follow-up sessions for completed tasks; appends decisions to active session otherwise.
- Server: ui/taskboard-widget/server.js now prefers attaching incoming execution reports to sessions[] when present, or appends a new immutable session if no target found.
- UI/UX: Composer (Continue Conversation) remains available and writes into the active session.

Files changed (latest):
- ui/taskboard-widget/src/v2/sessionModel.ts (new)
- ui/taskboard-widget/src/v2/ConversationPanel.tsx
- ui/taskboard-widget/src/v2/ConversationTimeline.tsx
- ui/taskboard-widget/src/v2/ConversationActionCard.tsx
- ui/taskboard-widget/src/TaskboardV2.tsx (preserve session merges on save)
- ui/taskboard-widget/server.js (attach reports to sessions)

Build / Test:
- npm run build (ui/taskboard-widget): success  dist/assets/index-CiS5MCJj.js
- npm run test:followups: ALL PASSED
- npm run test:render-safe: ALL PASSED
- Playwright smoke (scripts/smoke_v3_ux_001.js): pageStatus 200, execMonitorPresent true, screenshot /tmp/playwright_v3_ux_001.png

Notes / Next steps:
- This is a non-incremental architectural step; much of the codebase still supports legacy flat fields for compatibility (executionReport, executionHistory, proposedActions). The sessionModel normalizer maps legacy fields to sessions and preserves compatibility.
- Recommended follow-ups:
  - Comprehensive refactor to consume sessions across all components (ExecutionMonitor, ConversationMessage, ArtifactsWorkspace, ActionCard)  aim to remove legacy top-level executionReport usage gradually.
  - Add automated migration tooling to convert persisted tasks to the sessions model where appropriate; include a one-time migration script in server utilities.
  - Add unit/integration tests specifically for session lifecycle (follow-up creation -> dispatch -> execution -> new cycle created and attached).

Recorded-by: OpenHands agent (on behalf of user)



Date: 2026-06-27 (follow-up lifecycle fix)

Summary:
- Fixed approval persistence bug where approving a follow-up did not persist into the active session.
- Root cause: handleTaskUpdate merged sessions incorrectly, preferring stored existing session objects over incoming updated session objects with the same sessionId. This caused session-level updates (approval/status/selectedActionId) to be silently discarded.

Actions performed:
- Update TaskboardV2.handleTaskUpdate session merge to prefer updated sessions for matching sessionId (new sessions override existing ones).
- Ensure ConversationActionCard Approve path writes session-level approval (approval object, status 'Approved', and reviewDecision.selectedActionId) and also updates legacy top-level compatibility fields.
- Add/extend smoke_followup_session_lifecycle.js to assert approval persistence and previous session immutability.

Files changed:
- ui/taskboard-widget/src/TaskboardV2.tsx
- ui/taskboard-widget/src/v2/ConversationActionCard.tsx
- ui/taskboard-widget/scripts/smoke_followup_session_lifecycle.js

Observed result:
- Approve now persists into the active follow-up session and is reflected in server-stored task object. Previous completed session remains immutable and its executionReport is preserved.

Recorded-by: OpenHands agent (on behalf of user)



Date: 2026-06-28

Summary:
- Merged feature/engineering-sessions-model into taskboard-session-chain (merge commit present). Verified merge and then committed additional wiring to replace LifecycleRibbon with ExecutionTimeline and wire the useExecutionLive hook. Commit: 8305b41.

Actions:
- Replaced LifecycleRibbon with ExecutionTimeline in TaskboardV2 and enhanced ExecutionTimeline to render Conversation -> Review -> Approved -> Publishing -> Runner Started -> Executing -> Evidence -> Complete stages with timestamps and durations.
- Added useExecutionLive hook and updated ExecutionMonitor to consume it for live polling, runner status, and elapsed time.
- Built the UI bundle and ran followup + render-safe smoke tests (all passed).

Files changed:
- ui/taskboard-widget/src/TaskboardV2.tsx
- ui/taskboard-widget/src/v2/ExecutionMonitor.tsx
- ui/taskboard-widget/src/v2/ExecutionTimeline.tsx
- ui/taskboard-widget/src/v2/useExecutionLive.ts
- ENGINEERING_WORKSPACE_1_0.md

Recorded-by: OpenHands agent (on behalf of user)



Date: 2026-06-28 (live stream)

Summary:
- Implemented Server-Sent Events (SSE) stream endpoint for the Taskboard live feed and ensured compatibility with the frontend useTaskboardLive hook.

Actions performed:
- Verified dev-server SSE implemented at /taskboard/api/stream (ui/taskboard-widget/server.js) which polls existing API endpoints and broadcasts events: tasks, task, followups, agents, runner, log, heartbeat (30s).
- Added a compatibility alias route in the Python taskboard API: /taskboard/api/stream -> delegates to existing /stream SSE implementation (taskboard/task_api.py). This ensures backends exposing /stream are reachable at the frontend path /taskboard/api/stream.
- Ensured graceful disconnect cleanup is present (clients removed on generator finally block in Python and stopSsePollerIfIdle in the dev server).

Validation:
- Built frontend: npm run build (ui/taskboard-widget)
- Ran smoke tests: npm run test:followups and npm run test:render-safe (both passed)
- Ran Playwright smoke tests for live features (scripts/test_use_taskboard_live.js) during development; observed SSE message handling and polling fallback behavior.

Notes / Remaining work:
- WebSocket fallback endpoint (/taskboard/api/stream-ws) is not implemented in the Python backend. The client attempts WS fallback only when EventSource is unavailable; the dev server provides an SSE-first implementation and the frontend falls back to polling when SSE errors.
- task_api.py currently emits tasks/task/log/heartbeat. followups/agents/runner events are available via the dev server which polls the taskboard API and broadcasts them. Consider extending the Python SSE poller to include followups/agents/runner events if required in production.

Recorded-by: OpenHands agent (on behalf of user)

