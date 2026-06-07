SYSTEMD sandbox deployment for OpenHands runner

Purpose
- Provide a host-compatible sandbox for running the OFBiz OpenHands runner on systems where bubblewrap (bwrap) cannot be used due to namespace restrictions.
- Use systemd's built-in sandboxing and hardened service options to limit what the runner can access while keeping defaults in dry-run mode.

What was added
- systemd/ai-dev-runner-ofbiz-sandboxed.service
  - Runs as user `openhands-runner` and keeps RUNNER_MODE and OPENHANDS_MODE set to `dry-run` by default.
  - Enforces hardening options: NoNewPrivileges, PrivateTmp, ProtectSystem=strict, ProtectHome=true, PrivateNetwork=true, RestrictAddressFamilies, ReadWritePaths and InaccessiblePaths for sensitive locations.
  - Writes runs only under /home/openhands-runner/openhands-runs (declared via ReadWritePaths).

- scripts/install-sandboxed-runner-user.sh
  - Creates a system user `openhands-runner` and the run directory `/home/openhands-runner/openhands-runs` with safe ownership and permissions.
  - Does NOT copy any secrets or certificates.
  - Intended to be run as root (or via sudo). If not run as root, it will attempt to use sudo if available and will fail otherwise.

- scripts/systemd-sandbox-smoke.sh
  - Smoke checks that verify the unit file syntax (if systemd-analyze is available), that the user exists, that run directory permissions are correct, and that essential hardening directives are present in the unit file.
  - Does NOT start or enable the service and does NOT enable execute mode.

Security notes
- The systemd unit aims for defense-in-depth: even when bubblewrap is unavailable, systemd options reduce the attack surface.
- PrivateNetwork=true isolates network namespaces by default (combined with RestrictAddressFamilies). This is conservative — network access is effectively disabled by default. If you need to allow network access for specific test scenarios, you can create an alternative unit or temporarily relax the directives.
- The install script intentionally avoids handling or copying secrets.

How to run the smoke checks

From repository root:

    bash scripts/systemd-sandbox-smoke.sh

If you want to create the system user and run directory (requires root):

    sudo bash scripts/install-sandboxed-runner-user.sh

Notes and rationale
- We keep RUNNER_MODE and OPENHANDS_MODE as `dry-run` by default to prevent accidental real execution.
- The unit binds write access only to the dedicated run directory to avoid leakage of host secrets.
- The smoke script is intentionally non-invasive and safe to run on developer hosts.

Files added/modified
- systemd/ai-dev-runner-ofbiz-sandboxed.service (new)
- scripts/install-sandboxed-runner-user.sh (new)
- scripts/systemd-sandbox-smoke.sh (new)
- reports/SYSTEMD_SANDBOX_REPORT.md (new)
