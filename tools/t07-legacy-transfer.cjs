'use strict';

// T07 legacy ownership rehearsal: no command-line entrypoint and no public HTTP route.
// Preview is read-only. Apply is allowed ONLY for an explicitly marked disposable test DB.
// Production transfer requires a separate, reviewed and approved procedure.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RELATED = [
  'plans', 'tasks', 'execution_logs', 'completion_events', 'plan_revisions', 'reflections'
];

function validateTransferInput({ targetUserId, planIds, apply = false, approval } = {}) {
  if (!UUID.test(String(targetUserId || ''))) throw new Error('Target user ID must be a UUID.');
  if (!Array.isArray(planIds) || !planIds.length || planIds.length > 100 ||
      planIds.some(id => !UUID.test(String(id)))) {
    throw new Error('Provide 1-100 exact legacy plan UUIDs.');
  }
  const ids = planIds.map(x => x.toLowerCase());
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate legacy plan ID.');
  if (apply && (approval !== 'DISPOSABLE_DB_ONLY' || process.env.NODE_ENV !== 'test')) {
    throw new Error('Production transfer is disabled. Only explicit disposable DB rehearsals are allowed.');
  }
  return { targetUserId: targetUserId.toLowerCase(), planIds: ids, apply };
}

async function tableCounts(db) {
  const rows = await db.query(`SELECT
    (SELECT COUNT(*)::bigint FROM plans) AS plans,
    (SELECT COUNT(*)::bigint FROM tasks) AS tasks,
    (SELECT COUNT(*)::bigint FROM execution_logs) AS execution_logs,
    (SELECT COUNT(*)::bigint FROM completion_events) AS completion_events,
    (SELECT COUNT(*)::bigint FROM plan_revisions) AS plan_revisions,
    (SELECT COUNT(*)::bigint FROM reflections) AS reflections`);
  return Object.fromEntries(RELATED.map(key => [key, Number(rows.rows[0][key])]));
}

async function verifyContainedLinks(db, ids) {
  const links = [
    // A selected plan referencing a reflection from a plan not in the selection.
    `SELECT 1 FROM plans p JOIN reflections r ON r.id=p.source_reflection_id
      WHERE p.id=ANY($1::uuid[]) AND NOT (r.source_plan_id=ANY($1::uuid[])) LIMIT 1`,
    // A selected plan's reflection linking forward to an unselected plan.
    `SELECT 1 FROM reflections r WHERE r.source_plan_id=ANY($1::uuid[])
      AND r.next_plan_id IS NOT NULL AND NOT (r.next_plan_id=ANY($1::uuid[])) LIMIT 1`,
    // An unselected plan referencing a reflection owned by a selected plan.
    `SELECT 1 FROM plans p JOIN reflections r ON r.id=p.source_reflection_id
      WHERE r.source_plan_id=ANY($1::uuid[]) AND NOT (p.id=ANY($1::uuid[])) LIMIT 1`,
    // An unselected plan's reflection referring forward to a selected plan.
    `SELECT 1 FROM reflections r WHERE r.next_plan_id=ANY($1::uuid[])
      AND NOT (r.source_plan_id=ANY($1::uuid[])) LIMIT 1`
  ];
  for (const sql of links) {
    if ((await db.query(sql, [ids])).rowCount) {
      throw new Error('Legacy plans have cross-boundary reflection links. Review the complete linked plan group.');
    }
  }
}

async function previewOrRehearseTransfer(pool, options) {
  const { targetUserId, planIds, apply } = validateTransferInput(options);
  const client = await pool.connect();
  let begun = false;
  try {
    await client.query(apply ? 'BEGIN' : 'BEGIN READ ONLY');
    begun = true;
    if (apply) {
      const { rows } = await client.query('SELECT current_database() AS name');
      if (!/(^|[_-])test([_-]|$)/i.test(rows[0].name)) {
        throw new Error('Apply is limited to a disposable PostgreSQL database with a test marker.');
      }
    }
    const account = await client.query('SELECT id FROM app_users WHERE id=$1', [targetUserId]);
    if (account.rowCount !== 1) throw new Error('Target account does not exist.');
    const { rows: selected } = await client.query(
      'SELECT id,owner_user_id FROM plans WHERE id=ANY($1::uuid[])' +
      (apply ? ' FOR UPDATE' : ''),
      [planIds]
    );
    if (selected.length !== planIds.length) throw new Error('One or more requested plans do not exist.');
    if (selected.some(row => row.owner_user_id !== null)) {
      throw new Error('At least one plan is already assigned. No ownership changes permitted.');
    }
    await verifyContainedLinks(client, planIds);
    const before = await tableCounts(client);
    let changed = 0;
    if (apply) {
      const result = await client.query(
        'UPDATE plans SET owner_user_id=$2 WHERE id=ANY($1::uuid[]) AND owner_user_id IS NULL RETURNING id',
        [planIds, targetUserId]
      );
      changed = result.rowCount;
      if (changed !== planIds.length) throw new Error('Transfer did not update every requested plan.');
      const post = await client.query(
        'SELECT COUNT(*)::int AS n FROM plans WHERE id=ANY($1::uuid[]) AND owner_user_id=$2',
        [planIds, targetUserId]
      );
      if (post.rows[0].n !== changed) throw new Error('Ownership confirmation failed.');
      const after = await tableCounts(client);
      if (RELATED.some(t => after[t] !== before[t])) {
        throw new Error('A related-table row count changed unexpectedly.');
      }
    }
    await client.query('COMMIT');
    begun = false;
    return {
      mode: apply ? 'STAGING_APPLIED' : 'READ_ONLY_PREVIEW',
      selected_plan_count: planIds.length,
      transferred_plan_count: changed,
      related_table_counts_preserved: true,
      related_table_counts: before,
      note: 'Explicitly selected legacy plans only; descendant records retain IDs and contents.'
    };
  } catch (error) {
    if (begun) await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { validateTransferInput, previewOrRehearseTransfer };
