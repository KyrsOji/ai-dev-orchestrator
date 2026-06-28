const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

function httpRequest({ method = 'GET', host = '127.0.0.1', port, path: reqPath = '/', headers = {}, body = null, timeout = 15000 }) {
  return new Promise((resolve, reject) => {
    const opts = { method, host, port, path: reqPath, headers };
    const req = http.request(opts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    if (timeout) req.setTimeout(timeout, () => { req.abort(); reject(new Error('request timeout')); });
    if (body) {
      if (typeof body === 'string' || Buffer.isBuffer(body)) req.write(body);
      else req.write(JSON.stringify(body));
    }
    req.end();
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function run() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-attach-'));
  const runnerBase = path.join(tmpRoot, 'runs');
  fs.mkdirSync(runnerBase, { recursive: true });

  const port = 30000 + Math.floor(Math.random() * 20000);
  const env = Object.assign({}, process.env, {
    PORT: String(port),
    RUNNER_BASE_DIR: runnerBase,
  });

  console.log('Starting server on port', port, 'runnerBase', runnerBase);
  const server = spawn('node', ['server.js'], { cwd: path.join(__dirname), env, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', (d) => process.stdout.write(`[server stdout] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[server stderr] ${d}`));

  // wait for health
  const deadline = Date.now() + 10000;
  let ok = false;
  while (Date.now() < deadline) {
    try {
      const r = await httpRequest({ method: 'GET', port, path: '/health', timeout: 2000 });
      if (r.statusCode === 200) { ok = true; break; }
    } catch (e) {}
    await sleep(200);
  }
  if (!ok) {
    server.kill();
    throw new Error('Server did not become ready in time');
  }

  try {
    const taskId = 'T-attach-' + Date.now().toString(36);
    const now = new Date().toISOString();
    const oldExec = { id: 'old-exec-' + Date.now().toString(36), status: 'completed', summary: 'old run', stdout: 'OLD', createdAt: now };

    const stored = {
      taskId,
      title: 'Attach test',
      sessions: [
        {
          sessionId: 'sess-old',
          title: 'Original session',
          createdAt: now,
          updatedAt: now,
          messages: [],
          reviewDecision: { proposals: [] },
          selectedActionId: null,
          approval: { value: true, approver: 'tester', approvedAt: now },
          dispatch: { value: true, dispatchedAt: now },
          executionReport: oldExec,
          artifacts: [],
          timeline: [],
          status: 'Complete',
          immutable: true
        },
        {
          sessionId: 'sess-followup',
          title: 'Follow-up',
          createdAt: now,
          updatedAt: now,
          messages: [],
          reviewDecision: { proposals: [] },
          selectedActionId: null,
          approval: null,
          dispatch: null,
          executionReport: null,
          artifacts: [],
          timeline: [],
          status: 'Pending',
          immutable: false
        }
      ],
      activeSessionId: 'sess-followup',
      updatedAt: now
    };

    // Save the stored task via API
    const saveResp = await httpRequest({ method: 'POST', port, path: '/taskboard/api/task/save', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stored) });
    if (!(saveResp && saveResp.statusCode >= 200 && saveResp.statusCode < 300)) {
      throw new Error('Failed to save stored task: ' + JSON.stringify(saveResp));
    }

    // Now create a runner execution report for the same taskId
    const runDir = path.join(runnerBase, taskId);
    fs.mkdirSync(runDir, { recursive: true });
    const newExec = { id: 'new-exec-' + Date.now().toString(36), taskId: taskId, status: 'completed', summary: 'new run', stdout: 'NEW', createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(runDir, 'execution-report.json'), JSON.stringify(newExec, null, 2));

    // Wait a little and fetch merged tasks
    await sleep(400);
    const listResp = await httpRequest({ method: 'GET', port, path: '/taskboard/api/tasks' });
    if (listResp.statusCode !== 200) throw new Error('GET tasks failed: ' + listResp.statusCode);
    const arr = JSON.parse(listResp.body || '[]');
    const found = arr.find(t => t && t.taskId === taskId);
    if (!found) throw new Error('Task not found in merged tasks');

    // Assertions
    const sessFollowup = (found.sessions || []).find(s => s && s.sessionId === 'sess-followup');
    if (!sessFollowup) throw new Error('Follow-up session missing');
    if (!sessFollowup.executionReport || sessFollowup.executionReport.id !== newExec.id) throw new Error('New executionReport not attached to follow-up session');

    // Ensure previous executionReport preserved in executionHistory (or preserved on prior session)
    const oldOnPrior = (found.sessions || []).find(s => s && s.sessionId === 'sess-old' && s.executionReport && s.executionReport.id === oldExec.id);
    if (!oldOnPrior) throw new Error('Previous executionReport lost from prior session');

    console.log('TEST PASS: execution attached to active follow-up session and previous preserved');

    // --- Scenario 2: active session already has an executionReport; new runner report replaces it and prior report is moved into executionHistory ---
    const taskId2 = 'T-attach2-' + Date.now().toString(36);
    const oldExec2 = { id: 'old-exec2-' + Date.now().toString(36), status: 'completed', summary: 'old run 2', stdout: 'OLD2', createdAt: now };
    const stored2 = {
      taskId: taskId2,
      title: 'Attach test 2',
      sessions: [
        {
          sessionId: 'sess-active',
          title: 'Active session',
          createdAt: now,
          updatedAt: now,
          messages: [],
          reviewDecision: { proposals: [] },
          selectedActionId: null,
          approval: { value: true, approver: 'tester', approvedAt: now },
          dispatch: { value: true, dispatchedAt: now },
          executionReport: oldExec2,
          artifacts: [],
          timeline: [],
          status: 'Complete',
          immutable: false
        }
      ],
      activeSessionId: 'sess-active',
      updatedAt: now
    };

    // Save stored2
    const saveResp2 = await httpRequest({ method: 'POST', port, path: '/taskboard/api/task/save', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stored2) });
    if (!(saveResp2 && saveResp2.statusCode >= 200 && saveResp2.statusCode < 300)) {
      throw new Error('Failed to save stored task2: ' + JSON.stringify(saveResp2));
    }

    // Write new runner report for taskId2
    const runDir2 = path.join(runnerBase, taskId2);
    fs.mkdirSync(runDir2, { recursive: true });
    const newExec2 = { id: 'new-exec2-' + Date.now().toString(36), taskId: taskId2, status: 'completed', summary: 'new run 2', stdout: 'NEW2', createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(runDir2, 'execution-report.json'), JSON.stringify(newExec2, null, 2));

    await sleep(400);
    const listResp2 = await httpRequest({ method: 'GET', port, path: '/taskboard/api/tasks' });
    if (listResp2.statusCode !== 200) throw new Error('GET tasks failed (2): ' + listResp2.statusCode);
    const arr2 = JSON.parse(listResp2.body || '[]');
    const found2 = arr2.find(t => t && t.taskId === taskId2);
    if (!found2) throw new Error('Task2 not found in merged tasks');

    const activeSess = (found2.sessions || []).find(s => s && s.sessionId === 'sess-active');
    if (!activeSess) throw new Error('Active session missing for task2');
    if (!activeSess.executionReport || activeSess.executionReport.id !== newExec2.id) throw new Error('New executionReport not attached to active session (task2)');

    // Ensure previous executionReport is now present in executionHistory
    if (!Array.isArray(found2.executionHistory) || !found2.executionHistory.find(h => h && h.id === oldExec2.id)) {
      throw new Error('Previous executionReport was not preserved in executionHistory for task2');
    }

    console.log('TEST PASS: active session replaced and previous executionReport preserved in executionHistory');

  } finally {
    server.kill();
    await sleep(200);
  }
}

run().catch(err => { console.error('ERROR', err && err.stack ? err.stack : err); process.exit(2); });
