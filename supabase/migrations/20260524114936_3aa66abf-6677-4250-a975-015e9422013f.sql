
-- 1. Remove sensitive tables from realtime publication
ALTER PUBLICATION supabase_realtime DROP TABLE public.editor_applications;
ALTER PUBLICATION supabase_realtime DROP TABLE public.plant_edits;

-- 2. plant_comments INSERT: enforce author_id matches auth.uid() (or null for anon)
DROP POLICY IF EXISTS "Anyone can post comments" ON public.plant_comments;
CREATE POLICY "Anyone can post comments"
ON public.plant_comments
FOR INSERT
WITH CHECK (
  length(btrim(body)) > 0
  AND length(body) <= 4000
  AND (author_id IS NULL OR auth.uid() = author_id)
);

-- 3. Mask email addresses currently stored in public name columns.
-- Use profiles.display_name where possible, otherwise local-part only.
UPDATE public.plant_comments c
SET author_name = COALESCE(
  NULLIF(p.display_name, ''),
  split_part(c.author_name, '@', 1)
)
FROM public.profiles p
WHERE c.author_id = p.id
  AND c.author_name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

UPDATE public.plant_comments
SET author_name = split_part(author_name, '@', 1)
WHERE author_name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

UPDATE public.plant_edits e
SET editor_name = COALESCE(
  NULLIF(p.display_name, ''),
  split_part(e.editor_name, '@', 1)
)
FROM public.profiles p
WHERE e.editor_id = p.id
  AND e.editor_name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

UPDATE public.plant_edits
SET editor_name = split_part(editor_name, '@', 1)
WHERE editor_name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

UPDATE public.tags t
SET created_by_name = COALESCE(
  NULLIF(p.display_name, ''),
  split_part(t.created_by_name, '@', 1)
)
FROM public.profiles p
WHERE t.created_by = p.id
  AND t.created_by_name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

UPDATE public.tags
SET created_by_name = split_part(created_by_name, '@', 1)
WHERE created_by_name ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$';

-- Trigger to scrub future inserts/updates of email-like name values.
CREATE OR REPLACE FUNCTION public.scrub_email_like_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  col_name text;
  val text;
BEGIN
  IF TG_TABLE_NAME = 'plant_comments' THEN
    col_name := 'author_name';
    val := NEW.author_name;
  ELSIF TG_TABLE_NAME = 'plant_edits' THEN
    col_name := 'editor_name';
    val := NEW.editor_name;
  ELSIF TG_TABLE_NAME = 'tags' THEN
    col_name := 'created_by_name';
    val := NEW.created_by_name;
  ELSE
    RETURN NEW;
  END IF;

  IF val IS NOT NULL AND val ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    val := split_part(val, '@', 1);
    IF TG_TABLE_NAME = 'plant_comments' THEN NEW.author_name := val;
    ELSIF TG_TABLE_NAME = 'plant_edits' THEN NEW.editor_name := val;
    ELSIF TG_TABLE_NAME = 'tags' THEN NEW.created_by_name := val;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS scrub_email_plant_comments ON public.plant_comments;
CREATE TRIGGER scrub_email_plant_comments
BEFORE INSERT OR UPDATE ON public.plant_comments
FOR EACH ROW EXECUTE FUNCTION public.scrub_email_like_name();

DROP TRIGGER IF EXISTS scrub_email_plant_edits ON public.plant_edits;
CREATE TRIGGER scrub_email_plant_edits
BEFORE INSERT OR UPDATE ON public.plant_edits
FOR EACH ROW EXECUTE FUNCTION public.scrub_email_like_name();

DROP TRIGGER IF EXISTS scrub_email_tags ON public.tags;
CREATE TRIGGER scrub_email_tags
BEFORE INSERT OR UPDATE ON public.tags
FOR EACH ROW EXECUTE FUNCTION public.scrub_email_like_name();

-- 4. user_roles: restrict SELECT to authenticated users (own row or admin).
DROP POLICY IF EXISTS "Roles viewable by everyone" ON public.user_roles;
CREATE POLICY "Authenticated users can view own roles"
ON public.user_roles
FOR SELECT
TO authenticated
USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::app_role));

-- 5. Storage: require approved editor for uploads to plant buckets.
DROP POLICY IF EXISTS "Authenticated upload plant images" ON storage.objects;
CREATE POLICY "Authenticated upload plant images"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'plant-images'
  AND (auth.uid())::text = (storage.foldername(name))[1]
  AND private.is_approved_editor(auth.uid())
);

DROP POLICY IF EXISTS "Authenticated upload plant html" ON storage.objects;
CREATE POLICY "Authenticated upload plant html"
ON storage.objects
FOR INSERT
WITH CHECK (
  bucket_id = 'plant-html'
  AND (auth.uid())::text = (storage.foldername(name))[1]
  AND private.is_approved_editor(auth.uid())
);
