#!/usr/bin/env python3
"""
Simple HTTP API that exposes aggregated tasks produced by task_aggregator.py.

Endpoints:
 - GET /tasks
 - GET /task/<taskId>

The aggregator runs in-process (background thread) when possible.
"""

import os
import time
import json
import threading
import logging
import queue
from flask import Flask, jsonify, abort, Response, stream_with_context, request

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


# --- Server-Sent Events (SSE) implementation for live updates
# Publishes events: tasks, task, followups, agents, runner, log, heartbeat

sse_clients = {}
sse_clients_lock = threading.Lock()
sse_next_client_id = 1

prev_tasks_by_id = {}
prev_task_ids_set = set()
prev_followups_json = None
prev_agents_json = None
prev_runner_json = None

def _format_sse(event, payload):
    try:
        data = json.dumps(payload, default=str)
    except Exception:
        data = json.dumps(str(payload))
    if event:
        return f"event: {event}\n" + f"data: {data}\n\n"
    return f"data: {data}\n\n"


def broadcast_event(event, payload, taskId=None):
    with sse_clients_lock:
        for cid, client in list(sse_clients.items()):
            try:
                if taskId and client.get('taskId') and str(client.get('taskId')) != str(taskId):
                    continue
                q = client.get('queue')
                if q:
                    try:
                        q.put_nowait(_format_sse(event, payload))
                    except Exception:
                        # queue full or closed
                        pass
            except Exception:
                # ignore per-client errors
                pass


