import json
import os
import subprocess
import sys
import tempfile
import unittest


SCRIPT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "list_followup_suggestions.py")
PY = sys.executable


class TestListFollowupCLI(unittest.TestCase):
    def test_human_output_one_suggestion(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "followups.jsonl")
            # Use followup_store to append a suggestion so it has generatedAt and suggestionId
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = path
            from reviewer import followup_store

            stored = followup_store.append_suggestion({
                "parentTaskId": "P1",
                "conversationId": "C1",
                "title": "T1",
                "description": "D1",
                "reason": "R1",
                "source": "auto-followup",
            })

            # Run the script
            proc = subprocess.run([PY, SCRIPT, "--file", path], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0)
            out = proc.stdout.strip()
            self.assertIn(stored["suggestionId"], out)
            self.assertIn(stored["parentTaskId"], out)
            self.assertIn(stored["conversationId"], out)

    def test_json_output(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "followups.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = path
            from reviewer import followup_store

            s1 = followup_store.append_suggestion({"parentTaskId": "A", "conversationId": "CA", "title": "a", "description": "a", "reason": "r", "source": "auto"})
            s2 = followup_store.append_suggestion({"parentTaskId": "B", "conversationId": "CB", "title": "b", "description": "b", "reason": "r", "source": "auto"})

            proc = subprocess.run([PY, SCRIPT, "--file", path, "--json"], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0)
            arr = json.loads(proc.stdout)
            # newest first -> s2 then s1
            self.assertEqual(arr[0]["parentTaskId"], "B")
            self.assertEqual(arr[1]["parentTaskId"], "A")

    def test_missing_file_returns_empty(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "missing.jsonl")
            if os.path.exists(path):
                os.remove(path)
            proc = subprocess.run([PY, SCRIPT, "--file", path, "--json"], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0)
            out = proc.stdout.strip()
            # empty array
            self.assertIn(out, ["[]", ""])

    def test_limit_works(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "followups.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = path
            from reviewer import followup_store
            # create 5 suggestions
            for i in range(5):
                followup_store.append_suggestion({"parentTaskId": f"T{i}", "title": str(i), "description": "d", "reason": "r", "source": "auto"})

            proc = subprocess.run([PY, SCRIPT, "--file", path, "--limit", "2", "--json"], capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0)
            arr = json.loads(proc.stdout)
            self.assertEqual(len(arr), 2)


if __name__ == '__main__':
    unittest.main()
