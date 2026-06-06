"""Entry point for the OFBiz ai-dev-runner dry-run prototype.

Usage (example):
  python3 -m runner.main --once --dry-run --from-beginning

This module consumes one task, prepares a run directory, and (in dry-run)
publishes a result indicating dry_run_completed.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime

from . import openhands_dispatch
from . import run_directory
from . import task_consumer
from . import result_publisher


def _iso_now() -> str:
    return datetime.utcnow().isoformat() + "Z"


def build_result_message(task: dict, run_dir: str) -> dict:
    import uuid

    return {
        "resultId": str(uuid.uuid4()),
        "taskId": task.get("taskId"),
        "objectiveId": task.get("objectiveId"),
        "targetSystem": "ofbiz",
        "status": "dry_run_completed",
        "summary": "Task consumed and run directory prepared.",
        "runDirectory": run_dir,
        "createdAt": _iso_now(),
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true", help="Consume/publish once and exit")
    parser.add_argument("--task-topic", default="ai.dev.task.ofbiz")
    parser.add_argument("--result-topic", default="ai.dev.result.out")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--from-beginning", action="store_true")

    args = parser.parse_args(argv)

    if not args.once:
        print("This prototype currently supports --once only. Exiting.")
        return 2

    # Step 1: Consume one task
    print(f"Consuming one task from topic {args.task_topic}...")
    task, meta = task_consumer.consume_one_task(args.task_topic, from_beginning=args.from_beginning)

    if task is None:
        print("No task consumed or an error occurred:")
        print(json.dumps(meta, indent=2))
        # Create a brief report file for diagnostics
        reports_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")
        try:
            os.makedirs(reports_dir, exist_ok=True)
            report_path = os.path.join(reports_dir, "OFBIZ_RUNNER_DRY_RUN_REPORT.md")
            with open(report_path, "w", encoding="utf-8") as f:
                f.write("# OFBiz Runner Dry Run Report\n\n")
                f.write("consumed_task: false\n\nmeta:\n```\n")
                json.dump(meta, f, indent=2)
                f.write("\n```\n")
        except Exception:
            pass
        return 1

    print("Task consumed successfully. Preparing run directory...")
    # Step 2: Prepare run directory
    rd_meta = run_directory.prepare_run_directory(task)
    run_dir = rd_meta.get("runDirectory")
    print(f"Run directory prepared at: {run_dir}")

    # Step 3: Dry-run mode: do not invoke OpenHands, create dispatch placeholder
    dispatch_meta = openhands_dispatch.dispatch_task(task)
    print(f"Dispatch placeholder: {dispatch_meta}")

    # Step 4: Build result message and publish
    result_msg = build_result_message(task, run_dir)

    if args.dry_run:
        print("Dry-run mode enabled: setting status to dry_run_completed and publishing result.")
    else:
        print("Warning: this prototype is intended for dry-run only. Publishing same result anyway.")

    success, pub_meta = result_publisher.publish_result(result_msg, topic=args.result_topic)
    if not success:
        print("Failed to publish result:")
        print(json.dumps(pub_meta, indent=2))
        return 3

    print("Result published successfully.")
    # Also append to the local report file
    reports_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reports")
    try:
        os.makedirs(reports_dir, exist_ok=True)
        report_path = os.path.join(reports_dir, "OFBIZ_RUNNER_DRY_RUN_REPORT.md")
        with open(report_path, "w", encoding="utf-8") as f:
            f.write("# OFBiz Runner Dry Run Report\n\n")
            f.write("consumed_task: true\n")
            f.write(f"taskId: {task.get('taskId')}\n")
            f.write(f"runDirectory: {run_dir}\n\n")
            f.write("result_message:\n```\n")
            json.dump(result_msg, f, indent=2)
            f.write("\n```\n")
    except Exception:
        pass

    return 0


if __name__ == "__main__":
    sys.exit(main())
