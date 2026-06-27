#!/usr/bin/env bash
# Smoke test for the dry-run reviewer service
set -euo pipefail

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

PY=${PYTHON:-python3}
MODULE=reviewer.service

# Sample results
R_DOCS=$TMPDIR/result-docs.json
R_SECRETS=$TMPDIR/result-secrets.json
R_COMMIT=$TMPDIR/result-commit.json
R_DEPLOY=$TMPDIR/result-deploy.json
R_DONE=$TMPDIR/result-done.json

cat > "$R_DOCS" <<'JSON'
{
  "taskId": "rev-doc-1",
  "status": "success",
  "metadata": {
    "change_type": "docs-only"
  }
}
JSON

cat > "$R_SECRETS" <<'JSON'
{
  "taskId": "rev-secrets-1",
  "status": "success",
  "metadata": {
    "contains_secrets": true
  }
}
JSON

cat > "$R_COMMIT" <<'JSON'
{
  "taskId": "rev-commit-1",
  "status": "success",
  "metadata": {
    "change_type": "commit"
  }
}
JSON

cat > "$R_DEPLOY" <<'JSON'
{
  "taskId": "rev-deploy-1",
  "status": "success",
  "metadata": {
    "action": "deploy"
  }
}
JSON

cat > "$R_DONE" <<'JSON'
{
  "taskId": "rev-done-1",
  "status": "success",
  "metadata": {
    "change_type": "misc"
  }
}
JSON

PASS=0
FAIL=0

run_reviewer() {
  local file=$1
  echo "[smoke] Running reviewer on $file"
  if out=$($PY -m $MODULE --sample-result-file "$file" --dry-run 2>&1); then
    echo "$out"
    echo "$out"
    return 0
  else
    echo "[smoke][ERROR] reviewer failed for $file"
    echo "$out"
    return 1
  fi
}

# 1) docs-only -> ready_to_commit -> publish ai.dev.task.ofbiz
out=$(run_reviewer "$R_DOCS")
if echo "$out" | grep -q '"classification": "ready_to_commit"'; then
  if echo "$out" | grep -q '\[KAFKA-PUBLISH\].*ai.dev.task.ofbiz'; then
    echo "[smoke] Docs ready_to_commit published ai.dev.task.ofbiz - OK"
    PASS=$((PASS+1))
  else
    echo "[smoke][FAIL] Docs did not publish ai.dev.task.ofbiz"; FAIL=$((FAIL+1))
  fi
else
  echo "[smoke][FAIL] Docs classification not ready_to_commit"; FAIL=$((FAIL+1))
fi

# 2) secrets -> unsafe -> publish ai.dev.approval.required
out=$(run_reviewer "$R_SECRETS")
if echo "$out" | grep -q '"classification": "unsafe"'; then
  if echo "$out" | grep -q '\[KAFKA-PUBLISH\].*ai.dev.approval.required'; then
    echo "[smoke] Secrets classified unsafe and published approval request - OK"
    PASS=$((PASS+1))
  else
    echo "[smoke][FAIL] Secrets did not publish approval request"; FAIL=$((FAIL+1))
  fi
else
  echo "[smoke][FAIL] Secrets classification not unsafe"; FAIL=$((FAIL+1))
fi

# 3) commit -> requires_human_approval -> publish ai.dev.approval.required
out=$(run_reviewer "$R_COMMIT")
if echo "$out" | grep -q '"classification": "requires_human_approval"'; then
  if echo "$out" | grep -q '\[KAFKA-PUBLISH\].*ai.dev.approval.required'; then
    echo "[smoke] Commit requires_human_approval and published approval request - OK"
    PASS=$((PASS+1))
  else
    echo "[smoke][FAIL] Commit did not publish approval request"; FAIL=$((FAIL+1))
  fi
else
  echo "[smoke][FAIL] Commit classification not requires_human_approval"; FAIL=$((FAIL+1))
fi

# 4) deploy -> requires_human_approval -> publish ai.dev.approval.required
out=$(run_reviewer "$R_DEPLOY")
if echo "$out" | grep -q '"classification": "requires_human_approval"'; then
  if echo "$out" | grep -q '\[KAFKA-PUBLISH\].*ai.dev.approval.required'; then
    echo "[smoke] Deploy requires_human_approval and published approval request - OK"
    PASS=$((PASS+1))
  else
    echo "[smoke][FAIL] Deploy did not publish approval request"; FAIL=$((FAIL+1))
  fi
else
  echo "[smoke][FAIL] Deploy classification not requires_human_approval"; FAIL=$((FAIL+1))
fi

# 5) generic success -> completed -> no publish
out=$(run_reviewer "$R_DONE")
if echo "$out" | grep -q '"classification": "completed"'; then
  if echo "$out" | grep -q '\[KAFKA-PUBLISH\]'; then
    echo "[smoke][FAIL] Completed unexpectedly published a Kafka message"; FAIL=$((FAIL+1))
  else
    echo "[smoke] Completed produced no Kafka publishes - OK"
    PASS=$((PASS+1))
  fi
else
  echo "[smoke][FAIL] Generic success not classified as completed"; FAIL=$((FAIL+1))
fi

# Summary
echo "[smoke] PASS: $PASS, FAIL: $FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "[smoke] ALL TESTS PASS"
  exit 0
else
  echo "[smoke] SOME TESTS FAILED"
  exit 1
fi
