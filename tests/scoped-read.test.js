'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const scoped = fs.readFileSync(path.join(__dirname, '..', 'server', 'scoped-read.js'), 'utf8');

test('scoped read router mounts before fail-closed legacy guard', () => {
  const mounted = server.indexOf("app.use('/api', createScopedReadRouter(express, pool, requireAuth))");
  const guard = server.indexOf("app.use('/api', (req, res, next) => {");
  assert.ok(mounted > 0 && guard > mounted);
});

test('all supported read endpoints require authentication', () => {
  assert.match(scoped, /router\.use\(requireAuth\(pool\)\)/);
  for (const route of ['/plans', '/tasks', '/executions', '/export']) {
    assert.ok(scoped.includes(`router.get('${route}'`), route);
  }
});

test('export tables use account-scoped plan ownership', () => {
  for (const table of ['plans', 'plan_revisions', 'tasks', 'execution_logs', 'completion_events', 'reflections']) {
    assert.match(scoped, new RegExp(`\\b${table}:\\s*'SELECT`));
  }
  assert.match(scoped, /p\.owner_user_id=\$1/);
  assert.match(scoped, /owner_user_id=\$1/);
});
