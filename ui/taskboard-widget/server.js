const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');
const { spawnSync } = require('child_process');

const app = express();
const DATA_FILE = '/tmp/taskboard-mvp.json';

app.use(cors());
app.use(bodyParser.json());

// Early guard: reject path-traversal attempts targeting results endpoints
app.use((req, res, next) => {
  try {
    const raw = req.url || '';
    const orig = req.originalUrl || '';
    // Only flag when URL targets results endpoints and contains a '..' path-segment
    if ((/\/api\/results\//).test(raw) && (/(^|\/)\.\.($|\/)/).test(raw)) {
      console.error('EARLY-GUARD-RAW', raw, orig);
      return res.status(400).json({ error: 'Invalid taskId' });
    }
    if ((/\/api\/results\//).test(orig) && (/(^|\/)\.\.($|\/)/).test(orig)) {
      console.error('EARLY-GUARD-ORIG', raw, orig);
      return res.status(400).json({ error: 'Invalid taskId' });
    }
  } catch (e) {
    console.error('EARLY-GUARD-ERR', e && e.message ? e.message : e);
  }
  next();
});

function genId(prefix = 'TASK-') {
  // Support PWA-YYYYMMDD-HHMMSS or TASK-<timestamp>
  const now = new Date();
  if (prefix === 'PWA-' || prefix === 'PWA') {
    const pad = (n, l = 2) => String(n).padStart(l, '0');
    const y = now.getFullYear();
    const m = pad(now.getMonth() + 1);
    const d = pad(now.getDate());
    const hh = pad(now.getHours());
    const mm = pad(now.getMinutes());
    const ss = pad(now.getSeconds());
    return `PWA-${y}${m}${d}-${hh}${mm}${ss}`;
  }
  // Default TASK- plus unix ms timestamp (stable and unique)
  return `${prefix}${now.getTime()}`;
}

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      // Create sample tasks with generated IDs so UIs don't accidentally rely on a static TASK-1 placeholder
      const sample = [
        {
          taskId: genId('TASK-'),
          title: 'Fix memory leak in service A',
          status: 'pending_review',
          openhandsResponse: 'OpenHands suggests patch xyz to close file handles.',
          reviewerSummary: 'Reviewer: reproduce locally; patch seems reasonable.',
          proposedActions: [
            { id: 'act-1', type: 'commit', description: 'Apply memory-fix patch', payload: {} }
          ],
          selectedAction: null,
          notes: ''
        },
        {
          taskId: genId('TASK-'),
          title: 'Update README for new API',
          status: 'approved',
          openhandsResponse: 'OpenHands created draft doc changes.',
          reviewerSummary: 'Docs ok, ready to merge.',
          proposedActions: [
            { id: 'act-2', type: 'docs', description: 'Merge docs PR', payload: {} }
          ],
          selectedAction: 'act-2',
          notes: 'Merged by automation.'
        }
      ];
      fs.writeFileSync(DATA_FILE, JSON.stringify(sample, null, 2));
      return sample;
    } else {
      const content = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(content);
    }
  } catch (e) {
    console.error('readData error', e);
    return [];
  }
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get('/api/tasks', async (req, res) => {
  // Try aggregator HTTP feed first (local read-model service)
  const AGG_URL = process.env.AGG_URL || 'http://127.0.0.1:8000/tasks';
  try {
    // use built-in http(s) to avoid external deps
    const { URL } = require('url');
    const url = new URL(AGG_URL);
    const lib = url.protocol === 'https:' ? require('https') : require('http');

    const result = await new Promise((resolve) => {
      const req = lib.get(AGG_URL, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ ok: true, json });
          } catch (e) {
            resolve({ ok: false });
          }
        });
      });
      req.on('error', () => resolve({ ok: false }));
      req.setTimeout(1500, () => {
        try { req.abort(); } catch (e) {}
        resolve({ ok: false });
      });
    });

    if (result && result.ok) {
      return res.json(result.json);
    }
  } catch (e) {
    console.log('Aggregator proxy failed, falling back to file:', e && e.message ? e.message : e);
  }

  // fallback to local file-based persistence
  const data = readData();
  res.json(data);
});

app.post('/api/task/save', (req, res) => {
  const task = req.body || {};
  const data = readData();

  // Ensure a stable taskId exists for saved tasks in standalone mode
  if (!task.taskId || typeof task.taskId !== 'string' || !task.taskId.trim()) {
    task.taskId = genId('TASK-');
  }

  const idx = data.findIndex((t) => t.taskId === task.taskId);
  if (idx >= 0) {
    data[idx] = task;
  } else {
    data.push(task);
  }
  writeData(data);
  res.json(data);
});

app.get('/health', (req, res) => res.send('ok'));

const port = process.env.PORT || 3000;
// Catch-all routes for results that include extra path segments (handle traversal attempts)
app.get('/api/results/*', (req, res) => {
  const raw = (req.originalUrl || req.url || '');
  const prefix = '/api/results/';
  let idPart = '';
  const idx = raw.indexOf(prefix);
  if (idx !== -1) idPart = raw.slice(idx + prefix.length).split('?')[0];
  try { idPart = decodeURIComponent(idPart); } catch (e) {}
  // reject if contains path separators or traversal
  if (!idPart || idPart.indexOf('/') !== -1 || /(\.|\.)/.test(idPart) && /(^|\/)\.\.($|\/)/.test(idPart)) {
    return res.status(400).json({ error: 'Invalid taskId' });
  }
  // final sanitize against allowed chars
  const SAFE_RE = /^[A-Za-z0-9_.-]+$/;
  if (!SAFE_RE.test(idPart)) return res.status(400).json({ error: 'Invalid taskId' });
  const out = buildResultForTask(idPart);
  if (out && out.error === 'invalid_taskId' && out.statusCode === 400) return res.status(400).json({ error: 'Invalid taskId' });
  return res.json(out);
});
app.get('/taskboard/api/results/*', (req, res) => {
  const raw = (req.originalUrl || req.url || '');
  const prefix = '/taskboard/api/results/';
  let idPart = '';
  const idx = raw.indexOf(prefix);
  if (idx !== -1) idPart = raw.slice(idx + prefix.length).split('?')[0];
  try { idPart = decodeURIComponent(idPart); } catch (e) {}
  if (!idPart || idPart.indexOf('/') !== -1 || /(\.|\.)/.test(idPart) && /(^|\/)\.\.($|\/)/.test(idPart)) {
    return res.status(400).json({ error: 'Invalid taskId' });
  }
  const SAFE_RE = /^[A-Za-z0-9_.-]+$/;
  if (!SAFE_RE.test(idPart)) return res.status(400).json({ error: 'Invalid taskId' });
  const out = buildResultForTask(idPart);
  if (out && out.error === 'invalid_taskId' && out.statusCode === 400) return res.status(400).json({ error: 'Invalid taskId' });
  return res.json(out);
});



