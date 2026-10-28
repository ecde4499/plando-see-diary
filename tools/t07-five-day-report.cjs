'use strict';

// Analyze one account's local JSON export. Never sends data or writes to the DB.
const fs = require('node:fs');
const { resolve } = require('node:path');

function seoulDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return map.year + '-' + map.month + '-' + map.day;
}

function checkDates(dates) {
  if (!Array.isArray(dates) || dates.length !== 5) throw new Error('Exactly five KST dates are required');
  const seen = new Set(dates);
  if (seen.size !== 5) throw new Error('All five dates must be distinct');
  for (const date of dates) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        !Number.isFinite(new Date(date + 'T00:00:00Z').getTime()) ||
        new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date) {
      throw new Error('Invalid KST date: ' + String(date));
    }
  }
  if (dates.some((d, i) => i > 0 && d <= dates[i - 1])) throw new Error('Dates must be ordered oldest to newest');
  return dates;
}

const oneDecimal = number => Math.round((number + Number.EPSILON) * 10) / 10;
function computeFiveDayReport(exportData, dates, planId) {
  checkDates(dates);
  if (!exportData || !Array.isArray(exportData.plans) ||
      !Array.isArray(exportData.tasks) || !Array.isArray(exportData.execution_logs)) {
    throw new Error('Expected account export with plans, tasks, and execution_logs');
  }
  if (typeof planId !== 'string' || !exportData.plans.some(p => p.id === planId)) {
    throw new Error('Select an existing plan ID from this account export');
  }
  const eligible = new Set(exportData.tasks.filter(t => t.plan_id === planId && !t.deleted_at).map(t => t.id));
  const byDay = new Map(dates.map(date => [date, { date_kst: date,
    records: 0, actual_minutes: null, duplicate_ignored: 0, outlier_over_480m: 0,
    log_ids: [], status: 'MISSING' }]));
  const unique = new Set();
  for (const log of [...exportData.execution_logs].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    if (!eligible.has(log.task_id)) continue;
    const day = seoulDate(log.started_at);
    if (!byDay.has(day)) continue;
    const row = byDay.get(day);
    const minutes = Number(log.actual_minutes);
    if (!Number.isSafeInteger(minutes) || minutes < 0 || !seoulDate(log.ended_at)) {
      throw new Error('Malformed actual_minutes or execution timestamp in own export');
    }
    const signature = JSON.stringify([log.task_id, log.started_at, log.ended_at,
      minutes, log.blocked_reason || '']);
    if (unique.has(signature)) {
      row.duplicate_ignored++;
      continue;
    }
    unique.add(signature);
    row.records++;
    row.status = 'RECORDED';
    row.actual_minutes = (row.actual_minutes ?? 0) + minutes;
    row.log_ids.push(String(log.id));
    if (minutes > 480) row.outlier_over_480m++;
  }
  const days = [...byDay.values()];
  const averageRaw = set => set.every(d => d.actual_minutes !== null)
    ? set.reduce((sum, d) => sum + d.actual_minutes, 0) / set.length : null;
  const beforeRaw = averageRaw(days.slice(0, 2));
  const afterRaw = averageRaw(days.slice(2));
  const deltaRaw = beforeRaw === null || afterRaw === null ? null : afterRaw - beforeRaw;
  const before = beforeRaw === null ? null : oneDecimal(beforeRaw);
  const after = afterRaw === null ? null : oneDecimal(afterRaw);
  const delta = deltaRaw === null ? null : oneDecimal(deltaRaw);
  return {
    question: '선택한 계획에서 오늘 실제 실행한 작업 시간은 총 몇 분인가?',
    unit: 'minutes', time_zone: 'Asia/Seoul', week_starts: 'Monday',
    plan_id: planId, days,
    five_days_complete: days.every(d => d.status === 'RECORDED'),
    mean_before_days_1_2: before,
    mean_after_days_3_5: after,
    delta_minutes_per_day: delta,
    change_percent: deltaRaw === null || beforeRaw === 0 ? null : oneDecimal(deltaRaw / beforeRaw * 100),
    notes: 'Missing days are NA, exact duplicate rows are counted once, >480 minute sessions are flagged but included.'
  };
}

function main() {
  if (process.argv.length !== 5) {
    throw new Error('Usage: node tools/t07-five-day-report.cjs account-export.json PLAN_ID YYYY-MM-DD,YYYY-MM-DD,YYYY-MM-DD,YYYY-MM-DD,YYYY-MM-DD');
  }
  const file = resolve(process.argv[2]);
  const planId = process.argv[3];
  const dates = process.argv[4].split(',').map(x => x.trim());
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(JSON.stringify(computeFiveDayReport(data, dates, planId), null, 2));
}

if (require.main === module) {
  try { main(); } catch (err) { console.error('T07 five-day report:', err.message); process.exitCode = 1; }
}

module.exports = { seoulDate, checkDates, computeFiveDayReport };
