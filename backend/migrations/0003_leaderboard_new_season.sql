-- =============================================================================
-- 0003_leaderboard_new_season.sql  (owner decision 2026-11-10: option B, "new season")
--
-- Every leaderboard row recorded before the new server-graded backend is taken out of the
-- ranking, so all students start a fresh season on equal terms. The old worker's "validated"
-- flag proved unreliable (see elgo-lab-improvements-report-2026-11-10.md, section 4).
--
-- Nothing is deleted: rows only change a flag, so the old season can be restored with
--   UPDATE best_scores SET validated_by_server = 1 WHERE validated_by_server = 0;
-- Students' first ranked attempt on a quiz replaces their old-season row (backend/worker.js).
-- Requires 0002 (adds the columns). Runs once through `wrangler d1 migrations apply`.
-- =============================================================================

UPDATE best_scores SET validated_by_server = 0;

-- Label old attempts so reports can tell the seasons apart (attempt history is kept).
UPDATE quiz_attempts SET rank_status = 'legacy';

-- Record when and why the season started.
INSERT INTO admin_config (config_key, config_json, updated_at)
VALUES ('leaderboard_season', '{"season":2,"startedAt":"2026-11-10","reason":"New season: rankings only from server-graded attempts. Old rows kept, unranked."}', datetime('now'))
ON CONFLICT(config_key) DO NOTHING;
