-- Conservation / trade-control / invasion registries (China-relevant subset).
-- Powers the 国际贸易管制(CITES) / GTS / GRIIS filters in 档案检索, plus later the
-- upload-autofill, AI-draft auto-match and 身边物种地图 markers.
--
-- Scope decision (user, 2026-07-03): China-relevant subset only; stored locally in
-- Supabase (NOT live-queried). Matched to plants by normalized scientific name.
--
-- NOTE: the 国家 + 省级重点保护 lists are NOT stored here — they reuse the existing
-- regional_catalogs / catalog_entries tables (the 国家和各省重点保护目录 dropdown is
-- already wired to them). This table holds the three registries not otherwise modeled:
-- CITES appendices, GTS (GlobalTreeSearch) threat categories, and GRIIS invasion degree.

-- 1. Registry sources (one row per list / version).
CREATE TABLE IF NOT EXISTS public.conservation_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('protected', 'cites', 'gts', 'griis')),
  name text NOT NULL,               -- dropdown label, e.g. "国家（2021）", "海南（2024）", "CITES 附录（中国相关）"
  province text,                    -- for kind='protected': 国家/内蒙古/海南/… (null for global registries)
  version text,                     -- e.g. "2021", "2024", "CoP19"
  effective_date date,
  source_url text,
  source_note text,                 -- 声明框: human-readable source statement shown on dropdown hover
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Defensive: ensure the column exists even if the table was created by an earlier run.
ALTER TABLE public.conservation_lists ADD COLUMN IF NOT EXISTS source_note text;

-- 2. Taxa within a registry.
-- status meaning depends on the parent list.kind:
--   protected -> '一级' | '二级'
--   cites     -> 'I' | 'II'
--   gts       -> 'CR' | 'EN' | 'VU'
--   griis     -> 'casual' | 'established' | 'invasive' | 'widespreadInvasive'
-- rank: 'species' (genus+species match) | 'genus' (「所有种 spp.」 → match any species in genus)
--       | 'family' (family-level 所有种). For genus/family, normalized_name holds the
--       genus (or family) token so the matcher can do prefix/rank-aware matching.
CREATE TABLE IF NOT EXISTS public.conservation_taxa (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.conservation_lists(id) ON DELETE CASCADE,
  scientific_name text NOT NULL,
  normalized_name text NOT NULL,    -- species: "genus species"; genus/family: the genus/family token, lowercased
  chinese_name text,
  status text NOT NULL,
  rank text NOT NULL DEFAULT 'species' CHECK (rank IN ('species', 'genus', 'family', 'section')),
  excluded_names text[],            -- normalized names excluded from a genus/family group ("… 除外")
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conservation_taxa_norm_idx ON public.conservation_taxa (normalized_name);
CREATE INDEX IF NOT EXISTS conservation_taxa_list_idx ON public.conservation_taxa (list_id);

-- RLS: reference data — world-readable, admin-only writes.
ALTER TABLE public.conservation_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conservation_taxa ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Conservation lists viewable by everyone" ON public.conservation_lists;
CREATE POLICY "Conservation lists viewable by everyone"
  ON public.conservation_lists FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage conservation lists" ON public.conservation_lists;
CREATE POLICY "Admins manage conservation lists"
  ON public.conservation_lists FOR ALL
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Conservation taxa viewable by everyone" ON public.conservation_taxa;
CREATE POLICY "Conservation taxa viewable by everyone"
  ON public.conservation_taxa FOR SELECT USING (true);

DROP POLICY IF EXISTS "Admins manage conservation taxa" ON public.conservation_taxa;
CREATE POLICY "Admins manage conservation taxa"
  ON public.conservation_taxa FOR ALL
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));
