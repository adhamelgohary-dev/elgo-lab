-- Online user presence table for Admin Portal (tracks active authenticated/guest sessions without exposing PII publicly).
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
