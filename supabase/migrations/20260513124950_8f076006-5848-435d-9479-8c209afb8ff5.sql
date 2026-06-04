CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;

CREATE OR REPLACE FUNCTION private.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE OR REPLACE FUNCTION private.is_approved_editor(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin'::public.app_role, 'editor'::public.app_role)
  )
$$;

REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.is_approved_editor(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION private.is_approved_editor(uuid) TO postgres, service_role;

DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Users can view their own application or admins all" ON public.editor_applications;
DROP POLICY IF EXISTS "Users update own pending or admin updates any" ON public.editor_applications;
CREATE POLICY "Users can view their own application or admins all"
  ON public.editor_applications FOR SELECT
  USING (auth.uid() = user_id OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Users update own pending or admin updates any"
  ON public.editor_applications FOR UPDATE
  USING ((auth.uid() = user_id AND status = 'pending') OR private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK ((auth.uid() = user_id AND status = 'pending') OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Approved editors can insert plants" ON public.plants;
DROP POLICY IF EXISTS "Approved author or admin can update plants" ON public.plants;
DROP POLICY IF EXISTS "Author or admin can delete plants" ON public.plants;
CREATE POLICY "Approved editors can insert plants"
  ON public.plants FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = author_id AND private.is_approved_editor(auth.uid()));
CREATE POLICY "Approved author or admin can update plants"
  ON public.plants FOR UPDATE TO authenticated
  USING ((auth.uid() = author_id AND private.is_approved_editor(auth.uid())) OR private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK ((auth.uid() = author_id AND private.is_approved_editor(auth.uid())) OR private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Author or admin can delete plants"
  ON public.plants FOR DELETE TO authenticated
  USING ((auth.uid() = author_id AND private.is_approved_editor(auth.uid())) OR private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Approved editors can insert own edits" ON public.plant_edits;
DROP POLICY IF EXISTS "Only admin can update edits" ON public.plant_edits;
DROP POLICY IF EXISTS "Only admin can delete edits" ON public.plant_edits;
CREATE POLICY "Approved editors can insert own edits"
  ON public.plant_edits FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = editor_id AND private.is_approved_editor(auth.uid()));
CREATE POLICY "Only admin can update edits"
  ON public.plant_edits FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (private.has_role(auth.uid(), 'admin'::public.app_role));
CREATE POLICY "Only admin can delete edits"
  ON public.plant_edits FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS "Owner or admin delete plant images" ON storage.objects;
DROP POLICY IF EXISTS "Owner or admin update plant images" ON storage.objects;
DROP POLICY IF EXISTS "Owner or admin delete plant html" ON storage.objects;
DROP POLICY IF EXISTS "Owner or admin update plant html" ON storage.objects;
CREATE POLICY "Owner or admin delete plant images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plant-images' AND (auth.uid()::text = (storage.foldername(name))[1] OR private.has_role(auth.uid(), 'admin'::public.app_role)));
CREATE POLICY "Owner or admin update plant images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'plant-images' AND (auth.uid()::text = (storage.foldername(name))[1] OR private.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK (bucket_id = 'plant-images' AND (auth.uid()::text = (storage.foldername(name))[1] OR private.has_role(auth.uid(), 'admin'::public.app_role)));
CREATE POLICY "Owner or admin delete plant html"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plant-html' AND (auth.uid()::text = (storage.foldername(name))[1] OR private.has_role(auth.uid(), 'admin'::public.app_role)));
CREATE POLICY "Owner or admin update plant html"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'plant-html' AND (auth.uid()::text = (storage.foldername(name))[1] OR private.has_role(auth.uid(), 'admin'::public.app_role)))
  WITH CHECK (bucket_id = 'plant-html' AND (auth.uid()::text = (storage.foldername(name))[1] OR private.has_role(auth.uid(), 'admin'::public.app_role)));

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_approved_editor(uuid) FROM PUBLIC, anon, authenticated;