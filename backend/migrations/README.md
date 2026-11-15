# Cloudflare D1 Database Schema & Migrations

- **Fresh deployments / forks**: Execute `backend/schema.sql` once against an empty D1 database:
  ```bash
  npx wrangler d1 execute <your-d1-database-name> --remote --file backend/schema.sql
  ```
- **Existing production instances**: Files `0001` through `0006` in this folder record incremental upgrades applied chronologically to live databases created from earlier schema revisions:
  1. `0001_initial.sql` — initial tables (`students`, `sessions`, `attempts`, `best_scores`, settings, reports).
  2. `0002_score_integrity.sql` — server-verified score validation + historical collection baseline counts at the time of rollout.
  3. `0003_leaderboard_new_season.sql` — leaderboard season reset flags (`legacy_unverified`).
  4. `0004_site_presence.sql` — `site_presence` ephemeral active-user counter table.
  5. `0005_reports_xp_streaks.sql` — question report workflow fields (`resolution_note`, `resolved_by`, `resolved_at`), user XP, and study streak columns.
  6. `0006_online_user_presence.sql` — `online_users_presence` active username visibility for Admin Portal.

Do not alter or renumber already-applied historical `.sql` files; add a new `0007_*.sql` migration alongside updating `backend/schema.sql` whenever the schema evolves further.
