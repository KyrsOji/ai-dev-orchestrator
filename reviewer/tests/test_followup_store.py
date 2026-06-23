import os
import json
import tempfile
import unittest
from reviewer import followup_store


class TestFollowupStore(unittest.TestCase):
    def test_append_suggestion_writes_and_returns_ids(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "followups.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = path
            suggestion = {
                "parentTaskId": "P1",
                "conversationId": "C1",
                "title": "T1",
                "description": "D1",
                "reason": "R1",
                "source": "auto-followup",
            }
            stored = followup_store.append_suggestion(suggestion)
            self.assertIn("suggestionId", stored)
            self.assertIn("generatedAt", stored)
            # Read file
            with open(path, "r", encoding="utf-8") as fh:
                lines = [l.strip() for l in fh if l.strip()]
            self.assertEqual(len(lines), 1)
            loaded = json.loads(lines[0])
            self.assertEqual(loaded["suggestionId"], stored["suggestionId"])
            self.assertEqual(loaded["parentTaskId"], "P1")

    def test_list_suggestions_returns_newest_first(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "followups.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = path
            s1 = followup_store.append_suggestion({"parentTaskId": "A", "title": "a", "description": "a", "reason": "r", "source": "auto"})
            s2 = followup_store.append_suggestion({"parentTaskId": "B", "title": "b", "description": "b", "reason": "r", "source": "auto"})
            items = followup_store.list_suggestions(limit=10)
            self.assertEqual(len(items), 2)
            # newest first -> s2 then s1
            self.assertEqual(items[0]["parentTaskId"], "B")
            self.assertEqual(items[1]["parentTaskId"], "A")

    def test_missing_file_returns_empty_list(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "nonexistent.jsonl")
            # Ensure file doesn't exist
            if os.path.exists(path):
                os.remove(path)
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = path
            items = followup_store.list_suggestions()
            self.assertEqual(items, [])

    def test_malformed_jsonl_line_is_ignored(self):
        with tempfile.TemporaryDirectory() as td:
            path = os.path.join(td, "followups.jsonl")
            os.environ["FOLLOWUP_SUGGESTIONS_FILE"] = path
            # write a good line, a bad line, and another good line
            good1 = {"parentTaskId": "X", "title": "x"}
            good2 = {"parentTaskId": "Y", "title": "y"}
            with open(path, "w", encoding="utf-8") as fh:
                fh.write(json.dumps(good1, ensure_ascii=False) + "\n")
                fh.write("not a json\n")
                fh.write(json.dumps(good2, ensure_ascii=False) + "\n")
            items = followup_store.list_suggestions(limit=10)
            # Should ignore malformed; return 2 items newest first
            self.assertEqual(len(items), 2)
            self.assertEqual(items[0]["parentTaskId"], "Y")
            self.assertEqual(items[1]["parentTaskId"], "X")


if __name__ == "__main__":
    unittest.main()
