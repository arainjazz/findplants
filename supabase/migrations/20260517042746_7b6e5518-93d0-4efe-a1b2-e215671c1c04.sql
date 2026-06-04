
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
