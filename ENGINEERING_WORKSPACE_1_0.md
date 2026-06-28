# ENGINEERING WORKSPACE 1.0 — STABILIZATION

This document summarizes the current (v1.0) Taskboard/Engineering Workspace codebase, the Engineering Sessions model, execution lifecycle, testing strategy, known limitations, and recommended stabilization steps before beginning Engineering Workspace 2.0.

Locations referenced below are relative to the repository root.

---

## 1. Architecture overview

High-level components:

- UI: ui/taskboard-widget
  - Canonical UI implementation for the Engineering Workspace is under `ui/taskboard-widget/src/v2/`.
  - Legacy/older components remain under `ui/taskboard-widget/src/components/` (kept for compatibility and incremental migration).
  - Built bundle: `ui/taskboard-widget/dist/` (Vite build output).
  - Lightweight Node test-server: `ui/taskboard-widget/server.js` — provides REST endpoints backed by a file store (/tmp or configured path) and simple decision publish plumbing.

- Runner: runner/ — execution runner and result publishing logic (Kafka and CLI fallbacks).

- Reviewer: reviewer/ — follow-up suggestion generation and publishing helpers.

- Matrix bridge: matrix_bridge/ — integration with Matrix + Kafka for approvals.

- Registry & heartbeat: registry/ — agent discovery and heartbeat publishing.

- Scripts: scripts/ and ui/taskboard-widget/scripts/ — smoke tests, helper utilities, and small CLI integrations.

Data persistence patterns:

- UI persistence for local development is the server.js file-backed store (default `DATA_FILE=/tmp/taskboard-mvp.json`) and ephemeral results files.
- Production-grade persistence (Kafka, real storage) is handled in services outside this repository (runner publishes to configured topics, reviewer publishes to review topics).

---

## 2. Data model (canonical)

Engineering Sessions model (canonical helpers live in):
- `ui/taskboard-widget/src/v2/sessionModel.ts`

Core session shape (typical fields):

{
  sessionId: string,                // genSessionId('sess-')
  title: string,
  createdAt: ISOString,
  updatedAt: ISOString,
  messages: Array<Message>,         // chat-like messages
  reviewDecision: {                 // proposals + selectedActionId
    proposals: Array<ProposedAction>,
    selectedActionId?: string
  },
  selectedActionId?: string,
  approval?: { value: boolean, approver: string, approvedAt?: ISOString } | null,
  dispatch?: any | null,            // dispatch metadata (publisher response)
  executionReport?: any | null,     // runner execution report attached to this session
  artifacts?: Array<any>,
  timeline?: Array<Event>,
  status: string,                   // Conversation | Decision | Approved | Executing | Complete ...
  immutable: boolean                // previous sessions are set immutable
}

Compatibility:
- The codebase preserves some legacy top-level fields on `task` for backward compatibility: `executionReport`, `executionHistory`, `proposedActions` and maps them into sessions via the sessionModel normalizer.

---

## 3. Engineering Sessions (behavior)

- Tasks contain `sessions[]` (newer canonical model) and optionally legacy top-level execution fields.
- Only the active session (latest or `activeSessionId`) is editable; prior sessions are immutable history.
- Follow-up creation creates a new session object and marks prior session immutable.
- Approval and dispatch update the session-level objects (approval/dispatch) and also update legacy compatibility fields to avoid breaking older views.

Key implementation points:
- `ui/taskboard-widget/src/v2/sessionModel.ts` — normalization, session creation helpers, `attachExecutionReportToSession(task, report, sessionId?)`
- `ui/taskboard-widget/src/v2/ConversationActionCard.tsx` — Creates follow-up sessions and handles approve/dispatch flows in the UI.
- `ui/taskboard-widget/server.js` — Accepts posted results from runners and preserves previous executionReport into `executionHistory` before attaching the new report.

---

## 4. Execution lifecycle (canonical mapping)

Canonical stages (derived by lifecycle helpers in `src/v2/lifecycle.ts` and UI ribbon):

Conversation → Review → Approved → Publishing → Runner Started → Executing → Evidence → Complete

Each stage includes:
- timestamp(s)
- duration (computed by UI from timestamps)
- status (ok/error/timeout)

Timeline rendering:
- `ui/taskboard-widget/src/v2/ConversationTimeline.tsx` renders session events newest-first; active session expanded and previous sessions shown as read-only history.

---

## 5. Dispatch flow (high level)

- UI action (Dispatch) posts to server endpoint: `/taskboard/api/task/decision` with normalized payload.
- Server `server.js` attempts to publish via configured publisher; fallback behavior exists (CLI python wrapper) and may return non-200 when environment not configured.
- Successful dispatch triggers polling for execution results (the UI may poll `/taskboard/api/results/<taskId>` or similar endpoints depending on runner integration).

