BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('낮음','보통','높음')),
  success_criteria TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 0),
  source_reflection_id UUID NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS plan_revisions (
  id BIGSERIAL PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  title TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  priority TEXT NOT NULL,
  success_criteria TEXT NOT NULL,
  estimated_minutes INTEGER NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(plan_id, revision_no)
);

CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  content TEXT NOT NULL DEFAULT '',
  due_date DATE NULL,
  priority TEXT NOT NULL CHECK (priority IN ('낮음','보통','높음')),
  tags TEXT[] NOT NULL DEFAULT '{}',
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 0),
  status TEXT NOT NULL DEFAULT '진행 중' CHECK (status IN ('진행 중','완료')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ NULL
);

CREATE TABLE IF NOT EXISTS execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ NOT NULL,
  actual_minutes INTEGER NOT NULL CHECK (actual_minutes >= 0),
  blocked_reason TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ended_at >= started_at)
);

CREATE TABLE IF NOT EXISTS completion_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  reopened_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(task_id, idempotency_key)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_active_completion_per_task
  ON completion_events(task_id) WHERE active = TRUE;

CREATE TABLE IF NOT EXISTS reflections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_plan_id UUID NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
  improvement_text TEXT NOT NULL CHECK (length(trim(improvement_text)) > 0),
  next_plan_id UUID NULL REFERENCES plans(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE plans
  DROP CONSTRAINT IF EXISTS plans_source_reflection_id_fkey;
ALTER TABLE plans
  ADD CONSTRAINT plans_source_reflection_id_fkey
  FOREIGN KEY (source_reflection_id) REFERENCES reflections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_plan_active ON tasks(plan_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_execution_logs_task ON execution_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_plan_revisions_plan ON plan_revisions(plan_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS idx_reflections_source_plan ON reflections(source_plan_id);

COMMIT;
