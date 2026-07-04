
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
CREATE TYPE public.plant_content_type AS ENUM ('rich', 'html');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles are viewable by everyone"
  ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- ============ USER ROLES ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

CREATE POLICY "Roles viewable by everyone"
  ON public.user_roles FOR SELECT USING (true);
CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- ============ PLANTS ============
CREATE TABLE public.plants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  scientific_name TEXT,
  family TEXT,
  habitat TEXT,
  summary TEXT,
  cover_url TEXT,
  content_type public.plant_content_type NOT NULL DEFAULT 'rich',
  rich_content TEXT,
  html_url TEXT,
  tags TEXT[] NOT NULL DEFAULT '{}',
  author_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX plants_author_idx ON public.plants(author_id);
CREATE INDEX plants_created_idx ON public.plants(created_at DESC);
CREATE INDEX plants_featured_idx ON public.plants(is_featured) WHERE is_featured = true;

ALTER TABLE public.plants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Plants viewable by everyone"
  ON public.plants FOR SELECT USING (true);
CREATE POLICY "Authenticated users can insert plants"
  ON public.plants FOR INSERT TO authenticated WITH CHECK (auth.uid() = author_id);
CREATE POLICY "Author or admin can update"
  ON public.plants FOR UPDATE TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Author or admin can delete"
  ON public.plants FOR DELETE TO authenticated
  USING (auth.uid() = author_id OR public.has_role(auth.uid(), 'admin'));

-- ============ TIMESTAMP TRIGGER ============
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER plants_touch BEFORE UPDATE ON public.plants
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ AUTO-CREATE PROFILE ON SIGNUP ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============ STORAGE BUCKETS ============
INSERT INTO storage.buckets (id, name, public) VALUES
  ('plant-images', 'plant-images', true),
  ('plant-html', 'plant-html', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Public read plant images"
  ON storage.objects FOR SELECT USING (bucket_id = 'plant-images');
CREATE POLICY "Authenticated upload plant images"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plant-images' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owner or admin delete plant images"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plant-images' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Owner or admin update plant images"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'plant-images' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin')));

CREATE POLICY "Public read plant html"
  ON storage.objects FOR SELECT USING (bucket_id = 'plant-html');
CREATE POLICY "Authenticated upload plant html"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plant-html' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "Owner or admin delete plant html"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'plant-html' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin')));
CREATE POLICY "Owner or admin update plant html"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'plant-html' AND (auth.uid()::text = (storage.foldername(name))[1] OR public.has_role(auth.uid(), 'admin')));

-- Fix touch_updated_at search_path
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- Lock down SECURITY DEFINER function execution
REVOKE EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(UUID, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- Storage: drop broad SELECT and replace with no-list policies
-- Public reads still work via direct URL because bucket is public; we just disable listing
DROP POLICY IF EXISTS "Public read plant images" ON storage.objects;
DROP POLICY IF EXISTS "Public read plant html" ON storage.objects;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS comments_count integer NOT NULL DEFAULT 0;-- Add english common name column
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS common_name_en TEXT;

-- Edit kind enum
DO $$ BEGIN
  CREATE TYPE public.plant_edit_kind AS ENUM ('text','image','revert');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- plant_edits table for community edit history
CREATE TABLE IF NOT EXISTS public.plant_edits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id UUID NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  editor_id UUID NOT NULL,
  editor_name TEXT,
  kind public.plant_edit_kind NOT NULL,
  marker_n INTEGER NOT NULL DEFAULT 0,
  block_path TEXT,
  before_html TEXT,
  after_html TEXT,
  reverted BOOLEAN NOT NULL DEFAULT false,
  reverted_by UUID,
  reverted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plant_edits_plant_id ON public.plant_edits(plant_id);
CREATE INDEX IF NOT EXISTS idx_plant_edits_editor_id ON public.plant_edits(editor_id);
CREATE INDEX IF NOT EXISTS idx_plant_edits_created_at ON public.plant_edits(created_at DESC);

ALTER TABLE public.plant_edits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Edits viewable by everyone"
  ON public.plant_edits FOR SELECT USING (true);

CREATE POLICY "Authenticated can insert own edits"
  ON public.plant_edits FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = editor_id);

CREATE POLICY "Only admin can update edits"
  ON public.plant_edits FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Only admin can delete edits"
  ON public.plant_edits FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'editor';-- Realtime on plant_edits
