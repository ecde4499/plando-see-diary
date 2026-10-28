'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { seoulDate, computeFiveDayReport, checkDates } = require('../tools/t07-five-day-report.cjs');

const days = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'];
const fixture = (logs, tasks = [{ id: 'task-one', plan_id: 'plan-one', deleted_at: null }]) => ({
  plans: [{ id: 'plan-one' }],
  tasks,
  execution_logs: logs
});
const log = (id, date, minutes, other = {}) => ({
  id, task_id: 'task-one', started_at: date + 'T12:00:00+09:00',
  ended_at: date + 'T12:15:00+09:00', actual_minutes: minutes,
  blocked_reason: '', ...other
});

test('T07 KST conversion attributes UTC events to Seoul date', () => {
  assert.equal(seoulDate('2026-10-28T23:30:00Z'), '2026-10-29');
  assert.equal(seoulDate('invalid'), null);
});

test('T07 five-day metric uses one plan, exact-dedup, and matched comparison', () => {
  const logs = [
    log('one', days[0], 30),
    log('two', days[1], 90),
    log('duplicate', days[1], 90),
    log('three', days[2], 120),
    log('four', days[3], 90),
    log('five', days[4], 60),
    log('unrelated', days[0], 999, { task_id: 'different-task' })
  ];
  const result = computeFiveDayReport(fixture(logs), days, 'plan-one');
  assert.equal(result.five_days_complete, true);
  assert.deepEqual(result.days.map(d => d.actual_minutes), [30, 90, 120, 90, 60]);
  assert.equal(result.days[1].duplicate_ignored, 1);
  assert.equal(result.mean_before_days_1_2, 60);
  assert.equal(result.mean_after_days_3_5, 90);
  assert.equal(result.delta_minutes_per_day, 30);
  assert.equal(result.change_percent, 50);
});

test('T07 missing records are NA and zero-minute real events remain zero', () => {
  const result = computeFiveDayReport(fixture([log('zero', days[0], 0)]), days, 'plan-one');
  assert.equal(result.days[0].actual_minutes, 0);
  assert.equal(result.days[0].status, 'RECORDED');
  assert.equal(result.days[1].actual_minutes, null);
  assert.equal(result.days[1].status, 'MISSING');
  assert.equal(result.five_days_complete, false);
  assert.equal(result.mean_before_days_1_2, null);
  assert.equal(result.change_percent, null);
});

test('T07 sessions over 480 minutes are flagged but counted; deleted tasks ignored', () => {
  const data = fixture([
    log('long', days[0], 481),
    log('deleted', days[0], 300, { task_id: 'deleted-task' })
  ], [
    { id: 'task-one', plan_id: 'plan-one', deleted_at: null },
    { id: 'deleted-task', plan_id: 'plan-one', deleted_at: '2026-10-29T00:00:00Z' }
  ]);
  const result = computeFiveDayReport(data, days, 'plan-one');
  assert.equal(result.days[0].actual_minutes, 481);
  assert.equal(result.days[0].outlier_over_480m, 1);
  assert.equal(result.days[0].records, 1);
});

test('T07 dates and plan selection reject fabricated or invalid evidence', () => {
  assert.throws(() => checkDates(days.slice(0, 4)), /Exactly five/);
  assert.throws(() => checkDates([days[0], days[0], days[2], days[3], days[4]]), /distinct/);
  assert.throws(() => checkDates(['2026-02-30', ...days.slice(1)]), /Invalid/);
  assert.throws(() => computeFiveDayReport(fixture([]), days, 'other-plan'), /existing plan ID/);
});
