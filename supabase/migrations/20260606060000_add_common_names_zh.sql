-- Add common_names_zh column to plants and plant_drafts tables
ALTER TABLE public.plant_drafts ADD COLUMN IF NOT EXISTS common_names_zh TEXT;
ALTER TABLE public.plants ADD COLUMN IF NOT EXISTS common_names_zh TEXT;

-- Backfill existing drafts from ai_payload if available
UPDATE public.plant_drafts
SET common_names_zh = ai_payload->>'common_names_zh'
WHERE common_names_zh IS NULL AND ai_payload IS NOT NULL;
