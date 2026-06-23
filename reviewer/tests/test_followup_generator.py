import unittest

from reviewer import followup_generator


class TestFollowupGenerator(unittest.TestCase):
    def test_completed_sdk_executor(self):
        result = {
            "taskId": "SDK-1",
            "conversationId": "conv-123",
            "status": "completed",
            "responsePreview": "Created SDK executor and verified execution.",
            "summary": "SDK created"
        }
        followup = followup_generator.generate_followup(result)
        self.assertIsNotNone(followup)
        self.assertEqual(followup.get("parentTaskId"), "SDK-1")
        self.assertEqual(followup.get("conversationId"), "conv-123")
        self.assertEqual(followup.get("title"), "Validate SDK executor through Kafka")
        self.assertIn("Execution implementation completed", followup.get("reason"))

    def test_failed_task(self):
        result = {
            "taskId": "T-FAIL",
            "conversationId": "conv-fail",
            "status": "failed",
            "responsePreview": "Traceback (most recent call last): ...",
            "summary": "RuntimeError during execution"
        }
        followup = followup_generator.generate_followup(result)
        self.assertIsNotNone(followup)
        self.assertEqual(followup.get("parentTaskId"), "T-FAIL")
        self.assertEqual(followup.get("conversationId"), "conv-fail")
        self.assertEqual(followup.get("title"), "Investigate failed execution")
        self.assertTrue(followup.get("reason", "").startswith("Execution failed:"))

    def test_missing_response_preview(self):
        result = {
            "taskId": "T-MISS",
            "conversationId": "conv-miss",
            "status": "completed",
            "responsePreview": "",
            "summary": "No output produced"
        }
        followup = followup_generator.generate_followup(result)
        self.assertIsNotNone(followup)
        self.assertEqual(followup.get("parentTaskId"), "T-MISS")
        self.assertEqual(followup.get("title"), "Review execution output")
        self.assertIn("Missing responsePreview", followup.get("reason"))


if __name__ == "__main__":
    unittest.main()
