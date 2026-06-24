#!/usr/bin/env bash
set -euo pipefail

TMP_DIR="$(mktemp -d --tmpdir agent-routing-smoke-XXXX)"
STORAGE_FILE="$TMP_DIR/registry.json"
SAMPLE_FILE="$TMP_DIR/sample_result.json"
OUT_FILE="$TMP_DIR/out.log"

echo "Using tmp dir: $TMP_DIR"

# Write registry storage with fake agents
python3 - <<'PY' > "$STORAGE_FILE"
import json, sys
from datetime import datetime, timezone, timedelta
now = datetime.now(timezone.utc)
fresh = now.isoformat().replace('+00:00','Z')
stale = (now - timedelta(seconds=400)).isoformat().replace('+00:00','Z')
data = {
  "ofbiz-dev-01": {"agentId":"ofbiz-dev-01","hostname":"ofbiz-01","roles":["ofbiz"],"status":"idle","cpuCount":2,"memoryGb":4.0,"diskFreeGb":10.0,"loadAverage":0.1,"lastSeen":fresh},
  "ofbiz-dev-02": {"agentId":"ofbiz-dev-02","hostname":"ofbiz-02","roles":["ofbiz"],"status":"busy","cpuCount":2,"memoryGb":4.0,"diskFreeGb":10.0,"loadAverage":0.1,"lastSeen":fresh},
  "ofbiz-dev-03": {"agentId":"ofbiz-dev-03","hostname":"ofbiz-03","roles":["ofbiz"],"status":"idle","cpuCount":2,"memoryGb":4.0,"diskFreeGb":10.0,"loadAverage":0.1,"lastSeen":stale},
  "liferay-dev-01": {"agentId":"liferay-dev-01","hostname":"liferay-01","roles":["liferay"],"status":"idle","cpuCount":2,"memoryGb":4.0,"diskFreeGb":10.0,"loadAverage":0.1,"lastSeen":fresh},
}
json.dump(data, sys.stdout, indent=2)
PY

# Prepare sample result to trigger ready_to_commit for an OFBiz task
cat > "$SAMPLE_FILE" <<'JSON'
{"taskId":"task-1","status":"success","metadata":{"change_type":"docs"}}
JSON

# Run reviewer in dry-run mode and capture output (no real Kafka)
export AGENT_REGISTRY_STORAGE="$STORAGE_FILE"
python3 -m reviewer.service --sample-result-file "$SAMPLE_FILE" --dry-run > "$OUT_FILE" 2>&1 || true

# Extract KAFKA-PUBLISH payload
PUB_LINE=$(grep -m1 '\[KAFKA-PUBLISH\]' "$OUT_FILE" || true)
if [ -z "$PUB_LINE" ]; then
  echo "FAIL: no KAFKA-PUBLISH line found in output"
  echo "Output:"
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
r = p.get('routing')
if not r:
    print('FAIL: routing missing in payload')
    sys.exit(4)
required = ('selectedAgentId','selectedHostname','selectedRole','selectionReason')
for k in required:
    if k not in r:
        print(f'FAIL: routing.{k} missing')
        sys.exit(5)
if r['selectedAgentId'] != 'ofbiz-dev-01':
    print('FAIL: selectedAgentId is not ofbiz-dev-01 but', r['selectedAgentId'])
    sys.exit(6)
print('PASS: selected', r['selectedAgentId'], 'role', r['selectedRole'], 'reason', r['selectionReason'])
sys.exit(0)
PY

# cleanup
rm -rf "$TMP_DIR"
