-- T07 additive migration. Run ONLY after backup and explicit approval.
-- Do not execute against the T06 production database during development.
BEGIN;

CREATE TABLE IF NOT EXISTS app_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT app_users_email_not_blank CHECK (length(trim(email)) > 0),
  CONSTRAINT app_users_email_lowercase CHECK (email = lower(trim(email)))
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_unique ON app_users(email);

-- Only a digest of a random session token is stored, never its raw value.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);

-- Existing T06 rows are left unclaimed. NULL owner rows must NEVER be
-- returned by authenticated data APIs or claimed through public signup.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS owner_user_id UUID NULL REFERENCES app_users(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS plans_owner_idx ON plans(owner_user_id);

-- Descendant ownership is derived from the parent plan via FK joins.
-- Validate same-owner relations on every mutation, including plan links.
-- No existing plan/task/execution/reflection/revision/event is modified.
COMMIT;
