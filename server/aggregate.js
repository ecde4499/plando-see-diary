function computeSummary(tasks, logs, todaySeoul) {
  const active = tasks.filter((t) => !t.deleted_at);
  const taskIds = new Set(active.map((t) => t.id));
  const relevantLogs = logs.filter((l) => taskIds.has(l.task_id));
  const blockedTaskIds = new Set(
    relevantLogs.filter((l) => String(l.blocked_reason || '').trim()).map((l) => l.task_id)
  );

  const planCount = active.length;
  const completedCount = active.filter((t) => t.status === '완료').length;
  const overdueCount = active.filter(
    (t) => t.status !== '완료' && t.due_date && String(t.due_date).slice(0, 10) < todaySeoul
  ).length;
  const blockedCount = blockedTaskIds.size;
  const estimatedMinutes = active.reduce((sum, t) => sum + Number(t.estimated_minutes || 0), 0);
  const actualMinutes = relevantLogs.reduce((sum, l) => sum + Number(l.actual_minutes || 0), 0);

  return {
    planCount,
    completedCount,
    overdueCount,
    blockedCount,
    estimatedMinutes,
    actualMinutes,
    differenceMinutes: actualMinutes - estimatedMinutes
  };
}

module.exports = { computeSummary };
