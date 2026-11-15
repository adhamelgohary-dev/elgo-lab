-- =============================================================================
-- Migration 0001: Initial D1 Schema & Default Academic Hierarchy Seed
-- Faculty of AI — Learning Lab (Question Bank)
-- =============================================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  student_id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  username_change_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username COLLATE NOCASE);

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
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts(student_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_subject_quiz ON quiz_attempts(subject_id, quiz_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_submitted_at ON quiz_attempts(submitted_at DESC);

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
  achieved_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (student_id, subject_id, quiz_id),
  FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_best_scores_leaderboard
  ON best_scores(subject_id, quiz_id, best_percentage DESC, best_score DESC, fastest_duration_ms ASC, achieved_at ASC);

CREATE INDEX IF NOT EXISTS idx_best_scores_global
  ON best_scores(best_percentage DESC, best_score DESC, fastest_duration_ms ASC, achieved_at ASC);

CREATE TABLE IF NOT EXISTS student_progress (
  student_id TEXT PRIMARY KEY,
  bookmarks_json TEXT NOT NULL DEFAULT '[]',
  mistakes_json TEXT NOT NULL DEFAULT '{}',
  completed_lectures_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (student_id) REFERENCES users(student_id) ON DELETE CASCADE
);

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

CREATE TABLE IF NOT EXISTS quizzes_meta (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'quiz',
  question_count INTEGER NOT NULL DEFAULT 0,
  display_order INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE INDEX IF NOT EXISTS idx_pdfs_meta_subject ON pdfs_meta(subject_id, is_deleted, display_order ASC);

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

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  ip_address TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS admin_rate_limits (
  ip_address TEXT PRIMARY KEY,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  first_failed_at INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS admin_config (
  config_key TEXT PRIMARY KEY,
  config_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed Default Academic Hierarchy
INSERT OR IGNORE INTO faculties (id, name, name_ar, display_order)
VALUES ('faculty-ai', 'Faculty of Artificial Intelligence', 'كلية الذكاء الاصطناعي', 1);

INSERT OR IGNORE INTO levels (id, faculty_id, name, display_order)
VALUES ('level-2', 'faculty-ai', 'Level 2', 1);

INSERT OR IGNORE INTO terms (id, level_id, name, display_order)
VALUES ('term-2', 'level-2', 'Term 2', 1);

INSERT OR IGNORE INTO subjects (id, term_id, name, name_ar, accent, display_order) VALUES
  ('sub-ml', 'term-2', 'Machine Learning & Pattern Recognition', 'تعلم الآلة والتعرف على الأنماط', '#BA5A3C', 1),
  ('sub-cn', 'term-2', 'Computer Networks', 'شبكات الحاسب', '#8F6543', 2),
  ('sub-dm', 'term-2', 'Data Mining', 'التنقيب في البيانات', '#4D7358', 3),
  ('sub-dl', 'term-2', 'Digital Logic', 'المنطق الرقمي', '#B87B28', 4),
  ('sub-or', 'term-2', 'Operations Research', 'بحوث العمليات', '#A95248', 5),
  ('sub-na', 'term-2', 'Numerical Analysis', 'التحليل العددي', '#6E665E', 6);
