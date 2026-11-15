-- Anonymous browser presence. No account, IP address, or browsing history is stored.
CREATE TABLE IF NOT EXISTS site_presence (
  visitor_id TEXT PRIMARY KEY,
  last_seen INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_site_presence_last_seen ON site_presence(last_seen);
