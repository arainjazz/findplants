-- 保护名录的「编辑归属」删除权限（用户要求 2026-07-16）。
--
-- 背景：conservation_lists 原本只有 admin 能写（见 20260703120000_conservation_registries.sql），
-- 表里也没有任何「谁添加的」信息 —— 现有 11 份名录（国家2021 / 7 省 / CITES / GTS / GRIIS）
-- 都是 migration 播种的，没有添加人。本迁移补上归属列，让**添加某份名录的编辑**也能删掉它，
-- 同时 admin（站长 owner）保留对全部名录的完全权限。
--
-- ⚠️ 已播种的 11 份名录 created_by 为 NULL → 仍然只有 admin 能删。这是有意的：
--    它们不属于任何编辑，不该让随便哪个编辑删掉全站共用的参考数据。

ALTER TABLE public.conservation_lists
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS conservation_lists_created_by_idx
  ON public.conservation_lists (created_by);

-- admin（owner）：全部名录的完全权限，保持不变。
DROP POLICY IF EXISTS "Admins manage conservation lists" ON public.conservation_lists;
CREATE POLICY "Admins manage conservation lists"
  ON public.conservation_lists FOR ALL
  TO authenticated
  USING (private.has_role(auth.uid(), 'admin'))
  WITH CHECK (private.has_role(auth.uid(), 'admin'));

-- 添加者：只能管自己添加的那几份。created_by IS NULL 的播种名录不在此列（NULL = auth.uid()
-- 在 SQL 里求值为 NULL，不是 true），所以播种数据仍然只有 admin 能碰。
DROP POLICY IF EXISTS "Editors manage their own conservation lists" ON public.conservation_lists;
CREATE POLICY "Editors manage their own conservation lists"
  ON public.conservation_lists FOR ALL
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- 注：删 conservation_lists 一行时，conservation_taxa 的 ON DELETE CASCADE 会连带清空它的物种行。
-- Postgres 的外键级联动作以系统权限执行、不走 RLS，所以 taxa 表的 admin-only 策略不需要放宽。
