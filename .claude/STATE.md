# Plantspedia — Working State  (single source of truth)

_Last updated: 2026-06-24 — by Claude (rebuilt `/explore` 身边物种地图: nav rename, 3 base
layers 平面/卫星/地形, and replaced markercluster spiderfy with a custom fan-out — black
radial+horizontal connectors → right-side species cards (photo+科属种) + green cross-links to
the same species elsewhere. DEPLOYED LIVE Version `a1c1b792-9894-4466-af23-bd54700e3980`.)
Earlier 06-20: fixed + DEPLOYED the 定边县
cross-province split (Version `36a58ebd`). 06-14: diagnosed "session 一直报错" = GFW resetting
long-lived API streams, not Anthropic/code; see Blockers._
_Read this FIRST and update it LAST, every session._

## 🆕 2026-07-04 — 项目驱动调研成果 + BlockNote 编辑器 + 地图入侵标记 (DONE code, tsc EXIT=0, build OK; NOT deployed, 未真机)
安全善后完成后继续做功能。用户 6 项需求：
1. **地图入侵标记改成黄三角+红!**（explore.tsx `INVASIVE_MARKER_HTML`）：fill `#facc15`、白描边、`!` 红 `#dc2626`。已改。
   - **"识别不出入侵物种"诊断**：直连库确认 conservation_lists 有 griis + 2055 taxa（数据在），检测逻辑正确且空安全。
     `is_invasive=true` 查询返回空 → 入侵迁移 `20260703000000_invasive_species.sql` 可能没应用（影响 GBIF 叠加+ingest 打标，
     不影响 GRIIS 名录比对）。所以地图只给"学名对得上 GRIIS"的观测打三角；若某观测该标没标，多半 scientific_name 空/写法不符。
     **待用户**：给出该被标却没标的观测学名，我再精确查匹配；并建议应用那条入侵迁移点亮 GBIF 叠加层。
2-6. **项目驱动调研成果（大功能，用 BlockNote＝Notion 式）**：
   - 装了 `@blocknote/core/react/mantine@0.51.4`（React19 OK）。
   - **新 `projects` 表**：`supabase/migrations/20260704120000_projects.sql`（title + **project_date/location/theme/initiator 必填**
     + summary + content_html + cover + author + published；RLS：published 世界可读、作者/admin 读写、insert 限 approved editor）。
     types.ts 手加 projects 类型。**⚠️ USER 必须在 Supabase 后台应用这条迁移**（否则 /projects 与编辑器查询报错）。
   - **`src/lib/projects.ts`**：CRUD + projectCoverUrl/projectYear。
   - **`src/components/block-editor.tsx`**：BlockNote 包装（client-only、mounted 后再挂载=SSR 安全；中文 dictionary=
     `@blocknote/core/locales` 的 `zh`；HTML in/out：tryParseHTMLToBlocks / blocksToFullHTML；uploadFile 传图上传）。
   - **`src/components/project-editor.tsx`**：新建/编辑，4 个必填字段 + 必填校验 + BlockEditor + 封面上传。
   - **admin 路由** `admin.projects.new` / `admin.projects.edit.$id`；管理页「我的条目」加「+ 编辑项目」按钮。
   - **公开页** `projects.index`（导航「项目驱动调研成果」→ 左侧 4 下拉筛选：时间范围[年]/地点/主题/发起人，右侧卡片）
     + `projects.$id`（详情，prose-project 样式渲染 content_html）。导航桌面+移动都加了。
   - **博客编辑器也换成 BlockNote**（blog-editor.tsx：RichEditor→BlockEditor + uploadFile）。
- **验证**：`npm run build` 通过、`tsc --noEmit` EXIT=0。**已 preview 实测**（把 dev 端口从 8080 移到 5199 避开 llama-server，
  见 .claude/launch.json）：/projects 正常渲染（标题+4 个筛选下拉+空态+导航链接，0 console error）；用临时 /bntest 路由验证
  BlockNote 挂载成功、初始 HTML 正确解析、onChange 回吐 HTML（round-trip OK），验证后已删该临时路由。编辑器全流程（登录建项目
  →发布→筛选）仍需用户应用迁移 + 登录后真机走一遍。**USER VERIFY**：①Supabase 应用 `20260704120000_projects.sql`；②本地腾出
  8080 或部署后：管理页「+编辑项目」→ 填必填+Notion 正文→发布→ /projects 出卡片、左侧筛选可用、详情正常；博客编辑也变
  Notion 式。③`npm run build && wrangler deploy`(VPN)。
- **注意/待办**：BlockNote 正文存的是 `blocksToFullHTML` 的 HTML（含 bn-* 包裹 div），公开页用 prose-project 基础样式渲染，
  基本可读；若样式不够精细，后续可引 BlockNote 展示态 CSS 或改 blocksToHTMLLossy。旧 rich-editor.tsx 仍在（未删）。

## 🆕 2026-07-04 — 入侵物种 4 连修：1000 行封顶 / 摘要重复 / 卡片等级+引用 / 地图标记 (DONE code, tsc+build OK, preview 验证; NOT deployed)
用户拍到 拟蒲公英 Tragopogon dubius，草稿出了入侵警示卡但有 4 问题。逐一修复并 preview 实测：
- **根因（最关键）= 1000 行封顶**：`conservation_taxa` 有 2055 行，但 `fetchConservationData`（conservation.ts）和
  submitPlantDraft 的 conservation 查询都没翻页 → PostgREST 默认只返回前 1000 行 → 后灌的 GRIIS(449)/GTS 全部落在 1000 行外
  没加载（实测只加载到 4 条 griis）。导致：①地图 matcher 匹配不到入侵种、②/plants 的 GRIIS/GTS 筛选永远空（用户说的"筛选条件缺失"）。
  **修**：两处都改成 `.range(from,from+999)` 循环翻页取全部。**实测**：taxaLoaded 1000→2055、Tragopogon→griis "invasive"、
  地图 isInvasiveSighting 从 0 → 4（含 Tragopogon/Medicago sativa/Hordeum jubatum）。
- **①摘要与拍摄记录上方重复**（plant-html-template.ts）：草稿页 drafts.$id 有独立「摘要·Summary」块（对），而 hero 又把
  `{{summary_zh/en}}` 作为引导段渲染在 拍摄记录 上方 → 重复。**修**：hero 删掉 summary 两段，只留 `.field-capture`（拍摄记录=
  看图鉴定分析）；.field-capture 去掉 top-border。bun 渲染确认 hero 不再含 summary。
- **②③卡片缺引用与四等级**（identify-plant.functions.ts + template）：重构 submitPlantDraft——先做（翻页后的）conservation 匹配
  拿 `griisHit`（degree 标签 + griis 名录 name/version/source_url），再据此 + GBIF live 生成入侵卡；invasive 判定改为
  「GBIF 说入侵 或 本地 GRIIS 命中」。PlantDraftFields.invasive 加 `degree/source_url`；卡片头部加「入侵等级：Invasive 入侵物种」
  chip，底部加「判定依据·Source：GRIIS 全球入侵等级（中国）（2023）」带链接（.ic-cite CSS）。bun 渲染四项断言全 true。
  注意：本地 GRIIS（GBIF 托管版）只有 invasive/established 两级，非完整四级（source_note 已说明），卡片显示实际命中的那级。
- **验证**：tsc EXIT=0、`npm run build` 通过、preview 实测（矩阵器/地图/模板渲染）。**生效范围**：#③筛选+#④地图是客户端逻辑，
  部署后对**现有**数据即时生效（用户那株 Tragopogon 部署后地图立刻变黄三角）；#①hero+#②③卡片是模板改动，只对**新识别**的草稿
  生效（旧草稿 html_content 已存，需重识别/编辑）。**USER**：`npm run build && wrangler deploy`(VPN)。可选：应用
  `20260703000000_invasive_species.sql`（加 is_invasive 列，点亮"只看入侵"的 GBIF 分布叠加层；地图打标不依赖它）。

## 🎯 Current goal
Fix **observation/activity location recognition** (`capture_place`) + assorted UI
details. (Session title: "Fix activity location recognition and UI details".)

## 🆕 2026-07-04 — 小P蛙问答 scope 感知视觉（喂分区/整页配图给模型） (DONE code, tsc EXIT=0, 真页算法验证; NOT deployed)
用户反馈：问「有没有错配图」小P答错——根因 `askPlantAgentFn`/`askDraftAgentFn` 问答时**只喂 1 张图**（封面/首图），
看不到分区插图，只能瞎猜。用户拍板方案：**scope 感知**——选了 annotation 分区就只喂**该分区**的 img；选「整页」才喂**全部** img。
- 新增 helper（identify-plant.functions.ts，放 fetchInlineImage 后）：`allHtmlImageUrls(html,baseUrl)` 正则抽所有 `<img src>`
  （可 absolutize）；`sectionHtmlForScope(html,scope)` 用 h1-3 正则切「该标题→下一个同级/更高级标题」的片段（找不到返回 null）；
  `xiaopVisionUrls({html,baseUrl,scope,coverUrl})` scope→分区图 / 无 scope→封面+全页，去重、上限 `MAX_XIAOP_IMAGES=8`；
  `fetchInlineImages(urls)` 批量下载成 base64 跳过失败。删掉不再用的 `firstHtmlImage`。
- `fetchPlantPageText` 增返回 `html_url`（用作相对 src 基准）。`askPlantAgentFn`：`photo`(单图)→`photos=fetchInlineImages(
  xiaopVisionUrls(...scope=data.scope...))`；system prompt 图片说明改为「附了本页/本分区 N 张实际配图，逐张与正文核对、
  指出第几张张冠李戴」；`images: photos.length?photos:undefined`。`askDraftAgentFn`（无 scope 选择器）：喂访客原图 + 草稿
  全部分区插图（xiaopVisionUrls coverUrl=photo_url、无 scope=全部）。
- **算法在真页验证**（四合木 tetraena-mongolica，preview 取 html_url 实跑）：全页 22 图；scope「关键特征」(h2)→精确切出
  该分区 7 张（含错配的蒺藜 Tribulus 茎/叶照片）；scope 段止于下一个 h2「典型生境」。无 scope→封面+全部截断到 8。
  ⇒ 之前这问题模型只拿到封面所以答错；现在选「关键特征」会真拿到那几张错图 → 能识别。
- **背景**（本轮诊断出的真配图错误，供后续修图参考）：四合木页 MODULE I/II 分区配图用成了**蒺藜（Tribulus terrestris，
  同蒺藜科）**——羽状复叶+黄花+带刺蒺藜果，与正文「单叶肉质对生/白花/四翅无刺」矛盾。需编辑用「换配图」替换。
- **验证**：tsc EXIT=0；dev server 无错。**未做真模型端到端**（需登录编辑态 + 一次模型调用）。**USER VERIFY**：登录编辑，
  /plants 选「关键特征」问「配图有没有错」→ 小P 应能指出蒺藜错配；选「整页」问则综合全页。然后 build+deploy(VPN)。
- **追加（同日）：草稿页也加 annotation**。之前只有已发布 /plants 页有「讨论范围（标注）」下拉；现给 /drafts/$id 也加：
  drafts.$id.tsx 用 useMemo 从 draft.html_content 抽 h1-3 标题成 pageSections → `scopes={pageSections}`；ask/apply 回调
  透传 scope。服务端 `AskDraftAgentInput`/`ApplyDraftAgentEditInput` 加 `scope`；`askDraftAgentFn` 用 `xiaopVisionUrls(
  {html,scope,coverUrl:photo_url})`（scope→仅该分区图 / 无 scope→原图+全部草稿图）+ scopeLine + 图片说明按 scope 变；
  `applyDraftAgentEditFn` 加 scopeLine（只改该分区）。日志 summary 带（分区/整份草稿）。**preview 实测**：草稿页面板下拉出
  「整页·全文 / 名称溯源 / 形态特征 / 生境与分布 / 文化与利用」等真实标题、无报错。

## 🆕 2026-07-04 — 我的博文缩略图 + 小P蛙移动端多项 + 拍摄记录改造 (DONE code, tsc EXIT=0, preview-verified; NOT deployed)
用户 5 项需求，全部完成并在移动视口(375×812)实测：
1. **我的主页「我的博文」缩略图**（profile.tsx）：该 section 之前是纯文本列表、无缩略图。改为 sm:grid-cols-2 卡片，
   每条用 `blogCoverUrl(p)`（cover_url→正文首图，与首页 EditorsBlogStrip 同源）渲染 12×12 缩略图。import 补 blogCoverUrl。
2. **小P蛙 移动端面板头（draft-agent-panel.tsx）**：关闭 X 改成「带边框的按钮框 + 下方小字『收起对话』」（flex-col，
   caption md:hidden 仅移动端）。已截图确认。
3. **移动端输入不再自动放大**：textarea `text-sm` → `text-base md:text-sm`（16px 阻止 iOS Safari 聚焦缩放，面板宽度不再变、
   关闭/模型设置按钮不再被挤出视口）。preview 实测 computed font-size=16px。
4. **换配图/模型设置放大一倍**：`text-[10px]`→`text-sm md:text-[10px]`、图标 `w-3.5`→`w-5 h-5 md:w-3.5`，加 py-1 触控区。
   实测 模型设置 14px 文字 + 20px 图标。
5. **小P蛙浮窗 logo 缩小 + 两行文案 + 滑动收纳**（draft-agent-panel.tsx）：
   - logo `w-20`→`w-10 md:w-20`（移动端缩一半）；pill 文案改两行「小P蛙」/「Plantspedia AI Agent」。
   - 新增 hide-to-tab：launcher onTouchStart/End 检测水平 swipe（>36px 且 dx>dy）→ 收成侧边「档案页标签」
     （`[writing-mode:vertical-rl]`，文字「唤出小P蛙」，docked left/right，localStorage `xiaop-launcher-hidden` 记住边）。
     点标签=还原 logo；滑标签=直接开对话框。didSwipe ref 防止 swipe 误触发 onClick。preview 实测：左滑→左侧标签、
     滑标签→开对话、close 显示「收起对话」、localStorage 清空。
6. **AI 识别草稿「拍摄记录」不再 = 摘要**（identify-plant.functions.ts + plant-html-template.ts）：
   - 根因：hero「FIELD CAPTURE 拍摄记录」块此前直接渲染 `{{summary_zh/en}}`，与摘要完全重复。
   - 新增 schema 字段 `field_notes_zh/en`（metaSchema + tool schema + required 都加），systemPrompt 写明拍摄记录=
     **对本张照片的形态分析 + 定种判断依据**（就图论图、可见诊断特征→如何推导物种、信息不足需补哪些部位照片），
     与 summary 内容不同不重复。summary_zh 规格保持博物学家口吻讲趣闻/与生活生态生产文化的联系（原就已改，未动）。
   - 模板 hero 右栏重排：`summary_zh/en`(叙事导语) 在上；新 `.field-capture` 子块（top-border 分隔）装 place/coords/date +
     `{{field_capture_notes}}`（新拼装块）。renderDraftHtml 构 fieldCaptureNotes：有 field_notes 用之，**旧草稿无则回退
     summary**（永不空块）。加 `.field-capture` CSS。bun 渲染两种情况均正确、无残留占位。
- **验证**：tsc --noEmit EXIT=0；dev server 无错、无 console error；移动视口逐项实测（见上）。profile「我的博文」需登录
   未在 preview 登录态验证，但改动同 EditorsBlogStrip 同函数、tsc 干净。