// Serve static assets under /taskboard to match Vite base: '/taskboard/'
// Reject obvious path-traversal attempts early for results endpoints
app.use('/api/results', (req, res, next) => {
  const url = req.originalUrl || '';
  // detect '..' path segments
  if ((/(^|\/)\.\.($|\/)/).test(url)) {
    return res.status(400).json({ error: 'Invalid taskId' });
  }
  next();
});
app.use('/taskboard/api/results', (req, res, next) => {
  const url = req.originalUrl || '';
  if ((/(^|\/)\.\.($|\/)/).test(url)) {
    return res.status(400).json({ error: 'Invalid taskId' });
  }
  next();
});

// Serve static assets under /taskboard to match Vite base: '/taskboard/'

const distPath = path.join(__dirname, 'dist');
app.use('/taskboard', express.static(distPath));

// Serve v2 assets under their own path to avoid mixing with legacy /taskboard assets
app.use('/taskboard-v2/assets', express.static(path.join(distPath, 'assets')));

// Serve /taskboard-v2 and any subpath by rewriting the built index.html asset paths
const v2IndexPath = path.join(distPath, 'index.html');
function sendTaskboardV2Index(res) {
  try {
    let html = fs.readFileSync(v2IndexPath, 'utf8');
    // Replace legacy asset path with v2 path, global replace
    html = html.replace(/\/taskboard\/assets\//g, '/taskboard-v2/assets/');
    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (e) {
    res.status(500).send('taskboard-v2 build not found');
  }
}
// Serve PWA-specific assets for the v2 shell
app.get('/taskboard-v2/manifest.webmanifest', (req, res) => {
  try { return res.sendFile(path.join(distPath, 'manifest.webmanifest')) } catch (e) { return res.status(404).send('not found') }
});
app.get('/taskboard-v2/sw.js', (req, res) => {
  try { return res.sendFile(path.join(distPath, 'sw.js')) } catch (e) { return res.status(404).send('not found') }
});
app.get('/taskboard-v2/offline.html', (req, res) => {
  try { return res.sendFile(path.join(distPath, 'offline.html')) } catch (e) { return res.status(404).send('not found') }
});

app.get('/taskboard-v2', (req, res) => sendTaskboardV2Index(res));
app.get('/taskboard-v2/*', (req, res) => sendTaskboardV2Index(res));

// Duplicate API endpoints under /taskboard/api/* so the app can fetch using the built BASE_URL
app.get('/taskboard/api/tasks', async (req, res) => {
  // Try aggregator HTTP feed first (local read-model service)
  console.log('[SSE-DEBUG] GET /taskboard/api/tasks invoked');

  const AGG_URL = process.env.AGG_URL || 'http://127.0.0.1:8000/tasks';
  try {
    const { URL } = require('url');
    const url = new URL(AGG_URL);
    const lib = url.protocol === 'https:' ? require('https') : require('http');

    const result = await new Promise((resolve) => {
      const r = lib.get(AGG_URL, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ ok: true, json });
          } catch (e) {
            resolve({ ok: false });
          }
        });
      });
      r.on('error', () => resolve({ ok: false }));
      r.setTimeout(1500, () => {
        try { r.abort(); } catch (e) {}
        resolve({ ok: false });
      });
    });

    if (result && result.ok) return res.json(result.json);
  } catch (e) {
    console.log('Aggregator proxy failed, falling back to file (taskboard/api):', e && e.message ? e.message : e);
  }

  // fallback to local file-based persistence and merge with any runner execution reports
  const data = readData() || [];

  const RUNNER_BASE_DIR = process.env.RUNNER_BASE_DIR || process.env.RUN_BASE || '/var/lib/ai-dev-runner/openhands-runs';
  const runnerDir = RUNNER_BASE_DIR ? path.resolve(RUNNER_BASE_DIR) : null;
  const syntheticTasks = [];

  try {
    if (runnerDir && fs.existsSync(runnerDir) && fs.statSync(runnerDir).isDirectory()) {
      const entries = fs.readdirSync(runnerDir);
      for (const entry of entries) {
        try {
          const execPath = path.join(runnerDir, entry, 'execution-report.json');
          if (!fs.existsSync(execPath)) continue;
          let report = null;
          try { report = JSON.parse(fs.readFileSync(execPath, 'utf8')); } catch (e) { report = null }
          if (!report) continue;

          // normalize common id fields and conversation id
          const taskId = report.taskId || report.task_id || report.id || entry || null;
          const conversationId = report.conversationId || report.conversation_id || report.conversation || null;

          // compute updatedAt using report fields or file mtime
          let updatedAt = report.completedAt || report.updatedAt || report.updated_at || null;
          try { const st = fs.statSync(execPath); if (st && st.mtime) updatedAt = updatedAt || st.mtime.toISOString(); } catch (e) {}
          updatedAt = updatedAt || new Date().toISOString();

          // If a stored task exists for this taskId, attach the execution report to the active session.
          // DO NOT replace the stored task with a synthetic entry — prefer attaching and preserving sessions.
          let attached = false;
          if (taskId) {
            const idx = data.findIndex((t) => t && t.taskId === taskId);
            if (idx >= 0) {
              try {
                const tgt = data[idx];

                // ensure sessions array and executionHistory exist
                tgt.sessions = Array.isArray(tgt.sessions) ? tgt.sessions : [];
                tgt.executionHistory = Array.isArray(tgt.executionHistory) ? tgt.executionHistory : [];

                // prefer activeSessionId when present
                const activeSessionId = tgt.activeSessionId || (tgt.sessions.length ? tgt.sessions[tgt.sessions.length - 1].sessionId : null);
                const runId = report && (report.runId || report.id || report.run_id);
                const parentId = report && (report.parentExecutionId || report.parentExecution_id || report.parentExecution);

                let attachedToSession = false;

                if (activeSessionId) {
                  const s = tgt.sessions.find((ss) => ss && ss.sessionId === activeSessionId);
                  if (s) {
                    // preserve prior executionReport by moving it into executionHistory
                    if (s.executionReport) {
                      tgt.executionHistory.push(s.executionReport);
                    } else if (tgt.executionReport) {
                      // legacy top-level executionReport: preserve it as history
                      tgt.executionHistory.push(tgt.executionReport);
                    }

                    s.executionReport = report;
                    s.updatedAt = s.updatedAt || updatedAt;
                    attachedToSession = true;
                  }
                }

                if (!attachedToSession && Array.isArray(tgt.sessions) && tgt.sessions.length) {
                  // try matching by runId/parentId, or attach to first session without an executionReport
                  for (let s of tgt.sessions) {
                    try {
                      if (!s.executionReport) {
                        s.executionReport = report;
                        s.updatedAt = s.updatedAt || updatedAt;
                        attachedToSession = true;
                        break;
                      } else if (runId && (s.executionReport.id === runId || s.executionReport.runId === runId)) {
                        // already matches
                        attachedToSession = true;
                        break;
                      } else if (parentId && (s.executionReport.id === parentId || s.executionReport.runId === parentId)) {
                        attachedToSession = true;
                        break;
                      }
                    } catch (e) {}
                  }
                }

                if (!attachedToSession) {
                  // append as a new immutable session
                  const newSession = { sessionId: 'sess-' + Date.now().toString(36), createdAt: updatedAt, updatedAt: updatedAt, title: tgt.title || '', messages: [], reviewDecision: { proposals: [] }, selectedActionId: null, approval: null, dispatch: null, executionReport: report, artifacts: [], timeline: [], status: 'Complete', immutable: true };
                  tgt.sessions.push(newSession);
                }

                // Keep legacy top-level executionReport populated from active session for compatibility
                const latestSession = tgt.sessions.find(s => s && s.sessionId === (tgt.activeSessionId || (tgt.sessions.length ? tgt.sessions[tgt.sessions.length - 1].sessionId : null)));
                if (latestSession && latestSession.executionReport) {
                  tgt.executionReport = latestSession.executionReport;
                }

              } catch (e) {}
              attached = true;
            }
          }

          if (!attached) {
            const synthetic = {
              taskId: taskId || genId('TASK-'),
              title: (report.summary || report.title || (report.taskId || report.task_id) || String(taskId || '')).toString(),
              status: report.status || report.executionStatus || report.state || 'completed',
              conversationId: conversationId || null,
              executionReport: report,
              synthetic: true,
              source: 'execution-report',
              updatedAt: updatedAt
            };
            syntheticTasks.push(synthetic);
          }
        } catch (errEntry) {
          // ignore single-run parse errors
          console.warn('Failed to parse runner execution report for entry', entry, errEntry && errEntry.message ? errEntry.message : errEntry);
        }
      }
    }
  } catch (e) {
    console.warn('Failed scanning RUNNER_BASE_DIR for execution reports', e && e.message ? e.message : e);
  }

  // Merge stored tasks with synthetic tasks, deduplicating by taskId::conversationId (prefer stored tasks when present)
  const byKey = new Map();
  function keyFor(t) {
    if (!t) return '::';
    const tid = t.taskId || '';
    const cid = t.conversationId || t.conversation_id || '';
    return `${tid}::${cid}`;
  }
  function timeFor(t) {
    try {
      if (!t) return 0;
      const v = t.updatedAt || t.updated_at || (t.executionReport && (t.executionReport.completedAt || t.executionReport.updatedAt || t.executionReport.updated_at)) || null;
      const n = v ? Date.parse(v) : 0;
      return Number.isFinite(n) && !Number.isNaN(n) ? n : 0;
    } catch (e) { return 0 }
  }

  // add stored tasks first
  for (const t of (data || [])) {
    const k = keyFor(t);
    if (!byKey.has(k)) byKey.set(k, t);
    else {
      // if duplicate stored tasks, keep the newest
      const existing = byKey.get(k);
      if (timeFor(t) > timeFor(existing)) byKey.set(k, t);
    }
  }

  // add synthetic tasks only if not present, or replace with newer
  for (const s of syntheticTasks) {
    const k = keyFor(s);
    if (!byKey.has(k)) byKey.set(k, s);
    else {
      const existing = byKey.get(k);
      if (timeFor(s) > timeFor(existing)) byKey.set(k, s);
    }
  }

  const merged = Array.from(byKey.values());
  // sort newest first
  merged.sort((a, b) => timeFor(b) - timeFor(a));

  res.json(merged);
});

