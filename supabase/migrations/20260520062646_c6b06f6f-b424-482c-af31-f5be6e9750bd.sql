-- Keep plants.comments_count synced with the count of visitor + editor entries
-- in plant_comments. This way the "热度" sort and per-card "X 评论" labels
-- include unauthenticated visitor comments instead of only editor blocks.

CREATE OR REPLACE FUNCTION public.sync_plant_comments_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_plant uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_plant := OLD.plant_id;
  ELSE
    target_plant := NEW.plant_id;
  END IF;

  IF target_plant IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.plants
  SET comments_count = (
    SELECT COUNT(*)::int FROM public.plant_comments WHERE plant_id = target_plant
  )
  WHERE id = target_plant;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS plant_comments_count_sync ON public.plant_comments;

CREATE TRIGGER plant_comments_count_sync
AFTER INSERT OR DELETE ON public.plant_comments
FOR EACH ROW EXECUTE FUNCTION public.sync_plant_comments_count();

-- Backfill the current counts (one-off recalculation for existing data).
UPDATE public.plants p
SET comments_count = COALESCE(c.cnt, 0)
FROM (
  SELECT plant_id, COUNT(*)::int AS cnt
  FROM public.plant_comments
  GROUP BY plant_id
) c
WHERE p.id = c.plant_id;

UPDATE public.plants
SET comments_count = 0
WHERE id NOT IN (SELECT DISTINCT plant_id FROM public.plant_comments WHERE plant_id IS NOT NULL);