ALTER TABLE public.plant_edits REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'plant_edits'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.plant_edits';
  END IF;
END $$;

-- Editor applications table
CREATE TYPE public.editor_application_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.editor_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  bio TEXT NOT NULL,
  status public.editor_application_status NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_editor_applications_status ON public.editor_applications(status);
CREATE INDEX idx_editor_applications_user ON public.editor_applications(user_id);

ALTER TABLE public.editor_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own application or admins all"
  ON public.editor_applications FOR SELECT
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can insert their own application"
  ON public.editor_applications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own pending or admin updates any"
  ON public.editor_applications FOR UPDATE
  USING ((auth.uid() = user_id AND status = 'pending') OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_editor_applications_updated_at
  BEFORE UPDATE ON public.editor_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.editor_applications REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'editor_applications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.editor_applications';
  END IF;
END $$;

-- Helper: approved editor (admin OR editor)
CREATE OR REPLACE FUNCTION public.is_approved_editor(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin'::app_role, 'editor'::app_role)
  )
$$;CREATE OR REPLACE FUNCTION public.handle_new_user()
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

  -- Automatically assign admin role for special admin emails
  IF NEW.email IN ('arainjazz@gmail.com', 'arainjazz@163.com') THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin'::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
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
END $$;REVOKE EXECUTE ON FUNCTION public.is_approved_editor(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_approved_editor(uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;CREATE SCHEMA IF NOT EXISTS private;
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
REVOKE EXECUTE ON FUNCTION public.is_approved_editor(uuid) FROM PUBLIC, anon, authenticated;GRANT USAGE ON SCHEMA private TO authenticated, anon;
GRANT EXECUTE ON FUNCTION private.is_approved_editor(uuid) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role) TO authenticated, anon;
-- 1. Add genus + iucn_status to plants
ALTER TABLE public.plants
  ADD COLUMN IF NOT EXISTS genus text,
  ADD COLUMN IF NOT EXISTS iucn_status text;

ALTER TABLE public.plants
  DROP CONSTRAINT IF EXISTS plants_iucn_status_check;
ALTER TABLE public.plants
  ADD CONSTRAINT plants_iucn_status_check
  CHECK (iucn_status IS NULL OR iucn_status IN ('EX','EW','CR','EN','VU','NT','LC','DD'));

-- 2. Extend plant_edits with catalog audit columns + new kinds
ALTER TABLE public.plant_edits
  ADD COLUMN IF NOT EXISTS catalog_id uuid,
  ADD COLUMN IF NOT EXISTS summary text;

-- Drop existing kind check (if any) and recreate broader (plant_edits.kind is USER-DEFINED enum;
-- safest: convert to text + check constraint to allow new values without altering enum type)
DO $$
DECLARE
  col_type text;
BEGIN
  SELECT data_type INTO col_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='plant_edits' AND column_name='kind';
  IF col_type <> 'text' THEN
    ALTER TABLE public.plant_edits ALTER COLUMN kind TYPE text USING kind::text;
  END IF;
END $$;

ALTER TABLE public.plant_edits
  DROP CONSTRAINT IF EXISTS plant_edits_kind_check;
ALTER TABLE public.plant_edits
  ADD CONSTRAINT plant_edits_kind_check
  CHECK (kind IN ('text','image','revert','catalog_create','catalog_append'));

-- 3. Regional catalogs
CREATE TABLE IF NOT EXISTS public.regional_catalogs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  province text NOT NULL,
  city text,
  county text,
  source text NOT NULL,
  contributor_name text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS regional_catalogs_region_idx
  ON public.regional_catalogs (province, city, county);

ALTER TABLE public.regional_catalogs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Catalogs viewable by everyone" ON public.regional_catalogs;
CREATE POLICY "Catalogs viewable by everyone"
  ON public.regional_catalogs FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Approved editors can create catalogs" ON public.regional_catalogs;
CREATE POLICY "Approved editors can create catalogs"
  ON public.regional_catalogs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = created_by AND private.is_approved_editor(auth.uid()));

DROP POLICY IF EXISTS "Creator or admin can update catalogs" ON public.regional_catalogs;
CREATE POLICY "Creator or admin can update catalogs"
  ON public.regional_catalogs FOR UPDATE
  TO authenticated
  USING (auth.uid() = created_by OR private.has_role(auth.uid(),'admin'))
  WITH CHECK (auth.uid() = created_by OR private.has_role(auth.uid(),'admin'));

DROP POLICY IF EXISTS "Creator or admin can delete catalogs" ON public.regional_catalogs;
CREATE POLICY "Creator or admin can delete catalogs"
  ON public.regional_catalogs FOR DELETE
  TO authenticated
  USING (auth.uid() = created_by OR private.has_role(auth.uid(),'admin'));

DROP TRIGGER IF EXISTS regional_catalogs_touch_updated_at ON public.regional_catalogs;
CREATE TRIGGER regional_catalogs_touch_updated_at
  BEFORE UPDATE ON public.regional_catalogs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 4. Catalog entries
CREATE TABLE IF NOT EXISTS public.catalog_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id uuid NOT NULL REFERENCES public.regional_catalogs(id) ON DELETE CASCADE,
  scientific_name text NOT NULL,
  chinese_name text,
  added_by uuid NOT NULL,
  added_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS catalog_entries_catalog_idx ON public.catalog_entries(catalog_id);
CREATE INDEX IF NOT EXISTS catalog_entries_sciname_idx ON public.catalog_entries(lower(scientific_name));

ALTER TABLE public.catalog_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Catalog entries viewable by everyone" ON public.catalog_entries;
CREATE POLICY "Catalog entries viewable by everyone"
  ON public.catalog_entries FOR SELECT USING (true);

DROP POLICY IF EXISTS "Approved editors can add catalog entries" ON public.catalog_entries;
CREATE POLICY "Approved editors can add catalog entries"
  ON public.catalog_entries FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = added_by AND private.is_approved_editor(auth.uid()));

