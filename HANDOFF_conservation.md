# Handoff — Conservation registries feature (multi-source 名录 matching)

> Context for the agent picking this up: this was built in a Cowork session. Read
> `.claude/STATE.md` for the full running log; this file is the focused handoff for the
> **conservation registries** feature only. All code compiles (`./node_modules/.bin/tsc
> --noEmit` → EXIT 0). Nothing is deployed yet. Sandbox couldn't run `npm run dev`, so the
> UI has NOT been visually verified — that's the first thing to do.

## What the feature is
On the 已收录档案 page (`src/routes/plants.index.tsx`) users filter plants by conservation
registries and browse the full 名录 directories:
1. **国家和各省重点保护目录** — national + provincial key-protected wild plant lists
2. **IUCN** 最新评估等级
3. **国际贸易管制 (CITES)** — 附录 I / 附录 II
4. **GTS** — GlobalTreeSearch/GlobalTree Portal 全球树木红色名录 (CR/EN/VU)
5. **GRIIS全球入侵等级** — casual / established / invasive / widespreadInvasive

Data is stored **locally in Supabase** (not live-queried) and matched to plants by
normalized scientific name. Decision log: user chose local tables + China-relevant subset
for CITES/GTS.

---

## DONE (working, tsc-clean, and — for the data — already applied to the live DB by the user)

### Schema & data
- **Migration** `supabase/migrations/20260703120000_conservation_registries.sql`
  - `conservation_lists (id, kind CHECK in ('protected','cites','gts','griis'), name,
    province, version, effective_date, source_url, source_note, created_at)`
  - `conservation_taxa (id, list_id FK→conservation_lists, scientific_name,
    normalized_name, chinese_name, status, rank CHECK in ('species','genus','family',
    'section'), excluded_names text[], created_at)` + indexes on `normalized_name`,
    `list_id`.
  - RLS: world-readable SELECT, admin-only writes (`private.has_role(auth.uid(),'admin')`).
- **`status` semantics by list.kind**: protected → `一级`/`二级` (国家) or `省级` (省);
  cites → `I`/`II`; gts → `CR`/`EN`/`VU`; griis → DwC degree literals.
- **`rank` semantics**: `species` = match on normalized "genus species"; `genus` = match any
  species in genus minus `excluded_names`; `family` = match Latin family token;
  `section` = intentionally NOT matched (avoids false-flagging whole genera like Camellia).
