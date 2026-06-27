import sys
from pathlib import Path

from runner.run_directory import prepare_run_directory
from runner.openhands_executor import execute_task


def test_uses_proposed_action_description(tmp_path, monkeypatch):
    """When task.instructions is empty, proposedAction.description should be used."""
    base_dir = tmp_path / "openhands-runs"
    task = {
        "taskId": "REAL-OH-SMOKE-TEST",
        "title": "Test Proposed Action",
        "description": "",
        "instructions": "",
        "proposedAction": {"type": "manual", "description": "Run the special job now."},
    }

    # Force executor to run the real stub in execute mode.
    monkeypatch.setenv("OPENHANDS_MODE", "execute")
    stub = Path(__file__).resolve().parents[2] / "scripts" / "openhands_real_stub.py"
    monkeypatch.setenv("OPENHANDS_CMD", f"{sys.executable} {stub}")
    monkeypatch.delenv("SANDBOX_WRAPPER", raising=False)

    prep = prepare_run_directory(task, base_dir=str(base_dir))
    run_dir = Path(prep["runDirectory"])

    result = execute_task(str(run_dir), task)

    assert result["status"] == "completed", f"Executor failed: {result}"
    assert result.get("inputSource") == "proposedAction.description"

    # The test stub writes a smoke file when it receives stdin. Verify content.
    smoke = run_dir / "real-oh-smoke-003.md"
    assert smoke.exists(), f"Expected smoke file missing: {list(run_dir.iterdir())}"
    assert smoke.read_text(encoding="utf-8").strip() == "Run the special job now."
