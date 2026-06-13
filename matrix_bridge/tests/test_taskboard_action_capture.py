import unittest
import logging

from matrix_bridge.bridge import MatrixBridge


class TestTaskboardActionCapture(unittest.TestCase):
    def setUp(self):
        # Prepare a dummy kafka client to capture publishes
        class DummyKafkaClient:
            def __init__(self):
                self.published = []

            def publish(self, topic, message):
                self.published.append((topic, message))
                return True, {"dummy": True}

        self.dummy_kafka = DummyKafkaClient()
        # Use dry_run mock bridge but inject our dummy kafka client for assertions
        self.bridge = MatrixBridge(config={}, dry_run=True, kafka_client=self.dummy_kafka)

    def test_valid_taskboard_action_publishes(self):
        msg = {
            'event_id': '$evt1',
            'sender': '@alice:example',
            'type': 'ai.dev.taskboard.action',
            'content': {
                'taskId': 'TASK-1',
                'decision': 'approved',
                'policy': 'push',
                'selectedAction': {'id': 'act-1'},
                'editedAction': None,
                'newAction': None,
                'notes': 'looks good',
                'source': 'element-widget',
                'createdAt': '2026-06-13T19:00:00Z',
            },
        }
        with self.assertLogs('matrix_bridge.bridge', level='INFO') as cm:
            res = self.bridge._process_incoming_matrix_messages([msg])
        # The bridge should consume the event and not return an ApprovalResponse
        self.assertIsNone(res)
        # Ensure a Kafka publish occurred
        self.assertEqual(len(self.dummy_kafka.published), 1)
        topic, payload = self.dummy_kafka.published[0]
        self.assertEqual(topic, 'ai.dev.review.out')
        self.assertEqual(payload.get('taskId'), 'TASK-1')
        self.assertEqual(payload.get('decision'), 'approved')
        self.assertEqual(payload.get('policy'), 'push')
        self.assertEqual(payload.get('approver'), '@alice:example')
        # Check logs include publishing notice
        joined = "\n".join(cm.output)
        self.assertIn('Publishing taskboard action taskId=TASK-1 decision=approved', joined)

    def test_valid_edited_taskboard_action_publishes(self):
        msg = {
            'event_id': '$evt3',
            'sender': '@carol:example',
            'type': 'ai.dev.taskboard.action',
            'content': {
                'taskId': 'TASK-2',
                'decision': 'edited',
                'policy': 'docs',
                'selectedAction': {},
                'editedAction': {'id': 'act-2', 'description': 'fix docs'},
                'newAction': None,
                'notes': 'edit applied',
                'source': 'element-widget',
                'createdAt': '2026-06-13T19:05:00Z',
            },
        }
        with self.assertLogs('matrix_bridge.bridge', level='INFO') as cm:
            res = self.bridge._process_incoming_matrix_messages([msg])
        self.assertIsNone(res)
        self.assertEqual(len(self.dummy_kafka.published), 1)
        topic, payload = self.dummy_kafka.published[0]
        self.assertEqual(topic, 'ai.dev.review.out')
        self.assertEqual(payload.get('taskId'), 'TASK-2')
        self.assertEqual(payload.get('decision'), 'edited')
        self.assertEqual(payload.get('policy'), 'docs')
        self.assertEqual(payload.get('approver'), '@carol:example')

    def test_invalid_taskboard_action_missing_taskid_does_not_publish(self):
        msg = {
            'event_id': '$evt2',
            'sender': '@bob:example',
            'type': 'ai.dev.taskboard.action',
            'content': {
                'decision': 'approved',
                'policy': 'push',
                'source': 'element-widget',
            },
        }
        with self.assertLogs('matrix_bridge.bridge', level='WARNING') as cm:
            res = self.bridge._process_incoming_matrix_messages([msg])
        self.assertIsNone(res)
        # Ensure no kafka publish occurred
        self.assertEqual(len(self.dummy_kafka.published), 0)
        joined = "\n".join(cm.output)
        self.assertIn('Ignored invalid taskboard action', joined)


if __name__ == '__main__':
    unittest.main()
