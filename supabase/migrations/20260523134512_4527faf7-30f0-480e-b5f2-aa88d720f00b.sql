CREATE TABLE public.blog_posts (
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