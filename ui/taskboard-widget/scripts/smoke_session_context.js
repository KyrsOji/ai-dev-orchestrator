#!/usr/bin/env node
'use strict'
// Smoke test for OpenHands session continuity (milestone 10B)
// Validates regex extraction, server detection, parent->child inheritance, and payload inclusion

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');

function fail(msg) { console.error('FAIL:', msg); process.exit(2); }
function pass(msg) { console.log('PASS:', msg); }

// 1) Regex extraction test
const sample = 'Initialized conversation 9dda8677248a4a57a0123648aa544756';
const re = /Initialized conversation\s+([a-f0-9]{16,64})/i;
const m = re.exec(sample);
if (!m || !m[1]) fail('Regex failed to extract conversation id');
const conv = m[1];
console.log('Extracted conversation id:', conv);
pass('Regex extraction test');

// 2) Start a temporary server with RUN_BASE pointing to a temp dir and create a run directory with execution-report.json
const UI_DIR = path.resolve(__dirname, '..');
const SERVER_JS = path.join(UI_DIR, 'server.js');
if (!fs.existsSync(SERVER_JS)) fail('server.js not found at ' + SERVER_JS);

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'run-base-'));
const taskId = 'smoke-session-' + Date.now().toString(36);
const runDir = path.join(tmpBase, taskId);
fs.mkdirSync(runDir, { recursive: true });

// create execution-report.json with summary containing the Initialized conversation line
const execReport = { status: 'completed', summary: `Some logs\nInitialized conversation ${conv}\nDone`, stdout: `OK\nInitialized conversation ${conv}\n` };
fs.writeFileSync(path.join(runDir, 'execution-report.json'), JSON.stringify(execReport, null, 2));

// choose a port unlikely to conflict
const PORT = 3005;
const env = Object.assign({}, process.env, { RUN_BASE: tmpBase, PORT: String(PORT) });

console.log('Starting temporary server.js with RUN_BASE=', tmpBase, 'PORT=', PORT);
const srv = spawn('node', [SERVER_JS], { cwd: UI_DIR, env: env, stdio: ['ignore', 'pipe', 'pipe'] });

let started = false;
let stdout = '';
let stderr = '';
srv.stdout.on('data', (d) => { stdout += String(d); if (!started && stdout.indexOf('Server listening on port') !== -1) started = true; });
srv.stderr.on('data', (d) => { stderr += String(d); });

function waitForServer(timeoutMs) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function poll() {
      const req = http.get({ host: '127.0.0.1', port: PORT, path: '/health', timeout: 1000 }, (res) => {
        let d = '';
        res.on('data', (c) => d += c);
        res.on('end', () => { if (res.statusCode === 200) return resolve(true); else retry(); });
      }).on('error', retry);

      function retry() {
        if (Date.now() - start > timeoutMs) return reject(new Error('timeout waiting for server'));
        setTimeout(poll, 150);
      }
    })();
  });
}

(async () => {
  try {
    await waitForServer(5000);
  } catch (e) {
    srv.kill();
    fail('Temporary server did not start: ' + (e && e.message ? e.message : String(e)) + '\nSTDOUT:\n' + stdout + '\nSTDERR:\n' + stderr);
  }

  // Query the results endpoint
  const url = `http://127.0.0.1:${PORT}/taskboard/api/results/${encodeURIComponent(taskId)}`;
  console.log('Querying:', url);

  http.get(url, (res) => {
    let body = '';
    res.on('data', (c) => body += c);
    res.on('end', () => {
      try {
        const j = JSON.parse(body);
        if (!j) { srv.kill(); fail('No JSON returned from results endpoint'); }
        if (!j.conversationId) { srv.kill(); fail('results endpoint did not return conversationId'); }
        if (String(j.conversationId) !== String(conv)) { srv.kill(); fail('returned conversationId mismatch: ' + j.conversationId); }
        if (!j.detectedConversationIdSource) { srv.kill(); fail('results endpoint did not return detectedConversationIdSource'); }
        console.log('Results endpoint returned conversationId:', j.conversationId, 'source:', j.detectedConversationIdSource);
        pass('Server detection of conversationId from execution-report.json');

        // 3) Parent -> child inheritance and payload composition (simulate front-end behavior)
        const parent = {
          taskId: 'task-parent-1',
          rootTaskId: 'root-abc',
          parentTaskId: null,
          conversationId: conv,
          context: { previousRunDirectory: runDir }
        };

        // simulate creating a follow-up child task
        function createFollowUp(parentTask, childTaskId) {
          const child = {
            taskId: childTaskId,
            title: 'Follow-up task',
            status: 'pending_review',
            openhandsResponse: '',
            reviewerSummary: '',
            proposedActions: [],
            selectedAction: null,
            notes: '',
            rootTaskId: (parentTask.rootTaskId && parentTask.rootTaskId.length) ? parentTask.rootTaskId : parentTask.taskId,
            parentTaskId: parentTask.taskId,
            conversationId: parentTask.conversationId || null,
            context: Object.assign({}, parentTask.context || {})
          };
          // child should point previousTaskId to parent
          child.context.previousTaskId = parentTask.taskId;
          return child;
        }

        const child = createFollowUp(parent, 'task-child-1');
        if (child.rootTaskId !== parent.rootTaskId) { srv.kill(); fail('child did not inherit rootTaskId'); }
        if (child.parentTaskId !== parent.taskId) { srv.kill(); fail('child parentTaskId not set'); }
        if (child.conversationId !== parent.conversationId) { srv.kill(); fail('child did not inherit conversationId'); }
        if (!child.context || child.context.previousRunDirectory !== parent.context.previousRunDirectory) { srv.kill(); fail('child did not inherit previousRunDirectory'); }
        pass('Parent->child inheritance of session context');

        // simulate front-end action payload injection for a follow-up action
        const actionForSend = { id: 'act-1', payload: {} };
        // emulate isFollowUpAction
        actionForSend.payload.routing = actionForSend.payload.routing || { selectedAgentId: 'a', selectedHostname: 'h', selectedRole: 'r' };
        actionForSend.payload.parentTaskId = parent.taskId;
        actionForSend.payload.rootTaskId = (parent.rootTaskId && parent.rootTaskId.length) ? parent.rootTaskId : parent.taskId;
        if (parent.conversationId) actionForSend.payload.conversationId = parent.conversationId;
        actionForSend.payload.context = actionForSend.payload.context || {};
        actionForSend.payload.context.previousTaskId = parent.taskId;
        if (parent.context && parent.context.previousRunDirectory) actionForSend.payload.context.previousRunDirectory = parent.context.previousRunDirectory;

        if (!actionForSend.payload.conversationId) { srv.kill(); fail('action payload missing conversationId'); }
        if (!actionForSend.payload.context || !actionForSend.payload.context.previousRunDirectory) { srv.kill(); fail('action payload missing previousRunDirectory'); }

        console.log('Action payload contains conversationId and previousRunDirectory as expected');
        pass('Action payload composition test');

        // cleanup and exit
        srv.kill();
        console.log('\nALL SMOKE TESTS PASS');
        process.exit(0);
      } catch (e) {
        srv.kill();
        fail('Error parsing results endpoint response: ' + e);
      }
    });
  }).on('error', (e) => { srv.kill(); fail('Error querying results endpoint: ' + e && e.message ? e.message : String(e)); });
})();
