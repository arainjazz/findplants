-- Widen the kind enum-like check to include all new action types we log.
ALTER TABLE public.plant_edits DROP CONSTRAINT IF EXISTS plant_edits_kind_check;
ALTER TABLE public.plant_edits
  ADD CONSTRAINT plant_edits_kind_check
  CHECK (kind IN (
    'text','image','revert',
    'create','html_save','branch','merge',
    'tag_create',
    'catalog_create','catalog_append'
  ));

-- Backfill: `create` rows for plants that have no create-style audit row.
INSERT INTO public.plant_edits (plant_id, editor_id, editor_name, kind, marker_n, summary, created_at)
SELECT
  p.id, p.author_id,
  COALESCE(pr.display_name, '编辑者'),
  'create', 0,
  COALESCE(pr.display_name, '编辑者') || ' 创建了条目「' || p.title || '」'
    || CASE WHEN p.content_type = 'html' THEN '（HTML）' ELSE '' END,
  p.created_at
FROM public.plants p
LEFT JOIN public.profiles pr ON pr.id = p.author_id
WHERE NOT EXISTS (
  SELECT 1 FROM public.plant_edits e
  WHERE e.plant_id = p.id AND e.kind IN ('create','merge','branch')
);

-- Backfill: `tag_create`
INSERT INTO public.plant_edits (plant_id, editor_id, editor_name, kind, marker_n, summary, created_at)
SELECT
  NULL, t.created_by,
  COALESCE(t.created_by_name, pr.display_name, '管理员'),
  'tag_create', 0,
  COALESCE(t.created_by_name, pr.display_name, '管理员') || ' 创建了 #' || t.name || ' 标签',
  t.created_at
FROM public.tags t
LEFT JOIN public.profiles pr ON pr.id = t.created_by
WHERE NOT EXISTS (
  SELECT 1 FROM public.plant_edits e
  WHERE e.kind = 'tag_create' AND e.summary LIKE '%#' || t.name || ' %'
);

-- Backfill: `catalog_create`
INSERT INTO public.plant_edits (plant_id, editor_id, editor_name, kind, marker_n, catalog_id, summary, created_at)
SELECT
  NULL, c.created_by,
  COALESCE(c.contributor_name, pr.display_name, '编辑者'),
  'catalog_create', 0, c.id,
  COALESCE(c.contributor_name, pr.display_name, '编辑者') || ' 创建了「'
    || c.province || COALESCE(' ' || c.city, '') || COALESCE(' ' || c.county, '')
    || '」地区植物目录（来源：' || c.source || '）',
  c.created_at
FROM public.regional_catalogs c
LEFT JOIN public.profiles pr ON pr.id = c.created_by
WHERE NOT EXISTS (
  SELECT 1 FROM public.plant_edits e
  WHERE e.kind = 'catalog_create' AND e.catalog_id = c.id
);