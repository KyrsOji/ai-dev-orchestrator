Taskboard Widget — TESTS.md

Overview
This file describes how to run the unit/integration/smoke/e2e tests for the Taskboard (Engineering Workspace) widget.

Quick-start (local)
1. cd ui/taskboard-widget
2. npm install    # if dependencies not already installed
3. npm run build
4. npm run test:followups
5. npm run test:render-safe
6. node test_attach_execution_report.js
7. node test_review_heading_dup.js     # Note: this script targets the public demo by default
8. TB_BASE=http://127.0.0.1:3000 node scripts/smoke_v3_ux_001.js --auth-from-server-env
9. TB_BASE=http://127.0.0.1:3000 node scripts/smoke_followup_session_lifecycle.js --auth-from-server-env

Local server usage
- To run Playwright scripts against a local instance, start the built server:
  PORT=3000 node server.js &
- Then set TB_BASE to point at the local server when running Playwright scripts.

Environment variables
- TB_BASE
  - Optional. Overrides the target base URL used by Playwright scripts. Defaults to https://obiz.yahlife.com.
  - Example: TB_BASE=http://127.0.0.1:3000

- TASKBOARD_API_TOKEN
  - When set and used with `--auth-from-server-env`, tests will inject this token into the page/localStorage to enable authenticated dispatch flows.

- KAFKA_PRODUCER_CMD, KAFKA_BOOTSTRAP, KAFKA_CLIENT_CONFIG
  - Required if you intend to execute tests that publish to Kafka (real integration). In local dev, these are often absent and dispatch will return 403/502 which is expected.

- RUNNER_BASE_DIR
  - Used by test_attach_execution_report.js (the test will create temporary run directories by default).

Test classification
- Fixture-only / file-backed (no external infra required)
  - test_followups.js (npm run test:followups)
  - test_attach_execution_report.js
  - test_render_safe.js (npm run test:render-safe)
  - smoke_followup_session_lifecycle.js (when run against local server; script creates fixture tasks)

- Requires external infra (may fail without Kafka/runner)
  - smoke_approve_dispatch_playwright.js
  - any smoke script that exercises real dispatch/publish to Kafka

Playwright notes
- Playwright is listed as a devDependency. The first `npm install` will install browser binaries.
- By default some Playwright scripts navigate to the public demo host. Use TB_BASE to redirect them to your local instance.
- Screenshots are saved to /tmp/playwright_*.png or /tmp/smoke_*.png depending on the script.

Artifacts & logs
- Screenshots: /tmp/playwright_*.png, /tmp/smoke_followup_session_lifecycle_*.png
- Server logs: server.js prints to stdout; smoke/test scripts capture server stdout when they spawn it.

CI recommendations
- Install Playwright in CI images and run a small subset of smoke scripts on PRs (follow-up lifecycle, basic render-safe).
- Use environment matrix to run Desktop/Tablet/Mobile viewport variants if desired.

Notes
- If a Playwright script fails when targeting the public demo site, try running it locally (TB_BASE) to determine whether the failure is environmental or code-related.
- For stabilization, prefer the fixture-style tests (test_followups.js, test_attach_execution_report.js) since they are deterministic and do not depend on external Kafka/runner.
