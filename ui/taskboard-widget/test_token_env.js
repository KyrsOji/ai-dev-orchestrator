#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

(function main(){
  // Create a temporary token file (test-only dummy token)
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-token-'));
  const token = 'tok_' + Math.random().toString(36).slice(2, 18);
  const tokenFile = path.join(tmpdir, 'token.txt');
  fs.writeFileSync(tokenFile, token, { mode: 0o600 });

  // Clear any existing token and point to the file
  delete process.env.TASKBOARD_API_TOKEN;
  process.env.TASKBOARD_API_TOKEN_FILE = tokenFile;

  // Replicate getServerToken/propagateServerTokenToEnv logic
  let t = process.env.TASKBOARD_API_TOKEN || null;
  if (!t && process.env.TASKBOARD_API_TOKEN_FILE) {
    try {
      t = fs.readFileSync(process.env.TASKBOARD_API_TOKEN_FILE, 'utf8').trim();
    } catch (e) { t = null; }
  }
  if (t) process.env.TASKBOARD_API_TOKEN = t;

  // Spawn a child that only prints the length of the TASKBOARD_API_TOKEN (never prints the token)
  const child = spawnSync(process.execPath, ['-e', "console.log(process.env.TASKBOARD_API_TOKEN ? process.env.TASKBOARD_API_TOKEN.length : 0)"], { encoding: 'utf8', env: process.env });
  const out = (child.stdout || '').trim();
  const code = child.status;
  if (code !== 0) {
    console.error('child process failed', child.stderr);
    process.exit(2);
  }
  const len = parseInt(out || '0', 10);
  const expected = token.length;
  if (len === expected) {
    console.log('OK: child saw TASKBOARD_API_TOKEN length:', len);
    process.exit(0);
  } else {
    console.error('FAIL: child saw length', len, 'expected', expected);
    process.exit(1);
  }
})();
