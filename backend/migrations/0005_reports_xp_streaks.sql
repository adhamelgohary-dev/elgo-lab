-- Question issue reports & study activity index helpers (Phase 18)
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
