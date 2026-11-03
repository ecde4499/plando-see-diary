'use strict';

// Deliberately separate T07 staging startup from T06's npm start.
// No secrets or connection strings are ever printed by this guard.
function validateStagingEnv(env) {
  if (env.T07_STAGING_ACK !== 'I_VERIFIED_SEPARATE_DATABASE') {
    throw new Error('T07 staging requires explicit separate-database verification.');
  }
  if (env.DATABASE_URL) {
    throw new Error('Do not supply DATABASE_URL to the staging start command; use only T07_STAGING_DATABASE_URL.');
  }
  let database;
  if (env.T07_STAGING_DB_PASSWORD) {
    // The user sets only the database password in the Render secret environment.
    // A fixed T07-only Supabase pooler URI avoids mistakes with hostnames, path,
    // and URL-reserved characters in the password.
    database = new URL(
      'postgresql://postgres.rbetvzfagztuctqoavwt@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres'
    );
    // URL.password does not encode a literal '%' for non-special protocols.
    // Encode before assigning so all reserved characters survive pg URL parsing.
    database.password = encodeURIComponent(env.T07_STAGING_DB_PASSWORD);
  } else {
    if (!env.T07_STAGING_DATABASE_URL) {
      throw new Error('T07_STAGING_DATABASE_URL or T07_STAGING_DB_PASSWORD is required for the isolated staging service.');
    }
    try { database = new URL(env.T07_STAGING_DATABASE_URL); }
    catch { throw new Error('T07 staging database URL is invalid.'); }
  }
  if (!['postgres:', 'postgresql:'].includes(database.protocol)) {
    throw new Error('T07 staging PostgreSQL URL must begin with postgresql:// or postgres://. Set the full Session pooler URI, not a password or hostname alone.');
  }
  if (!database.hostname) {
    throw new Error('T07 staging PostgreSQL URL is missing the database server hostname.');
  }
  if (!database.pathname || database.pathname === '/') {
    // The isolated Supabase staging project uses the default PostgreSQL database.
    // Normalize a missing path without reading or printing database credentials.
    database.pathname = '/postgres';
  }
  if (!database.username || !database.password) {
    throw new Error('T07 staging PostgreSQL URL must include a database username and password. Do not paste these into chat.');
  }
  if (!env.PUBLIC_ORIGIN) {
    throw new Error('PUBLIC_ORIGIN is required so cookie-based mutations verify their origin.');
  }
  let origin;
  try { origin = new URL(env.PUBLIC_ORIGIN); }
  catch { throw new Error('PUBLIC_ORIGIN is not a valid absolute URL.'); }
  const allowedLocal = origin.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if (origin.origin !== env.PUBLIC_ORIGIN ||
      (!allowedLocal && origin.protocol !== 'https:') ||
      origin.username || origin.password || origin.search || origin.hash ||
      origin.pathname !== '/') {
    throw new Error('PUBLIC_ORIGIN must be an exact HTTPS origin without path, query or credentials.');
  }
  if (env.RENDER_GIT_BRANCH && env.RENDER_GIT_BRANCH !== 'assignment-7') {
    throw new Error('Render staging must deploy assignment-7, not the existing main service.');
  }
  if (env.RENDER_GIT_REPO_SLUG && env.RENDER_GIT_REPO_SLUG !== 'ecde4499/plando-see-diary') {
    throw new Error('Render repo slug does not match the intended T07 repository.');
  }
  if (env.RENDER_EXTERNAL_URL && env.RENDER_EXTERNAL_URL !== env.PUBLIC_ORIGIN) {
    throw new Error('PUBLIC_ORIGIN must match the new staging service external URL.');
  }
  return { databaseUrl: database.toString(), publicOrigin: origin.origin };
}

const REQUIRED_TABLES = Object.freeze([
  'plans', 'plan_revisions', 'tasks', 'execution_logs',
  'completion_events', 'reflections', 'app_users', 'auth_sessions'
]);

async function assertStagingSchema(pool) {
  // Read-only schema inspection. Do not initialize or alter database objects here.
  const { rows } = await pool.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE'
      AND table_name=ANY($1::text[])`, [REQUIRED_TABLES]);
  const found = new Set(rows.map(row => row.table_name));
  const missing = REQUIRED_TABLES.filter(table => !found.has(table));
  if (missing.length) {
    throw new Error('Staging database schema is incomplete (missing: ' + missing.join(', ') +
      '). Apply T06 and T07 SQL to the separate staging DB before starting.');
  }
  const owner = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='plans' AND column_name='owner_user_id'`);
  if (owner.rowCount !== 1) {
    throw new Error('Staging database is missing plans.owner_user_id.');
  }
}

async function start() {
  require('dotenv').config();
  const result = validateStagingEnv(process.env);
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: result.databaseUrl,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
  try { await assertStagingSchema(pool); }
  finally { await pool.end(); }
  // index.js imports server/db.js; supply only the explicitly approved staging URL.
  process.env.DATABASE_URL = result.databaseUrl;
  process.env.NODE_ENV = 'production';
  require('../server/index');
}

if (require.main === module) {
  start().catch(err => {
    console.error('T07 staging startup refused:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { validateStagingEnv, assertStagingSchema, REQUIRED_TABLES };
