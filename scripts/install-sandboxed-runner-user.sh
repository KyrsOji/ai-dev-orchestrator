#!/usr/bin/env bash
# Create an unprivileged user and run directory for the sandboxed runner.
# Intended to be run as root (or via sudo). Does NOT copy any secrets.
set -euo pipefail

USER=openhands-runner
HOMEDIR=/home/$USER
RUN_DIR="${RUN_DIR:-/var/lib/ai-dev-runner/openhands-runs}"
LOG_DIR="${LOG_DIR:-/var/log/ai-dev-runner}"

echo "[install-sandboxed-runner-user] Checking for user: $USER"
if getent passwd "$USER" >/dev/null 2>&1; then
  echo "[install] User $USER already exists"
else
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1; then
      echo "[install] Creating system user $USER using sudo"
      sudo useradd --system --create-home --home-dir "$HOMEDIR" --shell /usr/sbin/nologin --comment "OpenHands runner user" "$USER"
    else
      echo "[install][error] Must run as root to create user $USER or have sudo available" >&2
      exit 2
    fi
  else
    echo "[install] Creating system user $USER"
    useradd --system --create-home --home-dir "$HOMEDIR" --shell /usr/sbin/nologin --comment "OpenHands runner user" "$USER"
  fi
fi

# Create run dir with safe ownership and permissions
if [ ! -d "$RUN_DIR" ]; then
  echo "[install] Creating run directory $RUN_DIR"
  if [ "$(id -u)" -ne 0 ]; then
    sudo mkdir -p "$RUN_DIR"
    sudo chown "$USER":"$USER" "$RUN_DIR"
    sudo chmod 750 "$RUN_DIR"
  else
    mkdir -p "$RUN_DIR"
    chown "$USER":"$USER" "$RUN_DIR"
    chmod 750 "$RUN_DIR"
  fi
else
  echo "[install] Run directory $RUN_DIR already exists"
  echo "[install] Ensuring ownership and permissions"
  if [ "$(id -u)" -ne 0 ]; then
    sudo chown "$USER":"$USER" "$RUN_DIR"
    sudo chmod 750 "$RUN_DIR"
  else
    chown "$USER":"$USER" "$RUN_DIR"
    chmod 750 "$RUN_DIR"
  fi
fi

# Ensure log directory exists and has correct ownership
if [ -n "$LOG_DIR" ]; then
  if [ ! -d "$LOG_DIR" ]; then
    echo "[install] Creating log directory $LOG_DIR"
    if [ "$(id -u)" -ne 0 ]; then
      sudo mkdir -p "$LOG_DIR"
      sudo chown "$USER":"$USER" "$LOG_DIR"
      sudo chmod 750 "$LOG_DIR"
    else
      mkdir -p "$LOG_DIR"
      chown "$USER":"$USER" "$LOG_DIR"
      chmod 750 "$LOG_DIR"
    fi
  else
    echo "[install] Log directory $LOG_DIR already exists"
    echo "[install] Ensuring ownership and permissions"
    if [ "$(id -u)" -ne 0 ]; then
      sudo chown "$USER":"$USER" "$LOG_DIR"
      sudo chmod 750 "$LOG_DIR"
    else
      chown "$USER":"$USER" "$LOG_DIR"
      chmod 750 "$LOG_DIR"
    fi
  fi
fi

echo "[install] Completed. User: $USER, Run dir: $RUN_DIR"

echo "[install] Note: this script does NOT place any secrets or certificates into the run directory."
