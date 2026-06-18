#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d --tmpdir reviewer-exec-approval-smoke-XXXX)"
STORAGE_FILE="$TMP_DIR/registry.json"
OUT_FILE="$TMP_DIR/out.log"

echo "Using tmp dir: $TMP_DIR"

# Write registry storage with a single fake ofbiz agent
python3 - <<'PY' > "$STORAGE_FILE"
import json, sys
from datetime import datetime, timezone
now = datetime.now(timezone.utc)
fresh = now.isoformat().replace('+00:00','Z')
data = {
  "ofbiz-dev-01": {"agentId":"ofbiz-dev-01","hostname":"ofbiz-01","roles":["ofbiz"],"status":"idle","cpuCount":2,"memoryGb":4.0,"diskFreeGb":10.0,"loadAverage":0.1,"lastSeen":fresh},
}
json.dump(data, sys.stdout, indent=2)
PY

# Invoke reviewer.handle_review_response in dry-run mode and capture output
export AGENT_REGISTRY_STORAGE="$STORAGE_FILE"
python3 - <<'PY' > "$OUT_FILE" 2>&1
import os, json
from reviewer.service import Reviewer
rev = Reviewer(dry_run=True)
resp = {"taskId":"ORCH-E2E-SMOKE-009", "decision":"approved", "policy":"commit", "reason":"approved-by-human"}
res = rev.handle_review_response(resp)
print(json.dumps(res))
PY

# Extract KAFKA-PUBLISH payload
PUB_LINE=$(grep -m1 '\[KAFKA-PUBLISH\]' "$OUT_FILE" || true)
if [ -z "$PUB_LINE" ]; then
  echo "FAIL: no KAFKA-PUBLISH line found in output"
  sed -n '1,200p' "$OUT_FILE"
  rm -rf "$TMP_DIR"
  exit 2
fi

# Extract JSON payload after 'message='
PAYLOAD_JSON=$(echo "$PUB_LINE" | sed -E 's/.*message=(\{.*\})/\1/')
if [ -z "$PAYLOAD_JSON" ]; then
  echo "FAIL: failed to extract payload JSON"
  sed -n '1,200p' "$OUT_FILE"
  rm -rf "$TMP_DIR"
  exit 3
fi

python3 - <<PY
import json, sys
p = json.loads('''$PAYLOAD_JSON''')
# Check executionApproved true
if p.get('executionApproved') is not True:
    print('FAIL: executionApproved missing or not true:', p.get('executionApproved'))
    sys.exit(4)
r = p.get('routing')
if not r:
    print('FAIL: routing missing in payload')
    sys.exit(5)
required = ('selectedAgentId','selectedHostname','selectedRole','selectionReason')
for k in required:
    if k not in r:
        print(f'FAIL: routing.{k} missing')
        sys.exit(6)
if r['selectedAgentId'] != 'ofbiz-dev-01':
    print('FAIL: selectedAgentId is not ofbiz-dev-01 but', r['selectedAgentId'])
    sys.exit(7)
print('PASS: executionApproved true, selected', r['selectedAgentId'], 'role', r['selectedRole'], 'reason', r['selectionReason'])
sys.exit(0)
PY

# cleanup
rm -rf "$TMP_DIR"
