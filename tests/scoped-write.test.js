'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');
const writes = fs.readFileSync(path.join(__dirname, '..', 'server', 'scoped-write.js'), 'utf8');

test('scoped write router precedes legacy fail-closed guard', () => {
  const mounted = server.indexOf("app.use('/api', createScopedWriteRouter(express, pool, requireAuth))");
  const guard = server.indexOf("app.use('/api', (req, res, next) => {");
  assert.ok(mounted > 0 && guard > mounted);
});

test('write routes require auth and never trust client-supplied owner IDs', () => {
  assert.match(writes, /router\.use\(requireAuth\(pool\)\)/);
  assert.match(writes, /req\.authUser\.id/);
  assert.doesNotMatch(writes, /req\.body\.owner_user_id|req\.body\.user_id/);
  for (const route of ["'/plans'", "'/plans/:id'", "'/tasks'", "'/tasks/:id'", "'/tasks/:id/complete'", "'/tasks/:id/reopen'", "'/executions'", "'/reflections'"]) {
    assert.ok(writes.includes(route), route);
  }
  assert.match(writes, /router\.delete\('\/tasks\/:id'/);
});

test('write SQL checks plan ownership and mutation Origin', () => {
  assert.match(writes, /owner_user_id/);
  assert.match(writes, /req\.get\('origin'\)/);
  assert.match(writes, /res\.status\(403\)/);
  assert.match(writes, /FOR UPDATE OF t/);
});
