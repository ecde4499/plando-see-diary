'use strict';
// Read-only checks against the public T07 staging deployment.
// Never creates test users, changes data, reads cookies, or displays secrets.
const assert = require('node:assert/strict');

const origin = 'https://plando-see-diary-t07-ecde4499.onrender.com';
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const checks = [
  { path: '/api/health', status: 200, confirm: async r => {
    const data = await r.json();
    assert.equal(data.ok, true, 'health must confirm connected database');
  } },
  { path: '/', status: 200, confirm: async r => {
    const html = await r.text();
    assert.ok(html.includes('id="authForm"'), 'login form missing');
    assert.ok(html.includes('id="showRegister"'), 'register tab missing');
  } },
  { path: '/api/auth/me', status: 401 },
  { path: '/api/plans', status: 401 },
  { path: '/api/tasks', status: 401 },
  { path: '/api/executions', status: 401 },
  { path: '/api/export', status: 401 },
  { path: '/diary', status: 302, location: '/' },
  { path: '/account', status: 302, location: '/' }
];

async function request(check) {
  const response = await fetch(origin + check.path, {
    redirect: 'manual',
    cache: 'no-store',
    headers: { 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(90000)
  });
  assert.equal(response.status, check.status, check.path + ' expected ' + check.status + ', got ' + response.status);
  if (check.location) assert.equal(response.headers.get('location'), check.location);
  if (check.confirm) await check.confirm(response);
  console.log('PASS', check.path, 'HTTP', response.status);
}

(async () => {
  // Render free instances may need a cold-start request. Do not change any server state.
  let healthError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await request(checks[0]); healthError = null; break; }
    catch (error) {
      healthError = error;
      if (attempt < 3) await sleep(8000);
    }
  }
  if (healthError) throw healthError;
  for (const check of checks.slice(1)) await request(check);
  console.log('T07 LIVE READ-ONLY HTTP: 9/9 PASS');
})().catch(error => {
  console.error('FAIL: T07 LIVE READ-ONLY HTTP:', error.message);
  process.exitCode = 1;
});
