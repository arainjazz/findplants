
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
