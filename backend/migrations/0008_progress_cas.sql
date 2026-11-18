-- =============================================================================
-- Migration 0008: Optimistic concurrency columns for atomic progress CAS
-- =============================================================================
-- Adds monotonic `progress_rev` and per-write `progress_write_id` on `users`
-- so `users.progress_json` and `student_progress` update atomically via
-- compare-and-swap inside D1 batches without duplicating large JSON bindings.
-- =============================================================================

ALTER TABLE users ADD COLUMN progress_rev INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN progress_write_id TEXT NOT NULL DEFAULT '';
