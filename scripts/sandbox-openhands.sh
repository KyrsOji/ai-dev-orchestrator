#!/usr/bin/env bash
# sandbox-openhands.sh - wrapper to run OpenHands inside a strict bubblewrap sandbox
# Usage: sandbox-openhands.sh <run-dir> -- <command> [args...]
# - Requires bubblewrap (bwrap). If not present, fail with a clear error (fail-closed).
# - Copies the command into the run-dir before sandboxing to avoid accessing repo paths.
# - Mounts minimal system directories read-only and binds the run-dir as /run.
# - Masks common sensitive locations (repo root, SSH keys, Kafka certs, git dirs) using tmpfs.
# - Uses --unshare-net to disable networking (if supported).

set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <run-dir> -- <command> [args...]" >&2
  exit 2
fi

RUN_DIR="$1"
shift
# allow optional -- separator
if [ "$1" = "--" ]; then
  shift
fi

if [ "$#" -lt 1 ]; then
  echo "No command supplied to sandbox." >&2
  exit 3
fi

COMMAND_PATH="$1"; shift || true
CMD_ARGS=("$@")

# Prefer bwrap
if ! command -v bwrap >/dev/null 2>&1; then
  echo "[sandbox-wrapper][error] bubblewrap (bwrap) not found. Sandbox requires bwrap and will not run. Refusing to execute." >&2
  exit 4
fi

# Resolve script and repo root (we assume this script lives under repo/scripts)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ ! -d "$RUN_DIR" ]; then
  echo "[sandbox-wrapper][error] Run directory not found: $RUN_DIR" >&2
  exit 5
fi

# Copy the command into the run dir to avoid needing access to repo paths.
# If the command is not an absolute path, we will attempt to find it in PATH.
EXEC_BASENAME="$(basename "$COMMAND_PATH")"
COPIED_CMD="$RUN_DIR/$EXEC_BASENAME"

if [ -f "$COMMAND_PATH" ]; then
  # absolute or relative file provided
  cp -a "$COMMAND_PATH" "$COPIED_CMD"
  chmod +x "$COPIED_CMD"
else
  # not a file path - try to resolve via PATH
  if command -v "$COMMAND_PATH" >/dev/null 2>&1; then
    FULLPATH="$(command -v "$COMMAND_PATH")"
    cp -a "$FULLPATH" "$COPIED_CMD"
    chmod +x "$COPIED_CMD"
  else
    echo "[sandbox-wrapper][error] Command not found: $COMMAND_PATH" >&2
    exit 6
  fi
fi

# Prepare bubblewrap args
BWRAP_ARGS=()

# Minimal system bindings (read-only) to provide runtime libraries and shells
for d in /bin /usr /lib /lib64 /sbin /usr/lib /usr/lib64 /etc; do
  if [ -d "$d" ]; then
    BWRAP_ARGS+=("--ro-bind" "$d" "$d")
  fi
done

# Mount dev and proc
BWRAP_ARGS+=("--dev" "/dev")
BWRAP_ARGS+=("--proc" "/proc")

# Provide a tmpfs for /tmp
BWRAP_ARGS+=("--tmpfs" "/tmp")
BWRAP_ARGS+=("--tmpfs" "/var/tmp")

# Mask sensitive locations by mounting an empty tmpfs over them
MASK_PATHS=(
  "$REPO_ROOT"
  "$HOME/.ssh"
  "$HOME/.gnupg"
  "/etc/ssl"
  "/etc/pki"
  "/etc/ssh"
  "/var/lib/kafka"
  "/etc/kafka"
)
for p in "${MASK_PATHS[@]}"; do
  # create a mount point inside the bubblewrap root (bwrap will create it)
  BWRAP_ARGS+=("--tmpfs" "$p")
done

# Bind the run dir as writable at /run and chdir into it
BWRAP_ARGS+=("--bind" "$RUN_DIR" "/run")
BWRAP_ARGS+=("--chdir" "/run")

# Disable networking
BWRAP_ARGS+=("--unshare-net")

# Make the sandbox die with the parent
BWRAP_ARGS+=("--die-with-parent")

# Set a minimal PATH inside sandbox
BWRAP_ARGS+=("--setenv" "PATH" "/usr/bin:/bin")

# Final command: run the copied command from /run
IN_SANDBOX_CMD=("/run/$EXEC_BASENAME" "${CMD_ARGS[@]}")

# Execute bubblewrap
exec bwrap "${BWRAP_ARGS[@]}" -- "${IN_SANDBOX_CMD[@]}"
