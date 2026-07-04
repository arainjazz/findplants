-- Editor leaf / points system — Phase 1.
-- Leaf counts are DERIVED at read-time from plant_drafts (识别) and plant_edits
-- (修文 kind='text' / 换图 kind='image'); this migration only adds the few
-- columns that can't be derived: the manual "采纳" (adopt) state that doubles a
-- bronze leaf, the entry origin, and the spent-gold counter.

-- 1. Manual 采纳 (adopt) — set by the owner/senior editor; doubles the leaf.
--    plant_edits UPDATE is already admin-gated; plant_drafts UPDATE is already
--    creator/editor/admin-gated — so no new policies are needed for the owner
--    to write these (the owner is an admin).
alter table public.plant_edits
  add column if not exists adopted boolean not null default false,
  add column if not exists adopted_by uuid references auth.users(id) on delete set null,
  add column if not exists adopted_at timestamptz;

alter table public.plant_drafts
  add column if not exists adopted boolean not null default false,
  add column if not exists adopted_by uuid references auth.users(id) on delete set null,
  add column if not exists adopted_at timestamptz;

-- 2. Entry origin so 管理页 / 个人主页 can distinguish the three entry kinds:
--    'ai_identify'  → AI 识别的简略条目（来自被收录的 plant_drafts）
--    'html_upload'  → 通过 HTML 上传的详细条目
--    'gold_oneclick'→ 使用金叶「一键创建」的物种科普详页（Phase 2 写入）
--    'manual'       → 富文本手动创建
alter table public.plants
  add column if not exists source text;

-- best-effort backfill of existing rows (new rows are tagged in app code):
update public.plants p set source = 'html_upload'
  where source is null and content_type = 'html';

update public.plants p set source = 'ai_identify'
  where source is null and exists (
    select 1 from public.plant_drafts d where d.published_plant_id = p.id
  );

update public.plants p set source = 'manual'
  where source is null;

-- 3. Gold leaves spent on 一键创建 (Phase 2 increments this per use).
alter table public.profiles
  add column if not exists gold_used integer not null default 0;
