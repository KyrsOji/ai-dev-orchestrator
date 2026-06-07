# Execution Guard Report

This report documents the execution safety guard added to the runner to prevent
accidental or unsafe execution of OpenHands.

Goals
- Require explicit approval before executing untrusted tasks
- Limit allowed commands and resource usage
- Provide clear diagnostics when execution is blocked

What was added
1. runner/execution_guard.py
   - Provides guard_execution(task, run_dir) which performs checks:
     * executionApproved flag in the task payload (or EXECUTION_APPROVED env var)
     * OPENHANDS command whitelist (ALLOWED_OPENHANDS_COMMANDS)
     * MAX_EXECUTION_SECONDS vs OPENHANDS_TIMEOUT_SECONDS
     * MAX_RUN_DIRECTORY_MB enforce run-directory size limit (MB)
     * MAX_RUN_FILES enforce run-directory file count

2. Integration into runner/service.py
   - Before calling the OpenHands executor, service.py calls the guard.
   - If the guard blocks execution, the task is marked failed and a result is
     published with a summary explaining the guard reason. No OpenHands process
     is spawned when the guard blocks execution.

3. Environment variables
   - ALLOWED_OPENHANDS_COMMANDS (comma-separated list)
     * If unset or empty the guard blocks execution with reason
       `no_allowed_commands_configured`.
   - MAX_RUN_DIRECTORY_MB (default: 100)
   - MAX_RUN_FILES (default: 1000)
   - MAX_EXECUTION_SECONDS (default: matches OPENHANDS_TIMEOUT_SECONDS)
   - EXECUTION_APPROVED (optional env var fallback for task-level approval)

4. Smoke-test script
   - scripts/execution-guard-smoke.sh: lightweight smoke test that imports the
     guard and prints the decision (does not execute OpenHands).

Defaults and safety
- The existing defaults are unchanged: `RUNNER_MODE=dry-run` and
  `OPENHANDS_MODE=dry-run`. With those defaults, OpenHands is not executed.
- The guard is conservative: if ALLOWED_OPENHANDS_COMMANDS is not configured,
  execution is blocked even when other checks pass. This forces explicit
  operator configuration before allowing live runs.

How the guard makes decisions
- The guard first checks the task payload for `executionApproved`==true. If not
  present, it checks the `EXECUTION_APPROVED` environment variable.
- It validates the configured `OPENHANDS_CMD` + `OPENHANDS_ARGS` against the
  comma-separated whitelist provided in `ALLOWED_OPENHANDS_COMMANDS`.
- It computes the run directory size and file count and enforces configured
  limits.
- It verifies that the desired execution timeout (OPENHANDS_TIMEOUT_SECONDS)
  does not exceed MAX_EXECUTION_SECONDS.

Operational notes
- To enable execution in a controlled manner, set ALLOWED_OPENHANDS_COMMANDS
  and ensure tasks include `executionApproved: true` (or set EXECUTION_APPROVED
  in environment). Adjust MAX_* env vars if needed.
- The guard is intentionally simple and conservative. Future improvements can
  add better matching rules, user identities, or allowlists per-project.
