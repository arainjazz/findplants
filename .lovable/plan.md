## 实施计划

继续完成剩余 7 项功能。

### 1. 首页头部（src/routes/index.tsx + src/components/site-header.tsx）
- 大标题头改为「Plantspedia · 草木志」（文字，不带 logo）
- `SiteHeader` 导航栏：最左放 logo 缩略图标，紧挨着是「首页」链接，其余 Tab 顺延

### 2. 首页第 4 个 Tab「地区」
在 `src/routes/index.tsx` 现有 Tab 切换（最新更新 / 编辑推荐 / 热度）后加「地区」：
- 从 `regional_catalogs` + `catalog_entries` 聚合：按 `province → city → county` 三级树展示
- 每个叶节点列出该地区目录中、`scientific_name` 与 `plants.scientific_name` 匹配的条目（蓝色链接跳转 `/plants/$slug`）
- 仅显示有匹配条目的地区

### 3.「已收录档案」页 4 个下拉筛选（src/routes/plants.index.tsx）
- 搜索框左侧新增 4 个 `FilterDropdown`：科 / 属 / IUCN / 地区
- 选项来源：
  - 科 = `plants.family` distinct
  - 属 = `plants.genus` distinct
  - IUCN = 固定 8 类 EX/EW/CR/EN/VU/NT/LC/DD（中英对照）
  - 地区 = `regional_catalogs` 聚合的省/市/县
- URL 搜索参数：`?family=&genus=&iucn=&region=`（zod + fallback）
- 鼠标悬停展开下拉，点击设置参数过滤列表

### 4. 地区目录合并展示（src/routes/_authenticated/admin.catalogs.$id.tsx 重构）
- 同一 `province+city+county` 的多个 `regional_catalogs` 视为一个合并目录
- 列表中每个条目显示 `added_by_name`（哪位编辑添加的）
- 已有植物详细页 → 蓝色 `<Link>`，否则黑色文字
- 新增聚合路由 `/regions/$province/$city?/$county?`（公开浏览页）

### 5. PlantEditor 增加 genus / iucn_status（src/components/plant-editor.tsx）
- 在 family 字段下方加 `genus` 文本输入
- 加 `iucn_status` 下拉（8 类 + 空值）
- 保存时一并写入 plants

### 6. 修改记录页摘要展示（src/routes/edits.tsx + src/lib/edits.ts）
- `EditRow` 识别 `kind === 'catalog_create' | 'catalog_append'`：
  - catalog_create → 「X 编辑添加了 X 地区的目录 N 条」
  - catalog_append → 「X 编辑在 X 地区目录下新增 N 条，该地区共计 M 条」
- 该类不展示 before/after diff，仅展示 `summary`
- 不显示「撤销/恢复」按钮（目录类操作走管理页删除）

### 7. 管理页目录展示（src/routes/_authenticated/admin.index.tsx）
- 在「我的条目」下方加「我创建的地区植物目录」区块
- 每行：`为 {省市县} 添加了 {n} 种植物目录 · {时间} · 来源：{source}` + 编辑/删除按钮
- 编辑按钮 → `/admin/catalogs/$id`；删除 → 调用 `regional_catalogs` delete（RLS 保证只能删自己创建的）

### 8. HTML 编辑器全宽（src/components/html-doc-editor.tsx + src/routes/_authenticated/admin.edit.$id.tsx）
- 编辑页 `max-w-6xl` → `max-w-none px-4` 或 `max-w-[min(100vw-2rem,1800px)]`
- 编辑器容器宽度 100%，iframe `width:100%`，`min-height: calc(100vh - 220px)`
- 工具栏 sticky top

### 文件改动汇总

**修改：**
- `src/components/site-header.tsx`（logo + 首页位置）
- `src/routes/index.tsx`（头部文案 + 地区 Tab）
- `src/routes/plants.index.tsx`（4 下拉 + URL 筛选）
- `src/routes/_authenticated/admin.index.tsx`（目录列表区块）
- `src/routes/_authenticated/admin.catalogs.$id.tsx`（合并展示）
- `src/routes/_authenticated/admin.edit.$id.tsx`（全宽）
- `src/components/html-doc-editor.tsx`（全宽 + 工具栏）
- `src/components/plant-editor.tsx`（genus / iucn）
- `src/routes/edits.tsx`（catalog 摘要行）
- `src/lib/catalogs.ts`（合并查询辅助）

**新建：**
- `src/routes/regions.tsx`（首页地区 Tab 复用的浏览组件，可选）

无新增数据库迁移（schema 已就绪）。
