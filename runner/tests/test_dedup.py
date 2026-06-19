import os
import sqlite3
from pathlib import Path

import pytest


def _import_runner_with_db(db_path: Path):
    # Ensure env var is set before importing modules
    os.environ["PROCESSED_TASKS_DB"] = str(db_path)
    # Import here to ensure dedup picks up env var when needed
    import importlib
    import runner.service as service
    import runner.dedup as dedup
    importlib.reload(dedup)
    return service, dedup


def test_duplicate_task_skipped(tmp_path, monkeypatch):
    db_path = tmp_path / "processed_tasks.db"
    service, dedup = _import_runner_with_db(db_path)

    # Stub run_directory to avoid filesystem side-effects
    monkeypatch.setattr(service.run_directory, "prepare_run_directory", lambda t: {"runDirectory": str(tmp_path / "run1")})

    # Publisher that always succeeds
    def fake_publisher(result, topic):
        return True, {"topic": topic}

    task = {"taskId": "DEDUP-1", "title": "dedup test"}

    # First run should process and record
    r1 = service.process_task(task, publisher=fake_publisher, db_path=str(db_path))
    assert r1.get("processed") is True
    assert r1.get("published") is True

    # DB should contain this task as completed
    status = dedup.get_task_status("DEDUP-1", str(db_path))
    assert status == "dry_run_completed"

    # Second run should be skipped
    r2 = service.process_task(task, publisher=fake_publisher, db_path=str(db_path))
    assert r2.get("skipped") is True


def test_failed_task_retry_allowed(tmp_path, monkeypatch):
    db_path = tmp_path / "processed_tasks.db"
    service, dedup = _import_runner_with_db(db_path)

    monkeypatch.setattr(service.run_directory, "prepare_run_directory", lambda t: {"runDirectory": str(tmp_path / "run2")})

    # Publisher fails first time
    def pub_fail(result, topic):
        return False, {"error": "simulated"}

    task = {"taskId": "DEDUP-2", "title": "fail-then-retry"}

    r1 = service.process_task(task, publisher=pub_fail, db_path=str(db_path))
    assert r1.get("processed") is True
    assert r1.get("published") is False

    # No DB record should exist
    assert dedup.get_task_status("DEDUP-2", str(db_path)) is None

    # Now publisher succeeds
    def pub_ok(result, topic):
        return True, {"topic": topic}

    r2 = service.process_task(task, publisher=pub_ok, db_path=str(db_path))
    assert r2.get("processed") is True
    assert r2.get("published") is True

    # DB now has record
    assert dedup.get_task_status("DEDUP-2", str(db_path)) == "dry_run_completed"


def test_sqlite_persistence_across_restarts(tmp_path, monkeypatch):
    db_path = tmp_path / "processed_tasks.db"
    service, dedup = _import_runner_with_db(db_path)

    monkeypatch.setattr(service.run_directory, "prepare_run_directory", lambda t: {"runDirectory": str(tmp_path / "run3")})

    def fake_publisher(result, topic):
        return True, {"topic": topic}

    task = {"taskId": "DEDUP-3", "title": "persistence"}

    r1 = service.process_task(task, publisher=fake_publisher, db_path=str(db_path))
    assert r1.get("processed") is True
    assert r1.get("published") is True

    # Simulate restart by reloading dedup module
    import importlib
    import runner.dedup as dedup2
    importlib.reload(dedup2)

    # Status should still be present
    assert dedup2.get_task_status("DEDUP-3", str(db_path)) == "dry_run_completed"
