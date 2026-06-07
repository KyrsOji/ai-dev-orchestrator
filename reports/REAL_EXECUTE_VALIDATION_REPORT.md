# Real Execute Validation Report

Purpose
- Perform a first "real" OpenHands invocation that is completely filesystem-only and harmless.

What we added
- scripts/openhands_stub.py
  - A small executable Python script that acts as a safe OpenHands: it writes `validation.txt` in the run directory containing a timestamp, the taskId, the hostname, and the marker `OPENHANDS_EXECUTION_VALIDATED`.
- scripts/real-execute-validation.sh
  - Stops the systemd runner if active, sets guarded execute-mode environment variables to invoke the local stub, uses fake kafka-console-consumer/producer tools to avoid the network, invokes `python3 -m runner.service` with a timeout, verifies run directory and artifacts, and restarts the runner.

Safety guarantees
- The stub only writes a single file `validation.txt` in the run directory and reads `task.json`.
- No network access, no Kafka or Git modifications, no OFBiz changes, and no privileged operations are performed.
- The systemd unit file is unchanged; the script only stops/starts the unit if present and restores the previous running state.

How to run

From repository root:

    bash scripts/real-execute-validation.sh

Validation performed by this change
- python3 -m compileall runner
- bash -n scripts/*.sh
- Executed the validation script (see logs during execution)

Files added
- scripts/openhands_stub.py
- scripts/real-execute-validation.sh
- reports/REAL_EXECUTE_VALIDATION_REPORT.md

If you want me to push these changes to a branch and open a PR, tell me the branch name to use.