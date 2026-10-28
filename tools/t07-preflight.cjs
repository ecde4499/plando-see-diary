'use strict';

// T07 read-only inventory. Does not migrate, assign owners, or write user data.
// Run against any PostgreSQL database only with an intentionally supplied DATABASE_URL.
require('dotenv').config();
const { Pool } = require('pg');

const TABLES = [
  'plans', 'plan_revisions', 'tasks', 'execution_logs',
  'completion_events', 'reflections', 'app_users', 'auth_sessions'
];
const IDENTIFIER = /^[a-z_]+$/;

function summarize(counts, hasOwnerColumn, ownedPlans, unclaimedPlans) {
  const result = {
    checked_at_utc: new Date().toISOString(),
    mode: 'READ_ONLY',
    auth_schema_present: counts.app_users !== null && counts.auth_sessions !== null && hasOwnerColumn,
    tables: counts,
    plans_with_owner: hasOwnerColumn ? ownedPlans : null,
    plans_unclaimed: hasOwnerColumn ? unclaimedPlans : counts.plans
  };
  return result;
}

async function inventory(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const counts = {};
    for (const table of TABLES) {
      if (!IDENTIFIER.test(table)) throw new Error('Invalid fixed table name');
      const exists = await client.query('SELECT to_regclass($1) AS name', ['public.' + table]);
      counts[table] = exists.rows[0].name === null
        ? null : Number((await client.query('SELECT COUNT(*)::bigint AS n FROM public.' + table)).rows[0].n);
    }
    const columns = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='plans' AND column_name='owner_user_id'"
    );
    const hasOwnerColumn = columns.rowCount > 0;
    let ownedPlans = null, unclaimedPlans = null;
    if (hasOwnerColumn) {
      const results = await client.query(
        'SELECT COUNT(*) FILTER (WHERE owner_user_id IS NOT NULL)::bigint AS owned, COUNT(*) FILTER (WHERE owner_user_id IS NULL)::bigint AS unclaimed FROM public.plans'
      );
      ownedPlans = Number(results.rows[0].owned);
      unclaimedPlans = Number(results.rows[0].unclaimed);
    }
    await client.query('COMMIT');
    return summarize(counts, hasOwnerColumn, ownedPlans, unclaimedPlans);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error('DATABASE_URL is required; no database changes are made.');
  }
  const pool = new Pool({
    connectionString: url,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
  try {
    const report = await inventory(pool);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('T07 preflight failed:', err.message);
    process.exitCode = 1;
  });
}

module.exports = { inventory, summarize, TABLES };