-- Delete: row's added_by OR the parent catalog's created_by OR admin
DROP POLICY IF EXISTS "Adder or catalog creator or admin can delete entries" ON public.catalog_entries;
CREATE POLICY "Adder or catalog creator or admin can delete entries"
  ON public.catalog_entries FOR DELETE
  TO authenticated
  USING (
    auth.uid() = added_by
    OR EXISTS (SELECT 1 FROM public.regional_catalogs c WHERE c.id = catalog_id AND c.created_by = auth.uid())
    OR private.has_role(auth.uid(),'admin')
  );
-- Allow plant_edits to reference catalogs (not just plants) for catalog audit rows
ALTER TABLE public.plant_edits DROP CONSTRAINT IF EXISTS plant_edits_plant_id_fkey;
ALTER TABLE public.plant_edits ALTER COLUMN plant_id DROP NOT NULL;
-- Track which catalog entries each "catalog_append" / "catalog_create" edit added, so admin can revert
ALTER TABLE public.plant_edits ADD COLUMN IF NOT EXISTS entry_ids uuid[] DEFAULT NULL;

-- Cascade delete entries when their catalog is deleted (simplifies revert)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'catalog_entries_catalog_id_fkey'
  ) THEN
    ALTER TABLE public.catalog_entries
      ADD CONSTRAINT catalog_entries_catalog_id_fkey
      FOREIGN KEY (catalog_id) REFERENCES public.regional_catalogs(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Catalog suggestions table: editors can propose delete/rename/other with a source
CREATE TABLE IF NOT EXISTS public.catalog_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id uuid NOT NULL REFERENCES public.regional_catalogs(id) ON DELETE CASCADE,
  target_entry_id uuid REFERENCES public.catalog_entries(id) ON DELETE SET NULL,
  target_name text NOT NULL,
  suggestion_type text NOT NULL CHECK (suggestion_type IN ('delete','rename','other')),
  proposed_name text,
  reason text,
  source_type text CHECK (source_type IN ('book','url','other')),
  source_book_title text,
  source_book_pages text,
  source_url text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted','rejected')),
  suggested_by uuid NOT NULL,
  suggested_by_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.catalog_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Suggestions viewable by everyone"
  ON public.catalog_suggestions FOR SELECT TO public USING (true);

CREATE POLICY "Approved editors can create suggestions"
  ON public.catalog_suggestions FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = suggested_by AND private.is_approved_editor(auth.uid()));

