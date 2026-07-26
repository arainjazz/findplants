-- 修复：projects 的 RLS 策略调用了 public.has_role，而 authenticated 早在
-- 20260513124950 里被 REVOKE 掉了对 public.has_role 的 EXECUTE（整套改造把角色判断
-- 迁到了 private.has_role，见 20260513133147 授权给 authenticated/anon）。
-- 结果：任何 projects 的 insert/update/select-own 一评估策略就调 public.has_role
-- → 「permission denied for function has_role」，表现为「添加新项目内容报错」。
--
-- 原始迁移 20260704120000_projects.sql 的作者其实用对了 private.is_approved_editor，
-- 只是把 has_role 误写成了 public.。这里把四条策略全部重建为 private.has_role，
-- 与站内其它所有策略保持一致。纯策略重建，无 schema 变更、无需改 types.ts。

drop policy if exists "projects_read_own" on public.projects;
create policy "projects_read_own" on public.projects
  for select using (
    auth.uid() = author_id or private.has_role(auth.uid(), 'admin'::app_role)
  );

drop policy if exists "projects_insert" on public.projects;
create policy "projects_insert" on public.projects
  for insert with check (
    auth.uid() = author_id and (
      private.is_approved_editor(auth.uid()) or private.has_role(auth.uid(), 'admin'::app_role)
    )
  );

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update using (
    auth.uid() = author_id or private.has_role(auth.uid(), 'admin'::app_role)
  );

drop policy if exists "projects_delete" on public.projects;
create policy "projects_delete" on public.projects
  for delete using (
    auth.uid() = author_id or private.has_role(auth.uid(), 'admin'::app_role)
  );
