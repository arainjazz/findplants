
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
