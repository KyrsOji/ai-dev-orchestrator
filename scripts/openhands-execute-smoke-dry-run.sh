#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/home/kojiyah/dev/ai-dev-orchestrator"
cd "$REPO_DIR"

export RUNNER_MODE="${RUNNER_MODE:-dry-run}"
export OPENHANDS_MODE="${OPENHANDS_MODE:-dry-run}"
export OPENHANDS_CMD="${OPENHANDS_CMD:-python3 -m openhands}"
export OPENHANDS_ARGS="${OPENHANDS_ARGS:-}"
export OPENHANDS_TIMEOUT_SECONDS="${OPENHANDS_TIMEOUT_SECONDS:-1800}"

echo "OpenHands execution adapter smoke (dry-run)"
echo "RUNNER_MODE=$RUNNER_MODE"
echo "OPENHANDS_MODE=$OPENHANDS_MODE"
echo "OPENHANDS_CMD=$OPENHANDS_CMD"
echo "OPENHANDS_ARGS=$OPENHANDS_ARGS"
echo "OPENHANDS_TIMEOUT_SECONDS=$OPENHANDS_TIMEOUT_SECONDS"

CMD_BIN="$(printf '%s\n' "$OPENHANDS_CMD" | awk '{print $1}')"
if command -v "$CMD_BIN" >/dev/null 2>&1; then
  echo "Found command binary: $(command -v "$CMD_BIN")"
else
  echo "WARNING: command binary not found: $CMD_BIN"
fi

SMOKE_DIR="$(mktemp -d /tmp/openhands-executor-smoke.XXXXXX)"
cat > "$SMOKE_DIR/task.md" <<'TASK'
# Smoke Test

Dry-run only. Do not launch OpenHands.
TASK

python3 - <<PY
from pathlib import Path
run_dir = Path("$SMOKE_DIR")
task_file = run_dir / "task.md"
assert task_file.exists(), f"missing {task_file}"
print(f"Run directory OK: {run_dir}")
print(f"Task markdown OK: {task_file}")
PY

rm -rf "$SMOKE_DIR"

echo "SMOKE_OK: OpenHands execution adapter dry-run configuration is valid"
