CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  application_bio text;
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    avatar_url = EXCLUDED.avatar_url,
    updated_at = now();

  application_bio := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'editor_application_bio', '')), '');
  IF application_bio IS NOT NULL THEN
    INSERT INTO public.editor_applications (user_id, email, bio)
    VALUES (NEW.id, NEW.email, application_bio)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END
$function$;

DROP POLICY IF EXISTS "Authenticated users can insert plants" ON public.plants;
DROP POLICY IF EXISTS "Author or admin can update" ON public.plants;
DROP POLICY IF EXISTS "Author or admin can delete" ON public.plants;
DROP POLICY IF EXISTS "Authenticated can insert own edits" ON public.plant_edits;

CREATE POLICY "Approved editors can insert plants"
  ON public.plants FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id AND public.is_approved_editor(auth.uid()));

CREATE POLICY "Approved author or admin can update plants"
  ON public.plants FOR UPDATE TO authenticated
  USING ((auth.uid() = author_id AND public.is_approved_editor(auth.uid())) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Author or admin can delete plants"
  ON public.plants FOR DELETE TO authenticated
  USING ((auth.uid() = author_id AND public.is_approved_editor(auth.uid())) OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved editors can insert own edits"
  ON public.plant_edits FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = editor_id AND public.is_approved_editor(auth.uid()));

ALTER TABLE public.plant_edits REPLICA IDENTITY FULL;
ALTER TABLE public.editor_applications REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'plant_edits'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.plant_edits';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'editor_applications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.editor_applications';
  END IF;
END $$;