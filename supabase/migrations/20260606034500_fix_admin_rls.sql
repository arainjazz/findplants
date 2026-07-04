-- 1. Update handle_new_user function to automatically assign admin role to first user or site admin emails
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  is_first_user BOOLEAN;
BEGIN
  -- Insert profile
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );

  -- Check if this is the first user
  SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO is_first_user;

  -- Auto-assign admin role if first user or email matches the site admin emails
  IF is_first_user OR NEW.email = 'arainjazz@163.com' OR NEW.email = 'arainjazz@gmail.com' THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  RETURN NEW;
END $$;

-- 2. Insert admin role for any existing users with these emails
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'admin'::public.app_role FROM auth.users
WHERE email IN ('arainjazz@163.com', 'arainjazz@gmail.com')
ON CONFLICT (user_id, role) DO NOTHING;

-- 3. Update RLS policies on plants to ensure admins can insert/update/delete freely
DROP POLICY IF EXISTS "Approved editors can insert plants" ON public.plants;
CREATE POLICY "Approved editors can insert plants"
  ON public.plants FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = author_id AND private.is_approved_editor(auth.uid()))
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );

-- 4. Update RLS policies on plant_edits to ensure admins can insert freely
DROP POLICY IF EXISTS "Approved editors can insert own edits" ON public.plant_edits;
CREATE POLICY "Approved editors can insert own edits"
  ON public.plant_edits FOR INSERT TO authenticated
  WITH CHECK (
    (auth.uid() = editor_id AND private.is_approved_editor(auth.uid()))
    OR private.has_role(auth.uid(), 'admin'::public.app_role)
  );