app.post('/taskboard/api/task/save', (req, res) => {
  const task = req.body || {};
  const data = readData();

  if (!task.taskId || typeof task.taskId !== 'string' || !task.taskId.trim()) {
    task.taskId = genId('TASK-');
  }

  const idx = data.findIndex((t) => t.taskId === task.taskId);
  if (idx >= 0) data[idx] = task;
  else data.push(task);
  writeData(data);
  res.json(data);
});


// Simple local results store (non-production) - map taskId -> result
const RESULTS_FILE = process.env.RESULTS_FILE || '/var/lib/ai-dev-runner/taskboard-results.json';
function readResults() {
  try {
    if (!fs.existsSync(RESULTS_FILE)) return {};
    const c = fs.readFileSync(RESULTS_FILE, 'utf8');
    return JSON.parse(c || '{}');
  } catch (e) {
    console.error('readResults error', e);
    return {};
  }
}
function writeResults(obj) {
  try { fs.writeFileSync(RESULTS_FILE, JSON.stringify(obj, null, 2)); } catch (e) { console.error('writeResults error', e); }
}

// Build a results response for a task by inspecting runner run directory
function buildResultForTask(id) {
  const SAFE_RE = /^[A-Za-z0-9_.-]+$/;
  if (!id || !SAFE_RE.test(id)) {
    return { error: 'invalid_taskId', statusCode: 400 };
  }
  const RUN_BASE = process.env.RUN_BASE || '/var/lib/ai-dev-runner/openhands-runs';
  const baseResolved = path.resolve(RUN_BASE);
  const runDir = path.resolve(RUN_BASE, id);
  if (!runDir.startsWith(baseResolved + path.sep) && runDir !== baseResolved) {
    return { error: 'invalid_taskId', statusCode: 400 };
  }

  try {
    if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
      const all = readResults();
      if (all && all[id]) return all[id];
      return { taskId: id, found: false, status: 'pending', summary: 'Waiting for runner result.', updatedAt: null };
    }

    const execPath = path.join(runDir, 'execution-report.json');
    const taskJsonPath = path.join(runDir, 'task.json');
    const taskMdPath = path.join(runDir, 'task.md');

    let executionReport = null;
    let taskObj = null;
    let taskMarkdown = null;

    if (fs.existsSync(execPath)) {
      try { executionReport = JSON.parse(fs.readFileSync(execPath, 'utf8')); } catch (e) { executionReport = null; }
    }
    if (fs.existsSync(taskJsonPath)) {
      try { taskObj = JSON.parse(fs.readFileSync(taskJsonPath, 'utf8')); } catch (e) { taskObj = null; }
    }
    if (fs.existsSync(taskMdPath)) {
      try { taskMarkdown = fs.readFileSync(taskMdPath, 'utf8'); } catch (e) { taskMarkdown = null; }
    }

    let status = 'pending';
    if (executionReport && executionReport.status) status = executionReport.status;
    else if (taskObj) status = 'prepared';
    else status = 'pending';

    let summary = 'Waiting for runner result.';
    if (executionReport && executionReport.summary) summary = executionReport.summary;
    else if (executionReport && executionReport.status) summary = `Runner completed with status: ${executionReport.status}`;
    else if (taskObj) summary = 'Runner prepared task artifacts.';
    else summary = 'Waiting for runner result.';

    // compute updatedAt using latest mtime among available files
    let updatedAt = null;
    const mtimes = [];
    [execPath, taskJsonPath, taskMdPath].forEach((p) => {
      try {
        if (fs.existsSync(p)) {
          const st = fs.statSync(p);
          if (st && st.mtime) mtimes.push(st.mtime.getTime());
        }
      } catch (e) {}
    });
    if (mtimes.length) {
      const mx = Math.max.apply(null, mtimes);
      updatedAt = new Date(mx).toISOString();
    }

    // Attempt to detect an OpenHands conversation id from available artifacts
    let conversationId = null;
    let detectedConversationIdSource = null;
    try {
      const re = /Initialized conversation\s+([a-f0-9]{16,64})/i;
      const candidates = [];
      if (executionReport) {
        if (typeof executionReport.summary === 'string') candidates.push({ src: 'execution-report.json:summary', text: executionReport.summary });
        if (typeof executionReport.stdout === 'string') candidates.push({ src: 'execution-report.json:stdout', text: executionReport.stdout });
        if (typeof executionReport.stderr === 'string') candidates.push({ src: 'execution-report.json:stderr', text: executionReport.stderr });
        try { candidates.push({ src: 'execution-report.json', text: JSON.stringify(executionReport) }); } catch (e) {}
      }
      if (taskObj) {
        try { candidates.push({ src: 'task.json', text: JSON.stringify(taskObj) }); } catch (e) {}
      }
      if (taskMarkdown) candidates.push({ src: 'task.md', text: taskMarkdown });

      for (const c of candidates) {
        if (!c || !c.text) continue;
        const m = re.exec(c.text);
        if (m && m[1]) {
          conversationId = m[1];
          detectedConversationIdSource = c.src || 'execution-report.json';
          break;
        }
      }
    } catch (e) {
      // ignore detection errors
    }

    const out = {
      taskId: id,
      found: true,
      runDirectory: runDir,
      executionReport: executionReport || null,
      task: taskObj || null,
      taskMarkdown: taskMarkdown || null,
      status,
      summary,
      updatedAt
    };

    if (conversationId) {
      out.conversationId = conversationId;
      out.detectedConversationIdSource = detectedConversationIdSource;
    }

    return out;
  } catch (e) {
    console.error('results lookup error', e && e.message ? e.message : e);
    const all = readResults();
    if (all && all[id]) return all[id];
    return { taskId: id, found: false, status: 'pending', summary: 'Waiting for runner result.', updatedAt: null };
  }
}

