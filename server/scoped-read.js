'use strict';

// T07 isolated read APIs. Every query anchors ownership to plans.owner_user_id.
// Other legacy write APIs remain fail-closed until independently scoped.
const { computeSummary } = require('./aggregate');

function todayInSeoul() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function createScopedReadRouter(express, pool, requireAuth) {
  const router = express.Router();
  router.use(requireAuth(pool));
  const run = (fn) => async (req, res, next) => {
    try { await fn(req, res); } catch (error) { next(error); }
  };
  const owner = (req) => req.authUser.id;

  router.get('/plans', run(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT p.*, r.improvement_text AS source_improvement_text
      FROM plans p
      LEFT JOIN reflections r ON r.id=p.source_reflection_id
        AND EXISTS (SELECT 1 FROM plans rp WHERE rp.id=r.source_plan_id AND rp.owner_user_id=$1)
      WHERE p.owner_user_id=$1 ORDER BY p.created_at DESC,p.id ASC`, [owner(req)]);
    res.json(rows);
  }));

  router.get('/plans/:id/revisions', run(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT v.* FROM plan_revisions v JOIN plans p ON p.id=v.plan_id
      WHERE v.plan_id=$1 AND p.owner_user_id=$2 ORDER BY v.revision_no DESC`,
    [req.params.id, owner(req)]);
    res.json(rows);
  }));

  router.get('/tasks', run(async (req, res) => {
    const where = ['p.owner_user_id=$1', 't.deleted_at IS NULL'];
    const values = [owner(req)];
    const add = (sql, value) => {
      values.push(value);
      where.push(sql.replace('?', `$${values.length}`));
    };
    if (req.query.plan_id) add('t.plan_id=?', req.query.plan_id);
    if (['진행 중', '완료'].includes(req.query.status)) add('t.status=?', req.query.status);
    if (['낮음', '보통', '높음'].includes(req.query.priority)) add('t.priority=?', req.query.priority);
    if (req.query.tag) add('? = ANY(t.tags)', req.query.tag);
    if (String(req.query.q || '').trim()) {
      add("(t.title ILIKE ? OR t.content ILIKE ?)", `%${String(req.query.q).trim()}%`);
      // Replace the second placeholder with a reference to the same search parameter.
      where[where.length - 1] = where[where.length - 1].replace('?', `$${values.length}`);
    }
    const orders = {
      priority_due_created: "CASE t.priority WHEN '높음' THEN 1 WHEN '보통' THEN 2 ELSE 3 END,t.due_date ASC NULLS LAST,t.created_at,t.id",
      due_created: 't.due_date ASC NULLS LAST,t.created_at,t.id',
      created_desc: 't.created_at DESC,t.id'
    };
    const order = orders[req.query.sort] || orders.priority_due_created;
    const { rows } = await pool.query(`
      SELECT t.* FROM tasks t JOIN plans p ON p.id=t.plan_id
      WHERE ${where.join(' AND ')} ORDER BY ${order}`, values);
    res.json(rows);
  }));

  router.get('/executions', run(async (req, res) => {
    const values = [owner(req)];
    const where = ['p.owner_user_id=$1'];
    if (req.query.task_id) { values.push(req.query.task_id); where.push(`e.task_id=$${values.length}`); }
    if (req.query.plan_id) { values.push(req.query.plan_id); where.push(`t.plan_id=$${values.length}`); }
    const { rows } = await pool.query(`
      SELECT e.*,t.title AS task_title,t.plan_id
      FROM execution_logs e JOIN tasks t ON t.id=e.task_id JOIN plans p ON p.id=t.plan_id
      WHERE ${where.join(' AND ')} ORDER BY e.started_at DESC,e.id`, values);
    res.json(rows);
  }));

  router.get('/reflections/:planId', run(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT r.* FROM reflections r JOIN plans p ON p.id=r.source_plan_id
      WHERE r.source_plan_id=$1 AND p.owner_user_id=$2 ORDER BY r.created_at DESC`,
    [req.params.planId, owner(req)]);
    res.json(rows);
  }));

  router.get('/summary/:planId', run(async (req, res) => {
    const values = [req.params.planId, owner(req)];
    const { rows: tasks } = await pool.query(`
      SELECT t.* FROM tasks t JOIN plans p ON p.id=t.plan_id
      WHERE t.plan_id=$1 AND p.owner_user_id=$2`, values);
    const { rows: logs } = await pool.query(`
      SELECT e.* FROM execution_logs e JOIN tasks t ON t.id=e.task_id
      JOIN plans p ON p.id=t.plan_id WHERE t.plan_id=$1 AND p.owner_user_id=$2`, values);
    res.json({ ...computeSummary(tasks, logs, todayInSeoul()), todaySeoul: todayInSeoul() });
  }));

  router.get('/summary/:planId/evidence/:kind', run(async (req, res) => {
    const { kind, planId } = req.params;
    const common = 't.plan_id=$1 AND p.owner_user_id=$2 AND t.deleted_at IS NULL';
    const taskFrom = 'tasks t JOIN plans p ON p.id=t.plan_id';
    const queries = {
      planCount: `SELECT t.* FROM ${taskFrom} WHERE ${common} ORDER BY t.created_at,t.id`,
      completedCount: `SELECT t.* FROM ${taskFrom} WHERE ${common} AND t.status='완료' ORDER BY t.created_at,t.id`,
      overdueCount: `SELECT t.* FROM ${taskFrom} WHERE ${common} AND t.status<>'완료' AND t.due_date IS NOT NULL AND t.due_date < $3::date ORDER BY t.due_date,t.created_at,t.id`,
      blockedCount: `SELECT DISTINCT ON(t.id) t.*,e.blocked_reason FROM ${taskFrom} JOIN execution_logs e ON e.task_id=t.id WHERE ${common} AND length(trim(e.blocked_reason))>0 ORDER BY t.id,e.created_at`,
      estimatedMinutes: `SELECT t.* FROM ${taskFrom} WHERE ${common} ORDER BY t.created_at,t.id`,
      actualMinutes: `SELECT e.*,t.title AS task_title FROM execution_logs e JOIN tasks t ON t.id=e.task_id JOIN plans p ON p.id=t.plan_id WHERE ${common} ORDER BY e.started_at,e.id`
    };
    if (!Object.hasOwn(queries, kind)) return res.status(400).json({ error: '지원하지 않는 근거 유형입니다.' });
    const params = kind === 'overdueCount' ? [planId, owner(req), todayInSeoul()] : [planId, owner(req)];
    const { rows } = await pool.query(queries[kind], params);
    res.json(rows);
  }));

  router.get('/export', run(async (req, res) => {
    const id = owner(req);
    const sql = {
      plans: 'SELECT * FROM plans WHERE owner_user_id=$1 ORDER BY id',
      plan_revisions: 'SELECT v.* FROM plan_revisions v JOIN plans p ON p.id=v.plan_id WHERE p.owner_user_id=$1 ORDER BY v.id',
      tasks: 'SELECT t.* FROM tasks t JOIN plans p ON p.id=t.plan_id WHERE p.owner_user_id=$1 ORDER BY t.id',
      execution_logs: 'SELECT e.* FROM execution_logs e JOIN tasks t ON t.id=e.task_id JOIN plans p ON p.id=t.plan_id WHERE p.owner_user_id=$1 ORDER BY e.id',
      completion_events: 'SELECT c.* FROM completion_events c JOIN tasks t ON t.id=c.task_id JOIN plans p ON p.id=t.plan_id WHERE p.owner_user_id=$1 ORDER BY c.id',
      reflections: 'SELECT r.* FROM reflections r JOIN plans p ON p.id=r.source_plan_id WHERE p.owner_user_id=$1 ORDER BY r.id'
    };
    const payload = { exported_at: new Date().toISOString(), time_zone: 'Asia/Seoul', time_unit: 'minutes' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      for (const [table, query] of Object.entries(sql)) payload[table] = (await client.query(query, [id])).rows;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    res.setHeader('Content-Disposition', `attachment; filename="plando-see-export-${todayInSeoul()}.json"`);
    res.json(payload);
  }));

  return router;
}

module.exports = { createScopedReadRouter };
