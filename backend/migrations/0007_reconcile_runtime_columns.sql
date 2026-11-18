-- Migration 0007: Reconcile columns historically added at runtime before worker schema-alteration was removed.
-- Intended ONLY for databases created from 0001..0006 without prior runtime ALTER TABLEs.
-- NOT idempotent (SQLite lacks ADD COLUMN IF NOT EXISTS): inspect PRAGMA table_info(users) and
-- PRAGMA table_info(admin_sessions) before applying to an existing DB (see backend/migrations/README.md).

ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN progress_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE admin_sessions ADD COLUMN is_master_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_sessions ADD COLUMN student_id TEXT DEFAULT '';

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_student ON user_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);