// GET result for a specific taskId - public API
app.get('/api/results/:taskId', (req, res) => {
  const id = req.params.taskId;
  const out = buildResultForTask(id);
  if (out && out.error === 'invalid_taskId' && out.statusCode === 400) {
    return res.status(400).json({ error: 'Invalid taskId' });
  }
  return res.json(out);
});

// Alias under /taskboard for BASE_URL compatibility
app.get('/taskboard/api/results/:taskId', (req, res) => {
  const id = req.params.taskId;
  const out = buildResultForTask(id);
  if (out && out.error === 'invalid_taskId' && out.statusCode === 400) {
    return res.status(400).json({ error: 'Invalid taskId' });
  }
  return res.json(out);
});

// Runner status endpoint (useful for UI status pill)
app.get('/api/runner-status', (req, res) => {
  const dry = (process.env.RUNNER_DRY_RUN || '').toString().toLowerCase() === 'true';
  res.json({ status: dry ? 'dry-run' : 'connected' });
});
app.get('/taskboard/api/runner-status', (req, res) => {
  const dry = (process.env.RUNNER_DRY_RUN || '').toString().toLowerCase() === 'true';
  res.json({ status: dry ? 'dry-run' : 'connected' });
});

// Agent registry endpoints — returns live agent list with freshness
app.get('/api/agents', (req, res) => {
  const registryPath = process.env.AGENT_REGISTRY_STORAGE || '/tmp/ai-dev-agent-registry.json'
  try {
    if (!fs.existsSync(registryPath)) throw new Error('registry file missing')
    const raw = fs.readFileSync(registryPath, 'utf8')
    const parsed = JSON.parse(raw || '{}')
    let items = []
    if (Array.isArray(parsed)) items = parsed
    else if (parsed && typeof parsed === 'object') items = Object.keys(parsed).map((k) => parsed[k])
    const now = Date.now()
    const agents = items.map((a) => {
      const lastSeen = a.lastSeen || a.last_seen || null
      let freshnessSeconds = null
      let isFresh = false
      if (lastSeen) {
        const t = new Date(lastSeen).getTime()
        if (!Number.isNaN(t)) {
          freshnessSeconds = Math.floor((now - t) / 1000)
          isFresh = freshnessSeconds <= 300
        }
      }
      return {
        agentId: a.agentId || a.id || (a.agent || ''),
        hostname: a.hostname || a.host || '',
        roles: a.roles || [],
        status: a.status || 'unknown',
        cpuCount: typeof a.cpuCount === 'number' ? a.cpuCount : (typeof a.cpu === 'number' ? a.cpu : null),
        memoryGb: typeof a.memoryGb === 'number' ? a.memoryGb : (typeof a.memory_gb === 'number' ? a.memory_gb : null),
        diskFreeGb: typeof a.diskFreeGb === 'number' ? a.diskFreeGb : (typeof a.disk_free_gb === 'number' ? a.disk_free_gb : null),
        loadAverage: typeof a.loadAverage === 'number' ? a.loadAverage : (typeof a.load_avg === 'number' ? a.load_avg : null),
        lastSeen: lastSeen,
        freshnessSeconds,
        isFresh,
      }
    })
    return res.json({ agents })
  } catch (e) {
    console.warn('Failed to read agent registry', e && e.message ? e.message : e)
    // static fallback
    const fallback = [
      {
        agentId: 'ofbiz-dev-01',
        hostname: 'ubuntu-16gb-sin-1',
        roles: ['ofbiz'],
        status: 'idle',
        cpuCount: 8,
        memoryGb: 15.2425,
        diskFreeGb: 272.77,
        loadAverage: 3.36,
        lastSeen: new Date().toISOString(),
        freshnessSeconds: 0,
        isFresh: true,
      },
      {
        agentId: 'future-agent-placeholder',
        hostname: 'another-server',
        roles: ['general'],
        status: 'idle',
        cpuCount: 2,
        memoryGb: 4,
        diskFreeGb: 50,
        loadAverage: 0.1,
        lastSeen: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        freshnessSeconds: Math.floor(60 * 60),
        isFresh: false,
      },
    ]
    return res.json({ agents: fallback, warning: `Failed to read registry at ${registryPath}: ${String(e && e.message ? e.message : e)}` })
  }
})

// Duplicate endpoint under /taskboard for app BASE_URL compatibility


function readJsonlFile(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line); } catch (_e) { return null; }
      })
      .filter(Boolean);
  } catch (_e) {
    return [];
  }
}

