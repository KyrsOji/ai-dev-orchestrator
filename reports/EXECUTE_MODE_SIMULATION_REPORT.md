# Execute-mode Simulation Smoke Test

Purpose
- Verify RUNNER_MODE=execute wiring and guarded execution path without launching a real OpenHands or modifying OFBiz.

What the script does (scripts/execute-mode-simulation-smoke.sh)
- Stops the systemd runner service (ai-dev-runner-ofbiz.service) if it is running, recording its prior state.
- Creates temporary fake kafka console consumer and producer binaries in PATH to avoid touching real Kafka.
- Exports guarded execution environment variables:
  - RUNNER_MODE=execute
  - OPENHANDS_MODE=execute
  - OPENHANDS_CMD=/bin/echo
  - OPENHANDS_ARGS="SIMULATED_OPENHANDS_EXECUTION"
  - ALLOWED_OPENHANDS_COMMANDS=/bin/echo
  - EXECUTION_APPROVED=true
- Runs `python3 -m runner.service` with a short timeout so the service processes at least one task.
- Verifies that a run directory was created under $HOME/openhands-runs/<taskId> and that `execution-report.json` exists in it.
- Verifies the result was "published" by checking the fake producer output file.
- Restarts the systemd runner service back to its default dry-run mode if it was stopped.

How to run

From the repository root:

    bash scripts/execute-mode-simulation-smoke.sh

Notes and safety
- The script does NOT invoke any real OpenHands process; it uses `/bin/echo` for execution and fake kafka CLI wrappers to avoid network I/O.
- The systemd unit file under `systemd/ai-dev-runner-ofbiz.service` remains unchanged and keeps its default RUNNER_MODE=dry-run.
- Temporary artifacts (logs and the fake producer output) are left under a temporary directory which the script prints; remove them when no longer needed.

Validation performed in this change
- Python module compilation: `python3 -m compileall runner`
- Shell syntax check: `bash -n scripts/*.sh`

Files added
- scripts/execute-mode-simulation-smoke.sh
- reports/EXECUTE_MODE_SIMULATION_REPORT.md

If you want me to run the smoke script here, tell me and I will execute it and return the observed output and verification results.