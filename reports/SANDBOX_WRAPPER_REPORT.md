Sandbox wrapper report

Purpose
- Provide a safe wrapper (sandbox-openhands.sh) to run OpenHands processes inside a constrained environment that cannot access anything outside the task run directory.

What I added
- scripts/sandbox-openhands.sh
  - Uses bubblewrap (bwrap) to create an isolated mount namespace and optionally unshare the network.
  - Copies the target command into the run directory before invoking the sandbox to avoid accessing the repository.
  - Ro-binds minimal system dirs (/bin, /usr, /lib, /etc) and masks sensitive locations using tmpfs (repo root, SSH keys, Kafka certs, etc.).
  - Runs the command as /run/<cmd> inside the sandbox with working directory /run.
  - Fails closed if bubblewrap (bwrap) is not installed.

- scripts/sandbox-wrapper-smoke.sh
  - Smoke test for the wrapper. If bwrap is present it will run the wrapper with the OpenHands stub and verify validation.txt. If bwrap is absent the wrapper should refuse to run; the smoke script treats that refusal as a pass (fail-closed behavior validated).

Safety notes
- The wrapper never writes outside the run directory and masks the repository root and other known sensitive locations.
- Network is unshared (disabled) inside the sandbox when bubblewrap supports it.
- The wrapper refuses to run if bubblewrap is not available.

How to run smoke test

From repository root:

    bash scripts/sandbox-wrapper-smoke.sh

Validation steps performed by the smoke test
- Ensure sandbox-openhands.sh is executable
- Create disposable run dir
- Invoke sandbox-openhands.sh with the OpenHands stub as the command
- If bwrap is present: verify run dir, validation.txt, and that validation.txt contains the expected marker
- If bwrap is missing: verify wrapper exits non-zero with a clear message about missing bwrap (fail-closed)

Files added
- scripts/sandbox-openhands.sh
- scripts/sandbox-wrapper-smoke.sh
- reports/SANDBOX_WRAPPER_REPORT.md

