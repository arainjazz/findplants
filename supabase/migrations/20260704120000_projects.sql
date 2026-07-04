-- 项目驱动调研成果 (Project-driven research findings)
-- Editors author "projects" (Notion-style rich content) that appear on the public
-- /projects page with left-side filters by time / location / theme / initiator.
-- project_date, location, theme, initiator are REQUIRED (they drive the filters).

create table if not exists public.projects (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  project_date  date not null,               -- 项目时间（必填）→ 时间范围筛选
  location      text not null,               -- 项目地点（必填）→ 地点筛选
  theme         text not null,               -- 主题（必填）→ 主题筛选
  initiator     text not null,               -- 发起人（必填）→ 发起人筛选
  summary       text,                        -- 一句话简介（列表卡片摘要）
  content_html  text not null default '',     -- Notion 式正文（存 HTML）
  cover_url     text,
  author_id     uuid not null references auth.users(id) on delete cascade,
  author_name   text,
  published     boolean not null default false,
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.projects enable row level security;

-- Anyone can read published projects.
drop policy if exists "projects_read_published" on public.projects;
create policy "projects_read_published" on public.projects
  for select using (published = true);

-- Authors (and admins) can read their own drafts too.
drop policy if exists "projects_read_own" on public.projects;
create policy "projects_read_own" on public.projects
  for select using (
    auth.uid() = author_id or public.has_role(auth.uid(), 'admin'::app_role)
  );

-- Approved editors create their own; admins may act on any.
drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects
  for insert with check (
    auth.uid() = author_id and (
      private.is_approved_editor(auth.uid()) or public.has_role(auth.uid(), 'admin'::app_role)
    )
  );

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update using (
    auth.uid() = author_id or public.has_role(auth.uid(), 'admin'::app_role)
  );

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete using (
    auth.uid() = author_id or public.has_role(auth.uid(), 'admin'::app_role)
  );

create index if not exists projects_published_date_idx
  on public.projects (published, project_date desc);

-- Keep updated_at fresh on write (reuse the shared trigger fn if present).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists projects_set_updated_at on public.projects;
    create trigger projects_set_updated_at before update on public.projects
      for each row execute function public.set_updated_at();
  end if;
end $$;
