import json
import os
import subprocess
import sys
import tempfile
import unittest

from reviewer import followup_store, followup_approval, followup_publisher

PY = sys.executable
SCRIPT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "publish_followups.py")


class TestFollowupPublisher(unittest.TestCase):
    def test_approved_suggestion_returned_and_rejected_skipped(self):
        with tempfile.TemporaryDirectory() as td:
            sfile = os.path.join(td, "followups.jsonl")
            dfile = os.path.join(td, "decisions.jsonl")
            pfile = os.path.join(td, "published.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = sfile
            os.environ["FOLLOWUP_DECISIONS_FILE"] = dfile
            os.environ["FOLLOWUP_PUBLISHED_FILE"] = pfile

            s1 = followup_store.append_suggestion({"parentTaskId": "A", "title": "a", "description": "a", "reason": "r", "source": "auto"})
            s2 = followup_store.append_suggestion({"parentTaskId": "B", "title": "b", "description": "b", "reason": "r", "source": "auto"})
            s3 = followup_store.append_suggestion({"parentTaskId": "C", "title": "c", "description": "c", "reason": "r", "source": "auto"})

            # Approve s1, reject s2, leave s3 pending
            followup_approval.approve_suggestion(s1["suggestionId"])
            followup_approval.reject_suggestion(s2["suggestionId"])

            approved = followup_publisher.get_approved_suggestions(limit=None)
            ids = [s["suggestionId"] for s in approved]
            self.assertIn(s1["suggestionId"], ids)
            self.assertNotIn(s2["suggestionId"], ids)
            self.assertNotIn(s3["suggestionId"], ids)

    def test_publish_and_duplicate_prevented_and_published_file_written(self):
        with tempfile.TemporaryDirectory() as td:
            sfile = os.path.join(td, "followups.jsonl")
            dfile = os.path.join(td, "decisions.jsonl")
            pfile = os.path.join(td, "published.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = sfile
            os.environ["FOLLOWUP_DECISIONS_FILE"] = dfile
            os.environ["FOLLOWUP_PUBLISHED_FILE"] = pfile

            s1 = followup_store.append_suggestion({"parentTaskId": "A", "title": "a", "description": "a", "reason": "r", "source": "auto"})
            followup_approval.approve_suggestion(s1["suggestionId"])

            # Fake publisher that pretends to succeed
            called = {}

            def fake_pub(payload, topic=None):
                called["payload"] = payload
                called["topic"] = topic
                return True, {"fake": True}

            ok, meta = followup_publisher.publish_approved_suggestion(s1, publisher=fake_pub, topic="ai.dev.approval.required")
            self.assertTrue(ok)
            # published file should contain a record
            with open(pfile, "r", encoding="utf-8") as fh:
                lines = [l.strip() for l in fh if l.strip()]
            self.assertEqual(len(lines), 1)
            rec = json.loads(lines[0])
            self.assertEqual(rec.get("suggestionId"), s1["suggestionId"])

            # Duplicate publish should be prevented
            ok2, meta2 = followup_publisher.publish_approved_suggestion(s1, publisher=fake_pub, topic="ai.dev.approval.required")
            self.assertFalse(ok2)
            self.assertEqual(meta2.get("error"), "already_published")

    def test_dry_run_publishes_nothing(self):
        # Use CLI dry-run to ensure no published file is written
        with tempfile.TemporaryDirectory() as td:
            sfile = os.path.join(td, "followups.jsonl")
            dfile = os.path.join(td, "decisions.jsonl")
            pfile = os.path.join(td, "published.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = sfile
            os.environ["FOLLOWUP_DECISIONS_FILE"] = dfile
            os.environ["FOLLOWUP_PUBLISHED_FILE"] = pfile

            s1 = followup_store.append_suggestion({"parentTaskId": "A", "title": "a", "description": "a", "reason": "r", "source": "auto"})
            followup_approval.approve_suggestion(s1["suggestionId"])

            proc = subprocess.run([PY, SCRIPT, "--dry-run", "--file", sfile], capture_output=True, text=True)
            # Since --file option in script is not implemented, we still set env var above; command should succeed
            self.assertEqual(proc.returncode, 0)
            # published file should not exist or be empty
            self.assertFalse(os.path.exists(pfile))


if __name__ == '__main__':
    unittest.main()
