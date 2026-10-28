'use strict';
// Run ONLY with a separate disposable PostgreSQL database:
// TEST_DATABASE_URL=postgres://... npm run test:http
// This script never uses DATABASE_URL as its test target.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Pool } = require('pg');

const url = process.env.TEST_DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//.test(url)) {
  console.error('TEST_DATABASE_URL is required. Use a dedicated, disposable TEST database.');
  process.exit(2);
}
const canonical = value => { const u = new URL(value); u.password = ''; return u.toString(); };
if (process.env.DATABASE_URL && canonical(url) === canonical(process.env.DATABASE_URL)) {
  console.error('Refusing to run against the same endpoint as DATABASE_URL.');
  process.exit(2);
}
const dbName = new URL(url).pathname.replace(/^\//, '').toLowerCase();
if (!/(^|[_-])(test|testing)([_-]|$)/.test(dbName)) {
  console.error('Test database name must contain a separate test marker (e.g. plando_test).');
  process.exit(2);
}
const pool = new Pool({ connectionString: url, ssl: /supabase|render\.com/.test(url) ? { rejectUnauthorized: false } : undefined });
const root = path.resolve(__dirname, '..');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = 19000 + Math.floor(Math.random() * 10000);
const base = `http://127.0.0.1:${port}`;
let child;
async function request(method, route, body, cookie, extra = {}) {
  const headers = { Origin: base, ...extra };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const data = await response.json();
  return { status: response.status, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
function expectStatus(result, code, description) {
  assert.equal(result.status, code, `${description}: expected ${code}, got ${result.status}; ${JSON.stringify(result.data)}`);
}
async function main() {
  // Additive schema creation only, in the explicitly provided disposable test DB.
  await pool.query(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
  await pool.query(fs.readFileSync(path.join(root, 'db/migrations/007_auth_foundation.sql'), 'utf8'));
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test', PORT: String(port) }
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += String(chunk).slice(0, 1000); });
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (child.exitCode !== null) throw new Error('Test server exited unexpectedly');
    try { const r = await fetch(base + '/api/health'); if (r.ok) { ready = true; break; } } catch {}
    await pause(100);
  }
  if (!ready) throw new Error('Test server did not start: ' + stderr.slice(0, 200));

  const nonce = require('node:crypto').randomUUID().slice(0, 8);
  const emailA = `a-${nonce}@example.test`, emailB = `b-${nonce}@example.test`;
  const pass = 'Test-only-Password-12345!';
  const a = await request('POST', '/api/auth/register', { email: emailA, password: pass });
  const b = await request('POST', '/api/auth/register', { email: emailB, password: pass });
  expectStatus(a, 201, 'A register'); expectStatus(b, 201, 'B register');
  assert.ok(a.cookie && b.cookie);
  expectStatus(await request('GET', '/api/plans'), 401, 'anonymous plans');
  expectStatus(await request('GET', '/api/export'), 401, 'anonymous export');
  const planBody = { title: 'HTTP isolation test', start_date: '2026-10-01', end_date: '2026-10-31',
    priority: '보통', success_criteria: 'pass', estimated_minutes: 20 };
  const created = await request('POST', '/api/plans', planBody, a.cookie);
  expectStatus(created, 201, 'A create plan');
  const planId = created.data.id;
  assert.ok(planId);
  const bPlans = await request('GET', '/api/plans', undefined, b.cookie);
  expectStatus(bPlans, 200, 'B plans');
  assert.ok(!bPlans.data.some(p => p.id === planId), 'B must not see A plan');
  expectStatus(await request('PUT', '/api/plans/' + planId, { ...planBody, title: 'stolen' }, b.cookie), 404, 'B cannot update A plan');
  expectStatus(await request('POST', '/api/tasks', {
    plan_id: planId, title: 'stolen task', priority: '보통', estimated_minutes: 1
  }, b.cookie), 404, 'B cannot add to A plan');
  const aTask = await request('POST', '/api/tasks', {
    plan_id: planId, title: 'A task', priority: '보통', estimated_minutes: 1
  }, a.cookie);
  expectStatus(aTask, 201, 'A create task');
  expectStatus(await request('DELETE', '/api/tasks/' + aTask.data.id, undefined, b.cookie), 404, 'B cannot delete A task');
  const exportedB = await request('GET', '/api/export', undefined, b.cookie);
  expectStatus(exportedB, 200, 'B export');
  assert.ok(!exportedB.data.plans.some(p => p.id === planId), 'B export must exclude A plan');
  expectStatus(await request('POST', '/api/auth/logout', {}, a.cookie), 200, 'A logout');
  expectStatus(await request('GET', '/api/plans', undefined, a.cookie), 401, 'revoked A cookie');
  console.log('PASS: signup A/B, anonymous 401, cross-account read/update/delete 404, export isolation, logout revocation');
  console.log('Note: test creates disposable test records; no production data is touched.');
}
main().catch(err => { console.error('HTTP integration FAILED:', err.message); process.exitCode = 1; })
  .finally(async () => {
    if (child) child.kill('SIGTERM');
    await pool.end();
  });
