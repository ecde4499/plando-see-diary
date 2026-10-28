'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, normalizeEmail, digestToken } = require('../server/auth');

test('same password receives different salted hashes', async () => {
  const a = await hashPassword('safe-example-password-123');
  const b = await hashPassword('safe-example-password-123');
  assert.notEqual(a, b);
  assert.equal(await verifyPassword('safe-example-password-123', a), true);
  assert.equal(await verifyPassword('safe-example-password-123', b), true);
  assert.equal(await verifyPassword('wrong-password', a), false);
  assert.equal(a.includes('safe-example-password-123'), false);
});

test('malformed password hashes are rejected', async () => {
  assert.equal(await verifyPassword('safe-example-password-123', 'plaintext'), false);
  assert.equal(await verifyPassword('safe-example-password-123', ''), false);
});

test('email normalization and token digest are deterministic', () => {
  assert.equal(normalizeEmail('  Example@Example.COM '), 'example@example.com');
  assert.equal(digestToken('token'), digestToken('token'));
  assert.notEqual(digestToken('token'), digestToken('another-token'));
});
