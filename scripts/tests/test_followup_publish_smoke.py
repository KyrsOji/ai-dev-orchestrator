import json
import os
import subprocess
import sys
import tempfile
import unittest

PY = sys.executable
SCRIPT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "publish_followups.py")


class TestFollowupPublishSmoke(unittest.TestCase):
    def test_full_smoke_sequence(self):
        with tempfile.TemporaryDirectory() as td:
            sfile = os.path.join(td, "followups.jsonl")
            dfile = os.path.join(td, "decisions.jsonl")
            pfile = os.path.join(td, "published.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = sfile
            os.environ["FOLLOWUP_DECISIONS_FILE"] = dfile
            os.environ["FOLLOWUP_PUBLISHED_FILE"] = pfile

            # Append suggestion
            from reviewer import followup_store, followup_approval, followup_publisher

            stored = followup_store.append_suggestion({
                "parentTaskId": "SMOKE-TEST-1",
                "conversationId": "conv-smoke-1",
                "title": "Smoke test publish",
                "description": "Verify publish CLI and duplicate prevention",
                "reason": "Smoke test",
                "source": "auto-followup",
            })
            sid = stored.get("suggestionId")
            self.assertIsNotNone(sid)

            # Approve suggestion
            dec = followup_approval.approve_suggestion(sid)
            self.assertEqual(dec.get("suggestionId"), sid)
            self.assertEqual(dec.get("decision"), "approved")

            # Run CLI dry-run
            proc = subprocess.run([PY, SCRIPT, "--dry-run", "--file", sfile, "--decisions-file", dfile, "--published-file", pfile, "--limit", "10"], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, msg=f"dry-run failed: {proc.stderr}")
            # Dry-run should print JSON lines
            out_lines = [l for l in proc.stdout.splitlines() if l.strip()]
            self.assertGreaterEqual(len(out_lines), 1)
            payload = json.loads(out_lines[0])
            self.assertEqual(payload.get("source"), "auto-followup")
            self.assertTrue(payload.get("approvalRequired") is True)
            self.assertEqual(payload.get("suggestionId"), sid)

            # Fake publish using followup_publisher
            called = {}

            def fake_pub(payload, topic=None):
                called["payload"] = payload
                called["topic"] = topic
                return True, {"fake": True}

            ok, meta = followup_publisher.publish_approved_suggestion(stored, publisher=fake_pub, topic="ai.dev.approval.required")
            self.assertTrue(ok)
            self.assertIn("published_record", meta)
            self.assertEqual(called.get("topic"), "ai.dev.approval.required")
            self.assertEqual(called.get("payload").get("suggestionId"), sid)

            # Published file should have one line with suggestionId
            with open(pfile, "r", encoding="utf-8") as fh:
                lines = [l.strip() for l in fh if l.strip()]
            self.assertEqual(len(lines), 1)
            rec = json.loads(lines[0])
            self.assertEqual(rec.get("suggestionId"), sid)

            # Duplicate publish should be prevented
            ok2, meta2 = followup_publisher.publish_approved_suggestion(stored, publisher=fake_pub, topic="ai.dev.approval.required")
            self.assertFalse(ok2)
            self.assertEqual(meta2.get("error"), "already_published")


if __name__ == '__main__':
    unittest.main()
