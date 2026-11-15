-- =============================================================================
-- 0002_score_integrity.sql  (prepared 2026-11-10 — NOT APPLIED TO PRODUCTION)
--
-- Prerequisite: the production database already contains the columns that the OLD
-- worker added at runtime (users.password_hash/is_admin/progress_json,
-- admin_sessions.is_master_admin/student_id and the user_sessions table). Verify with
--   npx wrangler d1 execute elgo_lab_db --remote --command "PRAGMA table_info(admin_sessions)"
-- A brand-new database should be created from backend/schema.sql instead.
--
-- Apply this BEFORE deploying the new worker. The new worker no longer alters the schema.
-- Take an export first:  npx wrangler d1 export elgo_lab_db --remote --output backup.sql
-- =============================================================================

-- Only server-graded rows may appear on the leaderboard.
ALTER TABLE best_scores ADD COLUMN validated_by_server INTEGER NOT NULL DEFAULT 0;

-- Why an attempt did / did not count: ranked | partial | implausible_time
ALTER TABLE quiz_attempts ADD COLUMN rank_status TEXT NOT NULL DEFAULT 'ranked';

-- Backfill: keep rows that are backed by an attempt the OLD worker graded from real answers.
UPDATE best_scores SET validated_by_server = 1
WHERE EXISTS (
  SELECT 1 FROM quiz_attempts a
  WHERE a.student_id = best_scores.student_id
    AND a.subject_id = best_scores.subject_id
    AND a.quiz_id   = best_scores.quiz_id
    AND a.validated_by_server = 1
    AND a.score = best_scores.best_score
);

-- N-1 guard (final review 2026-11-10): the OLD worker marked an attempt validated whenever any
-- submitted answer matched the global answer map, even under an invented quiz id, and it let the
-- score exceed the quiz's real size. Un-rank every row whose (subject, quiz) is not a collection in
-- backend/answer-key.js, or whose best score is larger than that collection's gradable questions.
-- Rows are kept (only the flag changes), so the decision can be reviewed or reversed.
-- The list below is generated from backend/answer-key.js; tests/security-backend.test.js fails if they drift.
UPDATE best_scores SET validated_by_server = 0
WHERE validated_by_server = 1
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES
  ('demo-course::quiz-1', 6),
  ('demo-course::quiz-2', 4),
  ('demo-course::lecture-1', 1),
  ('demo-course::sheet-1', 1)
    ) AS k
    WHERE k.column1 = best_scores.subject_id || '::' || best_scores.quiz_id
      AND best_scores.best_score <= k.column2
  );

CREATE INDEX IF NOT EXISTS idx_pdfs_meta_r2 ON pdfs_meta(r2_key);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student_time ON quiz_attempts(student_id, submitted_at);
