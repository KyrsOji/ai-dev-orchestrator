#!/usr/bin/env bash
# Smoke test for the mock matrix approval bridge
set -euo pipefail

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

BRIDGE_MODULE="matrix_bridge.bridge"
PY="${PYTHON:-python3}"

echo "[smoke] Using Python: $PY"

# Sample tasks
TASK1="$TMPDIR/task-docs.json"
TASK2="$TMPDIR/task-secrets.json"
TASK3="$TMPDIR/task-commit.json"
CMDS="$TMPDIR/cmds.txt"

cat > "$TASK1" <<'JSON'
{
  "taskId": "smoke-doc-1",
  "title": "Docs update",
  "metadata": {
    "change_type": "docs-only"
  }
}
JSON

cat > "$TASK2" <<'JSON'
{
  "taskId": "smoke-secrets-1",
  "title": "Secrets rotation",
  "metadata": {
    "contains_secrets": true
  }
}
JSON

cat > "$TASK3" <<'JSON'
{
  "taskId": "smoke-commit-1",
  "title": "Code change",
  "metadata": {
    "change_type": "commit"
  }
}
JSON

# Command to approve the commit task
printf "approve smoke-commit-1\n" > "$CMDS"

PASS=0
FAIL=0

run_bridge() {
  local sample_file="$1"; shift
  local extra_args=("$@")
  echo "[smoke] Running bridge against $sample_file"
  # Run in dry-run/mock mode
  if output="$($PY -m "$BRIDGE_MODULE" --dry-run --sample-task-file "$sample_file" "${extra_args[@]}" 2>&1)"; then
    echo "$output"
    return 0
  else
    echo "[smoke][ERROR] Bridge run failed for $sample_file"
    echo "$output"
    return 1
  fi
}

# 1) Docs-only should auto-approve and publish
if out=$(run_bridge "$TASK1"); then
  if echo "$out" | grep -E -q "\[KAFKA-PUBLISH\].*ai.dev.review.out"; then
    echo "[smoke] Docs auto-approve published - OK"
    PASS=$((PASS+1))
  else
    echo "[smoke][FAIL] Docs did not publish approval"; FAIL=$((FAIL+1))
  fi
else
  echo "[smoke][FAIL] Bridge execution failed for docs sample"; FAIL=$((FAIL+1))
fi

# 2) Secrets must be denied
if out=$(run_bridge "$TASK2"); then
  if echo "$out" | grep -E -q '"decision"\s*:\s*"denied"'; then
    echo "[smoke] Secrets denied - OK"
    PASS=$((PASS+1))
  else
    echo "[smoke][FAIL] Secrets sample did not result in denial"; FAIL=$((FAIL+1))
  fi
else
  echo "[smoke][FAIL] Bridge execution failed for secrets sample"; FAIL=$((FAIL+1))
fi

# 3) Commit requires approval; supply mock command to approve
if out=$(run_bridge "$TASK3" --mock-commands-file "$CMDS"); then
  if echo "$out" | grep -E -q '"decision"\s*:\s*"approved"'; then
    echo "[smoke] Commit approved via mock command - OK"
    PASS=$((PASS+1))
  else
    echo "[smoke][FAIL] Commit mock approval did not publish approved decision"; FAIL=$((FAIL+1))
  fi
else
  echo "[smoke][FAIL] Bridge execution failed for commit sample"; FAIL=$((FAIL+1))
fi

# Summary
echo "[smoke] PASS count: $PASS, FAIL count: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "[smoke] ALL TESTS PASS"
  exit 0
else
  echo "[smoke] SOME TESTS FAILED"
  exit 1
fi
