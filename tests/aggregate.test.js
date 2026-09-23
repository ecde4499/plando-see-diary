const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { computeSummary } = require('../server/aggregate');
const root = path.join(__dirname, '..');

test('See 집계 규칙: 삭제 제외, 완료 지연 중복 제외, 막힘 task distinct, 시간 합계', () => {
  const tasks = [
    { id:'a', status:'완료', due_date:'2026-09-01', estimated_minutes:30, deleted_at:null },
    { id:'b', status:'진행 중', due_date:'2026-09-01', estimated_minutes:60, deleted_at:null },
    { id:'c', status:'진행 중', due_date:'2026-10-01', estimated_minutes:10, deleted_at:null },
    { id:'d', status:'진행 중', due_date:'2026-09-01', estimated_minutes:999, deleted_at:'2026-09-20T00:00:00Z' }
  ];
  const logs = [
    { task_id:'a', actual_minutes:20, blocked_reason:'' },
    { task_id:'b', actual_minutes:40, blocked_reason:'막힘1' },
    { task_id:'b', actual_minutes:5, blocked_reason:'막힘2' },
    { task_id:'d', actual_minutes:999, blocked_reason:'삭제 task' }
  ];
  assert.deepEqual(computeSummary(tasks, logs, '2026-09-23'), {
    planCount:3, completedCount:1, overdueCount:1, blockedCount:1,
    estimatedMinutes:100, actualMinutes:65, differenceMinutes:-35
  });
});

test('자료가 없으면 모든 집계는 0', () => {
  assert.deepEqual(computeSummary([], [], '2026-09-23'), {
    planCount:0, completedCount:0, overdueCount:0, blockedCount:0,
    estimatedMinutes:0, actualMinutes:0, differenceMinutes:0
  });
});

test('고정 공개 경고 문구가 정확히 존재한다', () => {
  const html = fs.readFileSync(path.join(root,'public','index.html'),'utf8');
  assert.match(html, /지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다\. 남이 봐도 괜찮은 내용만 넣으세요/);
});

test('브라우저 코드에 localStorage/innerHTML/서버 DB 비밀 환경변수 사용이 없다', () => {
  const js = fs.readFileSync(path.join(root,'public','app.js'),'utf8');
  const html = fs.readFileSync(path.join(root,'public','index.html'),'utf8');
  assert.doesNotMatch(js, /localStorage/);
  assert.doesNotMatch(js, /\.innerHTML\s*=/);
  assert.doesNotMatch(js + html, /DATABASE_URL|service[_-]?role|postgresql:\/\//i);
});

test('DB 완료 이벤트는 task 단위 UNIQUE로 중복을 막는다', () => {
  const sql = fs.readFileSync(path.join(root,'db','schema.sql'),'utf8');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS one_active_completion_per_task\s+ON completion_events\(task_id\) WHERE active = TRUE/m);
  assert.match(sql, /UNIQUE\(task_id, idempotency_key\)/);
});

test('계획 수정 이력 테이블과 soft delete 필드가 존재한다', () => {
  const sql = fs.readFileSync(path.join(root,'db','schema.sql'),'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS plan_revisions/);
  assert.match(sql, /deleted_at TIMESTAMPTZ NULL/);
});

test('DB 계약 JSON 문법이 올바르고 핵심 테이블이 있다', () => {
  const contract = JSON.parse(fs.readFileSync(path.join(root,'contracts','pds-schema-v2.json'),'utf8'));
  for (const table of ['plans','plan_revisions','tasks','execution_logs','completion_events','reflections']) {
    assert.ok(contract.tables[table]);
  }
  assert.equal(contract.time.duration_unit, 'minutes');
  assert.equal(contract.time.display_timezone, 'Asia/Seoul');
});
