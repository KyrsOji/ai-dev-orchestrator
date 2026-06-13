#!/usr/bin/env python3
"""
Task Aggregator

Consumes existing Kafka topics and builds an in-memory read model of tasks for
the Taskboard UI to consume. This is intentionally lightweight and has no
persistence; it is a read-model only service.

Topics consumed (default):
 - ai.dev.approval.required
 - ai.dev.review.out
 - ai.dev.task.ofbiz
 - ai.dev.result.out

The aggregator tries to infer a minimal, stable task view for each observed
`taskId` and exposes programmatic access through get_all_tasks/get_task.

Note: This module will run even if confluent_kafka is not installed, but
it will only start a Kafka consumer loop if confluent_kafka is available.
"""

import os
import time
import json
import threading
import logging
import datetime
import traceback

try:
    from confluent_kafka import Consumer
    KAFKA_AVAILABLE = True
except Exception:
    KAFKA_AVAILABLE = False


class TaskAggregator:
    def __init__(self, bootstrap=None, topics=None, group_id=None, poll_interval=1.0):
        self.bootstrap = bootstrap or os.environ.get('KAFKA_BOOTSTRAP', 'kafka.yahlife.com:9095')
        self.topics = topics or [
            'ai.dev.approval.required',
            'ai.dev.review.out',
            'ai.dev.task.ofbiz',
            'ai.dev.result.out',
        ]
        self.group_id = group_id or 'taskboard-aggregator'
        self.poll_interval = poll_interval
        self.tasks = {}
        self.lock = threading.RLock()
        self.running = False
        self.consumer = None
        logging.basicConfig(level=logging.INFO)

    def start(self):
        """Start the Kafka consumer loop (if confluent_kafka is available).
        This will spawn a background thread that listens for messages.
        """
        if not KAFKA_AVAILABLE:
            logging.warning('confluent_kafka not available; aggregator will not connect to Kafka.')
            return

        conf = {
            'bootstrap.servers': self.bootstrap,
            'group.id': self.group_id,
            'auto.offset.reset': 'earliest',
            'enable.auto.commit': True,
        }

        try:
            self.consumer = Consumer(conf)
            self.consumer.subscribe(self.topics)
            self.running = True
            t = threading.Thread(target=self._consume_loop, daemon=True)
            t.start()
            logging.info('TaskAggregator started; subscribed to %s', ','.join(self.topics))
        except Exception:
            logging.exception('Failed to start Kafka consumer')

    def stop(self):
        self.running = False
        try:
            if self.consumer:
                self.consumer.close()
        except Exception:
            pass

    def _consume_loop(self):
        while self.running:
            try:
                msg = self.consumer.poll(timeout=self.poll_interval)
                if msg is None:
                    continue
                if msg.error():
                    logging.warning('Consumer error: %s', msg.error())
                    continue
                topic = msg.topic()
                raw = msg.value()
                payload = None
                try:
                    if isinstance(raw, (bytes, bytearray)):
                        payload = json.loads(raw.decode('utf-8'))
                    elif isinstance(raw, str):
                        payload = json.loads(raw)
                    else:
                        payload = raw
                except Exception:
                    logging.exception('Failed to parse message payload on topic %s', topic)
                    continue

                self._handle_message(topic, payload)
            except Exception:
                logging.exception('Error in consume loop')
                time.sleep(1)

    def _handle_message(self, topic, payload):
        try:
            if not isinstance(payload, dict):
                logging.debug('Ignoring non-dict payload for topic %s', topic)
                return

            task_id = payload.get('taskId') or payload.get('task_id') or payload.get('id')
            if not task_id:
                logging.debug('Message missing taskId; ignoring: %s', payload)
                return

            with self.lock:
                current = self.tasks.get(task_id, {
                    'taskId': task_id,
                    'title': payload.get('title'),
                    'status': 'pending_review',
                    'approvalRequired': False,
                    'openhandsResponse': None,
                    'reviewerSummary': None,
                    'proposedAction': None,
                    'latestReviewerDecision': None,
                    'lastUpdated': None,
                })

                now = datetime.datetime.utcnow().isoformat() + 'Z'

                if topic == 'ai.dev.approval.required':
                    current['approvalRequired'] = True
                    current['title'] = payload.get('title') or current.get('title')
                    current['openhandsResponse'] = payload.get('openhandsResult') or payload.get('openhandsResult') or current.get('openhandsResponse')
                    current['reviewerSummary'] = payload.get('reviewerSummary') or current.get('reviewerSummary')
                    # proposedAction may be a single object, or list under proposedActions
                    pa = payload.get('proposedAction') or (payload.get('proposedActions') and payload.get('proposedActions')[0])
                    if pa:
                        current['proposedAction'] = pa
                    current['status'] = current.get('status') or 'pending_review'
                    current['lastUpdated'] = now

                elif topic == 'ai.dev.review.out':
                    # review decisions
                    current['latestReviewerDecision'] = payload
                    decision = payload.get('decision') or payload.get('status') or payload.get('result')
                    if decision:
                        if decision in ('approved', 'approve', 'ok', 'accepted'):
                            current['status'] = 'approved'
                        elif decision in ('denied', 'deny', 'rejected'):
                            current['status'] = 'denied'
                        elif decision in ('deferred', 'defer'):
                            current['status'] = 'deferred'
                        elif decision in ('completed', 'success'):
                            current['status'] = 'completed'
                    current['lastUpdated'] = now

                elif topic == 'ai.dev.task.ofbiz':
                    # orchestrator state snapshot
                    status = payload.get('status') or payload.get('state') or payload.get('taskStatus')
                    if status:
                        current['status'] = status
                    current['title'] = payload.get('title') or current.get('title')
                    current['proposedAction'] = payload.get('proposedAction') or current.get('proposedAction')
                    current['lastUpdated'] = now

                elif topic == 'ai.dev.result.out':
                    result_status = payload.get('status') or payload.get('result') or payload.get('outcome')
                    if result_status in ('completed', 'success'):
                        current['status'] = 'completed'
                    elif result_status in ('failed', 'error'):
                        current['status'] = 'failed'
                    current['lastUpdated'] = now

                # save
                self.tasks[task_id] = current
        except Exception:
            logging.exception('Exception while handling message: %s', payload)

    def get_all_tasks(self):
        with self.lock:
            # return stable list copy
            return [json.loads(json.dumps(t)) for t in self.tasks.values()]

    def get_task(self, task_id):
        with self.lock:
            t = self.tasks.get(task_id)
            return json.loads(json.dumps(t)) if t is not None else None


if __name__ == '__main__':
    agg = TaskAggregator()
    agg.start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        agg.stop()
