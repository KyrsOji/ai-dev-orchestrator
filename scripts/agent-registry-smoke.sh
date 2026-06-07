#!/usr/bin/env bash
# Smoke test for agent registry
# 1) start registry in file-tail mode (background)
# 2) publish a sample heartbeat to the tail file
# 3) wait a bit and verify that `python -m registry list` shows the agent

set -euo pipefail

TMP_DIR="$(mktemp -d --tmpdir agent-registry-XXXX)"
HEARTBEAT_FILE="$TMP_DIR/heartbeats.ndjson"
STORAGE_FILE="$TMP_DIR/registry.json"

echo "Using tmp dir: $TMP_DIR"

# Start registry consumer in background (tails HEARTBEAT_FILE and writes storage)
# Redirect output to log
python3 -m registry consume --storage "$STORAGE_FILE" --file-path "$HEARTBEAT_FILE" > "$TMP_DIR/registry.log" 2>&1 &
REG_PID=$!

# Ensure background process is killed on exit
trap "echo 'Cleaning up'; kill $REG_PID 2>/dev/null || true; rm -rf '$TMP_DIR'" EXIT

# Wait a bit for consumer to start
sleep 1

# Build sample heartbeat payload
TIMESTAMP="$(python3 - <<'PY'
from datetime import datetime, timezone
print(datetime.utcnow().replace(tzinfo=timezone.utc).isoformat().replace('+00:00','Z'))
PY
)"

AGENT_ID="ofbiz-dev-01"
HOSTNAME="test-host"
ROLES="[\"ofbiz\", \"java\"]"

PAYLOAD=$(cat <<EOF
{"agentId": "$AGENT_ID", "hostname": "$HOSTNAME", "roles": ["ofbiz","java"], "status": "idle", "cpuCount": 4, "memoryGb": 8.0, "diskFreeGb": 100.0, "loadAverage": 0.12, "lastSeen": "$TIMESTAMP"}
EOF
)
# Append to heartbeat file (newline-delimited JSON)
echo "$PAYLOAD" >> "$HEARTBEAT_FILE"

# Wait for consumer to pick it up
sleep 1

# Now run CLI to list agents
echo "Registry CLI output:"
python3 -m registry list --storage "$STORAGE_FILE"

# Check that agent ID appears in storage
if python3 - <<PY
import json
s = json.load(open('$STORAGE_FILE'))
print('$AGENT_ID' in s)
PY
then
  echo "Smoke test OK: agent found in registry storage"
  exit 0
else
  echo "Smoke test FAILED: agent not found" >&2
  cat "$TMP_DIR/registry.log" || true
  exit 2
fi
