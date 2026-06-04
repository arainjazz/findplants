-- Add english common name column
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
  USING (public.has_role(auth.uid(), 'admin'::app_role));