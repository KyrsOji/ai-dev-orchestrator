#!/usr/bin/env bash
# Validate OpenHands execution configuration without launching OpenHands.
# This script checks environment variables, parses the command, validates
# timeout, and attempts to create a temporary run directory using the
# runner.run_directory.prepare_run_directory helper (no OpenHands invocation).

set -o errexit
set -o nounset
set -o pipefail

echo "OpenHands execution adapter smoke (dry-run)"

RUNNER_MODE=${RUNNER_MODE:-dry-run}
OPENHANDS_MODE=${OPENHANDS_MODE:-dry-run}
OPENHANDS_CMD=${OPENHANDS_CMD:-"python3 -m openhands"}
OPENHANDS_ARGS=${OPENHANDS_ARGS:-""}
OPENHANDS_TIMEOUT_SECONDS=${OPENHANDS_TIMEOUT_SECONDS:-1800}

echo "RUNNER_MODE=${RUNNER_MODE}"
echo "OPENHANDS_MODE=${OPENHANDS_MODE}"
echo "OPENHANDS_CMD=${OPENHANDS_CMD}"
echo "OPENHANDS_ARGS=${OPENHANDS_ARGS}"
echo "OPENHANDS_TIMEOUT_SECONDS=${OPENHANDS_TIMEOUT_SECONDS}"

# Warn if someone intends to execute but OPENHANDS_MODE is not execute
if [ "${RUNNER_MODE}" = "execute" ] && [ "${OPENHANDS_MODE}" != "execute" ]; then
  echo "WARNING: RUNNER_MODE=execute but OPENHANDS_MODE!=execute"
  echo "The executor will not invoke OpenHands unless OPENHANDS_MODE=execute"
fi

# Validate timeout is an integer > 0
if ! [[ "${OPENHANDS_TIMEOUT_SECONDS}" =~ ^[0-9]+$ ]]; then
  echo "ERROR: OPENHANDS_TIMEOUT_SECONDS must be an integer"
  exit 2
fi

# Validate the command's binary exists (do not run it)
# Extract the first token of the command
first_token=$(printf "%s" "${OPENHANDS_CMD}" | awk '{print $1}')
if ! command -v "${first_token}" >/dev/null 2>&1; then
  echo "WARNING: Command binary '${first_token}' not found in PATH. This may be okay if OPENHANDS_CMD is a full path or relies on a different runtime."
else
  echo "Found command binary: $(command -v "${first_token}")"
fi

# Try preparing a temporary run directory using the Python helper (safe)
TMPDIR=$(mktemp -d)
trap 'rm -rf "${TMPDIR}"' EXIT

python3 - <<PYEOF
import json, os, sys
from runner import run_directory
# Build a minimal dummy task
task = {
    "taskId": "smoke-test-$(os.getpid())",
    "objectiveId": "smoke-objective",
    "title": "Smoke test task",
    "description": "This task is only used for validating run directory creation.",
    "targetSystem": "ofbiz",
}
try:
    meta = run_directory.prepare_run_directory(task, base_dir=os.path.abspath("${TMPDIR}"))
    print("Prepared temporary run directory:")
    print(json.dumps(meta, indent=2))
    # List files
    files = os.listdir(meta['runDirectory'])
    print("Contents:")
    for f in files:
        print(" - ", f)
    sys.exit(0)
except Exception as e:
    print("ERROR: preparing run directory failed:", e)
    sys.exit(3)
PYEOF

echo "Smoke dry-run checks passed. No OpenHands was launched."
exit 0
