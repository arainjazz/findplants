
WITH norm AS (
  SELECT
    id,
    catalog_id,
    created_at,
    lower(
      regexp_replace(
        regexp_replace(scientific_name, '\([^)]*\)', ' ', 'g'),
        '\s+', ' ', 'g'
      )
    ) AS clean
  FROM public.catalog_entries
),
keys AS (
  SELECT
    id,
    catalog_id,
    created_at,
    trim(array_to_string((string_to_array(trim(clean), ' '))[1:2], ' ')) AS key
  FROM norm
),
ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY catalog_id, key
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM keys
  WHERE key <> ''
)
DELETE FROM public.catalog_entries
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
