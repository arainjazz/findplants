
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
