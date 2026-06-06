#!/usr/bin/env bash
export PATH="/home/kojiyah/tools/kafka/bin:$PATH"
set -euo pipefail

# Run the OFBiz ai-dev-runner in dry-run once
PYTHON=${PYTHON:-python3}
$PYTHON -m runner.main --once --dry-run --from-beginning
