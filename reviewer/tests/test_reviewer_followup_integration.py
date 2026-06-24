import unittest
import logging

from reviewer.service import Reviewer


class DummyKafka:
    def __init__(self):
        self.published = []

    def publish(self, topic, payload):
        self.published.append((topic, payload))
        return True, {"dry_run": True}


class TestReviewerFollowupIntegration(unittest.TestCase):
    def setUp(self):
        # ensure logger level is INFO for capture
        logging.getLogger('reviewer.service').setLevel(logging.INFO)

    def test_executed_result_generates_followup(self):
        kafka = DummyKafka()
        rev = Reviewer(dry_run=True, kafka_client=kafka)
        result = {
            "taskId": "SDK-1",
            "conversationId": "conv-123",
            "status": "executed",
            "responsePreview": "Created SDK executor and verified execution.",
            "summary": "SDK created"
        }

        with self.assertLogs('reviewer.service', level='INFO') as cm:
            review = rev.handle(result)

        # Ensure review returned as expected
        self.assertEqual(review.taskId, 'SDK-1')
        # Ensure auto-followup log was emitted
        logs = "\n".join(cm.output)
        self.assertIn('Auto-followup suggestion generated', logs)
        self.assertIn('Validate SDK executor through Kafka', logs)

    def test_failed_result_generates_investigation(self):
        kafka = DummyKafka()
        rev = Reviewer(dry_run=True, kafka_client=kafka)
        result = {
            "taskId": "T-FAIL",
            "conversationId": "conv-fail",
            "status": "failed",
            "responsePreview": "Traceback (most recent call last): ...",
            "summary": "RuntimeError during execution"
        }

        with self.assertLogs('reviewer.service', level='INFO') as cm:
            review = rev.handle(result)

        logs = "\n".join(cm.output)
        # Suggest investigation
        self.assertIn('Auto-followup suggestion generated', logs)
        self.assertIn('Investigate failed execution', logs)

    def test_missing_data_does_not_generate_followup(self):
        kafka = DummyKafka()
        rev = Reviewer(dry_run=True, kafka_client=kafka)
        # Completed but missing responsePreview and summary
        result = {
            "taskId": "T-NA",
            "conversationId": "conv-na",
            "status": "completed",
            "summary": "",
            "responsePreview": "",
        }

        with self.assertLogs('reviewer.service', level='INFO') as cm:
            review = rev.handle(result)

        logs = "\n".join(cm.output)
        self.assertNotIn('Auto-followup suggestion generated', logs)
        # Ensure normal classification still happened
        self.assertEqual(review.classification, 'completed')


if __name__ == '__main__':
    unittest.main()
