import json
import subprocess
from pathlib import Path
import tempfile

import pytest

from runner import result_publisher


class DummyCompletedProcess:
    def __init__(self, returncode=0, stdout="", stderr=""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


def test_enrich_with_sdk_metadata_and_publish(monkeypatch, tmp_path):
    # Prepare a fake execution-report.json in a temp runDirectory
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    report = {
        "conversationId": "conv-123",
        "responsePreview": "PONG-TEST",
        "executionStatus": "ConversationExecutionStatus.FINISHED",
        "eventTypeCounts": {"MessageEvent": 1},
        "returnCode": 0,
    }
    (run_dir / "execution-report.json").write_text(json.dumps(report))

    # Build base result payload (older schema)
    base_result = {
        "taskId": "SDK-PUBLISHER-TEST-001",
        "status": "executed",
        "summary": "done",
        "runDirectory": str(run_dir),
    }

    # Capture the payload that would be sent to subprocess.run by mocking it
    captured = {}

    def fake_run(cmd, input=None, text=None, capture_output=None, check=None, timeout=None):
        # record the payload
        captured['cmd'] = cmd
        captured['input'] = input
        # Return a dummy success
        return DummyCompletedProcess(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    ok, meta = result_publisher.publish_result(base_result, topic="test.topic")
    assert ok is True
    assert 'input' in captured
    published = json.loads(captured['input'])

    # Verify enriched fields present
    assert published.get('conversationId') == report['conversationId']
    assert published.get('responsePreview') == report['responsePreview']
    assert published.get('executionStatus') == report['executionStatus']
    assert published.get('eventTypeCounts') == report['eventTypeCounts']
    assert published.get('returnCode') == report['returnCode']


def test_publish_without_execution_report(monkeypatch, tmp_path):
    # No execution-report.json present
    run_dir = tmp_path / "run2"
    run_dir.mkdir()

    base_result = {
        "taskId": "SDK-PUBLISHER-TEST-002",
        "status": "dry_run_completed",
        "summary": "prepared",
        "runDirectory": str(run_dir),
    }

    captured = {}

    def fake_run(cmd, input=None, text=None, capture_output=None, check=None, timeout=None):
        captured['input'] = input
        return DummyCompletedProcess(returncode=0, stdout="ok", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    ok, meta = result_publisher.publish_result(base_result, topic="test.topic")
    assert ok is True
    published = json.loads(captured['input'])

    # Ensure original fields still present and no enrichment keys added
    assert published['taskId'] == base_result['taskId']
    assert published['status'] == base_result['status']
    # enrichment keys should not be present
    for key in ("conversationId", "responsePreview", "executionStatus", "eventTypeCounts", "returnCode"):
        assert key not in published
