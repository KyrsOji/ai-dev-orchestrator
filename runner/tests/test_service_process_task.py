import json
import os
from pathlib import Path
import tempfile

import pytest

from runner import service


def make_task(task_id="T1"):
    return {"taskId": task_id, "proposedAction": {"description": "Reply with PONG"}}


class DummyPublisher:
    def __init__(self):
        self.calls = []

    def __call__(self, result, topic=None):
        # Normalize signature: publisher(result, topic) or publisher(result, topic=...)
        self.calls.append((result, topic))
        return True, {"fake": True}


def test_process_task_dry_run_publishes_dry_run(monkeypatch, tmp_path):
    # Ensure module-level RUNNER_MODE is set to dry-run for this test
    monkeypatch.setattr(service, "RUNNER_MODE", "dry-run")

    # Stub run_directory.prepare_run_directory
    run_dir = tmp_path / "run-dry"
    run_dir.mkdir()
    monkeypatch.setattr(service.run_directory, "prepare_run_directory", lambda task: {"runDirectory": str(run_dir)})

    # Ensure no dedup record exists by patching runner.dedup.get_task_status
    import runner.dedup as dedup
    monkeypatch.setattr(dedup, "get_task_status", lambda task_id, db_path=None: None)
    monkeypatch.setattr(dedup, "init_db", lambda *a, **k: None)
    monkeypatch.setattr(dedup, "upsert_processed_task", lambda *a, **k: True)
    monkeypatch.setattr(dedup, "is_terminal_status", lambda s: s in {"dry_run_completed", "completed", "executed", "failed"})

    # Use dummy publisher to capture publishes
    pub = DummyPublisher()

    res = service.process_task(make_task("DRY-1"), publisher=pub, db_path=":memory:")

    assert res.get("processed") is True
    # Should publish exactly once
    assert len(pub.calls) == 1
    published_result, topic = pub.calls[0]
    assert published_result.get("status") == "dry_run_completed"


def test_process_task_execute_sdk_publishes_one_executed(monkeypatch, tmp_path):
    # Set execution mode to execute
    monkeypatch.setattr(service, "RUNNER_MODE", "execute")

    # Prepare run directory stub
    run_dir = tmp_path / "run-exec"
    run_dir.mkdir()
    monkeypatch.setattr(service.run_directory, "prepare_run_directory", lambda task: {"runDirectory": str(run_dir)})

    # Ensure dedup sees no prior runs by patching runner.dedup
    import runner.dedup as dedup
    monkeypatch.setattr(dedup, "get_task_status", lambda task_id, db_path=None: None)
    monkeypatch.setattr(dedup, "init_db", lambda *a, **k: None)
    monkeypatch.setattr(dedup, "upsert_processed_task", lambda *a, **k: True)
    monkeypatch.setattr(dedup, "is_terminal_status", lambda s: s in {"dry_run_completed", "completed", "executed", "failed"})

    # Stub execution_guard to allow execution
    monkeypatch.setattr(service.execution_guard, "guard_execution", lambda task, rd: (True, {}))

    # Stub SDK executor to return completed by injecting a fake module into sys.modules
    import sys, types
    mod = types.ModuleType("runner.openhands_sdk_executor")
    def fake_execute_task(run_dir_arg, task_arg):
        return {"status": "completed", "summary": "SDK done", "stdout": ""}
    mod.execute_task = fake_execute_task
    monkeypatch.setitem(sys.modules, "runner.openhands_sdk_executor", mod)
    # Ensure OPENHANDS_EXECUTOR env chooses sdk
    monkeypatch.setenv("OPENHANDS_EXECUTOR", "sdk")

    pub = DummyPublisher()
    res = service.process_task(make_task("EXEC-1"), publisher=pub, db_path=":memory:")

    assert res.get("processed") is True
    # Should publish exactly once
    assert len(pub.calls) == 1
    published_result, topic = pub.calls[0]
    assert published_result.get("status") == "executed"


def test_process_task_execute_guard_blocked_publishes_failed(monkeypatch, tmp_path):
    monkeypatch.setattr(service, "RUNNER_MODE", "execute")

    run_dir = tmp_path / "run-guard"
    run_dir.mkdir()
    monkeypatch.setattr(service.run_directory, "prepare_run_directory", lambda task: {"runDirectory": str(run_dir)})

    # dedup none by patching runner.dedup
    import runner.dedup as dedup
    monkeypatch.setattr(dedup, "get_task_status", lambda task_id, db_path=None: None)
    monkeypatch.setattr(dedup, "init_db", lambda *a, **k: None)
    monkeypatch.setattr(dedup, "upsert_processed_task", lambda *a, **k: True)
    monkeypatch.setattr(dedup, "is_terminal_status", lambda s: s in {"dry_run_completed", "completed", "executed", "failed"})

    # Guard denies execution
    monkeypatch.setattr(service.execution_guard, "guard_execution", lambda task, rd: (False, {"reason": "execution_not_approved"}))

    pub = DummyPublisher()
    res = service.process_task(make_task("GUARD-1"), publisher=pub, db_path=":memory:")

    assert res.get("processed") is True
    assert len(pub.calls) == 1
    published_result, topic = pub.calls[0]
    assert published_result.get("status") == "failed"
    assert "Execution blocked by guard" in published_result.get("summary", "")
