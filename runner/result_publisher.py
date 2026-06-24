from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, Tuple


def _enrich_with_sdk_metadata(result: Dict[str, Any]) -> Dict[str, Any]:
    """If an execution-report.json exists in the runDirectory, merge
    selected SDK metadata into the published result while preserving
    backward compatibility."""
    enriched = dict(result)  # shallow copy
    run_dir = enriched.get("runDirectory") or enriched.get("run_directory")

    if not run_dir:
        return enriched

    try:
        report_path = Path(run_dir) / "execution-report.json"
        if report_path.exists():
            with report_path.open("r", encoding="utf-8") as fh:
                report = json.load(fh)
            # Add required SDK fields into the published result
            for key in (
                "conversationId",
                "responsePreview",
                "executionStatus",
                "eventTypeCounts",
                "returnCode",
            ):
                if key in report:
                    enriched[key] = report[key]
    except Exception:
        # Best-effort enrichment: do not block publishing on failures
        pass

    return enriched


def publish_result(result: Dict[str, Any], topic: str | None = None) -> Tuple[bool, Dict[str, Any]]:
    topic = topic or os.environ.get("RESULT_TOPIC", "ai.dev.result.out")
    bootstrap = os.environ.get("KAFKA_BOOTSTRAP", "kafka.yahlife.com:9095")
    config = os.environ.get("KAFKA_CLIENT_CONFIG")

    cmd = [
        "kafka-console-producer.sh",
        "--bootstrap-server",
        bootstrap,
        "--topic",
        topic,
    ]

    if config:
        cmd.extend(["--producer.config", config])

    # Enrich result payload with SDK metadata when available
    enriched = _enrich_with_sdk_metadata(result)

    payload = json.dumps(enriched, sort_keys=True) + "\n"

    try:
        proc = subprocess.run(
            cmd,
            input=payload,
            text=True,
            capture_output=True,
            check=False,
            timeout=30,
        )
        meta = {
            "topic": topic,
            "returnCode": proc.returncode,
            "stdout": proc.stdout[-4000:],
            "stderr": proc.stderr[-4000:],
        }
        return proc.returncode == 0, meta
    except Exception as exc:
        return False, {
            "topic": topic,
            "error": str(exc),
            "errorType": type(exc).__name__,
        }
