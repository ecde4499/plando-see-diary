'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateStagingEnv, assertStagingSchema, REQUIRED_TABLES } = require('../tools/t07-staging-start.cjs');

const good = Object.freeze({
  T07_STAGING_ACK: 'I_VERIFIED_SEPARATE_DATABASE',
  T07_STAGING_DATABASE_URL: 'postgresql://staging:REDACTED@staging-db.invalid/plando_stage',
  PUBLIC_ORIGIN: 'https://plando-t07-test.onrender.com',
  RENDER_GIT_BRANCH: 'assignment-7',
  RENDER_EXTERNAL_URL: 'https://plando-t07-test.onrender.com',
  RENDER_GIT_REPO_SLUG: 'ecde4499/plando-see-diary'
});

test('T07 staging guard accepts only a separately specified staging database', () => {
  const result = validateStagingEnv({ ...good });
  assert.equal(result.publicOrigin, good.PUBLIC_ORIGIN);
  assert.equal(result.databaseUrl, good.T07_STAGING_DATABASE_URL);
});

test('T07 staging guard rejects accidental T06 DATABASE_URL reuse', () => {
  assert.throws(() => validateStagingEnv({ ...good, DATABASE_URL: good.T07_STAGING_DATABASE_URL }), /Do not supply DATABASE_URL/);
  assert.throws(() => validateStagingEnv({ ...good, T07_STAGING_ACK: '' }), /explicit separate-database verification/);
  assert.throws(() => validateStagingEnv({ ...good, T07_STAGING_DATABASE_URL: '' }), /T07_STAGING_DATABASE_URL/);
});

test('T07 staging guard refuses wrong repository or production branch', () => {
  assert.throws(() => validateStagingEnv({ ...good, RENDER_GIT_BRANCH: 'main' }), /assignment-7/);
  assert.throws(() => validateStagingEnv({ ...good, RENDER_GIT_REPO_SLUG: 'other/repo' }), /repo slug/);
});

test('T07 staging guard verifies exact HTTPS PUBLIC_ORIGIN', () => {
  assert.throws(() => validateStagingEnv({ ...good, PUBLIC_ORIGIN: 'http://plando-t07-test.onrender.com' }), /exact HTTPS origin/);
  assert.throws(() => validateStagingEnv({ ...good, PUBLIC_ORIGIN: 'https://plando-t07-test.onrender.com/diary' }), /exact HTTPS origin/);
  assert.throws(() => validateStagingEnv({ ...good, PUBLIC_ORIGIN: 'https://other.onrender.com' }), /must match/);
  assert.throws(() => validateStagingEnv({ ...good, PUBLIC_ORIGIN: 'https://user:secret@plando-t07-test.onrender.com' }), /exact HTTPS origin/);
});

test('T07 staging guard rejects invalid database URLs without exposing their values', () => {
  assert.throws(() => validateStagingEnv({ ...good, T07_STAGING_DATABASE_URL: 'https://not-postgresql.example/test' }), /PostgreSQL/);
  assert.throws(() => validateStagingEnv({ ...good, T07_STAGING_DATABASE_URL: 'not-a-url' }), /invalid/);
  assert.throws(() => validateStagingEnv({ ...good, T07_STAGING_DATABASE_URL: 'postgresql://user:secret@staging-db.invalid/' }), /database name/);
  assert.throws(() => validateStagingEnv({ ...good, T07_STAGING_DATABASE_URL: 'postgresql://user@staging-db.invalid/staging' }), /username and password/);
});

test('T07 staging schema check requires all T06 and T07 tables and owner column', async () => {
  const fakePool = {
    async query(sql) {
      if (sql.includes('information_schema.tables')) {
        return { rows: REQUIRED_TABLES.map(table_name => ({ table_name })) };
      }
      return { rowCount: 1 };
    }
  };
  await assert.doesNotReject(assertStagingSchema(fakePool));
});

test('T07 staging refuses an uninitialized or partially migrated database', async () => {
  const missingAuth = {
    async query(sql) {
      if (sql.includes('information_schema.tables')) {
        return { rows: REQUIRED_TABLES.filter(t => t !== 'app_users')
          .map(table_name => ({ table_name })) };
      }
      return { rowCount: 1 };
    }
  };
  await assert.rejects(assertStagingSchema(missingAuth), /missing: app_users/);
  const missingOwner = {
    async query(sql) {
      if (sql.includes('information_schema.tables')) {
        return { rows: REQUIRED_TABLES.map(table_name => ({ table_name })) };
      }
      return { rowCount: 0 };
    }
  };
  await assert.rejects(assertStagingSchema(missingOwner), /plans.owner_user_id/);
});
