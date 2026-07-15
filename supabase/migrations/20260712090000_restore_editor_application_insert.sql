-- Fix: 20260606034500_fix_admin_rls.sql rewrote handle_new_user() to auto-assign
-- the admin role, but dropped the editor_applications INSERT that the
-- 2026-05-13 version had. Since then, signups with an application bio created
-- NO editor_applications row, so the admin 编辑申请 page stayed empty.
-- This migration merges both behaviors and backfills the missed applications.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  is_first_user BOOLEAN;
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

  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first_user;

  IF is_first_user OR NEW.email IN ('arainjazz@163.com', 'arainjazz@gmail.com') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  application_bio := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'editor_application_bio', '')), '');
  IF application_bio IS NOT NULL THEN
    INSERT INTO public.editor_applications (user_id, email, bio)
    VALUES (NEW.id, NEW.email, application_bio)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

-- Backfill: users who signed up with an application bio while the INSERT was
-- missing get their pending application created now, dated to their signup.
INSERT INTO public.editor_applications (user_id, email, bio, created_at)
SELECT
  u.id,
  u.email,
  NULLIF(trim(u.raw_user_meta_data->>'editor_application_bio'), ''),
  u.created_at
FROM auth.users u
WHERE NULLIF(trim(COALESCE(u.raw_user_meta_data->>'editor_application_bio', '')), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.editor_applications a WHERE a.user_id = u.id
  );
