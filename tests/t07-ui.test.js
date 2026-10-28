'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
test('T07 login page and diary route are wired', () => {
 const root = path.join(__dirname, '..');
 const server = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
 const login = fs.readFileSync(path.join(root, 'public', 't07-login.html'), 'utf8');
 assert.ok(server.includes("app.get('/diary', requireAuth(pool)"));
 assert.ok(server.includes('t07-login.html'));
 assert.ok(login.includes('id="authForm"'));
 assert.ok(login.includes('id="showRegister"'));
});
