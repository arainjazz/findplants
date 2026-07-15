-- Two additions to plant_drafts driving the new "complete-before-you-submit" flow:
--
-- 1. submitted_for_review — a draft only enters the AI review queue / appears on the
--    身边物种地图 AFTER the user explicitly taps「保存为待审批草稿」. Until then the user
--    is still refining (retaking, enriching) and the record stays private to them.
--    Existing drafts are backfilled to TRUE so nothing already public disappears.
--
-- 2. user_photos — the ordered list of the USER's own shots for this species. Retakes
--    append here (instead of creating a new draft), so the summary card can show every
--    photo the user took, and the share-card cover can use the shot that finally
--    resolved the identification out of「疑似」(low confidence).
--
-- Code degrades gracefully when either column is absent (treats submitted_for_review
-- as TRUE and user_photos as []), so a deploy before this migration is non-fatal.

ALTER TABLE public.plant_drafts
  ADD COLUMN IF NOT EXISTS submitted_for_review boolean NOT NULL DEFAULT false;

ALTER TABLE public.plant_drafts
  ADD COLUMN IF NOT EXISTS user_photos jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill: everything that already existed was already visible in the queue/map, so
-- keep it visible. New drafts default to FALSE (hidden until the user submits).
UPDATE public.plant_drafts SET submitted_for_review = true WHERE submitted_for_review = false;

-- Seed user_photos for existing drafts with their single stored photo so the gallery
-- isn't empty for older records.
UPDATE public.plant_drafts
  SET user_photos = jsonb_build_array(photo_url)
  WHERE (user_photos IS NULL OR user_photos = '[]'::jsonb) AND photo_url IS NOT NULL AND photo_url <> '';

-- Approved drafts must stay visible regardless (they're already published).
-- (Covered by the backfill above, but explicit for clarity.)
UPDATE public.plant_drafts SET submitted_for_review = true WHERE status = 'approved';