function buildFollowupsResponse() {
  const suggestionsFile = process.env.FOLLOWUP_SUGGESTIONS_FILE || '/var/lib/ai-dev-runner/followup_suggestions.jsonl';
  const decisionsFile = process.env.FOLLOWUP_DECISIONS_FILE || '/var/lib/ai-dev-runner/followup_decisions.jsonl';
  const publishedFile = process.env.FOLLOWUP_PUBLISHED_FILE || '/var/lib/ai-dev-runner/followup_published.jsonl';

  const suggestions = readJsonlFile(suggestionsFile);
  const decisions = readJsonlFile(decisionsFile);
  const published = readJsonlFile(publishedFile);

  const decisionById = {};
  for (const d of decisions) {
    if (d && d.suggestionId) decisionById[d.suggestionId] = d.decision || 'pending';
  }

  const publishedIds = new Set(
    published
      .filter((p) => p && p.suggestionId)
      .map((p) => p.suggestionId)
  );

  return suggestions
    .slice()
    .reverse()
    .map((s) => ({
      suggestionId: s.suggestionId || null,
      parentTaskId: s.parentTaskId || null,
      conversationId: s.conversationId || null,
      title: s.title || '',
      description: s.description || '',
      reason: s.reason || '',
      source: s.source || '',
      generatedAt: s.generatedAt || null,
      decision: s.suggestionId && decisionById[s.suggestionId] ? decisionById[s.suggestionId] : 'pending',
      published: !!(s.suggestionId && publishedIds.has(s.suggestionId)),
    }));
}

app.get('/taskboard/api/followups', (req, res) => {
  res.json(buildFollowupsResponse());
});

// Follow-ups manual actions: approve, reject, publish
app.post('/taskboard/api/followups/:id/approve', (req, res) => {
  try {
    const serverToken = process.env.TASKBOARD_API_TOKEN;
    if (!serverToken) {
      return res.status(500).json({ error: 'Server misconfiguration: TASKBOARD_API_TOKEN not set' });
    }
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }
    const provided = authHeader.slice('Bearer '.length).trim();
    if (provided !== serverToken) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const suggestionId = req.params.id;
    if (!suggestionId) return res.status(400).json({ error: 'Missing suggestion id' });

    const pythonCode = `
import json, sys
from reviewer import followup_approval
data = json.loads(sys.stdin.read() or "{}")
try:
    out = followup_approval.approve_suggestion(data.get("suggestionId"))
    print(json.dumps({"ok": True, "decision": out}, ensure_ascii=False))
except Exception as e:
    import traceback
    print(json.dumps({"ok": False, "error": str(e), "trace": traceback.format_exc()}))
    sys.exit(2)
`;

    const env = Object.assign({}, process.env);
    env.PYTHONPATH = path.resolve(__dirname, '..', '..');
    const proc = spawnSync('python3', ['-c', pythonCode], { input: JSON.stringify({ suggestionId }), encoding: 'utf8', env: env, timeout: 30000 });
    const out = (proc.stdout || '').trim();
    try {
      const parsed = JSON.parse(out || '{}');
      if (proc.status === 0 && parsed && parsed.ok) {
        return res.json({ ok: true, decision: parsed.decision });
      } else {
        return res.status(502).json({ ok: false, error: parsed.error || 'python_failed', meta: parsed, stdout: out, stderr: proc.stderr });
      }
    } catch (e) {
      return res.status(502).json({ ok: false, error: 'invalid_python_output', stdout: out, stderr: proc.stderr });
    }
  } catch (e) {
    console.error('followup approve handler error', e);
    return res.status(500).json({ ok: false, error: 'internal server error' });
  }
});

app.post('/taskboard/api/followups/:id/reject', (req, res) => {
  try {
    const serverToken = process.env.TASKBOARD_API_TOKEN;
    if (!serverToken) {
      return res.status(500).json({ error: 'Server misconfiguration: TASKBOARD_API_TOKEN not set' });
    }
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }
    const provided = authHeader.slice('Bearer '.length).trim();
    if (provided !== serverToken) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const suggestionId = req.params.id;
    if (!suggestionId) return res.status(400).json({ error: 'Missing suggestion id' });

    const pythonCode = `
import json, sys
from reviewer import followup_approval
data = json.loads(sys.stdin.read() or "{}")
try:
    out = followup_approval.reject_suggestion(data.get("suggestionId"))
    print(json.dumps({"ok": True, "decision": out}, ensure_ascii=False))
except Exception as e:
    import traceback
    print(json.dumps({"ok": False, "error": str(e), "trace": traceback.format_exc()}))
    sys.exit(2)
`;

    const env = Object.assign({}, process.env);
    env.PYTHONPATH = path.resolve(__dirname, '..', '..');
    const proc = spawnSync('python3', ['-c', pythonCode], { input: JSON.stringify({ suggestionId }), encoding: 'utf8', env: env, timeout: 30000 });
    const out = (proc.stdout || '').trim();
    try {
      const parsed = JSON.parse(out || '{}');
      if (proc.status === 0 && parsed && parsed.ok) {
        return res.json({ ok: true, decision: parsed.decision });
      } else {
        return res.status(502).json({ ok: false, error: parsed.error || 'python_failed', meta: parsed, stdout: out, stderr: proc.stderr });
      }
    } catch (e) {
      return res.status(502).json({ ok: false, error: 'invalid_python_output', stdout: out, stderr: proc.stderr });
    }
  } catch (e) {
    console.error('followup reject handler error', e);
    return res.status(500).json({ ok: false, error: 'internal server error' });
  }
});

app.post('/taskboard/api/followups/:id/publish', (req, res) => {
  try {
    const serverToken = process.env.TASKBOARD_API_TOKEN;
    if (!serverToken) {
      return res.status(500).json({ error: 'Server misconfiguration: TASKBOARD_API_TOKEN not set' });
    }
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }
    const provided = authHeader.slice('Bearer '.length).trim();
    if (provided !== serverToken) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const suggestionId = req.params.id;
    if (!suggestionId) return res.status(400).json({ error: 'Missing suggestion id' });

    const pythonCode = `
import json, sys
from reviewer import followup_publisher
data = json.loads(sys.stdin.read() or "{}")
sid = data.get('suggestionId')
# Only publish if present in approved suggestions (and not yet published)
approved = followup_publisher.get_approved_suggestions(limit=None)
target = None
for s in approved:
    if s.get('suggestionId') == sid:
        target = s
        break
if not target:
    print(json.dumps({'ok': False, 'error': 'not_approved_or_already_published'}))
    sys.exit(2)
ok, meta = followup_publisher.publish_approved_suggestion(target)
print(json.dumps({'ok': ok, 'meta': meta}, ensure_ascii=False))
if not ok:
    sys.exit(2)
`;

    const env = Object.assign({}, process.env);
    env.PYTHONPATH = path.resolve(__dirname, '..', '..');
    const proc = spawnSync('python3', ['-c', pythonCode], { input: JSON.stringify({ suggestionId }), encoding: 'utf8', env: env, timeout: 60000 });
    const out = (proc.stdout || '').trim();
    try {
      const parsed = JSON.parse(out || '{}');
      if (proc.status === 0 && parsed && parsed.ok) {
        return res.json({ ok: true, meta: parsed.meta });
      } else {
        return res.status(502).json({ ok: false, error: parsed.error || 'python_failed', meta: parsed, stdout: out, stderr: proc.stderr });
      }
    } catch (e) {
      return res.status(502).json({ ok: false, error: 'invalid_python_output', stdout: out, stderr: proc.stderr });
    }
  } catch (e) {
    console.error('followup publish handler error', e);
    return res.status(500).json({ ok: false, error: 'internal server error' });
  }
});



