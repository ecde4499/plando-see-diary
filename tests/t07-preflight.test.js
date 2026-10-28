'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { inventory, summarize, TABLES } = require('../tools/t07-preflight.cjs');

function fakePool({ hasOwner = false, failCount = false } = {}) {
  const queries = [];
  let released = false;
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql === 'BEGIN READ ONLY' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 };
      if (sql === 'SELECT to_regclass($1) AS name') {
        const table = values[0].slice('public.'.length);
        return { rows: [{ name: TABLES.includes(table) && !['app_users', 'auth_sessions'].includes(table) ? table : null }] };
      }
      if (sql.includes('information_schema.columns')) {
        return { rows: hasOwner ? [{}] : [], rowCount: hasOwner ? 1 : 0 };
      }
      if (sql.includes('FILTER (WHERE owner_user_id')) {
        return { rows: [{ owned: '1', unclaimed: '3' }] };
      }
      if (sql.includes('COUNT(*)::bigint')) {
        if (failCount) throw new Error('mock SELECT failure');
        return { rows: [{ n: '4' }] };
      }
      throw new Error('Unexpected query: ' + sql);
    },
    release() { released = true; }
  };
  return { pool: { connect: async () => client }, queries, get released() { return released; } };
}

test('preflight inventory is a read-only transaction on T06 schema', async () => {
  const fixture = fakePool();
  const report = await inventory(fixture.pool);
  assert.equal(report.mode, 'READ_ONLY');
  assert.equal(report.auth_schema_present, false);
  assert.equal(report.plans_unclaimed, 4);
  assert.equal(report.tables.plans, 4);
  assert.equal(report.tables.app_users, null);
  assert.equal(fixture.queries[0].sql, 'BEGIN READ ONLY');
  assert.equal(fixture.queries.at(-1).sql, 'COMMIT');
  assert.ok(fixture.queries.every(item => !/\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE)\b/i.test(item.sql)));
  assert.ok(fixture.released);
});

test('preflight counts claimed and unclaimed plans without exposing records', () => {
  const report = summarize({ plans: 4, app_users: 2, auth_sessions: 1 }, true, 1, 3);
  assert.equal(report.auth_schema_present, true);
  assert.equal(report.plans_with_owner, 1);
  assert.equal(report.plans_unclaimed, 3);
  assert.deepEqual(Object.keys(report).sort(), [
    'auth_schema_present', 'checked_at_utc', 'mode', 'plans_unclaimed',
    'plans_with_owner', 'tables'
  ]);
});

test('preflight rolls back and releases connection if a SELECT fails', async () => {
  const fixture = fakePool({ failCount: true });
  await assert.rejects(inventory(fixture.pool), /mock SELECT failure/);
  assert.equal(fixture.queries.at(-1).sql, 'ROLLBACK');
  assert.ok(fixture.released);
});