- **USER ACTION**：真机 /profile 看「我的博文」缩略图；手机 /drafts/* 或编辑登录 /plants/* 试小P蛙浮窗滑动收纳/放大按钮/
   输入不放大；真机 /identify 拍一张看草稿「拍摄记录」是否为看图鉴定分析（≠摘要）。然后 `npm run build && wrangler deploy`(VPN)。

## 🆕 2026-07-04 — 保护名录 GTS 灌库 + CITES 加附录III (DONE data, tsc EXIT=0; 三迁移待应用)
用户提供了 GTS（GlobalTreeSearch_China.csv, 4554 中国树种）、GRIIS v1.4 原档、CITES 官方中文本 PDF，并要求 CITES **加附录III**。
- **GTS 终于灌库（之前的阻塞点）**：GlobalTreeSearch_China.csv 只有树种清单**无 CR/EN/VU**（列：taxon/family/author/source/…，
  无濒危等级列）。方案：逐种比对 IUCN 红色名录（经 GBIF `species/{key}/iucnRedListCategory`，Global Tree Assessment 结果即
  发布于 IUCN 红名）取受威胁子集 → **482 种（CR 86 / EN 220 / VU 176）** → `20260703230000_seed_gts_china.sql`（kind=gts,
  status=CR/EN/VU, rank species, chinese_name 空——CSV 无中文名）。源+方法写进 source_note。脚本 scratch/gen_cites_griis.py 加 emit_gts。
- **CITES 加附录III**：从官方 PDF（2023-02-23 生效版）flora 全段（booklet p41-53）逐页读出**全部附录III 植物条目 27 条**
  （其中中国分布 ★：蒙古栎 Quercus mongolica/红松 Pinus koraiensis/水曲柳 Fraxinus mandshurica/买麻藤 Gnetum montanum/
  百日青 Podocarpus neriifolius/水青树 Tetracentron sinense/盖裂木 Magnolia liliifera；其余为南非/塞舌尔等单方列入的多肉）。
  顺带补了 PDF 里确认的、之前漏的中国相关 I/II：红景天属 Rhodiola(II,genus)、甘松 Nardostachys grandiflora(II)、
  云南火焰兰 Renanthera imschootiana(I)。**CITES 现 65 条**（I 3 / II 35 / III 27）。conservation.ts 的 CITES_APPENDICES
  加 `{value:"III",label:"CITES 附录III"}`（筛选下拉+徽章自动生效）。source_note 改为 I/II/III 说明。
- **GRIIS 不变**（用户确认「有了」）：仍 449 种，二级 invasive/established（v1.4 原档 meta.xml 证实无 degreeOfEstablishment 四级）。
- APPLY_ALL_conservation.sql 已重建：protected 8 名录 + CITES(65) + GRIIS(449) + GTS(482)。三新 seed 幂等、引号/括号平衡、
  NULL::text[] 正确。matcher 端到端 bun 验证：Quercus mongolica→附录III、Rhodiola→附录II、Cathaya argyrophylla→GTS VU、
  Metasequoia→GTS EN、Rosa→无。**七源名录全部到位**（国家/省级重点保护 · IUCN · CITES I/II/III · GTS · GRIIS）。
- **验证**：tsc EXIT=0。**USER ACTION**：Supabase SQL Editor 应用 `20260703210000`(cites 65,已含III) +
  `20260703220000`(griis 449) + `20260703230000`(gts 482)，或直接跑 APPLY_ALL。应用后 /plants 三个筛选全亮（CITES 多出附录III 选项）。

## 🆕 2026-07-03 — 保护名录 增量③④ + CITES/GRIIS 数据(A) 全部完成 (DONE code, tsc EXIT=0; 两迁移待应用, 地图未真机)
接续 handoff 的 A/B/C 三块，用户选「自动抓取」拿 A 的数据。全部完成：
- **B 增量③ 草稿保护名录徽章卡**（plant-html-template.ts + conservation.ts + identify-plant.functions.ts）：
  conservation.ts 新增 `conservationBadges(hit,lists)`→`{kind,label}[]`（复用 CITES/GTS/GRIIS 选项 label）。
  模板 `PlantDraftFields.conservation?` + `{{conservation_card}}`（在 `{{invasive_card}}` 之后、Section I 之前）+
  `.conservation-card` CSS（绿金调，chip 按 kind 上色：protected 绿/cites 蓝/gts 金/griis 红；含暗色）。
  renderDraftHtml 有命中才出卡片，否则空串（非命中草稿字节不变）。submitPlantDraft 拿学名后用 supabaseAdmin 查
  conservation 两表→buildConservationMatcher→conservationBadges，best-effort try/catch 非致命，传入 renderDraftHtml。
  **验证**：bun 渲染四类 chip 齐全/未命中不出卡/占位无残留/位置正确；pixelshot 截图确认暗色卡视觉 OK。
- **C 增量④ 地图 国家/省级重点保护 标记+筛选**（explore.tsx）：新增 useQuery `["conservation-data"]`→客户端
  buildConservationMatcher 对每个 sighting 学名算 `consStatus` Map（protected/griis/label）。新增金色盾牌
  `PROTECTED_MARKER_HTML` + `protectedOnly` 开关（金色，仅 protectedCount>0 显示）+ 侧栏图例。marker 优先级
  入侵红三角>重点保护金盾>绿点；cluster 同理（红>金>绿 + ⚠/🛡 角标）；popup 加金色「🛡 {名录名}」徽章；列表项 emoji
  三态。入侵判定改 `isInvasiveSighting`=s.is_invasive||本地griis 命中；两筛选 union。**地图视觉需真机**（沙箱无
  AMap key/dev）。
- **A CITES/GRIIS 数据自动抓取**（scratch/gen_cites_griis.py）：
  - **GRIIS（真实数据）**：GBIF 托管 GRIIS-China 数据集(6d11211b…) 导出 **450 植物种**（kingdom=Plantae,rank=SPECIES），
    入侵等级取 SpeciesProfile.isInvasive：Invasive→`invasive`(243)，其余→`established`(206)。GBIF 版**无** casual/
    widespreadInvasive 四级，故仅两级（source_note 已说明）。去重后 **449 种** → `20260703220000_seed_griis_china.sql`。
  - **CITES（精选整科/属，中国相关）**：cites.org 403、WebSearch ECONNRESET（GFW），改用高置信度稳定名录：整科
    Cactaceae/Cyatheaceae II、整属 Cycas/Nepenthes/Aquilaria/Dalbergia/Taxus/Aloe(除 A.vera)/17 个兰科属(II)+
    Paphiopedilum(I)、种级 Cibotium barometz/Cistanche deserticola/Dioscorea deltoidea/Podophyllum·Sinopodophyllum
    hexandrum/Rauvolfia serpentina(II)/Saussurea costus(I)，共 **35 条** → `20260703210000_seed_cites_china.sql`。
    多肉大戟属、人参（仅俄种群）等无法按学名精确区分的**故意不纳入**（source_note 已说明，非全量清单）。
  - 两 seed 幂等（DELETE by kind 再 INSERT）、excluded_names 用 ARRAY[..]::text[]/NULL::text[]，已 append 到
    `supabase/APPLY_ALL_conservation.sql`。matcher 端到端 bun 验证：Aquilaria→II、Paphiopedilum→I、Aloe vera→无(除外)、
    Cibotium barometz→II、Solidago canadensis→invasive、Avena sterilis→established、Ginkgo→一级、Rosa→无。
- **⛔ GTS 仍阻塞（未捏造）**：全球树木红色名录的种级 CR/EN/VU 需 BGCI GlobalTreeSearch/GlobalTree Portal 数据申请，
  无免费机读中国子集；不臆造种级濒危等级。**下次**：请用户提供 BGCI 导出/xlsx，或用 IUCN token 拉中国乔木评估。
- **验证**：tsc --noEmit EXIT=0。**USER ACTION**：Supabase SQL Editor 应用 `20260703210000`(cites 35) +
  `20260703220000`(griis 449) 两迁移（或直接跑 APPLY_ALL）。应用后 /plants 的 CITES/GRIIS 筛选亮起；/identify 拍受
  管制/入侵种→草稿出「保护与名录收录」卡；/explore 出金盾「只显示重点保护物种」开关。然后 build+deploy(VPN)。

## 🆕 2026-07-03 — 保护名录 增量②完成(8名录) + 声明框/目录页末功能 (DONE code, tsc EXIT=0; 迁移待应用, 未真机渲染)
用户上传 xlsx(6省名录) + 大 UI 需求。全部实现：
- **数据(8 个 protected 名录, 共 1059 taxa)**：国家(495)/海南(205) + xlsx 生成的 云南(77)/内蒙古(130)/四川(19)/广东(39)/
  贵州(56)/福建(38)。生成器 `scratch/gen_from_xlsx.py`(读 总表+来源, 条目类型→rank, source_note 来自来源sheet)。
  迁移：`20260703150000`~`200000`_seed_{yunnan/neimenggu/sichuan/guangdong/guizhou/fujian}.sql。福建这次是**真省级独有种**
  (跟之前便民库那份国家子集不同)，纳入。4 个属级条目(云南蝴蝶兰/万代兰/槽舌兰/杧果属)excluded_names 留空(备注)。
- **schema**：conservation_lists 加 `source_note`(声明框文案)列(120000 CREATE + 防御 ALTER IF NOT EXISTS)；types.ts 同步。
  国家/海南 seed 补 source_note，**海南特殊括号说明**已按用户原文加(非兰科206种+所有兰科除国家名录外全纳入)。
  conservation.ts fetch 补 scientific_name/chinese_name/source_note/source_url，ConservationList/Taxon 类型同步。
- **UI(plants.index + filter-dropdown)**：
  ① FilterDropdown 加 `onOptionHover` + option.hover{text,anchorId}；② 「国家和各省重点保护目录」和「归类标签」两下拉
  悬停某项→顶部**声明框**(保护目录显示 source_note；标签显示 由谁/何时/参考资料=description)；③ 点击其它筛选(setParam)→
  声明框消失；④ 点击声明框→scrollToId 跳到页末对应目录锚点；⑤ **页末目录区**：按 protectedListRank 顺序渲染 8 个
  `#dir-<listId>` 目录(完整名单，**本站已收录=深色可点链到植株/未收录=浅色**，右上「↑回到筛选栏」→#filter-bar)，
  之后 `#tag-<slug>` 用户标签目录(最末，显示编辑/时间/参考，列出标签内植株)。filter-bar 加 id+scroll-mt。
- **验证**：tsc EXIT=0。**未真机渲染**(沙箱跑不了 dev)。**USER VERIFY**：应用全部迁移(建表 120000 + 130000~200000 共 8 seed)
  后 `npm run dev` /plants：下拉悬停出声明框、点击跳目录、目录着色、回到筛选栏；海南声明框含特殊括号。
- 备注：内蒙古是 2009 草原野生植物名录(131→去重130)，范围与其它省不同；个别源学名拼写(如 Ephrdra sinica)按源保留。

## 🆕 2026-07-03 — 保护名录 增量②·省级灌库开始：海南2024 完成 (DONE data; 迁移待应用)
- **通用省级 seed 生成器** `scratch/gen_province_seed.py`：吃 TSV(`zh<TAB>sci` 或 `FAMILY<TAB>中文科<TAB>拉丁科`)→
  生成 conservation_lists(protected,省,版本)+conservation_taxa(status='省级'，省级无一级/二级)。学名归一化与国家一致(变音符折叠、
  首两词、× 折叠)、自动去重。
- **海南（2024）已完成**：`supabase/migrations/20260703140000_seed_hainan_2024.sql`，205 taxa(203 种 + 红树科/兰科 2 个 family 组)。
  源：海南省政府 2024-10 docx（web_fetch 直接抓到 docx 全文）。3 条近重复自动去掉（Begonia handelii/palmata 的变种、
  两个 Sonneratia × 杂交种归一化撞键）。原始 TSV 存 `scratch/hainan2024_raw.tsv`。
- **福建 = 国家名录子集，已决定跳过**：lyj.fujian.gov.cn 便民库那页「福建省国家和省重点保护野生植物名录」实为
  **国家名录 + 福建自然分布的 130 种/变种子集**（把国家的属组落到具体种，如 Huperzia chinensis 等），**无省级独有种**。
  这些都已被国家 matcher（属组）覆盖 → 建独立福建名录零新增可匹配 taxa → **跳过**，不重复灌。
- **⛔ 剩余省级数据获取受阻（已按 cap-retries 规则停手）**：
  - **云南（2023，107种）**：官方名录是**一整张长 PNG**（lcj.yn.gov.cn/uploadfile/s37/2023/1219/20231219063522828.png，
    662×4563）。可 OCR 但需多张 zoom 分条读，成本高易错。
  - **内蒙古 / 四川 / 广东 / 贵州**：web_fetch 返回空(JS 渲染)，且 **Chrome 里 sthjt.sc.gov.cn 与 wpca.org.cn 直接报
    error page**（大概率用户端 GFW/ECONNRESET 网络抖动，与项目老问题同源）。四川仅 19 种。
  - **福建已定跳过**（国家子集，无独有种）。
- **建议下次的取数策略**（避免 token-burn）：优先请**用户直接提供这些省级名录文件**(docx/xlsx/txt/pdf) → 用
  `gen_province_seed.py` 秒级入库（海南就是这么做的，最可靠）；或按需 OCR 云南那张 PNG；内蒙古对本站最重要，页面能通时优先。
- **当前可交付**：建表 `20260703120000` + 国家 `20260703130000`(495) + 海南 `20260703140000`(205) 三个迁移可直接应用。
  之后再做 CITES/GTS/GRIIS 中国子集 + 增量③上传/AI 自动匹配 + 增量④地图标记。

## 🆕 2026-07-03 — 保护名录 增量②·国家2021 seed 完成 + 属级匹配引擎 (DONE code, tsc EXIT=0, Python 验证; 迁移待应用)
**国家2021 名录已生成为完整 seed 迁移，属级匹配引擎已建 + 验证。**
- **数据**：`scratch/nat2021_raw.txt`（我从 gov.cn PDF 抓取并**逐条 un-wrap 成单行**的原始名录）→ `scratch/parse_nat2021.py`
  解析 → **`supabase/migrations/20260703130000_seed_national_2021.sql`**（495 taxa）。
  **计数与官方完全吻合**：455 种 + 40 类；一级 58（官方 54种+4类）、二级 437（官方 401种+36类）。幂等（先 DELETE 国家 protected 再插）。
- **rank 分布**：species 455 / genus 36 / family 1（桫椤科）/ **section 3**（Camellia sect. Chrysantha、Camellia sect. Thea、
  Paeonia sect. Moutan）。section 组**故意不参与匹配**——否则会把普通山茶/牡丹/芍药误判为国家保护（已验证 Camellia japonica、
  Paeonia lactiflora 现在=(none)）。「所有种 spp.」属级条目用 rank='genus'，「除外」项进 `excluded_names`（缩写 K./C./P. 已按组属名展开）。
- **匹配引擎**（`src/lib/conservation.ts`）：`fetchConservationData()` + `buildConservationMatcher()`——rank 感知：
  species 全名等值 / genus 属名匹配且排除 excluded_names / family 拉丁科名匹配。`normalizeSciName`（catalogs.ts）**加了变音符折叠**
  （Isoëtes→isoetes，两侧一致）。plants.index 的 CITES/GTS/GRIIS 过滤已改用该 matcher（真实生效，待各自数据灌库）。
- **Python 端到端验证**（scratch/verify_match.py 思路）：Ginkgo biloba→一级；Huperzia serrata→二级(属级)；Cymbidium
  lancifolium/Keteleeria fortunei→(none)（除外生效）；Isoetes sinensis→一级（折叠生效）；Camellia japonica/Paeonia lactiflora→(none)。
- **顺带修 bug**：增量① 遗留的地区快捷 chip 仍用 `r:` 前缀 → 已改为纯 label（否则点击筛不出）。
- **已知小限制**：①infraspecific 收敛——var./subsp. 条目按前两词归一（如 大叶茶 Camellia sinensis var. assamica → 命中
  Camellia sinensis），会让指名种也命中，属可接受近似；②family 级匹配需 plant 带**拉丁科名**（站内 plant.family 多为中文 →
  桫椤科那 1 条基本只能靠属级实拍命中）。
- **✅ 下拉接法已定=A（已实现，tsc EXIT=0）**：「国家和各省重点保护目录」下拉现读 **conservation_lists(kind=protected)**
  （value=list id，label=list.name，按 protectedListRank(province) 排序），过滤走 rank 感知 matcher 的 protectedLists 成员。
  原 regional_catalogs 自建名录功能**未删、迁到独立 `rcat` 参数**：保留「地区植物名录（自建）」chip 区 + RegionalCatalogPanel
  （chip 点击 setParam('rcat',label)，面板按 rcat 显示）。region∩tag∩rcat∩conservation∩条目类型 取交集。空态文案分「保护目录/地区/标签」。
  注意：应用国家 seed 前该下拉为空（protectedLists 空）；应用后出现「国家（2021）」。
- **USER ACTION**：Supabase dashboard 依次应用 `20260703120000_conservation_registries.sql`（建表）→
  `20260703130000_seed_national_2021.sql`（灌国家名录）。应用后 conservation_taxa 有 495 行。
- **NEXT**：接省级名录 seed（内蒙古/海南2024/广东/福建/云南2023/贵州/四川2024）→ CITES/GTS/GRIIS 中国子集 → 定「保护目录」下拉接法。

## 🆕 2026-07-03 — 保护名录 增量② 灌库进行中：国家2021已抓取 + schema 精化 (code tsc EXIT=0; 迁移待应用)
**关键进展 & 设计修正**：
- **数据获取方法确认可行**：`mcp__workspace__web_fetch` 直接抓 gov.cn 名录 PDF 附件 → 返回**完整可解析全文**
  （中文名/学名/一级二级/备注）。国家2021名录 URL：
  https://www.gov.cn/zhengce/zhengceku/2021-09/09/5636409/files/12887ada7c174d199e7ecd8996d07340.pdf
  （18页，455种+40类；* 号=农业农村部管辖，其余林草管辖）。**未落盘，下次直接重抓再生成 seed**。
- **重要设计修正**：国家+省级保护名录**改放 conservation 表**（不再用 regional_catalogs）。原因：①名录条目带
  **一级/二级等级**，catalog_entries 无等级字段；②大量条目是**属级/科级「所有种 spp.」**+「除外」排除项，需要
  rank 感知匹配；③conservation_taxa 无 created_by，种子迁移好灌（regional_catalogs 的 created_by/added_by NOT NULL
  会卡种子）。已改迁移：conservation_lists.kind 增 `'protected'` + 加 `province` 列；conservation_taxa 加
  `rank('species'|'genus'|'family')` + `excluded_names text[]`（装「除外」项）。types.ts 同步。tsc EXIT=0。
- **⚠️ 连带返工（下次做）**：增量① 把「国家和各省重点保护目录」下拉接到了 regional_catalogs，现需改接
  conservation_lists(kind='protected')；regionPlantSlugs 的匹配也要改成按 conservation_taxa 的 list 成员 + rank
  感知（属级=按 genus 前缀匹配、排除 excluded_names）。regional_catalogs 恢复其原本「用户自建地区名录」用途。
- **NEXT（下次继续灌库）**：①重抓国家2021 PDF→生成 conservation_lists(protected,国家,2021)+conservation_taxa seed 迁移
  （注意 spp. 属级条目 rank='genus'、除外项进 excluded_names）；②七省级名录逐个抓取入库；③CITES 中国子集；
  ④GTS 中国树种子集；⑤GRIIS 中国名录；⑥改 plants.index 区域下拉+匹配读 conservation(protected)、加 rank 感知匹配。
  之后才是 增量③上传/AI草稿自动匹配、增量④地图标记。

## 🆕 2026-07-03 — 保护名录多源匹配 增量①b 标签微调 + 增量② 数据基座 (DONE code, tsc EXIT=0; NOT deployed, 迁移待应用)
**用户拍板**：CITES/GTS 只做**中国相关子集**；名录数据存 **Supabase 表**。
**增量①b 标签微调**（conservation.ts / plants.index.tsx / catalogs.ts）：
- 「华盛顿贸易管制」→「国际贸易管制」；CITES 选项文案 →「CITES 附录I」「CITES 附录II」。
- 「GRIIS」下拉标签 →「GRIIS全球入侵等级」。
- IUCN_CATEGORIES 增加 `DD·数据缺乏`（改 catalogs.ts，全站编辑/批量/标签页同步生效，非仅筛选）。
**增量② 数据基座（schema + 匹配，零数据也 tsc 干净）**：
- **设计决策**：国家+省级重点保护名录**复用现有 regional_catalogs/catalog_entries**（「国家和各省重点保护目录」下拉
  已指向它、matching 已有）；**新 conservation_lists + conservation_taxa 只装 CITES/GTS/GRIIS 三类**（其余未建模的登记）。
- 迁移 `supabase/migrations/20260703120000_conservation_registries.sql`：conservation_lists(kind cites/gts/griis,
  name,version,effective_date,source_url) + conservation_taxa(list_id FK, scientific_name, normalized_name[索引],
  chinese_name, status)。RLS：世界可读、admin 可写（private.has_role）。status 语义随 kind：cites=I/II、gts=CR/EN/VU、
  griis=casual/established/invasive/widespreadInvasive。
- types.ts 手加 conservation_lists / conservation_taxa（Row/Insert/Update + FK relationship）。
- conservation.ts 加 `fetchConservationStatusMap()`：两查询(lists+taxa) JS 内 join → Map<归一化学名, {cites?,gts?,griis?}>，
  **空安全**（表空则空 Map）。plants.index conservationIds 改为用该 Map 按 normalizeSciName(p.scientific_name) 匹配
  （替换原占位的 p.field 读取）；新增 useQuery `["conservation-status"]`。
- **验证**：tsc --noEmit EXIT=0。
- **USER ACTION**：Supabase dashboard 应用 `20260703120000_conservation_registries.sql`（建两表；不应用则
  fetchConservationStatusMap 查询报错→CITES/GTS/GRIIS 筛选无结果，但页面其余不受影响）。
- **NEXT 增量②数据灌库（我来做，分批）**：①国家2021→regional_catalogs+catalog_entries；②省级(内蒙古/海南2024/广东/
  福建/云南2023/贵州/四川2024)同上；③CITES 中国相关子集→conservation_taxa(kind cites)；④GTS 中国树种子集(kind gts)；
  ⑤GRIIS 中国名录(kind griis)。每批做成可在 dashboard 应用的 seed 迁移(INSERT)。**增量③**上传自动填写+AI草稿匹配展示。
  **增量④**地图 GRIIS+国家名录标记点+筛选。

## 🆕 2026-07-03 — 保护名录多源匹配 增量①：档案检索筛选栏改造 (DONE code, tsc EXIT=0; NOT deployed, 未真机渲染)
用户大需求：AI 识别/上传自动命中七类名录（国家+省级重点保护 / IUCN / CITES / GTS 全球树木红色名录 / GRIIS）。
架构决策（已问用户拍板）：**七类全部存本地表**（conservation_lists + conservation_taxa，按规范化学名匹配，不实时
联网）；**先做「档案检索筛选改造」增量**，数据入库/上传自动填写/AI草稿匹配/地图标记为后续增量。
本增量只改 `src/routes/plants.index.tsx` + 新建 `src/lib/conservation.ts`（零迁移、零后端）：
1. **拆分**原「地区名录/归类标签」合并下拉 → 两个独立下拉：「国家和各省重点保护目录」(region，来自 regional_catalogs，
   用 conservation.ts `protectedListRank` 排序 国家→内蒙古→海南→广东→福建→云南→贵州→四川) +「归类标签」(独立 `tag` param)。
   search schema 新增 `tag/cites/gts/griis` 参数。
2. **IUCN 下拉去掉「未填写」**(__unrated__)；filteredMetadataIds 去掉该分支。
3. **新增三个下拉**（选项集中在 conservation.ts）：华盛顿贸易管制 CITES(附录Ⅰ禁止国际贸易/附录Ⅱ需办理进出口许可)、
   GTS(CR/EN/VU)、GRIIS(Casual偶现·未建群/Established无明确生态危害证据/Invasive入侵物种/Widespread Invasive高危入侵)。
   GRIIS value 用 Darwin Core degreeOfEstablishment 字面值，给后续 GBIF/GRIIS 直接对接留口。
4. **过滤管线**：新增 conservationIds memo（客户端按 p.cites_appendix/gts_category/griis_degree 匹配，**这些字段
   plantsMetadata 现在还没有 → 选中即空集，不崩不误匹配**，数据增量把字段塞进 metadata 即自动生效）；plantIdsFilter
   改为「所有生效 id 约束集合取交集」(region∩tag∩条目类型∩conservation)；regionPlantSlugs 也改成 region 与 tag 同时
   选中时取交集（原为二选一）。
- **验证**：tsc --noEmit EXIT=0。**未真机渲染**（沙箱 esbuild=macOS arch 跑不了 dev）。
- **USER VERIFY**：`npm run dev` → /plants 筛选栏出现 国家和各省重点保护目录/归类标签/科/属/IUCN/华盛顿贸易管制/GTS/
  GRIIS/条目类型；IUCN 无「未填写」；现有 region/tag/IUCN 过滤不回归；CITES/GTS/GRIIS 暂无结果（待数据增量）。
- **NEXT 增量②** conservation_lists+conservation_taxa 迁移+匹配函数+七源数据入库（需用户给 CITES/GTS/国家/省级数据文件；
  IUCN/GRIIS 可从 GBIF 拉）。**③** 上传自动填写+AI草稿自动匹配展示。**④** 身边物种地图给 GRIIS+国家重点保护各加标记+筛选。

## 🆕 2026-07-03 — 外来入侵物种功能 CP1：GBIF/GRIIS 检查 + 草稿警示卡片 (DONE code, tsc EXIT=0, 渲染验证; NOT deployed, 迁移待应用)
用户需求：整合 GBIF/GRIIS 数据强化入侵物种识别。AI 识别到中国外来入侵物种时，草稿在 section I 前插入
「重要警示卡片」（中国入侵状况 / 生态危害 / 管控防治）；地图后续用三角图标标记 + 只看入侵筛选（Task #4 未做）。
**关键平台事实（已用 curl 实测确认）**：
- 判定「中国入侵」= GBIF `species/{key}/distributions` 里存在 `country=="CN"` 且 `source` 含
  "Global Register of Introduced and Invasive Species"（GRIIS 中国名录，datasetKey 6d11211b-caa0-4e63-b99c-e944099d5017）。
  注意：establishmentMeans 是 "INTRODUCED"（GBIF 无 "INVASIVE" 值）——GRIIS-China 成员身份本身即入侵信号。
- 实测：Ginkgo biloba/银杏→非入侵；Solidago canadensis/加拿大一枝黄花→入侵 ✓。无需 API key。
**本 CP 完成（Deliverable A）**：
1. `identify-plant.functions.ts`：新增 `timeoutJson()`、`gbifCheckInvasive(拉丁名)`（返回 {isInvasive,taxonKey,source}，
   网络失败返回 null=未知，权威非入侵返回 isInvasive:false）、`generateInvasiveCard(title,sci)`（LLM 生成三段中文文案，
   走 xiaopTextCall+schema，默认 Gemini；反编造提示）。
2. `plant-html-template.ts`：PlantDraftFields 加 `invasive?{status_zh,harm_zh,control_zh,source?}|null`；
   TEMPLATE 在 hero `</section>` 与 section I 之间插 `{{invasive_card}}`；加 `.invasive-card` 红色危险卡 CSS（含暗色）；
   renderDraftHtml 构建卡片（有内容才输出 `<section>`，否则空串——非入侵草稿字节不变，已 bun 实测四种情况）。
3. `submitPlantDraft`：拿到学名后 try/catch 调 gbifCheckInvasive→若入侵再 generateInvasiveCard→传入 renderDraftHtml；
   **全程非致命**（任何失败仅跳过卡片/标记，不影响识别落库）。insert 后**单独 best-effort UPDATE** 写
   `is_invasive/gbif_taxon_key`（与主 insert 分离，迁移未应用也不会挂）。返回值加 isInvasive。
4. **迁移** `supabase/migrations/20260703000000_invasive_species.sql`：plant_drafts 加 `is_invasive bool default false`
   + `gbif_taxon_key bigint` + 部分索引。types.ts 已手改（Row/Insert/Update 三处）。
- **验证**：tsc EXIT=0；bun 渲染 renderDraftHtml → 卡片在 section I 前、占位符已替换、非入侵不出卡片；
  pixelshot 截图确认红色三卡视觉正确（暗色）。预览文件 /tmp/draft-invasive-preview.html。
- **USER ACTION**：①Supabase dashboard 应用 20260703 迁移（否则 is_invasive 写入被跳过，卡片仍正常——卡片不依赖 DB 列）。
  ②真机 /identify 拍一株入侵种（如加拿大一枝黄花）确认草稿出警示卡。③然后 `npm run build && wrangler deploy`（VPN）。
## 🆕 2026-07-03 — 外来入侵物种功能 CP2：地图三角标记 + 只看入侵开关 + GBIF 分布叠加层(C) (DONE code, tsc EXIT=0, 数据路径实测; 地图视觉需真机验证; NOT deployed)
Task #4 完成（代码）。三处文件：
1. `drafts.ts`：GeoSighting 加 `is_invasive`+`gbif_taxon_key`；fetchGeoSightings **两段式容错**——先带新列查，
   若 20260703 迁移未应用（列不存在）则回退基础列（is_invasive 默认 false），**地图永不因缺列而崩**。
2. `identify-plant.functions.ts`：新增 `gbifChinaOccurrencesFn`（createServerFn POST，design C 服务端代理）：
   taxonKeys[]→逐个 `occurrence/search?country=CN&hasCoordinate&hasGeospatialIssue=false&limit=300`→
   丢弃 coordinateUncertainty>1km、按 ~110m 网格去重、每种上限 250。**无永久存储**（仅客户端 query 缓存）。
   已用 bun 对 live GBIF 实测：加拿大一枝黄花+豚草→206 点、全在中国 bbox 内、粗点已剔除。
3. `explore.tsx`：①INVASIVE_MARKER_HTML 实心红三角(白!)、GBIF_MARKER_HTML 淡色空心小三角、gbifClusterHtml；
   ②state `invasiveOnly`；memo `mapSightings`(入侵过滤)/`invasiveCount`/`invasiveTaxonKeys`；
   ③懒加载 useQuery `["gbif-cn-occ",keys]`（enabled=invasiveOnly&&keys.length，staleTime 30min）；
   ④marker 渲染用 mapSightings，单点入侵→三角、聚合含入侵→红底+⚠、zIndex 抬高；
   ⑤**新 overlay effect**：GBIF 点 wgs84→gcj 逐点转换、getBounds 视野裁剪、复用像素聚合(OVERLAY_PX=14)、
   非交互、zIndex 6(压在实拍点下)、渲染上限 1200、zoomend+moveend 重算；
   ⑥侧栏「⚠️ 只显示外来入侵物种分布」开关(红) + 图例说明(实心=实拍/空心=GBIF参考、载入态、点数)；
   ⑦列表项入侵用红⚠️、popup 加「⚠️ 外来入侵物种」红徽章。
- **验证**：tsc EXIT=0；GBIF 两条 API 路径均 live 实测；卡片 pixelshot 截图。**地图视觉(三角/坐标对齐/开关/叠加层)
  无法在沙箱验证**——需真机 npm run dev + VITE_AMAP_KEY + 有入侵数据的库。
- **USER ACTION（合并 CP1+CP2 一起验证部署）**：
  ①Supabase dashboard 应用 `20260703000000_invasive_species.sql`（加 is_invasive/gbif_taxon_key 列）。
  ②真机 /identify 拍一株入侵种（加拿大一枝黄花/豚草/一年蓬等）→ 确认草稿 section I 前出红色警示卡 + 该记录
    落库 is_invasive=true。③/explore：该点显示为红三角；点侧栏「只显示外来入侵物种分布」→ 只剩入侵点 +
    地图叠加 GBIF 淡色三角分布；确认坐标对齐、开关切换正常、默认开图速度不受影响（叠加层懒加载）。
  ④`npm run build && wrangler deploy`（VPN）。
- 注意：卡片功能**不依赖** DB 列（迁移没应用也能出卡片）；只有「地图三角标记/只看入侵」依赖 is_invasive 列（回退已保证不崩）。

## 🆕 2026-07-01 — 小P蛙 CP2：确定性换图 + 停止键 + 透明面板根因修复 (DONE code, tsc EXIT=0, preview-verified; NOT deployed)
用户反馈 CP1 三问题：①改图仍无法进行 ②任务中无停止键 ③移动端仍与正文重叠。逐一解决：
1. **③根因找到并修复（真 bug，非未部署）**：`src/styles.css` 的 `@theme` 里**从未映射**
   `--color-paper/--color-paper-deep` → 全站 `bg-paper*` 类静默失效 → 小P蛙面板背景一直是
   **透明**的（桌面端因正文被推开看不出来；移动端就是"和正文重叠"的直接原因）。补两行映射，
   全站 bg-paper 生效。**已本地移动视口(375×812)截图验证**：底部抽屉实心纸色、遮罩、圆角、把手 ✓。
2. **①换图改为「确定性替换」，不再经过大模型**：新组件 `src/components/replace-image-flow.tsx`
   （ReplaceImageFlow）：第一步从当前 HTML 枚举 `<img>` 网格点选要换哪张 → 第二步 ImageSearchDialog
   （加了可选 `onUploadFile` prop = **📁本地上传**按钮，compressImage→uploadAssetFn→plant-images 桶）
   → 代码直接 `html.split(oldSrc).join(newSrc)` 替换保存。草稿页（saveDraftHtml+logDraftEdit
   kind=draft_image）与详情页（新抽 `persistPlantHtml()` 复用上传/repoint/plant_edits 落库；
   applyXiaoP 文字改写也改用它）都接好。面板底部加**常驻「🖼 换配图」按钮**（canApply 时显示），
   不再依赖模型返回 imageEdit 意图；模型建议换图的旧路径也统一走此流程。旧 onXiaoPPickImage
   （LLM 重写换 src）已删。
3. **②停止键**：draft-agent-panel 加 `seqRef` 序号；发送/采纳中→发送键变红色**停止方块**，点击丢弃
   迟到结果并提示（采纳中停止会注明"服务器若已完成仍可能已保存，可去修改记录撤销"）。
- 详情页新增 `rawHtml` state（复用既有 fetch）供换图流程。
- **NEXT — USER VERIFY**：本机登录编辑账号 → 面板底部见「换配图」→ 点选图→搜图/本地上传→替换保存；
  手机（或窄窗口）确认底部抽屉不再透字。然后 `npm run build && wrangler deploy`（VPN）。
- 剩余待做：#3 annotation 精度（把选中节真实内容喂给模型）+ 草稿页 annotation。
- **CP2b 追加（同日）**：用户报「问配图问题易报错 This operation was aborted」= 我们自己的超时
  中断。MiniMax-M3 推理+看图常超 60s。修复（identify-plant.functions.ts）：openaiCompatChat
  60s→**120s**、geminiChat 45s→**120s**；**超时不再重试**（慢模型重试=白等一倍）；AbortError 映射为
  中文提示「小P响应超时…可换更快的视觉模型」。tsc EXIT=0。超时路径无法在预览里复现，用户实测。

## 🆕 2026-07-02 — CP4：小P蛙记忆 + 介绍文案 + 草稿名/摘要 (DONE code, tsc EXIT=0, 本地验证; NOT deployed)
1. **逐页聊天记忆**（draft-agent-panel.tsx）：新增 `storageKey` prop；messages 用 `loadChat/saveChat`
   存 **sessionStorage**（key=`xiaop-chat:<storageKey>`，保存时剥离 transient `applying`）。宿主传
   key：drafts.$id `draft:${id}`、plants.$slug `plant:${plant.id}`。离开路由（组件卸载）再回来对话恢复。
   **已本地验证**：发消息→存入 sessionStorage→跳首页→回草稿→气泡恢复。注意：sessionStorage 关标签页
   即清（若要跨浏览器重启保留，改 localStorage）。
2. **介绍文案**改为用户指定版：「我是你的博物小助理，默认使用 Gemini 2.5 Flash…齿轮配置…换图在输入框下方」。
   自适应：配了自有模型则显示「当前使用你配置的『<model>』作为我的大脑」。输入框下方「换配图」按钮此前已存在，
   文案指向真实控件。已本地验证渲染正确。
3. **草稿名不带「— Plantspedia」**：plant-html-template.ts `<title>` 去掉 ` — Plantspedia`（唯一一处；
   用户"保存在本地"下载后标签页即显示纯植物名）。
4. **摘要改博物学家口吻**：identify-plant.functions.ts systemPrompt 的 summary_zh 规格重写——150–260 字、
   博物学家兼科普博主口吻、讲**与生活相关的趣闻/要闻/冷知识/资讯**，**明令不要罗列科属/学名/形态/生境、
   不复述拍摄记录**（修"摘要和拍摄记录重复"）；summary_en 同步。「疑似」行为保留。需真机拍一张看摘要风格。

## 🆕 2026-07-02 — 草稿配图：section 改用网络实拍图 (DONE code, tsc EXIT=0, 本地验证; NOT deployed)
需求：AI 识别草稿的配图——第一张(hero)用用户实拍照片，后面 5 个 section 全部换成联网找到的该物种
实拍图。之前 hero + 5 section 全部重复用同一张 `{{photo_url}}`。改法：
- `plant-html-template.ts`：5 个 section 图从 `data-default-img="1" src="{{photo_url}}"` 改为
  `{{sec_img_N_mark}} src="{{sec_img_N}}"`；`PlantDraftFields` 加 `section_images?: string[]`；
  renderDraftHtml 填 `sec_img_1..5 = section_images[i] || photo_url`，**有网络图则不打 default 标记**，
  空缺回退用户照片并保留 `data-default-img`（编辑仍会看到"可点击替换"提示）。attr 引号转义。
- `identify-plant.functions.ts`：新增服务端 `fetchSpeciesPhotos(term,n)`（iNaturalist research-grade 按票数
  → GBIF → Wikimedia，去重、每源 8s 超时、绝不抛错、返回 ≤n 个大图 URL）。submitPlantDraft 在 renderDraftHtml
  前用**拉丁双名**(genus species，回退英文/中文名)搜 5 张，try/catch 包裹（失败=退回旧行为）。
- 验证：本地调 renderDraftHtml——hero 恒为用户照片；3 图时 section1-3=网络图无标记、4-5 回退+DEFAULT；
  0 图时 5 个全回退+DEFAULT（同旧行为）。curl iNaturalist 确认返回真实大图、`/large.` 转换生效。
- 注意/待办：section 图是**外链热链**(iNat S3/GBIF/Wikimedia，与既有换图功能同源)；未内联署名——
  草稿经编辑审核后才发布，licensing 由编辑把关。图是外部 URL 非存我们桶（省存储、与现状一致）。
  **USER VERIFY**：真机 /identify 拍一张 → 草稿后面 section 显示不同的物种网络实拍图。然后部署。

## 🆕 2026-07-01 — CP3：移动端面板 + 徽章图标 (DONE)
1. **移动端小P蛙面板透明度 —— 用户先要 50%，后又要求撤销 → 现为不透明**。最终态：面板 opacity=1
   （纸色实心不透字）、遮罩 bg-black/40（标准模态压暗）。已本地移动视口验证。
   保留的坑记录：`animate-in`(tailwindcss-animate 的 `enter`)会常驻 animation-name 覆盖 opacity；
   已改为**自定义 keyframes**（styles.css `xiaopSheetIn` 移动端只动 transform / `xiaopDockIn` 桌面右滑
   淡入），fill-mode none 保证不播放时静止态也可见。注意：**预览会冻结 CSS 动画在起始帧**（读 top=812
   屏外是假象），真机正常；验证静止态用 `el.style.animation='none'` 再量。
2. **徽章图标（铜/银/金/资深）替换 SVG ✅ 完成**。用户把源图存到 `scratch/leaf-badges.png`
   （1899×828 RGB，4 连徽章）。`scratch/crop_badges.py`（PIL）：**边缘 flood-fill 抠白底**（不是简单
   白→透明，否则近白的银叶会被挖穿）→ 按内容空白间隙切分（**手动定 cuts=[499,941,1367]**，因为自动
   选最宽间隙会把资深的一个散落星芒切进金叶）→ autocrop → 缩到 96px 高 → FASTOCTREE 64 色量化。
   产物 `src/assets/leaf-{bronze,silver,gold,senior}.png`，**各 ~2.6KB**（原 22KB），透明底。
   leaf-panel.tsx：`LeafIcon` 从 SVG 改为 `<img>` 用这 4 张 PNG（按 height 缩放不变形），`Tier` 加
   "senior"，`levelTier` senior→senior（不再降级 gold）。已本地并排渲染验证 4 图正确+透明+200 OK
   （/profile 需登录未能登录态验证，但隔离渲染确认无误）。tsc EXIT=0。
- **本次 3 项（移动端50%透明 + 超时120s + 徽章图标）合并 NEXT — USER VERIFY + DEPLOY**：
  登录后 /profile 看积分面板 4 档徽章；手机看面板半透明；配图/超时按前述。然后
  `npm run build && wrangler deploy`（VPN）。

## 🆕 2026-07-01 — 小P蛙 大改造 CP1：移动端 + 每用户模型 + 编辑中可用 (DONE code, tsc EXIT=0; NOT deployed)
用户批量需求（5 项）：①图片编辑/选图替换失效需修（含上传本地图）②编辑界面也能调出小P蛙
③annotation 精度差、草稿无 annotation ④移动端弹窗与正文重叠 ⑤弹窗右下加「设置」让每个用户配
自己的模型 API Key（提醒用视觉模型 + 格式示例；未设默认 Gemini）。用户确认：Key 存 **localStorage**（免迁移）、
图片替换 **在线搜图+本地上传两者**、移动端 **底部抽屉(bottom sheet)**。用户当前小P已配 MiniMax-M3（全站 admin config）。
关键发现：**后端 xiaopTextCall 早已支持 per-request `userModel` override**（优先级 用户override > admin site_config
> env Gemini），所以「每用户 Key」纯前端即可（localStorage → 每次 ask/apply 带上）。
**本轮 CP1 完成（含 #2 #4 #5）：**
- 新 `src/lib/xiaop-user-model.ts`：localStorage 存取（key `xiaop_user_model_v1`）+ `userModelArg()` + provider 预设
  （含视觉提示 visionNote）。Key 只存浏览器，不落库。
- 新 `src/components/xiaop-user-settings.tsx`：面板内「模型设置」表单（服务商/Key/模型/BaseURL），
  强提示必须用**视觉模型**、BaseURL 填到 /v1、示例 MiniMax-M3 等；保存/恢复默认/返回。
- `draft-agent-panel.tsx` 改造：①移动端 **bottom sheet**（`inset-x-0 bottom-0 h-[85vh] rounded-t-2xl` + 半透明
  backdrop + drag handle），桌面端仍右侧抽屉（md: 断点切换）；②底部右下加 ⚙️「模型设置」入口 + 显示当前模型
  （「我的」/「站点默认」）；③设置视图 swap 聊天体。
- 后端 `identify-plant.functions.ts`：`askPlantAgentFn`/`applyPlantAgentEditFn` 补 `userModel` 入参 + 传
  `override: toOverride(data.userModel)`（draft 两个 fn 早已有；本轮补 plant 两个 + draft apply 也补上 override）。
- 客户端：`drafts.$id.tsx` + `plants.$slug.tsx` 所有 ask/apply/换图调用带 `userModel: userModelArg()`；
  **drafts 面板去掉 `!isEditing` 门控 → 编辑 HTML 时也能调出小P蛙**（#2）。
- **待办 CP2（#1 图片）**：修 imageEdit 触发不稳（中转模型常不返回 imageEdit=true）+ ImageSearchDialog 加「本地上传」Tab。
- **待办 CP3（#3 annotation）**：把所选 section 的**实际 HTML/文本**喂给模型（提精度）+ 给草稿页加 scopes 范围选择。

### 2026-07-01 追加修复 — 移动端底部抽屉裁切 bug（真 bug，已修，tsc EXIT=0）
用户反馈"手机尺寸不知道怎么打开""看不到⚙️模型设置""编辑界面呼不出小P蛙"。用沙箱本地 `npm run dev` +
浏览器自动化实测复现/排查：
- **编辑界面呼不出小P蛙 / 看不到设置**：核对 `drafts.$id.tsx` 源码，面板本就是无条件渲染（不受 `isEditing`
  门控），逻辑正确；`草稿页无需登录即可看到 launcher` 也已用真实草稿 id 现场验证 launcher + 弹窗 + ⚙️模型
  设置按钮全部正常挂载、可点击。**结论：用户当时看的大概率是尚未重新构建部署的 plantspedia.club 正式站
  （还是老代码），或本地开发服务器未启动/未刷新** —— 不是代码问题，是"还没跑本地看新代码"。
- **但同时揪出一个真 bug**：移动端底部抽屉用了 `h-[85vh]`，用 CDP 模拟 375×812 视口实测：面板底边超出视口
  ~19.5px，导致最下面一行（发送按钮 + ⚙️模型设置）被裁在视口外摸不到 —— 这与用户说的"看不到设置"完全吻合
  （即使部署后在真实手机上也会复现，Safari 移动端 `vh` 本就不算地址栏动态高度）。
  **修复**（`draft-agent-panel.tsx`）：`h-[85vh] max-h-[85vh]` → `h-[85dvh] max-h-[85dvh]`（dvh 已现代浏览器
  普遍支持，随手机工具栏动态收缩，不再算错）；footer 加 `paddingBottom: max(0.625rem, env(safe-area-inset-bottom))`
  防止 iPhone 主屏幕指示条遮住发送/设置按钮。**已用 CDP 模拟 375×812 复测：面板 bottom 精确贴合视口
  812px（原 831.5px 溢出），⚙️模型设置按钮完整落在 786–802px（视口内，安全边距内）**；桌面 370px 右侧停靠
  未受影响（回归测过，370px/right:0/top:64 不变）。
- **NEXT — 用户本机验证**：`tsc`（应 clean）→ `npm run dev` → **务必打开新代码**：浏览器按 F12 开发者工具→
  设备工具栏（Mac 上 Cmd+Shift+M，或右上角"切换设备仿真"图标）→ 选一个手机型号 → 刷新页面，才能看到手机版
  底部抽屉；或直接把桌面浏览器窗口缩窄到 768px 以下也会触发同样的移动布局。确认：①草稿/详情页右下角小P蛙
  弹出为贴底部抽屉、②抽屉最下面一行能摸到「⚙️模型设置」按钮且不被裁切、③点它能填入自己的 Key 保存、
  ④编辑登录后进入 HTML 编辑态，小P蛙 launcher 仍在。全部确认后再 `npm run build && wrangler deploy`。

## 🆕 2026-06-30 (#11) — 上传 failed to fetch 纠正认知 + 重试 (DONE code, tsc EXIT=0; NOT deployed)
**纠正 #10 的乐观判断**：用户在**线上** plantspedia.club/admin/new 上传文件夹仍报 failed to fetch。
根因是**上传方向**：国内浏览器 → Cloudflare 的较大 POST 会被 GFW 重置（与 wrangler deploy 需 VPN 同源），
**与后端在不在墙外无关**——下行(浏览)正常，上行(传文件)被掐。`plant-editor.tsx` 的 `uploadFile`(走 uploadAssetFn,
逐文件 base64 POST 到 Worker) 因此中断。
- 已加：`uploadFile` 对 uploadAsset 调用做 **3 次重试(退避)** + 命中 fetch 失败时给可执行提示（挂 VPN 重试 / 用
  命令行 publish.py 上传）。重试能扛过偶发重置，但大文件夹仍可能需 VPN。
- 用户须知：**浏览/读取线上站零 VPN；但从国内"上传内容"到 Cloudflare 仍建议挂 VPN，或用 publish.py**。

## 🆕 2026-06-30 (#10) — 小P蛙 图去重/更多/本页预览 + 上传报错诊断 (DONE code, tsc EXIT=0; NOT deployed)
1. **参考图去重 + 更多 + 本页预览**（draft-agent-panel.tsx）：
   - 查询去重（大小写不敏感），修"相同物种出图两遍"；
   - 每个 query 取 8 张、组内按 full URL 去重；新增 `dedupGroups()` 跨组按 URL 去重（修"不同物种用同一张图"），
     每组最多 6 张（之前固定 3 张）；
   - 缩略图从 `<a target=_blank>` 改为按钮 → 点击在本页弹出 lightbox 预览（z-60 遮罩），再点图/遮罩/✕ 关闭，
     聊天面板保留在底下。新增 `preview` 状态。
2. **新建条目/批量上传「failed to fetch」= 既有网络问题，非本次代码**。`admin.batch-new.tsx` 上传走
   `uploadAssetFn`(服务端)→supabaseAdmin 存储；图片已 compressImage 压缩。本地 `npm run dev` 时服务端 Node 在
   GFW 内，向 Supabase Storage 的上传被隧道重置 → 浏览器侧报 "failed to fetch"（与早先"照片上传失败：fetch
   failed"同源）。**解法：上传时开 VPN，或部署到 Workers（在 GFW 外）后用线上站上传。** 未改该上传代码。

## 🆕 2026-06-30 (#9) — 修复"嘴上说调图、实际不出图" (DONE code, tsc EXIT=0; NOT deployed)
根因：中转/推理模型只在 reply 散文里承诺"再调出几组参考图"，却不填 showImages/imageQueries → 面板无从触发。
- 新增 `harvestImageIntent(reply)`：当 reply 命中"调出/展示/参考图/比对…照片"等承诺，且模型没给 queries 时，
  从 reply 文本里正则抽取拉丁双名（`Genus species`，最多 4 个）→ 强制 showImages=true + imageQueries。
- 两个 ask handler 都改为 `harvestImageIntent(parseAgentReply(txt))`。这样无论模型守不守 schema，只要它
  在话里点了名（学名），图就会真正出来。仍建议看图功能用默认 Gemini 最稳。

## 🆕 2026-06-30 (#8) — 小P蛙 logo 放大去圈 + AI识别文字 + 多物种对比图 (DONE code, tsc EXIT=0; NOT deployed)
1. **小P蛙 logo**：面板 launcher 从「圆圈套小图」改为直接渲染大图（w-20，去掉圆圈+边框，加 drop-shadow）；
   面板头像同样去圈放大（w-10）。
2. **AI识别**：导航搜索框右侧的 AI识别 logo 右边补上「AI识别」四个字（图+字一起，带待审红点）。
3. **多物种参考图对比**（修复"它说好但没出图"）：AgentReply 增加 `imageQueries: string[]`；提示+schema+
   parseAgentReply 都加；对比多个物种时模型应填 `["Tribulus terrestris","Tripodion tetraphyllum"]`。
   面板按每个 query 分组联网取 3 图、分组带学名标题展示（最多 4 组）。单物种回退 [imageQuery]。
   注意：仍需模型把 showImages 设 true 且填 imageQueries——默认 Gemini 走 schema 最可靠，中转模型可能漏填。

## 🆕 2026-06-30 (#7) — logo 落地 + 导航改版 + 搜索放大镜 + apply 报错优化 (DONE code, tsc EXIT=0; NOT deployed)
1. **真实 logo 已落盘并去白底**：`src/assets/xiaop-logo.png`（蛙形，小P蛙专属）与 `ai-identify-logo.png`
   都用 PIL 边缘连通域 flood-fill 把白底抠成透明（保留主体内部白）。`XiaoPLogo` 组件改为渲染该 PNG（不再 SVG）。
2. **导航改版**：①去掉导航栏里的小P蛙 logo（小P蛙是 agent 专属，不进导航）；②AI识别 logo（ai-identify-logo）
   放到**搜索框右边紧挨着**、所有尺寸可见、点击→/identify、带待审红点；③移除抽屉(折叠栏)里的 AI识别项 +
   桌面端原 AI识别文字链接；④搜索框内部右侧加放大镜按钮（type=submit），Enter 或点放大镜都能搜。
3. **apply「fetch failed」优化**：`openaiCompatChat` 给 fetch 包了 60s 超时 + 1 次重试 + 明确报错
   （提示中转可能因整页体量超时，可在 /identify 把小P模型切回默认 Gemini）。根因多为中转对大 body 重置。
4. **待办（未做，需确认）**：金叶「一键创建物种科普详页」改由小P蛙执行 = Phase 2 重型异步生成
   （STATE 早标注需 CF 队列/Durable Object）。本轮未实现，已在回复中给方案待用户拍板。

## 🆕 2026-06-30 (#6) — 小P蛙 联网取参考图 + 导航 logo 位置 (DONE code, tsc EXIT=0; NOT deployed)
1. **小P蛙 能联网取参考照片发到对话**。复用站内图源（导出 `searchPlantImages(term,limit)` 于
   html-doc-editor，依次 iNaturalist→GBIF→维基共享）。AgentReply 增加 `showImages`；提示+schema+
   parseAgentReply 都加；提示明确"你具备联网取图能力，别再说无法联网/发图"。当编辑要"看几张参考照片比对"，
   模型返回 showImages=true+imageQuery（优先拉丁学名），面板联网取 3 张缩略图内联展示（点开看大图，注明来源）。
   注意：是生物多样性图源（按物种），非通用网图搜索；中文名命中率低时模型应给拉丁/英文名。
2. **导航 logo 位置**：小P蛙 Logo 从登录按钮旁移到**搜索框右边**（site-header）。
   ⚠️ 仍是 SVG 占位 `XiaoPLogo`——用户要换成新上传的蛙形 logo，但附件未落盘（uploads 为空），
   **待用户把 PNG 存入项目后**：去白底→透明 PNG→替换导航与面板里的 logo。给用户的存放路径见回复。

## 🆕 2026-06-30 (#5) — 物种页底部「修改记录」可折叠 + 逐条撤销 (DONE code, tsc EXIT=0; NOT deployed)
需求：草稿页/详情页底部都要有仔细的修改日志（agent 改或编辑改都记），可展开/折叠（默认折叠），
仅编辑可撤销某条。
- 新组件 `src/components/edit-log-section.tsx`（`EditLogSection`）：底部分区，默认折叠，列出每条
  who/when/what（kind 中文标签、小P蛙改动高亮）、已撤销标记；编辑且可撤销的行显示「撤销」按钮。
- **草稿日志（免迁移）**：草稿编辑行复用 plant_edits，用 `block_path = "draft:<id>"` 打标签。
  `logDraftEditFn` 扩展可存 `summary/beforeHtml/afterHtml/source`；新增 `fetchEditsForDraft`（edits.ts）
  与 `revertDraftEditFn`（服务端，编辑限定，用 before_html 还原 plant_drafts.html_content 并标记 reverted）。
  drafts.$id.tsx：agent 文字/图片改写、编辑手动保存、ReplacePhotoDialog 换图 —— 全部带前后快照记录；
  底部渲染 `EditLogSection`（queryKey `draft-edits`）。
- **详情页日志**：plants.$slug.tsx 用 `fetchEditsForPlant`（已存在）渲染底部日志（两种 return 分支都加）。
  撤销路由：`ai_page_edit`（小P蛙整页改写，存全文 before_html）→ 把 before_html 传回 plant-html 桶重指
  html_url + 标记 reverted；其它 block 标记类 → 走既有 `revertEdit`。queryKey `plant-edits`。
- `PlantEdit.kind` union 增加 `ai_page_edit`。
- 备注：草稿日志只对**本次改动后**的新记录生效（历史无 block_path 标签的不显示）。撤销均为编辑/管理员限定
  （UI + 服务端双重校验）。

## 🆕 2026-06-30 (#4) — 小P蛙 自助落地文字 + 在线搜图换配图(方案C) (DONE code, tsc EXIT=0; NOT deployed)
1. **提示词修正**：两处 ask 提示明确告诉模型"你能直接落地文字改动（编辑点采纳即由你改写保存），
   换图会调起站内在线搜图，**不要说交给技术同事/他人**"。解析键名兼容 reply/response/answer 等已具备。
2. **方案C·在线搜图换配图**。AgentReply 增加 `imageEdit`/`imageQuery`（schema+提示+parseAgentReply 都已加）。
   当模型判定诉求是换/补配图 → canEdit+imageEdit=true、imageQuery=搜索词（一般拉丁学名）、editInstruction=说明换哪张。
   - 面板 `XiaoPAgentPanel` 新增 `onImageReplace(query,instruction)` 回调；imageEdit 消息显示「🔍 搜图并替换配图」
     按钮（替代「采纳并保存」）。
   - 详情页 `plants.$slug.tsx` + 草稿页 `drafts.$id.tsx` 都接了：点按钮→打开站内 `ImageSearchDialog`(html-doc-editor)
     →编辑选图→把所选 URL 拼进指令交给 `applyXiaoP`/`applyAgentEdit` 重写该 `<img src>` 并保存
     （详情页写 plant_edits、草稿页 logDraftEdit kind `draft_image`）。
   - 依赖：模型需返回 imageEdit（默认 Gemini 走 schema 可靠；中转模型靠提示+容错解析）。换图仍是"换成某个搜到的
     URL"，不上传本地新文件。

## 🆕 2026-06-30 (#3) — 小P蛙 中转兼容 + 弹窗不再遮挡 (DONE code, tsc EXIT=0; NOT deployed)
1. **对话不再因非 JSON 报错**。中转/推理模型常返回散文或残缺 JSON → 之前 `JSON.parse` 直接抛
   "Unexpected token '根'…"。新增 `parseAgentReply()`（严格 JSON → 正则抽取字段 → 兜底把整段文本当
   reply 显示），`askDraftAgentFn`/`askPlantAgentFn` 改用它。代价：散文回复时 canEdit=false（不出现
   「采纳并保存」按钮），要一键改写请用遵循 JSON 的模型（默认 Gemini 可靠）。
2. **openaiCompatChat 去掉 `response_format:json_object`**（部分中转/reasoning 模型设了它会返回空），
   改为靠系统提示"只返回 JSON"+ cleanJson；兼容性更好。
3. **弹窗桌面端不再遮挡正文**：面板打开时给 `document.body` 加 `padding-right:384px`（仅 ≥768px），
   内容左移、面板落在右侧空出的栏里；窄屏仍为浮层。

## 🆕 2026-06-30 (#2) — 小P蛙 两处修复 (DONE code, tsc EXIT=0; NOT deployed)
1. **弹窗改为右侧停靠**（之前浮在底部正中、遮挡正文）。`draft-agent-panel.tsx` 面板容器
   `bottom/right 浮窗` → `fixed top-16 right-0 bottom-0 w-[370px] max-w-[90vw] border-l`（右侧抽屉，
   slide-in-from-right）。launcher 仍在右下。
2. **小P蛙现在能"看"图片做鉴定**。`identify-plant.functions.ts` 调用链加视觉支持：
   - 新 `InlineImage` 类型 + `fetchInlineImage(url)`（服务端下载图片→base64，≤6MB，失败则纯文本降级）
     + `lastUserIndex()`。`geminiChat/openaiCompatChat/anthropicChat/xiaopTextCall` 都新增可选
     `images` 参数，附到最后一条 user 消息（gemini=inlineData / openai=image_url / anthropic=image block）。
   - `askDraftAgentFn`：select 加 `photo_url`，取访客原图 → `images:[photo]`，system 改为"以照片为准"。
   - `askPlantAgentFn`：取 `cover_url`（或正文首图 `firstHtmlImage`）→ 同样传图。
   - 注意：需配置**支持视觉**的模型（默认 gemini-2.5-flash 支持；纯文本模型会忽略/报错）。

## 🆕 2026-06-30 — 小P蛙 品牌化 + 可配置模型 + 详情页助手 (DONE code, tsc EXIT=0 ~16s; NOT deployed)
Builds on the 06-29 小P work below. **tsc --noEmit clean (EXIT=0).** NOT machine-previewed.
1. **小P蛙 Logo** `src/components/xiaop-logo.tsx` (`XiaoPLogo`) — inline SVG 还原用户上传的绿色
   「ṗ」标志（两点 + 开口 p）。用户上传的图未落盘（uploads 为空），故用 SVG 重绘，可缩放/改色，
   默认绿 #6CB24F。已用 show_widget 目测 OK。
2. **导航栏入口** `site-header.tsx`：右侧（登录按钮左边）加 `XiaoPLogo` 圆形按钮，点击 → /identify。
3. **小P 模型可配置（独立于识别管线）**。`identify-plant.functions.ts`：
   - `geminiTextCall` 重构为 `xiaopTextCall` + 子函数 `geminiChat/openaiCompatChat/anthropicChat`，
     按 `loadXiaoPConfig()`（site_config key `xiaop_model_config`）路由 gemini/openai/custom/anthropic；
     **默认 = .env GEMINI_API_KEY + AI_MODEL**。草稿助手两个调用点已改用 xiaopTextCall。
   - 新 CRUD：`saveXiaoPConfigFn/getXiaoPConfigFn/clearXiaoPConfigFn`（admin-gated，key 独立）。
   - `XiaoPModelPanel`（绿色主题，镜像 AdminModelPanel，queryKey `xiaop-config`）已抽到独立组件
     `src/components/xiaop-model-panel.tsx`（自带 PROVIDERS + 图标），**admin 可见，同时渲染在
     `/identify`（PlantNetPanel 之后）与 `/admin`（编辑台顶部、目录区之前）两处**。
4. **通用面板** `draft-agent-panel.tsx` 重写：导出 `XiaoPAgentPanel`（旧 `DraftAgentPanel` 已移除）。
   launcher = Logo + 标签「小P蛙（Plantspedia AI agent）」固定右下；支持可选 `scopes`（标注范围下拉）；
   父页提供 `ask`/`apply` 闭包。草稿页（drafts.$id.tsx）已改用它（无 scopes）。
5. **详情页助手（编辑限定）** `plants.$slug.tsx`：HTML 类详情页、`canEdit` 时渲染 `XiaoPAgentPanel`。
   - 新服务端 `askPlantAgentFn`（编辑提问，支持 scope=标注）+ `applyPlantAgentEditFn`（整页/范围重写，
     返回 {html, oldHtml}，auth-gated，保留 data-edit-id/lov-edit-mark 标记）。
   - 客户端 `applyXiaoP`：server 改写 → 上传到 `plant-html` 桶（路径 `${uid}/xiaop-<ts>.html`）→ 更新
     `plants.html_url` → 写入**详细** `plant_edits` 记录（kind `ai_page_edit`, source `xiaop_agent`,
     summary 含范围+指令, before_html/after_html 全文）→ 失效查询刷新 iframe。复用 revertEdit 的上传范式。
   - **标注 annotation = 区块下拉（页面 h1/h2/h3 抽取）**：选某节=只改该节；不选=整页。这是无需在
     已发布页 iframe 注入脚本的稳妥实现；真正的「页面内点选标注」留作后续（需给该 iframe 加 allow-scripts
     + 选取脚本，风险较高，暂缓）。
- **依赖**：小P 默认仍需 `GEMINI_API_KEY`；admin 在 /identify 配置面板换别的模型则按配置走。
- **NEXT — USER VERIFY（本机）**：`tsc --noEmit`（应 clean）；`npm run dev`：
  (a) 导航右侧小P蛙 → 跳 /identify；(b) /identify admin 见「小P蛙模型控制台」可存/清；
  (c) 草稿页右下小P蛙（带标签）提问+采纳改写；(d) 登录为该条目作者/管理员，打开 HTML 详情页 →
  右下小P蛙 → 选范围或整页提问 → 采纳并保存 → 页面刷新 + /edits 出现「ai_page_edit」详细记录。
  然后 `npm run build && wrangler deploy`（VPN）。⚠️ 详情页改写为整文件覆盖，建议先拿一条测试条目试跑。

## 🆕 2026-06-29 — 相框自适应画幅 + 小P 审稿助手 (DONE code, tsc EXIT=0; NOT deployed)
Two features added this session. **tsc --noEmit clean (EXIT=0, ~under 40s this time).**
NOT machine-previewed (sandbox can't run dev/deploy) — user verifies on their machine.

1. **AI 识别相框自适应画幅** (`src/components/camera-identify.tsx`). Was a fixed
   `h-[40vh]` box → captured photo shown `object-contain` → letterbox bars ("固定正方形
   不美观"). Now: new `imgAspect` state, measured via `readAspect(objectURL)` in `ingestImage`
   right before `setPhase("captured")`. Viewfinder wrapped in a centering `flex justify-center`;
   inner frame sized by new `frameStyle(phase, aspect)` helper — idle = original fixed box;
   captured landscape/square (r≥1) = `width:100%` + `aspectRatio` + `maxHeight:62vh`; portrait
   (r<1) = `height:62vh` + `aspectRatio` + `maxWidth:100%`. Image switched `object-contain`→
   `object-cover` (frame now matches真实画幅, so it fills edge-to-edge, no crop/no bars).
   `retake()` resets `imgAspect`. Idle scanner UI unchanged.

2. **小P 草稿审稿助手** (default Gemini). Editor opens a pending draft → floating「问小P」
   button (bottom-right) → chat panel. 小P answers questions / gives revision advice; when a
   message is an actionable edit it flags it and (for editors) shows「采纳并修改草稿」which
   rewrites the HTML in place + auto-saves + refreshes. Product decisions (asked user):
   **open to ALL viewers** (asking); **only editors apply**; **apply = auto-write + refresh
   (revocable via existing HTML editor)**.
   - New server fns in `src/lib/identify-plant.functions.ts`:
     `geminiTextCall()` (shared chat-style Gemini call, env GEMINI_API_KEY + AI_MODEL,
     429/503 retry, optional responseSchema); `askDraftAgentFn` (POST, no auth — reads draft
     html→text via htmlToText, structured JSON `{reply,canEdit,editInstruction}`);
     `applyDraftAgentEditFn` (POST, `requireSupabaseAuth` — rewrites FULL draft HTML per the
     instruction, structure/style preserved, returns `{html}`).
   - New component `src/components/draft-agent-panel.tsx` (`DraftAgentPanel`). Client flow on
     apply: applyDraftAgentEditFn → existing `saveDraftHtmlContentFn` → `logDraftEditFn`
     (kind `draft_text`) → onApplied() invalidates `["draft", id]`.
   - Wired into `src/routes/drafts.$id.tsx`: rendered when `!isEditing`, `canApply = isEditor
     && status!=='approved'`.
   - **Depends on `GEMINI_API_KEY` in env/Workers secrets** (already set per prior entries).
     Lovable/OpenAI fallback NOT added for 小P (user said「默认 gemini」); if no Gemini key
     it surfaces "小P 暂不可用：服务器未配置 GEMINI_API_KEY".
- **NEXT — USER VERIFY (your machine):** `./node_modules/.bin/tsc --noEmit` (should be clean);
  `npm run dev` → (a) /identify 拍照或选图 → 相框边框贴合横/竖/方图，无黑边；(b) open a pending
  draft → 问小P → 提问得到建议 → 登录为编辑后点「采纳并修改草稿」→ 草稿 HTML 自动更新刷新。
  Then `npm run build && wrangler deploy` (VPN on, per Blockers).

## 📌 Next concrete step  ← start here
**高德地图迁移 /explore — Stage 1 DONE (code, tsc EXIT=0; NOT deployed).** Replaced Leaflet with
AMap JSAPI v2. Key=plantsexplore (Web端). Coordinate fix is the crux: added inline
`wgs84togcj02()` (data is WGS-84, AMap is GCJ-02) — all markers + user dot + center converted.
- `explore.tsx` rewritten: `useAMap()` loader (reads `VITE_AMAP_KEY`/`VITE_AMAP_SECURITY` from env,
  sets `window._AMapSecurityConfig`, injects webapi.amap.com/maps?v=2.0&plugin=AMap.ToolBar,
  AMap.MarkerCluster). Base layers now 平面(默认路网)/卫星(AMap.TileLayer.Satellite) — **地形 dropped**
  (no AMap equivalent; OSM terrain is WGS-84 → would misalign). Markers = AMap.Marker + InfoWindow;
  popup gains **「导航到此地」** = `uri.amap.com/navigation?to=glng,glat&coordinate=gaode&callnative=1`.
  Side panel / 按地区 chips / list / distance sort all kept (area filter uses map.setFitView on
  markersRef subset).
- **Stage 1 INTENTIONALLY DROPS (restore in Stage 2):** the custom cluster fan-out cards + green
  cross-species lines (they need AMap.MarkerCluster + map.lngLatToContainer projection — rebuilding
  blind is risky, so deferred until alignment is confirmed). So a Stage-1 deploy = those 2 features
  temporarily gone + no 地形 button.
- **USER ACTION REQUIRED before it works (I can't do these):**
  1. Add to `.env`: `VITE_AMAP_KEY=fbf6a211f58aea3da6b8e355a5db46c3` and
     `VITE_AMAP_SECURITY=dffd22754c1e8184e775e1d6ee524afa` (I must not write .env).
  2. Confirm 高德控制台 域名白名单 has `plantspedia.club` + `localhost`.
  3. `npm run dev` → localhost:8080/explore → **eyeball that markers land on the correct real
     spots** (verifies the GCJ-02 conversion) + click a marker → 导航到此地 opens 高德.
- **Why I can't "自己检查后直接发布":** (a) sandbox CANNOT deploy — wrangler errors on workerd
  (macOS node_modules on Linux aarch64) + no CLOUDFLARE_API_TOKEN; (b) a map needs a human eyeball
  for coordinate alignment, which tsc can't check. So deploy must run on user's machine after a
  quick visual check.
- **2026-06-27 PREVIEW FEEDBACK:** ✅ 坐标对齐基本正确(只偏一点点=GPS+卫星配准误差,说明
  GCJ-02 转换生效)。✅ 卫星底图正常。✅ 导航到此地能唤起高德。❌ 平面(矢量路网)底图加载不出来,
  console: `net::ERR_FAILED o4.amap.com/style/...`.
- **平面 FIX (DONE, sw.js):** root cause = the PWA **Service Worker intercepted cross-origin AMap
  requests** and on any hiccup its catch returned uncached `undefined` → net::ERR_FAILED (satellite
  came from a different host/path so survived). Added `if (url.origin !== self.location.origin)
  return;` at top of the fetch handler (SW now ignores ALL third-party requests — AMap/Supabase/CDNs
  load natively). Bumped CACHE_NAME v4→**v5**. User must refresh the SW: hard-reload twice, or
  DevTools→Application→Service Workers→Unregister→reload.
- **USER ASK — 多途径点路线规划:** wants to click multiple species markers as waypoints and plan a
  route through them. Current 导航到此地 is a SINGLE-destination deep link to the 高德 app (the app's
  「添加途径点」can't see your site's plant markers — they only exist on plantspedia). True
  multi-stop routing must be IN-PAGE via **AMap.Driving plugin (waypoints, max ~16)** drawing the
  route on our own map. = a Stage 2/3 feature (a 「规划路线」mode: click markers→waypoint list→
  AMap.Driving.search→draw route). Plugin AMap.Driving must be added to the JSAPI loader.
- **平面 CONFIRMED fixed by user.**
- **Stage 2 + Stage 3 DONE (code written; NOT machine-verified — see blocker).** `explore.tsx`
  rewritten again:
  - Stage 2: `AMap.MarkerCluster` (gridSize 50, custom renderMarker 🌱 / renderClusterMarker count
    bubble). cluster `on('click')` reads `item.clusterData` → `activate(items,lng,lat)`: 1→InfoWindow,
    <20→fan-out cards, ≥20→zoom. Fan-out overlay restored using `map.lngLatToContainer(new
    AMap.LngLat(lng,lat))` projection (replaces Leaflet latLngToContainerPoint); green cross-species
    lines too. **Defensive: cluster setup in try/catch → falls back to plain AMap.Marker if
    MarkerCluster API misbehaves (map never blanks).** Initial framing + 按地区 filter use manual
    `boundsOf()`+`map.setBounds`. map 'click' close guarded by justExpandedRef 300ms.
  - Stage 3: 「规划路线」toggle (top-center). In route mode, single-marker click → addStop (waypoint
    list, max 16, 1st=起点 last=终点). `generateRoute()` = `new AMap.Driving({map,autoFitView})` +
    `driving.search(start,end,{waypoints},cb)` → draws route, shows 距离/时间. Isolated behind toggle
    + try/catch so routing failures can't break the base map. Loader now includes plugin AMap.Driving.
- **⛔ BLOCKER (sandbox, NOT code):** could not run tsc to completion this turn — full-project tsc
  times out >100s in the bogged-down Cowork sandbox (earlier 2 tsc runs this session passed EXIT=0);
  esbuild CLI is macOS-arch (Exec format error on Linux aarch64). So Stage 2/3 is UNVERIFIED by
  machine. Code written carefully, AMap typed as `any` (low TS-friction), JSX mirrors the working
  original.
- **NEXT — USER VERIFY (your machine is authoritative + fast):**
  1. `./node_modules/.bin/tsc --noEmit` (should be clean; fix anything if not — likely none).
  2. `npm run dev` → localhost:8080/explore (hard-refresh for SW). Test: (a) co-located markers form
     a numbered cluster bubble; clicking it (<20) fans out right-side cards + green same-species
     lines; (b) 「规划路线」→ click 2–3 markers → 生成路线 draws a route + shows 距离/时间.
  3. Known risk spots (report if off): AMap.MarkerCluster `clusterData` payload shape, AMap.Driving
     `search(start,end,{waypoints},cb)` signature — both written from spec, not run here.
  Then deploy (`npm run build && wrangler deploy`, VPN on).

- **2026-06-27 PREVIEW #2 feedback + REWORK (DONE code; sandbox tsc again too slow to verify):**
  user reported: route waypoints/dest unselectable; >20 cluster click "全部散开" not re-cluster;
  un-clustered single markers had NO popup; and asked to move 导航 + 加入路线 INTO the marker popup
  (drop the easy-to-miss top 规划路线 toggle). Root cause = relying on `cluster.on('click')`+clusterData
  to dispatch ALL clicks (unreliable for single markers) + AMap default zoom-on-click spreading >20.
  **Rework in explore.tsx:**
  - Build real `AMap.Marker[]` (each with `extData:{sighting}` + its OWN `m.on('click')→openPopup`)
    and pass that array to `AMap.MarkerCluster` (visual grouping only) with `zoomOnClick:false`.
    → single markers ALWAYS pop reliably; >20 cluster click now controlled (my +2 zoom, re-clusters).
  - cluster `on('click')` extracts members defensively (`item.markers`→extData.sighting, fallback
    `item.clusterData`), only acts when >1 (single falls through to marker's own handler).
  - Popup is now a real DOM node (`buildPopupNode`) with 3 actions: 🧭导航到此地 / ➕加入路线 (button
    w/ listener → addStop, dedups via routeStopsRef, flips to ✓已加入) / 查看识别档案.
  - REMOVED the top 规划路线 toggle + routeMode state. A bottom-center **route bar** auto-appears
    only when routeStops.length>0 (chips + 生成路线 + 清空). Fan-out 收起 button moved to top-center
    (was top-right, freed since toggle gone). generateRoute/AMap.Driving unchanged.
  - **UNVERIFIED by sandbox tsc (times out ~2min). User: run `./node_modules/.bin/tsc --noEmit`
    + `npm run dev`, test: single marker→popup w/ 导航+加入路线; cluster<20→fan-out; >20→zoom not
    spread; add 2+ stops→bottom bar→生成路线 draws route.**
- **2026-06-27 REGRESSION FIXED — all markers vanished.** Cause: the rework passed `AMap.Marker[]`
  to `AMap.MarkerCluster`, but v2 `AMap.MarkerCluster` takes DATA objects `{lnglat,...}` not Marker
  instances → rendered nothing. Reverted to data form `{lnglat, sighting}` + bind per-marker click
  INSIDE `renderMarker` (`ctx.data[0].sighting → openPopup`) so single points are reliably clickable;
  cluster bubble click reads `item.clusterData`. zoomOnClick:false kept. User to re-preview: markers
  back + single popup + cluster fan-out + >20 zoom.
- **2026-06-27 OPTIMIZATION batch (DONE code, not sandbox-verified):**
  1. Big cluster (≥20) click now `map.setBounds(member coords)` → re-splits into smaller sub-clusters
     (instead of dead-end zoom+2); if members co-located (span <1e-4) → fan out directly.
  2. Route model: order = [起点,…途经…,终点], last = destination (rightmost). New fns
     `setAsDestination` (append/move to end), `setAsWaypoint` (insert before 终点), `moveStop(i,±1)`
     (reorder), `navigateRoute` (高德 deep link from 起点→终点, coordinate=gaode — NOTE: web URI only
     does start→end, not full multi-waypoint).
  3. Route bar redesigned: role badges 起(emerald)/途(amber)/终(vermilion), per-chip ◀▶ reorder + ✕,
     and 3 actions: 生成路线 / 立即导航 / 清空.
  4. Fan cards: restructured from <a> to div + inner links; added 「设为途经」「设为终点」buttons; bumped
     fan card min height 34→56 (slot max 104→112) to fit buttons.
- **2026-06-27 OPTIMIZATION batch #2 (DONE code, not sandbox-verified):**
  1. **Custom distance clustering** replaces AMap.MarkerCluster (grid clustering left markers
     overlapping at max zoom = grid-boundary artifact). `renderMarkers()` projects all gcj pts to
     pixels, greedily groups any within CLUSTER_PX=15px (≈ 32px 🌱 circles overlapping >half) into a
     numbered bubble; recomputed on `zoomend` only (pan doesn't change pixel spacing). Singles =
     own click→popup; bubble = onClusterClick (fan-out <20 / setBounds-split ≥20). AMap.MarkerCluster
     no longer used (still in loader plugins, harmless).
  2. **设为途经 button** now solid blue (#2563eb inline), 设为终点 red (#c2410c) — were tailwind
     bg-amber/bg-vermilion classes that may not compile → looked like white text.
  3. **起点 = 我的当前位置** (not first species). generateRoute: start=wgs84togcj02(userCoords),
     waypoints=all stops except last, end=last stop. Route bar shows a fixed 起·我的位置 chip; species
     chips are 途/终 only. 生成路线/立即导航 disabled without userCoords. navigateRoute: from=我的位置
     → to=终点 (⚠️ 高德 web URI has NO multi-waypoint param — only endpoints match; documented).
  4. **Route preview radial**: on successful 生成路线 → close InfoWindow + cluster fan (setExpanded
     null) → `routeFanActive=true` → new `routeFan` overlay links each route stop to a right-side
     card (role badge 途/终). Reset to false on any routeStops change or 收起. Cluster fan guarded by
     `!routeFanActive`.
- **2026-06-27 batch #3 fixes (DONE code, not sandbox-verified):**
  1. **立即导航 keeps a waypoint.** 高德 URI `uri.amap.com/navigation` DOES support `via` but **max 1
     途经点, 驾车 only** (confirmed via official docs). navigateRoute now adds `&via=` (routeStops[0])
     when ≥2 stops. Full multi-waypoint still impossible via web URI — that's 高德's hard limit.
  1b. **立即导航 多途经点 FIXED (2026-06-27).** The WEB URI is capped at 1 via, but the 高德 **APP
     deep link** `amapuri://route/plan/?...&vian=N&vialons=a|b&vialats=c|d&vianames=x|y` supports
     MULTIPLE 途经点 (confirmed via official amap-mobile Android route docs). navigateRoute now: on
     mobile → `window.location.href = amapuri://...` with ALL waypoints (dev=0 since coords are
     GCJ-02, t=0 driving); on desktop → web URI fallback (1 via). Requires 高德 app installed on
     phone. iOS uses same amapuri:// scheme (may need iosamap:// if it doesn't launch — report).
  2. **"[object Event]" on stop adjust FIXED.** Root cause: per-click `new AMap.Driving` + destroy left
     stale async callbacks firing with an Event. Now: reuse ONE Driving instance; `searchSeqRef` token
     makes superseded callbacks no-op; stop-change effect bumps seq + clears drawn route + routeInfo;
     failure message coerced to string only (never renders an object).
  3. **Route radial no longer crosses.** routeFan now sorts cards by source map-y before assigning
     rows → leader lines are monotonic in y, never cross.
- **NEXT — USER VERIFY (tsc + npm run dev):** overlapping markers at max zoom now numbered-cluster;
  click bubble→fan-out w/ blue 设为途经 + red 设为终点; route bar 起·我的位置 + 途/终 + ◀▶; 生成路线→
  old popups close + route radial appears + 高德 route drawn from my location; 立即导航 opens 高德
  from 我的位置→终点.

### (earlier) Pl@ntNet 专业识别集成 — DEPLOYED LIVE (user confirmed 成功 2026-06-26)
**Pl@ntNet 专业识别集成 DONE (code, tsc clean EXIT=0; NOT deployed).** Adds a dedicated
botanical classifier as "Stage 0" before the draft-writing LLM — admin pastes the key in a
new panel on /identify (stored in `site_config` key `plantnet_api_key`, all-users, no redeploy).
- `identify-plant.functions.ts`: `loadPlantNetKey()` (site_config→.env `PLANTNET_API_KEY` fallback)
  + `plantNetIdentify()` (POST multipart to `my-api.plantnet.org/v2/identify/all`, organs=auto,
  nb-results=3, 20s timeout; returns top species+family+genus+score+candidates, null on any fail).
  Called at top of `callAiIdentify` → appends a 【Pl@ntNet 判定】hint to the shared systemPrompt
  (benefits ANY provider). Non-fatal: failure → LLM-only. stageModel="plantnet"; Gemini-branch
  usage label now `plantnet+gemini` / model `plantnet→<model>` (also fixed the old hardcoded
  "custom+gemini" provider label to `${stageModel}+gemini`). Two-stage custom quickIdentify now
  `idHint +=` (was `=`) so PlantNet + custom relay can coexist.
- New admin server fns: `savePlantNetKeyFn`/`getPlantNetKeyFn`/`clearPlantNetKeyFn` (admin-gated,
  mirror saveAiConfigFn; key masked on read).
- `identify.tsx`: new `PlantNetPanel` (emerald-themed, key input + save/停用 + masked status),
  rendered admin-only right after `AdminModelPanel`; added `LeafIcon`.
- **2026-06-25 VERIFIED PlantNet path WORKS:** user saved key in panel (panel renders correctly,
  shows 已启用), ran 3 local identifies → PlantNet dashboard shows **3 successful Identify requests,
  0 errors**. So `plantNetIdentify()` reaches my-api.plantnet.org and returns results from local
  Node. Pl@ntNet (France) + Gemini (small JSON) both succeed locally.
- **Remaining local failure is PRE-EXISTING network, NOT this change:** identify still ends with
  toast `照片上传失败：fetch failed` — that prefix = the **Supabase Storage photo upload** step
  (`plant-images` bucket) in submitPlantDraft. PlantNet ✓ + Gemini ✓ (else no upload-prefix), then
  the bigger photo POST gets reset by the GFW tunnel (same class as the wrangler 5MB upload resets;
  small requests hold, large uploads reset). Browser reads work (client-side, proxied); server-side
  Node big upload doesn't.
- **DEPLOY must run on USER'S machine.** Sandbox can't: wrangler errors on workerd (macOS-built
  node_modules won't run on Linux aarch64) + no CLOUDFLARE_API_TOKEN in .env. Commands for user:
  `cd ~/Desktop/plantspedia && npm run build && ./node_modules/.bin/wrangler deploy` (keep VPN on,
  HK/JP exit node per Blockers for the big script upload; if "Not logged in" → `wrangler login`
  then re-run deploy). After deploy: Workers run outside GFW → photo upload + Gemini + PlantNet all
  reachable → full chain (拍照→PlantNet 定种→大模型写稿→存库出结果) should work live.
- **NEXT:** user deploys from own terminal → run ONE real photo on plantspedia.club/identify →
  confirm draft 学名 matches PlantNet + usage log shows `plantnet+gemini`.

### (earlier next step) Editor leaf/points system
**Editor leaf/points system (大功能, 分阶段).** Product decisions locked: 采纳=手动按钮;
一键创建=重型深度生成(异步, Phase 2); 资深编辑=仅所有者(arainjazz emails); 分阶段交付.
**Phase 1 (A+B) DEPLOYED LIVE 2026-06-25 — Version `5e7022d2-b4ed-4c9c-a125-511ddcf9b685`.**
Migration applied by user (confirmed). USER to verify logged-in-as-owner: 积分面板 / 采纳按钮 /
条目类型标签. NEXT = Phase 2 (金叶一键创建).
- **Phase 1A DONE (code, tsc clean; NOT deployed; migration NOT yet applied):**
  - Migration written: `supabase/migrations/20260625000000_editor_leaf_points.sql` — adds
    `adopted/adopted_by/adopted_at` to plant_edits + plant_drafts, `source` to plants (+backfill),
    `gold_used` to profiles. **USER must apply via Supabase dashboard** (hosted, no local CLI).
    types.ts already hand-edited to match.
  - `src/lib/leaves.ts` — derives leaves: 识别=plant_drafts by user, 修文=plant_edits kind='text',
    换图=kind='image' (not reverted); each +1, ×2 when adopted; 铜叶合计→银叶(÷10)→金叶(÷10);
    owner(email)→资深编辑. Degrades gracefully if columns missing (each count errors→0).
  - `src/components/leaf-panel.tsx` (flat SVG leaves, level badge, rules <details>, 金叶 used/total) —
    rendered top-right of /profile. VERIFIED in isolation (mock route, 3 levels, screenshot OK).
  - `src/lib/plants.ts` `entryType()` + `src/components/entry-type-badge.tsx` — 3-way
    AI识别简略/HTML详页/金叶一键创建(+富文本); wired into admin.index 条目列表 + profile 我的条目.
- **Phase 1B DONE (code, tsc clean; NOT deployed):** owner-only 「采纳」 toggle.
  - `setAdopted(table,id,adopted,ownerId)` in leaves.ts (casts builder; writes adopted/_by/_at).
  - /edits ([edits.tsx]): owner-only 采纳/已采纳✓ button on kind='text'|'image' rows (修文/换图),
    next to the revert button; `isOwner = isOwnerEmail(user.email)`; invalidates plant-edits+my-leaves.
  - draft detail ([drafts.$id.tsx]): owner-only 「采纳识别」 button (bronze LeafIcon) in the top
    action row; toggles plant_drafts.adopted.
  - PlantEdit (edits.ts) + PlantDraft (drafts.ts) types gained adopted?/adopted_by?/adopted_at?.
  - Runtime sanity: /edits loads clean (login-gated view, no app errors). Adopt buttons are
    owner+auth gated and need the migration's `adopted` column → full verify is live, owner-logged-in.
  - **GATE: needs the migration applied before deploy** — else clicking 采纳 errors (no column).
- **Phase 2 LATER:** 金叶「一键创建物种科普详页」— async deep-generation (拉丁学名→双语详页),
  entry points = identify-page button (gray when no gold) + profile gold-icon dialog; spends a
  gold leaf (profiles.gold_used++), sets plants.source='gold_oneclick'. Needs CF queue/Durable
  Object (10min/百万token job). Note: existing AI HTML-gen lives in identify-plant.functions.ts.


**DONE 2026-06-24 — `/explore` 身边物种地图 redesign — DEPLOYED LIVE (Version
`a1c1b792-9894-4466-af23-bd54700e3980`).** Four parts, all tsc-clean + preview-verified on :8080;
`npm run build` + `wrangler deploy` succeeded (1 asset-upload retry then recovered; proxy ON).
Live verified: `/` + `/explore` + new `explore-BavYEgz7.js` chunk all HTTP 200 (home only 200 via
`curl --noproxy '*'` — the proxy path intermittently TLS-resets, the known GFW flakiness, NOT a
site issue). No SW `CACHE_NAME` bump needed — `sw.js` is network-first for navigations + assets
are content-hashed, so the new build surfaces on next load.
1. Nav rename 身边物种探秘 → **身边物种地图** (`site-header.tsx` desktop + mobile drawer; also the
   panel label/`<h1>` and route `head` title in `explore.tsx`).
2. **3 base layers** (`BASE_LAYERS` const + a bottom-left React switcher): 平面 (OSM, was the
   only layer), 卫星 (Esri World Imagery `server.arcgisonline.com/.../World_Imagery`), 地形
   (OpenTopoMap). All WGS-84 so they stay aligned with EXIF marker coords (do NOT swap in a
   GCJ-02 provider like 高德/Tianditu — markers would offset ~hundreds of m). Verified each swaps
   live (18 ArcGIS / 18 OpenTopoMap tiles after click, OSM removed).
3. **Custom cluster fan-out replaces spiderfy.** Cluster group now has `spiderfyOnMaxZoom:false,
   zoomToBoundsOnClick:false`; `clusterclick` → if `getChildCount() < 20` set `expanded`
   {lat,lng,items} (items via `getAllChildMarkers().map(m => m.__sighting)`), else `zoomToBounds`.
   Overlay (a `useMemo` `fan` recomputed on a `tick` bumped by map `move/zoom/resize`) projects
   the cluster origin with `map.latLngToContainerPoint` and lays cards down the right edge:
   per card a **black radial→horizontal polyline** (origin → elbow → card) and a card showing
   photo + 中文名(title) + 学名(scientific_name, italic) + 科/属 (family·genus, shown when card ≥64px).
   Container is `pointer-events-none` (map stays draggable underneath; lines follow on pan/zoom);
   cards/close-button are `pointer-events-auto`. Map `click` (empty) or a standalone marker click
   dismisses. `收起 · N 个物种 ✕` button top-right.
4. **Green cross-species links.** For each card, other sightings (full set, minus cluster members
   by id) with the same `speciesKey` (scientific_name||title, lowercased) get a green dashed line
   from the card to their projected point + a green target ring. **NOTE for the user:** on the
   CURRENT prod data this draws ZERO lines and that is CORRECT — every duplicate species
   (紫花苜蓿×2, 玛格丽特菊×2) sits at near-identical coords (~5 m) so they always share one cluster
   and are excluded. Verified the render path by temporarily relaxing the match to family-level
   (→13 green lines drawn) then reverting to species-level. It will light up once the same species
   is recorded at two genuinely-separated places.
Data change: `fetchGeoSightings` + `GeoSighting` now also select `family`,`genus` (needed by the
cards). Also added an `onError`→🌱 fallback on the card thumbnail (two drafts' photos 502'd this
session — transient Supabase storage flakiness, not a code bug).
**NEXT:** user reviews locally (`npm run dev`, /explore); if approved, deploy via
`npm run build && wrangler deploy` (⚠️ confirm intent; needs VPN + good exit node per Blockers).
Possible follow-ups: dim the clicked cluster's own bubble under the origin dot; handle N≈15-19
cards getting short (科/属 line hides <64px — acceptable for now).

**DONE 2026-06-20 — 定边县 cross-province split FIXED + DEPLOYED LIVE (Version `36a58ebd-4aa4-47c4-823c-4888dacc1f4c`).** Editor 活动地点
showed `陕西省榆林市定边县；内蒙古自治区定边县` — same county under two provinces. Root cause is
TWO layers: (1) SOURCE — `reverseGeocode()` mixes Nominatim + AI-fallback backends, and 定边县
is a 陕/蒙/宁 tri-border county, so near-border points get mis-attributed to 内蒙古 (wrong; 定边
is 陕西榆林). (2) DISPLAY — `formatActivityAreas` groups by 省+市, and `CITY_DIRECTORY` (the
known-district→authoritative-省市 corrector in `editor-stats.ts`) only seeded Ordos+Hainan, so
the wrong 内蒙古 prefix couldn't be corrected → two groups. **Fix:** added a 陕西省/榆林市 entry
to `CITY_DIRECTORY` (12 区县: 榆阳/横山/神木市/府谷/靖边/定边/绥德/米脂/佳县/吴堡/清涧/子洲 — all
nationally-unique names, safe to force). `parsePlace`'s "known district is authoritative" logic
now overrides 内蒙古→陕西榆林; both variants collapse to one group. Fixes existing AND future data
with NO DB change. Verified via Bun probe: `内蒙古自治区定边县(+street noise)` → `{陕西省,榆林市,
定边县}`; 4 variants together → `陕西省榆林市定边县、神木市` (one group); Ordos data unchanged; tsc
clean. **DEPLOYED LIVE 2026-06-20** via `npm run build && wrangler deploy` (proxy ON → the big
script upload went through; wrangler auto-retried the asset upload once, then success; live site
HTTP 200 in 0.95s). Display-layer only — corrects on next page load. SW cache bump not required
(server-fn data network-first per v3+).

**DONE 2026-06-19 — native-camera fix LIVE (Version `d06908f3-320e-47ab-9ff7-87dad127f6f3`).**
(Re-auth needed first: `wrangler login` — OAuth had expired over the multi-day session.) Rewrote
`src/components/camera-identify.tsx`: REMOVED the custom `getUserMedia` live-stream camera
(the square `object-cover` viewfinder cropped the preview but `capturePhoto` grabbed the
FULL frame → preview≠capture; also no native focus/zoom/flash). Shutter now calls
`openCamera()` → clicks the existing `<input capture="environment">` = **native camera
app**; its photo flows through the same `ingestImage` pipeline as an album pick. Review
`<img>` switched `object-cover`→`object-contain` so the preview shows the true full
framing. tsc clean; preview-verified (no `<video>`, input has capture=environment, no
console errors). **NEXT (2026-06-19): connection restored (US/LAX) but `wrangler deploy`
now fails — `wrangler whoami` = "Not logged in" (OAuth token expired over the multi-day
session; non-interactive shell can't do the browser login). USER must run
`./node_modules/.bin/wrangler login` in their own terminal (or set `CLOUDFLARE_API_TOKEN`
in `.env` from a "Edit Cloudflare Workers" token), THEN Claude reruns `wrangler deploy`
(dist/ already built, no rebuild needed).** NOTE on user's "save to album" ask: a web page
CANNOT write to the iOS/Android photo library (sandbox); native-camera capture doesn't
auto-save to the roll. Delivered the functional goal (full native camera → identify);
true album-save needs a native app or a manual Share/Download tap.

**DONE 2026-06-18 — care-section (养护建议) redesign LIVE (Version `e6f26e84-cf7b-408e-
abb9-9911a551be46`).** 8 summary CARDS now render ABOVE the rationale text; each card =
category label + `value`(值/范围) + `tag` pill +(标签) + `detail`(简介), for 酸碱偏好/
施肥方案/光照需求/土壤基质/浇水方法/温度区间/空气湿度/病害防治. Body below = "为什么这样养护"
rationale. Changes: `care_facts` item schema `{category,detail}` → `+value +tag` in
`AI_META_SCHEMA` + Lovable tool schema + system prompt (8-card spec) + `PlantDraftFields`
type; `plant-html-template.ts` reordered cards-before-body + new card CSS (cf-top wraps,
cf-cat nowrap) + graceful fallback for old drafts. Verified with mock data via Node
`--experimental-strip-types` → `public/_cardtest.html` preview (8 cards, correct order).
NOTE: user's water-card tag list said "耐寒" but in a WATER context → used **耐旱**
(drought-tolerant); flag if they meant cold-tolerance.
Existing safeguards confirmed live (fix the user's "null title / 待鉴定植物 / UUID in usage
log" reports): `safeTitle = meta.title || scientific_name || "待鉴定植物"` used for both the
draft `title` insert AND `draft_title` in ai_usage_logs.

**DONE 2026-06-17 — two-stage identify LIVE (Version `691d626d`).** User chose "glm 快速
识别 + Gemini 出草稿". `callAiIdentify`: when provider=`custom` + env Gemini key, calls
`quickIdentify()` (glm small {title,scientific_name} request) → appends its ID as a hint
to the system prompt → routes the heavy draft to env Gemini (schema-enforced, reliable).
Falls back to Gemini-only if glm fails (identify never breaks). Usage logs combined
`glm-5v-turbo→gemini-2.5-flash` + summed tokens. Also: `safeTitle` (title→scientific_name
→"待鉴定植物") used for BOTH the draft insert and the usage `draft_title` (fixes the bare
UUID in the usage panel). custom branch retries on 5xx; max_tokens 16000; no json_object.


**DONE 2026-06-17 — glm-5v-turbo AI config LIVE.** Identify now uses the user's relay.
- Code fix DEPLOYED Version `cfe78d0a-750a-4af3-b11a-fbf05fd5f7da` (`identify-plant.
  functions.ts` custom/OpenAI branch: `max_tokens: 16000` + `response_format:json_object`
  omitted when `provider==="custom"`). Needed because glm-5v-turbo is a REASONING vision
  model and this relay returns an EMPTY reply when json_object is sent.
- Config SAVED to `site_config`: provider=`custom`, baseUrl=`https://yuanlansj.xin/v1`
  (the `/v1` matters — bare host returns the relay's HTML), model=`glm-5v-turbo`, key
  `sk-M…7Qvs`. Verified via curl: correctly ID'd a 旋花科 draft, `finish_reason:stop`,
  max_tokens 16000 accepted. **Next: user uploads one real photo on the live site to
  confirm end-to-end** (only the UI upload path is untested; all components pass).
  If a relay/model issue appears, the error now surfaces the upstream body; revert with
  the「恢复 .env 默认」button (→ Gemini).
- **2026-06-17 FOLLOW-UP — draft-save crash fixed (Version `a4fb28aa`).** First live
  identify failed: `null value in column "title"`. glm-5v-turbo (reasoning model, no
  schema enforcement on the custom branch) returned a partial JSON missing `title`; the
  relay also intermittently 502s on the heavy 21-field draft (verified via curl).
  Fixes: (1) defensive insert in `submitPlantDraft` — `title`/`summary` now fall back
  (title→scientific_name→"待鉴定植物") so a draft ALWAYS saves; (2) custom branch retries
  on 5xx (was 429/503 only). **CAVEAT:** glm-5v-turbo via this relay is unreliable for
  the FULL rich draft (502 / partial output); drafts may be thin. Gemini remains more
  reliable for heavy drafting — glm is best for quick ID. User to judge draft quality.

**DEPLOYED 2026-06-12** — latest Version `6fc1b398-2851-49e2-9c7f-5eb437d0cbb4`
(via US/LAX VPN node). NEW FEATURE「植物搜图」: the user's self-contained Lovable app
(`plant-image-search.html`, vanilla JS, zero backend/keys, calls iNat/GBIF/Commons/
Openverse/iDigBio client-side) is dropped into `public/plant-image-search.html` + a
`?q=` auto-search snippet + 「← 返回 Plantspedia」link. Nav `<a>` (desktop+mobile drawer)
in `site-header.tsx`; homepage `PlantImageSearchBox` after `<ContributorsColumn>` in
`index.tsx` (native `window.location` nav, not SPA `navigate`). SW cache v3→v4.
**NOTE:** Cloudflare Workers Assets auto-strips `.html` → `/plant-image-search.html`
**307→`/plant-image-search`** (query preserved); kept `.html` links since they work in
BOTH Vite dev and prod. Verified live: `?q=银杏`→Ginkgo biloba→76 images.
Prior Version `08c75ffd`: Latest: `fetchEditorPublicFn` now derives each blog's thumbnail
from the first `<img>` in `content_html` when `cover_url` is null (matches
`blogCoverUrl`); first-char placeholder only when a post has zero images. Prior
Version `f2950a47`: SW network-first for data GETs + cache bump
v2→v3 (fixes "stale 活动于 after deploy" — was stale-while-revalidate serving cached
server-fn responses); editor page 编辑博文/AI识别 titles → `[N]`; blog thumb
placeholder (first title char) when cover_url null; homepage edit-square badge
−10% (`inset-[5%]`). Earlier Version `5c451a51`: All fixes LIVE on plantspedia.club. Follow-up deploy fixed:
(a) location dedup bug — `cityM` regex no longer swallows 区/县/旗 into a city token
+ directory now OVERRIDES province/city for a known district (killed the
`内蒙古自治区康巴什区鄂尔多斯市康巴什区` garbage from geocode
`内蒙古自治区康巴什区鄂尔多斯市高新技术产业园区`); (b) homepage editor column
`line-clamp-2`→full (`text-balance`); (c) custom-provider error now says plainly when
a model is **text-only / no vision** (DeepSeek = text-only, cannot do photo ID).
**Post-deploy verify (do on the live site, mobile + desktop):**
1. Contributor page `/editors/$id` — `活动于` now reads
   `内蒙古自治区鄂尔多斯市康巴什区、东胜区；海南省海口市秀英区` (no 街道 noise, city
   filled, sorted by count, no「的」); heading shows `被收录条目 [N]` un-bold; petal
   icon +10%.
2. `/identify` (admin) — save a **custom**-provider config, run ONE identify,
   confirm it (a) actually calls the custom endpoint (errors now show the upstream
   body) and (b) writes a row to `ai_usage_logs` so the Token Usage panel updates.

**Custom-model identify failure + Token Usage not updating — FIXED 2026-06-11
(pending deploy).** Two root causes (both in `identify-plant.functions.ts`),
confirmed by probing prod (read-only): `site_config` + `ai_usage_logs` tables EXIST
with correct columns but are **empty**; `.env` has only `GEMINI_API_KEY`.
  1. **Non-exclusive routing** (`callAiIdentify`, ~line 111-114): when an admin
     saves provider=`custom`/`openai`/`anthropic`, the leftover env `GEMINI_API_KEY`
     keeps `geminiKey` truthy, so the Gemini branch (first) **hijacks** the request
     and the custom endpoint is never called (or, if Gemini quota is dead, it falls
     through and the custom branch fails) → identify throws → no draft, no usage row.
     **Fix:** when `dbConfig` is present, make it AUTHORITATIVE — zero out the other
     providers' keys so only the chosen branch runs. Also surface upstream error
     bodies (`...HTTP ${status}：${t.slice(0,200)}`) in the openai/anthropic branches.
  2. **Fire-and-forget usage insert** (`submitPlantDraft` ~line 753) is not awaited
     → on Cloudflare Workers the isolate can tear down before it flushes → empty
     `ai_usage_logs`. **Fix:** `await` the insert in a try/catch (still non-fatal).
  Neither table is tracked in migrations (created via dashboard); both fine as-is.
  **Applied:** exclusive `dbConfig` key resolution (env keys zeroed when a config is
  saved) + error-body surfacing in the openai/anthropic branches + awaited usage
  insert. tsc clean; routing truth table verified (custom→OPENAI/CUSTOM, no-config→
  GEMINI unchanged).

Other remaining candidate slices:
- **(②, source fix)** improve the EXISTING `reverseGeocode()` in
  `identify-plant.functions.ts:532` — it joins Nominatim `province+city+county+road`
  with no separator and for new districts (康巴什) Nominatim returns no `city`, so
  the stored string skips the city. Add: timeout/retry cap (ECONNRESET guard),
  back-fill the missing city, unify the AI-fallback output format. Touches network
  → do timeout/retry FIRST; only affects new records. (Pipeline already exists:
  `camera-identify.tsx` reads EXIF GPS via `exifr.gps()`.)
- **(③, tiny)** apply `displayPlace()` to draft detail + map popup too, IF we want
  full-site uniformity (currently detail = full on purpose).
- replicate the 按地区 chips on `profile.tsx` ("我的活动地区").
Implement one slice → `tsc --noEmit` → preview → update this file.

## ✅ Done / known facts
- **2026-06-11 — shipped:** **`formatActivityAreas` + `parsePlace` overhaul**
  (`src/lib/editor-stats.ts`). Added a China admin-division directory
  (`CITY_DIRECTORY` → `DISTRICT_TO_CITY` / `CITY_TO_PROVINCE`) that back-fills the
  skipped city level, province canonicalization (内蒙古→内蒙古自治区), street-noise
  stripping (`兴盛街道办东胜区`→`东胜区`), district counts sorted most-first, and
  dropped the「的」connector. Verified vs the real 27 drafts (esbuild+node):
  管理员 → `内蒙古自治区鄂尔多斯市康巴什区、东胜区；海南省海口市秀英区；海南省万宁市`;
  访客 → `内蒙古自治区鄂尔多斯市康巴什区、达拉特旗、乌审旗、东胜区、鄂托克旗、伊金霍洛旗`.
  `displayPlace()` inherits the same back-fill (海口市秀英区, 鄂尔多斯市东胜区). `tsc` clean.
- **2026-06-11 — shipped:** petal `FlowerMark` bloom +10% (`index.tsx`, rPos 18→19.8,
  rArc 12→13.2, ratio exactly 1.10); editor page heading `已收录条目 · Collected（N）`
  → `被收录条目 · Collected [N]` with `[N]` non-bold/faint (`editors.$id.tsx`,
  `WorksBlock` title widened to `ReactNode`).
- **2026-06-11 — shipped:** **按地区浏览** aggregation on `/explore`
  (`src/routes/explore.tsx`). Groups sightings by `displayPlace(capture_place)`
  into a chip row (全部 / 康巴什区 N / …, most records first); clicking a chip
  filters the side list (`visibleSightings`) and pans/zooms the map to that area's
  markers; click again clears. Unparseable-place records omitted from chips (still
  in 全部). Pure client-side, no network. Verified: `tsc` clean, `/explore` 200,
  no HMR errors.
- **discovery:** the EXIF→place pipeline ALREADY exists — `reverseGeocode()`
  (`identify-plant.functions.ts:532`): Nominatim free API first, AI fallback
  (Gemini/OpenAI/Lovable); `camera-identify.tsx` reads EXIF GPS. Its raw output is
  stored verbatim as `capture_place` (line 718) → it's the *source* of the messy
  granularity. See Next step ② to improve it.
- **2026-06-11 — shipped:** `capture_place` **display normalization**. Added
  `displayPlace()` in `src/lib/editor-stats.ts` (reuses existing `parsePlace`):
  drops province prefix + street-level noise, keeps city+district level. E.g.
  "内蒙古自治区康巴什区青春山街道呼和塔拉路" → "康巴什区"; "鄂尔多斯市" stays;
  unparseable/street-only → original; empty → "". Applied to the **compact/list**
  views only — `draft-card.tsx`, `explore.tsx` list item, `identify.tsx` admin
  table cell — each keeps the full string on `title` hover. **Left full on
  purpose:** `drafts.$id.tsx` detail + `explore.tsx` map marker popup (canonical
  fidelity views). Verified: `tsc --noEmit` clean; dev server `/`, `/explore`,
  `/identify` all 200, no log errors.
- `plant_drafts.capture_place` holds free-text Chinese addresses of **inconsistent
  granularity** (e.g. "鄂尔多斯市" vs
  "内蒙古自治区康巴什区青春山街道呼和塔拉路").
- Snapshot of 27 drafts: 访客 (guest) 16, 管理员 (admin) 11; many cluster at
  "内蒙古自治区康巴什区青春山街道呼和塔拉路". → The data exists but is messy, so
  the fix is most likely **normalization/display**, not data collection.

## 🚧 In progress
- (none — 按地区 aggregation slice complete; dev server may still be running
  on :8080 for preview)

## ⛔ Blockers / lessons
- **2026-06-14 — ROOT CAUSE of the recurring "session 一直报错" (corrects the earlier
  HTTPS_PROXY guess below).** Audited 6 recent session transcripts: errors are 100%
  network-layer (`API Error: socket connection closed unexpectedly` / `ECONNRESET` /
  `fetch failed`); **zero** `overloaded_error`/529 across all sessions → NOT Anthropic
  capacity, NOT a code bug. Live test: `api.anthropic.com` reachable in ~0.6s, egress
  IP = Los Angeles → a **TUN-mode VPN IS on and DOES route Claude Code** (no local
  proxy port even listens, so the old "Node ignores the梯子 unless HTTPS_PROXY is set"
  theory is WRONG here). Real cause: the China→overseas tunnel **holds short requests
  but resets long-lived SSE streams** — long generations / multi-tool turns accumulate
  resets (one 3.3 MB session logged **72 ECONNRESET**). Same root cause as the wrangler
  5 MB upload drops. **Levers:** stabler exit node (HK/JP, or IEPL/IPLC dedicated line)
  over LA; QUIC protocol (Hysteria2/TUIC); keep turns small + persist to disk (the
  existing anti-loop rule). Two non-network gotchas seen while diagnosing: a couple
  "查询失败" were my **own python f-string / pipe-vs-heredoc bugs**, not the network —
  always separate "tool/code error" from "network error" before blaming the GFW.
- **2026-06-11:** session died from a storm of **API ECONNRESET** (10 retries over
  ~17 min) → heavy token burn. User: "retried too many times, burned tokens —
  simplify, only quick fixes." → Keep tasks small, cap retries at ~2, persist
  state often (this file).
- **2026-06-11 DEPLOY BLOCKED:** `npm run build` OK (dist/ built); `wrangler deploy`
  failed **2×** at the final Worker-activation fetch — assets upload fine (5.3 MiB),
  then `✘ fetch failed` (connectivity blip on the big script PUT; CF API root itself
  reachable). Stopped per anti-loop rule. `wrangler deployments list` confirms latest
  LIVE version = **2026-06-10**; no 06-11 deploy registered → all local fixes
  (location/petal/heading + custom-model routing + usage logging) are **NOT live**.
  Next: just re-run `./node_modules/.bin/wrangler deploy` (dist/ already built, no
  rebuild needed) when the connection is steadier; may take 2–3 tries. Build
  artifacts are ready, so this is a pure network retry.
  - **UPDATE (3rd attempt):** bumped wrangler 4.97→**4.99.0** (now pinned in
    package.json), redeployed → **same `fetch failed`** at the script PUT (assets
    already uploaded, so it's isolated to the final Worker-script upload). Small CF
    API calls all succeed; only the ~5 MB upload to `api.cloudflare.com` resets.
    **Hard evidence from wrangler log:** `UND_ERR_SOCKET: other side closed`,
    `durationMs ≈ 318000` (~5.3 min) → the upload holds ~16 KB/s then CF closes the
    TLS socket. **Root cause = China network throttling `api.cloudflare.com` large
    uploads** (same reason Gemini needs a VPN here). **Fix is user-side: deploy with
    a VPN/proxy ON, or from a host outside the GFW.** dist/ is built; just rerun
    `wrangler deploy`. Don't keep looping unproxied — it won't get better.
  - **UPDATE (VPN ON, 5th attempt):** with the梯子 on, terminal IS tunneled (curl to
    `api.cloudflare.com` = 0.86s, egress IP exits **Sydney/AU**); all small CF API
    GETs now succeed. BUT the single big `POST /workers/scripts/tanstack-start-app/
    versions` (the script-module upload) STILL fails — `UND_ERR_SOCKET: other side
    closed`, `durationMs≈90000` (down from 318k, wrangler auto-retried once, both
    reset). → The AU exit node's upstream can't hold the sustained upload. **Next
    lever: switch VPN exit node to HK/JP/US-West (better Cloudflare routing) and
    rerun `wrangler deploy`.** Code/build/auth all fine; purely the upload path.
