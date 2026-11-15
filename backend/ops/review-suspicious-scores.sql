-- Read-only review queries for leaderboard integrity. Nothing here modifies data.

-- 1. Perfect scores faster than 1.5 s per question (likely scripted)
SELECT username, subject_id, quiz_id, best_score, total, best_percentage, fastest_duration_ms,
       ROUND(fastest_duration_ms * 1.0 / MAX(total,1)) AS ms_per_question
FROM best_scores
WHERE total >= 5 AND fastest_duration_ms < total * 1500
ORDER BY ms_per_question ASC LIMIT 100;

-- 2. Rows not backed by a server-validated attempt
SELECT username, subject_id, quiz_id, best_score, total FROM best_scores WHERE validated_by_server = 0 LIMIT 200;

-- 3. Quizzes that do not exist in the answer key can be spotted by unusual ids
SELECT quiz_id, COUNT(*) AS rows_ FROM best_scores GROUP BY quiz_id ORDER BY rows_ ASC LIMIT 100;