app.get('/taskboard/api/agents', (req, res) => {
  const registryPath = process.env.AGENT_REGISTRY_STORAGE || '/tmp/ai-dev-agent-registry.json'
  try {
    if (!fs.existsSync(registryPath)) throw new Error('registry file missing')
    const raw = fs.readFileSync(registryPath, 'utf8')
    const parsed = JSON.parse(raw || '{}')
    let items = []
    if (Array.isArray(parsed)) items = parsed
    else if (parsed && typeof parsed === 'object') items = Object.keys(parsed).map((k) => parsed[k])
    const now = Date.now()
    const agents = items.map((a) => {
      const lastSeen = a.lastSeen || a.last_seen || null
      let freshnessSeconds = null
      let isFresh = false
      if (lastSeen) {
        const t = new Date(lastSeen).getTime()
        if (!Number.isNaN(t)) {
          freshnessSeconds = Math.floor((now - t) / 1000)
          isFresh = freshnessSeconds <= 300
        }
      }
      return {
        agentId: a.agentId || a.id || (a.agent || ''),
        hostname: a.hostname || a.host || '',
        roles: a.roles || [],
        status: a.status || 'unknown',
        cpuCount: typeof a.cpuCount === 'number' ? a.cpuCount : (typeof a.cpu === 'number' ? a.cpu : null),
        memoryGb: typeof a.memoryGb === 'number' ? a.memoryGb : (typeof a.memory_gb === 'number' ? a.memory_gb : null),
        diskFreeGb: typeof a.diskFreeGb === 'number' ? a.diskFreeGb : (typeof a.disk_free_gb === 'number' ? a.disk_free_gb : null),
        loadAverage: typeof a.loadAverage === 'number' ? a.loadAverage : (typeof a.load_avg === 'number' ? a.load_avg : null),
        lastSeen: lastSeen,
        freshnessSeconds,
        isFresh,
      }
    })
    return res.json({ agents })
  } catch (e) {
    console.warn('Failed to read agent registry', e && e.message ? e.message : e)
    const fallback = [
      {
        agentId: 'ofbiz-dev-01',
        hostname: 'ubuntu-16gb-sin-1',
        roles: ['ofbiz'],
        status: 'idle',
        cpuCount: 8,
        memoryGb: 15.2425,
        diskFreeGb: 272.77,
        loadAverage: 3.36,
        lastSeen: new Date().toISOString(),
        freshnessSeconds: 0,
        isFresh: true,
      },
      {
        agentId: 'future-agent-placeholder',
        hostname: 'another-server',
        roles: ['general'],
        status: 'idle',
        cpuCount: 2,
        memoryGb: 4,
        diskFreeGb: 50,
        loadAverage: 0.1,
        lastSeen: new Date(Date.now() - 1000 * 60 * 60).toISOString(),
        freshnessSeconds: Math.floor(60 * 60),
        isFresh: false,
      },
    ]
    return res.json({ agents: fallback, warning: `Failed to read registry at ${registryPath}: ${String(e && e.message ? e.message : e)}` })
  }
})


