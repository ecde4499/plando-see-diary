'use strict';

// T07 write endpoints: owner is ALWAYS req.authUser.id, never a client-supplied ID.
function createScopedWriteRouter(express, pool, requireAuth) {
  const router = express.Router();
  router.use(requireAuth(pool));
  const priorities = new Set(['낮음', '보통', '높음']);
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
  const int0 = (v) => Number.isInteger(v) && v >= 0;
  const tags = (v) => Array.isArray(v) ? [...new Set(v.map(x => String(x).trim()).filter(Boolean))].slice(0, 20) : [];
  const bad = (res, message, code = 400) => res.status(code).json({ error: message });
  const wrap = fn => async (req, res, next) => { try { await fn(req, res); } catch (err) { next(err); } };
  const own = req => req.authUser.id;
  const planExists = async (db, planId, ownerId) =>
    (await db.query('SELECT id FROM plans WHERE id=$1 AND owner_user_id=$2', [planId, ownerId])).rowCount > 0;
  const taskExists = async (db, taskId, ownerId) =>
    (await db.query('SELECT t.id FROM tasks t JOIN plans p ON p.id=t.plan_id WHERE t.id=$1 AND p.owner_user_id=$2 AND t.deleted_at IS NULL', [taskId, ownerId])).rowCount > 0;
  const reflectionExists = async (db, reflectionId, ownerId) =>
    (await db.query('SELECT r.id FROM reflections r JOIN plans p ON p.id=r.source_plan_id WHERE r.id=$1 AND p.owner_user_id=$2', [reflectionId, ownerId])).rowCount > 0;
  const transaction = async fn => {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const result = await fn(db);
      await db.query('COMMIT');
      return result;
    } catch (err) { await db.query('ROLLBACK'); throw err; }
    finally { db.release(); }
  };
  const planInput = b => b && String(b.title || '').trim() && isDate(b.start_date) &&
    isDate(b.end_date) && b.end_date >= b.start_date && priorities.has(b.priority) &&
    String(b.success_criteria || '').trim() && int0(b.estimated_minutes);
  const taskInput = b => b && b.plan_id && String(b.title || '').trim() &&
    (!b.due_date || isDate(b.due_date)) && priorities.has(b.priority) && int0(b.estimated_minutes);

  router.post('/plans', wrap(async (req, res) => {
    const b = req.body;
    if (!planInput(b)) return bad(res, '계획 입력값을 확인하세요.');
    const result = await transaction(async db => {
      if (b.source_reflection_id && !(await reflectionExists(db, b.source_reflection_id, own(req)))) return null;
      const { rows } = await db.query(`
        INSERT INTO plans(title,start_date,end_date,priority,success_criteria,estimated_minutes,source_reflection_id,owner_user_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [String(b.title).trim(), b.start_date, b.end_date, b.priority, String(b.success_criteria),
        b.estimated_minutes, b.source_reflection_id || null, own(req)]);
      if (b.source_reflection_id) {
        await db.query('UPDATE reflections SET next_plan_id=$1,updated_at=now() WHERE id=$2', [rows[0].id, b.source_reflection_id]);
      }
      return rows[0];
    });
    if (!result) return bad(res, '연결할 회고를 찾을 수 없습니다.', 404);
    res.status(201).json(result);
  }));

  router.put('/plans/:id', wrap(async (req, res) => {
    const b = req.body;
    if (!planInput(b)) return bad(res, '계획 입력값을 확인하세요.');
    const result = await transaction(async db => {
      const { rows } = await db.query('SELECT * FROM plans WHERE id=$1 AND owner_user_id=$2 FOR UPDATE', [req.params.id, own(req)]);
      if (!rows[0]) return null;
      const old = rows[0];
      const { rows: rev } = await db.query('SELECT COALESCE(MAX(revision_no),0)+1 AS n FROM plan_revisions WHERE plan_id=$1', [old.id]);
      await db.query(`INSERT INTO plan_revisions(plan_id,revision_no,title,start_date,end_date,priority,success_criteria,estimated_minutes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [old.id, Number(rev[0].n), old.title, old.start_date,
        old.end_date, old.priority, old.success_criteria, old.estimated_minutes]);
      const updated = await db.query(`UPDATE plans SET title=$2,start_date=$3,end_date=$4,priority=$5,
        success_criteria=$6,estimated_minutes=$7,updated_at=now()
        WHERE id=$1 AND owner_user_id=$8 RETURNING *`, [old.id, String(b.title).trim(), b.start_date,
        b.end_date, b.priority, String(b.success_criteria), b.estimated_minutes, own(req)]);
      return updated.rows[0];
    });
    if (!result) return bad(res, '계획을 찾을 수 없습니다.', 404);
    res.json(result);
  }));

  router.post('/tasks', wrap(async (req, res) => {
    const b = req.body;
    if (!taskInput(b)) return bad(res, '할 일 입력값을 확인하세요.');
    const { rows } = await pool.query(`
      INSERT INTO tasks(plan_id,title,content,due_date,priority,tags,estimated_minutes)
      SELECT p.id,$2,$3,$4,$5,$6,$7 FROM plans p WHERE p.id=$1 AND p.owner_user_id=$8
      RETURNING *`, [b.plan_id, String(b.title).trim(), String(b.content || ''), b.due_date || null,
      b.priority, tags(b.tags), b.estimated_minutes, own(req)]);
    if (!rows[0]) return bad(res, '계획을 찾을 수 없습니다.', 404);
    res.status(201).json(rows[0]);
  }));

  router.put('/tasks/:id', wrap(async (req, res) => {
    const b = req.body;
    if (!taskInput(b)) return bad(res, '할 일 입력값을 확인하세요.');
    const { rows } = await pool.query(`
      UPDATE tasks t SET plan_id=$2,title=$3,content=$4,due_date=$5,priority=$6,
      tags=$7,estimated_minutes=$8,updated_at=now()
      WHERE t.id=$1 AND t.deleted_at IS NULL
        AND EXISTS(SELECT 1 FROM plans oldp WHERE oldp.id=t.plan_id AND oldp.owner_user_id=$9)
        AND EXISTS(SELECT 1 FROM plans newp WHERE newp.id=$2 AND newp.owner_user_id=$9)
      RETURNING t.*`, [req.params.id, b.plan_id, String(b.title).trim(), String(b.content || ''),
      b.due_date || null, b.priority, tags(b.tags), b.estimated_minutes, own(req)]);
    if (!rows[0]) return bad(res, '할 일을 찾을 수 없습니다.', 404);
    res.json(rows[0]);
  }));

  router.post('/tasks/:id/complete', wrap(async (req, res) => {
    const key = String(req.get('Idempotency-Key') || req.body?.idempotency_key || '').trim();
    if (!key || key.length > 200) return bad(res, 'Idempotency-Key가 필요합니다.');
    const result = await transaction(async db => {
      const task = await db.query(`SELECT t.id FROM tasks t JOIN plans p ON p.id=t.plan_id
        WHERE t.id=$1 AND p.owner_user_id=$2 AND t.deleted_at IS NULL FOR UPDATE OF t`,
      [req.params.id, own(req)]);
      if (!task.rowCount) return null;
      await db.query('INSERT INTO completion_events(task_id,idempotency_key) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [req.params.id, key]);
      await db.query("UPDATE tasks SET status='완료',updated_at=now() WHERE id=$1", [req.params.id]);
      const events = await db.query('SELECT * FROM completion_events WHERE task_id=$1 AND active=TRUE ORDER BY completed_at',
        [req.params.id]);
      return { status: '완료', completion_event_count: events.rowCount, completion_event: events.rows[0] || null };
    });
    if (!result) return bad(res, '할 일을 찾을 수 없습니다.', 404);
    res.json(result);
  }));

  router.post('/tasks/:id/reopen', wrap(async (req, res) => {
    const result = await transaction(async db => {
      const { rows } = await db.query(`UPDATE tasks t SET status='진행 중',updated_at=now()
        WHERE t.id=$1 AND t.deleted_at IS NULL AND EXISTS
        (SELECT 1 FROM plans p WHERE p.id=t.plan_id AND p.owner_user_id=$2) RETURNING t.*`,
      [req.params.id, own(req)]);
      if (!rows[0]) return null;
      await db.query('UPDATE completion_events SET active=FALSE,reopened_at=now() WHERE task_id=$1 AND active=TRUE',
        [req.params.id]);
      return rows[0];
    });
    if (!result) return bad(res, '할 일을 찾을 수 없습니다.', 404);
    res.json(result);
  }));

  router.delete('/tasks/:id', wrap(async (req, res) => {
    const { rows } = await pool.query(`UPDATE tasks t SET deleted_at=now(),updated_at=now()
      WHERE t.id=$1 AND t.deleted_at IS NULL AND EXISTS
      (SELECT 1 FROM plans p WHERE p.id=t.plan_id AND p.owner_user_id=$2)
      RETURNING t.id,t.deleted_at`, [req.params.id, own(req)]);
    if (!rows[0]) return bad(res, '할 일을 찾을 수 없습니다.', 404);
    res.json(rows[0]);
  }));

  router.post('/executions', wrap(async (req, res) => {
    const b = req.body;
    const start = new Date(b?.started_at), end = new Date(b?.ended_at);
    if (!b?.task_id || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) ||
      end < start || !int0(b.actual_minutes)) return bad(res, '실행 기록 입력값을 확인하세요.');
    const { rows } = await pool.query(`
      INSERT INTO execution_logs(task_id,started_at,ended_at,actual_minutes,blocked_reason)
      SELECT t.id,$2,$3,$4,$5 FROM tasks t JOIN plans p ON p.id=t.plan_id
      WHERE t.id=$1 AND t.deleted_at IS NULL AND p.owner_user_id=$6 RETURNING *`,
    [b.task_id, start.toISOString(), end.toISOString(), b.actual_minutes,
      String(b.blocked_reason || ''), own(req)]);
    if (!rows[0]) return bad(res, '할 일을 찾을 수 없습니다.', 404);
    res.status(201).json(rows[0]);
  }));

  router.post('/reflections', wrap(async (req, res) => {
    const b = req.body;
    if (!b?.source_plan_id || !String(b.improvement_text || '').trim()) return bad(res, '개선점을 입력하세요.');
    const { rows } = await pool.query(`
      INSERT INTO reflections(source_plan_id,improvement_text)
      SELECT p.id,$2 FROM plans p WHERE p.id=$1 AND p.owner_user_id=$3 RETURNING *`,
    [b.source_plan_id, String(b.improvement_text).trim(), own(req)]);
    if (!rows[0]) return bad(res, '계획을 찾을 수 없습니다.', 404);
    res.status(201).json(rows[0]);
  }));

  return router;
}
module.exports = { createScopedWriteRouter };
