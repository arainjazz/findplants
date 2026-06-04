
ALTER TABLE public.plants DROP CONSTRAINT IF EXISTS plants_iucn_status_check;
ALTER TABLE public.plants ADD CONSTRAINT plants_iucn_status_check
  CHECK (iucn_status IS NULL OR iucn_status = ANY (ARRAY['EX','EW','CR','EN','VU','NT','LC','DD','NE']));

ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS expected_count integer;

UPDATE public.plants
SET iucn_status = sub.code
FROM (
  SELECT id,
    CASE
      WHEN tags && ARRAY['EX'] OR tags && ARRAY['IUCN EX'] THEN 'EX'
      WHEN tags && ARRAY['EW'] OR tags && ARRAY['IUCN EW'] THEN 'EW'
      WHEN tags && ARRAY['CR'] OR tags && ARRAY['IUCN CR'] THEN 'CR'
      WHEN tags && ARRAY['EN'] OR tags && ARRAY['IUCN EN'] THEN 'EN'
      WHEN tags && ARRAY['VU'] OR tags && ARRAY['IUCN VU'] THEN 'VU'
      WHEN tags && ARRAY['NT'] OR tags && ARRAY['IUCN NT'] THEN 'NT'
      WHEN tags && ARRAY['LC'] OR tags && ARRAY['IUCN LC'] THEN 'LC'
      WHEN tags && ARRAY['DD'] OR tags && ARRAY['IUCN DD'] THEN 'DD'
      WHEN tags && ARRAY['NE'] OR tags && ARRAY['IUCN NE'] THEN 'NE'
      ELSE NULL
    END AS code
  FROM public.plants
) sub
WHERE public.plants.id = sub.id
  AND sub.code IS NOT NULL
  AND (public.plants.iucn_status IS NULL OR public.plants.iucn_status = '');
