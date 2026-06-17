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

// Duplicate API endpoints under /taskboard/api/* so the app can fetch using the built BASE_URL
app.get('/taskboard/api/tasks', async (req, res) => {
  // Try aggregator HTTP feed first (local read-model service)
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

  const data = readData();
  res.json(data);
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
const RESULTS_FILE = '/tmp/taskboard-results.json';
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

// Opinions store (simple file-based persistence)
const OPINIONS_FILE = '/tmp/taskboard-opinions.json';
function readOpinions() {
  try {
    if (!fs.existsSync(OPINIONS_FILE)) return {};
    const c = fs.readFileSync(OPINIONS_FILE, 'utf8');
    return JSON.parse(c || '{}');
  } catch (e) {
    console.error('readOpinions error', e);
    return {};
  }
}
function writeOpinions(obj) {
  try { fs.writeFileSync(OPINIONS_FILE, JSON.stringify(obj, null, 2)); } catch (e) { console.error('writeOpinions error', e); }
}

// Build a results response for a task by inspecting runner run directory
function buildResultForTask(id) {
  const SAFE_RE = /^[A-Za-z0-9_.-]+$/;
  if (!id || !SAFE_RE.test(id)) {
    return { error: 'invalid_taskId', statusCode: 400 };
  }
  // Use RUNNER_BASE_DIR per new requirement
  const RUNNER_BASE_DIR = process.env.RUNNER_BASE_DIR || '/var/lib/ai-dev-runner/openhands-runs';
  const baseResolved = path.resolve(RUNNER_BASE_DIR);
  const runDir = path.resolve(RUNNER_BASE_DIR, id);
  // Ensure resolved path is under the base directory
  if (!runDir.startsWith(baseResolved + path.sep) && runDir !== baseResolved) {
    return { error: 'invalid_taskId', statusCode: 400 };
  }

  try {
    // If run directory does not exist, report not found (do not fallback to /tmp/taskboard-results.json)
    if (!fs.existsSync(runDir) || !fs.statSync(runDir).isDirectory()) {
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

    // Determine status per spec:
    // - executionReport.status if available
    // - else 'prepared' if task.json exists
    // - else 'received' if runDir exists
    let status = 'pending';
    if (executionReport && executionReport.status) {
      status = executionReport.status;
    } else if (taskObj) {
      status = 'prepared';
    } else {
      status = 'received';
    }

    // Determine summary per spec:
    // - executionReport.summary if available
    // - else "Runner completed with status: <status>" if executionReport.status exists
    // - else "Runner prepared task artifacts." if task.json exists
    // - else "Runner received task." if runDir exists
    let summary = 'Waiting for runner result.';
    if (executionReport && executionReport.summary) {
      summary = executionReport.summary;
    } else if (executionReport && executionReport.status) {
      summary = `Runner completed with status: ${executionReport.status}`;
    } else if (taskObj) {
      summary = 'Runner prepared task artifacts.';
    } else {
      summary = 'Runner received task.';
    }

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

    return {
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
  } catch (e) {
    console.error('results lookup error', e && e.message ? e.message : e);
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


// Opinions endpoints: store and retrieve ChatGPT "2nd Opinion" entries per task
// GET  /api/opinions/:taskId
// POST /api/opinions/:taskId
function registerOpinionsEndpoints(basePath) {
  app.get(`${basePath}/opinions/:taskId`, (req, res) => {
    const id = req.params.taskId;
    const SAFE_RE = /^[A-Za-z0-9_.-]+$/;
    if (!id || id.indexOf('/') !== -1 || !SAFE_RE.test(id)) return res.status(400).json({ error: 'Invalid taskId' });
    try {
      const all = readOpinions();
      const arr = Array.isArray(all[id]) ? all[id] : [];
      return res.json(arr);
    } catch (e) {
      console.error(`GET ${basePath}/opinions error`, e && e.message ? e.message : e);
      return res.status(500).json([]);
    }
  });

  app.post(`${basePath}/opinions/:taskId`, (req, res) => {
    const id = req.params.taskId;
    const SAFE_RE = /^[A-Za-z0-9_.-]+$/;
    if (!id || id.indexOf('/') !== -1 || !SAFE_RE.test(id)) return res.status(400).json({ error: 'Invalid taskId' });
    try {
      const body = req.body || {};
      const title = (body.title || '').toString();
      const content = (body.body || body.content || '').toString();
      if (!title || !content) return res.status(400).json({ error: 'Missing title or body' });
      const opinions = readOpinions();
      const list = Array.isArray(opinions[id]) ? opinions[id] : [];
      const op = { id: genId('OP-'), createdAt: new Date().toISOString(), source: 'chatgpt', title: title, body: content };
      list.push(op);
      opinions[id] = list;
      writeOpinions(opinions);
      return res.json(op);
    } catch (e) {
      console.error(`POST ${basePath}/opinions error`, e && e.message ? e.message : e);
      return res.status(500).json({ error: 'internal' });
    }
  });
}

registerOpinionsEndpoints('/api');
registerOpinionsEndpoints('/taskboard/api');



// Standalone decision API for mobile / direct browser usage
// POST /taskboard/api/task/decision
// Expects JSON body containing taskId, decision, policy, selectedAction, editedAction, newAction, notes, source: 'taskboard-standalone', createdAt
// Requires Authorization: Bearer <TASKBOARD_API_TOKEN>
app.post('/taskboard/api/task/decision', async (req, res) => {
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
      try { if (fs.existsSync(producerEnv)) producer = producerEnv; } catch (e) { /* ignore */ }
    }
    if (!producer) {
      producer = which('kafka-console-producer.sh') || which('kafka-console-producer');
    }

    // Try CLI producer first (so KAFKA_CLIENT_CONFIG can be honored)
    if (producer) {
      const args = ['--bootstrap-server', process.env.KAFKA_BOOTSTRAP || 'localhost:9092', '--topic', topic];
      if (clientConfig) args.push('--producer.config', clientConfig);
      try {
        const proc = spawnSync(producer, args, { input: JSON.stringify(review_msg) + '\n', encoding: 'utf8', timeout: 30000, env: process.env });
        const meta = { topic, returnCode: proc.status, stdout: (proc.stdout || '').slice(-4000), stderr: (proc.stderr || '').slice(-4000), used_cli: true };
        if (proc.status === 0) {
          return res.json({ ok: true, published: true, meta });
        } else {
          console.error('Producer CLI failed', meta);
        }
      } catch (e) {
        console.error('Producer CLI exception', e && e.message ? e.message : e);
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
        return res.json({ ok: true, published: true, meta });
      } else {
        console.error('Python kafka wrapper failed', meta);
        return res.status(502).json({ ok: false, error: 'Failed to publish to Kafka', meta });
      }
    } catch (e) {
      console.error('Python kafka fallback exception', e && e.message ? e.message : e);
      return res.status(502).json({ ok: false, error: 'Failed to publish to Kafka', detail: e && e.message ? e.message : String(e) });
    }
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
  // additional heuristic: if path normalized to system directories like /taskboard/etc/*,
  // likely a traversal attempt such as /taskboard/api/results/../../etc/passwd -- reject
  if (req.path.startsWith('/taskboard/etc/') || req.path.startsWith('/taskboard/var/') || req.path.startsWith('/taskboard/usr/')) {
    return res.status(400).json({ error: 'Invalid taskId' });
  }
  // allow /taskboard/api/* to be handled by the api routes above
  if (req.path.startsWith('/taskboard/api/')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log('Server listening on port', port);
});