// Standalone decision API for mobile / direct browser usage
// POST /taskboard/api/task/decision
// Expects JSON body containing taskId, decision, policy, selectedAction, editedAction, newAction, notes, source: 'taskboard-standalone', createdAt
// Requires Authorization: Bearer <TASKBOARD_API_TOKEN>
app.post('/taskboard/api/task/decision', async (req, res) => {
    console.log('[SSE-DEBUG] /taskboard/api/task/decision invoked - method:', req.method, 'path:', req.path, 'auth:', !!(req.headers && (req.headers.authorization || req.headers.Authorization)));
  try {
    const serverToken = process.env.TASKBOARD_API_TOKEN;
    if (!serverToken) {
      return res.status(500).json({ error: 'Server misconfiguration: TASKBOARD_API_TOKEN not set' });
    }

    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing Authorization header' });
    }
    const provided = authHeader.slice('Bearer '.length).trim();
    if (provided !== serverToken) {
      return res.status(403).json({ error: 'Invalid token' });
    }

    const body = req.body || {};
    const taskId = body.taskId;
    const decision = body.decision;
    const source = body.source;
    const allowed = ['approved', 'denied', 'deferred'];

    if (!taskId || !decision || !allowed.includes(decision) || source !== 'taskboard-standalone') {
      return res.status(400).json({ error: 'Invalid payload: taskId, decision and source required; decision must be one of approved|denied|deferred and source must be taskboard-standalone' });
    }

    // Ensure the taskId refers to a saved task — prevent approving the static sample/placeholder
    const existing = readData();
    const found = existing.find((t) => t && t.taskId === taskId);
    if (!found) {
      return res.status(400).json({ error: `Unknown or missing taskId: ${String(taskId)}. In standalone mode you must save the task (with a stable taskId) before sending decisions.` });
    }

    // Normalize selectedAction: accept either a full action object or an action ID string
    let selectedActionPayload = (typeof body.selectedAction !== 'undefined') ? body.selectedAction : null;
    if (typeof selectedActionPayload === 'string') {
      const actionId = selectedActionPayload;
      selectedActionPayload = (found && Array.isArray(found.proposedActions)) ? found.proposedActions.find((a) => a && a.id === actionId) : null;
      if (!selectedActionPayload) {
        return res.status(400).json({ error: `selectedAction id '${actionId}' not found in task ${taskId}` });
      }
    } else if (selectedActionPayload && typeof selectedActionPayload === 'object' && selectedActionPayload.id) {
      // If client provided a partial object with an id, try to reconcile with saved task
      // Merge client-provided fields (e.g., payload.routing) with the stored action so routing is preserved
      const actionId = selectedActionPayload.id;
      const existingAction = (found && Array.isArray(found.proposedActions)) ? found.proposedActions.find((a) => a && a.id === actionId) : null;
      if (!existingAction) {
        return res.status(400).json({ error: `selectedAction id '${actionId}' not found in task ${taskId}` });
      }
      // shallow merge: existingAction fields, then client-provided fields override
      const merged = Object.assign({}, existingAction, selectedActionPayload);
      // merge payloads specifically
      merged.payload = Object.assign({}, existingAction.payload || {}, selectedActionPayload.payload || {});
      selectedActionPayload = merged;
    }

    const review_msg = {
      taskId: taskId,
      decision: decision,
      policy: body.policy || null,
      reason: body.notes || null,
      approver: body.approver || 'taskboard-standalone',
      source: source,
      selectedAction: selectedActionPayload,
      editedAction: body.editedAction || null,
      newAction: body.newAction || null,
      createdAt: body.createdAt || new Date().toISOString(),
    };

    // Publish to Kafka topic ai.dev.review.out using existing CLI or Python kafka helper
    const topic = 'ai.dev.review.out';
    const clientConfig = process.env.KAFKA_CLIENT_CONFIG;

    // Publish asynchronously in the background so the UI receives a quick response
    setImmediate(() => {
      try {
        // Helper to find CLI in PATH if not explicitly provided
        const producerEnv = process.env.KAFKA_PRODUCER_CMD;
        function which(cmd) {
          try {
            const out = spawnSync('which', [cmd], { encoding: 'utf8' });
            if (out && out.status === 0) return out.stdout.trim();
          } catch (e) {}
          return null;
        }

        let producer = null;
        if (producerEnv) {
          try {
            // Do not honor obvious no-op simulation producer (/bin/true). Prefer a real kafka-console-producer if available.
            if (fs.existsSync(producerEnv) && path.basename(producerEnv) !== 'true' && producerEnv !== '/bin/true') producer = producerEnv;
          } catch (e) { /* ignore */ }
        }
        if (!producer) {
          producer = which('kafka-console-producer.sh') || which('kafka-console-producer');
        }

        // Try CLI producer first (so KAFKA_CLIENT_CONFIG can be honored)
        if (producer) {
          // Skip known harmless no-op binaries (e.g., /bin/true) to avoid false-positive success responses
          const prodBase = path.basename(producer || '');
          if (prodBase === 'true' || producer === '/bin/true') {
            console.warn('Producer CLI configured as no-op (true) - skipping CLI publish to avoid false-positive success. Falling back to Python kafka wrapper.');
          } else {
            const args = ['--bootstrap-server', process.env.KAFKA_BOOTSTRAP || 'localhost:9092', '--topic', topic];
            if (clientConfig) args.push('--producer.config', clientConfig);
            try {
              const proc = spawnSync(producer, args, { input: JSON.stringify(review_msg) + '\n', encoding: 'utf8', timeout: 30000, env: process.env });
              const meta = { topic, returnCode: proc.status, stdout: (proc.stdout || '').slice(-4000), stderr: (proc.stderr || '').slice(-4000), used_cli: true, cmd: [producer].concat(args) };
              if (proc.status === 0) {
                console.log('[SSE-DEBUG] async publish ok', meta);
              } else {
                console.error('Producer CLI failed', meta);
              }
            } catch (e) {
              console.error('Producer CLI exception', e && e.message ? e.message : e);
            }
          }
        }

        // Fallback: attempt to use Python matrix_bridge.kafka_client (respects KAFKA_CLIENT_CONFIG)
        try {
          const pythonCode = `import json, sys\nfrom matrix_bridge.kafka_client import KafkaClient\nkc = KafkaClient(dry_run=False)\nmsg = json.loads(sys.stdin.read())\nsuccess, meta = kc.publish('${topic}', msg)\nprint(json.dumps({'success': success, 'meta': meta}))\nif not success:\n    sys.exit(2)\n`;
          const env = Object.assign({}, process.env);
          // Ensure Python can import matrix_bridge from repo root
          env.PYTHONPATH = path.resolve(__dirname, '..', '..');
          const py = spawnSync('python3', ['-c', pythonCode], { input: JSON.stringify(review_msg), encoding: 'utf8', env: env, timeout: 30000 });
          const out = (py.stdout || '').trim();
          let parsed = null;
          try { parsed = JSON.parse(out || '{}'); } catch (e) { parsed = null; }
          const meta = { topic, returnCode: py.status, stdout: out.slice(-4000), stderr: (py.stderr || '').slice(-4000), used_python_wrapper: true, parsed: parsed };
          if (py.status === 0) {
            console.log('[SSE-DEBUG] async python publish ok', meta);
          } else {
            console.error('Python kafka wrapper failed', meta);
          }
        } catch (e) {
          console.error('Python kafka fallback exception', e && e.message ? e.message : e);
        }
      } catch (e) {
        console.error('Async publish error', e && e.message ? e.message : e);
      }
    });

    // Respond quickly to client that the decision was received and async publish is scheduled
    return res.json({ ok: true, published: false, meta: { async_publish: true } });
  } catch (e) {
    console.error('task decision handler error', e && e.message ? e.message : e);
    return res.status(500).json({ ok: false, error: 'internal server error' });
  }
});

// Serve manifest and service-worker explicitly as static files to avoid SPA fallback
app.get('/taskboard/manifest.json', (req, res) => {
  res.type('application/json');
  res.sendFile(path.join(distPath, 'manifest.json'));
});
app.get('/taskboard/service-worker.js', (req, res) => {
  res.type('application/javascript');
  res.sendFile(path.join(distPath, 'service-worker.js'));
});


