-- 《中国植物物种名录 2026 版》—— 全站的**正名权威表**（替换 2025 版那张）。
--
-- 与 2025 版最要紧的差别：**这一版带异名**。
--   120,307 条名称 = 47,469 个接受名 + 72,838 个异名/误用名/待定名
--   每条异名都有 `accepted_name_code` 指向它的正名 → **异名到正名的映射第一次成为可能**。
-- 上一版的 `20260723120000_species_checklist.sql` 里写着「把异名映射到正名做不到，
-- 那需要 POWO/IPNI 级别的异名索引」—— 这份表就是那个索引，那条限制作废。
--
-- 另外多了两样 2025 版没有的：
--   · 省级分布（47,197 个接受名有）→ 可以核对「这个种在内蒙古有没有分布」
--   · 独立的中文俗名表（16,929 条）→ 别名/俗名有了权威来源，不必再靠模型编
--
-- ⚠️ **`name_key` 绝不能加 UNIQUE**（2025 版那张表就是这么写的，到 2026 版会直接崩）。
-- 全量实测 120,307 条 → 118,839 个唯一键，1,373 组重复，分三类：
--   · 532 组：同一个正名的不同写法        → 无害
--   · 264 组：一个正名 + 一个异名同键      → 以正名为准（解析器已处理）
--   · 577 组：**多个不同的正名同键**       → 真·同名异物，判 ambiguous，不猜
-- 真正的主键是 `name_code`（名录自己的 ID）。

create table if not exists public.species_names (
  -- 名录自己的 ID。**唯一约束落在这里**，不是 name_key。
  name_code text primary key,

  -- 归一化匹配键 = `name-authority.ts` 的 `canonicalKey()`。
  -- 导入脚本与查询端**共用同一份实现**（scratch/build_col2026.mjs 直接 import 它），
  -- 否则库里存的键和查询时算的键会悄悄错开 —— 2025 版踩过这个坑。
  -- 普通索引，不是唯一（见上）。
  name_key text not null,

  -- 这条名字的正名是谁。接受名指向自己；异名指向它的正名。
  -- 极少数异名指向的正名不在表内（实测 6 条）→ null，这些只标注、不改名。
  accepted_code text,
  accepted_key  text,

  is_accepted boolean not null default false,
  -- accepted name / synonym / ambiguous synonym / misapplied name /
  -- provisionally accepted name / uncertain name
  status text not null,

  scientific_name text not null,
  author text,                 -- 名录里命名人是**独立一列**，不用再从学名里剥
  chinese_name text,           -- 该等级的中文正名（种下等级取 infraspecies_c）

  genus_la text, genus_zh text,
  family_la text, family_zh text,
  order_zh text, class_zh text, phylum_zh text,

  rank text not null default 'species',
  common_names text[],         -- 中文俗名/别名（来自 common_names 表）
  distribution_zh text,        -- 省级分布，如「黑龙江、吉林、内蒙古」

  source text not null default 'COL-China-2026',
  created_at timestamptz not null default now()
);

-- 热路径：按归一化学名查（一键可能多行，解析器自己判歧义）。
create index if not exists species_names_key_idx on public.species_names (name_key);

-- 异名 → 正名的反查。
create index if not exists species_names_accepted_key_idx on public.species_names (accepted_key);

-- 中文名反查（13 个同名异物，所以不是唯一）。
create index if not exists species_names_zh_idx on public.species_names (chinese_name);

-- 属名前缀查：模型只定到属时，列出该属在中国的全部接受名。
create index if not exists species_names_genus_idx on public.species_names (genus_la);
create index if not exists species_names_family_idx on public.species_names (family_la);

-- 「已收录档案检索」要按中文名 / 学名模糊搜 → trigram。
create extension if not exists pg_trgm;
create index if not exists species_names_sci_trgm_idx
  on public.species_names using gin (scientific_name gin_trgm_ops);
create index if not exists species_names_zh_trgm_idx
  on public.species_names using gin (chinese_name gin_trgm_ops);

-- 俗名数组也要能搜（「那冷门」这种只在俗名里出现的叫法）。
create index if not exists species_names_common_idx
  on public.species_names using gin (common_names);

-- 国家级公开名录，人人可读；写入只走 service-role（导入脚本）。
alter table public.species_names enable row level security;

drop policy if exists "species_names public read" on public.species_names;
create policy "species_names public read"
  on public.species_names for select
  using (true);

comment on table public.species_names is
  '中国植物物种名录 2026 版：120,307 条（47,469 接受名 + 72,838 异名）。全站正名权威表，只读。
   含异名→正名映射、中文俗名、省级分布。导入见 scratch/extract_col2026.py + build_col2026.mjs。
   注意 name_key 非唯一（577 组真·同名异物），主键是 name_code。';

-- ── 核对留痕 ────────────────────────────────────────────────────────────────
-- 内容里的名字被改成正名之后，必须留下改之前是什么：编辑要能看出名字是名录定的
-- 还是模型给的；判成 ambiguous/unmatched 的要能捞出来人工复核；万一匹配错了能回滚。
-- （这两条如果跑过 20260723 那份迁移就已经存在，if not exists 保证可重复执行。）
alter table public.plants
  add column if not exists name_authority jsonb;

comment on column public.plants.name_authority is
  '正名核对留痕：{status,matchedBy,aliases,note,was,source,at}。status=renamed 表示已按名录改名，was 存原值；ambiguous/unmatched 表示未改写、待人工核对。';

create index if not exists plants_name_authority_todo_idx
  on public.plants ((name_authority->>'status'))
  where name_authority->>'status' in ('ambiguous', 'unmatched', 'renamed');
