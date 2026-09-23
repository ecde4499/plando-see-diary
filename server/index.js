require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const { pool } = require('./db');
const { computeSummary } = require('./aggregate');

const app = express();
const PORT = Number(process.env.PORT || 3000);

app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

const PRIORITIES = new Set(['낮음', '보통', '높음']);
const STATUSES = new Set(['진행 중', '완료']);
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''));
const int0 = (v) => Number.isInteger(Number(v)) && Number(v) >= 0;
const cleanTags = (tags) => Array.isArray(tags) ? [...new Set(tags.map((x) => String(x).trim()).filter(Boolean))].slice(0, 20) : [];

function todayInSeoul() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function bad(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'postgresql', timeZone: 'Asia/Seoul' });
  } catch (e) {
    res.status(503).json({ ok: false, error: 'DB 연결 실패' });
  }
});

app.get('/api/plans', async (_req, res, next) => {
  try {
    const { rows } = await pool.query(`
      SELECT p.*, r.improvement_text AS source_improvement_text
      FROM plans p
      LEFT JOIN reflections r ON r.id = p.source_reflection_id
      ORDER BY p.created_at DESC, p.id ASC
    `);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/plans', async (req, res, next) => {
  const { title, start_date, end_date, priority, success_criteria, estimated_minutes, source_reflection_id = null } = req.body;
  if (!String(title || '').trim()) return bad(res, '제목이 필요합니다.');
  if (!isDate(start_date) || !isDate(end_date) || end_date < start_date) return bad(res, '기간을 확인하세요.');
  if (!PRIORITIES.has(priority)) return bad(res, '우선순위를 확인하세요.');
  if (!String(success_criteria || '').trim()) return bad(res, '성공 기준이 필요합니다.');
  if (!int0(estimated_minutes)) return bad(res, '예상 시간은 0 이상의 분 단위 정수여야 합니다.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(`
      INSERT INTO plans(title,start_date,end_date,priority,success_criteria,estimated_minutes,source_reflection_id)
      VALUES($1,$2,$3,$4,$5,$6,$7)
      RETURNING *
    `, [String(title).trim(), start_date, end_date, priority, String(success_criteria), Number(estimated_minutes), source_reflection_id || null]);
    const plan = rows[0];
    if (source_reflection_id) {
      await client.query('UPDATE reflections SET next_plan_id=$1, updated_at=now() WHERE id=$2', [plan.id, source_reflection_id]);
    }
    await client.query('COMMIT');
    res.status(201).json(plan);
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally { client.release(); }
});

app.put('/api/plans/:id', async (req, res, next) => {
  const { id } = req.params;
  const { title, start_date, end_date, priority, success_criteria, estimated_minutes } = req.body;
  if (!String(title || '').trim() || !isDate(start_date) || !isDate(end_date) || end_date < start_date || !PRIORITIES.has(priority) || !String(success_criteria || '').trim() || !int0(estimated_minutes)) {
    return bad(res, '계획 입력값을 확인하세요.');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const locked = await client.query('SELECT * FROM plans WHERE id=$1 FOR UPDATE', [id]);
    if (!locked.rowCount) { await client.query('ROLLBACK'); return bad(res, '계획을 찾을 수 없습니다.', 404); }
    const old = locked.rows[0];
    const rev = await client.query('SELECT COALESCE(MAX(revision_no),0)+1 AS n FROM plan_revisions WHERE plan_id=$1', [id]);
    await client.query(`
      INSERT INTO plan_revisions(plan_id,revision_no,title,start_date,end_date,priority,success_criteria,estimated_minutes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
    `, [id, Number(rev.rows[0].n), old.title, old.start_date, old.end_date, old.priority, old.success_criteria, old.estimated_minutes]);
    const updated = await client.query(`
      UPDATE plans SET title=$2,start_date=$3,end_date=$4,priority=$5,success_criteria=$6,estimated_minutes=$7,updated_at=now()
      WHERE id=$1 RETURNING *
    `, [id, String(title).trim(), start_date, end_date, priority, String(success_criteria), Number(estimated_minutes)]);
    await client.query('COMMIT');
    res.json(updated.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally { client.release(); }
});

app.get('/api/plans/:id/revisions', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM plan_revisions WHERE plan_id=$1 ORDER BY revision_no DESC', [req.params.id]);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get('/api/tasks', async (req, res, next) => {
  try {
    const { plan_id, status, priority, tag, q = '', sort = 'priority_due_created' } = req.query;
    const where = ['deleted_at IS NULL'];
    const values = [];
    const add = (sql, value) => { values.push(value); where.push(sql.replace('?', `$${values.length}`)); };
    if (plan_id) add('plan_id=?', plan_id);
    if (status && STATUSES.has(status)) add('status=?', status);
    if (priority && PRIORITIES.has(priority)) add('priority=?', priority);
    if (tag) add('? = ANY(tags)', tag);
    if (String(q).trim()) {
      values.push(`%${String(q).trim()}%`);
      const i = values.length;
      where.push(`(title ILIKE $${i} OR content ILIKE $${i} OR array_to_string(tags,' ') ILIKE $${i})`);
    }
    const orders = {
      priority_due_created: `CASE priority WHEN '높음' THEN 1 WHEN '보통' THEN 2 ELSE 3 END ASC, due_date ASC NULLS LAST, created_at ASC, id ASC`,
      due_created: 'due_date ASC NULLS LAST, created_at ASC, id ASC',
      created_desc: 'created_at DESC, id ASC'
    };
    const order = orders[sort] || orders.priority_due_created;
    const { rows } = await pool.query(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY ${order}`, values);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/tasks', async (req, res, next) => {
  const { plan_id, title, content = '', due_date = null, priority, tags = [], estimated_minutes } = req.body;
  if (!plan_id || !String(title || '').trim() || (due_date && !isDate(due_date)) || !PRIORITIES.has(priority) || !int0(estimated_minutes)) return bad(res, '할 일 입력값을 확인하세요.');
  try {
    const { rows } = await pool.query(`
      INSERT INTO tasks(plan_id,title,content,due_date,priority,tags,estimated_minutes)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *
    `, [plan_id, String(title).trim(), String(content), due_date || null, priority, cleanTags(tags), Number(estimated_minutes)]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.put('/api/tasks/:id', async (req, res, next) => {
  const { plan_id, title, content = '', due_date = null, priority, tags = [], estimated_minutes } = req.body;
  if (!plan_id || !String(title || '').trim() || (due_date && !isDate(due_date)) || !PRIORITIES.has(priority) || !int0(estimated_minutes)) return bad(res, '할 일 입력값을 확인하세요.');
  try {
    const { rows } = await pool.query(`
      UPDATE tasks SET plan_id=$2,title=$3,content=$4,due_date=$5,priority=$6,tags=$7,estimated_minutes=$8,updated_at=now()
      WHERE id=$1 AND deleted_at IS NULL RETURNING *
    `, [req.params.id, plan_id, String(title).trim(), String(content), due_date || null, priority, cleanTags(tags), Number(estimated_minutes)]);
    if (!rows[0]) return bad(res, '할 일을 찾을 수 없습니다.', 404);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.post('/api/tasks/:id/complete', async (req, res, next) => {
  const idempotencyKey = String(req.get('Idempotency-Key') || req.body.idempotency_key || '').trim();
  if (!idempotencyKey) return bad(res, 'Idempotency-Key가 필요합니다.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const task = await client.query('SELECT * FROM tasks WHERE id=$1 AND deleted_at IS NULL FOR UPDATE', [req.params.id]);
    if (!task.rowCount) { await client.query('ROLLBACK'); return bad(res, '할 일을 찾을 수 없습니다.', 404); }
    await client.query(`
      INSERT INTO completion_events(task_id,idempotency_key)
      VALUES($1,$2)
      ON CONFLICT DO NOTHING
    `, [req.params.id, idempotencyKey]);
    await client.query("UPDATE tasks SET status='완료',updated_at=now() WHERE id=$1", [req.params.id]);
    const events = await client.query('SELECT * FROM completion_events WHERE task_id=$1 AND active=TRUE ORDER BY completed_at ASC', [req.params.id]);
    await client.query('COMMIT');
    res.json({ status: '완료', completion_event_count: events.rowCount, completion_event: events.rows[0] || null });
  } catch (e) {
    await client.query('ROLLBACK');
    next(e);
  } finally { client.release(); }
});

app.post('/api/tasks/:id/reopen', async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query("UPDATE tasks SET status='진행 중',updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING *", [req.params.id]);
    if (!result.rowCount) { await client.query('ROLLBACK'); return bad(res, '할 일을 찾을 수 없습니다.', 404); }
    await client.query('UPDATE completion_events SET active=FALSE, reopened_at=now() WHERE task_id=$1 AND active=TRUE', [req.params.id]);
    await client.query('COMMIT');
    res.json(result.rows[0]);
  } catch (e) { await client.query('ROLLBACK'); next(e); } finally { client.release(); }
});

app.delete('/api/tasks/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('UPDATE tasks SET deleted_at=now(),updated_at=now() WHERE id=$1 AND deleted_at IS NULL RETURNING id,deleted_at', [req.params.id]);
    if (!rows[0]) return bad(res, '할 일을 찾을 수 없습니다.', 404);
    res.json(rows[0]);
  } catch (e) { next(e); }
});

app.get('/api/executions', async (req, res, next) => {
  try {
    const values = [];
    let where = '';
    if (req.query.task_id) { values.push(req.query.task_id); where = 'WHERE e.task_id=$1'; }
    if (req.query.plan_id) { values.push(req.query.plan_id); where = `WHERE t.plan_id=$${values.length}`; }
    const { rows } = await pool.query(`
      SELECT e.*, t.title AS task_title, t.plan_id
      FROM execution_logs e JOIN tasks t ON t.id=e.task_id
      ${where}
      ORDER BY e.started_at DESC, e.id ASC
    `, values);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/executions', async (req, res, next) => {
  const { task_id, started_at, ended_at, actual_minutes, blocked_reason = '' } = req.body;
  const s = new Date(started_at), en = new Date(ended_at);
  if (!task_id || Number.isNaN(s.getTime()) || Number.isNaN(en.getTime()) || en < s || !int0(actual_minutes)) return bad(res, '실행 기록 입력값을 확인하세요.');
  try {
    const { rows } = await pool.query(`
      INSERT INTO execution_logs(task_id,started_at,ended_at,actual_minutes,blocked_reason)
      VALUES($1,$2,$3,$4,$5) RETURNING *
    `, [task_id, s.toISOString(), en.toISOString(), Number(actual_minutes), String(blocked_reason)]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.get('/api/reflections/:planId', async (req, res, next) => {
  try {
    const { rows } = await pool.query('SELECT * FROM reflections WHERE source_plan_id=$1 ORDER BY created_at DESC', [req.params.planId]);
    res.json(rows);
  } catch (e) { next(e); }
});

app.post('/api/reflections', async (req, res, next) => {
  const { source_plan_id, improvement_text } = req.body;
  if (!source_plan_id || !String(improvement_text || '').trim()) return bad(res, '개선점 한 줄을 입력하세요.');
  try {
    const { rows } = await pool.query(`
      INSERT INTO reflections(source_plan_id, improvement_text)
      VALUES($1,$2) RETURNING *
    `, [source_plan_id, String(improvement_text).trim()]);
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

app.get('/api/summary/:planId', async (req, res, next) => {
  try {
    const tasks = await pool.query('SELECT * FROM tasks WHERE plan_id=$1', [req.params.planId]);
    const logs = await pool.query(`
      SELECT e.* FROM execution_logs e
      JOIN tasks t ON t.id=e.task_id
      WHERE t.plan_id=$1
    `, [req.params.planId]);
    const summary = computeSummary(tasks.rows, logs.rows, todayInSeoul());
    res.json({ ...summary, todaySeoul: todayInSeoul() });
  } catch (e) { next(e); }
});

app.get('/api/summary/:planId/evidence/:kind', async (req, res, next) => {
  const { planId, kind } = req.params;
  try {
    let sql;
    const params = [planId, todayInSeoul()];
    if (kind === 'planCount') sql = `SELECT * FROM tasks WHERE plan_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`;
    else if (kind === 'completedCount') sql = `SELECT * FROM tasks WHERE plan_id=$1 AND deleted_at IS NULL AND status='완료' ORDER BY created_at,id`;
    else if (kind === 'overdueCount') sql = `SELECT * FROM tasks WHERE plan_id=$1 AND deleted_at IS NULL AND status<>'완료' AND due_date IS NOT NULL AND due_date < $2::date ORDER BY due_date,created_at,id`;
    else if (kind === 'blockedCount') sql = `SELECT DISTINCT ON (t.id) t.*, e.blocked_reason FROM tasks t JOIN execution_logs e ON e.task_id=t.id WHERE t.plan_id=$1 AND t.deleted_at IS NULL AND length(trim(e.blocked_reason))>0 ORDER BY t.id,e.created_at`;
    else if (kind === 'estimatedMinutes') sql = `SELECT * FROM tasks WHERE plan_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`;
    else if (kind === 'actualMinutes') sql = `SELECT e.*,t.title AS task_title FROM execution_logs e JOIN tasks t ON t.id=e.task_id WHERE t.plan_id=$1 AND t.deleted_at IS NULL ORDER BY e.started_at,e.id`;
    else return bad(res, '지원하지 않는 근거 유형입니다.');
    const { rows } = await pool.query(sql, kind === 'overdueCount' ? params : [planId]);
    res.json(rows);
  } catch (e) { next(e); }
});

app.get('/api/export', async (_req, res, next) => {
  const client = await pool.connect();
  try {
    const names = ['plans','plan_revisions','tasks','execution_logs','completion_events','reflections'];
    const payload = { exported_at: new Date().toISOString(), time_zone: 'Asia/Seoul', time_unit: 'minutes' };
    for (const name of names) payload[name] = (await client.query(`SELECT * FROM ${name} ORDER BY 1`)).rows;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="plando-see-export-${todayInSeoul()}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) { next(e); } finally { client.release(); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API를 찾을 수 없습니다.' }));
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'index.html')));
app.use((err, _req, res, _next) => {
  console.error(err);
  const safeMessage = err && err.code === '23503' ? '연결된 데이터가 존재하지 않습니다.' : '서버 요청 처리 중 오류가 발생했습니다.';
  res.status(500).json({ error: safeMessage });
});

app.listen(PORT, () => console.log(`PlanDoSee Diary: http://localhost:${PORT}`));
