# Plantspedia — Working State  (single source of truth)

_Last updated: 2026-07-18 — by Claude (续9：Pl@ntNet 接回 phase-1 一线 + 豆包 vision 疑似复核 + 管理员配置面板；tsc=0，⚠️ 未部署/未端到端实测）_
_Read this FIRST and update it LAST, every session._

## ✅ 2026-07-18（续10）— 出卡提速 + 手机端图片溢出 + 分享无图（tsc=0；**已部署 512b1658**）
**部署记录**：续9（Pl@ntNet 一线 + 豆包复核 + 管理员面板）与续10 **一起上线**，版本
`512b1658-4fba-49fd-a201-24c66422ecab`（2026-07-18T09:18）。⚠️ 这次 wrangler **连失败 2 次、第 3 次才成功**
（GFW 掐大文件上传；期间 `curl api.cloudflare.com` 只需 0.6s 且返回 403=可达，证明短请求正常、
只有 4MB 脚本 PUT 被掐）。照例用 `deployments list` 对时间戳确认前两次真没上。
**线上实证**：① 分享 chunk 里 payload 已是 `{files,title,text}` + `{files,title}`、**`url` 字段消失** ✅
② viewer 样式含两条防溢出兜底 ✅。
1. **✅ 分享到微信/小红书只有链接没有图片 —— 根因找到并修复**
   （[share-card.ts](src/lib/share-card.ts) `shareOrSaveImage`）：
   **元凶是 payload 里的 `url` 字段**。微信/小红书的分享扩展一看到 `url` 就把这次分享判定成
   「分享网页」，渲染链接卡片、**直接丢掉 `files`（分享卡图）**。续6 为保链接特意把链接同时放
   `url` + caption，恰恰是这个 `url` 把图挤掉了。
   - **改法**：payload **永不带 `url`**；图片走 `files`，链接折进 caption 文字（裸 URL 各家都会
     自动转链）+ 剪贴板兜底。attempts 顺序改为 ①图+文案 ②纯图兜底。
   - **实测**（浏览器 stub navigator.share）：A 全接受→`有files:true / 有url字段:false`、链接在
     text 里 ✅；B 目标拒 text→退纯图、`有files:true` ✅。**两种场景图片都在**。
2. **✅ 手机端草稿配图溢出屏幕**（[draft-enhance.ts](src/lib/draft-enhance.ts) VIEWER_STYLE）：
   模板本身响应式是对的（`.section-with-img` 的 grid 只在 ≥768px 生效），375px 模拟也复现不出 ——
   真机（微信 X5 / WKWebView）对 `iframe srcDoc` + 内部 `viewport=device-width` 的处理才会按设备宽
   而非 iframe 宽布局，把宽图撑出屏幕。**在 enhance 注入防御兜底**（`html,body{max-width:100%;
   overflow-x:hidden}` + `img,video,iframe,table,pre{max-width:100%!important;height:auto}`），
   **新旧草稿全覆盖**（drafts.$id 渲染都过 enhance）。
   - **实测**：1600px 宽图放进 320px iframe → 渲染宽 272px、`scrollWidth=320`（=iframe 宽）→ **零横向溢出** ✅。
3. **✅ phase-1 出卡提速**（[identify-plant.functions.ts](src/lib/identify-plant.functions.ts)）：
   - **砍掉快速卡用不到的 AI 输出**：`AI_QUICK_SCHEMA` 移除 `summary_en` / `field_notes_zh` /
     `field_notes_en`（`buildSummaryCardHtml` 只用 title/sci/summary_zh/family/genus/chips，
     这三个字段**从来没被读过**），required 里也去掉 summary_en，prompt 同步删除对应要求。
     flash 是顺序生成，输出量砍掉近一半 → 直接缩短 Gemini 那一段。`summary_zh` 仍 required，
     写库的 `summary_zh || summary_en` 回退链安全。
   - **地名反查 + 原图上传改为与识别并行**：识别只吃 base64，既不要 photoUrl 也不真需要地名；
     以前是 `geocode → upload → identify` 三个网络往返**串行**。现在两者并行启动，识别期间在后台跑完。
     `uploadP` 用 `.then(ok,err)` 就地接住 rejection（否则 await 之前失败会 unhandled rejection 带崩请求）。
   - **地名只等 4s**（`reverseGeocode` 走 Nominatim，**原本无超时**、偶发挂死会拖住整次识别）：
     超时就先不带地点提示去识别，**写库前再取完整值补回** → `capture_place` 不会因此丢。
- **⚠️ 最大的慢因不在我这轮改动里，需你定夺**：续9 把快速路径变成**最多 3 个串行模型调用**
  —— Pl@ntNet（20s 超时）→ Gemini（45s 超时）→ 疑似时再加豆包复核。而「疑似」很常见 →
  豆包经常触发。这是续9 为降低错误率有意加的，**质量与速度的直接权衡**，我没擅自改。
  可选项：① 维持现状（准但慢）②豆包复核改成后台异步、先出卡后更新 ③只在 Pl@ntNet 与 Gemini
  结论冲突时才触发豆包（而非所有 low）④给 Pl@ntNet 更短超时（20s 太宽）。
- **验证**：tsc=0 ✅；lint 我的改动**零新增**（identify-plant 的 +4 `any` 全部来自续9 的
  Pl@ntNet/豆包代码，逐行核对过）。**未提交、未部署** —— 工作区混着续9 的在制品
  （identify.tsx、STATE.md 也是他们的），部署会一并带上。

## 🚧 2026-07-18（续9）— Pl@ntNet 接回一线 + 豆包 vision 疑似复核（tsc=0；⚠️ 未部署 / 未端到端实测）
全部改动在 [identify-plant.functions.ts](src/lib/identify-plant.functions.ts) + [identify.tsx](src/routes/identify.tsx)。
**补拍链路（drafts.$id.tsx / camera-identify.tsx）零改动** —— 它只看 `identification_confidence`，合并后的 meta 会把字段设对。

- **根因发现（用户问"为什么识别错误率高"）**：**Pl@ntNet 此前根本没参与常规识别**。拍照走 phase-1
  `identifyQuick`（**纯 Gemini**），不进 `callAiIdentify`；phase-2 `enrichDraft` 因物种已 pin，
  `callAiIdentify` 里的 Stage-0 Pl@ntNet 分支被跳过。即 Pl@ntNet 只在 Gemini 不可用的兜底分支才发请求。
  用户看到的「疑似/LOW」一直是 **Gemini 的** confidence，不是 Pl@ntNet 的。
- **1. Pl@ntNet 接回 phase-1 一线**：`quickIdentifyDraft` 里在 `identifyQuick` 前先调
  `loadPlantNetKey()`+`plantNetIdentify()`，判定作为 `plantNetHint` 注入 `identifyQuick` 的 system
  prompt（复刻 callAiIdentify `:941` 那套写法）。**Gemini 的置信度因此吸收 Pl@ntNet 信号**（低分/不符 →
  倾向标疑似），不用再单独维护脆弱的分数阈值门。代价：每次拍照多一次 Pl@ntNet 请求（顺序，约 +1–2s）。
- **2. 豆包 doubao-1.5-vision-pro 二次复核**：新增 `doubaoIdentify()`（以 `quickIdentify()` 的 OpenAI
  兼容 vision 调用为模板，火山方舟 `/chat/completions`，`response_format: json_object`，30s 超时，
  多图=新图+最多4张补拍旧图）。**仅当 `identification_confidence==="low"` 且 `retakeCount<3` 时才调用**。
  豆包**有把握（!low）→ 整卡采纳**（确认或纠正物种走同一条路径，即用户选的 "let Doubao override"）→
  直接出确诊卡、跳过补拍；豆包**同样 low → 维持疑似 → 照常补拍**。未配置/失败 → 返回 null，行为与改动前完全一致。
- **2b. Pl@ntNet 额度用尽 → 豆包顶一线**（用户追加需求）：新增 `doubaoPrimaryVerdict()`（轻量版，
  只产出 hint 所需的 {学名/科/属/confidence/candidates}，比完整复核快且省 token）。降级链：
  **Pl@ntNet（500次/天）→ 429/未配key/失败 → 豆包顶一线 → 豆包也不可用 → 纯 Gemini**。
  `plantNetIdentify` 返回值改为 `{verdict, quotaExhausted}`（**只有 HTTP 429 才算额度耗尽**；
  401/403 是 key 问题、不该让 Pl@ntNet 被长期跳过）。耗尽状态持久化在
  `site_config.plantnet_quota_state = {exhaustedAt}`，命中则直接跳过 Pl@ntNet 不再撞 429；
  **用「1 小时窗口」而非「按 UTC 日期」**——Pl@ntNet 重置时区无明确文档，猜错会整天不恢复。
  一线已是豆包时**跳过疑似复核**（同一模型看同一张图第二遍不会有新结论，白花一次调用）。
- **3. 字段集对齐**：本轮另一会话把 `AI_QUICK_SCHEMA` 精简掉了 `summary_en`/`field_notes_*`（提速）。
  豆包 prompt 已同步只要那批精简字段，**不要**再让它产出 field_notes/英文摘要。
- **4. Pl@ntNet 参数调优**：`no-reject=true`（把握不足也返候选，避免 404）+ `nb-results` 3→5，
  candidates 展示 3→4。**project 仍是 `all`** —— 公共库无中国/内蒙 flora，盲切区域库反而漏本地种。
- **5. 透明留痕**：复核改变结论时写 `ai_payload._second_opinion`（by/model/action=confirm|override/
  from/to/plantnet），**不渲染进卡片**（避免污染 150–260 字导语）；另有 `[SecondOpinion]` 服务端决策日志
  + `ai_usage_logs` 的 provider(`gemini-quick+doubao-vision`)/model 供复盘调参。
- **6. 管理员配置面板**：identify.tsx 新增 `DoubaoPanel`（仿 PlantNetPanel），server fns
  `saveDoubaoConfigFn/getDoubaoConfigFn/clearDoubaoConfigFn` → `site_config.doubao_vision_config`
  = `{apiKey, model, baseUrl}`，**全站立即生效、无需部署**；.env 兜底 `DOUBAO_API_KEY/DOUBAO_MODEL/DOUBAO_API_BASE`。
- **⚠️ 密钥类型（易踩坑）**：推理用**方舟 ARK API Key（数据面 Bearer）**，**不是 IAM 的 AK/SK**（管理面签名用）。
- **⚠️ 模型 ID 命名（已实测）**：方舟用**连字符**——`doubao-1-5-vision-pro-32k-250115`，不是 `doubao-1.5-…`。
  本机 arkcli 实测该 ID **控制面可见但当前账号数据面 NotFound**（`InvalidEndpointOrModel.NotFound`）→
  用户需在自己账号开通该模型，或改填**推理接入点 ID（ep-…）**。arkcli 的 `models list`/`resources list`
  当前因 **Volc SSO STS 过期**不可用（需 `arkcli auth login volc-sso`，未代为执行）。
- **验证**：`tsc --noEmit` = 0 ✅；dev server(5199) `/identify` 加载正常、服务端无报错 ✅。
  **未验证**：豆包端到端（缺可用的 ARK key+模型，且管理面板需 admin 登录）；未部署。
- **⚠️ 用户反馈「面板里看不到填豆包 key 的地方」→ 三个可能原因**（代码本身没问题：`DoubaoPanel`
  就在 `PlantNetPanel` 下一行、同一个 `isAdmin` 门，identify.tsx `:944-945`）：
  ① **改动没部署**（最可能——线上跑的还是旧代码）；② 面板 **admin-gated**，必须以管理员登录；
  ③ **Vite HMR 卡陈旧模块**——本轮亲历：新增导出后 HMR 报
  `does not provide an export named 'clearDoubaoConfigFn'` → `identify.tsx` 组件重载失败 → 面板不渲染。
  `tsc` 通过 + 导出确实存在即可判定是 HMR 陈旧，**重启 dev server + 硬刷新**即可。
- **⚠️ 本轮有另一会话并行改同一仓库**（`draft-enhance.ts` / `share-card.ts` / 上述 AI_QUICK_SCHEMA 精简
  均非本会话所为）—— 提交/部署前先 `git diff` 确认要带上哪些改动。

## ✅ 2026-07-18 部署 + SQL 记录（版本 6e9a105c-59a5-44b9-a0a3-6f66708edfe5）
- **已上线**：续8 全部 5 项（分享卡去名录标签 / 疑似关卡跳补拍 / 不符按钮移到enrich后 /
  enrich自动提交 / 星号清洗写入端+读取端）。
- **SQL 已跑**（用户在 Dashboard 执行 [scratch/cleanup_markdown_and_stuck_drafts.sql](scratch/cleanup_markdown_and_stuck_drafts.sql)，
  报 Success）：存量 plant_drafts/plants 字段星号已清、正文 `*Latin*`→`<em>`、2 份卡死草稿
  （高山榕/圆果黄耆）已补 submitted_for_review=true 进队列。→ 队列/地图/审批复制等所有面现已一致。
- **⚠️ 部署仍是第一次 fetch failed、第二次成功**（GFW 老问题，见 [[deploy-workflow]]）。照例用
  deployments list 对时间戳确认第一次真没上（还停在 07-17T06:44），别看输出想当然。
- **线上实测**：plantspedia.club 韭菜草稿页确认 `葱属 Allium` / `Allium tuberosum…` 无星号 ✅
  （读的是刚跑完 SQL 的库，字段本身也干净了）。
- **仍未验证**：真机 enrich 端到端（确认新 enrich 自动进队列）—— 需登录+花银叶，留给用户。

## 🚧 2026-07-18 (续8) — 用户 3 项 + 2 个连带修复（tsc=0；真实草稿已实测；⚠️ 未部署）
全部落在 [drafts.$id.tsx](src/routes/drafts.$id.tsx) + [identify-plant.functions.ts](src/lib/identify-plant.functions.ts)
+ 新建 [strip-markdown.ts](src/lib/strip-markdown.ts) + [drafts.ts](src/lib/drafts.ts)/[plants.ts](src/lib/plants.ts) 读取端。
1. **✅ 识别分享卡不再印名录卡签**：`onMakeCard` 里**删掉 `chips: registryChipList`**。
   理由（用户）：卡签按物种匹配名录，但一次识别只知道「照片里可能是什么」——内蒙古拍到的未必是
   内蒙古野生植物，可能是园艺栽培/花店盆栽；疑似时连种都没定。印在会转发出去的卡上=替用户断言。
   **只动识别卡**；/plants 详情页的分享卡仍留卡签（那里物种确定、编辑审过）。
2. **✅ 疑似关卡直接跳补拍**：新增 `cardAutoOpened` state（仅「识别完自动弹的卡」为 true，
   用户事后手点「生成分享卡」不算）。`jumpToRetakeOnClose = cardAutoOpened && draftTentative &&
   retakeCount<3`。`closeCard` 里若命中就 `navigate` 去 `/identify?retake&…&pick=1`（补拍建议+两种方式）。
   卡上加预告文案 + 「关闭」按钮变「去补拍」，避免点关闭却被莫名甩走。**真实草稿 c1583858 端到端实测**：
   关卡→直接进补拍界面、带真实建议、第一次补拍、双按钮 ✅。
3. **✅「草稿内容和我的观察不符」从简介卡移到 enrich 后**：拆成两个 section——`notEnriched` 只留
   「保存为待审批草稿」；`!notEnriched && !submittedForReview` 才出「不符」按钮。理由（用户）：快速简介卡
   只有几行，用户无从判断「符不符」，得先点「让AI生成进一步草稿」看到成篇内容才有依据。文案改「读下面的
   完整草稿时…」。**实测**：未enrich草稿(韭菜)只有保存按钮 ✅；已enrich(圆果黄耆)才出不符按钮 ✅。
4. **✅（连带修复 A）enrich 自动进待审队列**：[identify-plant.functions.ts](src/lib/identify-plant.functions.ts)
   enrichDraft 的 update 加 `submitted_for_review: true`。**根因**：UI 一直承诺 enrich 后「自动进入
   待审批草稿库」，但只有「保存为待审批」按钮翻这字段、而它 enrich 后就消失 → **enrich 过的草稿永远
   进不了队列，用户白花 1 枚银叶**。真实数据里已有 **2 份卡死**（高山榕/圆果黄耆，status=pending 但
   submitted_for_review=false）。此改只管**未来** enrich；存量 2 份要跑 SQL（见下）。
5. **✅（连带修复 B）markdown 星号清洗**：模型把 `*Allium tuberosum*`（学名字段）、`葱属 *Allium*`
   （属字段）、正文里的 `*Ficus lyrata*` 全写成字面星号。真实污染面：**22/43 草稿字段脏 + 8/8 已enrich
   草稿正文脏 + 2 物种字段 + 摘要若干**。
   - 新建 [strip-markdown.ts](src/lib/strip-markdown.ts)：`stripInlineMarkdown`（字段去 `* _ ``）/
     `stripMetaMarkdown`（批量清一个 AiMeta）/`markdownEmphasisToHtml`（正文 `*Latin*`→`<em>`，拉丁名本就斜体）。
   - **写入端**：quick 路径 `normalizeIdentification` 开头 + full 路径 `buildDraftContent`（callAiIdentify 后
     清字段、renderDraftHtml 后转 `<em>`）。**读取端防御**：`fetchDraftById` + `fetchPlantBySlug` 就地清
     存量脏数据（详情页+分享卡立即干净，**无需迁移**）。
   - **11 个边界用例浏览器实测全过**：杂交号 `×`/乘号 `3 * 4`/`**加粗**` 都不误伤；圆果黄耆正文 13 处
     `*Astragalus*`→`<em>` ✅、字段星号清零 ✅；韭菜卡片 `Allium tuberosum` 无星号 ✅。
- **⚠️ 需用户在 Dashboard 跑 SQL**（读取端只清了详情页/分享卡两个面；队列/地图/审批复制 draft→plant
  仍读原始 DB）：[scratch/cleanup_markdown_and_stuck_drafts.sql](scratch/cleanup_markdown_and_stuck_drafts.sql)
  —— 洗 plant_drafts/plants 字段 + 正文 `*Latin*`→`<em>` + 补救 2 份卡死草稿。幂等，可先跑 SELECT 看影响面。
- **验证**：tsc=0 ✅；lint 改动文件**无新增**（drafts.ts 8 / plants.ts 18 = HEAD 既有基线；strip-markdown 0）。
- **未验证 / 待办**：真机 enrich 端到端（确认自动进队列）；SQL 未跑；本轮**未部署**。

## ✅ 2026-07-17 部署记录（版本 d6267774-bb9e-4570-b167-1d07ef80fde9）
- **已上线**：续7 全部 5 项 + **前几次会话积压的全部改动**（续2~续6）。两个 commit：
  `be87c76`（续7）+ `c717d5b`（积压收尾）。部署前工作区已清空 → 线上 = main。
- **顺带修好的线上问题**：`wrangler.jsonc` 的 `AI_MODEL` 之前一直是本地未提交状态，
  这次才真正上线为 `gemini-3-flash-preview`（线上此前跑的仍是旧配置）。
- **⚠️ 部署第一次失败**：assets 传完（60 files），最后创建 Worker 版本那步 `fetch failed`
  （GFW 掐流，见 memory）。**关键教训：那次失败后线上仍是旧版**——用
  `wrangler deployments list` 对时间戳确认，别看 "Uploaded 60 files" 就以为成了。
  第 2 次重试成功（161s）。apex 域名 curl 偶发 000 也是同一网络问题，重试即 200。
- **已实测**：线上 `plantspedia.club/identify?retake=2` 截图确认双按钮 / 无取景框 /
  不自动弹相机 / 「摸一摸」条被滤掉并重编号 / 「第二次补拍」文案 ✅。
- **仍未验证（上线了但没测过）**：
  1. **补拍计数修复**（续7 #1）——需真机补拍一次确认「本轮铜叶 +2」「第二次补拍」。
  2. **积压里 /profile 与 /admin 那批**（新建入口、目录就地编辑、项目海报必填）——
     需登录，从未实测，现已直接面向用户。
  3. migration `20260716140000_conservation_lists_created_by.sql` **仍未应用**
     （需 dashboard 手动跑；不影响当前行为：11 份名录 created_by 全 NULL、且无 UI 新建）。

## 🚧 2026-07-17 (续7) — 用户 5 项（tsc=0；/identify + 分享卡 canvas 已实测）
1. **🐛 根因：补拍后「本轮铜叶 +N」和补拍计数全都倒回上一轮** —— 这是用户点名的两项
   （「n 的统计一定要对」「关闭分享卡后补拍计数一定要准确」）的**同一个原因**：
   [router.tsx:9](src/router.tsx:9) 设了 `staleTime: 5min` + `refetchOnWindowFocus: false`。
   补拍是**合并回同一份草稿**（merge_draft_id）→ 跳回 `/drafts/$id` 时 query key `["draft", id]`
   **命中缓存、根本不 refetch** → 页面拿到的是补拍前的旧草稿（`retake_count` 还是 0、ai_payload
   还是上一轮的「疑似」）。分享卡是 draft 一到就自动生成的，于是按 N=1 画出去，关卡后的补拍
   横幅也倒回「第一次补拍」。
   - **改法**（[camera-identify.tsx](src/components/camera-identify.tsx) `onSubmit`）：跳转前
     `qc.removeQueries(["draft", newId])` + `removeQueries(["leaves", uid])`。用 remove 不用
     invalidate：invalidate 仍会先渲染旧数据再刷新，分享卡照样会用旧值画一次。
   - **⚠️ 未端到端实测**：跑通需真识别（Gemini key + 相机）。根因是从 staleTime 配置推出来的，
     计数公式本身（`earned = tentative ? 1 : 1 + retake_count`）与服务端 `identifyBronze` 一致，
     早就是对的 —— **错的是喂给它的数据**。建议用户真机补拍一次确认。
2. **✅ 分享卡版式**（[share-card.ts](src/lib/share-card.ts)）：头像 80→**120**（+50%）；
   「X 发现了一种新植物」与「本轮铜叶+N / 叶章统计」行距 38→**54**；**摘要改为居中坐在
   发现者区与页尾分割线之间、上下留白等距**（不再是「接着往下排」）。
   - **实测**：浏览器里真跑 `renderShareCard`，把 PNG 画回 canvas **逐行扫描量白** →
     摘要上方 98px / 下方 95px（3px 来自字高估算，肉眼无感）✅。已测「疑似+访客+短摘要」
     与「正常+登录+长摘要」两种版面 ✅（已截图）。
   - **⚠️ 排版是「两头钉死、照片吸收余量」**：页尾固定、摘要按行数预留、照片吃剩余空间
     （420 下限）。**改任一块高度都要同步 `photoBudget`**，否则摘要会被挤掉。
3. **✅ 补拍不再自动弹相机 + 取景框藏起来**：用户原话「目前的设计容易让人困惑不知道该点哪里」。
   横幅给**两个按钮**（打开相机补拍 / 上传相册补拍，竖排），`hideViewfinder = retakeMode &&
   phase==="idle"` 把取景框+快门整块藏掉；选完照片后照常显示预览。
   - **自动弹相机的逻辑整个删掉了**（原来只有 `pick=1` 才不弹）—— 弹出来会盖住那两个按钮，
     等于替用户做了选择。`RetakeContext.pick` 现在**不再影响行为**，保留只为兼容已发出的链接。
4. **✅ 非视觉补拍建议（摸一摸 / 闻一闻）双端拦截**：新建
   [retake-advice.ts](src/lib/retake-advice.ts)（生成端与展示端**同源**）。
   - prompt 两处（快速识别 + 完整草稿）都加了硬性禁令；但 prompt 会漂 → 再加确定性过滤
     `keepVisualAdvice()`：按 ①②③ 拆条、整条丢掉非视觉的、**重编号**（否则留下「① …；④ …」
     的窟窿序号，看着像 bug）。
   - **展示端也过一遍**（草稿页横幅 + /identify 建议框）：**库里的旧草稿仍存着旧文案**，
     只改 prompt 管不到它们。
   - **🐛 差点踩的坑（已实测发现并修）**：`尝` 会误杀「**尝试**换个角度拍」这类正当建议 →
     改 `尝(?!试)`；末条被丢掉后前一条的「；」会孤零零留在结尾 → 一并收掉。
     浏览器里对 8 个用例逐个验过 ✅。
- **验证**：tsc=0 ✅；lint 改动文件**无新增**（camera-identify 115 = 改前基线，share-card /
  drafts.$id / retake-advice 均 0）。`/identify?retake=1|2|3` 浏览器实测：双按钮 ✅、取景框不出现 ✅、
  相机没自动弹 ✅、第一次/第二次/最后一次补拍文案 ✅、「摸一摸」条被滤掉且重编号为 ①② ✅；
  普通 `/identify`（非补拍）取景框+快门照常 ✅（均已截图）。
- **未验证**：真机补拍端到端（见 #1）、/drafts/$id 需登录 + 真草稿。

## 🚧 2026-07-16 (续6) — 用户 4 项（tsc=0；/identify + 分享逻辑已实测）
1. **✅ 项目封面海报改为「仅发布必填」**（用户 AskUserQuestion 明确选了「草稿可空」）：
   `requiredMissing(publish)` —— 只有 publish 才校验 cover，按钮文案改「+ 添加封面海报（发布必填）」。
2. **✅ 保护名录删除按编辑归属**（新 migration
   [20260716140000_conservation_lists_created_by.sql](supabase/migrations/20260716140000_conservation_lists_created_by.sql)）：
   `conservation_lists` 加 `created_by`；RLS 保留 admin(owner) 全权 + 新增「created_by = auth.uid()」策略。
   前端 `canDeleteConsList(l) = isAdmin || l.created_by === user.id`，与 RLS 同源。
   - **⚠️ 必须手动应用**（hosted 项目、无本地 CLI → dashboard 跑 SQL）。types.ts 已手改加 created_by。
   - **📌 现实约束**：现有 11 份名录都是播种的、`created_by` 为 NULL → **实际仍只有 admin 能删**。
     且**目前没有任何 UI 能新建保护名录** → 归属策略暂时是「为将来预留」，不是马上可见的行为变化。
3. **✅ 分享卡同时带图 + 链接**（[share-card.ts](src/lib/share-card.ts) `shareOrSaveImage`）：
   - **根因（(续2)#1 的修复没覆盖到的情形）**：旧码只在平台**当场拒绝** payload 时才把链接折进 text。
     但微信/小红书/短信/邮箱是**接收端静默吞掉 `url`、share() 照样 resolve** → 检测不到、也无从回退。
   - **改法**：链接**同时**放 `url` 和 caption text（故意重复）。裸 URL 在 caption 里能活下来，
     这些 App 都会自动转链接。代价：认 `url` 的目标会看到链接出现两次。另加剪贴板兜底 + toast 文案。
   - **实测**（浏览器内 stub navigator.share/canShare，真跑 share-card.ts）：A 全放行→url 字段 ✅
     且链接在 text 里 ✅；B 拒绝 url→链接仍在 text ✅；C 用户取消→cancelled、不误落下载 ✅。
   - **⚠️ 仍无法验证**：微信/小红书**真机上到底会不会连 caption 一起吞**——那是它们分享扩展的行为，
     站方控制不了。这次是「最大化命中率 + 剪贴板兜底」，不是保证。
4. **✅ AI 草稿岔路口 + 补拍双入口**：
   - **前提澄清**：草稿**本来就不会自动进待审批**（`submitted_for_review` 才是闸门，drafts.$id.tsx:340）。
     所以这项实质是「把另一条岔路补上」。
   - [drafts.$id.tsx](src/routes/drafts.$id.tsx)：简介卡下方从单按钮改为两个——「保存为待审批草稿」
     +「草稿内容和我的观察不符」（→ /identify?retake=N&md=id&**pick=1**）。**对每份草稿都给**，
     不像上面的补拍横幅只在 AI 自称「疑似」时出现（AI 笃定却认错，恰恰最该让用户纠正）。3 次上限同源。
   - [camera-identify.tsx](src/components/camera-identify.tsx)：补拍横幅加第二个按钮
     「选择相册图片补充判断」（复用既有 `openAlbum` + `GalleryIcon`）。**两条路都走同一个 onSubmit、
     retake_count 取自 retakeCtx → 天然都记一次补拍**，无需额外改动。
   - **新 search 参数 `pick=1`**：不自动弹相机（否则相机会盖住那两个按钮）。**「按提示去补拍」老路径
     不带 pick → 仍自动弹相机**，保持原有少一次点击的体验；两条路径的横幅都有双按钮。
- **验证**：tsc=0 ✅；lint 改动文件**无新增**（camera-identify 113 / project-editor 13 是 HEAD 既有
  prettier 噪音，改前改后一致；其余改动文件 0）。`/identify?retake=1&pick=1` **浏览器实测**：
  双按钮 + 建议框 + 「两种方式都记作一次补拍（第一次补拍）」+ **相机没有自动弹** ✅（已截图）；
  `retake=3` 无 pick → 双按钮 + 「最后一次补拍」文案 ✅。
- **未验证**：/drafts/$id 岔路口（需真草稿 + 登录）、真机分享到微信/小红书、migration 未应用。

## 🚧 2026-07-16 (续5) — 用户 6 项（tsc=0；/blog 已实测，登录后的页面未测）
1. **✅ 导航「编辑内容」→「添加/编辑内容」**（site-header ×2 + admin h1）。
2. **✅ 导航「编辑博客」→「博客 blogs」**（site-header ×2）。**顺带同步了 /blog 的 h1 与 meta title**
   ——用户只点名导航，但「编辑博客」在标题位读作动词，留着会和导航打架。
3. **✅ /blog 按编辑姓名归类**（[blog.index.tsx](src/routes/blog.index.tsx)）：`author_name` 分组，
   组内保持原时间倒序；**组的排序用「篇数多的在前、同数按姓名」**，不用最新发文时间——否则每发一篇
   列表顺序就跳。条目里的作者名删掉了（已是分组标题，否则同名重复一遍）。
4. **✅ 我的主页每栏加「+ 新建」入口**（[profile.tsx](src/routes/profile.tsx)）：博文→写新博文、
   项目→发布新项目、skill→上传新的 skill 条目、地方目录→新增地方目录、tag→+ 新 tag 标签。
   - **⚠️ 结构改动**：`WorksSection` 的表头原本整行是一个 `<button>`；按钮不能嵌套按钮 →
     改成 `<div>` 包「折叠 button（flex-1）+ action」。加新栏时别把 action 塞回 button 里。
5. **✅ 地方目录就地增删改**：把 admin 的 `CatalogRow` **抽成共享组件**
   [catalog-row.tsx](src/components/catalog-row.tsx)，profile 与 admin 同用（展开→删条目/追加）。
   - **🐛 顺手修掉一个潜伏 bug**：profile 和 admin **共用 query key `["my-catalogs", uid]`
     但返回两种不同形状**（profile 返回裸 `RegionalCatalog[]`，admin 返回带 `count`/`entryNames` 的）。
     谁先加载谁决定缓存 → 若 profile 先跑，admin 的 `c.entryNames.filter` 会 **throw**（白屏）。
     已统一抽成 `catalogs.ts → fetchMyCatalogs(uid)`（`MyCatalog` 类型），两处同源。
6. **✅ 项目封面改必填**（[project-editor.tsx](src/components/project-editor.tsx)）：
   「+ 添加封面图（可选）」→「+ 添加封面海报（必填）」，`requiredMissing()` 加 cover 校验
   （紧跟标题之后）。**注意：`save()` 存草稿也走 requiredMissing** → 存草稿现在同样要求海报，
   与既有的时间/地点/主题/发起人必填行为一致。
- **验证**：`tsc --noEmit` = 0 ✅；`/blog` **浏览器实测**：标题「博客 blogs」、导航「博客 blogs」、
  按作者「吉木 2 篇」分组、条目只剩日期 ✅（已截图）。**库里目前只有 1 位作者** → 多组排序未获真实数据验证。
  **未测**：/profile 与 /admin 都要登录，Claude 不能代输密码 → 新建入口、CatalogRow 就地编辑、
  项目海报必填**均需用户自测**。

## 🚧 2026-07-16 (续4) — 编辑台（/admin）改版（tsc=0；⚠️ 未部署、未登录实测）
用户一次提 5 项，全部落在 [admin.index.tsx](src/routes/_authenticated/admin.index.tsx) +
[site-header.tsx](src/components/site-header.tsx)：
1. **✅ 导航「添加新内容」→「编辑内容」**（site-header 桌面版 + 移动菜单各一处；admin 页 h1 同步）。
2. **✅「条目列表」→「内容列表」**。
3. **✅ 国家重点 / 地方保护目录并入「地区植物目录」栏**：这两类**不在** `regional_catalogs` 里，
   而是 `conservation_lists` 里 `kind='protected'` 的行（国家2021 + 内蒙古/海南/云南/四川/广东/贵州/福建）。
   新增 `ConservationListRow`（可展开读物种、按 `protectedListRank` 国家在前）。数据走既有
   query key `["conservation-data"]` → 全站只拉一次、吃缓存。
4. **✅ 新栏「国际生物多样性保护」** = `conservation_lists` 里 CITES / GRIIS / GTS 三份；
   类别下拉同步加 `global` 选项。
5. **✅ 所有栏默认折叠**：`CollapsibleSection` 初始 `open=false`，新增 `autoOpen`（关键词在该栏
   命中才展开）+ `scrollTo`（第一个命中栏 `scrollIntoView`）；清空搜索会重新折叠。
- **⚠️ 删除权限的既有约束（用户要求「添加这些目录的编辑也可以在这里删除」→ 只能做到 admin）**：
  `conservation_lists` **没有 `created_by` 列**，名录是 migration 播种的、**不存在「添加它的编辑」**；
  且 RLS 是 `Admins manage conservation lists`（admin-only 写）。故删除按钮 `canDelete={isAdmin}`。
  若要按编辑归属，需先加 `created_by` 列 + 改 RLS（**已向用户提出，待答复**）。
- **删除语义**：删名录 = 删 `conservation_lists` 行，`conservation_taxa` 有 ON DELETE CASCADE
  → 物种行一并没；confirm 文案已写明「全站卡签与检索都会失去该名录」。
- **渲染上限**：国家（2021）单份 ~1000 taxa → 展开只画前 `CONS_ROW_CAP=200` 条并提示总数；
  有关键词时展开视图**只列命中的**物种（否则命中项被埋）。名录是播种参考数据 → 展开视图**只读**
  （不像 regional_catalogs 那样能逐条删/追加）。
- **验证到哪一步**：`tsc --noEmit` = 0 ✅；vite 转译该路由模块 200、console 0 error ✅。
  **未做**：/admin 是 `_authenticated`，需登录才能看，Claude 不能代输密码 → **UI 未实测**，
  需用户自己登录后核对（尤其：折叠/搜索跳转、保护名录行、删除按钮可见性）。

## 🚀 2026-07-16 部署记录 — Version `9aa87f8e-1378-4efd-807e-21a8f4514d2b`
**本次部署把 (续2) 的 5 项优化一并送上线**（它们此前标 NOT deployed）——因为 `npm run build`
**打包的是整个工作树、不是 git HEAD**，22 个未提交文件必然搭车。已事先确认并获用户同意。
- **wrangler.jsonc 核对结论（部署前的前置检查）**：未提交改动**只有 `AI_MODEL: gemini-2.5-flash →
  gemini-3-flash-preview`**，部署配置（Workers + 两个自定义域）完好、未被碰。
  **⚠️ 关键：这行必须带上**——(续) 已查明 Google 对新 key 停用了 gemini-2.5-flash（404），
  线上早已跑 gemini-3-flash-preview；若不带此改动部署会**回退致识别功能 404 崩掉**。
  部署输出已确认 `env.AI_MODEL ("gemini-3-flash-preview")` ✅。
- **线上验证**：plantspedia.club / www 均 **200** ✅；肉苁蓉详情页卡签实测
  **国家二级保护 · 内蒙古省级保护 · CITES 附录II** 三签齐全、颜色分级正确（保护绿/CITES 紫）✅（已截图）；
  console **0 error** ✅。**该页学名带命名人 `Ma, 1960`（AI 原文为斜体）→ 顺带证明 markdown 剥离修复线上是活的。**
- **仍未验证**（本次也无法验证，需登录/Gemini 真识别）：简介摘要卡的卡签、profile / admin 两页。
- **✅ 已改**：[CLAUDE.md](CLAUDE.md) Stack 段的 `AI_MODEL` 过时值已更正为 `gemini-3-flash-preview`（commit `742d577`），
  并写明**不要「恢复」成 2.5-flash**（preview 模型在生产上看着像事故、容易被好心改回去，改回去=识别在轮换 key 上 404）
  + 指明 DB `site_config.ai_model_config` 才是线上生效值、wrangler.jsonc 只是兜底默认。
- **顺带核对（无需改）**：`identify.tsx` / `xiaop-user-model.ts` 里的 `gemini-2.5-*` 是**下拉选项列表**条目，
  `defaultModel` 已是 gemini-3-flash-preview → (续) 说的「默认值同步换」属实，代码无残留问题。

## ✅ 2026-07-16 (续3) — 杂交学名归一化（代码 + 库内数据，均已验证）
接续 (续2) #3 里挂着的「另立任务」。**根因不止一处，两侧都坏**：
1. **JS 侧**：`normalizeSciName`（catalogs.ts）把 `×` 换成 `x` 再取前两个 token →
   `Salix × matsudana` → **`salix x`**（× 占掉了种加词位）。
2. **⚠️ 库侧同样坏（这才是关键）**：`conservation_taxa.normalized_name` 是**存储列**，
   而 scratch/ 里 4 个 seed 生成器各自**手抄了同一份错误逻辑**（其中一个注释还自称
   "Mirror of JS normalizeSciName"）→ 坏 key 被写进库。conservation.ts 用**存储的**
   normalized_name 建索引、用 normalizeSciName 查 → **只改 JS 不管用**，只是换个 key 落空。
- **规范形式决定**：先按要求查了库里怎么存杂交名——**它根本没保留杂交标记**（存的是 `populus x`），
  所以没有可保留的信息 → **直接丢弃标记**：`Populus × irtyschensis` → `populus irtyschensis`
  （连写 `×irtyschensis`、ASCII `x`、杂交属 `×Chitalpa` 都覆盖）。**安全性依据**：杂交种加词在属内唯一，
  丢标记不会合并两个分类群。而**旧写法比想象的更糟**：它把同属所有杂交种压成同一个 `<属> x` key
  → 既漏报又**误报**（任何 Populus 杂交种都会继承 Populus × irtyschensis 的标签）。
- **改动**：① `catalogs.ts normalizeSciName`（× ✕ ⨯ → 空格；再滤掉独立 `x` token）；
  ② scratch/ 4 个 seed 脚本 `norm()` 同步 + `gen_cites_griis.py norm_genus()`（原本 `×Chitalpa`→`xchitalpa`）；
  ③ **库内 3 行已回填**（migration `20260716120000_fix_hybrid_normalized_name.sql`，按 scientific_name 匹配、幂等）。
- **⚠️ 合并注意**：本次修复与 (续2) #3 的 markdown 剥离（`[*_]`）**在同一个函数里**，已合并共存，
  叠加场景（AI 写的斜体杂交名 `*Populus × irtyschensis*`）实测通过。改 catalogs.ts 时别只保留其中一个。
- **验证**（真库真数据；函数从源文件抽取、非手抄副本）：
  - 端到端：`Populus × irtyschensis` → **国家（2021）二级** ✅；`Poncirus × polyandra` → 国家二级 ✅；
    `Sonneratia × gulngai` → **海南（2024）省级** ✅；连写/ASCII 变体同样命中 ✅；
    对照组 `Ammopiptanthus mongolicus` 标签照常（无回归）✅。
  - 全表复查：1982 条 species 行，存储 key 与函数输出**不一致 0 处**；残留 `<属> x` key **0 个** ✅。
  - Python/JS parity：4 脚本 × 16 用例（含 markdown + 杂交叠加）全一致 ✅。tsc=0 ✅。
- **📌 事实澄清（勿被原报告误导）**：`catalog_entries` **是空表（0 行）**，`plants` 里**也没有任何杂交名植物**
  → 此修复目前是**填潜伏坑**，线上暂无可见变化；报告里「没有目录归属」的症状当前观察不到。
- **⚠️ 执行小插曲**：首次跑 update 时 fetch failed（老毛病 ECONNRESET），但 Populus 那行**其实已写入成功**；
  因为是按 scientific_name 匹配的幂等写法，重跑无副作用。按项目规矩只重试 1 次即停。

## 🚧 2026-07-16 (续2) — 用户 5 项优化（#1#2 DONE tsc=0 已验证；#3#4#5 进行中；⚠️ NOT deployed）
用户一次提 5 项。按项目规矩逐条做 + 逐条验证 + checkpoint。
1. **✅ #1 分享卡分享带链接**（share-card.ts `shareOrSaveImage`）：**根因**=旧码只 `canShare({files})` 检查、却发
   `{files,text,url}`——iOS Safari/Android Chrome 拒绝 files+url 同发 → **url 被静默丢弃**，对方只收到图。
   **修复**=分级尝试：① 先探 `canShare({files,text,url})` 全量（支持则图+真链接卡同发）；② 被拒则把链接折进 `text`
   （所有接收端都会把裸 URL 自动转链接）；③ 无 share API（桌面）→ 下载图 + **链接写进剪贴板**。toast 文案同步。
   - **本地实测**（stub navigator.share/canShare 五场景）：A 全支持→图+url 都发；B share() 抛 files+url 错→自动降级、
     链接进 text ✅；C canShare 过滤 url→同上 ✅；D 用户取消→返回 cancelled、**不误落下载** ✅；E 桌面→downloaded+剪贴板 ✅。
2. **✅ #2 AI 草稿配图覆盖 叶/花/果/植株/生境 + 去重 + 标本兜底**（identify-plant.functions.ts `fetchSpeciesPhotos`）：
   - **iNat 标注 term id 是查实的**（`/v1/controlled_terms`，非猜）：**36/38=Green Leaves**、12/13=Flowers、
     12/14=Fruits or Seeds、**12/21=No Flowers or Fruits（营养期→植株/生境）**。（原码注释说 term_id=12 是「Plant
     Phenology」，实际 label 是「Flowers and Fruits」。）
   - **⚠️ 关键实测发现**：本站关心的鄂尔多斯稀有种**标注池几乎是空的**——沙冬青 leaf=1/flower=0/fruit=0/植株=0，
     但**通用池=20**。故标注池只能当**加分项**，绝不能当唯一来源，否则稀有种直接无图。
   - **实现**：5 池（叶/花/果/植株/通用）→ **Pass A** 每个部位各保底取 1 张（新 `takeOne`，稀缺的果→花→叶→植株优先）
     → **Pass B** 用既有 pickDiverse（place/season/who/part 四轴）填满剩余。
   - **性能**：5 池 × per_page=40 会拉 >10MB JSON/次（iNat 单条记录 ~60KB）→ 标注池降到 **per_page=15**（Pass A 只取 1 张），
     通用池保持 40（它是填充主力）。
   - **新增最后兜底层**（仅前面都不够时）：GBIF `basisOfRecord=PRESERVED_SPECIMEN` 标本台纸 + Commons
     「illustration / botanical illustration / line drawing」插图线描。排在最后=活体照永远优先。
   - **真实 API 实测**（scratchpad/verify_pick.mjs，走代理打真 iNat）：蒲公英池全载时 → **果·花·叶·通用·果**，
     5 张拍摄者/地点全唯一 ✅；沙冬青（池真空）→ 叶+4通用，拍摄者/地点全唯一 ✅。
   - ⚠️ 本地代理会截断 iNat 大响应（2.5MB）致个别池取 0——**是本地网络现象，非代码**；线上 Workers 直连不受影响。
3. **✅ #3 GRIIS/CITES/GTS/地区名录/tag 统一卡签（四面同源）**：
   - **新增** `conservation.ts → registryChips(hit, lists, {catalogNames, tags})`（**含 GRIIS**；原
     `conservationBadges` 保持不动=绿色保护卡仍排除 GRIIS）；`components/registry-chips.tsx`（React 卡签行，
     保护=绿/CITES=紫/GTS=金/GRIIS=红/名录·tag=中性，tag 可点跳 /tags）；`lib/use-registry-chips.ts`（hook，
     **复用既有 queryKey** ["conservation-data"]/["all-catalogs"]/["all-catalog-entries"] → 全站只拉一次）。
   - **四面接入**：① 详情页 plants.$slug.tsx（HTML 分支=顶栏下独立带；经典分支=标题下。**顺带删掉页尾重复的
     tag 块**——tag 已并入卡签行，否则同页出现两次）；② 分享卡 share-card.ts（canvas 画 pill，自动换行 + 计入
     照片高度预算，palette 加 `cites` 色）；③ 草稿页 drafts.$id.tsx（学名下方）+ 其分享卡传 chips；
     ④ 简介摘要卡 = 服务端 `lookupRegistryChips()` + `registryChipsHtml()` 烤进 html_content（quick 路径原本
     **完全没查过名录**）。
   - **🐛【重大既有 bug，实测确认并已修】`normalizeSciName` 不剥 markdown 斜体**：AI 草稿的学名普遍写成
     `*Cistanche deserticola* Ma, 1960`（抽样 8/8 全带星号）→ 归一化成 `*cistanche deserticola*` →
     **匹配名录 0 条**；去掉星号的同名 → 匹配 3 条。**即所有 AI 草稿的名录匹配一直在静默失败**——不只卡签，
     连既有的**入侵警示卡 / 保护卡 / 地图入侵三角标**都受影响。修法=`.replace(/[*_]/g,"")`（catalogs.ts，
     一处修复覆盖 conservation + catalog 全部匹配面）。
   - **本地实测**（浏览器打真库）：肉苁蓉→国家二级保护·内蒙古省级保护·CITES 附录II ✅（详情页截图确认）；
     香附子→入侵物种 ✅；火炬树→外来·已建群 ✅；艾→无命中 ✅（正确）；`Isoëtes sinensis`→国家一级保护
     ✅（变音符号折叠无回归）；分享卡 6 卡签两行换行 + 颜色 + 摘要仍完整 ✅（截图）；草稿页 tag 卡签 ✅（截图）。
   - **⚠️ 简介摘要卡的卡签未本地验证**（需 Gemini 跑真识别，本地 geo-block）→ 部署后拍一张肉苁蓉/香附子确认。
   - **✅ 杂交学名归一化（原「另立任务」，已做完，见下方 (续3)）**：`Salix × matsudana` → `salix x` 已修。
4. **✅ #4 个人主页重排 + 管理页改名/搜索命中定位**（tsc=0；⚠️ 两页都**需登录**，未能目视验证）：
   - **profile.tsx 重排**为用户指定顺序：我的博文(≤4) → 我的项目(≤4) → 我创建的 skill 条目(≤8) →
     我的识别(≤8) → 我添加的地方目录(默认折叠) → 我添加的 tag 标签(默认折叠)。
     新查询：`fetchMyProjects` / `regional_catalogs by created_by` / `fetchAllTags` 过滤 created_by。
     **skill 条目 = 非 AI 来源**（排除 ai_identify/gold_oneclick/draft_merge，避免和「我的识别」重复计）。
     `WorksSection` 重写：标题可折叠(defaultOpen) + `max` 上限 + 「展开全部 N 条」；children 支持
     render-function 拿 `visible()` 切片器（切片逻辑收在一处，不必每栏重复）。
   - **管理页改名**：`admin.index.tsx` h1「我的条目」→**「添加新内容」**；site-header.tsx 桌面+抽屉两处
     导航「管理」→**「添加新内容」**。
   - **搜索命中定位**：新增 `stripHtml`/`excerpt`/`SearchHit` + `Hit<T>{item,where}` 结构。现在
     ① **目录**：关键词比对**目录内条目学名/中文名**（myCatalogs 查询多 select 了 entry names）→
     显示「命中目录内 N 个物种：甲、乙、丙 等」；② **博客/项目**：比对**正文** content_html（先剥标签）→
     显示「命中正文：…关键词前后 18 字…」；项目还比 地点/主题/发起人/摘要 → 「命中主题：xxx」；
     ③ **tag**：比对 slug 别名 → 「命中标签别名」。命中标题/名称时**不显示**提示（避免噪音）。
   - **⚠️ 验证限制**：profile/admin 均 auth-gated，我无法登录（不输密码）。已确认：**tsc=0** +
     两个路由模块**编译并执行成功**（profile 正常渲染「需要登录」分支）+ **控制台/服务端零报错**。
     真机需登录后核对：六栏顺序/折叠/展开全部、导航与标题改名、搜关键词看「命中：」提示。
5. **✅ #5 「修改记录」→ Log，分修改/创建两类**（tsc=0；分类逻辑已用真库实测）：
   - **🐛 关键发现（实测 plant_edits.kind 真实分布）**：库里**只有** create(251) / html_save(12) /
     draft_approve(10) / text(9) / image(13) / draft_reject(1) / merge(1)。
     **blog_publish / blog_edit / draft_text / draft_image / ai_page_edit / catalog_create / tag_create
     一条都没有** —— 印证 [[plant-edits-kind-constraint]]：窄 CHECK 约束把它们全挡了、insert 又是
     `.catch` 静默吞掉。**且 AI 草稿 / 项目 / 评论从来就没往 plant_edits 写过。**
   - **因此设计**：创建记录**不能只读 plant_edits**。新增 `fetchDerivedCreations(userId?)` —— 从**源表重建**
     （plant_drafts / blog_posts / projects / plant_comments），每源 try/catch 独立降级。
     好处：**无需迁移**、且历史**回溯完整**。合成行 id 前缀 `derived:`。
   - **新增** `logCategory(kind)` + `CREATE_KINDS`（create/catalog_create/tag_create/blog_publish/draft_approve）。
     其余（text/image/html_save/revert/draft_*/ai_page_edit/blog_edit/branch/merge）= 修改记录。
   - **两处 UI**：① `edit-log-section.tsx`（页内 Log）标题「修改记录 · Change log」→**「Log」**，展开后两个
     可点切换的标签 + 「点击标题切换」提示；「注 N」定位时**自动切到该条所在类**（否则展开也看不到它）。
     ② `/edits` 页：h1「修改记录」→**「Log」**、meta 标题、nav（桌面+抽屉）→「Log」；两标签切换；
     创建记录 = plant_edits 创建类 **+ derived**，按时间合并排序。
   - **⚠️ 防坑**：derived 行不是真实日志（无快照、id 不在表里）→ 已屏蔽其**撤销按钮 / 批量勾选 / 批量撤销循环**
     （`isDerived = id.startsWith("derived:")`）。否则 blog_publish 会走进 isCatalog 分支露出「撤销」按钮、
     点了就是去撤一条不存在的记录。
   - **实测**（浏览器打真库）：创建记录 **295 条**（create/draft_approve/blog_publish，含 **34 条 derived**=
     31 草稿+2 博客+1 评论）；修改记录 **36 条**（text/html_save/image/merge/draft_reject）；
     **derived 零泄漏进修改类** ✅；`/edits` 页渲染 + **标签点击切换实测生效** ✅（截图）。
   - **⚠️ 未验证**：/edits 与页内 Log 的**登录态列表**（需登录）；projects 表本地查为空/不存在（try/catch 已降级）。

### ⏳ 本批 5 项待办
- **未部署**：`npm run build && ./node_modules/.bin/wrangler deploy`（**用户未要求部署本批，先问再发**）。
- **需登录真机核对**：profile 六栏顺序/折叠、管理页改名+「命中：」提示、Log 两类列表、简介摘要卡卡签（需跑真识别）。
- **无新迁移**（derived 方案刻意绕开了 kind CHECK 约束）。

## 🆕 2026-07-16 (续) — Gemini 2.5 下线换 gemini-3-flash-preview + 分享卡摘要保 140 字（DONE, tsc=0, 本地已验证；✅ DEPLOYED `d587dc9d-c70e-40af-8eb3-b20c935285e6`，第 1 次 fetch failed 重跑即成，两域名 200）
1. **AI 识别/生成 404 根因**：Google 把 `gemini-2.5-flash`（及 2.5-flash-lite）对**新 key 停用**（"no longer
   available to new users"）。实测（scratch/test_keys.mjs + test_model_switch.mjs，走代理）：key#1（老）2.5-flash 仍 200，
   key#2（新）404 → 轮换到 key#2 就炸。`gemini-3-flash-preview` 在**两个 key 上都 200** ✅。
   - **✅ DB 已改（线上立即生效，无需部署）**：`site_config.ai_model_config.model` gemini-2.5-flash → **gemini-3-flash-preview**；
     `xiaop_model_config.model` **gemini-3.5-flash（不存在的模型！07-13 的雷没清干净）** → gemini-3-flash-preview。
   - **代码默认值同步换**（防「恢复默认」回退）：wrangler.jsonc AI_MODEL、identify.tsx PROVIDERS/useState、
     xiaop-model-panel.tsx 同上、xiaop-user-model.ts providerMeta、identify-plant.functions.ts 全部 8 处
     `process.env.AI_MODEL || "…"` 兜底、draft-agent-panel.tsx 文案。.env 无 AI_MODEL（已确认，只查了 key 名存在性）。
2. **分享卡摘要不足 140 字就"…"截断**：根因 = share-card.ts 摘要区高度是「正方形大图画完剩多少算多少」，
   动态 maxLines 常只剩 2 行（~60 字）。**修复**：新增 `countWrappedLines()` 预量摘要行数（≤140 字 + ……），
   照片高度按 `photoBudget` 收缩（上限 CW 正方形、下限 420px）为摘要让位；摘要 maxLines 只作 420 下限时的保险。
   - **本地实测**（fillText spy + 截图）：176 字输入 → 画出 **140 字整、5 行、「……」只在第 140 字后**；短摘要（28 字）
     → 1 行、无省略号、照片保持大图。
- **⚠️ 待部署**：`npm run build && ./node_modules/.bin/wrangler deploy`（分享卡修复 + 代码默认值上线需要它；
  **AI 识别已因 DB 改动即刻恢复**，可先真机试识别）。

## 🆕 2026-07-16 — 用户 6 项批量优化（DONE code, tsc=0; ✅ DEPLOYED `8e0ecf22-4ab6-49b6-bbef-dda21d1110bd`，一次过）
一次会话完成 6 组改动。**均 tsc=0 + prettier 格式化**。上一批（07-15 的 5 项：token 统计/分享卡/深色多语言/金叶后台/图片稳定）已部署 `861e1125`。
本批未部署。
1. **分享卡** (`share-card.ts`)：① 140 字摘要溢出改**省略号「……」收尾**，删掉「（访问 plantspedia.club…）」那行（STRINGS.readFull 已删）；
   ② 摘要行数**动态限制**（`maxLines = floor((footerLineY-72-y)/lineH)`）→ 分割线/邀请文案不再紧贴正文；③ 页尾副标题「一起认识…」字号 22→**30px**（与摘要正文等大）。本地实测卡片正常渲染无报错。
2. **草稿页** (`drafts.$id.tsx`)：「保存为待审批草稿」按钮移到**简介摘要卡正下方**（原在「让AI生成」CTA 之后），并**删掉按钮下方说明文字**。
3. **银叶草稿模板** (`plant-html-template.ts`)：① 章节重排 名称溯源→移到 **人文之后、生长条件之前**（新序 I 形态 · II 生境 · III 人文 · IV 名称溯源 · V 生长条件，罗马数字已重编）；
   ② **养护建议→生长条件**（h2 + English「Growth Conditions」+ alt + care-why 文案）；③ **配图覆盖**：`fetchSpeciesPhotos` 改多池抓取——iNat 通用池 + 花期(term_id=12,value=13)池 + 果期(value=14)池，`pickDiverse` 新增 `part` 轴，让 5 张配图跨 叶/花/果/株型/生境 分布（GBIF cands 补 `part:""`）。
4. **识别/补拍** (`identify-plant.functions.ts` + `drafts.$id.tsx` + `plant-html-template.ts`)：
   ① **多图判定**：`identifyQuick` 新增 `priorPhotos` 参数，补拍时把之前的照片（fetchInlineImages，≤4 张）连同新图一起发给 Gemini，综合所有角度判定；
   ② **序数计数**：`retakeOrdinalLabel` 第三次显示「最后一次补拍（第三次补拍）」；
   ③ **补拍建议质量**：AI_QUICK_SCHEMA + full schema 的 needs_more_photos 描述 + system prompt 加「每条瞄准最能一锤定音、区分易混种的关键部位」；
   ④ **疑似注**：模板 hero 加 `{{tentative_note}}`——当 identification_confidence=low（3次补拍仍存疑走 forceResult 置 low）或 summary 以「疑似」开头时，拍摄记录配图下显示小字「（基于疑似识别创建资料）」。摘要卡保留疑似=既有 normalizeIdentification 逻辑。
5. **管理页** (`_authenticated/admin.index.tsx`)：搜索框**右边加类别筛选下拉**（全部/skill创建条目/AI识别条目/地区植物目录/tag标签/博客/项目）；正文改为**按类别折叠区块**（新 `CollapsibleSection` 默认展开可折叠 + `PlantsTable` + `Empty`）。plants 按 source 分 skill vs AI（AI=ai_identify/gold_oneclick/draft_merge）；新增 blog(fetchMyPosts)/projects(fetchMyProjects) 查询。
6. **模型控制台** (`identify.tsx AdminModelPanel` + `xiaop-model-panel.tsx`)：① 默认**折叠**（AdminModelPanel isOpen true→false；小P本就 false）；② showKey 默认**显示**；③ 服务端 `getAiConfigFn`/`getXiaoPConfigFn` 新增返回 **`apiKeys: string[]`（完整 key，admin-only）**；④ 前端 seededRef+useEffect 把已存的 provider/keys/model/baseUrl **回填进可拖动排序的表单**，owner 展开即见全部 key 可拖动调优先级。
- **未本地验证的**：银叶章节/配图、补拍多图判定、疑似注、补拍建议（都需 Gemini + 登录 + 真实识别，本地 geo-block）；管理页折叠/下拉、模型控制台回填（需 admin 登录）。分享卡已本地实测渲染。
- **部署**：`npm run build && ./node_modules/.bin/wrangler deploy`（wrangler 用**本地路径**，裸 `wrangler` 会 command not found；GFW `fetch failed` 重跑即续传）。无新迁移。

## 🆕 2026-07-15 (续4) — 图片编辑/标注 稳定性小修（DONE code, tsc=0; ⚠️ NOT deployed）
用户增强 #4（图片编辑/标注精度 + 稳定性）——需求较泛，未指具体 bug。做法：只修**可确证**的问题，不臆测改动可用代码。
1. **【稳定性·确证】html-doc-editor.tsx 三处图片操作的 sessionStorage 写入未加 try/catch**：
   `replaceActiveSrc`（替换图 src）、`runDocCommand`（排版命令）、`insertImageByUrl`（插图）里
   `sessionStorage.setItem(cacheKey, 大HTML)` **裸调用**——正是 2026-07-13 记录过的 QuotaExceededError（~5MB 配额）
   会导致「全空编辑框」那类 bug 的同源风险（初始加载 + 打字持久化两处早已 try/catch 包好，唯独这三个图片改动路径漏了）。
   **修复**：新增 `persistDocCache(idoc)` helper（try/catch 兜底 + DOCTYPE 前缀），三处裸 setItem 全换成它。
   现在大文档下替换/插入图片、改排版不会因写缓存超额而中断编辑动作（缓存仅崩溃恢复用，可失败）。
2. **【精度·核查后判定非 bug，未改】**：右键图片菜单定位 `x: rect.left + e.clientX`（html-doc-editor onCtx）——
   核查确认正确：contextmenu 事件来自 iframe 内部（clientX 相对 iframe 视口）+ rect.left（iframe 在父视口偏移）→ 父视口坐标；
   菜单用 `position:fixed`（视口坐标）+ 按 window.innerWidth/Height 夹取。父/子滚动都不影响，故**不是 bug，未动**。
- **验证**：tsc=0 + prettier 已格式化本轮全部新增/改动文件（share-card-button / image-proxy.functions / share-card / html-doc-editor）+ dev server 无编译错误。
- **⚠️ 若用户另有具体精度/稳定性症状**（如某设备上标注错位、某操作崩），需其描述具体现象再定位——本轮只修了能确证的这一处。

## 🆕 2026-07-15 (续3) — 金叶详页生成改「站内后台任务」（DONE code, tsc=0; ⚠️ NOT deployed；LLM 路径未本地验证）
用户增强 #3。**权衡**：真正的服务端后台任务（关标签页也能跑完）在 Cloudflare Workers 需 Queues/waitUntil——
本项目**无相关基建**、且本地无法验证（Gemini 被 GFW geo-block + dev 非 workerd）。盲写不可验证的异步队列重写
「最贵的操作（花金叶 + 6 次 LLM）」违反项目「别在难/不可验证问题上死磕」的规矩。**采用低风险方案**：
利用 SPA 特性——**客户端路由切换不会中断进行中的 fetch**（fetch 活在 JS 运行时、不随页面卸载）。
- **改动仅在 `drafts.$id.tsx` 的 `onCreateGoldPage`**：不再 `await` 阻塞 UI；点「确认创建」→立即关弹窗 + 释放界面 +
  弹持久 loading toast「可离开本页在站内继续浏览，完成后通知你；请勿关闭/刷新标签页」。**直接调原始
  `createGoldDetailPageFn`**（非 useServerFn 包装版）→ 请求不被组件卸载的 AbortSignal 取消，用户离开草稿页后仍继续。
  完成 → 全局 toast「金叶详页已生成，剩余金叶 N」带「查看」action（window.location 跳新页）；失败 → error toast。
- **重活代码零改动**（createGoldDetailPageFn 内部三段式逻辑不动 → 无新风险）。删了不再用的 `createGoldPage=useServerFn(...)`。
- **诚实局限**：非真后台——**关/刷新标签页仍会中断生成**；跨标签页存活需 Cloudflare Queues（另立一期）。故仍提示勿关标签页。
- **验证**：tsc=0。⚠️ happy-path 需登录 + 完整草稿 + 金叶余额 + Gemini（本地 geo-block）→ 未本地跑通；UX 逻辑（关弹窗/
  后台 toast/全局通知）直观且类型安全。

## 🆕 2026-07-15 (续2) — 已收录详情页「生成分享卡」+ 分享卡深色/多语言 + 外链封面代理（DONE code, tsc=0, ✅ 本地已验证; ⚠️ NOT deployed）
用户本轮增强 #1+#2 一并完成（同一 UI 面 + 同一 share-card.ts，合并做省返工）。
1. **新增可复用组件** `src/components/share-card-button.tsx`（`<ShareCardButton>`）：触发按钮 +
   预览弹窗（浅色/深色 + 中文/EN 两组切换，切换即重渲染），分享/存相册（复用 shareOrSaveImage）。
2. **share-card.ts 深色 + 多语言**：`ShareCardData` 加 `theme?:"light"|"dark"` + `lang?:"zh"|"en"`；
   单一 `C` 调色板 → `PALETTES.{light,dark}`（深色=深绿黑底 + 提亮绿/金）；卡片自有文案（品牌副标题/「X 发现了
   一种新植物」/「本轮铜叶 +N」/溢出提示/页尾邀请）走 `STRINGS.{zh,en}` 字典（物种名/学名/摘要来自 data，不翻译）。
   **本轮铜叶行改为仅当 `leafEarned != null` 才画**——已收录详情页不传 leafEarned，故不显示误导性「+1」。
3. **接入 plants.$slug.tsx**：HTML 分支（顶栏）+ 经典分支各加一个 `{shareCardNode}`（仅当 plant.cover_url 存在）。
   discovererName = 作者 display_name（回退 "Plantspedia"）。
4. **外链封面 CORS 修复（附带发现的真 bug）**：很多已收录条目 cover_url 是 iNaturalist/GBIF 外链 CDN，**无 CORS 头**→
   canvas 直接 fetch 失败→卡片图空白（草稿卡同样受影响，属潜在 bug）。**新增** `src/lib/image-proxy.functions.ts`
   的 `proxyImageDataUrlFn`（服务端拉图→data: URL，8MB 上限、仅 image/*、12s 超时、失败返回 null）；share-card.ts
   `loadImage` 直连失败后回退走代理（data: URL 不污染 canvas）。
   - **本地实测**（肉苁蓉页 `/plants/cistanche-deserticola-ma-1960`）：点「分享卡」→弹窗出；浅↔深切换、中↔EN 切换
     都正确重渲染（深色变深绿底、EN 变「吉木 discovered a plant」）；**外链 iNaturalist 封面经代理成功画上卡片**（原本空白）。
- **验证**：tsc=0 + 浏览器实测（截图确认）。
- **⏳ 剩余**：#4 金叶生成改后台任务（大改，Workers 执行模型：waitUntil/Queue/DO + 前端轮询）；#5 图片编辑/标注精度稳定性小修（需先定位组件）。

## 🆕 2026-07-15 (续) — 金叶详页 + 小P对话 Token 统计补齐（DONE code, tsc=0; ⚠️ NOT deployed）
**背景**：`/admin/usage-stats` 之前只有「快速识别 quick_identify」「银叶草稿 enrich_draft」能统计花费；
「金叶详页 gold_page」「小P对话 chat」两类**统计不出来**，因为底层 `xiaopTextCall/geminiChat/openaiCompatChat/anthropicChat`
只回文本、丢弃了 usage。本次按 STATE 既定方案完成底层改造。
**改动（全在 `src/lib/identify-plant.functions.ts`）**：
1. 新增类型/工具：`AiTextResult={text,usage}`、`ZERO_USAGE`、`addUsage(a,b)`（不可变累加，容 null）。
2. 三个 chat 函数返回值 `Promise<string>` → `Promise<AiTextResult>`，各自从响应解析 token：
   - geminiChat：`res.usageMetadata.{promptTokenCount,candidatesTokenCount,totalTokenCount}`
   - openaiCompatChat：`res.usage.{prompt_tokens,completion_tokens,total_tokens}`
   - anthropicChat：`res.usage.{input_tokens,output_tokens}`
3. `xiaopTextCall` 返回 `AiTextResult & {provider,model}`（携带实际用的 provider/model 供日志）。
4. `xiaopGroundedSearch` 返回加 `usage`（联网检索那次 Gemini 调用的 token）。
5. `xiaopAskWithGrounding` 返回 `AiTextResult & {provider,model}`，**累加**「首答 + 联网检索 + 二次答」三段 token。
6. **gold_page 日志**：`createGoldDetailPageFn` 用 `goldUsage` 累加 3 次联网调研 + 3 个 LLM 阶段，plants 插入成功后
   写一条 `ai_usage_logs`（task_type=`gold_page`，user_id=创建者，user_label「{名字}（金叶详页）」，draft_id/draft_title）。
7. **chat 日志**：新增 `logChatUsage(ans, meta)` helper（awaited + try/catch 兜底）。askDraftAgentFn 记「小P对话（草稿）」
   带 draft_id；askPlantAgentFn 记「小P对话（详情页）」draft_id=null（plantId 非 plant_drafts id，避免潜在 FK 冲突）。
8. 其余 4 个 xiaopTextCall 调用点（入侵卡/保护卡生成、applyDraft/applyPlant 全文改写）改成 `const {text:txt}=await…`，
   丢弃 usage（行为不变；入侵/保护卡本就并入 enrich_draft 计费，改写类暂不单列）。
- **统计页无需改**：`admin.usage-stats.tsx` 早已有 gold_page→「金叶详情页」/ chat→「小P对话」的 label + 颜色映射。
- **验证**：`tsc --noEmit` EXIT=0。⚠️ **无法本地真机验证**（dev server 连 Gemini 被 GFW geo-block；token 日志只在线上 Workers 出口跑通）。
  待部署后真机：创建一个金叶详页 + 跟小P对话几轮 → `/admin/usage-stats` 应出现「金叶详情页」「小P对话」两类花费。
- **⏳ 剩余增强（用户本轮要求，未做）**：① 已收录详情页加「生成分享卡」；② 分享卡深色模式+多语言；
  ③ 金叶生成改后台任务（现在几分钟同步等待）；④ 图片编辑/标注精度稳定性小修。


## ✅ 2026-07-15 已部署上线 Version `736b1ad0-68f1-423f-ba8d-628ab143cbe9`（Workers）
07-14/07-15 整批工作（d1db329：Token 用量统计 + 多模型管理界面 + 联网调研 + 分享卡重排 + 补拍合并 +
提交门控 + usage task_type 迁移相关代码等）**终于上线**。三步全部完成：① 5 合 1 迁移 SQL ✅ 用户已在 Supabase 跑成功；
② `npm run build` ✅；③ `wrangler deploy` ✅ ——本次重跑**一次过**（asset 已缓存「No updated asset files to upload」，
只传 worker 脚本，Uploaded 244s + Deployed triggers 5.67s）。**两域名 plantspedia.club / www 均 200。**
再次印证：前几次 `fetch failed` 纯 GFW/VPN 抖动，wrangler 传完全部资源才原子切换 → 上传失败=线上没切换、无半吊子状态；
**解法就是网络稳定时重跑 `wrangler deploy`，无需重新 build**。⚠️ wrangler.jsonc 仍是 **M（未提交）** 状态——
Workers 配置正确（已核对 vars），但尚未 git commit；下次可 `git add wrangler.jsonc && git commit` 固化。

## 🆕 2026-07-15 — 【稳定性修复】部署配置从 Pages 回退到 Workers（wrangler.jsonc）
**发现的高危问题**：07-15 有两个提交。`61f2dac`「fix: update wrangler.jsonc for Pages deployment」
把 wrangler.jsonc 从 Workers 改成了 Pages —— 删掉 `main`(dist/server/server.js) + `assets`(dist/client)
+ custom_domain routes，改成 `pages_build_output_dir:"dist"` + 项目名 tanstack-start-app→plantspedia。
**但构建产物仍是 Workers 结构**（`dist/server/server.js` + `dist/client/`），dist 根目录**没有 Pages 需要的
`_worker.js`**（已 find 确认为空）。若照此配置 `wrangler pages deploy dist`：网站只上「静态门面」，
**所有服务端函数（拍照识别 / AI 银叶金叶 / 上传草稿 / 审核 / 模型配置 / usage 统计 / SSR）全部失效**；
且域名 routes 被删、项目名变新命名空间（老域名 plantspedia.club 不跟随）。= 会让全栈网站严重残废的半成品。
**根因判断**：Workers 部署以前报的 "Completion token consumed"/"fetch failed" 都是 GFW 网络抖动、重跑 2-3 次即成，
并不需要换 Pages。换 Pages 是误判，且构建 preset(vite/@cloudflare/vite-plugin 仍出 Workers 产物) 没跟着改 → 埋雷。
**已修复**：`git checkout d1db329 -- wrangler.jsonc` 恢复 Workers 配置（核对 vars 与新版完全一致，key 未退旧）。
现工作区 wrangler.jsonc = Workers（**未提交**，M 状态）。⚠️ **部署仍用 Workers 方式** `npm run build &&
./node_modules/.bin/wrangler deploy`，**不是** pages deploy。tsc=0（今天 d1db329 的 35 文件改动类型检查通过）。
**上线三步（顺序）**：① Supabase 后台跑 3 迁移 `20260713140000_widen_plant_edits_kind` → `20260714120000_draft_submit_and_photos`
→ `20260714140000_add_task_type_to_usage_logs`；② `npm run build`；③ `wrangler deploy`（VPN，抖动重跑 2-3 次）。
最后一次成功部署仍是 07-13 `e73e49c8`；d1db329 已把 07-14 整批工作打包提交但**尚未上线**。
**2026-07-15 上线尝试（未完成）**：① 5 合 1 迁移 SQL ✅ 用户已在 Supabase 跑成功（Success. No rows returned）。
② `npm run build` ✅（2.87s，dist/server/server.js + usage-stats 等都在）。③ `wrangler deploy` ❌ 连续 3 次卡在
**asset 上传阶段 `fetch failed`**（GFW 掐大上传 / VPN 不稳）——第 2 次进展到 `Uploaded 39 of 59 assets`（资源已部分
缓存在 CF 端），第 3 次网络恶化、退回。**非代码/非配置问题**（wrangler 是「传完全部资源+脚本才原子切换」，上传阶段失败=
线上根本没切换，plantspedia.club 仍是 07-13 旧版稳定跑、无半吊子状态）。**续传办法**：VPN/网络稳定时直接重跑
`./node_modules/.bin/wrangler deploy`（已缓存 39/59，只剩约 20 个资源 + worker 脚本，通常 1-2 次即成）；**无需重新 build**（dist 未变）。

## 🆕 2026-07-14 (续4) — Token统计 + 多模型管理界面改进 (DONE code, tsc=0; ⚠️ NOT deployed; ⚠️ 需跑迁移)
完成了两个剩余任务：Task #5 (Token Usage 详细统计) 和 Task #3 (多模型管理界面改进)。

### ✅ Task #5: Token Usage 详细统计
1. **数据库迁移**：
   - 新建 `supabase/migrations/20260714140000_add_task_type_to_usage_logs.sql`
   - 为 `ai_usage_logs` 表添加 `task_type` 列（VARCHAR(50)）
   - 添加两个索引：`idx_ai_usage_logs_task_type` 和 `idx_ai_usage_logs_model_task`
   - 任务类型：`quick_identify`（快速识别）、`enrich_draft`（银叶完整草稿）、`gold_page`（金叶详情页）、`chat`（小P对话）

2. **代码修改 - 标记 task_type**：
   - 修改 3 处现有 insert（identify-plant.functions.ts）：
     - Line 2303: `quickIdentifyDraft` → `task_type: "enrich_draft"` (完整草稿生成)
     - Line 2590: `identifyQuick` → `task_type: "quick_identify"` (快速摘要卡)
     - Line 2783: `enrichDraft` → `task_type: "enrich_draft"` (银叶完整草稿)
   - ⚠️ **金叶和小P对话的 usage log 暂未实现**：
     - `createGoldDetailPageFn`、`askDraftAgentFn`、`askPlantAgentFn` 调用的 `xiaopTextCall` 只返回文本，不返回 token usage
     - 需要重构 `xiaopTextCall`、`geminiChat`、`openaiCompatChat`、`anthropicChat` 返回 `{text, usage}` 对象
     - 这是一个大改动，建议单独迭代

3. **统计页面**：
   - 新建 `src/routes/_authenticated/admin.usage-stats.tsx`
   - 按模型分组，展开显示各任务类型详情
   - 表格形式：调用次数、Prompt Tokens、Completion Tokens、总 Tokens
   - 支持展开/折叠，按 token 消耗排序
   - 顶部显示总调用次数、总 Token 消耗、模型数量

4. **类型定义**：
   - 手动编辑 `src/integrations/supabase/types.ts`，添加 `ai_usage_logs` 表定义（含 `task_type` 字段）

### ✅ Task #3: 多模型管理界面改进
重构了 3 个模型配置组件，统一添加：多 key 支持、拖拽排序、完整显示 key（带安全提示）。

1. **identify.tsx AdminModelPanel**（AI 模型控制台）：
   - 多 key 支持：`keys: string[]` 替代单个 `apiKey`，每个 key 一个输入框
   - 拖拽排序：HTML5 Drag & Drop API，拖动调整优先级（Gemini 限流时按顺序轮换）
   - 完整显示 key：移除掩码，显示/隐藏切换按钮
   - 安全提示：⚠️ Key 完整显示在此页面，请注意屏幕分享时遮挡
   - UI 增强：拖动图标（三横线）、删除按钮（×）、优先级标签

2. **xiaop-model-panel.tsx**（小P蛙模型控制台）：
   - 同样的多 key 支持 + 拖拽排序 + 完整显示逻辑
   - 与 AdminModelPanel 保持一致的交互体验
   - Gemini key 可添加多个，其他 provider 支持单 key

3. **xiaop-user-settings.tsx**（用户自己的小P模型设置）：
   - 从单个 `apiKey: string` 改为 `keys: string[]`
   - 加载现有配置时自动拆分逗号分隔的 key（向后兼容）
   - 保存时 join 为逗号分隔字符串存入 localStorage
   - 同样的拖拽排序 UI

### 📋 技术细节
- **拖拽实现**：原生 HTML5 Drag & Drop API，无需第三方库
  - `draggable={keys.length > 1}`
  - `onDragStart` / `onDragEnd` / `onDragOver` / `onDrop`
  - 拖动时 opacity 0.5，视觉反馈清晰
- **状态管理**：`keys` 数组，`joinedKey` 用于保存和拉取模型
- **类型安全**：tsc --noEmit EXIT=0，所有改动通过类型检查
- **用户体验**：
  - 拖动图标仅在多 key 时显示
  - 删除按钮仅在多 key 时显示
  - Gemini 显示「＋ 再加一个 Gemini key」按钮
  - 优先级标签：（优先级 1）、（优先级 2）...

### ⚠️ 待办（用户后续需求）
1. **部署前必做**：
   - Supabase Dashboard 跑迁移 `20260714140000_add_task_type_to_usage_logs.sql`
   - `npm run build && ./node_modules/.bin/wrangler deploy`（VPN）

2. **真机验证**：
   - 访问 `/admin/usage-stats` 查看统计页面
   - 测试三个模型配置面板的拖拽排序
   - 验证多 key 轮换逻辑（故意用过期 key 触发 429）

3. **金叶和小P对话 usage log**（独立任务）：
   - 重构 `xiaopTextCall` 系列函数返回 `{text, usage}` 对象
   - 在 `createGoldDetailPageFn` 中记录 3 次 LLM 调用的 token（三阶段生成）
   - 在 `askDraftAgentFn` / `askPlantAgentFn` 中记录对话 token
   - 标记 `task_type: "gold_page"` 和 `task_type: "chat"`
   - 估计工作量：2-3 小时（涉及多个底层函数签名变更）

## 🆕 2026-07-14 (续3) — 银叶/金叶联网调研 + 分享卡重排 + 相机提示 (DONE code, tsc=0; ⚠️ NOT deployed)
用户要求为银叶草稿生成和金叶详页创建添加联网搜索能力，以及重新设计分享卡排版。已完成：

### ✅ 核心功能：联网调研集成
1. **银叶 enrichDraft 联网调研**：
   - 在 `enrichDraft` 生成完整草稿前，调用 `xiaopGroundedSearch` 查询该物种的最新研究、保护状态、分布更新等权威信息
   - 联网查询：「{物种名}（{学名}）植物的最新研究进展、保护状态、分布范围、生态作用、栽培技术的权威资料（优先中国植物志、GBIF、IUCN、学术期刊）」
   - 搜索结果（digest + sources）注入到 `callAiIdentify` 的 system prompt，作为「联网调研·权威参考资料」区块
   - 仅 Gemini 可用（google_search grounding），其他 provider 跳过；失败 graceful 降级

2. **金叶 createGoldDetailPageFn 联网调研**：
   - 金叶三阶段生成（形态生境、人文博物、生态演化）各自独立联网查询：
     - Phase 1: 形态特征、生境分布、近缘种区分、栽培养护（优先中国植物志、Flora of China、园艺文献）
     - Phase 2: 人文历史、民俗用途、文学记载、本草典籍、食药用价值（优先古籍数据库、民族植物学文献）
     - Phase 3: 生态功能、入侵风险、保护管理、近期科研进展（优先 IUCN、GBIF、学术期刊）
   - 每次调研结果通过 `withWebContext` helper 注入对应阶段的 system prompt
   - 确保内容准确性和时效性（尤其对需要最新资料的保护状态、入侵动态、科研进展）

3. **金叶改用小P蛙模型**（Task #7 附带完成）：
   - `createGoldDetailPageFn` 已通过 `data.userModel` → `toOverride` → `xiaopTextCall` 的 override 参数使用小P蛙模型控制台配置
   - 用户在「我的小P模型」设置的模型会应用到金叶创建，与小P对话共用同一套模型配置

### ✅ 分享卡重新排版（share-card.ts + drafts.$id.tsx）
4. **新版分享卡布局**（按用户要求完全重写）：
   - **页头**：小P蛙 logo + 品牌 | 地点信息移到**右侧**（地点和坐标分两行，地点图标+地点名 / 坐标）
   - **名称块**：科属（绿色） + **中文名和拉丁学名同行显示**（中文名大号粗体，拉丁学名小号斜体紧跟） + 俗名
   - **发现者信息区**（新设计，占两行）：
     - 左侧：**圆形头像**（80px，查询 profiles.avatar_url，无头像显示灰色圆）
     - 右侧第一行：「X 发现了一种新植物」（绿色粗体）
     - 右侧第二行：**本轮铜叶 +N** + **三叶统计**（铜/银/金徽章+数字，紧凑排列）
   - **140字摘要**：保留截断逻辑（……访问 plantspedia.club 阅读完整内容）
   - **移除银叶金叶作用介绍**（原底部带状区的两行权益提示已删除）
   - **页尾**（左下角）：**加分隔线**（左侧短横线 200px） + 「X 邀请你加入 plantspedia.club」（左对齐，两行）

5. **数据传递**：
   - ShareCardData 类型新增 `discovererAvatar?: string | null`
   - drafts.$id.tsx 新增查询 creator profile（获取 avatar_url + display_name）
   - renderShareCard 调用时传递 `discovererAvatar: creatorProfile?.avatar_url || null`

### ✅ UI 调整
6. **相机提示样式**（camera-identify.tsx）：
   - 警示文字「AI 识别内容不能采纳为食用药用参考！」改为绿色（`text-leaf-deep`，原为 `text-vermilion`）
   - 移除三角形感叹号 emoji（`⚠️`）
   - 保持粗体和显眼位置（viewfinder 上方常驻）

### 📋 技术细节
- **联网调研实现**：复用现有 `xiaopGroundedSearch` 函数（STATE.md 2026-07-12 续十二已实现）
- **参数传递链**：`enrichDraft` → `buildDraftContent` → `callAiIdentify(webResearch)` → system prompt 注入
- **金叶调研**：三次独立 `xiaopGroundedSearch` 调用 + `withWebContext` helper 动态注入
- **分享卡绘制**：纯 Canvas 2D 直绘（1080×1920），圆形头像用 `ctx.arc` + `clip()`
- **降级策略**：联网失败或非 Gemini provider → webResearch = null，原流程照常进行；头像缺失 → 灰色圆形占位
- **类型安全**：`tsc --noEmit` EXIT=0（所有改动已通过类型检查）

### ⏳ 待办（用户后续需求，未在本次实现）
- **多模型管理界面改进**（Task #3）：显示完整 key/url（不隐藏）、每个 provider 支持多 key（+删除按钮）、优先级排序
  - 需要改动：identify.tsx AdminModelPanel、xiaop-model-panel.tsx、xiaop-user-settings.tsx 三个组件
  - 工作量大（涉及 UI 重构 + 状态管理 + 新增排序逻辑），建议单独迭代
- **Token Usage 详细统计**（Task #5）：增加 task_type 字段，按「模型+任务」维度分组展示
  - 需要：① 数据库迁移（`ai_usage_logs` 表加 `task_type` 列）；② 修改 7 处 insert（标记任务类型：识别/银叶/金叶/小P对话）；③ 统计页面按模型+任务分组
  - 建议独立迭代（需数据库改动 + 多处代码修改）

### ⚠️ 部署前检查
- **代码状态**：tsc=0、所有改动完成
- **待部署**：`npm run build && ./node_modules/.bin/wrangler deploy`（VPN）
- **真机验证**：
  1. 生成银叶草稿，检查内容是否引用最新资料（控制台查 log 确认联网成功）
  2. 创建金叶详页，验证三阶段是否都有联网调研
  3. 相机页面警示文字为绿色、无感叹号
  4. **生成分享卡**，验证新排版：地点右侧、中文拉丁同行、发现者头像+统计两行、页尾左下角分隔线
  5. 访客/无头像用户：灰色圆形占位符正常显示

## 🆕 2026-07-14 (续2) — 识别人修复 + 相册 EXIF GPS 优先 (DONE code, tsc=0; ⚠️ NOT deployed)
用户反馈 2 个关键 bug，已修复：
1. **✅ 识别人显示为「访客」bug 修复**：已登录用户拍照识别后 creator_label 仍显示访客 → 根因是前端未传递登录用户
   ID 到服务端。修复：① SubmitInput 新增 `logged_in_user_id` 字段；② camera-identify.tsx 从 `useAuth()` 读 `user.id` 
   并传给 `quickIdentifyDraft`；③ 服务端 `resolveCreator` 优先用 `logged_in_user_id` 查 profiles.display_name，兜底才
   读 Authorization header。现在已登录用户识别时，草稿/分享卡的识别人正确显示为拍摄者（不再是访客）。
2. **✅ 相册上传改用 EXIF GPS 优先（不用浏览器实时定位）**：用户要求从相册上传照片时，地理位置应该读照片拍摄时的
   EXIF GPS，而不是浏览器当前位置。修复：`ingestImage` 区分两种场景 — ① **快门拍照**（tryExif=false）：用浏览器实时
   定位（当前位置）；② **相册上传**（tryExif=true）：优先读 EXIF GPS（拍摄时位置），立即应用到 coords，无 EXIF 才
   兜底用浏览器定位。避免用户在家翻相册时，外地拍的照片被标记为当前家里的位置。

## 📋 用户问题解答（已在会话中回复）
- **AI 草稿/金叶详页是否联网？** 答：都**不联网**，用模型的公共知识库。只有**小P蛙对话**（askDraftAgentFn/askPlantAgentFn）
  具备联网能力（Gemini grounding），且需模型自己判断 `needsWebSearch=true` 才激活。
- **银叶/金叶走哪个模型控制台？** 答：走「**AI 模型控制台**」（identify.tsx AdminModelPanel → site_config.ai_model_config），
  不是「小P蛙模型控制台」。但用户在「我的小P模型」里配的模型会 override 全站默认（包括银叶/金叶）。
- **两个控制台的联网能力？** 答：AI 模型控制台**不联网**；小P蛙模型控制台**有联网能力**，但仅在对话里激活（Gemini + 模型
  自判 needsWebSearch=true 时调 google_search grounding）。
- **gemini-3.5 模型消失？** 答：Google API 的 `/models` 端点返回的列表里已经没有 3.5 系列了（可能已下线或对该 key 停用）。
  代码默认配置是稳定的 `gemini-2.5-flash`，不受影响。

## 🆕 2026-07-14 (续) — 疑似统一 + 简介卡/分享卡修复 + 删数据 (DONE code, tsc=0; ⚠️ NOT deployed; ✅ 数据删除已完成)
用户反馈 6 项卡片问题 + 1 批数据删除，全部完成：
1. **疑似信号统一（标题/正文/补拍激活一致）**：新增 `normalizeIdentification(meta)` 服务端规范化——任一处露出「疑似」
   （confidence=low 或 summary_zh 以「疑似」开头）→ 全部统一为 low + summary 带前缀 + needs_more_photos_zh 兜底填充 →
   标题、正文、补拍横幅三者同源。草稿页 h1、简介卡 h1、分享卡名称、补拍横幅都读统一的 `draftTentative` 判定。
2. **简介卡加科属 + 疑似标题**：`buildSummaryCardHtml` 改为对象签名，新增科·属行（绿色）、标题在 tentative 时前缀「疑似」（红色）。
3. **草稿页标题疑似显示**：drafts.$id.tsx h1 在 `draftTentative` 时显示「疑似 XX」（剥重复前缀）。
4. **分享卡识别人 = 拍摄者（非点击者）**：discovererName 改为来自 `draft.creator_label`（访客→小P蛙），不再用当前登录用户的
   profileName。删掉 profileName 查询（已无用）。无论谁点「生成分享卡」，识别人都是正确的拍摄者。
5. **分享卡重排**：① 科·属从右上角移到名称块内（绿色大号，更醒目）；② 分隔线到名称块间距 50→74px（呼吸空间）；
   ③ 配图改**正方形** 936×936（不再 16:9，减少竖图裁切）；④ 简介行数动态计算（防溢出到底部叶片带）。
6. **✅ 数据删除（不可逆，已完成）**：删除光叶子花全部 + 6/25–7/05 九种（苦豆子/问荆/吊兰/黄花菜/匍匐毛茛/大车前/粘刺槐/刺蔷薇/空心莲子草）
   + 7/13 五种（泽泻/堇菜等）。**共删 12 条 plants + 7 条 drafts = 19 条记录**，及关联 plant_edits/plant_tags + 31 个存储文件。
   脚本：`scratch/find_plants_to_delete.mjs`（发现）+ `scratch/delete_plants.mjs`（执行）。
- **验证**：tsc EXIT=0；dev server 8080 已起（未真机预览分享卡/简介卡视觉，需登录 + 真实识别）。
- **⚠️ 待办**：`npm run build && wrangler deploy`（VPN）。真机：拍一张疑似物种→标题/正文/横幅都显示疑似、补拍激活；
  生成分享卡→识别人=拍摄者、科属明显、配图正方形不裁关键特征。

## 🆕 2026-07-14 — 补拍合并 + 提交门控 + 多图简介卡 + 地图「只看我识别」7 项 (DONE code, tsc=0; ⚠️ NOT deployed；⚠️ 需跑迁移；⚠️ 未真机)
上一个会话（cowork）实现了用户 7 项需求，`tsc --noEmit` EXIT=0。**本次会话（本条由主 Claude 补写，因上个会话 STATE.md 写保护未能自记）核对：新列在 types.ts 三处 + drafts.ts/identify-plant.functions.ts/drafts.$id.tsx/explore.tsx 代码里均真实存在。**
1. **补拍计数序数化**：计数器显示「第一次补拍 / 第二次补拍 / 最后一次补拍」（≥3=最后），相机横幅 + 草稿页补拍按钮/提示两处。
2. **升出 low 即不再疑似**：疑似/存疑横幅只在 confidence=low 时显示；补拍抬到 medium/high 后「疑似」字样 + 补拍横幅都消失。
3. **补拍合并 + 分享卡封面 + 多图简介卡**：补拍**合并进同一草稿**（不再新建）；新照片作封面（photo_url=脱 low 的那张，分享卡用它），
   所有照片累积进 `user_photos`；简介摘要卡每次补拍重生成为**多图画廊**（覆盖上一版单图）；草稿页摘要卡也渲染完整画廊。
4. **提交门控**：刚识别的草稿**私有**——不进 AI 待审队列、不上地图，直到点「保存为待审批草稿」（新 `submitDraftForReviewFn` 翻
   真实 `submitted_for_review` 标志；此前是假 toast）。未提交草稿留给用户继续完善。
5. **用户操作栏**：「保存为待审批草稿」加橙色双线边框强调 + 做真实提交；「保存在本地」删除。适用所有草稿状态。
6. **地图新筛选**：「只显示我识别的植物」仅登录用户可见（explore.tsx `mineOnly`/`mineFilter`）。关=所有人，开=只看自己；
   未提交→提交的草稿显示为蓝色「未采纳」标记。
- **⚠️ 待用户做（两步，顺序：先迁移后部署）**：
  ① **Supabase 后台跑迁移** `supabase/migrations/20260714120000_draft_submit_and_photos.sql`
     （加 submitted_for_review + user_photos 两列 + 回填既有草稿为 submitted_for_review=true / user_photos=[photo_url]，
      保证既有记录不从队列/地图消失）。**代码对缺列 graceful 降级**（门控退回全可见、画廊退回单图），故部署早于迁移不崩，但功能减半。
  ② `npm run build && ./node_modules/.bin/wrangler deploy`。
- **⚠️ 未验证**：cowork 未真机测（需登录 + 真实补拍 + 迁移）；仅靠 tsc + 代码逻辑保证。types.ts 已 cowork 手改好（retake_count/submitted_for_review/user_photos 三处），无需再动。
- **项目 ref = `ianlasfsfuaibqldkfyb`**（= 显示名「arainjazz's project」；地址栏 /project/ 后那串）。见 [[supabase-migration-workflow]]。

## ✅ 2026-07-13 已部署上线 Version `e73e49c8-63cd-43d6-a37e-62d27e21fb61`（含续三/续四/续五全部改动）
三域名 200。**部署失败根因 = `Completion token has already been consumed [code:100312]`**：资源上传时网络抖动
触发多次重试 → Cloudflare 一次性「完成令牌」被重复提交作废 → 最后提交 Worker 脚本被拒。**非代码问题**。
**解法：直接重跑 `wrangler deploy`**——资源已缓存（"No updated asset files to upload"），拿新令牌直接传脚本即成（8.75s）。
沉淀：这和老的 "fetch failed" 同源（GFW 掐大上传→重试），处理方式一样=重跑 2-3 次。
⚠️ **仍待用户做**：Supabase Dashboard 跑 `20260713140000_widen_plant_edits_kind.sql`——否则「博客修改进修改记录」
（续四 A）线上仍不生效（blog_edit/draft_* insert 被 kind CHECK 约束拒、静默失败）。其余改动已随本次部署生效。

## 🆕 2026-07-13 (续五) — skill 页图片写死相框 → 改按原比例（用户选：不裁剪+两者都做）(DONE code, tsc=0; ✅ 已部署)
**根因**：ccplants-v19 skill 生成的页面给每张图写死 `.img-slot{aspect-ratio:4/3!important;overflow:hidden}` +
`.img-slot img{height:100%!important;object-fit:cover!important}` → 所有图被裁成 4:3（生境 16:9）相框，不按图片真实比例。
**用户经 AskUserQuestion 选定**：① 按原比例完整显示（不裁剪，设 max-height 防超高竖图）；② 现有页 + 生成器模板都改。
**改动**：
1. **现有 237+ 页（plants.$slug.tsx 注入 CSS）**：追加 `.img-slot:not(.broken){aspect-ratio:auto!important;height:auto!important;overflow:visible!important}` +
   `.img-slot:not(.broken) img{width:100%!important;height:auto!important;max-height:80vh!important;object-fit:contain!important}`
   （注入在 </head> 后=更晚 source order + 同特异性 → 覆盖 baked 的 `.img-slot img` !important）。保留 .broken 占位框尺寸。
2. **金叶生成器（premium-page.ts CSS）**：`.img-slot` 去掉 aspect-ratio+overflow:hidden；img 改 height:auto+max-height:80vh+contain；.broken 保留 4:3。
3. **ccplants-v19 SKILL.md**：改「核心原则」文案 + CSS 示例 + checklist 两项 → 自然比例、只有 .broken 才 aspect-ratio:4/3。
   （旧 `ccplants` skill 本就 height:auto，无需改。）
- **验证**：tsc=0；preview 实测艾页 iframe 内 8 张图 **croppedCount=0**（渲染比例 == 自然比例，含竖图0.61/方图1.00/横图1.83），object-fit 已从 cover 变 contain。
- **⏳ 待办**：`npm run build && wrangler deploy`（用户上次 deploy 失败，暂缓；本改动纯 CSS，随下次部署生效。已生成页无需重生成）。

## 🆕 2026-07-13 (续四) — 用户第 3 轮反馈（修改记录/草稿菜单/删无地点/补配图）(DONE code, tsc=0; ⚠️ NOT deployed；⚠️ 需跑迁移)
- **A. 博客修改不进修改记录 = plant_edits.kind CHECK 约束太窄**（根因，node 实测）：线上约束只允许
  `text,image,revert,create,html_save,branch,merge,tag_create,catalog_create,catalog_append,draft_approve`——
  **blog_publish / draft_image / draft_text / draft_reject / ai_page_edit 全部被拒**，而这些 insert 都
  `.catch(()=>{})` 静默吞掉 → 博客/草稿/小P蛙的编辑从来没记进日志。⚠️ **必须跑迁移**
  `supabase/migrations/20260713140000_widen_plant_edits_kind.sql`（加上这些 + 新 `blog_edit`）后才生效。
  代码侧：blog-editor.tsx 新增 `logBlogEdit`（编辑已存在博文即记 blog_edit，带 before/after html）；
  edits.ts kind union、edit-log-section、edits.tsx（label/color/isCatalog/onRevert 恢复 content_html）都加了 blog_edit。
- **B. 图片修改记录缩略图点开看大图**（edits.tsx）：EditSnapshotPreview 缩略图改成 button→onZoom→
  EditsPage 顶层 `lightbox` 状态渲染全屏遮罩，任意处点击关闭（cursor-zoom-out）。
- **C. 删无「识别出地点」草稿**：上一轮删了 23（无坐标无地名）；本轮再删 1（小野豌豆，有坐标但
  capture_place 空、pending）——按「地名空且未发布」删。保留 2 条已发布空地名。备份 _deleted_noplace_backup.json。
- **D. 给保留草稿补配图**（scratch/refill_draft_photos.mjs）：上一轮孤儿清理误删了 117/137 草稿照片。
  从 iNaturalist taxa API 按学名取图，回填 photo_url + 替换 html_content 里的旧图 URL。**117 张全部补上**
  （status 200），0 仍破损。⚠️ 这是替代图（非用户原图，原图已永久删除）。可 rerun（_refill_progress.json 断点续传）。
- **E. 草稿功能菜单分两栏**（drafts.$id.tsx）：① 编辑操作栏（isEditor，绿框）= 继续编辑 HTML · **采纳识别**
  （=审核通过并收录，识别用户 +2 铜叶：新 onAdoptApprove 先 setAdopted 再 onApprove）· 驳回草稿（银叶退还提示）。
  ② 用户操作栏（所有人）= 进入编辑 · 保存为待审批草稿 · 保存在本地 · **生成分享卡·存相册（双线边框强调）** · 分享链接。
  删掉了原 owner-only 采纳 toggle（onAdoptDraft/isOwner 一并删）。
- **F. 简介摘要卡**：配图移到卡**内部右侧**（SafeImg，方形）；识别人放到**识别时间下面**（同一格 stacked）；
  精简草稿（notEnriched）**不再渲染下方重复 iframe**（内容与摘要卡重复）；完整草稿仍渲染 iframe。
  另：enrichDraft 服务端——**已通过申请的编辑（editor/admin）免银叶**（查 user_roles，silverExempt = owner||editor），
  UI 文案同步（编辑显示「免银叶」）。
- **验证**：tsc=0；preview 实测草稿页（lite: 无 iframe+摘要卡带图+识别人在识别时间下+双线分享卡按钮；full: 有 iframe）。
  ⚠️ **A/B 需登录 + 迁移才能真机验证**（编辑操作栏、edits 页、blog_edit 记录都要 auth；blog_edit 记录还要先跑迁移）。
  lint 报的全是**存量** prettier + identify-plant.functions.ts 的 no-explicit-any，非本次引入。
- **⏳ 待办**：① Supabase Dashboard 跑 `20260713140000_widen_plant_edits_kind.sql`（否则 A 不生效）；
  ② `npm run build && wrangler deploy`；③ 真机：编辑登录看草稿编辑操作栏 / 改博客后看修改记录 / 点图片缩略图看大图。

## 🆕 2026-07-13 (续三) — 用户 7 项反馈（删无地点草稿 + 首页18条 + 详页修复 + 导航改名）(DONE code, tsc=0; ⚠️ NOT deployed)
1. **删无地点 AI 草稿**：`plant_drafts` 里坐标空且地名空且未发布的 23 条（19 pending 带审 + 4 rejected）
   已删（161→138）。保留 2 条「无地点但已发布」的（避免破坏线上条目）。备份见
   `scratch/_deleted_drafts_backup.json`；脚本 `scratch/delete_noloc_drafts.mjs`（`select("*")` 会因
   html_content 过大 terminated，务必只 select 需要的列）。
2. **首页最多 18 条**（index.tsx）：`rest = sorted.slice(4, 18)`（hero1+sub3+rest14）。归档区从
   行列表改为**紧凑图片卡网格** `grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`（手机 2 列、非列表式）。
3. **【根因】首页封面/头像不显示 = 图片被 07-13 孤儿清理误删**：full_audit 只用「植物页」建引用集，
   漏了博客封面(inline/)、编辑头像(avatars/)、**草稿照片**。实测 `_orphans.json`(432) 含这些路径、URL 均 404。
   受损：**118/138 草稿照片**、吉木头像、2 篇博客的正文首图。**像素永久丢失、不可恢复**。
   修法=新增 `src/components/safe-img.tsx`（onError/空 src → 优雅占位），接入首页博客封面/编辑头像/DraftCard。
   首页 broken img 数 3→0。⚠️ **告知用户：这些图需重新上传；下次清理孤儿务必把 blog/avatar/draft 也算进引用集**。
4. **博物趣闻摘要卡点开显示乱码 → 修**（plants.$slug.tsx）：ccplants 页有 `<a class="section-vi-summary-card"
   href="#section-vi">`，但详页 iframe 是 `sandbox`（无 allow-scripts）srcdoc，点 #hash 会导航到 about:srcdoc
   显示源码乱码。修=父页在 iframe doc 上拦截 `a[href^="#"]` 点击、preventDefault、手动 `window.scrollTo` 到目标。
   实测 defaultPrevented=true（handler 生效）。
5. **页尾撑满 → 修**（plants.$slug.tsx）：iframe 原固定 `height:calc(100vh-120px)` → 内部双滚动 + 短页页尾空白。
   改为**自适应高度**（`wireIframe` 里 sizeIframe：量 scrollHeight 设 iframe.style.height + ResizeObserver + 定时重量 +
   img/font 加载重量）+ `scrolling="no"`。**关键 guard**：`iframe.clientWidth<240` 时跳过量高（容器 0 宽时内容
   回流成 28 万 px 窄条会把 iframe 撑爆；等宽度恢复 RO 再量）。实测正常宽度下 iframe=12732px、单一滚动。
6. **右键编辑封面卡不再重复出现在评论卡上方**（plants.$slug.tsx HTML 分支）：删掉页尾那个 cover `<figure>`
   + 其 renderCoverMenu() 调用（编辑封面走右上角「编辑 →」）。非 HTML 分支的正文封面保留。
7. **导航「项目驱动调研成果」→「项目预告与成果」**（site-header.tsx，桌面+抽屉两处）。
- **验证**：tsc=0；preview 实测（首页无 broken 图 + 18 条 + 2 列网格；详页单滚动 + section-vi handler 生效 + 导航改名）。
  ⚠️ preview pane 对 12000px 高 iframe 有 0 宽/0 高的 headless 量测抖动 + scroll 偶尔超时，故 section-vi 真实滚动
  未在 pane 目视到（但 handler 逻辑已验证）。**待办**：`npm run build && wrangler deploy`；真机点一次博物趣闻卡确认滚动。

## 🆕 2026-07-13 (续二) — 删 AI 识别数据 + Gemini key 诊断：病根=配置了不存在的模型
用户要求：删全部 AI 识别资料（含已采纳条目）、看释放多少空间、判断是"所有 key 超额"还是"两 key 轮换机制失败"。
1. **删除范围**（scratch/delete_ai_data.mjs）：`plant_drafts` 137 行全删 + `plants` 中 source∈{ai_identify,draft_merge,
   gold_oneclick} 的 **4 条**（晶状花烛/狐尾大麦/华丽针茅=ai_identify，悬崖菊=gold_oneclick）+ 各自 plant_edits/plant_tags +
   storage：`plant-images/drafts/` 全部 + 这 4 条的 html/cover/正文引用图。**保留** 249 条精选图鉴（source=null 237 +
   html_upload 12，非 AI 识别）+ ai_usage_logs（143 行，微小、留作诊断）。
   - **释放空间**：存储 750.9→**739.9MB**（约 11MB）。释放少=**符合预期**：AI 草稿照片大多是外链 iNaturalist（不占本站），
     Supabase 里的 AI 图仅 drafts/ 13.9MB。存储大头是批量精选页面，非 AI。
2. **Gemini key 诊断（scratch/test_keys.mjs，走本地代理 127.0.0.1:7888 绕过 GFW 直连 Google）——两个假设都不对**：
   - 两个 key（AQ.A…9-Yg / AQ.A…Ktdw）**都健康、都没超额**：models.list 正常返回、`gemini-2.5-flash` generateContent 返回
     **HTTP 200 ✅**。
   - 轮换机制**没坏**：site_config 里两 key 用逗号/换行干净分隔（splitGeminiKeys 正确切成 2 个），非历史上的"粘死"。
   - **真正病根**：管理台配置的模型是 `gemini-3.5-flash`——**这个模型根本不存在**！两个 key 的真实可用列表最新只到
     `gemini-3.1-pro-preview`/`gemini-3-flash-preview`，无 3.5。每次识别打到不存在的模型→失败；轮换救不了（两 key 结果一样，
     callGeminiWithRotation 对模型错误正确地不轮换）。雷是 2026-07-12（续八）误信"gemini-3.5-flash 存在"改配置埋的。
   - **修复**：① 直接改 site_config.ai_model_config.model → `gemini-2.5-flash`（DB 改，**线上立即生效**，识别现在就能用）；
     ② 代码三处静态预设默认从 gemini-3.5-flash → gemini-2.5-flash + models 列表换成真实存在的
     （identify.tsx / xiaop-model-panel.tsx / xiaop-user-model.ts；含 identify.tsx useState 默认）防"恢复默认"再踩雷。
   - **注意**：gemini-3-flash-preview / gemini-3.1-* 是 preview，实测常 503 UNAVAILABLE；稳定可用的是 gemini-2.5-flash。
     用户若想用更新的，用管理台「拉取可用模型」按 key 实时列，别手打不存在的名字。
- **验证**：tsc=0；key 实测 2.5-flash=200；删除后 plant_drafts=0、AI 采纳条目=0。build+deploy 见下。

## 🆕 2026-07-13 — 批量上传三处根因修复 + Supabase 存储告急 (DONE code, tsc=0; ⚠️ NOT deployed)
用户反馈批量上传：大量文件上传失败、出现全空编辑框、自动识别只有第一个成功。三个根因全部定位并修复：
1. **全空编辑框**（html-doc-editor.tsx 初始加载 effect）：`sessionStorage.setItem(cacheKey, text)` 无 try/catch——
   sessionStorage 配额约 5MB，批量传多个大 HTML 很快塞满，QuotaExceededError 直接进 `.catch` → docText 留空 →
   编辑框全空。且 `fetch(htmlUrl)` 不查 `r.ok`（404/错误体也当 HTML 渲染）。修：setItem 包 try/catch（缓存可选、
   照常渲染）+ 检查 r.ok + 错误 toast 带具体原因。（打字持久化那个 effect 本来就有 try/catch，没动。）
2. **自动识别只有第一个成功**（admin.batch-new.tsx finalizeBatch）：`next.forEach(runExtract)` 并发全开 →
   同时 N 个 Gemini 调用打爆免费档 RPM → 除第一个外全部 429（旧重试 5s/10s 也扛不住）。修：改为 async IIFE
   **顺序逐个识别**。
3. **extractPlantMetaFn 只用 .env 单 key**：没接管理台 key 池/轮换。修：`loadAiConfig()` + `splitGeminiKeys` 组
   key 池（管理台 gemini keys + env key 去重），手写重试循环删掉，换 `callGeminiWithRotation`（429 自动换 key）；
   模型取管理台配置，回退 env AI_MODEL。
4. **Supabase 存储用量（scratch/storage_usage.mjs 实测，list API 递归求和）**：plant-images 4324 个文件 903.2MB +
   plant-html 274 个 21.2MB = **共 924.4MB；免费档 1GB 上限只剩约 75.6MB**——这也是"大量文件上传失败"的最可能
   直接原因。⚠️ 探针脚本自己在运行时读 .env（未打印 key）。**待用户决策**：升级 Pro（100GB）或清理 plant-images
   里失败批次留下的孤儿图（batch-img/ 前缀下未被任何 HTML 引用的）。
- **验证**：tsc=0；dev server 起、/admin/batch-new 正常跳登录、console 无错。批量上传全流程需 admin 登录，未实测。
- **✅ DEPLOYED 2026-07-13：Version `9a292141-7c6b-4e1e-b6d9-8011c330ed71`**（build OK，上传 57 文件 27s 一次过）。

### ✅ 抢救已上传的孤儿 HTML → 补建 237 条目（scratch/rescue_orphans.mjs，实际写库完成）
**关键发现**：文件其实早传上去了（plant-html 桶 274 个），但只有 16 个建成了条目——**258 个是孤儿**
（HTML 躺在存储桶里，plants 表没行 = 网站不显示）。原因正是上面三个 bug 让批量页当时没能点成「创建条目」。
- **抢救脚本**：列出未被任何 plants.html_url 引用的孤儿 → 逐个 fetch HTML → **本地正则解析 ccplants 模板**
  （`extract-plant-meta` 边缘函数实为 404 未部署 + 本地 Gemini 被地区限制，故不走 AI）：title=`<h1>`（去汉字间距）、
  family/genus=masthead `.mast-name-zh + .mast-name-la`、scientific_name=`.hero-binomial`、common_name_en=`.hero-vernacular`、
  summary=首个 ≥80 字 CJK `<p>`、cover=首图、HTML 实体解码 → 去重（学名前两词，无学名回退 `zh:标题`，且与已有 253 条比对）
  → 直接 insert plants（author_id=ab8bee60…上传者/admin，source=rescue_script）+ 写 plant_edits create 日志。
- **结果**：创建 **237**、跳过 21（重复批次重传）、失败 0。plants 总数 16→**253**。
- **线上实测**：/plants/cistanche-deserticola-ma-1960（肉苁蓉）等条目 masthead/hero/配图/正文全部正常渲染
  （首帧会短暂显示 src 回退的纯文本，htmlDoc fetch 完即 srcDoc 正常——非 bug）。
- **⚠️ 存储仍告急**：本次未增加存储（复用已传文件）。plant-images 仍 903MB（含 3919 个 batch-img、约 695MB，
  大量是重传批次的重复图）、总 924MB/1GB。**下次大批量上传前必须先扩容 Pro 或清理孤儿图**（batch-img/ 下
  未被任何已发布 HTML 引用的）。清理脚本可后续按需写（先列出候选、用户确认再删）。
- **待办**：用户真机重跑一次小批量上传验证三修生效（顺序识别不再只成第一个 / 编辑框不再空）。

### ✅ 2026-07-13 (续) — 用户第二轮反馈 5 项全处理
1. **孤儿图清理**：full_audit.mjs 一次遍历 253 页建"被引用图"集合 → 432 张未被任何页面/封面引用的孤儿图
   (173.5MB) 全删（delete_orphans.mjs，一批 fetch failed 但服务端已删，重跑确认）。**存储 924MB→751MB，
   可用 76MB→249MB**。plant-images 4324→3892（=被引用数，干净）。
2. **科/属下拉加计数**（plants.index.tsx familyOptions/genusOptions）：Set→Map 计数，label 加 `（n）`，
   镜像已有的 IUCN/保护名录写法。preview 实测：亚麻科（1）伞形科（4）兰科（4）… 属同理。
3. **IUCN 只显示无危(11) 根因=237 条抢救条目 iucn_status 全空**（我的抢救解析器当初没取 IUCN）。修：
   full_audit 从每页 `.conservation-badge .cb-status` 解析真实等级 → apply_iucn.mjs 回填 106 条。
   preview 实测下拉：CR(2) EN(2) VU(11) NT(5) LC(94) DD(3)——各级都出来了。(另 147 页无 IUCN 徽章=保持未评估。)
4. **裸果木遗漏 = 名录数据缺失，非匹配失败**（conservation_probe.mjs + national_gap.mjs 确证）：匹配器工作正常
   （四合木/绵刺/沙冬青/半日花/蒙古扁桃/肉苁蓉都正确命中国家名录）；但国家（2021）种子迁移从 PDF 提取时漏了
   **裸果木/长叶红砂/绶草**（均国家二级）。补：迁移 `20260713120000_national_2021_gap_fill.sql` + 直接 insert
   conservation_taxa（幂等）。preview 实测：国家（2021）匹配数 11→14，筛选结果含裸果木/长叶红砂/绶草。
   ⚠️ **规模判断**：这三个是收藏中确认的国家名录遗漏；那份"匹配省级未匹配国家"49 条大多是内蒙古 2009 的
   地方药用植物（本就非国家级），不是遗漏。**要彻底核对 455 种需重新解析官方 2021 PDF 与库比对**（另一独立
   数据任务，未做——不凭记忆瞎补，避免灌错保护级别）。
5. **答用户：237 条已入库，不需再点「全部应用/全部创建」**（那是浏览器内未入库时的按钮，再点会造重复）。
- **验证**：tsc=0；build OK；preview 全部实测过（科属计数/IUCN 全等级/裸果木命中国家名录）。
- **详情页保护卡** = 烘焙在 ccplants HTML 里的，和站点实时匹配器(conservationMatcher)是两套；用户说的"名单"
  = 索引页筛选/匹配器，已修。裸果木详情页正文里的保护状态是页面自带文案，非本次范围。

## 🆕 2026-07-12 (续十二) — 小P蛙联网搜索（Gemini Google Search grounding，两段式）(✅ DEPLOYED `b00485fa-fb70-448e-a8c1-6ed8b74915fb`)
用户问小P蛙有无联网 → 答：**无**（对话只用训练知识+当前页面文本+图片；识别管线才查 PlantNet/GBIF 等）。用户要加 → 上。
**关键约束**：Gemini `google_search` grounding 与 `responseSchema`（小P对话依赖的结构化输出）**互斥**，不能同一次调用。
**方案=两段式**（identify-plant.functions.ts 新增）：
- `resolveXiaoPGemini(override)`：解析小P有效 Gemini key/model（镜像 xiaopTextCall），非 Gemini 返回 null（grounding 仅 Gemini）。
- `xiaopGroundedSearch(query, override)`：单独一次**自由文本** Gemini 调用带 `tools:[{google_search:{}}]`（无 schema），
  解析 `candidates[0].content.parts[].text` 为 digest + `groundingMetadata.groundingChunks[].web.{uri,title}` 为 sources(≤6)。失败→null。
- `xiaopAskWithGrounding(...)`：①第一次结构化问答；②若模型置 `needsWebSearch=true`+`webQuery` → 跑 grounded search →
  把 digest+来源作为一条 user 消息注入 → ③第二次结构化问答；来源链接兜底追加到 reply 末尾（📎联网检索来源）。grounding 不可用/失败则原样返回第一次答案。
- 两个 ask fn（askDraftAgentFn + askPlantAgentFn）：schema 加 `needsWebSearch`(bool)+`webQuery`(str)、system prompt 加「需最新网络信息才置 true」指令、
  调用从 `xiaopTextCall` 换成 `xiaopAskWithGrounding`。
- **仅 Gemini 生效**（DeepSeek/OpenAI/自定义无原生联网，走原路）；只在模型判定需要时才联网（省 token/延时）；全程 graceful（搜索失败不影响回答）。
- **验证**：tsc=0、build OK、部署 10s。⚠️ **grounding 无法本地验证**（dev server 连 Gemini 被 GFW geo-block 400；线上 Workers 出口正常）。
  待真机：登录后问小P一个时效性问题（如"XX最新保护级别/最新研究"）→ 看回答末尾是否带「📎联网检索来源」链接。

## 🆕 2026-07-12 (续十一) — DeepSeek image_url 崩 + quick 用错模型 + enrich 用户名 + 疑似标题 4 修 (✅ DEPLOYED `d749d939-1ab9-4458-a373-b990cf0050fe`)
1. **DeepSeek(纯文本模型)聊天崩**（openaiCompatChat）：`messages[N]: unknown variant image_url` = deepseek-chat 不支持视觉，拒 image_url 400。
   之前 identify 路径有降级、**聊天路径没有**。修：openaiCompatChat 重构为 `buildMessages(useImages)` + `send(useImages)`；
   带图 400 且错误含 image_url/unknown variant 等 → **自动去图重发一次**（纯文本聊天照常，只是看不了图）。
   （"恢复默认仍报错"多半是用户清的是**管理台 AI 配置**，而小P聊天用的是**每用户 localStorage override**——那个要在小P「模型设置」里点「恢复默认」清。）
2. **quick 摘要卡用错模型**（identifyQuick）：原写死 `process.env.AI_MODEL`(=2.5-flash) → 用量统计 quick 显 2.5、enrich 才显 3.5。
   修：identifyQuick 先 `loadAiConfig()`，若 provider=gemini 用**管理台的 model+key**（3.5-flash），否则回退 env。现在 quick 与 enrich 同模型。
3. **enrich 用量统计用户名全写成 "enrich"/👻**（enrichDraft usage log）：原写死 `user_id:null, user_label:"enrich"`。
   修：查 profiles.display_name（回退 email 前缀）→ `user_id:userId, user_label:"{名字}（进一步草稿）"`。
4. **疑似分享卡中文标题没加疑似**：根因=检测只认 `confidence==='low'`，但用户的榕树是 `confidence:'medium'` + summary 以「疑似」开头。
   修：drafts.$id onMakeCard 检测放宽为 low **或** summary/title 以「疑似」开头；share-card.ts 标题格式改「**（疑似）名字**」（剥重复前缀+醒目色）。
   preview 实测榕树(medium+疑似summary)→卡片标题「（疑似）榕树」✓。
- **验证**：tsc=0、build OK、部署第 2 次成功 10s。疑似标题 preview 实测过；其余三项靠 tsc+build+代码逻辑（需真机 deepseek/识别验证）。

## 🆕 2026-07-12 (续十) — 小P蛙访客拦截 + 三处配置面板加拉取模型/Base URL 前置/URL 格式说明 (✅ DEPLOYED `6557d5be-bc34-4307-8706-8a3664b25d78`)
用户确认两级模型机制 + 提要求。**两级机制现状**：①管理台配的是**全站默认模型**（site_config，注册用户用）；②小P对话侧栏「模型设置」
是**每用户自己的模型**（localStorage，xiaop-user-settings）。**之前缺**访客拦截——`askDraftAgentFn` 无 auth 中间件，访客能直接聊。
**改动**：
1. **访客拦截**（draft-agent-panel.tsx）：加 `isRegistered` prop（默认 true）；`send()` 里 `!isRegistered` → 直接回
   `GUEST_NOTICE`（"只有注册用户可以使用默认配置模型来让小P蛙蹦跶…注册登录后还能配置自己的模型…"），**不调 LLM、不烧 token**。
   drafts.$id.tsx + plants.$slug.tsx 传 `isRegistered={!!user}`。**preview 实测**：登出后发消息→出提示、不请求模型；（登录态门自动放行）。
2. **三处配置面板统一**：Base URL **前置**到「模型」之前 + 「模型」区加**拉取可用模型**（listProviderModelsFn，任意登录用户可调）→
   下拉选真实模型 + 手动输入兜底；Base URL 加**分服务商格式说明**（OpenAI/自定义：填到 /v1、系统请求 {BaseURL}/chat/completions；
   Gemini/Anthropic：无需 Base URL）。改的三处：identify.tsx AdminModelPanel（原顺序 model 在前→已换）、xiaop-model-panel.tsx（同换）、
   **xiaop-user-settings.tsx（原本完全没有拉取，本次新增 fetch+下拉+顺序调整）**。preview 实测 xiaop-user-settings 顺序=服务商/Key/BaseURL/模型 + 拉取按钮在。
- **验证**：tsc=0、build OK、部署第 2 次成功。管理台两面板需 admin 登录未在 preview 实测（靠 tsc+build+与已验证的 user-settings 同构）。

## 🆕 2026-07-12 (续九) — 批准编辑=自动确认邮箱（放行登录）(✅ DEPLOYED `ed347f50-b2d3-4bfe-8181-1344ce207934`)
用户：已批准的 linda0319linda@gmail.com 登录仍报「email not confirmed」。**根因**：`approveApplication`（edits.ts，客户端）只加
editor 角色 + 标 approved，**不确认邮箱**；Supabase 登录要邮箱先确认（点验证邮件链接，常没收到/进垃圾箱）→ 批准≠可登录。
邮箱确认需 **service role**（`auth.admin.updateUserById(uid,{email_confirm:true})`），客户端做不了 → 必须服务端。
**改动**（identify-plant.functions.ts + admin.applications.tsx）：
- 新服务端 fn `approveApplicationFn`（requireSupabaseAuth+admin 校验）：加 editor 角色 → 标 approved → **`auth.admin.updateUserById email_confirm:true`**
  （非致命，失败只 warn）→ 返回 {ok,emailConfirmed}。admin.applications onApprove 改调它（原客户端 approveApplication 废弃，保留未删）。
- 新 fn `confirmUserEmailFn({userId})`：给**已批准但没确认**的老数据补确认。admin.applications 在「已通过」卡片加
  「**确认邮箱·放行登录**」按钮 → 调它。
- supabaseAdmin 用 `process.env.SUPABASE_SERVICE_ROLE_KEY`（写 site_config 一直成功=该 key 有效）→ auth.admin 应可用；
  失败也有兜底（approve 非致命 + 独立按钮报错→退回后台手动确认）。
- **验证**：tsc=0、build OK、部署 114s 一次过（/admin/applications 200）。⚠️ 面板需 admin 登录才可见，**未在 preview 实测**（无密码）。
- **linda 立即放行（用户操作，一次点击）**：登录 plantspedia.club（admin）→ /admin/applications →「已通过」标签 → 找 linda →
  点「确认邮箱·放行登录」。若按钮报错=service key 对 auth.admin 无效，则退回 Supabase 后台 Authentication→Users→Confirm email。

## 🆕 2026-07-12 (续八) — 模型清单更新到 Gemini 3.x + 多 key 改多输入框 + 澄清"小P对话可选3.5" (✅ DEPLOYED `30879d2e-4024-42a9-a730-f3513248107d`)
用户：拉取/下拉仍没 3.5；小P**对话界面**却能选 3.5，很奇怪。**查证（WebFetch ai.google.dev/models，环境日期 2026-07）**：
Gemini 3.5 确实存在（`gemini-3.5-flash` 最强、`gemini-3.1-flash-lite`、`gemini-3.1-pro-preview`、`gemini-3-flash-preview` 等），
2.5 系列未废弃但**旧别名 gemini-2.5-flash 对新 key/项目被 Google 停用**（→ 之前 404；.env 旧 key 仍能用故没事）。
**"小P对话能选3.5"之谜**：xiaop-user-settings.tsx（对话界面里的"我的小P模型"）模型是**自由文本输入框**（可手打任意名），
不是真实可用清单——用户自己打进去的，非系统列出。已向用户澄清。
**改动**：
- 三处静态 gemini 预设更新到 3.x（identify.tsx PROVIDERS、xiaop-model-panel.tsx PROVIDERS、xiaop-user-model.ts XIAOP_PROVIDERS）：
  `[gemini-3.5-flash, gemini-3.1-flash-lite, gemini-3.1-pro-preview, gemini-2.5-flash, gemini-2.5-pro, gemini-2.5-flash-lite]`，
  默认模型改 `gemini-3.5-flash`。（真实可用仍以「拉取可用模型」按 key 查为准。）
- **多 key 改多输入框**（identify.tsx AdminModelPanel）：`apiKey:string` → `keys:string[]`（默认 [""]），每 key 一个 input +「移除×」，
  gemini 显「＋再加一个 Gemini key」；保存/拉取时 `keys.map(trim).filter().join(",")`。**不再提示逗号/分号分隔**。
  （XiaoPModelPanel 仍是单框逗号——本次先只改主 AI 面板；如需同款多框后续再做。）
- **验证**：tsc=0、build OK、部署 46s 一次过。⚠️ 管理面板需 admin 登录才可见，**多输入框 UI 未在 preview 实测**（我无 admin 密码，不便登录），靠 tsc+build 保证。
- **给用户**：进「修改配置」→ 每个 key 一个框（点＋加第二个）→ 填好 →「拉取可用模型」看你 key 真实能用哪些 → 选 `gemini-3.5-flash`（或拉取列表里的）→ 保存。
  若拉取列表**没有** 3.5 = 你这把 free-tier key 的项目暂不开放该模型（Google 侧限制，非本站）；可先用列表里最高的。

## 🆕 2026-07-12 (续七) — key 掩码排版 + 主 AI 面板加「拉取可用模型」（模型名过时 404）(✅ DEPLOYED `2a00f26e-5c7f-4a12-b78f-66a5c92b5415`)
续六修好 401 后，进展到 **404 NOT_FOUND**：`gemini-2.5-flash is no longer available to new users`——用户的新 key 所属项目已停用
旧模型别名。主 AI 模型面板(identify.tsx AdminModelPanel)此前**只有静态旧下拉、没有拉取按钮**（拉取按钮之前只加在 小P蛙面板）。
另外两把长 key 掩码用 `*`.repeat(len-6) 生成一大排星号 → 手机端排版崩。
**修复**：
- identify.tsx AdminModelPanel 加 `fetchModels()`+「拉取可用模型」按钮（复用 listProviderModelsFn，用当前 key 实时列真实可用模型，
  写入 optionModels 覆盖静态列表；命中不到当前 model 自动选第一个）+ 提示「旧模型名对新 key 可能 404，点拉取重选」。
- 掩码统一改短： `k.length<=10?k:`${k.slice(0,4)}…${k.slice(-4)}`` （getAiConfigFn 多 key 池、getXiaoPConfigFn、getPlantNetKeyFn 三处），
  多 key 显示 "AQ.A…xxxx · AQ.A…yyyy（共 N 个 key）"。identify.tsx Key 行加 break-all。
- **给用户**：进「修改配置」→ 填好 key → 点**拉取可用模型** → 从真实列表选一个（如新的 gemini-3 / 最新 flash）→ 保存。
  **不要把 key 贴进聊天**（泄露风险）——已向用户说明。tsc=0、build OK、部署第 2 次成功 13s。

## 🆕 2026-07-12 (续六) — 多 Gemini key（AQ. 新格式）逗号分隔被粘死 → 401 修复 (✅ DEPLOYED `9193cfdd-ae25-4e10-b013-93c9ab9f61d4`)
用户在 AI 模型控制台填两个 gemini key（逗号分隔）→ 快速摘要卡成功（走 .env key）但「生成进一步草稿」401 UNAUTHENTICATED
（Expected OAuth 2…）。**根因**：`splitGeminiKeys` 只认旧版 `AIza…` 正则；新版 `AQ.` 开头的 key 逗号分隔时，
`tokens.every(AIza正则)` 为假 → 走 `unfuseGeminiKeys(join(""))` 把两把 key **粘回成一个乱码串** → Google 拒 = 401。
且 `saveAiConfigFn`/`normalizeApiKey` 在**保存时**就已粘死，DB 存的是坏值。（快速卡走 `process.env.GEMINI_API_KEY` 单 key 故没事；
enrich 走 `loadAiConfig()` 管理台 key 故炸。）**修复**（identify-plant.functions.ts）：
- `splitGeminiKeys` 重写：先按**强分隔符 `[,;\n\r]`** 拆（用户逗号意图优先，任何格式都不再粘回）；≥2 段=显式 key 池，
  各段仅去内部空白；单段再判空格分隔的合法 AIza 池 / 否则去空白后 unfuse。
- `unfuseGeminiKeys` 增强：除 `AIza` 前缀外，也支持按 `AQ.` 前缀拆分**已粘死的存量值**（每段须匹配 `^AQ\.[A-Za-z0-9._-]{15,}$` 才拆），
  → 无需重存也能从坏值恢复两把 key。
- node 实测 15 例全过（含 AQ 逗号、AQ 已粘死恢复、AIza 逗号/换行/fused、单 key、混合、空）。tsc=0、build OK、部署 45s 一次过。
- **给用户**：改动对存量坏值也生效（自动拆回）；若仍报错，建议回控制台**重存一次**两把 key（现在保存不再粘死）；
  若重存后仍 401，则是 key 本身无效或该 key 所属 Google 项目未启用 Generative Language API（非本站问题）。

## 🆕 2026-07-12 (续五) — 用户第二轮反馈：卡片改版2 + 报错诊断 + 补拍建议 + 登录回跳
### ✅ DEPLOYED 2026-07-12：Version `4b632ab8-a50c-43b7-a1e5-b7c69ba1cfd2`（含续四 Phase A/B 全部）。三域名 200。
⚠️ **部署前实测：`plant_drafts.retake_count` 列仍不存在**（anon 查询 42703）——用户以为跑了迁移但该列没建成。
代码兜底=不崩，但**补拍变量加分(1+n)暂未生效**（退回旧每次+1，且 retake_count 不落库）。
**待用户补跑** `supabase/migrations/20260712100000_draft_retake_count.sql`（就一句 ALTER…ADD COLUMN retake_count）后补拍计分才真正生效。
（编辑申请 090000 迁移之前已生效。）
1. **Gemini 400 误诊修正**（identify-plant.functions.ts describeGeminiError）：用户本地上传报 `HTTP 400 · FAILED_PRECONDITION
   · User location is not supported`，旧文案错说「照片过大/密钥格式」。**真因=Gemini API 在当前地区不可用**（本地直连在中国大陆
   被 Google 拒）。新增分支：body 含 "user location is not supported" 或 status=FAILED_PRECONDITION → 明确解释「地区限制，
   非照片/密钥问题；本地需经受支持地区代理/VPN，线上 Workers 通常 OK；或换 OpenAI/中转」。→ **答用户：本地测不了识别是地区限制。**
2. **分享卡改版2**（share-card.ts 重写）：① 科·属移到**与 logo 同行右侧**（drawFitLine 右对齐单行，不再在下方）；
   ② 修「X发现了新植物」标题与简介**重叠**（headingBaseline+48 净距）；③ 简介**硬上限 140 字**，超出→「……（访问
   plantspedia.club 阅读完整内容）」；④「本轮铜叶 +N」用**站点真实铜叶徽章 PNG**（leaf-bronze.png 等，非手绘）；⑤ 登录用户
   右侧显示**铜/银/金叶徽章+数量**统计；访客右侧留空（登录 CTA 移到弹窗）；⑥ 银叶/金叶权益**分两行**、各带 silver/gold 徽章。
3. **访客登录回跳**：卡片弹窗访客显「登录/注册后积累叶片→」按钮 → 存 sessionStorage justIdentified=draftId +
   跳 `/login?redirect=/drafts/<id>`。login.tsx/signup.tsx 加 validateSearch(redirect，仅同源 `/` 开头防开放重定向)：
   登录成功/已登录→`window.location.href=redirect`；signup 若返回 session（关邮箱验证）直接回跳、否则带 redirect 去 /login；
   emailRedirectTo 也带 redirect。登录后回到草稿页→auto-show 重新弹卡（此时有真实叶片统计）。已登录则不显该按钮。
4. **补拍建议具体化**（camera-identify 横幅）：草稿页「去补拍」Link 带 `nmp`=首次 needs_more_photos_zh(≤300)；identify.tsx
   validateSearch 加 nmp→retakeCtx.advice；横幅显「上次识别建议补拍：{advice}」+ 固定提示「对准同一株、**尽量不要同时拍到
   多种植物**、拍完自动重识别」。
- **验证**：tsc=0、build OK(4193 KiB)。preview：卡片改版2 全部渲染正确（科属同行右/无重叠/140截断/真铜叶徽章/两行权益带银金徽章/
   访客登录按钮在弹窗）、补拍横幅显具体建议+多株警示。**⚠️ 未真机**：登录回跳全程、Gemini 真报错文案、真机补拍。
- **①定位在 MacBook 本地失败**＝浏览器**站点级**定位权限（localhost:5199）被拒或系统返回 PERMISSION_DENIED，非代码 bug；
   线上 HTTPS 的手势请求逻辑已就绪。这属环境问题，未改代码。

## 🆕 2026-07-12 (续四) — 识别卡/补拍/加分 大改（用户 4 项反馈）分阶段
用户 4 项：①拍摄框上加粗体警示「AI识别内容不能采纳为食用药用参考！」②补拍流程（点补拍直接开相机→识别；满3次必出结果；
疑似时中文名显示「疑似X植物」；加分=1+补拍次数，疑似恒+1）③识别后**自动**弹重设计分享卡（不用点）④分享按钮平台。
**两处澄清已问用户**：加分公式=**1+n**（补拍0→+1、1→+2、2→+3、3→+4；疑似恒+1）；分享=**只用系统分享面板**
（网页无法自定义面板里的 App、也无法把图片推给抖音/IG/小红书这类无网页接口平台 → 系统面板发图+附带详情页URL 即最优）。

### Phase A ✅ DONE (tsc=0, preview 验证; NOT deployed) — 点①③④
- **①粗体警示**（camera-identify.tsx）：viewfinder 上方常驻红色粗体 `⚠️ AI 识别内容不能采纳为食用药用参考！`。preview 实测 weight=700、vermilion。
- **③分享卡重设计**（`src/lib/share-card.ts` 大改）：1080×**1920**(9:16 更高容更多文字)；小P蛙 logo 改 `drawContain`**完整不裁**；
  科·属 `drawFitLine` 强制**单行**自动缩字号；名称块（疑似→前缀「疑似」红色）；用户图 cover；照片下**首行**=「{X}发现了一种新植物！」
  （X=注册名，访客=小P蛙）；简介溢出→「……（访问 plantspedia.club 阅读完整内容）」；奖励带=铜叶徽+「本轮铜叶 +N」，
  右侧 铜/银/金叶统计（访客显「登录后可累积叶片」）+ 银叶/金叶权益提示（带识别名）；页尾「{X} 邀请你加入 plantspedia.club…」。
- **③自动弹卡**：camera-identify 成功后 `sessionStorage['plantspedia:justIdentified']=draftId`；drafts.$id 挂载读旗标→静默 `onMakeCard({silent})`
  →自动开预览 modal（等 draft+leaves 就绪，ref 防重入，消费后清旗标）。preview 实测：设旗标→导航→卡自动开 1080×1920、旗标已清。
- **④分享带 URL**（shareOrSaveImage 加 opts.url/text/title）：navigator.share 同时带 files+url+text（详情页链接随图走）。桌面无 files 分享→下载兜底。
- data：drafts.$id 加 profile.display_name 查询得 discovererName；leafEarned=疑似?1:1+(draft.retake_count??0)（**前向兼容** Phase B 的列）。
- **验证**：tsc=0；preview 三态（细叶针茅有地/紫叶酢浆草无地/警示语）+ 自动弹卡 + logo 完整 + 科属单行 + 截断语 + 权益提示，均 OK，无 console 错误。

### Phase B ✅ DONE (tsc=0, build OK, preview 验证 UI; NOT deployed) — 点② 补拍流程 + 变量加分
⚠️ **需在 Supabase 后台执行 `supabase/migrations/20260712100000_draft_retake_count.sql`**
（`ALTER TABLE plant_drafts ADD COLUMN IF NOT EXISTS retake_count int default 0`；已同步手改 types.ts 三处）。
**代码对缺列非致命降级**：retake_count 不进 INSERT（改为**成功后 best-effort UPDATE**，缺列静默失败，识别不崩）；
leaves.ts / serverLeafBalance 的 identifyBronze 查 retake_count 若报错→回退旧计数制。**故部署可早于迁移**（暂按现状+1 计分）。
- **变量加分**（leaves.ts `identifyBronze` + identify-plant.functions.ts `serverLeafBalance` 同步）：识别铜叶由 COUNT 改 **SUM**：
  每份草稿 = 疑似(ai_payload.identification_confidence==='low')恒 1；否则 (1+retake_count)，采纳(adopted)再×2。查
  `retake_count, adopted, conf:ai_payload->>identification_confidence`；列缺失→回退 draftCount 旧制。
- **补拍开相机**（camera-identify.tsx）：新增 prop `retake:{count,title,sci}`。retakeMode 下 useEffect **自动 openCamera()**
  （client-side 导航的 transient activation 通常还在→直接弹相机；被拦则显「打开相机补拍」大按钮兜底一次点击）；
  拍到照片→**自动 onSubmit()**（每次补拍都自动重识别，retake() 里重置 autoSubmitRef）；submit 带
  retake_count/species_hint_title/species_hint_sci。顶部加「正在补拍复核「X」（第 N 次）」amber 横幅。
- **服务端**（quickIdentifyDraft + identifyQuick）：SubmitInput 加 retake_count/species_hint_*；identifyQuick 收 opts
  {speciesHint,forceResult,retakeCount}→system prompt 拼「补拍复核：上一轮判断为 X，确认或修正」+ forceResult(retake≥3)
  「必须出最终结论，不足则 low=疑似、needs_more_photos 留空」。retake_count>0 时成功后 UPDATE 存列。
- **草稿页**（drafts.$id.tsx）：存疑横幅「去补拍」→ `<Link to=/identify search={{retake:n+1,st:title,ss:sci}}>`；
  retake_count<3 才显「去补拍」（提示第 n 次成功得 1+n 枚铜叶）；≥3 显「已完成 3 次补拍，最终结果（疑似），记 1 枚铜叶」。
- **identify.tsx**：route 加 validateSearch(retake/st/ss)；IdentifyPage 读 search 传 `<CameraIdentify retake={retakeCtx}>`。
- **验证**：tsc=0、build OK（4190 KiB）；preview 实测补拍横幅（第 1/2/3 次文案、≥3 显「最终结论」、粗体警示同框）、
  自动 openCamera 未卡死。**⚠️ 未真机验证**（需真实拍照+识别+迁移）：自动开相机在真机 iOS 的 activation 成功率、
  自动重识别、服务端强制出结果、变量加分数字。console 报错仅 Vite HMR websocket（preview pane HMR socket 挂了）非应用错误。
- **⏳待办**：① 用户跑迁移；② `npm run build && wrangler deploy`；③ 真机走一遍补拍全程 + 核对铜叶数字。

## 🆕 2026-07-12 (续三) — AI 识别分享卡 + 社媒分享 (✅ DEPLOYED Version `b153e015-3a92-4d4b-80c2-72f0d39bb8be`)
（第一次 deploy fetch failed，重试第 2 次即成功、15s；asset 已缓存不重传。三域名均 200。）
下一迭代第一块：把识别草稿渲染成一张手机 feed 友好的**分享卡图片**，走系统分享面板发微信/小红书/微博 + 存相册兜底
（按 STATE 早先锁定方案：渲染成图 + navigator.share({files}) + 存图兜底；**不做**逐平台 OAuth）。
- **新文件 `src/lib/share-card.ts`**：纯 canvas 2D 直绘（**不引 html2canvas**，bundle 只 +9KiB；且 iOS Safari 的
  SVG-foreignObject→canvas 被封，直绘最稳）。`renderShareCard(data)`→1080×1500 PNG Blob；版式=小P蛙 logo+
  Plantspedia 抬头 · 科/属右对齐 · 📍地点+坐标 · 分隔线 · 中文名/拉丁/英文+俗名 · 用户图(cover 裁切) · 简介(≤4 行省略号)
  · 绿色「识别成功·铜叶 +N（累计 M）」通知条(自绘叶形) · plantspedia.club 落款。
  **防跨域污染**：用户图用 `fetch→objectURL` 载入（非 crossOrigin img），toBlob 不会 taint。
  `shareOrSaveImage(blob,name)`：canShare({files}) 有→系统面板；无（桌面）→ `<a download>` 兜底；返回 shared/downloaded/cancelled。
- **`drafts.$id.tsx`**：toolbar 加「生成分享卡·存相册」按钮（原「分享给好友」改名「分享链接」保留 URL 分享）；
  `onMakeCard`→渲染→弹**预览 modal**（显示卡图 + 「分享/存相册」+「关闭」+ 手机可长按存图说明）；
  leafEarned = draft.adopted?2:1，leafTotal = leaves.bronze（未登录 null→只显 +N）。加 cardUrl/cardBlobRef + 卸载 revoke。
- **验证**：tsc=0、build OK、dry-run 4182 KiB。preview 两例真机数据：①细叶针茅（有地点+坐标+长简介）→卡片 1080×1500
  全元素齐、文字清晰、简介 4 行省略；②紫叶酢浆草（**无地点**）→坐标行优雅省略、科/属换行、布局不塌。无 console 错误。
- **待部署**：`npm run build && ./node_modules/.bin/wrangler deploy`（minify 已生效，~19s）。
- **⏳同期后续可选**：详情页 plants.$slug 也加分享卡（已收录条目分享）；卡片配色深色模式；多语切换。

## 🆕 2026-07-12 (续) — deploy 卡在 8.6MB 脚本 PUT：已用 minify 减半（4174 KiB），待重试
✅ 编辑申请修复迁移用户已在后台执行成功（申请页恢复）。
deploy 剩余唯一失败点 = Worker 脚本一次性 PUT（~8730 KiB，不可续传，GFW/代理掐长上传）。
**修**：wrangler.jsonc 加 `"minify": true`（wrangler 打包 server bundle 默认不 minify）→ dry-run 实测
Total Upload 8730→**4174 KiB**（gzip 1710→1206），PUT 体积减半、传输窗口减半。assets 99 个已全部缓存不重传。
**✅ DEPLOYED 2026-07-12：Version `cb8ec1ed-f8e4-4666-bc6b-99d9aa809e3f`** — minify 后**一次过**，
脚本上传仅 18.96s（上次 8.7MB 版本要 161s 还反复 fetch failed）。plantspedia.club / www / /identify 均 200。
本次上线 = 2026-07-11（四）批次全部内容：名称漂移根修、owner 金/银叶无限、银叶扣/退机制、地图右滑收起+定位按钮。
**待真机**：拍照→草稿名不变；银叶扣/退（silver_leaf 迁移用户已执行过？确认 profiles.silver_used 列在）；
手机若见旧 UI = PWA SW 缓存，强刷。**结论沉淀**：`"minify": true` 永久生效，deploy 从此不再是 8.6MB 大 PUT。

## 🆕 2026-07-12 — 编辑申请页永远为空：根因已定位 + 修复迁移已写好（⚠️ 待用户在 Supabase 后台执行）
用户问「为什么有人注册申请成为编辑，编辑申请页看不到任何消息」。**根因（代码级确证）**：
`supabase/migrations/20260606034500_fix_admin_rls.sql` 为了给 arainjazz 邮箱自动加 admin 角色，
`CREATE OR REPLACE` 重写了 `handle_new_user()`，但**丢掉了 2026-05-13 版里写入 editor_applications 的那段**
——signup.tsx 传的 `editor_application_bio` metadata 从那以后被静默忽略，申请表零新行 → 审核页空。
（顺带：该版 profiles INSERT 还丢了 ON CONFLICT，同 id 重建会炸，一并修。）
**修复**：新迁移 `supabase/migrations/20260712090000_restore_editor_application_insert.sql` —— 合并两版行为
（profiles upsert + admin 自动角色 + editor_applications 写入），并**回填**：凡 auth.users metadata 里有
bio 但 editor_applications 无行的用户，按注册时间补一条 pending 申请。
**下一步（用户）**：Supabase Dashboard → SQL Editor 跑该文件全文 → 刷新 /admin/applications 应看到回填的待审申请。
无前端代码改动、无需部署。⚠️ 无法本地验证 DB：旧 service-role key 已于 2026-07-04 被禁用（legacy keys off），
scratch/*.py 探针全部 401；新 secret key 只在 .env（按规矩不读）。

## 🆕 2026-07-11（四）— 名称漂移根修 + owner无限 + 银叶机制 + 地图右滑/定位 (DONE code, tsc=0+build OK)
⚠️ **需先在 Supabase 后台执行 `scratch/migration_silver_leaf.sql`**（加 profiles.silver_used、
plant_drafts.enrich_silver_spent；已同步手改 types.ts）。用户已同意去执行。代码对缺列**非致命降级**（读→0，写→跳过），
故部署早于迁移也不崩，只是暂不真正扣/退银叶。
1. **名称漂移真修**（identify-plant.functions.ts）：上一轮 pin 有洞——「跳过重新定种」只看 `pinnedSci`，
   phase-1 只存中文名、学名空时仍会重新定种→学名漂移。改成 `pinned = pinnedSci || pinnedTitle`，
   两个 re-ID stage 都 gate on `!pinned`。→ **答用户：是 enrich 的洞，非识别不准。**
2. **owner（arainjazz@gmail.com）金叶+银叶无限**：`serverGoldAvailable`→`serverLeafBalance(userId,email)`
   算 gold+silver、owner→Infinity；createGoldDetailPageFn owner 不扣叶、goldRemaining=null（前端显示∞）；
   lib/leaves.ts computeLeaves + LeafStats 加 silverUsed/silverAvailable，owner→Infinity；leaf-panel 显示 ∞。
3. **银叶机制**：enrichDraft 加 requireSupabaseAuth + 校验 silverAvailable≥1（不足报 SILVER_INSUFFICIENT）；
   生成成功后非 owner 扣 1 银叶（乐观并发 `.eq(silver_used,原值)`）+ 标记 draft.enrich_silver_spent=true；
   rejectPlantDraft 驳回时若该 draft enrich_silver_spent 则退还（原子翻 flag 保证只退一次，退给 created_by）。
   前端：草稿页 enrich CTA 加银叶提示（消耗1枚+驳回退还+当前可用）、未登录显示「登录后可生成」跳 /login；
   leaf-panel 规则加「1银叶=1次生成草稿（驳回退还）」。
4. **地图（explore.tsx）**：① 说明卡加 onTouchStart/End，水平滑动>55px 收起（避免误触竖向滚动）+ 卡顶提示
   「←左右滑动收起→」；② 新增左下角「我的当前位置」按钮 `locateMe()`（getCurrentPosition→setUserCoords+
   map.setZoomAndCenter(15)），wgs84togcj02 转坐标。
**验证**：tsc=0、build OK；/explore preview 真机数据渲染、定位按钮+滑动提示在、无 console 错误。
**⛔ DEPLOY BLOCKED 2026-07-11 07:48**：`wrangler deploy` 两次均 `fetch failed`（GFW 掐 api.cloudflare.com
大上传）；第二次增量进度到 "Uploaded 26 of 39 assets" 后仍失败。**dist/ 已 build 好，纯网络重试**：
网络稳一点或换 VPN 出口节点（HK/JP）后重跑 `./node_modules/.bin/wrangler deploy`（增量续传，会越传越少）。
**别忘了**部署后去 Supabase 跑 `scratch/migration_silver_leaf.sql`。
**待真机**：拍照→草稿名不变；银叶扣/退（迁移后）；地图右滑收起+定位。

## 🆕 2026-07-11（三）— 定位卡死 + 3 个显示 bug 修复 (DONE code, tsc=0; 已随本批部署)
1. **定位一直转圈、无授权弹窗（Chrome iOS）** — 根因：iOS WKWebView 已知 bug，`enableHighAccuracy:true` 时
   getCurrentPosition 可能**两个回调都不触发、且忽略内置 timeout** → 永远 loading。若还无弹窗，多半是
   **iOS 定位服务对 Chrome 关闭**（系统压根没法弹框）。修 `camera-identify.tsx requestGeo`：
   ① 加 `settled` + 13s **硬墙 setTimeout** 保证收敛；② 改 `enableHighAccuracy:false`（网络定位更快更不易卡）；
   ③ 加 `geoStatus:"timeout"` + 明确文案「查 iOS 设置→隐私→定位服务→Chrome」。⚠️ 无法替用户开系统开关。
2. **enrich「只有配图没有文字」** — 根因：`findExistingSpeciesDraft` 把刚建的 phase-1 lite 卡（同物种、
   payload 只有 summary）当可复用完整草稿 → token-saving 复用空 payload → 有图无文。修：跳过
   `_enriched===false` 或缺 morphology_zh/habitat_zh 的 payload。
3. **草稿名与卡片名不一致** — 修：`callAiIdentify` 加 `speciesHint`（有 pin 时跳过重新定种+硬指令锁定）；
   `buildDraftContent` 透传并在渲染前把 meta.title/学名覆盖为 pin；`enrichDraft` 传 phase-1 名，DB 列
   title/学名/科/属/俗名锁定为 phase-1 值。
4. **金叶详页图片不显示** — 根因：`rehostImages` 用 `cf.image`(付费 Image Resizing)，未开通时 resized 子请求
   失败→整批图被 drop。修：download(useResize) resized 失败**回退 plain fetch**，MAX_STORE 提到 5MB。
**验证**：tsc=0。**待真机**：Chrome iOS 定位；完整草稿有正文且名不变；金叶详页图显示。

### PlantNet 多图（已答）：现状只发单图 `organs:"auto"`。**多张不同器官图→更准**（API 支持一次≤5 图、
每图带 organ 标签，本就是多器官证据融合）。卡片重设计应支持 1–5 张连拍/上传。

### 大改造待办（下一期）：AI 卡片重设计 + 社媒分享
指定版式：科/属页头 + 小P蛙 logo + 坐标 + 分隔线 + 拉丁/中/英/俗名 + 用户图+140字简介 + 积分通知(铜叶+2/+1及总数)
+ 保存到相册/分享；进一步草稿按钮加「消耗一枚银叶」规则。⚠️ **社媒分享现实**：网页无法替用户登录发到
微信/小红书/抖音/微博；可行=卡片渲染成图片 + `navigator.share({files})` 系统分享面板 + 存图兜底；**不做**逐平台 OAuth。

## 🆕 2026-07-10（二）— Gemini 429 + 报错必须"代码+原因+怎么办" (DONE code, tsc=0; **NOT deployed**)
**用户误解澄清**：Pl@ntNet 只是 Stage 0，输出「物种判定+置信度」的 `idHint` 塞进 LLM system prompt；
**它不写任何文案**。summary/形态/生境/人文/养护 全由 Gemini 生成 → Gemini 429 会让整个识别失败（即使 Pl@ntNet 已定种）。
429 = Gemini 免费额度超限（RESOURCE_EXHAUSTED），分「每分钟RPM」和「每日RPD」两种。
**新增错误层**（identify-plant.functions.ts）：
- `class AiError {code,message}`；`parseGeminiError(body)` 解析 Google 结构化错误
  （error.status / error.message / details[].QuotaFailure.violations[0].quotaId / RetryInfo.retryDelay）。
- `isDailyQuota(quotaId)` = /PerDay/i。`describeGeminiError(status,body,model)` → 429(日/分钟)/503/400/401/403/404/5xx
  各自的中文「代码+原因+怎么办」。`describeHttpAiError(tag,...)` 供 OpenAI/Anthropic/自定义中转分支复用。
- **智能重试**：日额度耗尽 → 不再重试（原来盲目重试 3 次白等 15s）；分钟限流 → 按 Google 的 retryDelay 退避（上限30s）。
- GEMINI_EMPTY（带 blockReason: SAFETY/MAX_TOKENS）、GEMINI_BAD_JSON、GEMINI_NETWORK、AI_MODEL_NOT_MULTIMODAL 均有码有因。
- `identifyQuick` 原先把 429 吞成 null → 回退重跑再等一轮；现在日额度耗尽直接 throw AiError（catch 里 `instanceof AiError` 重抛）。
- 存储/草稿类错误也补码：STORAGE_UPLOAD_FAILED / DRAFT_INSERT_FAILED / DRAFT_NOT_FOUND / DRAFT_ALREADY_APPROVED /
  DRAFT_NO_PHOTO / PHOTO_FETCH_FAILED / DRAFT_UPDATE_FAILED（共 9 处）。
**前端**：toast 会消失 → camera-identify 加 `errorMsg` 常驻红色面板（复核态）；drafts.$id 加 `enrichError` 面板；
两处 toast duration 12s。
**验证**：tsc=0；用 Google 真实 429 payload 四种形态实测 parser（日额度→daily=true不重试；分钟→retry=28s；
bad key→INVALID_ARGUMENT；非JSON→优雅降级）；preview 两路由 200、无 console 错误。
**下一步**：部署。

### 追加：Gemini 多 key 自动轮换池 (DONE code, tsc=0; **NOT deployed**)
用户实测：重试后摘要卡成功 → 撞的是**每分钟限流 RPM**，不是日额度。病根是「生成完整草稿」一步会连打
Gemini 多次：`callAiIdentify`(重稿) + `generateConservationCard` + `generateInvasiveCard`（后两者走
`xiaopTextCall`→`geminiChat`，默认同一个 key），加上旧重试逻辑失败后再补请求 → RPM 爆掉。
**关键事实**：Gemini 免费额度(RPM+RPD)按 **Google Cloud 项目**计，每个 key 属一个项目 → N 个不同账号/项目的
key = N 套独立配额桶。所以 429 时应「换 key」而不是「干等」。
- `splitGeminiKeys()` + `unfuseGeminiKeys()`：apiKey 字段支持逗号/换行/分号分隔的 key 池；
  单 key 夹杂空格仍自愈；**单行 <input> 粘贴会吞掉换行把两个 key 粘死** → 用 `(?=AIza)` 前瞻切分复原，
  且仅当每段都是 35–45 字符合法 key 才切（含 "AIza" 子串的单 key 不会被误切）。
- `callGeminiWithRotation(keys, {model,body,timeoutMs,label})`：每 key —— 429日额度→退休该 key；
  429分钟限流→**立刻换下一个 key**（另一项目 RPM 独立）；401/403/invalid→退休；5xx→换 key；
  400/404 是配置错(每个 key 都一样)→立即抛。全池扫完且仍有可用 key → 按 Google RetryInfo 退避一次再扫一轮。
- 接入 3 处：`callAiIdentify` 的 Gemini 分支（删掉原手写重试循环）、`identifyQuick`、`geminiChat`
  （后者同时覆盖 小P蛙 对话 + 入侵卡/保护卡）。
- `normalizeApiKey(provider, raw)`：gemini 保留 key 池(逗号 join)，其他 provider 维持去空格。
  接入 loadAiConfig / loadXiaoPConfig / toOverride / saveAiConfigFn / saveXiaoPConfigFn；
  `listProviderModelsFn` 取池中第一个 key 探测。zod apiKey max 1000→4000。
- 前端：identify.tsx + xiaop-model-panel.tsx 保存时不再 `replace(/\s+/g,"")`（改 `.trim()`，服务端按 provider 归一化）；
  Pl@ntNet key 仍去空格。AdminModelPanel gemini 下加提示「可填多个 key，429 自动轮换」；
  `getAiConfigFn` 返回 keyCount + 逐个掩码「共 N 个 key」。
- **验证**：tsc=0；node 实测 `splitGeminiKeys` 9 例全过（含 fused-paste 复原、含 AIza 子串不误切）；
  `callGeminiWithRotation` 决策表 7 例全过（分钟限流0等待换key / 日额度退休 / 双日额度快速失败 /
  单key按28s退避 / 400快速失败 / 401轮换）。preview 两路由 200、无 console 错误。
- **待办**：`geminiChat` 的 `maxRetry` 参数已失效（轮换器内部管重试），签名保留未清理。

### ✅ DEPLOYED 2026-07-11：Version `e2360b36-dd4c-4869-ac25-eedac1177842`
本次上线包含：多 key 轮换池（callGeminiWithRotation，逗号/换行分隔多个 Gemini key，撞 RPM 自动换 key、
日额度耗尽跳过该 key）、Gemini/OpenAI/Anthropic 报错「代码+原因+怎么办」、金叶详页生成器
（createGoldDetailPageFn + premium-page.ts）。plantspedia.club / www / /identify 均 200。
**部署踩坑记录**：这次 wrangler 走**本地代理** `127.0.0.1:7888`（HTTP_PROXY/HTTPS_PROXY 已设，egress 出台湾 HiNet），
资源上传（99 文件 ~8.7MB）**头两次 fetch failed**，但 asset 上传是**增量**的——第 3 次「No updated asset files to
upload」直接进到脚本上传（161s 慢但成功）。**结论：deploy 报 fetch failed 别慌，重跑 2-3 次即可，asset 不会重传。**
**待办**：管理后台加第二个 Gemini key（逗号分隔）；金叶账号真机试生成一次。

### ✅ 金叶「一键创建详细科普页」生成器 (DONE code, tsc=0, lint clean; ✅ 已部署)
ccplants-v19 skill 的**服务端移植**。新文件 `src/lib/premium-page.ts`：
- `ANTI_FABRICATION` + `WRITING_RULES` 从 SKILL.md 移植；`factsBlock()` 把服务端实查的名录数据
  作为 ground truth 注入 prompt（禁止模型改写/自行加名录；未命中就要写"未被收录于…"）。
- **三段式 LLM**（PREMIUM_SCHEMA_1/2/3 + premiumPrompt1/2/3）：单次巨型调用必然超输出上限被截断成坏 JSON，
  故拆成 ①引言+形态总览+6特征卡+近似种 ②生境7chips+人文5卡+文学原文 ③生态+分布入侵+博物趣闻(驱动问题+5小节)。
- `renderPremiumHtml()` 版面：masthead / hero+俗名条 / 6 章节 / 10 个 img-slot / 2 栏杂志式趣闻 / references / colophon。
  响应式 @900px 全部塌成单列。`escKeepStrong()` 只放行 `<strong>`（XSS 已测）。
- ⚠️ **刻意砍掉 v19 的 Section V「最新资讯」**：它要求每张卡带可点击 URL，而站内模型无法联网核实，
  强行生成=逼它编造链接、违反反虚构协议。改为 `renderReferences()` 用**真实**链接
  （GBIF taxonKey / POWO / iNat / Wikimedia / 名录 source_url）程序化渲染。
- 文学卡：`has_record=false` 或 original_text 为空 → 不出 blockquote，改出"宁缺毋造"说明（防模型撒谎）。

`identify-plant.functions.ts` 新增：
- `serverGoldAvailable(userId)`：**服务端**重算金叶余额（绝不信客户端传的数），镜像 lib/leaves.ts 公式。
- `gatherVerifiedFacts(draft)`：查 conservation_lists/taxa + GRIIS + gbifCheckInvasive + lookupChinaInvasive，
  组装 VerifiedFacts + 真实 sources 链接。
- `createGoldDetailPageFn`（requireSupabaseAuth）：验余额 → 载草稿(需有学名) → 取证 → fetchSpeciesPhotos(9)+rehostImages
  → 三段 LLM(走 xiaopTextCall，支持小P蛙独立模型/用户 override) → renderPremiumHtml → 传 plant-html 桶 → 插 plants 行
  (`source:'gold_oneclick'`) → **最后**扣叶：`.eq("gold_used", 原值)` 乐观并发，双标签页不会重复扣。
  扣叶失败只 console.error 不抛（页已生成，不能让用户白丢）。
  `UserModelInput` 是后声明的 const → inputValidator 里在**请求时**引用，避免 TS2448。

`drafts.$id.tsx`：金叶按钮从占位 toast 换成真实调用 `createGoldDetailPageFn` → 成功后 invalidate leaves、
跳 `/plants/$slug`；加 goldBusy/goldError（常驻错误面板）；生成中禁止点遮罩关闭弹窗。

**验证**：tsc=0 + eslint clean；node 实测渲染器（6卡/7chips/5人文卡/5趣闻小节/2栏/引用链接/无横向溢出/
XSS 转义/<strong> 保留/文学卡三态：无记录、has_record但空文本、真有原文）；浏览器实测桌面 1280 三栏 masthead +
两栏 intro，移动 375 全塌单列无溢出；**修了一个真 bug**：img onerror 加 .broken 时占位 <span> 只存在于"无 URL"分支，
导致死链变成静默空灰框 → 改为两分支都输出 <span>，CSS 控制显隐（已实测死链会显示"图片待补"）。

**待办**：真机跑一次真实生成（需金叶账号 + Gemini 配额）；生成耗时可能数分钟，考虑后续改成后台任务 + 轮询。

### 已答：ccplants-v19 skill 接入小P蛙（已实现，见上）
skill 在 `~/.claude/skills/ccplants-v19/SKILL.md`（40KB，801行，无 references/scripts）。
它是**给带工具的 agent 用的工作流**：要查 FoC/POWO/GBIF/IUCN/CNKI 做研究、用 curl 串行下载 Wikimedia 图
（含 UA 伪装+4s 间隔限流规避）、生成分布图 SVG、写文件、跑 G1–G5 质量门。
而站内 小P蛙 = `xiaopTextCall` 单次 LLM 调用，**无工具、无 shell、无文件系统**（跑在 CF Workers）。
→ 不能"调用"这个 skill；但可以**移植**：把 SKILL.md 的结构/写作规则/反虚构协议做成 system prompt + HTML 模板，
配合站内已有的服务端能力（fetchSpeciesPhotos+rehostImages 填图槽、GBIF/GRIIS/保护名录查询、conservation.ts），
由 小P蛙 的模型产出 HTML。这正好可以充当金叶「一键创建详细科普页」的生成器（目前是占位）。

## 🆕 2026-07-10 — 上线后 5 项真机反馈修复 (DONE, tsc=0; ✅ 已部署上线)
**DEPLOYED 2026-07-10：Version `dc5f6914-aaf2-4101-be7a-b868d1ee7be7`**（脚本上传 21.22s 一次过）。
线上校验：3 域名均 200；已 curl 线上 `assets/identify-*.js` chunk 确认含新字符串
（"拍摄时会请求定位"/"开启定位"/"本站的定位权限已被拒绝"）→ 新代码确实生效，非缓存。
⚠️ **用户必做**：Chrome 里本站定位此前被设为 denied，浏览器不会再弹框——须手动清：
Chrome ⋯ → 设置 → 内容设置 → 位置信息 → 允许 plantspedia.club。清完后新的"手势时请求"逻辑才能弹框。
⚠️ 手机若仍见旧 UI = PWA SW 缓存，需强刷。
1. **【根因】Chrome iOS 不弹定位授权框**（camera-identify.tsx）：`requestGeo()` 原先只在 `ingestImage` 里调用，
   而它由 file input 的 **change 事件**触发——原生相机刚关闭、页面刚回前台，**没有 user activation**。
   Chrome iOS 此时静默拒绝且不弹框；Safari 宽容仍弹 → 完美解释"Safari 行、Chrome 不行"。
   修复：把 `requestGeo()` 移到**快门/相册按钮的 click handler**（真实手势）里，相机打开前就请求；
   `ingestImage` 不再重置 coords（否则丢掉手势时拿到的定位）；加 `coordsRef` 防 stale closure；
   加 Permissions API 探测 `permState`，idle 态显示「开启定位」按钮（prompt）或「已被拒绝+手动开启指引」（denied）。
   ⚠️ denied 后任何代码都无法强制重弹，只能引导设置——已在 UI 说明。
2. **补拍按钮**（drafts.$id.tsx）：存疑横幅内加「按上面的提示去补拍」按钮 → Link 到 /identify；加 CameraIcon。
3. **补拍提示改大白话**：AI_META_SCHEMA + AI_QUICK_SCHEMA 的 needs_more_photos_zh/en 描述 + 两处 systemPrompt
   全部改为「面向不懂植物学的普通人，①②③ 编号，2–4 条一句话一个动作，严禁术语(脉序/被毛/托叶/花序…)，
   如『把叶子翻过来拍背面（看清叶脉和有没有细毛）』」。横幅加 whitespace-pre-line 以显示编号换行。
4. **【根因】配图高度雷同**（fetchSpeciesPhotos）：旧代码 `for (ph of obs.photos)` **从同一条观察记录里连取多张**
   （同株同天同角度）。修复：每条观察/occurrence 只取 `photos[0]`；新增 `pickDiverse()` 按
   (place, season月份, user) 三轴贪心去重（strict 3→2→1 三轮放宽）；候选池 per_page 30→60。
   **实测验证**（Taraxacum officinale 真实 API）：旧法5张里有2张同属一条观察记录(同用户同月)；
   新法5张 = 5个不同观察/用户/月份/地点。
5. **存 Supabase 前压缩**（rehostImages + Wikimedia）：
   · Wikimedia 原先用 `ii.url`=**全尺寸原图**（实测 1.85/6.45/9.40 MB！）→ 改用 `ii.thumburl`，iiurlwidth 640→1200。
   · rehostImages：fetch 带 `cf:{image:{width:1280,quality:78,fit:scale-down,format:webp}}`（CF Image Resizing，
     未启用则自动忽略=安全 no-op；dev/Node 也忽略）；MAX_STORE_BYTES 3MB、MAX_SOURCE_BYTES 20MB（超限跳过）。
   · ⚠️ Workers 无 sharp/canvas，无法进程内重编码；压缩靠「源端要缩略图 + CF Resizing + 硬上限」三层。
   · 用户原图本就在客户端 compressImage(1200,0.75) 压过再上传，无需改。
**验证**：tsc=0；preview 确认 permState 探测 + denied 分支文案渲染、无 console 错误；iNat/Wikimedia 两个 API 实测。
**下一步**：`npm run build && ./node_modules/.bin/wrangler deploy`（VPN 开），然后手机 Chrome 真机验证定位弹框。

## 🆕 2026-07-09（下午）— 识别流程4项大改 (代码全 DONE; ✅ 已部署上线)
**DEPLOYED 2026-07-10：Version `8d142583-79ad-477c-bf2b-716ea578a2b5`**（wrangler 4.99.0，
本地二进制 `./node_modules/.bin/wrangler`；全局无 wrangler 命令）。脚本上传 69.88s 一次过（VPN 开着）。
plantspedia.club / www / /identify 均 200。⚠️ 手机若仍见旧 UI = PWA SW 缓存，需强刷/清缓存。
**待真机验证**：拍照→秒出摘要卡→「生成完整草稿」→配图不裂→金叶账号见详页按钮。
用户提出4项需求：
1. **地点不臆造 + 授权可重试**（✅ DONE, tsc=0, 已preview验证）
   - `identify-plant.functions.ts` systemPrompt：habitat_zh 在 hintPlace 为空时改为「严禁臆造，写拍摄地点未知」；
     加硬性规则#4 全局禁止任何字段编造/反推拍摄地名。（根因：正文地点是 LLM 现编，卡片才是真实 GPS 反查）
   - `camera-identify.tsx`：抽出 `requestGeo()`，加 `geoStatus` 状态；复核界面新增位置横幅
     （loading/已获取+重新获取/未获取到amber+重新获取位置按钮+iOS/Chrome 设置引导）。
     ⚠️ 浏览器不允许强制重弹原生授权框；denied 后只能引导去设置——已在文案说明。
2. **AI 配图转存 Supabase**（✅ DONE, tsc=0）— 新增 `rehostImages(urls, prefix)`（10s超时+类型/8MB守卫，
   逐张非致命，失败丢弃）；submit 流程 `fetchSpeciesPhotos`→`rehostImages("drafts/species/section")`，
   全失败才回退外链。修复国内热链裂图。⚠️未真机（需真实识别跑）。
3. **不轻易定种**（✅ 轻量版 DONE, tsc=0；多图合判分期留后续）— 决策「两者都要,分期」。
   - AI_META_SCHEMA 加 `identification_confidence`(high/medium/low) + `needs_more_photos_zh/en`；
     PlantDraftFields 加同名可选非渲染字段（随 ai_payload 存库）；systemPrompt 加硬性「宁可 low 也不武断定种，
     low 时必须列补拍器官/角度清单，summary 以疑似开头」。
   - `drafts.$id.tsx` 标题下加 amber 存疑横幅（读 ai_payload.identification_confidence + needs_more_photos_zh）。
   - ⏳后续期：多图连拍/上传合并送 AI 联合判断（新流程）。
4. **两段式生成**（🔨 进行中）— 决策：分享面板存相册 / 金叶详页先门控+确认+扣叶（生成器后补）。
   - **4a 后端 ✅ DONE, tsc=0**（identify-plant.functions.ts）：
     · 抽出 `buildDraftContent({dataUrl,photoUrl,place,lat,lng})` = 原 submit 的重活（识别→配图rehost→
       保护/入侵卡→renderDraftHtml），无 DB 写；submitPlantDraft 改为 upload+buildDraftContent+INSERT（行为不变）。
     · 新增 `identifyQuick(dataUrl,place)` = 仅 Gemini 的轻量识别（species+短摘要+field_notes+置信度+补拍，
       AI_QUICK_SCHEMA，45s超时，无key返回null）。
     · 新增 `quickIdentifyDraft`(phase1)：auth+geocode+upload+identifyQuick→INSERT 轻草稿
       (ai_payload._enriched=false，html=极简摘要卡)；无 Gemini 时回退 buildDraftContent(enriched=true)。
       返回 {draftId, enriched, identification_confidence, needs_more_photos_zh, title}。
     · 新增 `enrichDraft`(phase2)：EnrichInput{draft_id}；load草稿→重新 fetch photo_url→dataUrl→
       buildDraftContent→UPDATE 同行 + ai_payload._enriched=true；已 approved/已 enriched 拒绝。
     · 抽 `resolveCreator()` 共享 auth。**camera 仍用旧 submitPlantDraft，应用不受影响。**
   - **4b 前端相机 ✅ DONE, tsc=0, preview验证**（camera-identify.tsx）：submit 改用 `quickIdentifyDraft`；
     成功 toast「已生成简介摘要卡」→跳 /drafts/$id；加 `originalFileRef` + `saveToAlbum()`
     (navigator.canShare/share files → iOS 存储图像；不支持则 <a download> 回退)；复核界面位置横幅下方
     加「保存原图到相册」按钮。已 preview 确认横幅+按钮渲染。
   - **4c 草稿页 ✅ DONE, tsc=0, 路由挂载验证**（drafts.$id.tsx）：加 leaves 查询(computeLeaves)→goldAvailable；
     `notEnriched = ai_payload._enriched===false`（旧草稿无此字段→视为已 enriched，行为不变）；
     notEnriched 时摘要卡下方显示「让 AI 生成进一步介绍草稿」按钮→`onEnrich` 调 enrichDraft + invalidate；
     enriched && goldAvailable>0 时页尾显示 amber「用1金叶创建详细科普页」+用户指定提示文案 + 二次确认弹窗。
     ⚠️**确认后暂不扣金叶/不建页**（生成器为后续一期，toast 告知「即将上线」）——避免为占位烧掉用户挣的金叶。
   - **待真机**：手机 Chrome /identify 拍照→快速出摘要卡→草稿页「生成完整草稿」→配图非裂图；金叶用户见按钮。
   - **⏳后续期**：① 金叶详页 premium HTML 生成器 + 真实扣 gold_used；② #3 多图连拍合判。

## 🆕 2026-07-09 — Chrome 定位兜底 + 入侵卡移动端显示 (DONE code, tsc EXIT=0; NOT deployed, 未真机)
用户：手机 Safari 拍照能显示具体地点、Chrome 不能；且入侵警示卡在手机端显示不全。
- **定位（camera-identify.tsx）**：`getCurrentPosition` **无法绕过**浏览器授权弹窗（已向用户说明）。Chrome iOS 失败多为
  未给站点/Chrome app 定位权限。用户选「实时优先 + EXIF 兜底」。实现：ingestImage 里并行用 `exifr.gps(file)` 读照片自带
  GPS 存 `exifCoordsRef`（无需授权），live 成功则覆盖；denied 分支若有 EXIF 则 setCoords+toast「✓ 已使用照片自带位置」；
  onSubmit `finalCoords = coords ?? exifCoordsRef.current`。retake 里重置 ref。exifr 已在 deps。
  ⚠️ EXIF 反映拍摄时的地点（相册旧照可能是旧地点）——用户接受的权衡。
- **入侵卡（plant-html-template.ts）**：根因 `.ic-head` flex 不换行 + 卡片 `overflow:hidden` → 窄屏「入侵等级」徽章被裁。
  加 `@media(max-width:640px)`：ic-head flex-wrap:wrap、badge flex-basis:100% order:3 换独立整行、h2 缩到 19px。
  **存量草稿/条目**：同款覆盖注入 iframe——plants.$slug.tsx css 串 + draft-enhance.ts VIEWER_STYLE 移动端块。
- **验证**：tsc EXIT=0。**USER VERIFY**：手机 Chrome /identify 拍照→草稿出具体地点（或用相册带 GPS 的照片）；
  拍入侵种→草稿/详情页入侵卡头部徽章换行不裁切。然后 `npm run build && wrangler deploy`(VPN)。

## 🆕 2026-07-05 — 大改造方案敲定 + Phase 1 溯源表头 (DONE code, tsc EXIT=0, 已真机验证; NOT deployed)
用户规划了一个 6 模块大升级（见 memory `distribution-map-entry-dedup-spec`）。分阶段小步走，**先搭数据地基**。
**已锁定的 4 个决策：** ①地图点按优先级取单色 入侵红>保护棕>采纳绿>未采纳蓝，聚合点画比例饼环；
②skill 查重相似度分档（学名前两词相同才触发）：**≥60%** → 自动合并/去已有页编辑；**<60%** → 平行存在/自动合并/去编辑；
③相似度=服务端"可见正文文本"(剥 HTML/图/拍摄记录) n-gram 比对；④先做数据地基。
**两类条目**：AI识别条目(`source='ai_identify'`，采纳草稿生成) + AI skill条目(`html_upload`+`gold_oneclick`小P蛙调 ccplants-v19)。
去掉站内富文本编辑 → 不再有新 `manual`（用户确认库里无旧 manual 条目=选项c）。**博客/项目是独立内容域，不受影响。**

**⚠️ 已修正的认知错误：** ①`/explore` **已有** Leaflet 地图(markercluster+观测点+入侵黄三角)，地图模块是**扩展**不是新建。
②采纳草稿生成的条目 `source` 当前是 **null**（不是 ai_identify）、`content_type='html'` → 无法靠字段区分 AI识别vs skill上传，
**唯一可靠信号=是否存在来源草稿**(`plant_drafts.published_plant_id`)。

**Phase 1 已完成第一片（零 schema 改动，纯加法）— 溯源表头：**
- `src/lib/edits.ts` 加 `fetchOriginProvenance(plantId)`：取指向该条目最早的 plant_drafts，解析识别者显示名。
- `src/routes/plants.$slug.tsx`：`attributionFooter` 在"创建者"下加"最早识别：{用户}·{地点}·{时间} ｜ 采纳：{编辑}·{时间}"。
  采纳人/时间取自现有 `plant_edits` 的 `kind='create'` 行(editor_name 已解析)。对**所有**条目查来源草稿（skill 上传无草稿→不显示）。
- **已真机验证**：/plants/medicago-sativa-l（紫花苜蓿）正确显示"最早识别：吉木·内蒙古…·2026/06/24 ｜ 采纳：吉木·2026/06/24"，
  无 console 报错，tsc EXIT=0。（capture_place 有"伊金霍洛旗"重复=原始数据粒度问题，非本次 bug。）
**Phase 1 剩余两片已完成（tsc EXIT=0，真机验证）：**
- **skill 条目页尾"上传：{编辑}·{时间}"**：`attributionFooter` 改成三元——有来源草稿→"最早识别…"；无→"上传…"。
  ⚠️ 当前库里 **11 条全部有来源草稿**（无纯 skill 条目），故"上传"行暂无真实数据可视验证，仅 tsc+构造验证。
- **「注 N」点击跳页尾**：注=正文里现有的 `.lov-edit-mark` 上标（编辑改块时 html-doc-editor 自动加，`data-edit-id`）。
  **关键坑**：详情页 iframe `sandbox` **无 allow-scripts**（故意，中和上传 HTML 的脚本防 XSS）→ 注入脚本 postMessage 跑不了。
  **正解**：srcDoc+allow-same-origin=同源，父页面在 iframe `onLoad` 里直接给 `contentDocument` 挂委托 click 监听 → setFocusedNoteId
  → `EditLogSection` 收到 `focusEditId` 后自动展开+滚动到 `#note-{id}`+红色高亮 2.4s。（`edit-log-section.tsx` 加 focusEditId prop+行 id+flash。）
  真机验证：合成 `.lov-edit-mark` 注入 iframe 点击 → 修改记录展开、正确行高亮。**验证时被 SW+Vite 缓存坑过**（served 旧模块）——
  排查靠对比磁盘 grep vs served；清 `node_modules/.vite`+重启+注销 SW 后通过。见 [[pwa-service-worker-caching]]。
## 🆕 2026-07-05 (续) — P2 采纳去重合并流程 (DONE code, tsc EXIT=0; 核心逻辑真机验证; 写路径待用户授权测)
"采纳识别"改造针对的是 **drafts.$id.tsx 的「审核通过并收录本站」按钮**（onApprove→`approvePlantDraft`），
不是那个铜叶奖励开关。**收录=创建 AI 识别条目**。
- **`src/lib/plants.ts` 加 `speciesKey()`**：去 markdown 星号/下划线 + 取前两词 + 小写。**真机验证**：两个 Anthurium
  （`*Anthurium crystallinum* Linden ex André` vs `Anthurium crystallinum Linden & André`）→ 都 `anthurium crystallinum` 匹配；
  两个 Convolvulus 不同种 → 不匹配。学名脏数据（`*...*`、命名人后缀）能正确归一。
- **`approvePlantDraft` 三分支**（输入加可选 `mergeTargetId`）：
  ① `mergeTargetId` 传了 → **合并**：先建 `kind='merge'` + `marker_n=N` 的 plant_edits 行拿 id → 拉目标 HTML 追加
     「补充观测」卡片（含 `.lov-edit-mark[data-edit-id]` 注N，用 P1 的点击跳转）→ 传新 HTML、更新 html_url + co-author →
     草稿标 approved/published_plant_id=目标。② 无 mergeTargetId 但同物种已有条目 → 返回 `{conflict,target,whatsNew}`（**不写库**）。
     ③ 无同物种 → 正常新建，**显式写 `source:'ai_identify'`**（修了 P1 发现的 source=null 问题）。
  匹配用 `speciesKey`，服务端取全表(仅 ~11 行)在 JS 里比；表变大再加归一化列优化。
- **`src/routes/drafts.$id.tsx`**：onApprove 收到 conflict → 弹窗（该物种已有条目 X + whatsNew + 「查看已有条目/取消/确认合并」）；
  「确认合并」→ 再调 approve 带 mergeTargetId。
- **已真机验证（用户自测 + 我修正）**：两个 Anthurium 草稿走通了 create→conflict→merge。条目
  `anthurium-crystallinum-linden-andre`（晶状花烛，id `764a439f…`）source=ai_identify ✓、合并卡片「注」点击跳页尾高亮 ✓。
- **修正的两个体验问题**：① 「注」去掉编号（原 `注N` 会出现"注2 没注1"的困惑，且用户原始 spec 只要"注"符号）；
  ② 合并卡片图片限宽（`max-width/height:420px`、卡片 `max-width:680px` 居中），原来大图撑满整页。均已在代码修好（未来合并自动生效）。
  那条已存在的测试条目是老代码生成的旧 HTML → 我用 `uploadAssetFn`(service-role)+`savePlantFn` 就地重写了它的存储 HTML 修正。
  ⚠️ 教训：合并卡片追加在模板内容列**之外**（body 级），所以要自己限宽，否则被撑满。
**P2 真机验证发现并修复的 3 个问题（2026-07-05）：**
- **合并卡片图撑满整页**：卡片是 `<body>` 直接子元素、在模板内容列之外，`max-width:100%` 就是整个 iframe 宽。
  修：① 合并 fn 里卡片限宽 `max-width:680px`、figure 420px、img `max-height`；② 更关键——**详情页注入的 iframe CSS**
  加 `.merged-observation{max-width:680px;margin:auto}` + `.merged-observation img{max-height:360px!important;width:auto!important}`，
  这样**存量大图也在渲染时被压住**（改存储 HTML 会被 plant-html 桶 RLS 挡，只有 service-role 能写）。已验证渲染 270×360。
- **双击「确认合并」→ 注1 卡片被冲掉**：读-改-写竞态（两次合并都读到没注1的旧 HTML，后者覆盖前者）。
  修：合并前**原子认领**草稿（条件更新 `.neq('status','approved').select()`，认领不到直接返回）+ 卡片带 `data-draft-id` 幂等兜底。
- **经纬度显示超长小数**：`Number(lat).toFixed(5)`（仅对未来合并生效；存量卡片 HTML 里的长小数改不动=无关紧要）。
- **测试数据就地修正**：用预览里的 admin 会话（arainjazz，admin，是条目作者）删掉了那条多余的 marker_n=1 空记录；
  图片靠上面的注入 CSS 已修好。注：浏览器 anon+用户 token **写不了 plant-html 存储桶**（RLS），所以存量卡片的长坐标没改。
- **⚠️ 反复被 SW+Vite 缓存坑**：验证跳转时多次跑到旧模块，必须「stop 预览 + rm -rf node_modules/.vite + 重启 + 注销 SW」才稳。
  用户本地测也要硬刷/清 SW。见 [[pwa-service-worker-caching]]。
## 🆕 2026-07-05 (续) — P3 skill 条目改造 + 查重 (P3a/P3b DONE+真机验证; P3d-1 逻辑验证但抓取 flaky; 待架构定夺)
- **P3a 按钮改名**（admin.index.tsx）：`+批量添加条目→+批量添加 skill 条目`、`+新建条目→+添加 skill 条目`、空态同改。**真机 ✓**。
- **P3b 去掉站内编辑**（plant-editor.tsx）：默认 content_type='html'、移除「正文类型」单选与富文本分支，legend 改「上传 HTML 正文」。
  旧 rich 条目仍能渲染（库里其实没有 rich 条目）。**真机 ✓**（0 radio、无"站内编辑"）。
- **P3d-1 查重服务端 fn** `checkSkillDuplicateFn`（identify-plant.functions.ts）：speciesKey 前两词匹配候选 → 拉各自正文
  可见文本（`visibleBodyText` 去 script/style/标签/实体/merged-observation）做字符 3-gram Jaccard → band ≥0.6 high / <0.6 low。
  **逻辑真机验证**：自身对比=1.0/high ✓、排除自身=null ✓、无同属=null ✓、Robinia-vs-Equisetum=0.229/low ✓。
  **⚠️ 但服务端 fetch 存储 HTML 在本地(GFW 后)flaky**：3 次跑出 [0.229, 0, null]——抓取偶发失败/空。
- **架构决策：用户选了 (B) body_text 列**。用户已跑 `ALTER TABLE plants ADD COLUMN IF NOT EXISTS body_text text;`。
  types.ts 手加 body_text（Row/Insert/Update）。DONE + tsc。
- **P3d body_text 架构落地（DONE + 真机验证）**：
  - 相似度助手 `visibleBodyText/textShingles/jaccardSimilarity/bodyTextSimilarity` 移到 `plants.ts`（客户端也用）。
  - `checkSkillDuplicateFn` 重写：读候选 DB `body_text` + 客户端传入 `newBodyText`，**零 HTTP 抓取**。返回 match（含 html_url/co_author_names 供合并）+ similarity + band。
  - 写路径 populate：`savePlantFn`（payload.body_text 仅在提供时写，纯编辑不清空）+ `approvePlantDraft`（新建时从 draft.html_content 算）。
  - **backfill**：浏览器抓 13 条 HTML→visibleBodyText→写库，全成功（7k–12k 字符，浏览器抓 HTML 无 CORS，稳）。
  - **验证稳定**：自身=1.0/high×3、跨属 Robinia-vs-Equisetum=0.229/low×3（**不再 flaky**）、排除自身=null。
- **P3d-2 UI（DONE + tsc + 页面加载 OK）**：plant-editor 查重弹窗升级为分档单命中：high(≥60%)→自动合并/去已有页编辑；
  low(<60%)→和已有版本平行存在/自动合并/去已有页编辑。上传 HTML 后 finalizeHtmlUpload 捕获 bodyText→runSkillDupCheck。
  performBranch=平行、performMerge=自动合并、performGoEdit=navigate 到 /admin/edit/$id。**站内查重 checkDuplicateScientific 已删**。
  ⚠️ 弹窗本身未做真实文件上传的端到端触发（需用户上传同种 HTML 才弹）；依赖项全绿。
- **P3c**：skill 页尾「上传 {编辑}·{时间}」P1 已做；改动「注」靠现有块编辑+P1 跳转框架。
## 🆕 2026-07-05 (续) — 地图模块 4 色分布点 + 比例饼环 (DONE + AMap 实时验证)
⚠️ 更正：`/explore` 用的是 **AMap（高德）** 不是 Leaflet。自定义距离聚合（CLUSTER_PX=15），非 AMap 原生。
- **4 类分类**（explore.tsx `categoryOf`）：按优先级取单色 入侵红`#dc2626` > 保护棕`#b45309` > 采纳绿`#2e9e5b` > 未采纳蓝`#2563eb`。
  采纳 = `status==='approved'`；入侵/保护由 conservation matcher（学名）判定，与采纳无关。
- **单点**=4 色实心圈（入侵带"!"、保护带"🛡"字形）；旧的三角/盾/绿点常量已删。
- **聚合**=`clusterPieHtml`：按成员 4 类比例的 `conic-gradient` 饼环 + 中心白底计数。
- **图例**（bottom-right）+ **fan-out 卡片右上角类型角标**（CAT_COLOR/CAT_LABEL）+ 单点 popup 加"已采纳/待采纳"徽章。
- **真机验证（AMap 这次加载成功）**：94 观测 = 73 未采纳/15 采纳/4 入侵/2 保护；DOM 实测 2 个饼环
  conic-gradient 比例精确（88点大聚合 红16.4°/棕4.1°/绿49°/蓝290°；4点小聚合 棕90°/绿180°/蓝90°）+ 2 单点绿/蓝圈。tsc EXIT=0。
  注：AMap key 偶发不在 localhost 加载（域名白名单），第一次失败第二次成功——纯逻辑已另用真实数据验证过。

**六模块进度：** ①两类条目 ✅ ②地图 ✅ ③采纳去重合并 ✅ ④skill 查重 ✅ ⑤省 token 草稿 ✅ ⑥注/页尾框架 ✅
**剩：隐私打磨**（未采纳点 GPS 脱敏）。

## 🆕 2026-07-06 — 模块⑤省 token 草稿 + 地理定位/地图UI修复 (DONE code, tsc EXIT=0, DEPLOYED Version `ca3570fb`)
**模块⑤省 token 草稿：** 当廉价识别（Pl@ntNet/quickIdentify）拿到学名后，查询同种已有草稿的 ai_payload（通用正文），
若命中则只生成 field_notes_zh/en（拍摄记录，本张照片特有），合并后返回完整 meta。省下 19 个通用字段的生成 token。
- **`findExistingSpeciesDraft(speciesName)`**（identify-plant.functions.ts 新增）：用 `speciesKey()` 归一化学名
  （genus+species 小写），查最近 50 条有 ai_payload 的草稿，匹配同种返回其 ai_payload。全程 try/catch，失败返回 null。
- **`generateFieldNotesOnly(photoDataUrl, hintPlace, speciesName, existingTitle)`**（新增）：小型 Gemini 调用
  （仅生成 120–220 字中文 + 45–85 词英文拍摄记录），返回 `{field_notes_zh, field_notes_en, usage}` 或 null。
- **`callAiIdentify` 新增 token-saving 分支**（line ~430）：在 Stage 0/1（Pl@ntNet/quickIdentify）后，若拿到
  `earlySpeciesName` → 查旧草稿 → 若命中且 field_notes 生成成功 → 合并返回，model 标记为 `reuse+field_notes`，
  provider 标记 `${stageModel}+reuse`。任何失败都回退到现有完整生成（零破坏性）。

**Bug 修复 × 7：**
1. **GRIIS 不再出现在保护与名录收录卡片中**（conservation.ts `conservationBadges`）：GRIIS（全球入侵）是单独的红色警示卡片，
   不应与国家重点保护/CITES/GTS 混在绿色「保护与名录收录」卡片里。现在 `conservationBadges` 只返回 protected/cites/gts，
   GRIIS 被明确排除（注释说明）。
2. **改用浏览器实时地理定位**（camera-identify.tsx `ingestImage`）：不再读取照片 EXIF GPS（照片可能几周前拍的、地点已变），
   改为拍照/选图时**立即调用 `navigator.geolocation.getCurrentPosition()`** 获取用户**当前**位置（需用户授权）。配置
   `enableHighAccuracy: true` 提高精度，10s 超时。新增 `geoRequested` 状态跟踪定位请求，`onSubmit` 时等待最多 3 秒让
   定位完成（避免异步竞态）。拒绝/失败时提示「未授权位置权限，识别将继续（无位置信息）」→ coords=null 非致命。
3. **annotation 下拉显示「拍摄记录」项**（plant-html-template.ts）：原模板中拍摄记录区域只有 `<p class="capture-meta">`
   （是 p 标签不是标题），导致 `querySelectorAll("h1, h2, h3")` 无法提取。**修复**：在 hero section 右栏开头添加
   `<h2>拍摄记录 · Field Capture</h2>` 真实标题（18px，letter-spacing 0.1em），删除原 p.capture-meta。现在草稿页和
   详情页的 annotation 下拉都会显示「拍摄记录」选项，小P蛙可以针对拍摄记录单独提问/编辑。
4. **地理定位异步竞态**（camera-identify.tsx）：之前 `getCurrentPosition` 是异步非阻塞，用户快速点提交时定位可能还没完成
   → coords 为 null。**修复**：① `ingestImage` 调用定位时设 `geoRequested=true`，完成/失败时设为 false；② `onSubmit`
   检查 `geoRequested`，若为 true 则等待最多 3s（300ms 轮询）；③ toast 明确提示「等待位置信息...」→「✓ 已获取当前位置」。
5. **地理定位调试日志**（identify-plant.functions.ts `submitPlantDraft`）：添加 console.log 输出收到的 lat/lng 和
   reverse-geocode 结果，帮助诊断手机端"未知地点"问题。若 coords 为 null 输出 warn。
6. **地图图例位置调整**（explore.tsx）：从右下角移至侧边栏"只显示重点保护植物"按钮下方，避免遮挡地图底部区域。背景改为
   `bg-paper` + 边框圆角，与侧边栏风格统一。
7. **地图侧边栏改为最近地区+最新物种**（explore.tsx）：① "按地区浏览"改为"最近上传识别地区（6个）"，`areaGroups` 按每个
   地区最新识别时间倒序排列（不再按物种数量），只显示前 6 个；② 物种列表标题改为"最新识别物种（6个）"，从 `slice(0, 12)`
   改为 `slice(0, 6)`，只显示最新 6 个识别记录；③ `GeoSighting` 类型新增 `created_at: string` 字段，查询时包含该列。

**验证**：tsc EXIT=0、`npm run build` 通过、**已部署 LIVE** Version `ca3570fb-52a3-40ed-8152-6ee86c23ad93`。
**真机测试**（用户完成）：
① 手机端 /identify 拍照 → 允许位置授权 → toast 显示「✓ 已获取当前位置」→ 草稿 capture_place 显示当前地址（不再是"未知地点"）
   → 后台日志显示 `[SubmitPlantDraft] Received coords: lat=...` 和 `Reverse-geocoded to: ...`；
② /explore 地图页 → 图例在侧边栏"只显示重点保护植物"按钮下方（不在右下角）；
③ 侧边栏显示"最近上传识别地区（6个）"（按时间排序）和"最新识别物种（6个）"（不再是12个）；
④ 拍两张同种植物（如银杏）→ 第二张 console 出现 `[TokenSave] Found existing draft` + token 数显著降低；
⑤ 拍入侵物种 → 草稿红色入侵卡 + 绿色保护卡（若命中）**不含** GRIIS 徽章；
⑥ 草稿页/详情页小P蛙 annotation 下拉显示「拍摄记录 · Field Capture」选项。

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

## 🆕 2026-07-04 (cont.) — 入侵/重点保护卡片重做 + 国家名单 + 筛选计数 (DONE, tsc+build OK, 已真机截图验证; NOT deployed)
三块，均已提交：
1. `dd9db80` **入侵卡片加国家名单**：新增静态数据 `src/lib/china-invasive-list.ts`（环保部《中国外来入侵物种名单》
   四批共 40 种 + 是否《重点管理外来入侵物种名录》农业农村部567号2022）。identify 管线 lookupChinaInvasive → 命中即
   判为入侵 + 卡片渲染「📋 国家名录：第X批（日期·发布单位）已/未纳入重点管理名录」（确定性、非 LLM）。截图验证 ✓。
2. `cb554c3` **重点保护卡片重做**：原来只有 chips → 现在命中国家/省级重点保护名录时渲染**绿色渐变盾牌大卡**（对标橙色
   入侵卡）：判定依据·收录名录(确定性)＋珍稀濒危·面临挑战＋生态价值＋保护建议(LLM 生成 `generateConservationCard`)＋
   保护级别 head badge＋来源引用。CITES/GTS 仍作 chips 放卡内。截图验证 ✓（四合木示例）。
3. `3a7224d` **/plants 筛选计数**：GRIIS 下拉只列**数据中真实存在的等级**（中国数据只有 Established/Invasive 两级，
   自动去掉 Casual/Widespread 两级）＋每级追加（n）已收录数；国家和各省重点保护目录下拉每项也追加（n）。已验证
   逻辑（present statuses = invasive/established）+ 截图（国家2021(1)/内蒙古2009(3)）✓。
- **USER 需部署**：`npm run build && wrangler deploy`(VPN)。注意：**已存在的旧草稿不会自动套用新卡片**（需重新识别生成）；
  新识别的草稿才有新卡片。筛选计数部署后立即生效。
- 说明：入侵卡片的 status/harm/control 仍 LLM 生成；批次/管理名录/判定依据 为确定性注入（不会幻觉）。

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
