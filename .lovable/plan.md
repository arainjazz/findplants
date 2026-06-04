## 目标

1. 任何访问者（含未登录）可在首页用摄像头拍植物 → AI 识别 → AI 按附件 HTML 的样式生成详情页 → 自动带 GPS 拍摄地点 → 保存为"待审核草稿"。
2. 草稿在首页"最新识别"卡片区显示（含照片缩略、植物名、拍摄地点摘要），点击进入完整详情页（只有作者/编辑/管理员能访问）。
3. 已正式收录的条目，按时间倒序在首页下方"已收录条目流"展示。
4. 编辑/管理员在草稿详情页点"收录到本站"→ 条目转为正式 plants 记录，所有改动写入 plant_edits 修改日志（source=`ai_camera_capture`+审核人）。
5. 你（arainjazz@gmail.com / zhou19869021）首次登录后自动获得 admin 角色 + editor 角色，拥有所有权限。

## 数据库改动

新增表 `plant_drafts`：
- `id uuid pk`, `created_at`, `updated_at`
- `created_by uuid null`（未登录为 null）、`creator_label text`（匿名时显示"访客"，登录时显示昵称）
- `photo_url text`（上传到 `plant-images` bucket 的拍摄照片）
- `capture_lat numeric`, `capture_lng numeric`, `capture_place text`（反查的地名/用户可编辑）
- `ai_model text`、`ai_payload jsonb`（AI 原始返回，便于回放/再生成）
- `title`, `scientific_name`, `common_name_en`, `family`, `genus`, `summary`, `tags text[]`, `iucn_status`
- `html_content text`（按附件模板生成的完整 HTML，复用现有 plant-html 渲染）
- `status text check in ('pending','approved','rejected') default 'pending'`
- `published_plant_id uuid null`（收录后指向 plants.id）

RLS：
- `SELECT`：所有人（含 anon）可读 `status='pending'` + 自己创建的 + editor/admin 可读全部
- `INSERT`：anon + authenticated 都允许（写入时 created_by = auth.uid() 或 null）
- `UPDATE/DELETE`：仅 admin/editor 或 created_by 本人
- 显式 `GRANT SELECT, INSERT ON public.plant_drafts TO anon, authenticated; GRANT ALL TO service_role;`

存储 bucket `plant-images` 已存在；为 anon 增加上传策略（仅允许写 `drafts/` 前缀，限制 mimetype + size 在 edge 校验）。

## 后端 server functions（src/lib/identify-plant.functions.ts）

- `identifyPlantFromPhoto(photoBase64, lat, lng)`：调用 Lovable AI `google/gemini-2.5-pro`（多模态），prompt 要求按附件 HTML 同款字段返回结构化（tool calling）：title/scientific_name/family/genus/summary/tags 等。
- `renderPlantHtml(meta, photoUrl, place)`：调用 `google/gemini-3-flash-preview`，把上面提到的附件模板（loaded once on server）与字段拼成完整 HTML，严格保留 CSS。
- `submitDraft(photoBase64, lat, lng, place)`：链式调用上面两步，写入 storage + 插入 `plant_drafts`，返回 draft id。匿名也能调。
- `approveDraft(draftId)`：仅 editor/admin，将 draft 转为 `plants` 行 + html 上传到 `plant-html` bucket + 写 `plant_edits` 一条 `approved` 记录（source=`ai_camera_capture+catalog_editor`）+ 标记 draft `approved` + `published_plant_id`。

## 前端

- 首页 `src/routes/index.tsx` 顶部新增"拍照识植"区块：
  - 调 `navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}})` 取后置摄像头，捕获 frame → JPEG base64。
  - `navigator.geolocation.getCurrentPosition` 取经纬度 → 反查地名（Lovable AI 文本调用，无需第三方 key）。
  - 显示识别进度 → 跳到 `/drafts/$id`。
- 首页两个流：
  1. "最新识别（待审核）" 横向卡片：缩略图 + 植物名 + 拍摄地 + "草稿" 徽章
  2. "已收录条目" 网格：现有 plants 流
- 新路由 `src/routes/drafts.$id.tsx`：渲染 draft 的 html_content（复用现有 html 渲染），editor/admin 顶部显示"收录到本站 / 删除草稿"按钮。

## 所有者账号 & 权限

- 通过 admin API 创建 auth 用户 arainjazz@gmail.com（已确认邮箱），写入 profiles。
- 在 `user_roles` 插入 `(user_id, 'admin')` 和 `(user_id, 'editor')`，让你登录后即获全部权限。

## 修改记录

所有 draft → published 的转换以及编辑改动都写 `plant_edits`，source 使用 `aiSource({model:'google/gemini-2.5-pro', platform:'lovable-ai', via:'ai_camera_capture'})` 或附加 `+catalog_editor`，并在 `/edits` 页正常展示。

## 不在本次范围

- 摄像头页面的细节美化、reverse-geocoding 的高精度回退、批量导入草稿。
- 详情页之外的"修订对比"。

---
如确认这个方案，我会按以下顺序实施：
1. 数据库迁移（plant_drafts + 存储策略 + 你的所有者账号 & 角色）
2. server functions（identify / render / submit / approve）
3. 首页改造 + drafts 详情路由
4. 验收 SSR/build + 用账号登录验证管理员权限