// SPA fallback for /taskboard/* (serve index.html)
app.get(['/taskboard', '/taskboard/'], (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
app.get('/taskboard/*', (req, res, next) => {
  // If the original URL looks like an api/results request but the
  // normalized path no longer starts with /taskboard/api/, likely this
  // was a path-traversal attempt such as /taskboard/api/results/../../etc/passwd
  const orig = (req.originalUrl || req.url || '');
  if (orig.indexOf('/taskboard/api/results') !== -1 && !req.path.startsWith('/taskboard/api/')) {
    return res.status(400).json({ error: 'Invalid taskId' });
  }
  // allow /taskboard/api/* to be handled by the api routes above
  if (req.path.startsWith('/taskboard/api/')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// Serve V2 shell under /taskboard-v2 using the same build artifacts.
// index.html assets reference /taskboard/assets so we keep those asset paths intact.
app.use('/taskboard-v2', express.static(distPath));
app.get(['/taskboard-v2', '/taskboard-v2/'], (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
app.get('/taskboard-v2/*', (req, res, next) => {
  // do not intercept API routes; forward if path looks like /taskboard/api/*
  if (req.path.startsWith('/taskboard/api/')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

// --- Server-Sent Events (SSE) for live taskboard updates
// Provides: /taskboard/api/stream
// Publishes events: tasks, task, followups, agents, runner, log, heartbeat

const sseClients = new Map();
let sseNextClientId = 1;
let ssePoller = null;
let sseHeartbeat = null;
let ssePollingIntervalMs = 1000;
let sseHeartbeatIntervalMs = 30000;

function sendSseEvent(resObj, eventName, payload) {
  try {
    resObj.write(`event: ${eventName}\n`);
    resObj.write(`data: ${JSON.stringify(payload)}\n\n`);
  } catch (e) {
    // ignore write errors (client likely disconnected)
  }
}

function broadcastEvent(eventName, payload, opts) {
  opts = opts || {};
  for (const [id, client] of sseClients.entries()) {
    try {
      // If the client requested a specific taskId, skip unrelated events
      if (opts.taskId && client.taskId && String(client.taskId) !== String(opts.taskId)) continue;
      // For task-scoped events that include a taskId in opts, if client.taskId is set it must match
      if (client.taskId && opts.taskId && String(client.taskId) !== String(opts.taskId)) continue;
      sendSseEvent(client.res, eventName, payload);
    } catch (e) {}
  }
}

function httpGetJson(path, timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const url = `http://127.0.0.1:${port}${path}`;
      const lib = require('http');
      const req = lib.get(url, (resp) => {
        let data = '';
        resp.on('data', (chunk) => (data += chunk));
        resp.on('end', () => {
          try { resolve({ ok: true, json: JSON.parse(data) }); } catch (e) { resolve({ ok: false }); }
        });
      });
      req.on('error', () => resolve({ ok: false }));
      req.setTimeout(timeoutMs, () => { try { req.abort(); } catch (e) {} resolve({ ok: false }); });
    } catch (e) { resolve({ ok: false }); }
  });
}

let prevTasksById = {};
let prevTaskIdsSet = new Set();
let prevFollowups = null;
let prevAgents = null;
let prevRunner = null;
let isPolling = false;

async function ssePoll() {
  if (isPolling) return;
  isPolling = true;
  try {
    const tasksRes = await httpGetJson('/taskboard/api/tasks');
    const followupsRes = await httpGetJson('/taskboard/api/followups');
    const agentsRes = await httpGetJson('/taskboard/api/agents');
    const runnerRes = await httpGetJson('/taskboard/api/runner-status');

    const tasks = (tasksRes && tasksRes.ok && Array.isArray(tasksRes.json)) ? tasksRes.json : [];
    const followups = (followupsRes && followupsRes.ok && Array.isArray(followupsRes.json)) ? followupsRes.json : (followupsRes && followupsRes.ok && followupsRes.json) || [];
    const agents = (agentsRes && agentsRes.ok && agentsRes.json) ? agentsRes.json : null;
    const runner = (runnerRes && runnerRes.ok && runnerRes.json) ? runnerRes.json : null;

    // If task count changed, emit full tasks list
    const newTaskIds = new Set((tasks || []).map(t => t && (t.taskId || t.id || t.task_id)));
    if (newTaskIds.size !== prevTaskIdsSet.size) {
      broadcastEvent('tasks', tasks);
    }

    // Per-task changes and log diffs
    for (const t of (tasks || [])) {
      const tid = String((t && (t.taskId || t.id || t.task_id)) || '');
      if (!tid) continue;
      const curJson = JSON.stringify(t);
      const prevJson = prevTasksById[tid];
      if (!prevJson) {
        // new task
        broadcastEvent('task', { task: t }, { taskId: tid });
      } else if (prevJson !== curJson) {
        // task updated
        broadcastEvent('task', { task: t }, { taskId: tid });

        // detect log diffs (stdout/stderr) and emit 'log' events with the appended chunk
        try {
          const prevObj = JSON.parse(prevJson);
          const prevExec = prevObj.executionReport || prevObj.execution || prevObj.execution_report || {};
          const newExec = t.executionReport || t.execution || t.execution_report || {};

          const prevOut = String(prevExec.stdout || prevExec.output || prevExec.response || '');
          const newOut = String(newExec.stdout || newExec.output || newExec.response || '');
          if (newOut.length > prevOut.length) {
            const chunk = newOut.slice(prevOut.length);
            broadcastEvent('log', { taskId: tid, stream: 'stdout', data: chunk }, { taskId: tid });
          }

          const prevErr = String(prevExec.stderr || prevExec.errorOutput || prevExec.error || '');
          const newErr = String(newExec.stderr || newExec.errorOutput || newExec.error || '');
          if (newErr.length > prevErr.length) {
            const chunk = newErr.slice(prevErr.length);
            broadcastEvent('log', { taskId: tid, stream: 'stderr', data: chunk }, { taskId: tid });
          }
        } catch (e) {
          // ignore parse errors
        }
      }
      prevTasksById[tid] = curJson;
    }

    prevTaskIdsSet = newTaskIds;

    // Followups
    try {
      const fJson = JSON.stringify(followups || []);
      if (fJson !== prevFollowups) {
        broadcastEvent('followups', followups);
        prevFollowups = fJson;
      }
    } catch (e) {}

    // Agents
    try {
      const aJson = JSON.stringify(agents || {});
      if (aJson !== prevAgents) {
        broadcastEvent('agents', agents);
        prevAgents = aJson;
      }
    } catch (e) {}

    // Runner
    try {
      const rJson = JSON.stringify(runner || {});
      if (rJson !== prevRunner) {
        broadcastEvent('runner', runner);
        prevRunner = rJson;
      }
    } catch (e) {}

  } catch (e) {
    // swallow polling errors
  } finally {
    isPolling = false;
  }
}

function startSsePoller() {
  if (ssePoller) return;
  // poll immediately and then on interval
  ssePoller = setInterval(ssePoll, ssePollingIntervalMs);
  sseHeartbeat = setInterval(() => {
    broadcastEvent('heartbeat', { ts: new Date().toISOString() });
  }, sseHeartbeatIntervalMs);
  // fire initial poll
  ssePoll();
}

function stopSsePollerIfIdle() {
  if (sseClients.size === 0) {
    if (ssePoller) { clearInterval(ssePoller); ssePoller = null; }
    if (sseHeartbeat) { clearInterval(sseHeartbeat); sseHeartbeat = null; }
    prevTasksById = {};
    prevTaskIdsSet = new Set();
    prevFollowups = null;
    prevAgents = null;
    prevRunner = null;
  }
}

app.get('/taskboard/api/stream', (req, res) => {
  // SSE connection
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  try { res.flushHeaders && res.flushHeaders(); } catch (e) {}

  const clientId = String(sseNextClientId++);
  const taskId = req.query && req.query.taskId ? String(req.query.taskId) : null;
  sseClients.set(clientId, { res, taskId });

  // send a short comment to establish the connection
  try { res.write(': connected\n\n'); } catch (e) {}

  // send initial snapshots for this client
  (async () => {
    try {
      const tasksRes = await httpGetJson('/taskboard/api/tasks');
      if (tasksRes && tasksRes.ok) sendSseEvent(res, 'tasks', tasksRes.json);
      const followupsRes = await httpGetJson('/taskboard/api/followups');
      if (followupsRes && followupsRes.ok) sendSseEvent(res, 'followups', followupsRes.json);
      const agentsRes = await httpGetJson('/taskboard/api/agents');
      if (agentsRes && agentsRes.ok) sendSseEvent(res, 'agents', agentsRes.json);
      const runnerRes = await httpGetJson('/taskboard/api/runner-status');
      if (runnerRes && runnerRes.ok) sendSseEvent(res, 'runner', runnerRes.json);
    } catch (e) {}
  })();

  // start global poller when first client connects
  startSsePoller();

  req.on('close', () => {
    try { sseClients.delete(clientId); } catch (e) {}
    stopSsePollerIfIdle();
  });
});

// --- End SSE implementation


app.listen(port, () => {
  console.log('Server listening on port', port);
});
