'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('T07 HTTP smoke: login entry and unauthenticated API denial (no DB access)', { timeout: 15000 }, async () => {
  const port = await unusedPort();
  const base = 'http://127.0.0.1:' + port;
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), NODE_ENV: 'test',
      DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused_test' },
    stdio: 'ignore'
  });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      if (child.exitCode !== null) throw new Error('Server exited before ready');
      try {
        const response = await fetch(base + '/');
        if (response.ok) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.ok(ready, 'The login page must respond');
    const login = await fetch(base + '/');
    assert.equal(login.status, 200);
    assert.match(await login.text(), /id="authForm"/);
    // No DB exists in this smoke fixture, so health must report a DB error,
    // NOT a login error. This catches a globally mounted auth middleware
    // intercepting the readiness check.
    const health = await fetch(base + '/api/health');
    assert.equal(health.status, 503, 'no DB should mean 503, never 401');
    const healthBody = await health.json();
    assert.equal(healthBody.error, 'DB 연결 실패');
    assert.equal(healthBody.ok, false);
    const unauth = await fetch(base + '/api/plans');
    assert.equal(unauth.status, 401);
    const exportResponse = await fetch(base + '/api/export');
    assert.equal(exportResponse.status, 401);
    const diary = await fetch(base + '/diary', { redirect: 'manual' });
    assert.equal(diary.status, 302);
    assert.equal(diary.headers.get('location'), '/');
    const previous = await fetch(base + '/index.html', { redirect: 'manual' });
    assert.equal(previous.status, 302);
    console.log('HTTP smoke PASS: unauthenticated health returns database status, not 401');
  } finally {
    child.kill('SIGTERM');
  }
});
