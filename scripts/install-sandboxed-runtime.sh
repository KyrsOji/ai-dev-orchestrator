#!/usr/bin/env bash
set -euo pipefail

# install-sandboxed-runtime.sh
# Create /opt/ai-dev-orchestrator and copy runtime files (runner, scripts,
# reports, config) from the repository. Do NOT copy .git or secrets.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$SCRIPT_DIR/..}"
REPO_DIR="$(cd "$REPO_DIR" && pwd)"
TARGET_DIR="${TARGET_DIR:-/opt/ai-dev-orchestrator}"
RUNNER_GROUP="openhands-runner"

if [ "$(id -u)" -ne 0 ]; then
  echo "[install][error] This script must be run as root (sudo)." >&2
  exit 1
fi

echo "[install] Repository: $REPO_DIR"
echo "[install] Target: $TARGET_DIR"

# Ensure group exists
if ! getent group "$RUNNER_GROUP" >/dev/null 2>&1; then
  echo "[install] Group $RUNNER_GROUP not found; creating system group"
  groupadd --system "$RUNNER_GROUP"
fi

# Create target directory
mkdir -p "$TARGET_DIR"
chown root:"$RUNNER_GROUP" "$TARGET_DIR"
chmod 0750 "$TARGET_DIR"

# Create host writable log directory for the runner (outside the read-only /opt runtime)
LOG_DIR="${LOG_DIR:-/home/openhands-runner/ai-dev-runner-logs}"
if [ -n "$LOG_DIR" ]; then
  echo "[install] Ensuring log directory exists: $LOG_DIR"
  mkdir -p "$LOG_DIR"
  # If the unprivileged user exists, make them the owner; otherwise keep group ownership
  if getent passwd "openhands-runner" >/dev/null 2>&1; then
    chown "openhands-runner":"openhands-runner" "$LOG_DIR"
  else
    chown root:"$RUNNER_GROUP" "$LOG_DIR"
  fi
  chmod 0750 "$LOG_DIR"
fi

# rsync exclude patterns - do not copy secrets, certs, logs, run dirs, keystores, or .git
RSYNC_EXCLUDES=(
  --exclude='.git'
  --exclude='secrets'
  --exclude='secrets/**'
  --exclude='certs'
  --exclude='certs/**'
  --exclude='logs'
  --exclude='logs/**'
  --exclude='run'
  --exclude='run/**'
  --exclude='keystores'
  --exclude='keystores/**'
  --exclude='*.jks'
)

# Copy selected directories if present
for d in runner scripts reports config; do
  SRC="$REPO_DIR/$d"
  if [ -d "$SRC" ]; then
    echo "[install] Syncing $SRC -> $TARGET_DIR/"
    # Trailing slash on SRC to copy directory contents into target/<d>
    rsync -a --delete "${RSYNC_EXCLUDES[@]}" "$SRC" "$TARGET_DIR/"
  else
    echo "[install] Skipping missing $SRC"
  fi
done

# Ensure ownership and permissions
echo "[install] Setting ownership root:$RUNNER_GROUP"
chown -R root:"$RUNNER_GROUP" "$TARGET_DIR"

echo "[install] Setting directory permissions to 750"
find "$TARGET_DIR" -type d -exec chmod 0750 {} +

echo "[install] Setting file permissions to 640"
find "$TARGET_DIR" -type f -exec chmod 0640 {} +

# Make scripts under scripts/ executable by owner and group
if [ -d "$TARGET_DIR/scripts" ]; then
  echo "[install] Making scripts in $TARGET_DIR/scripts executable (750)"
  find "$TARGET_DIR/scripts" -type f -exec chmod 0750 {} +
fi

# Make files with a shebang executable (useful for any inline scripts)
echo "[install] Ensuring files with a shebang are executable"
while IFS= read -r -d '' file; do
  if head -n 1 "$file" | grep -q '^#!'; then
    chmod 0750 "$file" || true
  fi
done < <(find "$TARGET_DIR" -type f -print0)

echo "[install] Sync complete. Target is ready at $TARGET_DIR"
