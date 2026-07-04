-- Invasive-alien-species flags on plant_drafts.
-- Populated at AI-identify time from GBIF species → GRIIS China distribution.
-- Used by /explore to mark invasive sightings with danger triangles and to
-- power the "只显示外来入侵物种分布" filter.
alter table public.plant_drafts
  add column if not exists is_invasive boolean not null default false,
  add column if not exists gbif_taxon_key bigint;

-- Fast filter for the map's invasive-only view.
create index if not exists plant_drafts_is_invasive_idx
  on public.plant_drafts (is_invasive)
  where is_invasive = true;
