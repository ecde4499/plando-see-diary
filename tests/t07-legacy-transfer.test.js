'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateTransferInput } = require('../tools/t07-legacy-transfer.cjs');

const A = '0bde5324-0123-4123-8123-000000000001';
const B = '0bde5324-0123-4123-8123-000000000002';

test('T07 legacy transfer requires an explicit account UUID and selected unique plan IDs', () => {
  assert.throws(() => validateTransferInput({ targetUserId: 'invalid', planIds: [B] }), /UUID/);
  assert.throws(() => validateTransferInput({ targetUserId: A, planIds: [] }), /1-100/);
  assert.throws(() => validateTransferInput({ targetUserId: A, planIds: [B, B] }), /Duplicate/);
  assert.deepEqual(validateTransferInput({ targetUserId: A, planIds: [B] }), {
    targetUserId: A, planIds: [B], apply: false
  });
});

test('T07 legacy transfer cannot apply without staging-only approval', () => {
  assert.throws(() => validateTransferInput({
    targetUserId: A, planIds: [B], apply: true
  }), /Production transfer is disabled/);
  assert.throws(() => validateTransferInput({
    targetUserId: A, planIds: [B], apply: true, approval: 'operator'
  }), /Production transfer is disabled/);
});

test('T07 legacy transfer refuses apply outside NODE_ENV=test', () => {
  const before = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() => validateTransferInput({
      targetUserId: A, planIds: [B], apply: true, approval: 'DISPOSABLE_DB_ONLY'
    }), /Production transfer is disabled/);
  } finally {
    if (before === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = before;
  }
});