CREATE POLICY "Suggester or catalog creator or admin can update"
  ON public.catalog_suggestions FOR UPDATE TO authenticated
  USING (
    auth.uid() = suggested_by
    OR EXISTS (SELECT 1 FROM public.regional_catalogs c WHERE c.id = catalog_suggestions.catalog_id AND c.created_by = auth.uid())
    OR private.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Suggester or catalog creator or admin can delete"
  ON public.catalog_suggestions FOR DELETE TO authenticated
  USING (
    auth.uid() = suggested_by
    OR EXISTS (SELECT 1 FROM public.regional_catalogs c WHERE c.id = catalog_suggestions.catalog_id AND c.created_by = auth.uid())
    OR private.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE INDEX IF NOT EXISTS idx_catalog_suggestions_catalog ON public.catalog_suggestions(catalog_id);
CREATE TABLE public.plant_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  author_id uuid,
  author_name text,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_plant_comments_plant ON public.plant_comments(plant_id, created_at DESC);

ALTER TABLE public.plant_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Comments viewable by everyone"
ON public.plant_comments FOR SELECT
USING (true);

CREATE POLICY "Anyone can post comments"
ON public.plant_comments FOR INSERT
TO anon, authenticated
WITH CHECK (length(btrim(body)) > 0 AND length(body) <= 4000);

CREATE POLICY "Author or admin can delete comments"
ON public.plant_comments FOR DELETE
TO authenticated
USING (auth.uid() = author_id OR private.has_role(auth.uid(), 'admin'::app_role));
WITH norm AS (
  SELECT
    id,
    catalog_id,
    created_at,
    lower(
      regexp_replace(
        regexp_replace(scientific_name, '\([^)]*\)', ' ', 'g'),
        '\s+', ' ', 'g'
      )
    ) AS clean
  FROM public.catalog_entries
),
keys AS (
  SELECT
    id,
    catalog_id,
    created_at,
    trim(array_to_string((string_to_array(trim(clean), ' '))[1:2], ' ')) AS key
  FROM norm
),
ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY catalog_id, key
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM keys
  WHERE key <> ''
)
DELETE FROM public.catalog_entries
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- 1) Tags system
CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL UNIQUE,
  description text,
  created_by uuid NOT NULL,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tags viewable by everyone"
  ON public.tags FOR SELECT USING (true);
CREATE POLICY "Only admin can create tags"
  ON public.tags FOR INSERT TO authenticated
  WITH CHECK (private.has_role(auth.uid(),'admin'::app_role) AND created_by = auth.uid());
CREATE POLICY "Only admin can update tags"
  ON public.tags FOR UPDATE TO authenticated
  USING (private.has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (private.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "Only admin can delete tags"
  ON public.tags FOR DELETE TO authenticated
  USING (private.has_role(auth.uid(),'admin'::app_role));

CREATE TRIGGER tags_touch_updated_at
  BEFORE UPDATE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2) Plant ↔ tag junction (many-to-many)
CREATE TABLE public.plant_tags (
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  plant_id uuid NOT NULL REFERENCES public.plants(id) ON DELETE CASCADE,
  added_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tag_id, plant_id)
);
ALTER TABLE public.plant_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Plant tags viewable by everyone"
  ON public.plant_tags FOR SELECT USING (true);
CREATE POLICY "Editors and admin can add plant tags"
  ON public.plant_tags FOR INSERT TO authenticated
  WITH CHECK (private.is_approved_editor(auth.uid()) AND added_by = auth.uid());
CREATE POLICY "Editors and admin can remove plant tags"
  ON public.plant_tags FOR DELETE TO authenticated
  USING (private.is_approved_editor(auth.uid()));

CREATE INDEX plant_tags_plant_idx ON public.plant_tags(plant_id);
CREATE INDEX plant_tags_tag_idx ON public.plant_tags(tag_id);

-- 3) Plants: co-authors + branch parent for duplicate Latin name flow
ALTER TABLE public.plants
  ADD COLUMN parent_id uuid REFERENCES public.plants(id) ON DELETE SET NULL,
  ADD COLUMN co_author_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN co_author_names text[] NOT NULL DEFAULT '{}';
CREATE INDEX plants_parent_idx ON public.plants(parent_id);
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
WHERE id NOT IN (SELECT DISTINCT plant_id FROM public.plant_comments WHERE plant_id IS NOT NULL);REVOKE EXECUTE ON FUNCTION public.sync_plant_comments_count() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_plant_comments_count() FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_plant_comments_count() FROM authenticated;-- Widen the kind enum-like check to include all new action types we log.
ALTER TABLE public.plant_edits DROP CONSTRAINT IF EXISTS plant_edits_kind_check;
ALTER TABLE public.plant_edits
  ADD CONSTRAINT plant_edits_kind_check
  CHECK (kind IN (
    'text','image','revert',
    'create','html_save','branch','merge',
    'tag_create',
    'catalog_create','catalog_append'
  ));

