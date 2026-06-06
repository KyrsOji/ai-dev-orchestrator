# OpenHands Execution Adapter Report

This document describes the OpenHands execution adapter integrated with the OFBiz runner.

Purpose
-------
The adapter adds support for invoking an OpenHands execution against a prepared run directory. The implementation keeps dry-run as the default safe mode and provides an "execute" mode that will run OpenHands with a configurable command, capture stdout/stderr, and write an execution report JSON into the run directory.

Safety and defaults
-------------------
- The service uses two variables as a safety double-gate:
  - RUNNER_MODE (service-level): controls whether the service attempts an execution. Default: `dry-run`.
  - OPENHANDS_MODE (executor-level): the executor further checks this before launching OpenHands. Default: `dry-run`.

  This means you must set both `RUNNER_MODE=execute` and `OPENHANDS_MODE=execute` (and configure the command) to actually invoke OpenHands.

Environment variables
---------------------
- RUNNER_MODE: `dry-run` (default) or `execute`. The runner service will only call the executor when `RUNNER_MODE=execute`.
- OPENHANDS_MODE: `dry-run` (default) or `execute`. The executor itself checks this before invoking OpenHands.
- OPENHANDS_CMD: Command used to invoke OpenHands. Default: `python3 -m openhands`.
- OPENHANDS_ARGS: Extra args appended to the command (optional).
- OPENHANDS_TIMEOUT_SECONDS: Integer timeout in seconds for OpenHands execution. Default: `1800` (30 minutes).

Run directory and artifacts
---------------------------
When a task is prepared (via `runner.run_directory.prepare_run_directory`) the following files are created inside the run directory (by default: `~/openhands-runs/<taskId>` unless overridden):
- `task.json` — full task JSON
- `task.md` — human-readable markdown summary
- `runner-report.json` — runner's summary for the run

If the executor runs (execute mode) it will create:
- `openhands_stdout.txt` — captured stdout
- `openhands_stderr.txt` — captured stderr
- `execution-report.json` — structured execution report containing status, return code, timestamps, and paths (relative filenames)

Structure of execution-report.json
----------------------------------
The execution report contains fields similar to:

{
  "status": "executed" | "failed" | "timeout" | "error",
  "returncode": <int|null>,
  "executionDurationSeconds": <float>,
  "summary": "short one-line summary",
  "startedAt": "ISO timestamp",
  "finishedAt": "ISO timestamp",
  "stdout_path": "openhands_stdout.txt",
  "stderr_path": "openhands_stderr.txt"
}

Notes about behavior
--------------------
- The executor reads `task.md` from the run directory; if missing it will create a minimal `task.md` from the task metadata.
- Outputs are captured and written even on timeout or error cases when possible.
- The executor will not attempt to run OpenHands unless `OPENHANDS_MODE` is set to `execute`.

Enabling execute mode (exact commands)
--------------------------------------
You can enable execution either via systemd (recommended for production) or run locally. Below are exact commands you can use later to enable execution.

1) Local/test run (one-shot):

    RUNNER_MODE=execute OPENHANDS_MODE=execute \
      OPENHANDS_CMD='python3 -m openhands' \
      OPENHANDS_ARGS='' \
      OPENHANDS_TIMEOUT_SECONDS=1800 \
      python3 -m runner.service

This runs the service in the foreground and will attempt execution when tasks are consumed.

2) Enabling in systemd (example steps you would run on the target host):

    # Edit the unit file to set RUNNER_MODE=execute and OPENHANDS_MODE=execute
    sudo cp /etc/systemd/system/ai-dev-runner-ofbiz.service /etc/systemd/system/ai-dev-runner-ofbiz.service.bak
    sudo editor /etc/systemd/system/ai-dev-runner-ofbiz.service
    # Ensure the unit contains lines similar to:
    # Environment=RUNNER_MODE=execute
    # Environment=OPENHANDS_MODE=execute
    # Environment=OPENHANDS_CMD=python3 -m openhands
    # Environment=OPENHANDS_TIMEOUT_SECONDS=1800

    # Reload and restart the service
    sudo systemctl daemon-reload
    sudo systemctl restart ai-dev-runner-ofbiz
    sudo journalctl -u ai-dev-runner-ofbiz -f

Important: make sure the configured OPENHANDS_CMD is correct and OpenHands is installed and available in PATH on the target host before enabling execution.

Smoke test helper (no OpenHands invocation)
-------------------------------------------
A helper script `scripts/openhands-execute-smoke-dry-run.sh` is included in the repository. It validates the configuration (env vars, timeout, ability to create a run directory and write task.md) without launching OpenHands.

Security
--------
- Do not commit certificates, keys, keystores, or other secrets into the repository.
- The run directories may contain sensitive task data; manage permissions appropriately on hosts where execution runs.

If you need additional safeguards (e.g., require a specific file to exist to allow execute mode), we can add them.
