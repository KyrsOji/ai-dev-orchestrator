import json
import os
import subprocess
import sys
import tempfile
import unittest

SCRIPT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "review_followup.py")
PY = sys.executable


class TestReviewFollowupCLI(unittest.TestCase):
    def test_approve_records_decision(self):
        with tempfile.TemporaryDirectory() as td:
            followups = os.path.join(td, "followups.jsonl")
            decisions = os.path.join(td, "decisions.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = followups
            os.environ["FOLLOWUP_DECISIONS_FILE"] = decisions
            from reviewer import followup_store

            stored = followup_store.append_suggestion({"parentTaskId": "P1", "title": "T1", "description": "D1", "reason": "R1", "source": "auto"})
            sid = stored["suggestionId"]
            proc = subprocess.run([PY, SCRIPT, "--approve", sid, "--file", followups, "--decisions-file", decisions], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0)
            # decisions file should contain one line
            with open(decisions, "r", encoding="utf-8") as fh:
                lines = [l.strip() for l in fh if l.strip()]
            self.assertEqual(len(lines), 1)
            dec = json.loads(lines[0])
            self.assertEqual(dec.get("suggestionId"), sid)
            self.assertEqual(dec.get("decision"), "approved")
            self.assertEqual(dec.get("source"), "manual-review")
            self.assertIn("decidedAt", dec)

    def test_reject_records_decision(self):
        with tempfile.TemporaryDirectory() as td:
            followups = os.path.join(td, "followups.jsonl")
            decisions = os.path.join(td, "decisions.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = followups
            os.environ["FOLLOWUP_DECISIONS_FILE"] = decisions
            from reviewer import followup_store

            stored = followup_store.append_suggestion({"parentTaskId": "P2", "title": "T2", "description": "D2", "reason": "R2", "source": "auto"})
            sid = stored["suggestionId"]
            proc = subprocess.run([PY, SCRIPT, "--reject", sid, "--file", followups, "--decisions-file", decisions], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0)
            with open(decisions, "r", encoding="utf-8") as fh:
                lines = [l.strip() for l in fh if l.strip()]
            self.assertEqual(len(lines), 1)
            dec = json.loads(lines[0])
            self.assertEqual(dec.get("suggestionId"), sid)
            self.assertEqual(dec.get("decision"), "rejected")

    def test_list_pending_excludes_decided(self):
        with tempfile.TemporaryDirectory() as td:
            followups = os.path.join(td, "followups.jsonl")
            decisions = os.path.join(td, "decisions.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = followups
            os.environ["FOLLOWUP_DECISIONS_FILE"] = decisions
            from reviewer import followup_store

            s1 = followup_store.append_suggestion({"parentTaskId": "A", "title": "a", "description": "d", "reason": "r", "source": "auto"})
            s2 = followup_store.append_suggestion({"parentTaskId": "B", "title": "b", "description": "d", "reason": "r", "source": "auto"})
            # Approve s1
            proc = subprocess.run([PY, SCRIPT, "--approve", s1["suggestionId"], "--file", followups, "--decisions-file", decisions], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0)
            # List pending as JSON
            proc2 = subprocess.run([PY, SCRIPT, "--list-pending", "--file", followups, "--decisions-file", decisions, "--json"], capture_output=True, text=True)
            self.assertEqual(proc2.returncode, 0)
            arr = json.loads(proc2.stdout)
            # Only s2 should be present
            self.assertEqual(len(arr), 1)
            self.assertEqual(arr[0]["suggestionId"], s2["suggestionId"])


if __name__ == '__main__':
    unittest.main()
