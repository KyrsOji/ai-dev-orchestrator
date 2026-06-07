SYSTEMD sandbox deployment for OpenHands runner

Purpose
- Provide a host-compatible sandbox for running the OFBiz OpenHands runner on systems where bubblewrap (bwrap) cannot be used due to namespace restrictions.
- Use systemd's built-in sandboxing and hardened service options to limit what the runner can access while keeping defaults in dry-run mode.

What was added
- systemd/ai-dev-runner-ofbiz-sandboxed.service
  - Runs as user `openhands-runner` and keeps RUNNER_MODE and OPENHANDS_MODE set to `dry-run` by default.
  - Enforces hardening options: NoNewPrivileges, PrivateTmp, ProtectSystem=strict, ProtectHome=true, PrivateNetwork=true, RestrictAddressFamilies, ReadOnlyPaths, ReadWritePaths and InaccessiblePaths for sensitive locations.
  - Uses /opt/ai-dev-orchestrator as the runtime WorkingDirectory and exposes it as ReadOnlyPaths; run artifacts are placed under /var/lib/ai-dev-runner/openhands-runs and logs are placed under /var/log/ai-dev-runner (declared via ReadWritePaths).
  - Adds Environment=RUNNER_LOG_DIR and Environment=RUNNER_BASE_DIR to point the runner at writable host directories for logs and run artifacts (defaults: /var/log/ai-dev-runner and /var/lib/ai-dev-runner/openhands-runs).

- scripts/install-sandboxed-runtime.sh
  - Intended to be run as root (via sudo). Creates /opt/ai-dev-orchestrator and copies the following directories from the repository: runner/, scripts/, reports/, and config/ (if present).
  - Does NOT copy .git, secrets, certs, logs, run directories, or keystores.
  - Sets ownership to root:openhands-runner for /opt runtime and enforces conservative permissions: directories 750, files 640, and makes scripts executable (750).
  - Ensures the host writable logging directory (/home/openhands-runner/ai-dev-runner-logs) exists and sets appropriate ownership and permissions.

- scripts/systemd-sandbox-smoke.sh
  - Smoke checks that verify the unit file syntax (if systemd-analyze is available), that the user exists, that run directory permissions are correct, that /opt/ai-dev-orchestrator exists, and that the unit uses it as WorkingDirectory and ReadOnlyPaths.
  - Does NOT start or enable the service and does NOT enable execute mode by default.

- scripts/logging-smoke.sh
  - Validates that the unit sets Environment=RUNNER_LOG_DIR and that the declared log directory exists and is writable by the runner user.
  - Helpful to verify logging will succeed when the unit is sandboxed.

Security notes
- The systemd unit aims for defense-in-depth: even when bubblewrap is unavailable, systemd options reduce the attack surface.
- PrivateNetwork=true isolates network namespaces by default (combined with RestrictAddressFamilies). This is conservative — network access is effectively disabled by default. If you need to allow network access for specific test scenarios, you can create an alternative unit or temporarily relax the directives.
- The install script intentionally avoids handling or copying secrets.

How to run the smoke checks

From repository root:

    # create runtime (requires root)
    sudo bash scripts/install-sandboxed-runtime.sh

    # verify unit file and runtime layout (safe to run as non-root)
    bash scripts/systemd-sandbox-smoke.sh

Notes and rationale
- We keep RUNNER_MODE and OPENHANDS_MODE as `dry-run` by default to prevent accidental real execution.
- The unit binds write access only to the dedicated run directory to avoid leakage of host secrets; the runtime files are provided read-only under /opt/ai-dev-orchestrator.
- The smoke script is intentionally non-invasive and safe to run on developer hosts.

Files added/modified
- runner/run_directory.py (modified)
- systemd/ai-dev-runner-ofbiz-sandboxed.service (modified)
- scripts/install-sandboxed-runtime.sh (modified/created)
- scripts/install-sandboxed-runner-user.sh (modified)
- scripts/systemd-sandbox-smoke.sh (modified)
- scripts/logging-smoke.sh (added/modified)
- reports/SYSTEMD_SANDBOX_REPORT.md (modified)
