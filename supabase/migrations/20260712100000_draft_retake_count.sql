-- Retake-based scoring: how many times the user re-shot this plant before the
-- identification landed. Drives the bronze-leaf value of an identification —
-- 铜叶 = 1 + retake_count (or 1 if the result is 疑似 / low-confidence).
-- Code degrades gracefully when this column is absent (treats it as 0), so a
-- deploy before this migration is non-fatal.
ALTER TABLE public.plant_drafts
  ADD COLUMN IF NOT EXISTS retake_count integer NOT NULL DEFAULT 0;
