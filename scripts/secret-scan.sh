#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

# Secret scanning helper. Scans staged files (if any) or tracked repo files
# for common secret indicators. Does NOT print matched secret contents.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Patterns to check: each entry is "<grep-E-regex>::<label>"
PATTERNS=(
  "password=.*::password="
  "ssl\.keystore\.password::ssl.keystore.password"
  "ssl\.truststore\.password::ssl.truststore.password"
  "sasl\.jaas\.config::sasl.jaas.config"
  "API[_-]?KEY\s*[=:].*::API_KEY"
  "SECRET\s*[=:].*::SECRET"
  "TOKEN\s*[=:].*::TOKEN"
  "-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----::PRIVATE_KEY_HEADER"
)

# Exclude patterns (globs)
EXCLUDE_GLOBS=("*.redacted" "*.template" "logs/*" "*.log" "*.tmp")

# Determine files to scan: staged if any, otherwise tracked files
FILES=()
if git rev-parse --git-dir >/dev/null 2>&1; then
  STAGED=$(git diff --cached --name-only || true)
  if [[ -n "$STAGED" ]]; then
    while IFS= read -r f; do FILES+=("$f"); done <<< "$STAGED"
  else
    while IFS= read -r f; do FILES+=("$f"); done <<< "$(git ls-files)"
  fi
else
  while IFS= read -r f; do FILES+=("$f"); done <<< "$(find . -type f -not -path './.git/*' -print)"
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No files to scan."
  exit 0
fi

found=0

for f in "${FILES[@]}"; do
  # Normalize path
  [[ -z "$f" ]] && continue
  # Skip scanning this scanner script itself
  if [[ "$f" == "scripts/secret-scan.sh" ]]; then
    continue
  fi
  # Skip excluded globs
  skip=0
  for g in "${EXCLUDE_GLOBS[@]}"; do
    if [[ "$f" == $g ]]; then skip=1; break; fi
    # handle prefix-based exclude like logs/*
    if [[ "$g" == */* && "$f" == ${g%/*}/* ]]; then skip=1; break; fi
  done
  if [[ $skip -eq 1 ]]; then
    continue
  fi
  # Skip non-regular files
  if [[ ! -f "$f" ]]; then continue; fi
  # Ignore files that are clearly redacted reports: heuristics
  if [[ "$f" == *.md || "$f" == *.txt ]]; then
    if grep -Iq "REDACTED" "$f" 2>/dev/null; then
      # If file contains the token REDACTED, assume secrets are redacted already
      continue
    fi
  fi
  # Skip binary files
  if grep -Iq "^" "$f" 2>/dev/null; then :; else continue; fi

  for p in "${PATTERNS[@]}"; do
    regex="${p%%::*}"
    label="${p##*::}"
    if grep -E -q -- "$regex" "$f" 2>/dev/null; then
      echo "SECRET-PATTERN FOUND: $f -> $label"
      found=$((found+1))
      # Do not show matched contents — only report file and pattern label
      break
    fi
  done

done

if [[ $found -gt 0 ]]; then
  echo "\nSecret scan found $found file(s) with potential secrets. Please redact or move secrets to a vault before committing."
  exit 1
else
  echo "Secret scan OK: no obvious secrets found in scanned files."
  exit 0
fi