-- Backfill: `create` rows for plants that have no create-style audit row.
INSERT INTO public.plant_edits (plant_id, editor_id, editor_name, kind, marker_n, summary, created_at)
SELECT
  p.id, p.author_id,
  COALESCE(pr.display_name, '编辑者'),
  'create', 0,
  COALESCE(pr.display_name, '编辑者') || ' 创建了条目「' || p.title || '」'
    || CASE WHEN p.content_type = 'html' THEN '（HTML）' ELSE '' END,
  p.created_at
FROM public.plants p
LEFT JOIN public.profiles pr ON pr.id = p.author_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.plant_edits e
  WHERE e.plant_id = p.id AND e.kind IN ('create','merge','branch')
);

-- Backfill: `tag_create`
INSERT INTO public.plant_edits (plant_id, editor_id, editor_name, kind, marker_n, summary, created_at)
SELECT
  NULL, t.created_by,
  COALESCE(t.created_by_name, pr.display_name, '管理员'),
  'tag_create', 0,
  COALESCE(t.created_by_name, pr.display_name, '管理员') || ' 创建了 #' || t.name || ' 标签',
  t.created_at
FROM public.tags t
LEFT JOIN public.profiles pr ON pr.id = t.created_by
WHERE NOT EXISTS (
  SELECT 1 FROM public.plant_edits e
  WHERE e.kind = 'tag_create' AND e.summary LIKE '%#' || t.name || ' %'
);

-- Backfill: `catalog_create`
INSERT INTO public.plant_edits (plant_id, editor_id, editor_name, kind, marker_n, catalog_id, summary, created_at)
SELECT
  NULL, c.created_by,
  COALESCE(c.contributor_name, pr.display_name, '编辑者'),
  'catalog_create', 0, c.id,
  COALESCE(c.contributor_name, pr.display_name, '编辑者') || ' 创建了「'
    || c.province || COALESCE(' ' || c.city, '') || COALESCE(' ' || c.county, '')
    || '」地区植物目录（来源：' || c.source || '）',
  c.created_at
FROM public.regional_catalogs c
LEFT JOIN public.profiles pr ON pr.id = c.created_by
WHERE NOT EXISTS (
  SELECT 1 FROM public.plant_edits e
  WHERE e.kind = 'catalog_create' AND e.catalog_id = c.id
);CREATE TABLE public.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT '',
  subtitle text,
  cover_url text,
  content_html text NOT NULL DEFAULT '',
  author_id uuid NOT NULL,
  author_name text,
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_blog_posts_published_at ON public.blog_posts (published_at DESC NULLS LAST);
CREATE INDEX idx_blog_posts_author ON public.blog_posts (author_id);

