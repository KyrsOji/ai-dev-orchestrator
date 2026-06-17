#!/usr/bin/env bash
set -euo pipefail
BASE="http://127.0.0.1:3000"
TASK="PWA-MOBILE-HOME-001"
TITLE="Reviewer Alternative"
BODY="Smoke test opinion $(date -u +"%Y-%m-%dT%H:%M:%SZ")"

echo "Posting opinion to $BASE/taskboard/api/opinions/$TASK"
RESP=$(curl -sS -X POST "$BASE/taskboard/api/opinions/$TASK" -H "Content-Type: application/json" -d "$(jq -n --arg t "$TITLE" --arg b "$BODY" '{title:$t, body:$b}')")

echo "POST response:"
echo "$RESP" | jq .

ID=$(echo "$RESP" | jq -r '.id // empty')
CREATED=$(echo "$RESP" | jq -r '.createdAt // empty')
SRC=$(echo "$RESP" | jq -r '.source // empty')
T=$(echo "$RESP" | jq -r '.title // empty')
B=$(echo "$RESP" | jq -r '.body // empty')

if [ -z "$ID" ]; then
  echo "FAIL: POST response missing id"
  exit 2
fi
if [ -z "$CREATED" ]; then
  echo "FAIL: POST response missing createdAt"
  exit 2
fi
if [ "$SRC" != "chatgpt" ]; then
  echo "FAIL: POST response source not 'chatgpt' (got: $SRC)"
  exit 2
fi

if [ "$T" != "$TITLE" ]; then
  echo "WARN: title mismatch (posted: '$TITLE' returned: '$T')"
fi
if [ "$B" != "$BODY" ]; then
  echo "WARN: body mismatch (posted vs returned)"
fi

# GET list
echo "\nFetching opinions list for $TASK"
LIST=$(curl -sS "$BASE/taskboard/api/opinions/$TASK")
echo "$LIST" | jq '. | {count: length, sample: .[0]}'

# ensure ID present in list
FOUND=$(echo "$LIST" | jq -e --arg id "$ID" 'map(.id) | index($id) != null' || echo false)
if [ "$FOUND" != "true" ]; then
  echo "FAIL: created opinion id not found in opinions list"
  exit 2
fi

echo "\nChecking runner result endpoint for $TASK"
RES=$(curl -sS "$BASE/taskboard/api/results/$TASK")
echo "$RES" | jq .

FOUND_RES=$(echo "$RES" | jq -r '.found // empty')
if [ "$FOUND_RES" != "true" ]; then
  echo "WARNING: runner result not found (found: $FOUND_RES)"
else
  echo "Runner result found"
fi

# Show persisted file for inspection (if accessible)
if [ -f /tmp/taskboard-opinions.json ]; then
  echo "\nContents of /tmp/taskboard-opinions.json (relevant task entries):"
  jq --arg t "$TASK" '.[$t] // []' /tmp/taskboard-opinions.json
fi

echo "\nSMOKE OK: opinions endpoint working"
