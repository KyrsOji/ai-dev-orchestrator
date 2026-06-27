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

async function runTests() {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-test-'));
  const suggestionsFile = path.join(tmpRoot, 'followup_suggestions.jsonl');
  const decisionsFile = path.join(tmpRoot, 'followup_decisions.jsonl');
  const publishedFile = path.join(tmpRoot, 'followup_published.jsonl');

  const now = new Date().toISOString();
  const s1 = { suggestionId: 's1', parentTaskId: 't1', conversationId: 'c1', title: 'Followup 1', description: 'desc1', reason: 'reason1', source: 'auto-test', generatedAt: now };
  const s2 = { suggestionId: 's2', parentTaskId: 't2', conversationId: 'c2', title: 'Followup 2', description: 'desc2', reason: 'reason2', source: 'auto-test', generatedAt: now };

  // write suggestions with a malformed line in the middle
  const lines = [JSON.stringify(s1), 'THIS IS MALFORMED', JSON.stringify(s2)];
  fs.writeFileSync(suggestionsFile, lines.join('\n') + '\n', { encoding: 'utf8' });
  fs.writeFileSync(decisionsFile, '', { encoding: 'utf8' });
  fs.writeFileSync(publishedFile, '', { encoding: 'utf8' });

  const port = 30000 + Math.floor(Math.random() * 20000);
  const env = Object.assign({}, process.env, {
    PORT: String(port),
    TASKBOARD_API_TOKEN: 'test-token',
    FOLLOWUP_SUGGESTIONS_FILE: suggestionsFile,
    FOLLOWUP_DECISIONS_FILE: decisionsFile,
    FOLLOWUP_PUBLISHED_FILE: publishedFile,
  });

  console.log('Starting server on port', port, 'using tmp dir', tmpRoot);
  const server = spawn('node', ['server.js'], { cwd: path.join(__dirname), env, stdio: ['ignore', 'pipe', 'pipe'] });

  server.stdout.on('data', (d) => process.stdout.write(`[server stdout] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[server stderr] ${d}`));

  let serverExited = false;
  server.on('exit', (code, sig) => { serverExited = true; console.log('server exited', code, sig); });

  // wait until /health responds or timeout
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
  console.log('Server ready');

  const failures = [];
  function expect(cond, msg) { if (!cond) { failures.push(msg); console.error('FAIL:', msg); } else { console.log('OK:', msg); } }

  // 1) GET returns suggestions with decision/published state (malformed ignored)
  const get1 = await httpRequest({ method: 'GET', port, path: '/taskboard/api/followups' });
  expect(get1.statusCode === 200, 'GET /taskboard/api/followups returns 200');
  let arr1 = [];
  try { arr1 = JSON.parse(get1.body); } catch (e) { failures.push('GET returned invalid JSON'); }
  expect(Array.isArray(arr1), 'GET returned array');

  // Expect two valid suggestions (malformed ignored)
  expect(arr1.length === 2, `Expected 2 suggestions, got ${arr1.length}`);

  const foundS1 = arr1.find((x) => x.suggestionId === 's1');
  const foundS2 = arr1.find((x) => x.suggestionId === 's2');
  expect(foundS1 && foundS1.decision === 'pending', 's1 present and decision pending');
  expect(foundS2 && foundS2.decision === 'pending', 's2 present and decision pending');
  expect(foundS1 && !foundS1.published, 's1 not published');
  expect(foundS2 && !foundS2.published, 's2 not published');

  // 2) Missing JSONL files returns []
  const suggestionsBak = suggestionsFile + '.bak';
  fs.renameSync(suggestionsFile, suggestionsBak);
  try {
    const missingResp = await httpRequest({ method: 'GET', port, path: '/taskboard/api/followups' });
    expect(missingResp.statusCode === 200, 'GET still returns 200 when file missing');
    const arr2 = JSON.parse(missingResp.body);
    expect(Array.isArray(arr2) && arr2.length === 0, 'Missing suggestions file results in empty array');
  } finally {
    // restore
    fs.renameSync(suggestionsBak, suggestionsFile);
  }

  // 3) Malformed JSONL lines are ignored (already asserted by count==2)
  // 4) Approve requires Bearer token
  const approverNoAuth = await httpRequest({ method: 'POST', port, path: '/taskboard/api/followups/s1/approve', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(approverNoAuth.statusCode === 401, 'Approve without Authorization returns 401');

  // 5) Reject requires Bearer token
  const rejectNoAuth = await httpRequest({ method: 'POST', port, path: '/taskboard/api/followups/s2/reject', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(rejectNoAuth.statusCode === 401, 'Reject without Authorization returns 401');

  // 6) Approve writes a decision through reviewer.followup_approval
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' };
  const approveResp = await httpRequest({ method: 'POST', port, path: '/taskboard/api/followups/s1/approve', headers, body: '{}' });
  expect(approveResp.statusCode === 200, 'Approve with token returns 200');
  let approveBody = null;
  try { approveBody = JSON.parse(approveResp.body); } catch (e) { failures.push('Approve returned invalid JSON'); }
  expect(approveBody && approveBody.ok === true, 'Approve response ok:true');

  // Check decisions file has an approved record for s1
  const decisionsRaw = fs.readFileSync(decisionsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const foundDecisionS1 = decisionsRaw.map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).find((o) => o && o.suggestionId === 's1');
  expect(foundDecisionS1 && foundDecisionS1.decision === 'approved', 'Decisions file contains approved entry for s1');

  // 7) Reject writes a decision through reviewer.followup_approval
  const rejectResp = await httpRequest({ method: 'POST', port, path: '/taskboard/api/followups/s2/reject', headers, body: '{}' });
  expect(rejectResp.statusCode === 200, 'Reject with token returns 200');
  const decisionsRaw2 = fs.readFileSync(decisionsFile, 'utf8').trim().split(/\r?\n/).filter(Boolean);
  const foundDecisionS2 = decisionsRaw2.map((l) => { try { return JSON.parse(l); } catch (e) { return null; } }).find((o) => o && o.suggestionId === 's2');
  expect(foundDecisionS2 && foundDecisionS2.decision === 'rejected', 'Decisions file contains rejected entry for s2');

  // 8) Publish requires approved suggestion: try to publish s2 (rejected)
  const publishS2 = await httpRequest({ method: 'POST', port, path: '/taskboard/api/followups/s2/publish', headers, body: '{}' });
  // server returns 502 for python errors / not approved
  expect(publishS2.statusCode === 502, 'Publish of not-approved suggestion returns 502');
  try {
    const pbody = JSON.parse(publishS2.body);
    const meta = pbody && pbody.meta;
    const err = (pbody && pbody.error) || (meta && meta.error) || (meta && meta['publisher_meta'] && meta['publisher_meta'].error) || null;
    expect(err === 'not_approved_or_already_published' || err != null, 'Publish error indicates not-approved or other publisher error');
  } catch (e) { failures.push('Publish s2 returned invalid JSON'); }

  // 9) Publish duplicate prevention is surfaced clearly
  // Simulate s1 already published by appending a published record
  const publishedRec = { suggestionId: 's1', publishedAt: new Date().toISOString(), topic: 'ai.dev.approval.required' };
  fs.appendFileSync(publishedFile, JSON.stringify(publishedRec) + '\n', { encoding: 'utf8' });

  const publishS1Dup = await httpRequest({ method: 'POST', port, path: '/taskboard/api/followups/s1/publish', headers, body: '{}' });
  expect(publishS1Dup.statusCode === 502, 'Publish of already-published suggestion returns 502');
  try {
    const pbody = JSON.parse(publishS1Dup.body);
    const err = (pbody && pbody.error) || (pbody && pbody.meta && pbody.meta.error) || null;
    expect(err === 'not_approved_or_already_published' || err != null, 'Duplicate publish surfaced as not_approved_or_already_published or similar');
  } catch (e) { failures.push('Publish s1 duplicate returned invalid JSON'); }

  // final status
  server.kill();
  await sleep(200);

  if (failures.length) {
    console.error('TESTS FAILED:', failures.length, 'failures');
    process.exit(1);
  }
  console.log('ALL TESTS PASSED');
  process.exit(0);
}

runTests().catch((err) => { console.error('ERROR', err && err.stack ? err.stack : err); process.exit(2); });
