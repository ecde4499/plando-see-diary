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
const testHost = new URL(url).hostname;
const isLocalTestDatabase = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(testHost);
if (!isLocalTestDatabase && process.env.ALLOW_REMOTE_TEST_DB !== 'I_UNDERSTAND_TEST_DB_IS_DISPOSABLE') {
  console.error('Refusing remote test DB by default. Use local PostgreSQL or explicit disposable remote DB opt-in.');
  process.exit(2);
}
const pool = new Pool({ connectionString: url,
  ssl: isLocalTestDatabase ? false : { rejectUnauthorized: false } });
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
    env: { ...process.env, DATABASE_URL: url, DATABASE_SSL: isLocalTestDatabase ? 'false' : process.env.DATABASE_SSL, NODE_ENV: 'test', PORT: String(port) }
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
  // Every record type must resist crossing the plan ownership boundary.
  expectStatus(await request('GET', '/api/summary/' + planId, undefined, b.cookie), 404, 'B cannot read A summary');
  expectStatus(await request('GET', '/api/summary/' + planId + '/evidence/planCount', undefined, b.cookie),
    404, 'B cannot read A evidence');
  expectStatus(await request('GET', '/api/reflections/' + planId, undefined, b.cookie), 404,
    'B cannot read A reflections');
  const bTasksForA = await request('GET', '/api/tasks?plan_id=' + planId, undefined, b.cookie);
  expectStatus(bTasksForA, 200, 'B filtered tasks');
  assert.equal(bTasksForA.data.length, 0, 'B cannot enumerate A tasks');
  const bExecutionsForA = await request('GET', '/api/executions?task_id=' + aTask.data.id, undefined, b.cookie);
  expectStatus(bExecutionsForA, 200, 'B filtered executions');
  assert.equal(bExecutionsForA.data.length, 0, 'B cannot enumerate A executions');
  expectStatus(await request('POST', '/api/executions', {
    task_id: aTask.data.id, started_at: '2026-10-28T10:00:00+09:00',
    ended_at: '2026-10-28T10:10:00+09:00', actual_minutes: 10
  }, b.cookie), 404, 'B cannot write A execution');
  expectStatus(await request('POST', '/api/reflections', {
    source_plan_id: planId, improvement_text: 'unauthorized'
  }, b.cookie), 404, 'B cannot write A reflection');
  expectStatus(await request('POST', '/api/tasks/' + aTask.data.id + '/complete', {
    idempotency_key: 'b-unauthorized-key'
  }, b.cookie), 404, 'B cannot complete A task');
  expectStatus(await request('POST', '/api/tasks/' + aTask.data.id + '/reopen', {}, b.cookie), 404,
    'B cannot reopen A task');
  expectStatus(await request('POST', '/api/plans', planBody), 401, 'Anonymous cannot create plan');
  expectStatus(await request('POST', '/api/plans', planBody, a.cookie, {
    Origin: 'https://attacker.invalid'
  }), 403, 'CSRF request with foreign Origin is denied');
  const exportedB = await request('GET', '/api/export', undefined, b.cookie);
  expectStatus(exportedB, 200, 'B export');
  assert.ok(!exportedB.data.plans.some(p => p.id === planId), 'B export must exclude A plan');
  // Check the reverse direction, forged owner IDs and plan-specific reads.
  const createdB = await request('POST', '/api/plans', {
    ...planBody, title: 'B private plan', owner_user_id: a.data.user.id
  }, b.cookie);
  expectStatus(createdB, 201, 'B create own plan despite forged owner in body');
  assert.equal(createdB.data.owner_user_id, b.data.user.id, 'server controls plan owner');
  expectStatus(await request('GET', '/api/summary/' + createdB.data.id, undefined, a.cookie),
    404, 'A cannot read B summary');
  expectStatus(await request('GET', '/api/plans/' + createdB.data.id + '/revisions', undefined, a.cookie),
    404, 'A cannot read B plan history');
  expectStatus(await request('PUT', '/api/plans/' + createdB.data.id, planBody, a.cookie, {
    'X-User-Id': b.data.user.id
  }), 404, 'A forged header cannot edit B plan');
  const bTask = await request('POST', '/api/tasks', {
    plan_id: createdB.data.id, title: 'B task', priority: '보통', estimated_minutes: 1
  }, b.cookie);
  expectStatus(bTask, 201, 'B create task');
  expectStatus(await request('DELETE', '/api/tasks/' + bTask.data.id, undefined, a.cookie),
    404, 'A cannot delete B task');
  expectStatus(await request('PUT', '/api/tasks/' + aTask.data.id, {
    plan_id: createdB.data.id, title: 'cross account move',
    priority: '보통', estimated_minutes: 1
  }, a.cookie), 404, 'A cannot move own task into B plan');
  const aExport = await request('GET', '/api/export', undefined, a.cookie);
  expectStatus(aExport, 200, 'A export');
  assert.ok(!aExport.data.plans.some(p => p.id === createdB.data.id), 'A export must exclude B plan');
  const bExport = await request('GET', '/api/export', undefined, b.cookie);
  expectStatus(bExport, 200, 'B export after create');
  assert.ok(!bExport.data.plans.some(p => p.id === planId), 'B export must exclude A plan');
  expectStatus(await request('POST', '/api/auth/logout', {}, a.cookie), 200, 'A logout');
  expectStatus(await request('GET', '/api/plans', undefined, a.cookie), 401, 'revoked A cookie');
  // Password rotation must invalidate every existing session, including other devices.
  const change = await request('POST', '/api/auth/change-password', {
    current_password: pass, new_password: 'New-test-only-Password-98765!'
  }, b.cookie);
  expectStatus(change, 200, 'B password change');
  expectStatus(await request('GET', '/api/plans', undefined, b.cookie), 401,
    'B prior session revoked on password change');
  expectStatus(await request('POST', '/api/auth/login', {
    email: emailB, password: pass
  }), 401, 'B previous password rejected');
  const afterChange = await request('POST', '/api/auth/login', {
    email: emailB, password: 'New-test-only-Password-98765!'
  });
  expectStatus(afterChange, 200, 'B login after rotation');
  assert.ok(afterChange.cookie, 'new session cookie is issued');
  expectStatus(await request('POST', '/api/auth/delete-account', {
    password: 'New-test-only-Password-98765!'
  }, afterChange.cookie), 200, 'B delete account');
  expectStatus(await request('GET', '/api/plans', undefined, afterChange.cookie), 401,
    'deleted B session rejected');
  const survivingAPlan = await pool.query('SELECT 1 FROM plans WHERE id=$1', [planId]);
  assert.equal(survivingAPlan.rowCount, 1, 'B deletion does not delete A plans');
  const remainingBPlan = await pool.query('SELECT 1 FROM plans WHERE id=$1', [createdB.data.id]);
  assert.equal(remainingBPlan.rowCount, 0, 'B deletion removes only own plans');
  console.log('PASS: cross-account reads/writes/forgeries, CSRF, rotation, deletion, logout');
  console.log('No production environment or data was used.');

  console.log('Note: test creates disposable test records; no production data is touched.');
}
main().catch(err => { console.error('HTTP integration FAILED:', err.message); process.exitCode = 1; })
  .finally(async () => {
    if (child) child.kill('SIGTERM');
    await pool.end();
  });
