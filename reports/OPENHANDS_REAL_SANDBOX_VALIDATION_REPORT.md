# OpenHands Real Sandbox Validation Report

Purpose
- Execute a real OpenHands process (the safe local stub) inside a disposable sandboxed run directory, ensuring only harmless filesystem writes occur and all guard checks are enforced.

What I added
- scripts/openhands-real-sandbox-validation.sh
  - Creates a disposable sandbox directory under a temporary location.
  - Prepares a run directory and task.json with executionApproved=true.
  - Sets environment variables to enforce guarded execute-mode and allowed commands.
  - Uses the existing OpenHands stub (scripts/openhands_stub.py) as the real process; it is executed with cwd set to the sandbox run directory.
  - Uses a fake kafka-console-producer in a temporary PATH to capture published results (no network or Kafka operations).
  - Calls runner.execution_guard.guard_execution to enforce approval and allowed-command checks, then runner.openhands_executor.execute_task to run the OpenHands process, and runner.result_publisher.publish_result to publish the result (captured by the fake producer).
  - Verifies the run directory, execution-report.json, validation.txt, execution-report status=="completed", and that the published result references the run directory.

Safety guarantees
- The OpenHands process used is a local stub that only writes a single `validation.txt` in its current working directory and reads the local task.json; it does not access network or external resources.
- The script runs the OpenHands process with cwd set to the disposable run directory to prevent accidental writes outside the sandbox.
- The fake kafka-console-producer captures published results to a temporary file; no real Kafka or network calls are made.
- No systemd unit files are modified; RUNNER_MODE and OPENHANDS_MODE environment variables are set only in the script environment and not persisted.

How to run

From repository root:

    bash scripts/openhands-real-sandbox-validation.sh

Validation performed
- python3 -m compileall runner
- bash -n scripts/*.sh
- Executed the sandbox validation script (see the script output for verification details)

Files added
- scripts/openhands-real-sandbox-validation.sh
- reports/OPENHANDS_REAL_SANDBOX_VALIDATION_REPORT.md

If you want these changes committed and pushed to a branch, I can prepare the commit and push as requested.