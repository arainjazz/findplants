-- 任务动态流（task feed）—— 小P蛙通知中心的数据地基。
--
-- 解决的问题：AI 任务（识别 / 银叶草稿 / 金叶详页）现在只在**发起它的那个页面**上可见。
-- 用户一旦切走去识别下一株、或换台设备，就再也看不到进度，更不知道哪几个已经跑完了。
-- 用户 2026-07-29 的要求：小P蛙图标下面按类型显示三色进度条（绿=识别 / 蓝=银叶 /
-- 橙=金叶），右上角三色圆圈显示各自「已完成但没看过」的条数，点开逐条列摘要卡。
--
-- 为什么**不复用** site_config 里的 job 行：
--   ① 那些行 6 小时后被 pruneExpiredJobs 清掉，而动态流要能往回翻；
--   ② 它们以 `job:<uuid>` 为主键，没法「查出我的全部任务」；
--   ③ 「已读」没有地方存；
--   ④ 摘要卡要的展示字段（物种名、缩略图、一句话摘要）job 行里没有。
-- 分工：**job 行 = 执行状态（短命），本表 = 动态流 + 已读状态（长命）**。
--
-- 为什么存库而不是 localStorage（用户 2026-07-29 拍板）：要跨设备可见。
-- 代价是匿名用户没有稳定身份、拿不到动态流 —— 用户明确表示重点照顾注册用户与编辑，
-- 匿名用户仍可正常识别，只是不进动态流（user_id 为空的任务直接不落这张表）。

create table if not exists public.task_feed (
  id uuid primary key default gen_random_uuid(),

  -- 归属人。匿名识别不落表（见文件头），所以这里 not null。
  user_id uuid not null references auth.users (id) on delete cascade,

  -- 哪一类任务，决定小P蛙上用什么颜色：
  --   identify=绿 · enrich_draft=蓝 · gold_page=橙
  kind text not null check (kind in ('identify', 'enrich_draft', 'gold_page')),

  -- 对应 site_config 里的 `job:<id>`。识别若尚未搬上队列则为空（同步完成）。
  job_id text,
  -- 产物草稿。识别任务在跑完前为空；银叶/金叶从一开始就有。
  draft_id uuid,

  status text not null default 'running'
    check (status in ('running', 'done', 'error')),
  -- 给用户看的阶段文案，如「正在联网调研…」。进度条的文字说明。
  phase text not null default '',
  -- 0–100，纯展示。
  progress integer not null default 0 check (progress between 0 and 100),

  -- ── 摘要卡的展示字段（点开小P蛙时逐条渲染）──────────────────────────────
  title text,
  thumb_url text,
  summary text,
  error text,

  -- ── 已读判定（用户 2026-07-29 拍板：**进过那份草稿的详情页就算已读**）──
  -- 所以标记已读的动作发生在 /drafts/$id 挂载时，而不是「在小P蛙里点了卡片」。
  -- null = 未读，参与右上角圆圈的计数。
  read_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 动态流的主查询：某人最近的任务，按时间倒序。
create index if not exists task_feed_user_created_idx
  on public.task_feed (user_id, created_at desc);

-- 未读计数走这个部分索引 —— 未读永远是少数，全表扫描没必要。
create index if not exists task_feed_unread_idx
  on public.task_feed (user_id, kind)
  where read_at is null and status = 'done';

-- 「进详情页就算已读」要按 draft_id 反查本人的那条动态。
create index if not exists task_feed_draft_idx
  on public.task_feed (draft_id)
  where draft_id is not null;

-- 同一份草稿的同类任务只该有一条动态：重跑银叶不该在流里堆两条，
-- 而是把原来那条更新掉（并重新置为未读）。
create unique index if not exists task_feed_unique_draft_kind
  on public.task_feed (user_id, kind, draft_id)
  where draft_id is not null;

alter table public.task_feed enable row level security;

-- 本人只读自己的动态流。写入一律走 service-role（服务端 fn），
-- 避免前端伪造「任务已完成」或改别人的已读状态。
drop policy if exists task_feed_select_own on public.task_feed;
create policy task_feed_select_own on public.task_feed
  for select using (auth.uid() = user_id);

-- 「标记已读」是唯一允许前端直接做的写操作，且只能改自己的行、只能动 read_at。
-- （列级限制 Postgres RLS 表达不了，用触发器兜住，见下。）
drop policy if exists task_feed_update_own_read on public.task_feed;
create policy task_feed_update_own_read on public.task_feed
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 防止前端借「标记已读」这条 policy 篡改状态/标题/进度。
-- service-role 绕过 RLS，但**不绕过触发器**，所以这里显式放行它。
create or replace function public.task_feed_guard_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;
  -- 普通用户：除 read_at / updated_at 外一律不许改。
  new.user_id   := old.user_id;
  new.kind      := old.kind;
  new.job_id    := old.job_id;
  new.draft_id  := old.draft_id;
  new.status    := old.status;
  new.phase     := old.phase;
  new.progress  := old.progress;
  new.title     := old.title;
  new.thumb_url := old.thumb_url;
  new.summary   := old.summary;
  new.error     := old.error;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists task_feed_guard_update_trg on public.task_feed;
create trigger task_feed_guard_update_trg
  before update on public.task_feed
  for each row execute function public.task_feed_guard_update();

comment on table public.task_feed is
  '小P蛙通知中心的动态流：AI 任务的进度 + 已读状态。执行状态仍在 site_config 的 job 行里（短命），本表长期保留。已读判定 = 进过该草稿的详情页。';
