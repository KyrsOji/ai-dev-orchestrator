from __future__ import annotations

import json
import os
import subprocess
from typing import Any, Dict, Tuple


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

    payload = json.dumps(result, sort_keys=True) + "\n"

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
