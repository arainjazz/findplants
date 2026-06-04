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