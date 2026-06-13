import unittest
import logging

from matrix_bridge.bridge import MatrixBridge


class TestTaskboardActionCapture(unittest.TestCase):
    def setUp(self):
        # Use dry_run mock bridge to avoid real Matrix/Kafka interaction
        self.bridge = MatrixBridge(config={}, dry_run=True, kafka_client=None)

    def test_valid_taskboard_action(self):
        msg = {
            'event_id': '$evt1',
            'sender': '@alice:example',
            'type': 'ai.dev.taskboard.action',
            'content': {
                'taskId': 'TASK-1',
                'decision': 'approved',
                'policy': 'push',
                'selectedAction': {},
                'editedAction': None,
                'newAction': None,
                'notes': 'looks good',
                'source': 'element-widget',
                'createdAt': '2026-06-13T19:00:00Z',
            },
        }
        with self.assertLogs('matrix_bridge.bridge', level='INFO') as cm:
            res = self.bridge._process_incoming_matrix_messages([msg])
        # The bridge should not publish or return an ApprovalResponse for this capture-only event
        self.assertIsNone(res)
        # Check that the expected log message was emitted
        joined = "\n".join(cm.output)
        self.assertIn('Taskboard action received taskId=TASK-1 decision=approved', joined)

    def test_invalid_taskboard_action_missing_taskid(self):
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
        joined = "\n".join(cm.output)
        self.assertIn('Ignored invalid taskboard action', joined)


if __name__ == '__main__':
    unittest.main()
