
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