- **8 protected seeds applied (1059 taxa total), verified by user in Supabase:**
  | file | list | taxa |
  |---|---|---|
  | `20260703130000_seed_national_2021.sql` | 国家（2021） | 495 |
  | `20260703140000_seed_hainan_2024.sql` | 海南（2024） | 205 |
  | `20260703150000_seed_yunnan_2023.sql` | 云南（2023） | 77 |
  | `20260703160000_seed_neimenggu_2009.sql` | 内蒙古（2009） | 130 |
  | `20260703170000_seed_sichuan_2024.sql` | 四川（2024） | 19 |
  | `20260703180000_seed_guangdong_2023.sql` | 广东（2023） | 39 |
  | `20260703190000_seed_guizhou_2023.sql` | 贵州（2023） | 56 |
  | `20260703200000_seed_fujian_2024.sql` | 福建（2024） | 38 |
  - Combined one-shot file: `supabase/APPLY_ALL_conservation.sql` (idempotent).
  - Generators (throwaway) in `scratch/`: `parse_nat2021.py` (national, from
    `scratch/nat2021_raw.txt`), `gen_province_seed.py` (Hainan, from TSV),
    `gen_from_xlsx.py` (6 provinces, from the user's uploaded xlsx). The xlsx lived in the
    Cowork uploads dir and will NOT be present for you — but its data is already baked into
    the applied seeds, so you don't need it unless regenerating.
- **`src/integrations/supabase/types.ts`** hand-updated with both tables (Row/Insert/Update
  + FK relationship + `source_note`).

### Code
- **`src/lib/conservation.ts`** — the engine:
  - Option consts `CITES_APPENDICES`, `GTS_CATEGORIES`, `GRIIS_DEGREES`,
    `PROTECTED_LIST_ORDER`, `protectedListRank()`.
  - `fetchConservationData()` → `{ lists, taxa }` (selects `source_note`, `source_url`,
    `scientific_name`, `chinese_name`, etc).
  - `buildConservationMatcher(data)` → `(scientificName, familyLatin?) => ConservationHit`
    where `ConservationHit = { protectedLists: Map<listId,status>, cites?, gts?, griis? }`.
    Rank-aware; honours `excluded_names`; ignores `section`. **Verified correct** against the
    national seed via a Python mirror (Ginkgo→一级, Huperzia serrata→二级 genus,
    Cymbidium lancifolium→excluded, Camellia japonica→no false flag, diacritic folding OK).
- **`src/lib/catalogs.ts`** — `normalizeSciName()` now folds diacritics (Isoëtes→isoetes);
  `IUCN_CATEGORIES` gained `DD·数据缺乏`.
- **`src/components/filter-dropdown.tsx`** — added `OptionHover` type, per-option `hover`
  field, and `onOptionHover` prop (fires on option mouseenter).
- **`src/routes/plants.index.tsx`** — the big one:
  - Filter bar split: **国家和各省重点保护目录** (reads `conservation_lists` kind=protected,
    value=list id, ordered by `protectedListRank`) + **归类标签** (tags) + 科/属/IUCN +
    **国际贸易管制**/**GTS**/**GRIIS全球入侵等级** + 条目类型.
  - The old regional_catalogs browsing (RegionalCatalogPanel + chips) was moved onto its own
    `rcat` search param (label 「地区植物名录（自建）」) so it coexists with the protected
    dropdown. `region`=protected list id, `tag`=tag slug, `rcat`=regional_catalogs label.
  - IUCN dropdown: removed 未填写; DD now present.
  - CITES/GTS/GRIIS filters run through `buildConservationMatcher` (empty until data seeded).
  - **声明框 (hover statement box):** hovering a 保护目录 option shows its `source_note`;
    hovering a 标签 option shows `由 {created_by_name} 于 {date} 添加；参考资料：{description}`.
    Persists until another filter is clicked (`setParam` clears it). Clicking the box
    `scrollToId(anchorId)` jumps to that directory at page bottom. 海南's source_note carries
    the special parenthetical the user requested.
  - **Page-bottom directories:** `#dir-<listId>` sections (ordered) list every taxon —
    **recorded = dark text + links to the plant page; unrecorded = faint (`text-ink-faint/50`)**
    — each with a 「↑回到筛选栏」 button (scrolls to `#filter-bar`). User tag directories
    `#tag-<slug>` render at the very end with editor/time/reference + the tagged plants.

### Verification status
- `./node_modules/.bin/tsc --noEmit` → **EXIT 0**.
- **NOT visually verified** (sandbox can't run vite/dev). **NOT deployed.**

---

## UPDATE 2026-07-03 (session 2) — A (CITES+GRIIS) / B / C all done; GTS is the only blocker left

- **B (增量③) DONE** — `conservationBadges()` in `conservation.ts`; `{{conservation_card}}` + `.conservation-card`
  CSS in `plant-html-template.ts` (renders after `{{invasive_card}}`, before Section I); `submitPlantDraft` computes
  hits via `supabaseAdmin` + `buildConservationMatcher` (best-effort, non-fatal). bun-render + pixelshot verified.
- **C (增量④) DONE** — `explore.tsx` gained a client-side `consStatus` map (matcher over sightings), a gold
  `PROTECTED_MARKER_HTML`, a `protectedOnly` toggle, marker/cluster/popup/list wiring (priority 入侵红三角 >
  重点保护金盾 > 绿点). Map visuals need a real machine (AMap key + dev).
- **A CITES + GRIIS DONE (data)** — generator `scratch/gen_cites_griis.py`:
  - GRIIS: 449 plant species from the GBIF-hosted GRIIS-China dataset, degree from `SpeciesProfile.isInvasive`
    (invasive/established only — GBIF version lacks casual/widespreadInvasive). → `20260703220000_seed_griis_china.sql`.
  - CITES: 35 China-relevant whole-family/genus + species listings (Orchid genera, Cycas, Nepenthes, Aquilaria,
    Dalbergia, Taxus, Aloe−vera, Cactaceae, Cyatheaceae, Cibotium barometz, Cistanche deserticola, Saussurea costus…)
    → `20260703210000_seed_cites_china.sql`. Both appended to `APPLY_ALL_conservation.sql`, idempotent, matcher-verified.
- **USER ACTION**: apply `20260703210000` + `20260703220000` in Supabase SQL Editor (or re-run `APPLY_ALL`).

## UPDATE 2026-07-04 (session 3) — GTS ingested + CITES Appendix III added → all 7 registries live

User supplied `GlobalTreeSearch_China.csv` (4554 China trees), the GRIIS v1.4 archive, and the official CITES 2023
Chinese-edition PDF, and asked to add CITES Appendix III.
- **GTS DONE (was the last blocker)** — the GlobalTreeSearch CSV is a *tree species checklist with no threat column*.
  Approach: cross-referenced every China tree against the IUCN Red List via GBIF `species/{key}/iucnRedListCategory`
  (the Global Tree Assessment publishes into the IUCN Red List) and kept the threatened subset → **482 taxa
  (CR 86 / EN 220 / VU 176)** → `20260703230000_seed_gts_china.sql` (kind=gts, status CR/EN/VU, species rank, no zh).
- **CITES Appendix III DONE** — read the full flora section of the official PDF; added **all 27 Appendix III plant
  entries** (China-distributed ★: Quercus mongolica, Pinus koraiensis, Fraxinus mandshurica, Gnetum montanum,
  Podocarpus neriifolius, Tetracentron sinense, Magnolia liliifera; rest are SA/Seychelles country listings). Also
  filled 3 China-relevant I/II gaps the PDF confirmed (Rhodiola spp. II, Nardostachys grandiflora II, Renanthera
  imschootiana I). **CITES now 65** (I 3 / II 35 / III 27). `CITES_APPENDICES` in `conservation.ts` gained the III option.
- **GRIIS unchanged** (449, invasive/established — v1.4 meta.xml confirms no `degreeOfEstablishment` 4-level exists).
- `APPLY_ALL_conservation.sql` rebuilt = protected(8) + CITES(65) + GRIIS(449) + GTS(482). All idempotent, matcher-verified.
- **USER ACTION**: apply `20260703210000` (cites, now incl. III) + `20260703220000` (griis) + `20260703230000` (gts),
  or re-run `APPLY_ALL`. All 7 registries then power the /plants filters + draft badges + map.

### (superseded) A. GTS China-subset DATA — DONE above

---

## NOT DONE — remaining work

### A. GTS China-subset DATA  ← the only remaining data blocker (CITES/GRIIS done above)
Infrastructure (dropdowns, filters, matcher) is fully wired, but `conservation_taxa` has
**zero rows** for kinds `cites`/`gts`/`griis`, so those three filters currently match
nothing. This is purely a data-ingestion task.

**Why it stalled:** unlike the provincial lists (single official gov PDFs/docx we could
fetch), these three are **global database exports**:
- CITES 附录 → UNEP-WCMC Species+ / CITES Checklist (needs export or API token)
- GTS → BGCI GlobalTreeSearch / GlobalTree Portal (needs data request)
- GRIIS 4-level → the casual/established/invasive/widespreadInvasive granularity is
  **GRIIS-specific Darwin Core** (GBIF dataset `6d11211b-caa0-4e63-b99c-e944099d5017`). No
  Chinese official published list uses those four levels, so the granularity can't be
  derived from gov documents.

**Recommended path (matches how the 6 provinces were done):** get a curated file from the
user (xlsx/csv: scientific name + appendix `I`/`II` for CITES, `CR`/`EN`/`VU` for GTS, DwC
degree for GRIIS), then ingest with a generator modeled on `scratch/gen_from_xlsx.py`:
- One `conservation_lists` row per registry: `kind='cites'` name e.g. `CITES 附录（中国相关）`,
  `province = NULL`, plus a `source_note`; same for `gts`, `griis`.
- `conservation_taxa` rows: `status` = appendix / category / degree; `rank` species or genus;
  `list_id` = the registry's list id.
- **SQL GOTCHA (cost us a failed run):** `excluded_names` is `text[]`. A bare `NULL` is typed
  `text` by Postgres and the INSERT fails with `column "excluded_names" is of type text[]
  but expression is of type text`. Always emit **`NULL::text[]`** (or a real `ARRAY[...]`).
- Give each new seed a timestamped filename after `20260703200000` and append it to
  `supabase/APPLY_ALL_conservation.sql`. Seeds must be idempotent (DELETE-by-kind then
  INSERT). The user applies migrations manually in the Supabase SQL Editor.
- No frontend changes needed — the CITES/GTS/GRIIS filters + page-bottom directories will
  light up automatically once rows exist (they read `fetchConservationData`). Note: the
  page-bottom directory section currently only renders `kind='protected'` lists
  (`orderedProtectedLists`); if you want CITES/GTS/GRIIS to also appear as browsable
  directories, extend that section — otherwise they only power the filters.

### B. 增量③ — upload autofill + AI-draft auto-match display
Make the AI-identify / upload flow compute conservation hits and surface them.
- Reuse `buildConservationMatcher` (or a server-side equivalent) in
  `src/lib/identify-plant.functions.ts` (`submitPlantDraft`) and the plant editor autofill.
- Render badges (国家/省级重点保护 等级, CITES 附录, GTS 等级, GRIIS 等级) into the draft
  HTML — model the pattern on the existing **invasive warning card** (see `.claude/STATE.md`
  2026-07-03 CP1: `plant-html-template.ts` `{{invasive_card}}` + `.invasive-card` CSS, and
  `submitPlantDraft` best-effort enrichment). Keep it non-fatal (failures skip the badge).

### C. 增量④ — 身边物种地图 markers + filters
In `src/routes/explore.tsx`, add distinct marker points + filter toggles for **GRIIS** and
**国家重点保护名录**, extending the existing invasive-triangle infra (STATE 2026-07-03 CP2:
`INVASIVE_MARKER_HTML`, `invasiveOnly` toggle, GBIF overlay). Requires per-sighting
conservation status — either compute client-side via the matcher against
`fetchGeoSightings` results, or add columns to the drafts/sightings query.

---

## Conventions / gotchas
- **Typecheck:** `./node_modules/.bin/tsc --noEmit` must be EXIT 0 before calling anything done.
- **Migrations are applied by the USER** in the Supabase dashboard SQL Editor (no CLI push in
  this project's flow). Keep every seed **idempotent** (`DELETE … WHERE kind/province …` then
  `INSERT`). The whole SQL Editor paste runs as one transaction — one bad statement rolls back
  everything.
- **`excluded_names` bare-NULL gotcha** — always `NULL::text[]` (see above).
- **Deploy** (only when asked, VPN on): `npm run build && ./node_modules/.bin/wrangler deploy`.
  The build packages the whole working tree incl. uncommitted changes.
- **Sandbox can't run dev** (esbuild is macOS-arch); the human verifies UI in the browser.
- **Ship small / cap retries** — this project has a history of ECONNRESET stalls; do one
  independently-verifiable change at a time and update `.claude/STATE.md`.
- Dropdown ordering uses `PROTECTED_LIST_ORDER` = 国家→内蒙古→海南→广东→福建→云南→贵州→四川.

## Suggested first steps for you
1. `npm run dev` → open `/plants`; verify the filter bar, hover 声明框 (国家和各省下拉 +
   归类标签), click-to-scroll, page-bottom directories with recorded/unrecorded coloring, and
   「回到筛选栏」. Fix any visual issues (this is the only unverified part).
2. Ask the user for the CITES/GTS/GRIIS China-subset file(s), or proceed with whatever source
   they provide; ingest via a `gen_from_xlsx.py`-style generator into new seed migrations.
3. Then tackle 增量③ (draft/upload badges) and 增量④ (map markers).
