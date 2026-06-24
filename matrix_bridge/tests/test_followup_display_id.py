import unittest
import json
import re

from matrix_bridge.bridge import MatrixBridge


class TestFollowupDisplayId(unittest.TestCase):
    def setUp(self):
        class DummyKafkaClient:
            def __init__(self):
                self.published = []

            def publish(self, topic, message):
                self.published.append((topic, message))
                return True, {"dummy": True}

        self.dummy_kafka = DummyKafkaClient()

    def test_taskid_preserved(self):
        class DummyMatrix:
            def __init__(self):
                self.posts = []

            def post_message(self, content):
                parsed = {"event_id": "$evt-task"}
                self.posts.append(content)
                return True, parsed, {}

        bridge = MatrixBridge(config={}, dry_run=True, kafka_client=self.dummy_kafka)
        bridge.matrix = DummyMatrix()
        bridge.matrix_room = "!test:example"

        task = {"taskId": "TASK-1", "title": "Normal Task", "metadata": {"k": "v"}}
        bridge.post_task_summary(task)
        bridge.post_approval_request(task)

        self.assertEqual(bridge.matrix.posts[0], "Task TASK-1 - Normal Task")
        self.assertIn("Approval request for task TASK-1: Normal Task", bridge.matrix.posts[1])
        # Mapping should use real taskId
        self.assertIn("$evt-task", bridge._approval_event_to_task)
        self.assertEqual(bridge._approval_event_to_task["$evt-task"], "TASK-1")
        self.assertEqual(bridge._task_to_approval_event.get("TASK-1"), "$evt-task")
        pending = bridge._pending_approvals.get(bridge.matrix_room)
        self.assertTrue(pending and pending[0]["taskId"] == "TASK-1")

    def test_suggestionid_fallback(self):
        class DummyMatrix2:
            def __init__(self):
                self.posts = []
                self.counter = 0

            def post_message(self, content):
                self.counter += 1
                evt = f"$evt-sug{self.counter}"
                self.posts.append(content)
                return True, {"event_id": evt}, {}

        bridge = MatrixBridge(config={}, dry_run=True, kafka_client=self.dummy_kafka)
        bridge.matrix = DummyMatrix2()
        bridge.matrix_room = "!test:example"

        task = {
            "suggestionId": "SUG-1",
            "parentTaskId": "PARENT-1",
            "conversationId": "conv1",
            "source": "auto-followup",
            "title": "Followup Title",
            "metadata": None,
        }
        bridge.post_task_summary(task)
        bridge.post_approval_request(task)

        self.assertEqual(bridge.matrix.posts[0], "Task SUG-1 - Followup Title")
        body = bridge.matrix.posts[1]
        self.assertIn("Approval request for task SUG-1: Followup Title", body)
        m = re.search(r"metadata=(\{.*\})", body)
        self.assertIsNotNone(m, "metadata JSON not found in body")
        meta = json.loads(m.group(1))
        self.assertEqual(meta.get("suggestionId"), "SUG-1")
        self.assertEqual(meta.get("parentTaskId"), "PARENT-1")
        self.assertEqual(meta.get("conversationId"), "conv1")
        self.assertEqual(meta.get("source"), "auto-followup")
        # Mapping should use suggestionId as display id (any event mapped to SUG-1 is acceptable)
        found = False
        for k, v in bridge._approval_event_to_task.items():
            if v == "SUG-1":
                found = True
                break
        self.assertTrue(found, f"No approval event mapped to SUG-1; mappings={bridge._approval_event_to_task}")
        pending = bridge._pending_approvals.get(bridge.matrix_room)
        self.assertTrue(pending and pending[0]["taskId"] == "SUG-1")

    def test_parenttaskid_fallback(self):
        class DummyMatrix3:
            def __init__(self):
                self.posts = []

            def post_message(self, content):
                self.posts.append(content)
                return True, {"event_id": "$evt-parent"}, {}

        bridge = MatrixBridge(config={}, dry_run=True, kafka_client=self.dummy_kafka)
        bridge.matrix = DummyMatrix3()
        bridge.matrix_room = "!test:example"

        task = {"parentTaskId": "PARENT-ONLY", "title": "Parent Only Title"}
        bridge.post_task_summary(task)
        bridge.post_approval_request(task)

        self.assertEqual(bridge.matrix.posts[0], "Task PARENT-ONLY - Parent Only Title")
        self.assertIn("Approval request for task PARENT-ONLY: Parent Only Title", bridge.matrix.posts[1])
        self.assertIn("$evt-parent", bridge._approval_event_to_task)
        self.assertEqual(bridge._approval_event_to_task["$evt-parent"], "PARENT-ONLY")


if __name__ == '__main__':
    unittest.main()
