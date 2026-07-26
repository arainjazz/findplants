-- 物种资料包（species dossier）—— 2026-07-20 大改造的地基。
--
-- 解决的问题：同一个物种被识别 N 次，就重跑 N 次「联网调研 + 抓图 + 撰稿」。
-- 沙冬青被拍 50 次 = 50 份几乎一样的正文、50 次 token 账单、50 次 3–10 分钟的等待。
-- （此前的补丁是「扫最近 50 条草稿、字符串匹配学名」的启发式，命中率低且不可维护。）
--
-- 改法：物种级内容**存一次、全站复用**。每份草稿 = 资料包（通用内容）+ 这个人自己的
-- 照片/地点/日期/拍摄记录。命中资料包的草稿只需一次小模型调用（写拍摄记录），2 秒出结果。
--
-- 审核模型（用户 2026-07-20 拍板）：
--   AI 生成 → status='unverified' → **照常全站复用**；
--   管理员编辑过一次 → status='curated' → **此后 AI 不得覆写**（见 upsertDossier）。
-- 全人工审核会卡死；全自动又会让一个错误扩散全站。这是中间路线。

create table if not exists public.species_dossiers (
  id uuid primary key default gen_random_uuid(),

  -- 归一化的物种键：`speciesKey()` 的产物 = 属名+种加词、小写、去斜体标记。
  -- 唯一约束就靠它 —— 同一物种的不同写法（含命名人、含 var.）都会归到同一行。
  species_key text not null unique,
  gbif_taxon_key bigint,

  scientific_name text not null,
  title text,
  common_name_en text,
  common_names_zh text,
  family text,
  genus text,

  -- unverified = AI 生成，可被更好的 AI 产出覆写
  -- curated    = 人已经改过，AI 永不覆写
  status text not null default 'unverified'
    check (status in ('unverified', 'curated')),

  -- 通用正文（AiMeta 去掉照片相关字段后的部分：name_origin / morphology / habitat /
  -- culture / care_tips / tags / iucn…）。**不含** field_notes、拍摄地点、照片 URL。
  body jsonb not null default '{}'::jsonb,
  -- gatherVerifiedFacts 的快照（名录 / 保护级别 / 入侵状态）
  facts jsonb,
  -- 联网调研的 digest + sources
  research jsonb,
  -- 器官标注过的图库。CP4（图片验证）填充；现阶段先存 URL 列表。
  images jsonb not null default '[]'::jsonb,

  -- 溯源：这份资料包是谁、用什么写出来的
  source_draft_id uuid,
  source_plant_id uuid,
  ai_model text,
  skill_signature text,

  generated_at timestamptz default now(),
  curated_at timestamptz,
  curated_by uuid,

  -- 被复用了多少次 —— 用来量化这套机制到底省了多少钱
  hit_count integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists species_dossiers_gbif_idx
  on public.species_dossiers (gbif_taxon_key);
create index if not exists species_dossiers_status_idx
  on public.species_dossiers (status);

-- 服务端专用表：开 RLS 且**不建任何 policy** → 匿名/登录用户都读不到，
-- 只有 service-role（supabaseAdmin，绕过 RLS）能读写。资料包只经服务端拼装进页面，
-- 浏览器没有任何直接读它的理由。
alter table public.species_dossiers enable row level security;

comment on table public.species_dossiers is
  '物种级可复用资料包。草稿/金叶详页 = 本表内容 + 用户自己的照片。curated 状态的行 AI 不得覆写。';
