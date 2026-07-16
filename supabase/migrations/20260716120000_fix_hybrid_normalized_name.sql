-- Repair normalized_name for hybrid taxa.
--
-- normalizeSciName (src/lib/catalogs.ts) used to rewrite "×" to "x" and then keep
-- the first two whitespace tokens, so "Populus × irtyschensis" normalized to
-- "populus x". The seed generators in scratch/ mirror that function, so the
-- corruption was written into this column too: conservation.ts indexes rows by the
-- stored normalized_name and looks them up with normalizeSciName, so both sides
-- have to agree.
--
-- The marker is now dropped rather than kept ("populus irtyschensis"). Nothospecies
-- epithets are unique within a genus, so dropping it cannot merge two taxa —
-- whereas keeping it collapsed every hybrid in a genus onto one "<genus> x" key,
-- which also let any Populus hybrid inherit Populus × irtyschensis's chips.
--
-- Only these 3 rows in conservation_taxa contain a hybrid marker (verified against
-- live data 2026-07-16). Matched on scientific_name so a re-run is a no-op.

UPDATE conservation_taxa SET normalized_name = 'populus irtyschensis'
  WHERE scientific_name = 'Populus × irtyschensis';

UPDATE conservation_taxa SET normalized_name = 'poncirus polyandra'
  WHERE scientific_name = 'Poncirus × polyandra';

UPDATE conservation_taxa SET normalized_name = 'sonneratia gulngai'
  WHERE scientific_name = 'Sonneratia × gulngai';
