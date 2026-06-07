#!/usr/bin/env bash
set -euo pipefail

# Smoke test for the execution guard. This script does NOT execute OpenHands.
# It imports the guard and runs a small check against a temporary run directory.

python3 - <<'PY'
import os
import tempfile
import json

# Ensure repository package path is available when running the script from repo root
# (when executing this script, run it from the repository root)

from runner import execution_guard

# Prepare a minimal task that indicates approval
task = {"taskId": "smoke-1", "executionApproved": True}

d = tempfile.mkdtemp(prefix="exec-guard-smoke-")
# create a small file so the run_dir is non-empty
open(os.path.join(d, "test.txt"), "w").write("hello\n")

# Configure minimal allowed command for the smoke test
os.environ.setdefault("ALLOWED_OPENHANDS_COMMANDS", "python3 -m openhands")
os.environ.setdefault("OPENHANDS_CMD", "python3 -m openhands")
os.environ.setdefault("OPENHANDS_ARGS", "")

allowed, meta = execution_guard.guard_execution(task, d)
print("guard allowed:", allowed)
print("meta:", json.dumps(meta, indent=2))
PY
