#!/usr/bin/env python3
"""
Simple HTTP API that exposes aggregated tasks produced by task_aggregator.py.

Endpoints:
 - GET /tasks
 - GET /task/<taskId>

The aggregator runs in-process (background thread) when possible.
"""

import os
import threading
import logging
from flask import Flask, jsonify, abort

# Import aggregator
try:
    from task_aggregator import TaskAggregator
    KAFKA_AVAILABLE = True
except Exception:
    # If import fails, provide a minimal stub aggregator
    KAFKA_AVAILABLE = False

    class TaskAggregator:
        def __init__(self, *a, **kw):
            self.tasks = {}
        def start(self):
            pass
        def get_all_tasks(self):
            return list(self.tasks.values())
        def get_task(self, task_id):
            return self.tasks.get(task_id)

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)

agg = TaskAggregator()
# start aggregator in background
try:
    agg.start()
except Exception:
    logging.exception('Failed to start aggregator')

@app.route('/tasks', methods=['GET'])
def get_tasks():
    tasks = agg.get_all_tasks() or []
    # Normalize to feed contract
    out = []
    for t in tasks:
        out.append({
            'taskId': t.get('taskId'),
            'status': t.get('status', 'pending_review'),
            'approvalRequired': bool(t.get('approvalRequired', False)),
            'openhandsResponse': t.get('openhandsResponse'),
            'reviewerSummary': t.get('reviewerSummary'),
            'proposedAction': t.get('proposedAction'),
            'lastUpdated': t.get('lastUpdated')
        })
    return jsonify(out)

@app.route('/task/<task_id>', methods=['GET'])
def get_task(task_id):
    t = agg.get_task(task_id)
    if not t:
        abort(404)
    out = {
        'taskId': t.get('taskId'),
        'status': t.get('status', 'pending_review'),
        'approvalRequired': bool(t.get('approvalRequired', False)),
        'openhandsResponse': t.get('openhandsResponse'),
        'reviewerSummary': t.get('reviewerSummary'),
        'proposedAction': t.get('proposedAction'),
        'latestReviewerDecision': t.get('latestReviewerDecision'),
        'lastUpdated': t.get('lastUpdated')
    }
    return jsonify(out)

@app.route('/health')
def health():
    return 'ok'

if __name__ == '__main__':
    # Default to binding to localhost:8000
    port = int(os.environ.get('TASKBOARD_API_PORT', '8000'))
    app.run(host='127.0.0.1', port=port)
