const express = require('express');
const path = require('path');
const fs = require('fs');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
const DATA_FILE = '/tmp/taskboard-mvp.json';

app.use(cors());
app.use(bodyParser.json());

function readData() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const sample = [
        {
          taskId: 'TASK-1',
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
          taskId: 'TASK-2',
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
  const task = req.body;
  const data = readData();
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
  const task = req.body;
  const data = readData();
  const idx = data.findIndex((t) => t.taskId === task.taskId);
  if (idx >= 0) data[idx] = task;
  else data.push(task);
  writeData(data);
  res.json(data);
});

// SPA fallback for /taskboard/* (serve index.html)
app.get(['/taskboard', '/taskboard/'], (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});
app.get('/taskboard/*', (req, res, next) => {
  // allow /taskboard/api/* to be handled by the api routes above
  if (req.path.startsWith('/taskboard/api/')) return next();
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log('Server listening on port', port);
});
