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
  if (!env.T07_STAGING_DATABASE_URL) {
    throw new Error('T07_STAGING_DATABASE_URL is required for the isolated staging service.');
  }
  let database;
  try { database = new URL(env.T07_STAGING_DATABASE_URL); }
  catch { throw new Error('T07 staging database URL is invalid.'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) ||
      !database.hostname || !database.pathname || database.pathname === '/') {
    throw new Error('T07 staging database must be a PostgreSQL connection URL with a database name.');
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
  return { databaseUrl: env.T07_STAGING_DATABASE_URL, publicOrigin: origin.origin };
}

function start() {
  require('dotenv').config();
  const result = validateStagingEnv(process.env);
  // index.js imports server/db.js; supply only the explicitly approved staging URL.
  process.env.DATABASE_URL = result.databaseUrl;
  process.env.NODE_ENV = 'production';
  require('../server/index');
}

if (require.main === module) {
  try { start(); }
  catch (err) { console.error('T07 staging configuration rejected:', err.message); process.exitCode = 1; }
}

module.exports = { validateStagingEnv };
