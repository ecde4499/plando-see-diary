'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { requireSameOrigin } = require('../server/origin');

function check(origin) {
  let passed = false, denied = false;
  const req = { get: key => key === 'origin' ? origin : 'localhost:3333' };
  const res = { status: code => {
    assert.equal(code, 403);
    denied = true;
    return { json: () => undefined };
  }};
  requireSameOrigin(req, res, () => { passed = true; });
  return { passed, denied };
}
test('same-origin cookie mutations require valid Origin', () => {
  const before = process.env.PUBLIC_ORIGIN;
  const prod = process.env.NODE_ENV;
  delete process.env.PUBLIC_ORIGIN;
  process.env.NODE_ENV = 'test';
  try {
    assert.deepEqual(check('http://localhost:3333'), { passed: true, denied: false });
    assert.deepEqual(check('http://malicious.invalid'), { passed: false, denied: true });
    assert.deepEqual(check(undefined), { passed: false, denied: true });
  } finally {
    if (before === undefined) delete process.env.PUBLIC_ORIGIN;
    else process.env.PUBLIC_ORIGIN = before;
    if (prod === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prod;
  }
});
