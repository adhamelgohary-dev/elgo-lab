-- =============================================================================
-- Faculty of AI — Learning Lab (Question Bank)
-- Cloudflare D1 Database Schema (SQLite)
-- =============================================================================
-- Rules:
-- 1. Never store large PDF binary files in D1. PDFs are stored in Cloudflare R2
--    (binding: FILES) and only metadata/paths are referenced in `pdfs_meta`.
-- 2. Never store plain-text admin passwords in D1. Admin verification uses
--    Cloudflare environment secret `ADMIN_PASSWORD` / `ADMIN_PASSWORD_HASH`.
-- =============================================================================

PRAGMA foreign_keys = ON;

-- 1. Student Users & Unique Usernames
CREATE TABLE IF NOT EXISTS users (
  student_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  username_change_count INTEGER NOT NULL DEFAULT 0,
  password_hash TEXT NOT NULL DEFAULT '',
  is_admin INTEGER NOT NULL DEFAULT 0,
  progress_json TEXT NOT NULL DEFAULT '{}',
  progress_rev INTEGER NOT NULL DEFAULT 0,
  progress_write_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);

-- 2. Quiz Attempts (Server-Validated Submissions)
CREATE TABLE IF NOT EXISTS quiz_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attempt_hash TEXT NOT NULL UNIQUE,
  student_id TEXT NOT NULL,
  username TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  quiz_title TEXT NOT NULL DEFAULT '',
  mode TEXT NOT NULL DEFAULT 'practice',
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  percentage INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  validated_by_server INTEGER NOT NULL DEFAULT 1,
  rank_status TEXT NOT NULL DEFAULT 'ranked',   -- ranked | partial | implausible_time
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_subject_quiz ON quiz_attempts(subject_id, quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_submitted_at ON quiz_attempts(submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student_time ON quiz_attempts(student_id, submitted_at);

-- 3. Best Scores per Student + Subject + Quiz (Powers Fast Leaderboard Queries)
-- Ranking rule:
--   1. Higher best_percentage DESC
--   2. Higher best_score DESC
--   3. Faster fastest_duration_ms ASC
--   4. Earlier achieved_at ASC
CREATE TABLE IF NOT EXISTS best_scores (
  student_id TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  username TEXT NOT NULL,
  quiz_title TEXT NOT NULL DEFAULT '',
  best_score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  best_percentage INTEGER NOT NULL,
  fastest_duration_ms INTEGER NOT NULL,
  attempts_count INTEGER NOT NULL DEFAULT 1,
  validated_by_server INTEGER NOT NULL DEFAULT 0,  -- only server-graded rows appear on the leaderboard
  achieved_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, subject_id, quiz_id),
  FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_best_scores_leaderboard
  ON best_scores(subject_id, quiz_id, best_percentage DESC, best_score DESC, fastest_duration_ms ASC, achieved_at ASC);

CREATE INDEX IF NOT EXISTS idx_best_scores_global
  ON best_scores(best_percentage DESC, best_score DESC, fastest_duration_ms ASC, achieved_at ASC);

-- 4. Student Progress Sync (Bookmarks, Mistakes, Completed Lectures)
CREATE TABLE IF NOT EXISTS student_progress (
  student_id TEXT PRIMARY KEY,
  bookmarks_json TEXT NOT NULL DEFAULT '[]',
  mistakes_json TEXT NOT NULL DEFAULT '{}',
  completed_lectures_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
);

-- 5. Academic Hierarchy Metadata (Faculties, Levels, Terms, Subjects)
CREATE TABLE IF NOT EXISTS faculties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS levels (
  id TEXT PRIMARY KEY,
  faculty_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (faculty_id) REFERENCES faculties(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS terms (
  id TEXT PRIMARY KEY,
  level_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (level_id) REFERENCES levels(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS subjects (
  id TEXT PRIMARY KEY,
  term_id TEXT NOT NULL DEFAULT 'term-2',
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT '',
  accent TEXT NOT NULL DEFAULT '#BA5A3C',
  icon TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 6. Quizzes Metadata
CREATE TABLE IF NOT EXISTS quizzes_meta (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'quiz',
  question_count INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 7. PDF Categories & PDFs Metadata (Actual PDF binaries live in Cloudflare R2)
CREATE TABLE IF NOT EXISTS pdf_categories (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  name TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pdf_categories_subject ON pdf_categories(subject_id, display_order ASC);

CREATE TABLE IF NOT EXISTS pdfs_meta (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Lectures',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  r2_key TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  size_label TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pdfs_meta_r2 ON pdfs_meta(r2_key);
CREATE INDEX IF NOT EXISTS idx_pdfs_meta_subject ON pdfs_meta(subject_id, is_deleted, display_order ASC);

-- 8. Videos Metadata (YouTube Links & Captions)
CREATE TABLE IF NOT EXISTS videos_meta (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Lectures',
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  video_id TEXT NOT NULL DEFAULT '',
  duration TEXT NOT NULL DEFAULT '',
  display_order INTEGER NOT NULL DEFAULT 0,
  is_deleted INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_videos_meta_subject ON videos_meta(subject_id, is_deleted, display_order ASC);

-- 9. Admin Sessions & Rate Limiting
CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  is_master_admin INTEGER NOT NULL DEFAULT 0,   -- only rows with 1 and an empty student_id are honoured
  student_id TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_sessions (
  token_hash TEXT PRIMARY KEY,
  student_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_student ON user_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires ON user_sessions(expires_at);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_rate_limits (
  ip_address TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  first_failed_at INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

-- 10. Admin Content Overrides Snapshot (JSON sync for hierarchy/custom additions)
CREATE TABLE IF NOT EXISTS admin_config (
  config_key TEXT PRIMARY KEY,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Anonymous active browsers (migration 0004).
CREATE TABLE IF NOT EXISTS site_presence (
  visitor_id TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_presence_last_seen ON site_presence(last_seen);

-- Student question issue reports (migration 0005).
CREATE TABLE IF NOT EXISTS question_reports (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT 'Anonymous',
  subject_id TEXT NOT NULL,
  quiz_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  question_text TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT 'incorrect_answer',
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  resolution_note TEXT NOT NULL DEFAULT '',
  resolved_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_question_reports_status_created
  ON question_reports(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_question_reports_subject_quiz
  ON question_reports(subject_id, quiz_id);

-- Active signed-in / named users (migration 0006; admin-only view).
CREATE TABLE IF NOT EXISTS online_users_presence (
  student_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  is_guest INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  current_area TEXT NOT NULL DEFAULT '',
  last_seen INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_online_users_last_seen
  ON online_users_presence(last_seen DESC);
