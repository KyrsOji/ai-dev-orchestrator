from __future__ import annotations

import json
import os
import subprocess
from typing import Any, Dict


def publish_result(result: Dict[str, Any], topic: str | None = None) -> None:
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
    subprocess.run(cmd, input=payload, text=True, check=True, timeout=30)