Notes:
- Dispatch currently uses `source: 'taskboard-standalone'` in the payload (see commits). In dev environments, publisher often rejects (403/502) when Kafka or credentials not configured — this is expected.

---

## 6. Runner flow & execution attachment

Runner responsibilities (runner/):
- Consume tasks (Kafka or CLI), execute, and publish results to results topic or the configured results store.
- Results must include metadata (id/runDirectory/startedAt/completedAt/returnCode/stdout/stderr) for UI to attach to sessions.

Attachment logic:
- UI-side attach helper: `attachExecutionReportToSession(task, report, sessionId?)` in `src/v2/sessionModel.ts`.
  - If `sessionId` specified, attaches into that session (makes session immutable when appropriate).
  - If no `sessionId` provided and the active session exists, the function prefers attaching to the active session or creates a new immutable historical session when replacing an already-attached executionReport.

- Server-side: `ui/taskboard-widget/server.js` contains logic to preserve prior `executionReport` by pushing it into `executionHistory` before attaching a new report. Unit tests exercise these behaviors (`ui/taskboard-widget/test_attach_execution_report.js`).

---

## 7. Test inventory & strategy

Discovered tests:

- JS tests (UI):
  - `ui/taskboard-widget/test_attach_execution_report.js` — unit-style verification for attaching execution reports (starts a temporary server instance). 
  - `ui/taskboard-widget/test_followups.js` — follow-up suggestion tests.
  - `ui/taskboard-widget/test_render_safe.js` — render-safe guard tests for UI rendering.
  - `ui/taskboard-widget/test_review_heading_dup.js` — Playwright-style check for duplicate headings.

- Playwright scripts / smoke tests (ui/taskboard-widget/scripts):
  - smoke_followup_session_lifecycle.js
  - smoke_approve_dispatch_playwright.js
  - smoke_v3_ux_001.js
  - smoke_timeline_order.js
  - etc. (see `ui/taskboard-widget/scripts/`)

- Python (server/runner/reviewer) unit and integration tests:
  - `matrix_bridge/tests/*`
  - `runner/tests/*`
  - `reviewer/tests/*`
  - `scripts/tests/*`

Test strategy recommendations:
- Keep unit tests that validate small helpers (sessionModel, runner result publisher, review generator).
- Keep integration tests that run server endpoints with filesystem-backed stores (server.js smoke harnesses).
- Preserve Playwright smoke scripts as E2E checks, but consolidate duplicates (see `test_review_heading_dup.js` vs smoke_v3_ux_001.js) and add CI gating.
- Add an explicit Playwright test matrix for Desktop/Tablet/Mobile in CI once Playwright is added as a devDependency on CI images.

---

## 8. Duplicate implementations and canonical sources

Findings:

- Canonical/current implementation for new Engineering Sessions features is under:
  - `ui/taskboard-widget/src/v2/` (ConversationTimeline, ConversationActionCard, sessionModel, ExecutionMonitor, ExecutionDetailsDrawer, lifecycle helpers).

- Legacy / older implementations exist under:
  - `ui/taskboard-widget/src/components/` (older ConversationTimeline, ConversationActionCard) — these appear to be pre-v2 UI and are largely duplicated functionality.

Recommendation:
- Treat `src/v2/` as canonical. The `src/components/` tree is legacy and should be archived or gradually migrated away from. Keep for compatibility until v1.0 stabilization is complete; do not delete automatically.

---

## 9. Temporary and helper scripts (audit)

Detected temporary/debug files in repo (candidates for cleanup):

- `ui/taskboard-widget/tmp_analyze_review_dups.js`
- `ui/taskboard-widget/tmp_verify_sessions_branch.js`

Detected Playwright or smoke helper scripts that are intended to remain in `ui/taskboard-widget/scripts/`:
- `smoke_followup_session_lifecycle.js`, `smoke_approve_dispatch_playwright.js`, `smoke_v3_ux_001.js`, `smoke_*` family.

Recommendation:
- Delete or archive `tmp_*` files after manual review — they appear to be ad-hoc verification scripts.
- Keep the `scripts/smoke_*` Playwright files but consolidate/standardize their naming and entrypoint. Consider moving smoke scripts into `ui/taskboard-widget/e2e/` and committing Playwright config when enabling CI.

---

## 10. Technical debt report (by category)

Architecture
- Mixed implementations: v2 folder and legacy `src/components` contain overlapping components. This duplicates maintenance effort and risks inconsistent behavior.
- No centralized runner orchestration spec in repo — runner contract exists but is implicit (result JSON shape).

Frontend
- Some UI duplication (v2 vs legacy) and untested visual paths. PWA/service worker present but needs safe-update semantics.
- Responsive layouts / mobile behavior are implemented but need QA across device sizes.

