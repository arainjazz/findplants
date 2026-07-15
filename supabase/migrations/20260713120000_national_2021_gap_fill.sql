-- Gap-fill: add national 2021 key-protected species that were dropped during the
-- original PDF extraction (20260703130000_seed_national_2021.sql). All 二级.
-- Verified against 《国家重点保护野生植物名录》(2021):
--   裸果木  Gymnocarpos przewalskii  — 石竹科, 二级 (user-flagged omission)
--   长叶红砂 Reaumuria trigyna        — 柽柳科, 二级
--   绶草    Spiranthes sinensis      — 兰科, 二级 (the widespread orchid explicitly listed)
-- Idempotent: delete these three by normalized_name on the 国家 list first.
DELETE FROM public.conservation_taxa t USING public.conservation_lists l
  WHERE t.list_id = l.id AND l.kind = 'protected' AND l.province = '国家'
    AND t.normalized_name IN ('gymnocarpos przewalskii', 'reaumuria trigyna', 'spiranthes sinensis');

INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)
SELECT l.id, v.sci, v.norm, v.zh, v.status, v.rank, NULL::text[]
FROM public.conservation_lists l, (VALUES
  ('Gymnocarpos przewalskii', 'gymnocarpos przewalskii', '裸果木', '二级', 'species'),
  ('Reaumuria trigyna',       'reaumuria trigyna',       '长叶红砂', '二级', 'species'),
  ('Spiranthes sinensis',     'spiranthes sinensis',     '绶草', '二级', 'species')
) AS v(sci, norm, zh, status, rank)
WHERE l.kind = 'protected' AND l.province = '国家';