def sse_poller():
    global prev_tasks_by_id, prev_task_ids_set, prev_followups_json, prev_agents_json, prev_runner_json
    heartbeat_counter = 0
    while True:
        try:
            # Tasks
            tasks = agg.get_all_tasks() or []
            tasks_by_id = {}
            new_ids = set()
            for t in tasks:
                tid = t.get('taskId') or t.get('id') or t.get('task_id')
                if not tid:
                    continue
                tasks_by_id[str(tid)] = t
                new_ids.add(str(tid))

            # emit full tasks feed if count changed
            if len(new_ids) != len(prev_task_ids_set):
                broadcast_event('tasks', tasks)

            # per-task diffs
            for tid, t in tasks_by_id.items():
                try:
                    cur = json.dumps(t, default=str)
                    prev = prev_tasks_by_id.get(tid)
                    if prev is None:
                        broadcast_event('task', {'task': t}, taskId=tid)
                    elif prev != cur:
                        broadcast_event('task', {'task': t}, taskId=tid)

                        # detect appended stdout/stderr
                        try:
                            prevObj = json.loads(prev)
                            prevExec = prevObj.get('executionReport') or prevObj.get('execution') or prevObj.get('execution_report') or {}
                            newExec = t.get('executionReport') or t.get('execution') or t.get('execution_report') or {}

                            prev_out = str(prevExec.get('stdout') or prevExec.get('output') or prevExec.get('response') or '')
                            new_out = str(newExec.get('stdout') or newExec.get('output') or newExec.get('response') or '')
                            if len(new_out) > len(prev_out):
                                chunk = new_out[len(prev_out):]
                                broadcast_event('log', {'taskId': tid, 'stream': 'stdout', 'data': chunk}, taskId=tid)

                            prev_err = str(prevExec.get('stderr') or prevExec.get('errorOutput') or prevExec.get('error') or '')
                            new_err = str(newExec.get('stderr') or newExec.get('errorOutput') or newExec.get('error') or '')
                            if len(new_err) > len(prev_err):
                                chunk = new_err[len(prev_err):]
                                broadcast_event('log', {'taskId': tid, 'stream': 'stderr', 'data': chunk}, taskId=tid)
                        except Exception:
                            pass

                    prev_tasks_by_id[tid] = cur
                except Exception:
                    # tolerate per-task errors
                    pass

            prev_task_ids_set = new_ids

            # Followups
            try:
                try:
                    from reviewer import followup_store
                    followups = followup_store.list_suggestions()
                except Exception:
                    followups = None
                if followups is not None:
                    fjson = json.dumps(followups, default=str)
                    if fjson != prev_followups_json:
                        broadcast_event('followups', followups)
                        prev_followups_json = fjson
            except Exception:
                # ignore followup polling errors
                pass

            # Agents (agent registry)
            try:
                try:
                    from registry.service import AgentRegistry
                    registry_path = os.environ.get('AGENT_REGISTRY_STORAGE', '/tmp/ai-dev-agent-registry.json')
                    reg = AgentRegistry(storage_path=registry_path)
                    reg.load_storage()
                    agents_list = reg.list_agents()
                    agents = [a.to_json() for a in (agents_list or [])]
                except Exception:
                    agents = None
                if agents is not None:
                    ajson = json.dumps(agents, default=str)
                    if ajson != prev_agents_json:
                        broadcast_event('agents', agents)
                        prev_agents_json = ajson
            except Exception:
                # ignore agent polling errors
                pass

            # Runner status
            try:
                try:
                    dry = (os.environ.get('RUNNER_DRY_RUN', '') or '').lower() == 'true'
                    runner = {'status': 'dry-run' if dry else 'connected'}
                except Exception:
                    runner = {'status': 'unknown'}
                rjson = json.dumps(runner, default=str)
                if rjson != prev_runner_json:
                    broadcast_event('runner', runner)
                    prev_runner_json = rjson
            except Exception:
                # ignore runner polling errors
                pass

            # heartbeat every 30s
            heartbeat_counter = (heartbeat_counter + 1) % 30
            if heartbeat_counter == 0:
                broadcast_event('heartbeat', {'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())})

        except Exception:
            logging.exception('SSE poller error')
        finally:
            time.sleep(1)


# start poller thread
try:
    t = threading.Thread(target=sse_poller, daemon=True)
    t.start()
except Exception:
    logging.exception('Failed to start SSE poller thread')


@app.route('/stream')
def stream():
    global sse_next_client_id
    q = queue.Queue(maxsize=1000)
    client_id = None
    try:
        with sse_clients_lock:
            client_id = str(sse_next_client_id)
            sse_next_client_id += 1
            sse_clients[client_id] = {'queue': q, 'taskId': request.args.get('taskId')}

        def generator():
            try:
                # initial comment
                yield ': connected\n\n'
                # initial snapshot
                try:
                    tasks = agg.get_all_tasks() or []
                    yield _format_sse('tasks', tasks)
                except Exception:
                    pass

                # followups snapshot
                try:
                    try:
                        from reviewer import followup_store
                        followups = followup_store.list_suggestions()
                    except Exception:
                        followups = None
                    if followups is not None:
                        yield _format_sse('followups', followups)
                except Exception:
                    pass

                # agents snapshot
                try:
                    try:
                        from registry.service import AgentRegistry
                        registry_path = os.environ.get('AGENT_REGISTRY_STORAGE', '/tmp/ai-dev-agent-registry.json')
                        reg = AgentRegistry(storage_path=registry_path)
                        reg.load_storage()
                        agents_list = reg.list_agents()
                        agents = [a.to_json() for a in (agents_list or [])]
                    except Exception:
                        agents = None
                    if agents is not None:
                        yield _format_sse('agents', agents)
                except Exception:
                    pass

                # runner snapshot
                try:
                    try:
                        dry = (os.environ.get('RUNNER_DRY_RUN', '') or '').lower() == 'true'
                        runner = {'status': 'dry-run' if dry else 'connected'}
                    except Exception:
                        runner = {'status': 'unknown'}
                    yield _format_sse('runner', runner)
                except Exception:
                    pass

                while True:
                    try:
                        msg = q.get(timeout=30)
                        yield msg
                    except queue.Empty:
                        # keep-alive comment
                        yield ': keepalive\n\n'
            finally:
                # cleanup
                try:
                    with sse_clients_lock:
                        if client_id in sse_clients:
                            del sse_clients[client_id]
                except Exception:
                    pass

        return Response(stream_with_context(generator()), mimetype='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
    except Exception:
        abort(500)



@app.route('/taskboard/api/stream')
def stream_alias():
    """Compatibility route matching frontend path /taskboard/api/stream
    Delegates to the existing /stream SSE implementation.
    """
    return stream()


if __name__ == '__main__':
    # Default to binding to localhost:8000
    port = int(os.environ.get('TASKBOARD_API_PORT', '8000'))
    app.run(host='127.0.0.1', port=port)
