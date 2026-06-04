-- Allow plant_edits to reference catalogs (not just plants) for catalog audit rows
ALTER TABLE public.plant_edits DROP CONSTRAINT IF EXISTS plant_edits_plant_id_fkey;
ALTER TABLE public.plant_edits ALTER COLUMN plant_id DROP NOT NULL;