-- Shut the Box — day_stats schema (D1/SQLite).
-- Aggregate-only: one row per daily-challenge day.
CREATE TABLE IF NOT EXISTS day_stats (
  day       TEXT PRIMARY KEY,          -- YYYY-MM-DD
  plays     INTEGER NOT NULL DEFAULT 0,
  score_sum INTEGER NOT NULL DEFAULT 0,
  best      INTEGER,                   -- lowest score seen (NULL until first result)
  perfects  INTEGER NOT NULL DEFAULT 0
);
