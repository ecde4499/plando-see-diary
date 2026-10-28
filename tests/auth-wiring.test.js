'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server', 'index.js'), 'utf8');

test('T07 authentication routes are mounted before legacy data routes', () => {
  const auth = server.indexOf("app.use('/api/auth', createAuthRouter(express, pool))");
  const legacy = server.indexOf("app.get('/api/plans'");
  assert.ok(auth >= 0, 'auth router is mounted');
  assert.ok(legacy > auth, 'auth router precedes legacy routes');
});

test('T07 legacy data APIs fail closed until account scoping is implemented', () => {
  const guard = server.indexOf("app.use('/api', (req, res, next) => {");
  const legacy = server.indexOf("app.get('/api/plans'");
  assert.ok(guard > 0 && guard < legacy, 'guard must precede all legacy data routes');
  assert.match(server.slice(guard, legacy), /res\.status\(503\)/);
});