ALTER TABLE public.blog_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published blogs viewable by everyone"
ON public.blog_posts FOR SELECT
USING (published = true OR auth.uid() = author_id OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Approved editors can create blogs"
ON public.blog_posts FOR INSERT TO authenticated
WITH CHECK (auth.uid() = author_id AND private.is_approved_editor(auth.uid()));

CREATE POLICY "Author or admin can update blogs"
ON public.blog_posts FOR UPDATE TO authenticated
USING (auth.uid() = author_id OR private.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (auth.uid() = author_id OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Author or admin can delete blogs"
ON public.blog_posts FOR DELETE TO authenticated
USING (auth.uid() = author_id OR private.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER blog_posts_touch_updated_at
BEFORE UPDATE ON public.blog_posts
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
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
REVOKE EXECUTE ON FUNCTION public.scrub_email_like_name() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.plants DROP CONSTRAINT IF EXISTS plants_iucn_status_check;
ALTER TABLE public.plants ADD CONSTRAINT plants_iucn_status_check
  CHECK (iucn_status IS NULL OR iucn_status = ANY (ARRAY['EX','EW','CR','EN','VU','NT','LC','DD','NE']));

ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS expected_count integer;

UPDATE public.plants
SET iucn_status = sub.code
FROM (
  SELECT id,
    CASE
      WHEN tags && ARRAY['EX'] OR tags && ARRAY['IUCN EX'] THEN 'EX'
      WHEN tags && ARRAY['EW'] OR tags && ARRAY['IUCN EW'] THEN 'EW'
      WHEN tags && ARRAY['CR'] OR tags && ARRAY['IUCN CR'] THEN 'CR'
      WHEN tags && ARRAY['EN'] OR tags && ARRAY['IUCN EN'] THEN 'EN'
      WHEN tags && ARRAY['VU'] OR tags && ARRAY['IUCN VU'] THEN 'VU'
      WHEN tags && ARRAY['NT'] OR tags && ARRAY['IUCN NT'] THEN 'NT'
      WHEN tags && ARRAY['LC'] OR tags && ARRAY['IUCN LC'] THEN 'LC'
      WHEN tags && ARRAY['DD'] OR tags && ARRAY['IUCN DD'] THEN 'DD'
      WHEN tags && ARRAY['NE'] OR tags && ARRAY['IUCN NE'] THEN 'NE'
      ELSE NULL
    END AS code
  FROM public.plants
) sub
WHERE public.plants.id = sub.id
  AND sub.code IS NOT NULL
  AND (public.plants.iucn_status IS NULL OR public.plants.iucn_status = '');
ALTER TABLE public.plant_edits ADD COLUMN IF NOT EXISTS source text;
COMMENT ON COLUMN public.plant_edits.source IS 'Origin of the edit: html_editor, plant_editor, batch_upload, catalog_editor, tag_editor, blog_editor, or ai:<model>@<platform>+<entry-point>';
-- 1. plant_drafts table
CREATE TABLE public.plant_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  creator_label text NOT NULL DEFAULT '访客',
  photo_url text NOT NULL,
  capture_lat numeric,
  capture_lng numeric,
  capture_place text,
  ai_model text,
  ai_payload jsonb,
  title text NOT NULL,
  scientific_name text,
  common_name_en text,
  family text,
  genus text,
  summary text,
  tags text[] NOT NULL DEFAULT '{}',
  iucn_status text,
  html_content text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  published_plant_id uuid REFERENCES public.plants(id) ON DELETE SET NULL
);

CREATE INDEX plant_drafts_status_created_idx ON public.plant_drafts(status, created_at DESC);
CREATE INDEX plant_drafts_creator_idx ON public.plant_drafts(created_by);

GRANT SELECT, INSERT ON public.plant_drafts TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.plant_drafts TO authenticated;
GRANT ALL ON public.plant_drafts TO service_role;

ALTER TABLE public.plant_drafts ENABLE ROW LEVEL SECURITY;

-- anyone can read pending+approved drafts (lets the home feed work even when signed out)
CREATE POLICY "Drafts viewable by everyone"
  ON public.plant_drafts FOR SELECT
  USING (true);

-- anyone may submit a draft; if logged in, must be themselves
CREATE POLICY "Anyone may submit a draft"
  ON public.plant_drafts FOR INSERT
  WITH CHECK (
    created_by IS NULL OR created_by = auth.uid()
  );

-- creators, editors, admins may update / delete
CREATE POLICY "Creator or editor can update draft"
  ON public.plant_drafts FOR UPDATE
  TO authenticated
  USING (
    (created_by IS NOT NULL AND created_by = auth.uid())
    OR private.is_approved_editor(auth.uid())
    OR private.has_role(auth.uid(), 'admin'::app_role)
  )
  WITH CHECK (
    (created_by IS NOT NULL AND created_by = auth.uid())
    OR private.is_approved_editor(auth.uid())
    OR private.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE POLICY "Creator or editor can delete draft"
  ON public.plant_drafts FOR DELETE
  TO authenticated
  USING (
    (created_by IS NOT NULL AND created_by = auth.uid())
    OR private.is_approved_editor(auth.uid())
    OR private.has_role(auth.uid(), 'admin'::app_role)
  );

CREATE TRIGGER plant_drafts_touch
  BEFORE UPDATE ON public.plant_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. storage policies on plant-images: allow anonymous uploads to drafts/ prefix
DROP POLICY IF EXISTS "Anyone can upload draft photos" ON storage.objects;
CREATE POLICY "Anyone can upload draft photos"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'plant-images'
    AND (storage.foldername(name))[1] = 'drafts'
  );

-- 3. extend plant_edits kind enum to include draft_approve
ALTER TABLE public.plant_edits DROP CONSTRAINT plant_edits_kind_check;
ALTER TABLE public.plant_edits ADD CONSTRAINT plant_edits_kind_check
  CHECK (kind = ANY (ARRAY[
    'text','image','revert','create','html_save','branch','merge',
    'tag_create','catalog_create','catalog_append','draft_approve'
  ]));