Backend
- server.js is a development file-backed server. It is useful but not production-grade (no auth, file storage, race conditions possible).
- Dispatch publishing uses multi-mode (CLI python fallback) which is pragmatic but fragile.

Testing
- Good unit and smoke coverage for critical flows, but Playwright is present as scripts not integrated into CI.
- Some tests duplicate coverage (render-safe vs other UI tests). Consolidation and clearer classification (unit/integration/e2e/smoke) will help.

Documentation
- AGENTS.md contains useful notes, but a formal `ENGINEERING_WORKSPACE_1_0.md` (this file) was missing — now created.

Deployment
- No formal CI publishing artifacts for UI bundles. Vite build artifacts are stored locally; recommend adding release pipeline.

Security
- Several endpoints accept unauthenticated requests in dev mode (server.js). Dispatch endpoints should require tokens in production. Token plumbing exists but should be enforced.

Performance
- Large JS bundle (~434 KB gzipped ~117 KB) — reasonable for SPA but further code-splitting could help.

Accessibility
- Many ARIA/hidden improvements implemented; audit keyboard navigation and focus management for side-drawers.

---

## 11. Recommended cleanup commits (non-breaking, low risk)

- Move or delete `ui/taskboard-widget/tmp_*` files after review (cleanup commit).
- Add a README in `ui/taskboard-widget/e2e/` that lists Playwright smoke scripts and how to run them locally (no changes to app code).
- Add an explicit test categorization document (`TESTS.md`) mapping files to unit/integration/e2e/smoke.
- Add a linter/CI job to fail when new duplicate components are added to `src/components` vs `src/v2` without explanation.

---

## 12. Recommended roadmap (stabilization, pre-v2.0)

Phase A — Stabilize v1.0 (no redesign):
1. Consolidate tests & CI
   - Add Playwright as a devDependency in CI images, run the key smoke scripts on every PR (followup lifecycle, approve/dispatch, render-safe).
   - Classify tests and clean duplicates.
2. Document runner result contract and attach behavior (results schema) and ensure unit tests assert contract.
3. Harden server.js for dev: add optional token enforcement for dispatch endpoints (configurable via env) and improve file locking for DATA_FILE.
4. Remove/Archive tmp_* scripts and add an e2e README describing smoke tests and how to run them locally.

Phase B — Clean technical debt (low-risk):
1. Gradually deprecate `src/components` by introducing a compatibility shim that maps its props to v2; small PRs to move tests to v2 components.
2. Add explicit test coverage for `sessionModel` helpers (already present but can be extended).
3. Add a CI job to build `ui/taskboard-widget` and archive artifact per commit.

Phase C — Prepare for Workspace 2.0
1. Formalize Execution Monitor streaming API (SSE/WebSocket) as a documented contract.
2. Design Execution Timeline & Operations Panel improvements as incremental UI feature branches (keep `v2` components canonical).

---

## 13. Commands used in this audit (useful for reviewers)

- Branch/merge discovery:
  - `git branch --show-current`
  - `git for-each-ref --format='%(refname:short) %(committerdate:relative) %(objectname:short)' refs/heads/`
  - `git merge-base feature/engineering-sessions-model taskboard-session-chain`
  - `git log taskboard-session-chain..feature/engineering-sessions-model --oneline`
  - `git diff --name-only taskboard-session-chain..feature/engineering-sessions-model`

- Search for canonical components and session helpers:
  - `grep -RIn --exclude-dir=node_modules --exclude-dir=dist -e "sessionModel" -e "ConversationActionCard" -e "ConversationTimeline" ui/taskboard-widget`

- Tests & smoke scripts invoked:
  - `npm run build` (ui/taskboard-widget)
  - `npm run test:followups` (ui/taskboard-widget)
  - `npm run test:render-safe` (ui/taskboard-widget)

---

## 14. Quick summary (answers to your checklist)

- Current branch: `taskboard-session-chain` (HEAD).
- feature/engineering-sessions-model: fully merged into taskboard-session-chain (verified: feature tip is ancestor of taskboard-session-chain; commit history shows an explicit merge commit).
- Canonical implementations: `ui/taskboard-widget/src/v2/` is canonical for Engineering Sessions, ExecutionMonitor, sessionModel, lifecycle. Legacy implementations exist in `ui/taskboard-widget/src/components/` and should be migrated/archived.
- Test inventory: unit tests in `runner/tests`, `reviewer/tests`, `matrix_bridge/tests`; UI JS tests in `ui/taskboard-widget/test_*.js`; Playwright smoke scripts in `ui/taskboard-widget/scripts/`.
- Temporary files: `ui/taskboard-widget/tmp_analyze_review_dups.js`, `ui/taskboard-widget/tmp_verify_sessions_branch.js` — recommend manual review and deletion.

---

End of ENGINEERING_WORKSPACE_1_0.md
