'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('T07 credential lifecycle routes revoke sessions and scope account deletion', () => {
  const root = path.join(__dirname, '..');
  const auth = fs.readFileSync(path.join(root, 'server', 'auth.js'), 'utf8');
  assert.ok(auth.includes("router.post('/change-password'"));
  assert.ok(auth.includes("router.post('/delete-account'"));
  assert.ok(auth.includes('UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1'));
  assert.ok(auth.includes('DELETE FROM plans WHERE owner_user_id=$1'));
  assert.ok(auth.includes('DELETE FROM app_users WHERE id=$1'));
});

test('T07 account settings requires authentication and deletion confirmation', () => {
  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server', 'index.js'), 'utf8');
  const settings = fs.readFileSync(path.join(root, 'public', 't07-settings.html'), 'utf8');
  const deletion = fs.readFileSync(path.join(root, 'public', 't07-delete.js'), 'utf8');
  assert.ok(server.includes("app.get('/account', requireAuth(pool)"));
  assert.ok(settings.includes('id="passwordForm"'));
  assert.ok(deletion.includes("window.confirm("));
  assert.ok(deletion.includes('/api/auth/delete-account'));
});
