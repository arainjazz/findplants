# Plantspedia — Working State  (single source of truth)

_Last updated: 2026-07-26 — by Claude（本轮草稿页五修：① 换了配图仍显示「暂无该物种的…公开
照片」→ 新增 stripStaleMissingNotes，三条换图路径 + 视图 + 保存 + 收录发布全清；② 银叶草稿的
简介卡不再顶「疑似」、不再压补拍框（showTentativeOnCard）；③ 正文下新增编辑专属绿框
「草稿内容符合我的观察」=采纳+收录；④ 小P蛙讨论范围新增「快速识别简介卡」并能真改那几个字段；
⑤ 编辑可手改简介卡（DraftCardEditor）。tsc/build/lint=0。
**✅ 已连同积压的另两轮一起上线：Version `0ae81b77`，18:41 CST；检查点提交 `fd4fae8`；
两份待办迁移也已由用户在控制台跑完。** 编辑态 UI 仍需真人登录复看。详见文首「部署真相」
与文件最下方本轮小节。）_
_上一轮：2026-07-25（续二）— by Claude（本轮又三修：人文图槽加 plant/插画兜底（不加生境）；
草稿三档判据改用 ai_payload._enriched（快速不再被错标银叶）；分享卡 og:* 改成「植物照片+
Plantspedia草木志·名称+该植物简介」（plants.$slug 显式写全 og:*、drafts.$id 新增 loader/head）。
上一轮：植物人文→Section I、配图框对齐拍摄记录、align:start 消空挡、PDF 插入按钮放大+放开 PPT。
全部 tsc/build=0、已实测，**未部署**。详见文件最下方两节。）_
_Read this FIRST and update it LAST, every session._

## 🚨 部署真相（以 Cloudflare 为准，不以本文件的小节标签为准）

**线上版本 = `0ae81b77-11ce-455c-bfc7-2dd59d1cd82e`，2026-07-26 18:41 CST 部署。**
本次把积压的三轮全部推上线，**至此工作树与线上一致，没有未部署的改动**。
（上一版是 `adf3316b` 07-25 15:11；07-25 还有一次 `b9755785` 12:15，那两次都没记进本文件 ——
本节就是为了以后不再出现这种「STATE 说没部署、其实早上线了」的错账。）

⚠️ **部署踩坑（每次都会遇到，别当成故障）**：第一次 `wrangler deploy` 必定可能报
`fetch failed / A fetch request failed`（本机双重代理，见 memory「Session ECONNRESET root cause」）。
**代码和鉴权都没问题，直接原样重跑一次即可** —— 本次就是第二次成功的（上传阶段自己也
retry 了 3 次）。

**判据规则 —— 别再照抄小节标题里的「NOT deployed」：**
`wrangler deploy` 打包的是**整个工作树**（含未提交改动），所以某一轮是否上线**只看时间**：
凡是文件改动时间**早于最后一次部署**的，无论当时小节里写了什么，都**已经在线上**。
这就是为什么 07-20～07-25 那一长串标着「NOT deployed」的小节其实全都生效了。

**查「现在到底什么没上线」的标准动作**（两条命令，别靠读小节）：
```
./node_modules/.bin/wrangler deployments list | tail -30      # 取最后一次部署时间
find src supabase *.ts *.jsonc -newermt "<那个时间>" -type f   # 晚于它的就是未上线的
```

**2026-07-26 18:41 随 `0ae81b77` 上线的三轮**（此前一直积压）：
① 卡签配色分名录 + 项目页（conservation.ts / registry-chips.tsx / share-card.ts / projects.$id.tsx）
② 识别假失败自愈 + 闲聊消毒（tentative.ts / model-chatter.ts / explain-error.ts / camera-identify.tsx）
③ 草稿页五修（draft-enhance.ts / html-doc-editor.tsx / draft-card-fields.ts /
   identify-plant.functions.ts / drafts.$id.tsx）—— 详见文末小节。

**上线核验（不需要登录就能做的部分，已做）**：`plantspedia.club` 200、`/drafts/<id>` SSR 200；
直接拉线上 chunk 验证新代码确实在里面 ——
`/assets/drafts._id-B4MBr15z.js` 含「草稿内容符合我的观察」「快速识别简介卡」「已采纳并收录为条目」，
`/assets/html-doc-editor-DSoW4PYl.js` 含 `img-missing`（空槽清理逻辑）。
⛔ **仍需真人复看**：②的断线自愈（要真手机断网）、③的编辑态四处（要编辑账号登录）。

**✅ 两份迁移已于 2026-07-26 由用户在 Supabase 控制台执行**（均 Success, no rows returned）：
- `20260720120000_species_dossiers.sql` —— 表建好了。**注意这一刻起线上行为就变了**：
  线上代码早就在调 `loadDossier` 读 / `upsertDossier` 写，之前因表不存在一直静默失败；
  现在物种级复用真正生效（同物种第二次识别照搬通用正文、只重写拍摄记录，2 秒出卡）。
- `20260721120000_projects_fix_has_role.sql` —— projects 四条 RLS 策略已改用 `private.has_role`，
  「添加新项目内容报错 permission denied for function has_role」应已消失（待用户复看）。
两份都可重复执行（if not exists / drop policy if exists），已生效、与部署无关。

**git**：✅ 2026-07-26 已建检查点 `fd4fae8`（07-18 之后 8 天的积压：39 改 + 35 新，含 3 份迁移）。
**未纳入该提交**（归属待定，仍是未跟踪状态）：`mcp/`、`.workbuddy/`、`.claude/MCP-PLAN.md`、
`package-lock.json`（本仓用 bun.lock，多一份 npm 锁文件容易打架）。
**未 push**：`main` 现在领先 `origin/main` 15 个提交（用户历来只在本地提交，不推 GitHub）。

## 🆕 2026-07-21（续16）两个线上报错的定位与修复
- **① 「添加新项目内容报错：permission denied for function has_role」——已修（待控制台执行）。**
  根因：`20260704120000_projects.sql` 的四条 RLS 策略调用 `public.has_role`，而
  `authenticated` 早在 `20260513124950`（第 98 行）就被 REVOKE 掉了对 `public.has_role`
  的 EXECUTE —— 整套改造把角色判断迁到了 `private.has_role`（`20260513133147` 授权给
  authenticated/anon）。作者用对了 `private.is_approved_editor`，却把 has_role 误写成 public。
  - 修复：新增 [20260721120000_projects_fix_has_role.sql](supabase/migrations/20260721120000_projects_fix_has_role.sql)
    把四条策略全部重建为 `private.has_role`；并同步修正了原始 projects 迁移文件。
  - **⏳ 待办：去 Supabase 控制台 SQL Editor 执行那份新迁移**（托管库、本地无 CLI）。
    纯策略重建，无 schema 变更、不用改 types.ts。
- **②✅ 真因已定死（07-21 wrangler tail 实测）＝Cloudflare 单次调用「子请求(对外 fetch)数」超限。**
  日志铁证:`[job-queue] 已入队` + 消费者接住 → **队列完全正常**(之前所有关于「没部署/26s
  waitUntil/换模型」的判断全部作废)。任务在消费者里跑了约 78s,联网调研→Kimi 生成正文→抓 12 张
  缩略图(PhotoOrgans)→PhotoSlots→QualityGate **全过**,最后 `DRAFT_UPDATE_FAILED … 原因：
  Too many subrequests by single Worker invocation` —— **正文生成好了,写回库那步的 fetch 被平台拒**。
  更坑:连 failJob 写「失败状态」也要 fetch、同样被拒(`[jobs] patch skipped … not found`)→
  失败状态没记下 → 前端退回「连续两分钟没心跳」兜底文案。**所以「没心跳」是假象,真错误是子请求超限。**
  - **免费版上限 50 子请求/次调用;付费版 1000。** 本次估算逼近 50 才崩 → 基本确定**免费版**。
  - 子请求大户(累积撑爆 50):心跳(每 15s readJob+upsert=2)≈10、阶段更新(每次 read+write)≈10、
    联网调研 429 轮换≈4、配图 fetchSpeciesPhotos+classifyPhotoOrgans 抓 12 缩略图≈16、dossier≈2、
    写库+日志+扣叶≈5。**心跳/阶段机制本身就吃掉约 40% 预算。**
  - **✅ 用户选「免费改代码压到 50 以下」。已做 4 项(tsc=0，未部署)：**
    ① **[background-jobs.ts](src/lib/background-jobs.ts) 新增 `bindJobUpdates(job)`**：把心跳/阶段/
       收尾全绑定到内存副本、每次只 **blind upsert 不先 read** —— 每次更新从 2 子请求降到 1，
       整趟省约 10。删掉旧的 patchJob/setJobPhase/finishJob/failJob/touchJob/startJobHeartbeat
       （原来只有 runQueuedJob 用）。[identify-plant.functions.ts](src/lib/identify-plant.functions.ts)
       的 runQueuedJob 改用 `bindJobUpdates`。
    ② enrich 配图候选 **12→8**（classifyPhotoOrgans 少抓 4 张缩略图，且更易全数成功让分类生效）。
    ③ **upsertDossier 挪到写库之后**（写库先拿配额；dossier fire-and-forget 失败无害）。
    ④ 修正 [poll-job.ts](src/lib/poll-job.ts) 误导文案：删掉「换更快的模型」，改说触及平台单次
       请求上限、与模型快慢无关。**blind-write 后 failJob 能写进真实错误了**，「没心跳」会少见。
  - **预算估算**：故障那趟 ~50 → 现约 36–42/50，缓冲 ~8–14，**典型情况够用但非零脆弱**。
    若部署后仍撞顶：下一步走「先存正文再best-effort补配图」的分段改造，或升级 Workers 付费版。
  - **✅ 07-21 真正的解法：用户开通 Workers Paid（$5/mo），子请求上限 50→1000。**
    （中间买错过一次：Page Rules $5/mo 与 Workers 无关，已提示退订。）
    上限是**运行时按账号套餐判定**，不需改代码。→ **原计划的「分段改造」不必做了**，上面那 4 项
    优化作为纯收益保留（更快更省）。⏳ 待用户复测生成草稿 + 金叶创建。

- **④ 复核之谜已定案（用户问：疑似时不是该先自动复核吗？为何用量表第一次只有 plantnet+gemini-quick）**
  - **闸门没有 bug**（一度怀疑判据不一致，查证后推翻）：`isTentative` 认「confidence=low」和
    「summary_zh 以疑似开头」两种，而闸门只认前者 —— 但 `normalizeIdentification` 在闸门**之前**
    就把后者回填成 `confidence="low"`，所以两种疑似都会触发复核。
  - **真凶**：`secondOpinionIdentify` 在 **HTTP 非 200（含 429 限流）/ 空响应 / 30s 超时** 时
    **静默返回 null**，只写一行 console.warn。日志实证当时 Gemini 正 429 RESOURCE_EXHAUSTED。
    → 复核「跑了但没跑成」→ 无 `+review-*` 后缀 → 用户被直接推去补拍；等补拍时（1 分多钟后）
    配额窗口重置 → 复核成功 → 才出现 `+review-adopted`。
  - **✅ 已修（透明化）**：新增 `_identify_trace` 全链路痕迹，**每次识别都记**，含复核没跑时的原因。

- **⑤ ② 简介卡「识别过程 · 综合可信度%」——已实现（tsc=0，未部署未实测）**
  - [identify-plant.functions.ts](src/lib/identify-plant.functions.ts)：`IdentifyTrace` 类型 +
    `computeIdentifyConfidence()` + `identifyTraceHtml()`，渲染进 `buildSummaryCardHtml`。
  - **可信度%刻意不让模型自评**（三档映射百分比是假精度）：只用 ① Pl@ntNet 的 score（链路上
    唯一非自评的客观数字）② 最终置信档（high90/medium70/low45）。同种取均值、复核确认 +5；
    异种只认档位 −5；无 PlantNet 分则只认档位。**卡上同时写出依据**，不做黑盒数字。
  - 位置正确：只进 `html_content`（草稿页简介卡）；`share-card.ts` 不读 html_content → 分享卡不受影响。
- **⑥ ③ 三按钮机制 —— 已实现（tsc=0，线上流程未实测）**
  - 用户拍板的两个口径：**份数为主 + 用户数括注**（「已有 5 份 · 3 位用户」）；
    **只算已生成正文的银叶草稿**。
  - **关键判据 = `ai_payload._enriched === true`**（不是 html_content！快速识别也会把简介卡写进
    html_content，`_enriched` 快速草稿显式为 false —— draft-card.tsx 的 tier 判据其实不准，
    但那是既有问题，本次没动）。
  - 新增 [species-existing.functions.ts](src/lib/species-existing.functions.ts)：服务端
    （service role，跨用户统计不受 RLS 限制）按属名前缀粗筛 + `speciesKey` 精确比对，
    返回 {草稿份数, 不重复用户数, 最新草稿id, 金叶详页}。查失败静默返回空，绝不挡生成流程。
  - [drafts.$id.tsx](src/routes/drafts.$id.tsx)：`closeCard` 的**非疑似**分支触发
    （条件 `cardAutoOpened && !draftTentative && notEnriched`，与补拍关卡同一套「只认自动弹出
    的那张卡」判据），弹三按钮面板。第三个按钮始终保留 —— 推荐归推荐，不剥夺「我就是要自己生成」；
    未登录时该按钮改为走 onLoginToEarn。
- **⏳ 待用户线上实测**：①生成进一步介绍草稿（Workers Paid 后）②金叶创建 ③识别过程卡片
  ④三按钮面板。
- **⑦ 07-21 晚线上实测暴露一批 bug —— 已修 4 类（tsc=0，待部署）**
  - **根因（一因四果）**：`quickIdentifyDraft` 的 `else` 兜底分支会**自动跑完整流水线**
    `buildDraftContent` 并标 `enriched=true`。用户用自建模型（qwen3.5-omni-flash）时
    `identifyQuick`（Gemini 专用）返回 null，补救链路 `callAiIdentify(...,"card")` 也失败
    → 掉进 else，一次性造成：①没点「生成进一步介绍草稿」草稿却已整篇生成 ②简介卡上没有
    识别过程/可信度（该分支不走 buildSummaryCardHtml）③配图是重复的用户原图（走 section
    photos 抓不到）。**注意：代码注释显示这个 bug 之前修过一次，补救链路本身也会失败。**
  - **✅ 改法**：else 分支**永不再自动跑完整流水线**，改用 Pl@ntNet 判定兜底出**摘要卡**
    （`enriched=false`，生成正文永远由用户按按钮决定）；连 Pl@ntNet 也没有 → 如实抛
    `IDENTIFY_FAILED`，而不是造一张空卡。
  - **✅ 「待鉴定植物」双保险**：① else 分支用 Pl@ntNet 学名命名；② 快路径下模型 title 与
    scientific_name 双空时，用 Pl@ntNet 学名回填并强制 low（→ 显示「疑似 X」）。
  - **✅ iframe 无限增长空白（金叶按钮几乎点不到）**：[draft-enhance.ts](src/lib/draft-enhance.ts)
    原来量 `documentElement.scrollHeight` —— 该值**不小于视口高**，而视口高就是父层按上次上报
    设的 iframe 高，叠加 body margin 后每轮自我放大，ResizeObserver 持续触发 → 无限变高。
    改为只量 body 内容盒 + 外边距（与视口无关、收敛），并加「变化 >1px 才上报」阈值。
    ※ 用户报的「完整草稿已生成却不知道去哪看」很可能是同一个 bug 的表象（正文被空白顶没了）。
  - **✅ 金叶完成改弹窗**：原来只有 12 秒会消失的 toast + 角落「查看」，等几分钟回来正好错过。
    改成必须显式关闭的弹窗，「立即查看」整页跳 `/plants/$slug`（落在页面开头）/「稍后查看」。
- **⑧ 07-21 第二轮实测：三个问题全部定位并修复（Version 55d22d69 已上线）**
  - **⒜ 可信度一直不显示 —— 我上一轮放错了地方。** 草稿页对快速草稿走
    `notEnriched ? null : <iframe>`（drafts.$id.tsx），**`html_content` 根本不上屏**，
    所以写进 `buildSummaryCardHtml` 的痕迹永远看不到。真正的简介摘要卡是 React 组件。
    → 算法抽成纯模块 [identify-trace.ts](src/lib/identify-trace.ts)（服务端 + 客户端共用，
    避免两边各算一个数），在 React 卡片里渲染；老草稿无痕迹字段时用最小痕迹兜底，
    保证**无论疑似非疑似都有百分比**。
  - **⒝ 空白无限增长 + 页面自己滑动 —— 根因是 `plant-html-template.ts:110` 的
    `body{min-height:100vh}`。** iframe 内 100vh = 父层刚按上报值设的高 → body 至少这么高
    → 加 margin 报回去 → 每轮 **+16px**（正是 body 默认上下 margin），ResizeObserver 持续
    触发。**上一轮我只改了测量方式，没拆掉这个根源，所以没修好。**
    → 在 iframe 注入 CSS 中和：`html,body{height:auto!important;min-height:0!important}`
    + `body{margin:0!important}`（只影响 iframe 预览，不影响已发布详页）。
    **✅ 已用复现实验证明**：未修版 416→432→448→464→480 持续增长；修复版一次收敛到 400。
  - **⒞ 「草稿内容和我的观察不符」按钮缺失 —— 代码自相矛盾。** 按钮条件含
    `!submittedForReview`，而 `runEnrichCore` 写库时就置 `submitted_for_review: true`
    （identify-plant.functions.ts:4688）→ 生成完成的同一刻按钮被自己藏掉，**正常流程下永远
    看不到**。→ 去掉该条件（已进审核队列反而更该让用户纠正错误定种）。
- **⑨ 07-21 第三轮：进度面板 + 照片查重（tsc=0，已 build，🚧 deploy 连续 2 次 fetch failed 未上线）**
  - 新增 [job-progress.tsx](src/components/job-progress.tsx)：常驻进度面板（阶段文案 + 进度条 +
    **已用时秒表**）。银叶/金叶两条链路共用。`awaitJob` 本来就在回调 (phase, progress)，
    以前只喂给 toast —— toast 会自动消失又挤在角落，几分钟长任务里用户不知道它还在不在跑。
    面板**刻意放在可信度卡之后**，不放各自按钮旁边：按钮所在分支会随 notEnriched/余额/编辑态
    消失，进度跟着藏起来就白做了。
  - 银叶成功文案改为「完整草稿已生成，自动进入待审序列」（runEnrichCore 确实置了
    submitted_for_review=true，之前不说用户不知道还要不要再点提交）。
  - **照片查重**：`findDraftByPhotoHash`（species-existing.functions.ts）+ camera-identify 弹
    「是，去看已有的简介摘要卡 / 否，再识别一次」。指纹 = **原始文件字节** SHA-256（压缩前算，
    压缩是有损再编码不保证跨次一致）。**存在 `ai_payload._photo_sha256`，刻意不加列 ——
    hosted Supabase 加列要人工去 dashboard 跑迁移。** 补拍路径跳过查重（本来就是同一株）。
  - 草稿页新增**常驻**「站内已有该物种的内容」区（银叶草稿/金叶详页跳转），与关分享卡时弹的
    面板同源，区别是不打断操作 —— 满足「跳过去后简介卡下面能看到并跳转」。
- **⑩ 批量识别：用户反提议做 MCP，让外部 agent 接管。已答的三项口径**：疑似照收但单独标出、
  完整链路且保留复核、仅管理员/编辑且不消耗叶片。**关键矛盾待定**：MCP 若只是触发站内现有
  管线，限流照旧（同一个 Gemini key，且只有 1 个）；若让外部 agent 自带视觉模型，则绕开限流
  但失去 PlantNet 客观分与二次复核 —— 与「完整链路」的选择冲突。下轮需就此拍板。
- **⑪ 07-22 第四轮：可信度算法 + 编辑器图片 + Key 体检（Version ae49e876 已上线，Consumer 也注册成功）**
  - **可信度算法修了一个真实缺陷**（用户实测 `Begonia chitoensis 7%` 却被当分歧扣 5 分）：
    新增 `PN_MEANINGFUL_PCT=30` 阈值 —— 低于它视为「Pl@ntNet 自己都没把握」，**不计入**
    （既不算印证也不算反证）；达到阈值的分歧，**惩罚随其置信度线性放大**（刚过阈值几乎不扣，
    近 100% 扣满 30）。旧版一律扣 5，把「7% 的瞎猜」和「95% 的强烈反证」等同对待。
    UI 同步写明「一线模型只给档位、不给百分比」——避免用户以为漏显示了分数。
  - **澄清「两个引擎」的说法**：代码里**没有**两个引擎。**引擎只有 Pl@ntNet 一个**（唯一给
    客观分数的）；其余都是**视觉模型**（一线识别 / 二次复核），排成降级序列。控制台里
    「两个…视觉自检通过」指的是**两个候选模型**都能看图，不是两个引擎。
  - **编辑器图片固定比例**（上一轮只修了预览态）：编辑器 iframe 用原始 `docText`，没有预览态
    注入的 VIEWER_STYLE，所以图上的硬编码 height 没人压得住。→ 在已有的
    `lov-editor-runtime-style` 里加 `img{height:auto!important;max-width:100%!important}`，
    并在 `onSave` 的 docClone 上**用 querySelector 剔除**（getElementById 在克隆文档上不保证
    可靠；漏删一次这段 CSS 就被永久写进正文）。**已实测验证**：注入后硬编码 height=120 被压成
    auto；clone→剔除→序列化结果不含任何编辑器 CSS。
    另外 `replaceActiveSrc` 换图时一并摘掉 `.img-slot` 的 `broken`/`no-organ` 类
    （`.img-slot.broken` 带 aspect-ratio:4/3，不摘则新图被困在 4:3 里）。
  - **每个 Key 的独立体检**：新增 [key-health.functions.ts](src/lib/key-health.functions.ts)。
    Pl@ntNet 面板（identify.tsx）加「检测连通性与剩余额度」，走 `GET /v2/status`（**不消耗
    识别配额**），并回显本站自己记的耗尽标记 —— 以前 500 次/天完全是黑盒，只有撞 429 才知道。
    模型控制台每项加「连通体检」，走 `GET /models`（不产生 token 费用），与「视觉自检」
    分工明确：前者测 key 通不通/是否限流，后者测模型能不能看图。
    **刻意不显示 LLM 余额数字**：各厂商没有统一的余额接口，宁可如实说「无法显示」也不编造。
- **⑫ 07-22 第五轮（Version aaa3348a 已上线）**
  - **Gemini「连通体检」按钮是灰的** —— 根因：`ModelSlot.baseUrl` 对 **gemini/anthropic 用官方
    地址时就是 `""`**（model-queue.ts:33 明写），而我把 baseUrl 也列为必填 → 一律禁用。
    → 按钮只要求 apiKey；体检函数按 provider 分派端点：gemini 走
    `generativelanguage.googleapis.com/v1beta/models?key=`（**query 带 key，非 Bearer**），
    anthropic 走 `x-api-key` + `anthropic-version` 头，其余走 OpenAI 兼容 `GET /models`。
    响应数组字段 `data`（OpenAI/Anthropic）与 `models`（Gemini）都认。
  - **「自检两个引擎」→「自检三条链路」**：以前只报 Pl@ntNet / 复核模型两个孤立的点，
    **出卡模型那一环根本没测**，两个 ✅ 也答不出「拍一张照到底能不能出卡」。
    现在测三条端到端链路：①PlantNet 可信→出卡AI ②PlantNet 存疑→一线识别顶替→出卡AI
    ③一线仍疑似→二次复核。出卡AI（consoleId="card"）**逐项测序列每一条**（只测第一项
    等于没测出冗余还在不在）。
  - **MCP 规划已写入 [.claude/MCP-PLAN.md](.claude/MCP-PLAN.md)**（设计稿，未实现）。核心思路：
    **agent 只能提交「证据」不能提交「结论」** —— 只收 `plantnet.score` + `model_verdict.confidence`
    三档，**不收 agent 自报的百分比、不收 agent 写的 HTML**；可信度由服务端调同一个
    `computeIdentifyConfidence()` 算，格式由 `buildSummaryCardHtml()` 渲染。这样多个 agent 接入
    也不会出现格式/标准漂移。已如实标注方案 B 的固有局限：**本站无法验证 agent 是否真调了
    Pl@ntNet**（可伪造 score），缓解靠 `_identify_trace.source="mcp"` 溯源 + 整批回滚。
    `plant_drafts` 已有 `tags: string[]`，批量打标签可在草稿层直接做，**无需新迁移**。
- **⑬ 07-22 第六轮：MCP 最小闭环已实现并部署（Version b2f312b8）**
  - 用户已定：**只给 owner 用**（不对其他编辑开放 → 不做多租户/OAuth）、接受 Pl@ntNet
    伪造风险、**标签只能从已有里选**、先做最小闭环（2 工具、无批次表）。
  - **架构**：本机 stdio MCP → HTTPS → `/api/mcp/*` → 站内同一条建卡流水线。
    **刻意不复用 server fn**：TanStack 的 `/_serverFn/<hash>` 是内部实现、hash 随构建变化，
    外部进程没法稳定调用。端点在 [server.ts](src/server.ts) 里**先于**渲染管线拦截，
    不匹配则返回 null 照常走（已实测首页不受影响）。
  - **只收证据不收结论**（[mcp-api.ts](src/lib/mcp-api.ts)）：只接受 `plantnet.score` +
    `confidence` 三档；**拒收** agent 自报百分比与自写 HTML。可信度由
    `computeIdentifyConfidence()` 算、卡片由 `buildSummaryCardHtml()` 渲染 —— 与站内识别同一段代码。
    另强制要求**显式提供 `plantnet` 字段**（可为 null 但必须写），逼 agent 真去调专业引擎。
  - `ingestMcpIdentification()` 在 identify-plant.functions.ts，复用
    `normalizeIdentification` / `lookupRegistryChips` / `draftTitleFor`，落库 `_enriched:false`
    （要正文仍需用户点按钮）、`_identify_trace.source="mcp"` 可溯源。
  - 标签白名单校验 + 照片 SHA-256 查重（与站内同口径）都在端点里做。
  - **⚠️ 踩过的坑**：`ai_usage_logs` **没有 `note` 列**（我一开始猜的），真实字段是
    `draft_id/draft_title/task_type/capture_*`。写错会静默失败（外包了 try/catch）。
  - **实测通过**：无 token→401、有 token 但服务端未配置→401 且提示具体原因、GET→405、
    首页仍 200。业务逻辑待用户执行 SQL 配 token 后实测。
  - 文件：[mcp/plantspedia-mcp.mjs](mcp/plantspedia-mcp.mjs)、[mcp/README.md](mcp/README.md)
    （含已生成的 token 与安装 SQL）。
- **⑭ 07-22：「草稿内容和我的观察不符」按钮之谜 —— 定案（Version 0b60bd73 已上线）**
  - **不是被条件藏掉**（07-21 我以为是 `!submittedForReview`，那个确实是 bug 也确实修了，
    但修完用户仍说没有）。真因是**位置**：按钮渲染在**正文 iframe 之前**，而它自己的提示语写着
    「读**下面**的完整草稿时…点**上面**这个按钮」——正文很长，用户读完早已在几屏之外，
    叠加当时「页面自己滑动」的 bug，等于不存在。
  - **已移到正文 iframe 之后、金叶入口之前**，提示语改为「读完**上面**的完整草稿…」。
    DOM 顺序现为：正文(1312) → 观察不符按钮(1346) → 金叶入口(1374)。
  - 教训：UI 元素「渲染了」不等于「看得见」。条件对了之后还要看它在滚动流里的位置。
- **⏳ 仍未做（用户已提出）**：
  ⒝ 金叶生成过程想要更显眼的实时阶段提示（目前阶段文案只走 toast）；
  ⒞ 金叶「成功但用量表无记录」是否真成功 —— 需用户下次复现时抓 `wrangler tail` 才能定论。
- **🚧 BLOCKER（07-21 18:04）：③ 已 build 成功但 deploy 连续 2 次 `fetch failed`，按止损原则停手。**
  - **线上现状**：`Version 13170e23`（含 ①②④⑤ = 子请求优化 + 识别过程痕迹/可信度卡）**已上线**；
    **③ 三按钮机制代码已写完、tsc=0、dist 已构建，但未上线**。
  - **恢复动作**：网络好转时直接 `./node_modules/.bin/wrangler deploy`（**不必重新 build**，
    dist/ 就是含 ③ 的产物）。deploy 后务必确认输出里有 `Consumer for plant-jobs` 那行 ——
    07-21 就发生过只注册上 Producer、consumer 触发器被掐掉的情况。
- **(以下为定位前的过时判断，保留备查)**
  队列系统（job-queue/model-queue/worker-ctx/server.ts 的 queue handler/wrangler 队列配置）
  **代码全部写好且 wiring 正确**（逐一核过 enqueueJob→退回 keepAlive 的降级）。
  - **队列基建已就绪**：`wrangler queues list` 显示 `plant-jobs`（1 producer + 1 consumer）
    与 `plant-jobs-dlq` 均已于 07-20T08:33 创建；**不需要再建**。
  - **⚠️ 修正续16 早先的判断**：`wrangler deployments list` 显示 07-20 有多次部署，最后一次
    **07-20T22:31**，晚于队列创建，且 plant-jobs 已绑定 consumer → **带队列的 worker 很可能
    已经上线**，并非「完全没部署」。所以「生成失败」不一定是队列没上，可能是队列路径的运行时
    问题（enqueue 在运行时拿不到绑定而退回 26s waitUntil、或模型本身报错/超 15min）。
  - **「模型视觉自检通过」是干扰项**：自检只发 1KB 探针图测「能不能看图」，测不出长文生成能否
    在时限内跑完。
  - **下一步**：用户自行 `npm run build && ./node_modules/.bin/wrangler deploy`（部署当前工作树，
    含最新队列代码 + 本次海报修复）。**若部署后仍报「连续两分钟没有心跳」，就不是部署问题**——
    去 Cloudflare → Observability（wrangler.jsonc 已开日志留存）查那次失败任务的日志：
    看 `[job-queue] 已入队` 有没有出现（没出现＝退回了 waitUntil）、consumer 有没有跑 runQueuedJob。
- **③ projects 封面海报缩略图改为按原图比例自适应——已修并线上前验证。**
  竖版海报（1023×1537）以前被 `aspect-[16/10]`+`object-cover` 裁成横条。三处全改为
  `w-full h-auto`：卡片 [projects.index.tsx](src/routes/projects.index.tsx) ✅ dev 实测渲染
  412×619（比例 0.666 与原图一致、整张完整）、详情页 [projects.$id.tsx](src/routes/projects.$id.tsx) ✅、
  编辑器预览 [project-editor.tsx](src/components/project-editor.tsx)。tsc=0。**随用户下次 deploy 上线。**

## 🆕 2026-07-19（续13）「识别复核出卡AI三重奏」栏 + 网络报错人话化（tsc=0，**未部署**）
- **新增 [explain-error.ts](src/lib/explain-error.ts)**：把 `Load failed`（Safari/iOS）/
  `Failed to fetch`（Chrome）这类**浏览器原生网络错误**翻译成「原因 + 下一步」。这两条是同一个
  `TypeError`：fetch 在网络层就失败、**根本没拿到 HTTP 响应**，所以服务端那套「原因+怎么办」
  文案压根没机会产生 —— 用户屏幕上只剩一句废话。翻译时结合**耗时**（秒断=断网/切网，久等后断=
  超时/后台挂起）与**上传体积**给出排序后的可能原因。已接入 camera-identify 识别失败分支
  （带 elapsedMs / sizeBytes）与 identify.tsx 的 6 处 onError。
- **UI 重排（用户要求）**：新增 `IdentifyTrioSection`「识别复核出卡AI三重奏」折叠，
  **排在「配置 AI 模型」内容第一位**，含 Pl@ntNet → 疑似复核模型 → AI 模型控制台，
  **引擎自检抽成独立组件 `EngineSelfTestPanel` 放在该栏最后**（它跨越两块配置，
  挂在复核模型面板里名不副实）。草稿生成 / 小P蛙留在三重奏之外。
- **验证**：tsc=0 ✅；dev(5203) 临时放开 admin gate 实测渲染顺序与文案正确、无 console 报错，
  **gate 已改回 `isAdmin &&`** ✅。
- **⏳ 待用户回答（Kimi 变慢的定位）**：快速出卡链路
  [identify-plant.functions.ts:2761](src/lib/identify-plant.functions.ts:2761) **只挑
  `provider === "gemini"` 的序列项**，Kimi 排第 1 位理论上不参与出卡。所以变慢只可能是
  ① AI 控制台序列里**已经没有 Gemini 项** → quick 返回 null → 掉进完整管线用 Kimi 跑重 prompt；
  或 ② 别处配了推理模型。已确认复核模型是 qwen3-vl-flash（正常，不是 Kimi）。

## ✅ 2026-07-18（续14）二次复核模型改造为**厂商无关** + 模型选择器（已部署 69b5b919）
用户要求「不要局限于豆包，我要能自由配置任何模型；填 key + url，然后拉取模型（只展示有图形能力的）」，
并预告可能换 qwen 系列。

- **核心判断：不需要引入 dashscope SDK**。Qwen 有 OpenAI 兼容端点
  `https://dashscope.aliyuncs.com/compatible-mode/v1`，`qwen-vl-max` 用一样的 image_url 格式 →
  现有 OpenAI 兼容调用直接能跑。**换厂商只改 apiKey/baseUrl/model 三个字段，不用改代码。**
- **全面去豆包化**（符号 + 文案）：`loadDoubaoConfig→loadSecondOpinionConfig`、
  `doubaoIdentify→secondOpinionIdentify`、`doubaoPrimaryVerdict→secondOpinionPrimaryVerdict`、
  `listDoubaoModelsFn→listVisionModelsFn`、`*DoubaoConfigFn→*SecondOpinionConfigFn`、
  `DoubaoPanel→SecondOpinionPanel`。**provider 标签也改了**：
  `doubao-primary→vision-primary`、`doubao-adopted→review-adopted`、`doubao-declined→review-declined`。
  自检返回字段 `doubao→review`（前端同步）。`primaryEngine` 的 `"doubao"→"vision"`。
- **配置 key 迁移无痛**：新 key `second_opinion_config`，但 load/get **回退读旧的
  `doubao_vision_config`**，用户已存的配置继续生效、不用重填；clear 则**新旧都删**
  （只删新的会让旧的被回退命中 → 表现成「点了停用还在跑」）。
- **🔑 模型选择器的关键设计：探测必须用真图，不能用纯文本 ping**。
  新增常量 `VISION_PROBE_JPEG_B64`（32×32 绿色圆点 JPEG，约 1KB base64，内联在源码里）。
  纯文本 ping 只能测出「模型存不存在」，**测不出它能不能看图** —— 而本功能的全部意义就是
  「只列出真有图形能力的模型」。现在每个候选都真发一次带图请求：
  200=支持图片✓、404=未开通、401/403=鉴权失败、其它非200=模型在但不吃图（多半纯文本模型）。
- `isVisionModelCandidate` 通用化：覆盖 vision/vl/omni/multimodal、gpt-4o、glm-\d+v、claude、
  gemini、豆包 seed 系列；黑名单排除生图/视频/3D/向量/语音/翻译。并发 6、候选上限 24。
- **面板加厂商预设**（`VISION_VENDOR_PRESETS`）：火山方舟 / 阿里 DashScope / OpenAI / 智谱，
  一键填 baseUrl，免去翻各家文档。`ep-` 接入点仍需手填（列接入点要控制面权限，数据面 key 拿不到）。
- **验证**：tsc=0 ✅；dev(5199) 加载无 console/服务端报错 ✅；已部署 `69b5b919`（07-18T14:53:50Z）
  —— 上一轮那次 `fetch failed` 阻塞已自行恢复，本次一次成功。
- **待用户验证**：点「拉取可用模型」看实测结果。按之前实测，火山方舟这个账号大概率仍全是 404
  （需创建 ep- 接入点）；**可直接改用 DashScope + qwen-vl-max 试**，预设已内置。

## 🚧 2026-07-18（续13）豆包模型选择器 —— 代码完成、tsc=0，⚠️ **部署被网络阻塞，未上线**
用户反馈「手填模型 ID 老填错，能不能改成填 key 后拉取可用模型」。已实现，但**没能部署**。

- **实现**：新增 `listDoubaoModelsFn`（[identify-plant.functions.ts](src/lib/identify-plant.functions.ts)）
  + 面板「拉取可用模型」按钮（[identify.tsx](src/routes/identify.tsx)）。
  - **关键设计：不能只列目录**。实测过 `GET /api/v3/models` 返回 200 + 126 个模型，但逐个调用
    **全部 404** —— 目录里有 ≠ 账号已开通。所以对视觉候选（`isDoubaoVisionCandidate` 过滤掉
    生图/视频/3D/向量/翻译等）**逐个发一次 max_tokens=1 的纯文本请求实测**，绿色=真能调、
    灰色划掉=404，只有绿色可点选。
  - 探测判定：404 → 不可用；401/403 → 鉴权失败；**200 或 400 等非 404 → 算可用**
    （400 说明模型认下了请求、只是参数不合口味，模型是存在的）。
  - 并发 6 个一批，候选上限 24 个。
  - **`ep-` 推理接入点不会出现在列表里**（那是模型目录，列接入点要控制面权限），
    面板已明确提示「自建接入点请手动粘贴」。
  - 一个可用的都没有时，hint 直接引导：去方舟控制台「在线推理」创建推理接入点。
- **验证**：tsc=0 ✅；dev(5199) `/identify` 加载无 console/服务端报错 ✅。
- **🔴 BLOCKER：部署失败 3 次全是 `fetch failed`**（连 `wrangler deployments list` 都失败
  → 说明此刻本机到 Cloudflare 完全不通，是 GFW/VPN 问题，**不是代码问题**，见
  [[deploy-workflow]]/[[session-econnreset-root-cause]]）。已按 CLAUDE.md 的 retry cap 停止，未循环。
  - **线上仍是 `315ca7fe`**（含 Pl@ntNet WebP 修复 + 自检样本图修复），本次模型选择器**未上线**。
  - **恢复办法**：网络通畅后重跑 `npm run build && ./node_modules/.bin/wrangler deploy`，
    然后照例用 `wrangler deployments list` 对时间戳确认真的上了（别看输出想当然）。

## ✅ 2026-07-18（续12）Pl@ntNet 已修复上线并验证生效；豆包卡在账号未开通（部署 315ca7fe）
- **🎉 Pl@ntNet 修好了，线上已验证**：用户换 key 后新识别的用量记录 provider 出现
  **`plantnet+gemini-quick`** —— 说明 WebP→JPEG 那个修复真正生效，专业定种首次接入常规链路。
  （注：用户其实**不必换 Pl@ntNet key**，旧 key 一直是好的，根因自始至终是图片格式。）
- **🔴 豆包：账号未开通任何模型，不是模型 ID 写错**。用新 ARK key（46 字符，格式正确）实测：
  - `GET /api/v3/models` 返回 **200 + 126 个模型**（含 `doubao-1-5-vision-pro-32k-250115`）
    → **说明 API Key 本身有效**，这个列表是**目录**、不代表已开通。
  - 逐个实测 6 个视觉模型（`doubao-1-5-vision-pro-32k-250115` / `doubao-vision-pro-32k-241028` /
    `doubao-seed-1-6-vision-250815` / `doubao-1.5-vision-lite-250315` / `doubao-seed-1-6-flash-250828`
    等）→ **全部 `HTTP 404 InvalidEndpointOrModel.NotFound`**。
  - 结论：该账号需要在方舟控制台**开通模型**或**创建推理接入点（ep-…）**，然后把 `ep-…` 填进面板。
    这不是代码问题，改代码无解。（`doubao-1.5-vision-pro-250328` 因本地代理异常两次未测到，
    但同族全 404，预期一致。）
- **自检样本图 bug（用户自己指出的，已修）**：自检取的样本是站内历史图（多为 **WebP**），
  于是撞上刚加的 415 防御、报「不支持的图片格式」，等于测不到 key。已改为**只挑 URL 以
  .jpg/.jpeg/.png 结尾的记录**（各表取最近 40 条筛选），且**优先查 plant_drafts**
  （识别链路已强制 JPEG，新图必定命中）；找不到时提示「先识别一张照片再来自检」。
- **教训**：自检类功能必须保证「测试样本本身满足被测服务的约束」，否则自检结果会误导——
  这次就出现了「Pl@ntNet 实际已修好，自检却报红」的假阴性。
- **验证**：tsc=0 ✅；已部署 `315ca7fe`（07-18T11:30:34Z）。
  **待用户验证**：豆包创建 ep- 接入点后重测；Pl@ntNet 自检应转 ✅（实际早已在线上工作）。

## 🔴 2026-07-18（续11）根因大发现 — Pl@ntNet 从没成功过，原因是 **WebP**（已修，部署 9c4e9fbd）
用户追问「豆包和 Pl@ntNet 到底参没参与」，实测数据库 + 真实 key 直连，两个引擎**各自死于不同原因**：

1. **🔴 Pl@ntNet 死于图片格式（代码 bug，已修）**
   - 实测：拿站内真图直连 Pl@ntNet → `HTTP 400 {"message":"Unsupported file type for image[0] (jpeg or png)"}`
   - 根因：[image-compress.ts](src/lib/image-compress.ts) 的 `compressImage` **默认输出 WebP**
     （现代浏览器都支持，所以恒为 WebP），而 **Pl@ntNet 只接受 JPEG/PNG**。
     → 每一张识别照片都被 400 拒收 → **Pl@ntNet 自接进来那天起一次都没成功过**，
     用量表里自然只剩 gemini。
   - **关键推论：Pl@ntNet key 是好的** —— 返回的是 400（格式错）不是 401（认证错），
     说明服务器接受了 key。别去换 key，白费功夫。
   - 修法：① `compressImage` 新增第 5 个参数 `preferType`，识别链路传 `"image/jpeg"`
     （[camera-identify.tsx](src/components/camera-identify.tsx) 那处 `compressImage(file,1200,1200,0.75,"image/jpeg")`）；
     ② 强制转码时**绕过**两个「偷懒退回原文件」分支（小文件<200KB 直接返回、转码后变大就退回）
     —— 否则格式会被退回 WebP，白修；③ `plantNetIdentify` 开头加防御：非 jpeg/png 直接短路
     返回 status=415，不白发注定 400 的请求。
   - 代价：识别图从 WebP 转 JPEG，体积约翻倍（实测样本 50KB→94KB）。值得 —— 换回专业定种。

2. **🔴 豆包死于 key 无效（用户配置问题，需用户自己换）**
   - 实测：`HTTP 401 {"code":"AuthenticationError","message":"the API key or AK/SK ... is missing or invalid"}`
   - 库里存的 apiKey **长 158 字符**，而方舟 ARK API Key 通常是 UUID 形态（约 36 字符）。
     几乎可以断定用户填成了 **IAM 的 AK/SK**（他最初就说「有 access key 和 api key」）。
   - 面板已加提示：AK/SK 会报 AuthenticationError、正确的 key 约 36 字符。

3. **「后台看不到已填的 key」= 误会，不是 bug**：数据都在 site_config（实测 4 行俱全，
   `doubao_vision_config` 07-18T09:34 保存成功）。只是出于安全**已保存的 key 不回填输入框**，
   用户看到空框以为没存上。面板已加说明：看上方状态条「已启用」即可。

4. **自检自己也有 bug（已修）**：取样本图查的是 `plants.photo_url`，但 plants 表的图片字段
   叫 **`cover_url`**（`photo_url` 是 plant_drafts 的）→ 400 column does not exist →
   报「无法取得测试样本照片」。已改为 `cover_url` + fallback 到 plant_drafts，
   且**把真实 DB 错误带进界面**（原来吞成一句笼统提示，掩盖了根因，教训）。
   自检还升级为能区分：key 无效(401/403) / 额度用尽(429) / 格式不支持(415) /
   HTTP200 但认不出图（这也算 key 通过）/ 豆包「纯文本通但看图失败=不是视觉模型」。

- **诊断脚本**：[scratch/diagnose_engine_config.py](scratch/diagnose_engine_config.py)（查 site_config
  实际存了什么 + plants 图字段 + 最近 provider 分布；从 .env 读 key，不打印明文）。
- **⚠️ 安全**：排查时一次异常堆栈把 Pl@ntNet key 明文打了出来（该 API 设计上把 key 放 URL query 里）。
  已建议用户去 my.plantnet.org 轮换。另注：`scratch/backfill_admin.py` 里**硬编码了 service-role key**，
  但该文件未被 git 跟踪（已核实 key 从未进入 git 历史），仍建议清理。
- **验证**：tsc=0 ✅；已部署 `9c4e9fbd`（07-18T11:04:52Z）。**待用户验证**：换成正确的 ARK API Key 后
  点「自检两个引擎」，Pl@ntNet 应变 ✅、豆包应变 ✅；随后新识别的 provider 应出现 `plantnet+gemini-quick`。

## ✅ 2026-07-18 部署记录（版本 211770f2-5a1e-4afc-8a13-c8bcb73d6569）
- **已上线**：续10 全部 5 项。部署前基线是 `512b1658`（07-18T09:18Z，并发会话把**续9 的
  Pl@ntNet/豆包复核**连同它自己的三项修复一起上线的那次），新版本 07-18T10:28:51Z、100% 流量。
- **本次部署第一次就成功**（没触发 GFW 那个 fetch failed 老问题）。仍照例用
  `wrangler deployments list` 对了时间戳确认真的上了，没看输出想当然。
- **线上验证**：plantspedia.club/identify 加载正常、无 console 报错 ✅。
- **⚠️ 仍未端到端验证**（都需要 admin 登录 / 真实识别，留给用户）：「自检两个引擎」按钮实际点击、
  疑似→豆包复核、分享卡纯图、放弃补拍。**建议第一步就点自检**，它会直接告诉你两个 key 的真实状态。
- **⚠️ 手机上若仍看到旧 UI** = PWA service worker 缓存，不是部署失败（见 [[pwa-service-worker-caching]]）。
- **未提交**：本轮改动已部署但**还没 commit**（部署打包的是工作区，不需要 commit）。

## 🚧 2026-07-18（续10）— 引擎自检 + 用量可观测性修复 + 分享卡纯图 + 放弃补拍（tsc=0；✅ 已部署 211770f2）
用户上线续9 后反馈「用量记录只有 gemini，豆包和 Pl@ntNet 是不是没参与？」——**排查结论：大概率
是正常的，但当时确实看不出来**。三个原因，前两个是我的缺陷：
1. **Pl@ntNet 不消耗 token**，本来就不会在 ai_usage_logs 里有独立记录；
2. **（已修）provider 字段不体现一线引擎** —— Pl@ntNet 成功时 `usedProvider` 仍是 `gemini-quick`，
   管理员无从判断它是否参与。现在拼成 `plantnet+gemini-quick` / `doubao-primary+gemini-quick` /
   `…+doubao-adopted` / `…+doubao-declined`，一眼看穿整条链路；
3. 豆包**只在「疑似」时才调用**，用户那三条都成功定种（非疑似）→ 豆包不参与是符合预期的。
- **（已修 bug）豆包复核未采纳时 token 被丢弃**：`usage = addUsage(...)` 原本只在 `resolved`
  分支里，导致被否决的复核变成一笔查不到的隐形开销。现已移到 `if (second)` 内，无论采纳与否都计入。
- **新增引擎自检** `testIdentifyEnginesFn` + 面板「自检两个引擎」按钮：取**站内一张真实植物照片**
  跑完整链路（Pl@ntNet 走 plantNetIdentify、豆包走 doubaoPrimaryVerdict），而不是只 ping key ——
  纯文本 ping 会让「key 有效但模型不是多模态」这个最常见的配置错误蒙混过关。返回各自成功/失败 +
  错误详情 + 额度标记状态。
- **药用紫草重复两条**：前端有 `phase==="submitting"` 按钮禁用，双击重复提交基本不可能；两条相隔
  2 分钟且中间夹着另一次识别（羽状短柄草），几乎可以断定是**用户自己识别了两次**而非一次写两条日志。
  且两条 prompt_tokens 完全相同（1.8K）**排除了补拍**（补拍会多带旧图、prompt 明显变大）。
  诊断 SQL：[scratch/diagnose_duplicate_identify.sql](scratch/diagnose_duplicate_identify.sql)
  （看 draft_id 是否相同即可定性；另附按 provider 分组统计，可直接确认新链路有没有跑起来）。
- **分享卡改为纯图片**（[drafts.$id.tsx](src/routes/drafts.$id.tsx)）：`onShareCard` 不再传
  `{url,text,title}` → `shareOrSaveImage` 自然不写剪贴板、不拼文案，系统面板里直接是「存储图像」。
  按钮「分享 / 存相册」→「保存到相册」。**只改识别卡**；`share-card-button.tsx`（详情页通用分享）未动。
- **补拍关卡加「放弃补拍」**：抽出 `closeCardOnly()`（只收卡、不跳转，且置 `cardAutoOpened=false`
  以免之后再被二次拽走），`closeCard()` 复用它。疑似卡片下方新增「放弃补拍，直接看简介摘要卡」，
  预告文案同步改写。理由：补拍是建议不是强制，原来疑似等于把人锁在补拍循环里。
- **验证**：tsc=0 ✅；dev(5199) 加载无服务端报错 ✅。**未验证**：自检按钮实际点击（需 admin 登录）、
  豆包端到端；**未部署**。

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

## 2026-07-19 — 自定义接口 Base URL 粘贴完整 URL 导致「拉取可用模型」404
- **症状：** 管理台加 Kimi/Moonshot 作 Gemini 备用模型时，Base URL 填
  `https://api.moonshot.cn/v1/chat/completions`，点「拉取可用模型」报
  `HTTP 404 url.not_found … "url":"/v1/chat/completions/models"`。
- **根因：** 代码统一自己拼路径（调用拼 `/chat/completions`、列模型拼 `/models`），
  base 里已含路由就被二次拼接。以前只 strip 尾部斜杠，没 strip 路由段。
- **修复：** 新增 `src/lib/ai-base-url.ts → normalizeBaseUrl()`，剥掉尾部
  `/chat/completions | /completions | /responses | /messages`；替换全部 11 处
  server 端 base 规范化 + 前端 3 个文件（面板/identify/用户设置）的保存、拉取、
  预览行；帮助文案改为「粘完整 URL 也行，会自动裁掉」并把 Kimi 列入兼容示例。
- **验证：** `tsc --noEmit` 干净；normalizer 各输入形态单测通过；dev 起在 5203，
  /identify 渲染正常无 console 报错。管理台面板需管理员登录，未做端到端点击。
- **未部署** —— 需 `npm run build && wrangler deploy`（老规矩：挂梯子）。
- **部署完成 2026-07-19：** `wrangler deploy` 一次成功，Version ID
  `fe2f1154-e0f5-42c5-a795-25794cb26efd`，触发 plantspedia.club / www 双域名。
  线上 /identify 正常渲染、无 console 报错（浏览器验证；shell 里 curl 与
  `wrangler deployments list` 因本机代理/网络返回 000/fetch failed，与部署无关）。
- **Kimi 备用模型选型结论：** Moonshot 2026-07-16 发布 **kimi-k3**（2.8T MoE，
  原生视觉 + 1M 上下文），带图识别可用；kimi-k2.6 / k2.7-code 也支持图片。
  旧的 moonshot-v1-* 纯文本版不能看图。Base URL 填 `https://api.moonshot.cn/v1`
  （现也可直接粘完整 URL）。

## 2026-07-19（续）— key 池跨厂商混用导致 401（比 404 更深的一层）
- **症状：** Base URL 修好后改报 `HTTP 401 Invalid Authentication`。
- **根因：** 管理台的 API Key 列表是**全厂商共用的一个池**，逗号 join 后存下。
  用户池里顺序是 `AQ.…(Gemini) , AQ.…(Gemini) , sk-…(Moonshot)`。
  1) `listProviderModelsFn` 只取 `split(",")[0]` → 拿 Gemini key 去问 Moonshot → 401。
  2) 更严重：正式调用处 `Bearer ${apiKey}` **直接把整串 join 后的池当成一个 token
     发出去**（identify 主链路 L1618、quickIdentify L656、openaiCompatChat L5152）
     → 即使存下来，识别也必 401。UI 却写着「自定义接口也支持轮换」。
- **修复：** 新增 `src/lib/ai-key-pool.ts`（`splitKeyPool` / `keyRejected` /
  `bearerFetchRotating`）；401/403/429 自动换下一个 key，其他状态码原样返回不吃掉
  调用方自己的重试。接入拉模型、identify 主链路、quickIdentify、openaiCompatChat
  （后者额外记住命中的 key 供无图重试复用）。错误信息里 key 一律打码。
- **验证：** `tsc --noEmit` 干净；起本地假 OpenAI 服务跑 5 条断言全过（含用户真实
  的「两个 Gemini key 排在 Moonshot key 前面」这一顺序 → 第 3 个 key 命中、
  join 串从未被当成单 token 发出、全坏池如实报 401）。
- **已部署：** Version ID `42c1c35f-14ae-4f04-bcd1-a039ad55a082`，线上无 console 报错。
- **待用户确认：** 管理台点「拉取可用模型」应能列出 kimi-k3；管理员登录态我这边没有。

## 2026-07-19（进行中）— 重新设计 key 池 → 「优先调用序列」
**用户要求：** 三个控制台（AI 模型 / 疑似复核 / 小P蛙）统一改成：一个「配置后台AI模型」
按钮 → 展开后第一行「优先调用序列1」+ 完整配置（服务商 / **单个** API Key / Base URL /
模型 / 拉取可用模型），保存按钮旁「添加排队序列2」（递增），点序列号可下拉调顺序、
调完按 1~n 重排。分享卡三按钮同行三色。
**为什么：** 旧机制一个控制台只有一个 provider + 一池逗号 key，跨厂商必 401
（小P蛙排队模型同样中招），且表达不了「Gemini 用完换 Kimi」。
**新数据模型：** `src/lib/model-queue.ts` —— 每个序列项是一套**完整自洽**配置
`{provider, apiKey(单个), baseUrl, model}`，`sequence[0]` 即序列 1。
`readModelQueue()` 认三种历史形态，旧的逗号 key 池**按 key 自动展开成多个序列项**
（provider/model/baseUrl 原样复制）→ 线上数据零手工迁移。site_config 是 JSON 列，
**不需要 DB migration**。`shouldFailOver()`：401/403/404/429/5xx/网络错误 顺位下一个；
400 不顺位（换家也一样挂，且会埋掉真错误）。
**进度：**
- [x] 分享卡三按钮同行三色（drafts.$id.tsx；「关闭」= 原「放弃补拍」，删掉下划线链接）
- [x] `src/lib/model-queue.ts` + 20 条断言全过（含用户线上真实的三 key 混池形态）
- [ ] 队列执行器（按序调用 + 顺位降级）
- [ ] 通用 server fn（get/save/clear，按 console id 映射 site_config key）
- [ ] 共用 UI 组件 `<ModelQueueConsole>` + 接到三个控制台
- [ ] 运行时四个消费点接入（identify 主链路 / quickIdentify / openaiCompatChat / 二次复核）
- [ ] 部署
**进度（续）：**
- [x] 队列执行器 `runModelQueue` + `httpStatusOf`（在 identify-plant.functions.ts 内，
      靠 model-queue.ts 的 shouldFailOver/slotLabel/maskKey）。9 条降级断言全过。
- [x] 通用 server fn：`getModelQueueFn` / `saveModelQueueFn` / `clearModelQueueFn`
      （按 consoleId 映射 site_config key，assertAdmin 守卫，context 是 {supabase,userId}）
- [x] 共用 UI `src/components/model-queue-console.tsx`，三个控制台全部接入：
      AdminModelPanel（identify.tsx，447 行 → 17 行）、XiaoPModelPanel（整文件重写）、
      SecondOpinionPanel（只换配置表单，保留启用状态/引擎自检）
- [x] 三个 loader 全部走 readModelQueue（新旧形态通吃，9 条兼容断言全过）
- [x] identify 主链路降级：`callAiIdentify` 拆成 `callAiIdentifyWithConfig(slot,…)`
      + 外层按序列跑；序列为空时传 null 走 .env 兜底（与改造前一致）
- [ ] 二次复核链路仍只用序列 1（loadSecondOpinionConfig 取 sequence[0]），未接降级
- [ ] 部署
**踩坑记录：** 想把执行器挪进 model-queue.ts 时，python 切片的 end 锚点选错，
一刀切掉了 25k 字符（quickIdentify/plantNet 等全没了）。靠切前存的 /tmp/execblock.txt
原位插回救活。教训：大文件切块务必先验证 start/end 区间长度再落盘。
- **修一个自己刚引入的 bug（已部署 `c330e677-5a11-4c41-8315-c9beeba2770b`）：**
  `getSecondOpinionConfigFn` 直读 `cfg.apiKey`，新界面存的是 sequence 形态 → 保存后
  状态条显示「未启用（疑似直接进补拍）」但模型其实在跑。改走 readModelQueue，
  并多回一个 `sequenceCount`（面板可显示「1 主 + N 备」）。
  同类问题的 `getAiConfigFn` / `getXiaoPConfigFn` 已无 UI 调用（面板改成薄封装），
  identify.tsx 里三个死导入已删；这两个 fn 本身留着未清理。

## 2026-07-19（续2）— 「队列没真正激活」：两处绕开队列的链路
**用户报错：** 识别报 `AI 文案生成失败（HTTP 429 · RESOURCE_EXHAUSTED）` Gemini 日额度用尽，
没有降级到 Kimi。
**根因（两个，叠加）：**
1. `identifyQuick`（phase-1 快速出卡，Gemini 专用）调的是 `loadAiConfig()` = **只取序列 1**，
   整段没被 runModelQueue 包住；且它的 catch 里 `if (e instanceof AiError) throw e` 会把
   429 直接抛给用户。那句注释的理由是「重链路会撞同一堵墙」—— 在旧的单厂商世界成立，
   现在重链路能降级到 Kimi，所以这个 rethrow 变成了「在降级发生前先掐死流程」。
2. `callAiIdentifyWithConfig` 里的 two-stage 分支：provider=custom 时用 custom 做快速定种、
   然后 `dbConfig = null` 把**重活改道回 .env Gemini**。于是即使降级到 Kimi，草稿生成
   还是回到那个已耗尽的 Gemini → 队列等于白降。
**修法：**
1. identifyQuick 改为对**序列里所有 Gemini 项**跑 runModelQueue；全挂时若序列中还有
   非 Gemini 替补（`hasNonGeminiBackup`）则返回 null 交给重链路降级，没有替补才抛原错误。
2. `callAiIdentifyWithConfig` 加 `allowGeminiReroute` 参数，只有 `index === 0`（序列 1）
   才允许改道回 env Gemini；轮到替补时用替补自己的模型干重活。
**已部署：** `884d447a-717e-4c1f-b2ed-b15c507603db`。lint exit 0，tsc 干净，build 通过，
prettier 已格式化。
**仍未接队列：** `extractPlantMetaFn`（admin 从 HTML 抽植物 meta 的工具，非识别链路）
仍用 loadAiConfig()+env key 混池；二次复核运行时仍只用序列 1。
**未验证：** 真实的 429 降级需要线上跑一次识别才能确认（我无管理员登录态/无法触发）。

## 2026-07-19（续3）— 用户端小P蛙配置 + 二次复核运行时接队列
**已部署：** `7491943a-a820-4366-b4d4-8bae7628f53e`
1. **`<ModelQueueConsole>` 改成存储无关**：新增 `storage?: {load,save,clear}` 适配器，
   与 `consoleId`（存 site_config）二选一。另加 `clearLabel/defaultOpen/onSaved`。
2. **用户端小P蛙**（`xiaop-user-settings.tsx`，每人自带 key，存 localStorage）
   原本还是老机制：一个厂商 + 一池逗号 key。这不只是外观问题 —— `xiaoPChat` 把
   override 当**单个** slot，逗号池会被整串当一个 token 发出去 = 必 401。
   现改为共用 ModelQueueConsole + 本地存储适配器。整个文件 330 行 → 60 行。
   预设模型也顺手更新（claude-3-5-sonnet-20241022 → claude-sonnet-5 等）。
3. **`xiaop-user-model.ts`** 改存序列，`readModelQueue` 迁移旧 v1 单配置/逗号池；
   `userModelArg()` 同时带扁平字段（兼容）和 `sequence`（新）。13 条断言全过。
4. **服务端 `UserModelInput`** 新增可选 `sequence`；`toOverride` → `toOverrideSlots`
   回 ModelSlot[]；`xiaoPChat.opts.override` → `overrideSequence`（整条都用，能自己降级）。
   `resolveXiaoPGemini` 改为从序列里挑第一个 Gemini 项（grounding 仅 Gemini 支持）。
5. **二次复核运行时接队列**：新增 `withSecondOpinionSlots()` —— 两个消费点本来就是
   「失败返回 null」的优雅风格，所以降级 = 挨个试到有结果为止，不会因序列 1 挂了就哑掉。
**测试：** 5 套共 51 条断言全过（queue 20 / compat 9 / failover 9 / usermodel 13 / pool）。
tsc 干净、lint exit 0、build 通过、prettier 已格式化。
**仍未接队列：** 只剩 `extractPlantMetaFn`（admin 从 HTML 抽 meta 的工具，非识别链路）。
**未验证：** 小P蛙面板需 `canEdit`（编辑登录）、管理台需 admin —— 两处 UI 我都进不去，
渲染与点击均未实测。

## 2026-07-19（续4）— 队列已生效；Kimi K3 拒收 temperature
**已部署：** `ec2cad3f-61e2-4e45-bec4-e5abf3e8b541`
**好消息：** 降级链路确认工作 —— 用户报错显示 序列1 Gemini 429 → **确实顺位到了**
序列2 Kimi。前面几轮的修复有效。
**新问题：** Kimi K3 回 `HTTP 400 invalid temperature: only 1 is allowed for this model`。
各家对可调参数的支持差异很大，不支持时一律 400 而非忽略（OpenAI o 系列同理）。
**修法（厂商无关）：** `ai-key-pool.ts` 新增 `postOpenAICompat()` —— 400 时从**错误文本里
认出**是我们发过的哪个可调参数（temperature/top_p/max_tokens/response_format/
frequency_penalty/presence_penalty）被拒，删掉它重试**一次**；与参数无关的 400 原样返回，
不掩盖真错误。比维护「哪家支持哪些参数」的表更耐用（新模型不用改代码）。
接入 4 处：identify 主链路、quickIdentify、二次复核 ×2（signal 超时控制经
`opts.signal` 保留）。9 条断言（含用户报错原文）全过。
**另修：** runModelQueue 的失败信息以前说「N 个序列都没能出结果」，但遇 400 会提前停，
说成 N 个会让人去查根本没试过的配置。改为「已依次尝试 X / N 个序列（末项的错误无法靠
换模型解决，已停止顺位）」。
**`extractPlantMetaFn` 已接队列：** 改用序列里**所有** Gemini 项组池 + .env 兜底
（原来只取序列 1，额度一满整个工具不可用）。至此**所有** AI 调用点都走队列了。
（二次复核运行时在「续3」已接，本轮用户是引用了我更早的旧描述。）
**测试：** 5 套 60 条断言全过；tsc/build/prettier 干净。

## 2026-07-19（续5）— 草稿页深色模式移除
**已部署：** `89a4cf0e-5206-42ec-9b6f-404d32378c46`
**问题：** 用户开系统深色模式时草稿/植物页变黑，与站点整体米白纸色不协调。
**根因：** 站点主体（React app）**完全不做**深色模式，只有 `src/lib/plant-html-template.ts`
里有 3 处 `@media(prefers-color-scheme:dark)`（:root 变量覆盖 + 入侵卡 + 保护卡），
于是只有这一块跟着系统变黑 → 不协调。非本次改动引入，是既有行为。
**修法：** 删掉那 3 块，模板恒为浅色，与站点一致。
**已验证（少见地能真验一次）：** 浏览器 colorScheme=dark 下访问线上植物页，
`matchMedia('(prefers-color-scheme: dark)').matches === true` 但 body 背景仍是
`oklch(0.948 0.018 90)`（米白）、文字 `oklch(0.2…)`（深色），截图确认视觉正常。

## 2026-07-19（续6）— 524 网关超时 + Gemini 换 key 无效
**已部署：** `1a52dc26-0ecf-4109-9373-db00cc0089b2`
**用户现象：** 换了 3 个新 key 后，识别正常，但生成完整草稿仍三个序列全挂：
序列1/3 Gemini 依旧 429；序列2 Kimi 回 **HTTP 524**。
**问题 A — Gemini 换 key 没用（重要）：** 免费额度按 **Google Cloud 项目**计，不是按 key。
同项目下新建 key 共用同一个已耗尽的配额。而我们的错误提示当时写着「或在管理后台更换
API key」—— **是这句错误建议让用户白换了一轮 key**。已改写：明确说明换 key 无效，
给出四条真正有效的做法（等重置 / 换不同项目的 key / 开通付费 / 把非 Gemini 排到序列 1）。
**问题 B — 524：** Cloudflare 的「上游超时」。整份草稿要生成几十秒~几分钟，Kimi K3 这类
推理模型每次都同样慢 → 已有的 3 次 5xx 重试全部同样超时，重试解决不了。
**修法：流式。** `ai-key-pool.ts` 新增 `postOpenAICompatStream()`：开 `stream:true`，
token 边生成边回，网关一直看得到字节就不判超时；再把 SSE 增量拼回**与普通响应同形**的
Response（`choices[0].message.content` + `usage`），上层 `resp.json()` 无需改动。
处理了跨 chunk 半行、`[DONE]`、心跳行；中转忽略 stream 回普通 JSON 时返回 **599**，
调用方据此退回非流式。接入点：重活链路遇 524/504/408 时自动改流式重试，失败则回原路。
6 条断言全过（含跨 chunk 分片、非 SSE 回退、524 透传）。
**测试合计：** 6 套 66 条断言全过。tsc/build/prettier 干净。
**未验证：** 真实 Kimi 长生成是否确实不再 524 —— 需线上跑一次完整草稿生成才知道。

## 2026-07-19（续7）— 草稿模型独立控制台 + 配置总开关 + 用量统计重做
**已部署：** `08c85b67-d705-4db9-83ca-3dcac1f58622`
1. **第 4 个控制台 `enrich`**（site_config key `enrich_model_config`）：专管
   「进一步生成草稿」。`callAiIdentify` 新增 `queueKind: "ai"|"enrich"` 参数，
   enrichDraft 传 "enrich"。`loadEnrichQueue()` **留空时自动回退到 ai 序列** ——
   新控制台不配也不会坏。
2. **`AdminModelHub`**：识别页原本平铺 5 块管理员面板（要滚过一屏才能拍照），
   现在全收进一个「配置 AI 模型」按钮，默认收起。
3. **用量统计重做**：以前聚合只 select `total_tokens`，看不出钱花在哪。现在取回
   prompt/completion/task_type/created_at，新增：输入vs输出构成、按环节拆分
   （识别/草稿生成/复核/小P蛙）、近 24h / 7d / 30d 三个时间窗、单次均耗。
   UI 用 `UsageOverview` + 双色占比条重画。
4. **余额查询 `getQueueBalancesFn`**：**只有 Moonshot 有公开余额接口**
   （`GET {base}/users/me/balance`，已核实官方文档），实现之。Gemini 免费额度按项目计、
   OpenAI/Anthropic 均无公开接口 → 一律标 `unsupported` 并说明去哪看，
   **绝不用估算值冒充余额**。控制台收起态显示余额行 + 「刷新余额」。
**测试：** 6 套 66 条断言全过；tsc/build/prettier 干净。
**未验证：** 四个控制台、总开关、用量面板、余额显示全都在 admin 门后，我无登录态，
**UI 一次都没实测过**。余额接口只按官方文档实现，未用真 key 打过。

## 2026-07-19（续8）— Kimi 排序列1 却报 Gemini 401
**已部署：** `f2edc6ea-147c-4a38-9ea7-981a6dd220d0`（改道修复）+
`f7b3bb90-436c-4f03-b4af-ddf08fdc8cb7`（草稿卡分级）
**症状：** 用户把 Kimi 放序列 1 后，报错却是「序列 1 · custom kimi-k2.6：Gemini API key 无效」。
**根因：** 就是「续2」里我加的 `allowGeminiReroute = (index === 0)`。那个判断默认序列 1
一定是 Gemini；用户把 Kimi 放第一后，custom + index 0 → 触发 two-stage 改道
→ `dbConfig = null` → 重活交给 .env 的 GEMINI_API_KEY（已被用户轮换失效）→ Gemini 401。
错误信息与所配模型完全对不上，正是这条线索定位到的。
**修法：整段删除改道。** 旧设计假设 custom 只是弱视觉中转；在「优先调用序列」下
每项都是管理员明确指定的完整配置，不该被偷偷换成别的模型。连带删掉失去所有赋值的
`stageUsage`（`stageModel` 仍被 Pl@ntNet 分支使用，保留）。
**草稿卡三档标识：** `draftTier()` 从字段推断 —— published_plant_id → 金叶详页；
html_content 非空 → 银叶草稿；否则 → 快速简介。带 title 悬浮说明。
⚠️ 注意 published_plant_id 在「审核通过收录」时也会写，所以第三档准确含义是
「已存在正式收录页」，不单指金叶生成；标签用词已按此拿捏，未夸大。
**下一步（用户已确认方案）：** enrichDraft 超时改「后台任务 + 前端轮询」。
诊断：3 次联网调研 + 一次长文生成 > Cloudflare 边缘 100s 响应上限 → failed to fetch，
重试无用。方案：server fn 立刻返回任务 ID，用 waitUntil 在后台跑，前端每几秒轮询进度
（可显示「正在调研…正在撰稿…」）。**尚未开始。**

## 2026-07-19（续9）— 超时的真正原因 + 金叶同样有雷（交接重点）
**为什么 enrich 现在超时、以前不超时：**
以前 provider=custom 时会 `dbConfig = null` 把重活改道给 .env 的 **Gemini Flash**，
所以**无论管理员怎么配，写草稿的永远是 Flash**（十几秒，远低于上限）。「续8」删掉改道后
草稿生成才真正落到所配模型上；用户配的是 Kimi K3/K2.6（推理模型，慢一个量级）
→ 一次联网调研 + 一整份中英双语长文 > Cloudflare 边缘 **100 秒**响应上限 → failed to fetch。
**超时是修好 bug 后暴露出来的，不是退步。** 同理解释了之前的 524。
**更正一处早先的错误说法：** enrichDraft 只跑 **1 次** `xiaopGroundedSearch`；
跑 3 次的是 `createGoldDetailPageFn`（金叶）。早前我说 enrich 跑 3 次是张冠李戴。
**各链路用哪套序列（已核实）：**
- 识别一线 / 快速出卡 → `ai` 序列（`ai_model_config`）
- 进一步生成草稿 enrichDraft → `enrich` 序列（`enrich_model_config`，留空回退 ai）
- 疑似复核 → `second_opinion`；小P蛙对话/改写 → `xiaop`
- **金叶详页 `createGoldDetailPageFn` → 走 `xiaop` 序列**（经 xiaopTextCall /
  xiaopGroundedSearch），且用户自带模型优先。代码里 `goldProvider="gemini"` 只是初始值。
**金叶也有同样的雷：** drafts.$id.tsx 里金叶只是前端 `void` 掉 Promise + 常驻 toast，
**请求仍是同一个前台 HTTP 请求**（提示语「请勿关闭或刷新标签页」即证据）。它跑 3 次调研 +
多次长文，比 enrich 更重。目前没炸只因为 xiaop 序列多半还是 Gemini Flash；
一旦小P蛙也换 Kimi，金叶会以同样方式挂掉。**改造必须两条路一起做。**

## 2026-07-19（续10）— 长任务改「后台执行 + 前端轮询」（进行中）
**目标：** enrichDraft / createGoldDetailPageFn 超过 Cloudflare 边缘 100s 响应上限。
改为：server fn 立刻返回任务 ID → keepAlive(ctx.waitUntil) 在响应后继续跑 →
前端每 3s 轮询阶段文案 → 完成取结果。关标签页也不丢任务。
**零迁移：** 任务存 `site_config`（key `job:<uuid>`，value jsonb），沿用
plantnet_quota_state 的既有玩法，service-role 读写绕过 RLS。**不需要用户执行 SQL。**
**已完成（未部署，等用户复核）：**
- `src/lib/worker-ctx.ts`（新）—— AsyncLocalStorage 传递 ExecutionContext + `keepAlive()`
  （= ctx.waitUntil，让活儿撑过响应）。拿不到 ctx 时优雅退化成 fire-and-forget。
- `src/server.ts` —— fetch 入口包一层 `runWithExecutionCtx(ctx, …)`。**这是关键：**
  ctx 只有 worker 入口拿得到，server fn 里没有；不能用模块级全局（同 isolate 并发请求
  会拿到别人已结束的 ctx）。
- `src/lib/background-jobs.ts`（新）—— 任务 store。**存 `site_config`，key `job:<uuid>`，
  零迁移**（沿用 plantnet_quota_state 的既有玩法，service-role 读写绕 RLS）。
  createJob/readJob/setJobPhase/finishJob/failJob/pruneExpiredJobs/isJobStale。
  patchJob 故意「写失败只记日志不抛」—— 进度写不进去不该搞挂已跑了两分钟的生成。
- `src/lib/poll-job.ts`（新）—— 前端轮询（3s 一次，20min 兜底上限），**从不 reject**，
  失败走返回值。另含 rememberJob/recallJob/forgetJob（localStorage 存 jobId）。
- `identify-plant.functions.ts` —— `enrichDraft` 拆成 `enrichPreflight`（快校验，前台同步跑，
  用户点下去立刻知道能不能干）+ `runEnrichCore`（重活，后台）；新增 server fn
  `startEnrichDraftFn` / `startGoldDetailPageFn`（立刻返回 jobId）/ `pollJobFn`。
  `createGoldDetailPageFn` 同构拆成 `goldPreflight` + `runGoldCore`。
  **旧的 `enrichDraft` / `createGoldDetailPageFn` 导出已删除**（只有 drafts.$id.tsx 用过）。
- `src/routes/drafts.$id.tsx` —— 两条链路都改轮询，toast 显示阶段文案（「正在联网调研 2/3…」
  「正在撰稿 1/3…」）。**挂载时自动接回未完成任务**（读 localStorage）→ 刷新/关标签页
  /换设备都不丢。「请勿关闭或刷新标签页」那句提示已删，改成「可关闭或刷新本页」。
**阶段文案：** enrich = 读原图 5% → 联网调研 20% → 撰稿 45% → 保存 88%；
gold = 名录取证 5% → 配图 12% → 调研 1/3·2/3·3/3 (20/28/36%) → 撰稿 1/3·2/3·3/3
(45/58/70%) → 渲染上传 82% → 写档案 90%。
**不需要用户执行任何 SQL。**
**测试：** 7 套 81 条断言全过（原 6 套 66 条 + 新 jobs.test.ts 15 条：卡死判定边界、
ALS 传递与隔离、无 ctx / waitUntil 抛错 / rejected promise 三种兜底）。
tsc 干净、build 通过、新文件 eslint 0 error、prettier 已格式化。
**未验证（重要，别当成已验证）：**
- 草稿页需登录，**整条 UI 一次都没实测**：按钮、toast 阶段文案、断线续跑都没在浏览器里跑过。
- **`ctx.waitUntil` 在 TanStack Start + @cloudflare/vite-plugin 下是否真能拿到 ctx，
  只在测试里用假 ctx 验过，没在真实 Workers 运行时验过。** 万一 ctx 是 undefined，
  会退化成 fire-and-forget —— 任务大概率仍被 isolate 回收掐死，表现为轮询到 stale。
  **部署后第一件事就是跑一次完整 enrich，看是否走完全程。**
- site_config 里的 job 行清理逻辑（pruneExpiredJobs）没有真跑过。

## 2026-07-19（续10）— 后台任务改造（subagent 产出，已复核并部署）
**已部署：** `4af1d127-efeb-4c72-903e-53b53ec24603`
**方案：** server fn 立刻回 jobId → `ctx.waitUntil` 让重活活过响应 → 前端 3s 轮询。
ctx 只在 worker fetch 入口拿得到，用 AsyncLocalStorage 往下传（不能用模块级全局：
同 isolate 并发会串 ctx）。新文件：`worker-ctx.ts` / `background-jobs.ts` / `poll-job.ts`。
两条链路各拆成 `xxxPreflight`（前台快校验）+ `runXxxCore`（后台重活），
新增 `startEnrichDraftFn` / `startGoldDetailPageFn` / `pollJobFn`，
**删除旧导出 `enrichDraft` / `createGoldDetailPageFn`**。
**零 DB 迁移**：任务存 `site_config`（key `job:<uuid>`），沿用 plantnet_quota_state 的玩法，
建任务时顺手 prune 6 小时前的行。
**我复核时发现并修掉的部署阻断（重要）：**
subagent 说「tsc 干净 + build 通过」属实，但**构建通过 ≠ 能启动**。
`src/server.ts` 静态 import worker-ctx 后，Vite 把它整个**命名空间对象**并进入口 chunk
并重新导出 → 产物末尾 `export { server as default, renderErrorPage as r, workerCtx as w }`。
Cloudflare 校验 worker 每个导出，命名空间对象原型链止于 null 而非 Object →
部署被拒 **10021 `Exported value's prototype chain does not end in Object`**。
改成在 fetch 内**动态 import** worker-ctx，它就留在自己的 chunk 里，入口只剩合法导出。
**教训：worker 入口文件避免静态 import 会被其它 chunk 共享的模块。**
**测试：** 8 套 81 条断言全过（新增 jobs.test.ts 15 条）。注意 pool.test.ts 不打印汇总行，
用 grep "N passed" 会误判成 FAIL，实际 5 条全 PASS。
**仍未验证（关键）：** `ctx.waitUntil` 在真实 Workers 运行时是否真拿得到 ctx —— 
只用假 ctx 在测试里验过。已确认 wrangler main = dist/server/server.js 且 ctx 是标准
fetch 第三参，理论成立。**若 ctx 为 undefined 会静默退化成 fire-and-forget，
任务很可能被 isolate 回收掐死，表现为轮询到 stale「生成似乎已中断」。**
下一步：登录后跑一次完整「进一步生成草稿」，这是唯一的真验证。

## 2026-07-19（续11）— 三个症状的诊断（用户要求只诊断、不修）
### 症状 A：首页「近期更新 / 全部条目」出现英文标题 + 裂图条目 → **07-13 遗留，与今天无关**
证据（用 wrangler.jsonc 里的 publishable key 直接查线上 REST）：
- `Crystal Anthurium` / `Early Violet` / `Three-cornered Leek` 等行：
  `created_at = 2026-07-13T03:12`、`title` 是英文俗名、`scientific_name = ""`、
  `cover_url` 指向 `plant-images/drafts/...jpg` 但该 URL **HTTP 400**（图已不存在）。
- 与已知的 [[orphan-cleanup-image-loss]]（07-13 orphan 清理误删 draft 照片）完全吻合。
- **今天 plants 表零新增**（最新一条 07-17）→ 后台任务没有制造垃圾条目。
修复方向：这些行需要人工补 title/scientific_name，封面图不可恢复（需重新上传或置空走占位）。
### 症状 B：Log 里大量「新建条目 · ai_identify（条目已删除）· 前后为空」→ **设计如此，非 bug**
`src/lib/edits.ts:239` 把**每一条 plant_drafts 合成成一条虚拟「新建条目」**并硬编码
source=`ai_identify`。所以：「前后为空」是因为它是合成记录、本就没有 diff；
「条目已删除」= 那条草稿已被删/驳回。时间戳精确对得上今天的草稿
（DB 里 01:01:38Z / 00:18:00Z ＝ 用户看到的 09:01:38 / 08:18:00 CST）。
用户反复测试识别 → 每次建一条 draft → Log 就多一行。**要改的是这个 Log 的噪音策略**
（如过滤已删除的、或不把 draft 当「新建条目」），不是去查什么幽灵写入。
### 症状 C：进一步生成草稿「生成似乎已中断」→ **未能从外部确认**
`site_config` 对 anon 全表返回 `[]`（RLS 挡住），拿不到 `job:<uuid>` 行，
**无法判断 waitUntil 是否生效**。这正是「续10」标注的那个未验证地基。
下一个窗口应先做：`npx wrangler tail --format pretty` 然后触发一次生成，看日志里
① 有没有 `[worker-ctx] AsyncLocalStorage unavailable` 或 `waitUntil threw`
② 阶段是否推进过（setJobPhase）③ 是否在响应返回后就静默停止。
若 ctx 确实拿不到 → 改用 Durable Object 或 Cloudflare Queues，waitUntil 这条路走不通。
### 附带发现（待确认，可能是我引入的小瑕疵）
草稿卡三档标识用 `html_content 非空` 判定「银叶草稿」，但**一次性提交路径
（submitPlantDraft → buildDraftContent）也会写 html_content**，今天两条 pending 草稿
都已有 html。若如此，「快速简介」这一档几乎永远不会出现，判据需要换（例如另存标记位）。

## ✅ 2026-07-19（续12）— 「生成似乎已中断」真因找到并修复 + 首页两个症状清零

### 一、waitUntil 是清白的（续10/续11 一直没验的那块地基，现在验了）
写了个最小 worker（ALS + 动态 import + waitUntil，compat_date/nodejs_compat 与本项目
一致），用 `wrangler dev` 跑在**真 workerd** 上：`hasCtx:true`、`mode:"waitUntil"`，
且响应返回后 12 秒的后台 tick **全部跑完**。
→ **ctx.waitUntil 完全可用，不是根因。续11 里「若拿不到 ctx 就改 Durable Object /
Queues」的预案作废，别再往那个方向查。**

### 二、真因：存活判定误杀（不是任务死了，是前端把活人判死了）
`isJobStale` 靠 `updatedAt` 判存活，而 `updatedAt` **只在 setJobPhase 时才动**。
enrich 全程只有 4 次 onPhase，其中 `identify-plant.functions.ts:4050`「正在撰写完整
草稿正文」到 4090「正在保存草稿」之间是**一整个 `await buildDraftContent()`**。
换推理模型（Kimi K3 这类）后这一步跑 5 分钟以上是常态 → 超过 `JOB_STALE_MS = 5min`
→ 前端弹「生成似乎已中断」，**而后台任务其实还在正常跑、多半最后也跑完了**。
金叶链路同构（调研 1/3→2/3、撰稿 1/3→2/3 之间都是单个长 await）。

**修法：把「存活」和「阶段推进」彻底解耦。**
- `background-jobs.ts`：新增 `touchJob()`（只推 updatedAt，进终态即返回 false 停表）
  + `startJobHeartbeat(id)` 返回 `stop()`（自重排 setTimeout，不用 setInterval，
  避免写库慢时叠加并发写）。`JOB_HEARTBEAT_MS = 15s`；
  `JOB_STALE_MS` 5min **→ 2min**（有心跳后可以卡更紧，真死时报得更快）。
- 两条 keepAlive 里都 `startJobHeartbeat` → finally `stop()`。
  **终态写入前必须先停表**：否则晚到的心跳可能夹进 finishJob 的读-改-写中间把结果盖掉
  （touchJob 里也加了 `status !== "running"` 的二道闸）。
- `drafts.$id.tsx`：`forgetJob` 原来在判断结果**之前**就调 —— 客户端一放弃 jobId 就没了，
  「刷新接回」这张网恰好在最需要时失效。改成只在 `out.ok || out.reported` 时才 forget。
- enrich 的 loading toast 漏了 `duration: Infinity`（金叶有），长阶段里 toast 会自己消失，
  看起来就像「卡住了」。补上。
- poll-job.ts 两条放弃文案改写：超时那条改成引导「刷新本页会自动接回，别急着重试」。

**仍未实测：** 草稿页要登录，整条 UI 还是没在浏览器里跑过。心跳逻辑本身是纯函数级改动，
但「真机上一次完整 enrich 走完全程」依然是唯一的终极验证。部署后请跑一次。

### 三、首页英文标题 + 裂图 → 已彻底修好，线上已验证
续11 的诊断对了一半：确实是 07-13 [[orphan-cleanup-image-loss]] 的遗留，但**正确的
中文名和学名一直都在**——躺在各自 html 页面的 `<title>` 里
（`<title>晶状花烛 Anthurium crystallinum Linden & André — Plantspedia</title>`），
只有 `<h1>` 是英文俗名。当初那次批量导入取了 `<h1>` 当 title，学名则整个丢了。

用 `scratch/repair_english_title_rows.mjs`（dry-run 默认，`--apply` 才写；凭证从 .env
和 publish.py 现读，不新增副本；写前把原行 + 原 HTML 备份到
`scratch/_english_title_repair_backup/`）修了 5 条：
title→中文名、scientific_name→学名、原英文名存进 common_name_en（不丢信息）、
cover_url→null（原图不可恢复，走占位图；用户明确选了不引用 iNaturalist 图）。
正文 `<h1>` 也一并改成中文。
**⚠️ storage 坑：** `plant-html` 桶**不允许覆盖已有对象**（PUT 和 POST+x-upsert 都被
RLS 挡：`new row violates row-level security policy`），只放行「在自己 uid 目录下新建」。
app 里的 `persistPlantHtml` 就是这么干的 —— 传新文件 + 改 `html_url` 指过去。
脚本照办。**以后要改 Storage 里的 HTML，别想着覆盖，一律新建 + 重指。**

**线上验证（浏览器实跑 + REST 复查）：** 首页 broken image **0 张**、
英文标题 **0 个**，5 条全显示中文名 + PlantPattern 占位图，正文 `<h1>` 也已是中文。

**⚠️ 后续（同一会话内）：这 5 条已被用户手动从管理后台删除，plants 表 236 → 231 行。**
所以上面的数据修复现在是**历史记录，不是当前状态** —— 别再去查这 5 个 slug，它们不存在了。
（当时我发现行消失后排查过：我的脚本只有 PATCH/POST 没有 DELETE、wrangler.jsonc 无 cron、
`src/` 里唯一删除路径是 admin.index.tsx:114 的手动按钮；用户确认是自己删的。
顺带发现一个盲点：**直接走 REST 的批量改动不会进 plant_edits 审计日志**，
所以「修改记录」里查不到，排查时别指望它。）
原行 + 原 HTML 的备份仍在 `scratch/_english_title_repair_backup/`（要还原还能用，但已无必要）。

**真正长期有价值的是下面第四节的 SafeImg 改动** —— 它防的是「以后任何封面失效」，
跟这 5 条在不在没关系。

### 四、代码改动（首页 SafeImg）—— 需要部署才生效
`routes/index.tsx` 有 3 处裸 `<img>`（hero、全部条目网格、PlantCard），封面 4xx 时直接
裂图；同页别处早就用 SafeImg 了，`plants.index` / `search` 也是，首页是漏网的。
三处统一换成 SafeImg + PlantPattern 兜底。这是**防将来**：再有封面失效也只会显示占位图。
（顺带把 index.tsx 的 lint 报错从 51 降到 48 —— 长单行被拆开了。）

**未做（有意收窄范围）：** `editors.$id.tsx` / `profile.tsx` / `projects.$id.tsx`
还有 8 处裸 `<img>` 绑 cover_url/photo_url，同样会裂图。不在本次范围内。

### 五、✅ 已部署 —— Version ID `9e7ae599-8d68-4ae2-9a6a-7200915dccb2`
本次上线内容：① 后台任务心跳（本节核心修复）② 首页 3 处 SafeImg
③ **另一会话做的 identify.tsx「识别复核出卡AI三重奏」折叠栏**（用户点名要一起上）。
部署前查过产物入口导出只有 `default` + `r`，没有命名空间对象 —— 续10 那个 10021
「Exported value's prototype chain does not end in Object」的坑没有复现。
线上验证：`/` 与 `/identify` 均 200，首页 broken image 0 张、英文标题 0 个。

### 六、下一步
1. **登录后跑一次完整「进一步生成草稿」** —— 心跳修复的唯一真验证，还没做。
   要看的是：慢模型跑到第 5 分钟以上时，还会不会弹「生成似乎已中断」（不该弹了）。
2. 续11 记的两个附带问题仍未处理：edits.ts:239 把每条草稿合成成虚拟「新建条目」造成
   Log 噪音；草稿卡「银叶」判据用 html_content 非空，但一次性提交路径也写 html_content。
3. 已挂了一个后台任务 chip：editors/profile/projects 还有 8 处裸 `<img>` 绑
   cover_url/photo_url，同样会裂图（本次有意没动，收窄范围）。

## ✅ 2026-07-19（续13）— 出卡AI 控制台拆分 + 两个识别 bug（已部署，见文末版本号）

### 一、「出卡AI」独立成控制台，「AI 模型控制台」移出三重奏并降级为兜底
用户要求：三重奏折叠栏里不要放「管理员 · AI 模型控制台」，改放一个专门的「出卡AI」；
控制台移到折叠栏**外面下方**，只负责其它特定功能之外的杂项。

新增 console `card` → site_config key `card_model_config`，标签「出卡AI」。
`loadCardQueue()` **留空时回退 `loadAiQueue()`**（同 enrich 的兜底套路）——
所以上线那一刻出卡行为完全不变，零迁移、不需要先去填配置。
两条出卡链路都切过去了：`callAiIdentify`（queueKind 默认值 `"ai"` → `"card"`）
和快速出卡的 Gemini 专用链路。

**追踪结论 —— 拆分后「AI 模型控制台」到底还管什么**（当时逐个调用点查的）：
`loadAiQueue()` 原本有 4 个消费者，①`callAiIdentify` ②快速出卡 都归了「出卡AI」，剩下：
- **③ `extractPlantMetaFn`：批量导入条目时从 HTML 提取元数据**（管理后台「批量添加条目」
  的识别按钮）。Gemini 专用，把序列里所有 Gemini key 当轮换池用。**这是它唯一的实功能。**
- **④ 兜底**：「出卡AI」「草稿生成模型」留空时回退到它。
所以标题改成「管理员 · AI 模型控制台（兜底）」，面板说明里写明这两件事
+ 「建议始终配一套可用的通用 Gemini 序列、别清空」。

改动文件：identify-plant.functions.ts（CONSOLE_CONFIG_KEYS/LABELS、ConsoleIdSchema、
loadCardQueue、两条链路）、routes/identify.tsx（CardModelPanel 新增、AdminModelPanel
移出折叠栏并改文案）、components/model-queue-console.tsx（ConsoleId 类型同步）。

### 二、bug：没点「进一步生成草稿」却自动生成了 —— **换非 Gemini 模型后必现**
根因在 quickIdentifyDraft：`identifyQuick` 是 **Gemini 专用**链路，序列里没有 Gemini 项
就返回 null（用户改配 custom 模型后正是如此）→ 掉进 `else` 跑完整 `buildDraftContent`
→ `enriched = true`。于是草稿在用户没点按钮时就被完整生成，既莫名其妙又白烧长文的钱。
**修法：** `identifyQuick` 返回 null 时，改用「出卡AI」序列本身再识别一次
（`callAiIdentify(..., "card")`），**仍然只出摘要卡、enriched 保持 false**。
完整流水线降为最后兜底（前者抛错时才走）。

**顺带补的硬保证：** `forceResult`（补拍满 3 次必须出结论）是靠 identifyQuick 的 prompt
实现的，非 Gemini 兜底链路没有那段 prompt，模型也可能不听 → 用户会被困在补拍循环里。
现在在代码层直接兜：`retakeCount >= 3` 就清空 needs_more_photos_*，补拍关卡必然放行。

### 三、bug：疑似植物名称全变成「待鉴定植物」
两个原因叠加：
1. 草稿 `title` 那行 `(meta.title || meta.scientific_name || "待鉴定植物")`
   **从来没加过「疑似」前缀**；
2. prompt 在不同链路上的约定**互相矛盾**（`:1588` 要求「title 给最可能物种、只在 summary
   标疑似」，`:802` 却要求「title 前面加疑似」），模型不确定时干脆不给 title → 落兜底。

**修法：** 新建 `src/lib/tentative.ts`（纯函数、可独立测试），三个导出：
`isTentative()`（疑似的**唯一**判据：confidence=low **或** summary_zh 以疑似开头 ——
模型两种表达都用）、`stripTentativePrefix()`、`draftTitleFor()`（先剥后加，
拼出「疑似X」；连学名都没有才退回「待鉴定植物」）。
`normalizeIdentification` / 草稿标题 / 摘要卡 tentative 三处**共用同一判据**，不会再分叉。
已确认全站没有第二处加「疑似」前缀会导致「疑似疑似X」：
drafts.$id.tsx:814 和 buildSummaryCardHtml 都是先剥后加。

**测试：** `scratch/tentative.test.mjs` 15 条断言全过，**直接跑 src/lib/tentative.ts 本体**
（`node --experimental-strip-types scratch/tentative.test.mjs`），不是跑副本。
覆盖：疑似X 拼接、只有学名、啥都没有、高置信不加前缀、不重复加前缀（含括号形式）、
summary 表达疑似时标题跟着标、summary 中间出现「疑似」不误判。

### 四、验证边界（重要，别当成已验证）
- 识别链路要**模型调用 + 登录**才跑得起来，`tsc=0` + `build` 通过 + 上面 15 条纯函数测试
  是本次能拿到的全部证据。**两个 bug 的真实修复效果需要实拍一次才算数。**
- 管理员面板同理，「出卡AI」面板长什么样、排版对不对，需要登录看。

## 🔴 2026-07-20（续14）— 实测：生产环境 waitUntil **约 26 秒就被掐**，长任务方案必须重做

### 结论（已用生产探针实测，不是推断）
部署了一次性探针 `/__wu-probe`（`src/lib/waituntil-probe.ts`，走的正是 enrich 用的
keepAlive/ALS 链路），它只做一件事：每 5 秒往 site_config 写一个时间戳面包屑，共 3 分钟。

```
hasCtx: true    hasWaitUntil: true
面包屑(秒): [5, 10, 15, 21, 26]   ← 然后再无输出，此后 200 秒一动不动
```

**ctx.waitUntil 拿得到，但 Cloudflare 在约 26 秒时终止后台任务。**
探针里没有模型调用、没有任何可能抛错的东西 —— 它就是 sleep + 写库，所以
「任务抛错了只是 failJob 没写进去」这个替代解释被**彻底排除**。

与 07-19 两次 enrich 实况完全吻合：两次都在**第 21 秒**停摆、都停在「撰写正文」
（progress 45）、status 始终 running、对应时段 ai_usage_logs 一条都没有。

### ⚠️ 纠正续12 的错误结论
续12 写着「waitUntil 机制在真 workerd 里完全成立」——**那个结论是错的**。
当时用 `wrangler dev --local`（miniflare）验了 12 秒的后台任务能跑完就下了定论。
**miniflare 不执行生产环境的 waitUntil 限制**，本地能跑完 ≠ 线上能跑完。
教训：涉及平台运行时限制的验证，本地模拟器不作数，必须在生产实测。

### 这意味着什么
**任何单次超过约 26 秒的模型调用都不可能在 waitUntil 里跑完。**
Kimi K3 撰稿一次远不止 26 秒 → 换模型、换 key、调心跳阈值都救不了。
心跳机制本身是对的（它把过去的 5 分钟误杀换成了准确的死亡报告），它只是报信的。

顺带一提：**改造成后台任务前，enrich 跑在前台请求里反而有 100 秒预算**（边缘响应上限），
比 waitUntil 的 26 秒还多。所以对于 26–100 秒之间的任务，续10 的后台化改造是退步。
真正需要解决的是 >100 秒的情况。

### 下一步（未决，等用户定方向）
候选：Cloudflare Workflows（专为可持久多步长任务设计）/ Durable Object + alarm /
Queues（消费者有 15 分钟，但要 Workers Paid）。
**动手前必须先查 Cloudflare 官方文档确认各自的真实时限，别凭记忆做架构决策**
（仓库里有 `cloudflare` 和 `agents-sdk` 两个 skill，它们倾向从官方文档检索）。

### 🧹 欠账：探针必须删掉
`src/lib/waituntil-probe.ts` + `src/server.ts` 里 `/__wu-probe` 的路由分支，
**量完就该删**，下次部署时一并清掉。已部署版本 `356d5143`。

### 同批部署的另一项：429 文案修复（已上线）
`isDailyQuota` 只匹配 `/PerDay/`，而 Google 的 **token 配额** quotaId 同样含 PerDay
（形如 `...InputTokensPerModelPerDay`）→ token 打满被一律报成「每日免费**请求**额度用尽」，
管理员去用量后台看请求数才个位数，完全对不上（用户 07-19 就是这么被误导的）。
新增 `quotaDimension()` 按 quotaId 判断是 **token 数 / 请求数**、**每日 / 每分钟**，
文案照实说，并把 Google 原始 `quotaId` 附在错误里。

### 同批的配置改动（DB，已生效，不需部署）
`card_model_config`（出卡AI）原本只有 gemini-3-flash-preview 一项、**没有备胎**，
Gemini 一 429 出卡就整个失败。用 `scratch/add_card_fallback.mjs` 把 ai_model_config 里
已跑通的 `custom / deepseek-v4-flash` 原样复制为序列 2，回读校验通过。
原值备份在 `scratch/_card_model_config.backup.*.json`。

## 2026-07-20（续15）— 官方限制查证 + 模型实测 + 定方案 Queues

### 官方坐实：waitUntil 就是 30 秒
> `waitUntil() can extend execution for up to 30 seconds after the response is sent or the client disconnects.`
> —— https://developers.cloudflare.com/workers/platform/limits/
实测 26 秒与之吻合。**续10 的 waitUntil 后台化方向从一开始就不成立**，不是配置问题。

各方案挂钟上限（均已查官方文档）：
| 载体 | 挂钟 | CPU | 免费版 |
|---|---|---|---|
| waitUntil | **30s** | 随请求 | — |
| HTTP 请求（客户端连着） | 不限 | 同上 | — |
| Queues consumer | **15 分钟** | 30s（可配 5min） | 文档未要求付费 |
| DO alarm | **15 分钟** | 同上 | 仅 SQLite 版 |
| Workflows 单步 | **不限**（等网络 I/O 时） | 同上 | 100 并发/1024 步 |
免费版 CPU 仅 10ms、子请求仅 50 —— 本项目识别要 base64 整图、金叶要打十几次外部请求，
**几乎可以确定账号是 Workers Paid**（`wrangler whoami` 不显示套餐，需 Dashboard 确认）。

### ⚠️ 严重：我加的出卡备胎是纯文本模型，会让 AI 凭空编造
`deepseek-v4-flash` 带图调用**返回 HTTP 200 但 prompt_tokens 只有 26**（图片零 token），
模型自述「您没有提供图片」。也就是说 Gemini 一 429 顶到它，出卡会**编一个物种出来，还不报错**。
已改成 `qwen3.5-omni-flash`（实测 image_tokens=1249，确实读图）。
**`ai_model_config` 序列 3 也是 deepseek-v4-flash，同样看不见图，仍待处理。**
教训：给视觉链路配备胎必须**带图实测**，只测纯文本会漏掉这类静默失败。

### 阿里云端点上实测可用的视觉模型（用站上真实照片测）
qwen3.5-omni-flash 1362ms / qwen3.5-omni-plus 1387ms / qwen3-omni-flash 1639ms /
qwen-vl-max 2132ms / qwen-vl-plus 2375ms / qwen3-vl-plus 2877ms。
不可用：qwen3-vl-flash-2026-01-22、qwen3-vl-plus-2025-12-19（403 免费额度耗尽）。
**注意：6 个模型对测试图（科马罗夫白前）全部答错，都答成兰花类** —— 裸测定种能力弱，
实际链路靠 Pl@ntNet 定种、它们只负责写卡，但别指望它们单独扛定种。

### 各控制台模型实测状态（scratch/test_all_model_slots.mjs）
出卡AI ✅✅ / AI 控制台 ✅❌(429)✅ / **草稿生成 ❌❌（Kimi 未开通、glm-5.2 连不上）** /
疑似复核 ❌(403 免费额度耗尽) / 小P蛙 ❌(连不上)✅
**草稿生成两项全坏 —— 就算 Queues 做完，没有可用模型照样跑不起来。**

### 已定方案：Queues（用户 2026-07-20 选定）
理由：现有 UI 已按「任务活在服务端、刷新可接回」设计，Queues 保住这个特性；
`runEnrichCore` 原样复用，只换「谁来跑」。15 分钟对 3–10 分钟的活够用。
关键简化：`import { env } from "cloudflare:workers"` 可在请求上下文里直接拿绑定，
**不需要扩展 ALS**（但本地 vite dev 没有 workerd，该 import 要做降级保护）。
详细改法见下一条记录。

### 本轮已部署
`1ae01a79` —— 探针删除 + shouldFailOver 按错误内容判断 400 是否顺位（15 条测试全过，
scratch/failover.test.mjs）+ 此前的 429 文案修复。

## ✅ 2026-07-20（续16）— 方案定稿：物种资料包重构 + 金叶创作指导 Skill（CP1 已完成）

### 用户拍板的总方案（替代此前的逐次生成架构）
核心：**把「查资料 + 找图 + 撰稿」从「某用户点了某按钮」上解绑**，做成按物种
（GBIF taxonKey）缓存的**「物种资料包」**；草稿页与金叶详页都只是资料包的两种渲染。
两条决策已确认（用户同意按我的倾向）：
1. 资料包 AI 生成后标 `unverified` 照常复用；管理员改过一次 → 升级 `curated`，
   此后 **AI 不得覆写**。（全人工审核会卡死，全自动会让一个错扩散全站。）
2. 金叶详页 = 资料包 + 额外深度调研，且产出**回写**资料包并升级为 curated。
   花金叶的人在给全站做贡献，站方不为同一物种付两次深度调研的钱。

### 落地顺序（按「先拿收益、后拿难度」）
| # | 内容 | 收益 | 状态 |
|---|---|---|---|
| 0 | **金叶创作指导 Skill 可配置 + 版本署页尾**（用户本轮追加） | 换写作章法不用改代码 | ✅ 本轮完成 |
| 1 | 视觉模型准入检测（带图实测 image_tokens>0 才准进视觉序列） | 堵住「顶替模型编造物种还不报错」 | 待做 |
| 2 | `species_dossiers` 表 + 命中即拼装 | **多数请求 3–10 分钟 → 2 秒**；超时问题降级为「只有首次」 | 待做 |
| 3 | 图片视觉验证 + 按器官标签入槽 + 署名/许可证 | 「叶花果生境」真正成立；顺带修 CC-BY-NC 未署名的版权敞口 | 待做 |
| 4 | 首次生成走 Queues，分步可断点续跑 | 冷启动那次也稳 | 待做 |
| 5 | 撰稿看得见图 + 落库前质量闸门（过了才扣叶） | 内容质量 + 扣费公平 | 待做 |

**第 2 步是关键**：它让「长任务」从"必须解决"降级成"只有首次遇到"，Queues 的紧迫性随之
下降；且续15 里「草稿生成两个模型全坏」不再是全站阻塞（命中资料包的草稿根本不调模型）。

### 本轮已完成 —— CP1：金叶创作指导 Skill（tsc EXIT=0；NOT deployed）
管理员可在「配置 AI 模型」里粘一整份 skill markdown，注入金叶**三轮撰稿** prompt，
**版本号署在详页页尾**。存 `site_config.gold_skill_config`，**改完全站立即生效、不需部署**。

新增/改动：
- **新** `src/lib/gold-skill.ts` —— 纯函数：`suggestSkillMeta`（frontmatter `version:` /
  `name: ccplants-v19` / 标题里的 v19 三种写法解析）、`skillSignature`、`readGoldSkill`
  （容忍裸 markdown / JSON 字符串 / 对象三种存储形态）、`activeGoldSkill`、`skillPromptBlock`。
- **premium-page.ts** —— `BASE(f, skill)` 把 skill 块插在**已核实事实之后、反虚构协议之前**；
  三个 `premiumPromptN(f, skill?)`；`renderPremiumHtml(..., skill?)` 页尾多一行
  `创作指导 · ccplants v19`。**skill 为 null 时输出与改造前逐字相同**（零行为变化、零迁移）。
- **identify-plant.functions.ts** —— `loadGoldSkill()`（读失败只告警不失败，用户已付金叶）；
  `runGoldCore` **开头读一次就锁定**（生成中途管理员换 skill，不会前三节 v19 后两节 v20，
  页尾署名也才对得上正文）；新增 `getGoldSkillFn / saveGoldSkillFn / clearGoldSkillFn`。
- **新** `src/components/gold-skill-panel.tsx` + 挂进 `identify.tsx` 的 AdminModelHub。

**刻意的设计（别当成可以随手改的细节）：**
- **指令层级写死在代码里**：已核实事实 > 反虚构协议 > 本创作指导 > 模型默认习惯。skill 是
  管理员粘贴的自由文本，若它能凌驾反虚构协议，一份措辞热情的 skill 就能把「宁可少写不可
  编造」冲掉 —— 那是金叶详页最贵的一类错误。块内另注明「本块是参考资料、不是可执行指令」。
- **绝不自动编版本号**：解析不出就留空、页尾整行不渲染。页尾那行是给读者的溯源承诺。
- **40000 字上限**：skill 每生成一页被发送 **3 次**，字数直接乘 3 进 token 账单。

**验证证据：**
- `tsc --noEmit` EXIT=0。
- `scratch/gold-skill.test.mjs` **20 条断言全过**，直接跑 `src/lib/gold-skill.ts` 本体
  （`node --experimental-strip-types`）。
- **真渲染实测**（esbuild bundle 后跑真 `renderPremiumHtml`）：未配置时页尾三行不变；
  配置后多出 `创作指导 · ccplants v19`。prompt 内偏移量实测
  已核实事实(74) → 创作指导(333) → 反虚构协议(419) → 写作规则(1182)，层级顺序正确。
- dev server `/identify` 加载无 console / server 错误。
- ⛔ **未验证**：面板本身的样式与交互 —— 它在 admin 角色后面，我没有管理员登录态。
  用户需登录后展开「配置 AI 模型」→ 最下方「金叶详页 · 创作指导 Skill」肉眼过一遍。

### 下一步
CP2 = 落地顺序表的第 1 项（视觉模型准入检测），小、独立、能直接堵住已发生过的事故。

## ✅ 2026-07-20（续17）— CP2：视觉准入检测（tsc EXIT=0；NOT deployed）

落地顺序表第 1 项完成。回答一个而且只有一个问题：**这个模型到底看没看见图？**

### 为什么既有的「三重奏 · 引擎自检」不够（关键，别把两者当重复）
既有自检问的是「这个模型**认不认得出**这株植物」——判据是「有没有给出定种结论」。
**一个凭空编造的结论会让它判 PASS**，正好对续15 那类事故失灵；而且它只测当前生效的
那一项，测不到整条序列。新检测问的是「**读不读得到像素**」，逐项测，判据客观。

### 判据：两条独立证据，都过才 PASS
1. **内容证据** —— 一张 256×256 四象限纯色图（左上红/右上蓝/左下黄/右下绿，846 字节，
   base64 内联在 `src/lib/vision-probe.ts`），要求**按顺序**报出四个颜色。顺序必须对：
   只数出现次数会退化成考词汇量。瞎猜四个颜色还要顺序全对，概率极低。
   （PNG 是手搓的：zlib deflate + CRC32，生成脚本在 scratchpad/mkpng.mjs，无外部依赖。
   用**自制图**而非站内植物照，是为了把"读像素"与"懂植物"解耦。）
2. **Token 证据** —— 同一段提示词再发一次**不带图**的，比 prompt_tokens。真读图的模型
   会多出成百上千；deepseek-v4-flash 那次差值≈0（26 vs 24）。

**三个刻意的判定规则：**
- **`unknown` 是一等公民**：429 / 网络错误 / 厂商不回 usage 一律 unknown，**且不写库** ——
  记成 blind 会让运行时永久跳过一个其实好好的项，比不检测更糟；写库还会覆盖上一次的
  有效结论。
- **两条证据打架时保守判 blind**：宁可少用一个模型，也不能让编造的识别卡发出去。
- **结论绑在具体 model ID 上**（`visionOf`）：管理员改了模型没重测，旧的 pass 立即失效，
  否则这套机制会变成事故的帮凶。保存时也会丢弃对不上的结论（`writeModelQueue`）。

### 运行时强制（这才是真正的保护，不是只给管理员看个徽章）
`runModelQueue(..., { requireVision: true })` 在跑之前剔除**已测出 blind** 的项。
**只跳过明确 blind 的；没测过的照跑不误** —— 否则上线当天就把所有序列清空了。
全部被剔除时抛一条说清原委的错，而不是静默失败。

接上的四条视觉链路：`callAiIdentify`（出卡 + 草稿生成）、`identifyQuick`（快速出卡）、
`xiaopTextCall`（**仅当本次真带了图**，纯文本提问不设限）、`withSecondOpinionSlots`
（疑似复核，它有自己的循环，单独加的过滤）。

### 改动文件
- **新** `src/lib/vision-probe.ts` —— 测试图常量 + `gradeVisionAnswer` / `judgeVisionProbe`
  / `visionBadge`（纯函数，不发请求，可直接跑测试）。
- `src/lib/model-queue.ts` —— `SlotVision` 类型、`ModelSlot.vision?`、`visionOf`、
  `isKnownBlind`，read/write 往返保存结论。
- `src/lib/identify-plant.functions.ts` —— `runModelQueue` 的 `requireVision`、四条链路接上、
  `probeSlotVisionFn`（发两次请求 + 判卷 + 写回该序列项）。
- `src/components/model-queue-console.tsx` —— `VisionProbeRow`（每项一个徽章 + 「视觉自检」
  按钮 + 说明），由新 prop `visionProbe` 开启。
- `identify.tsx` / `xiaop-model-panel.tsx` —— 五个控制台全部开启（徽章是信息，强制只发生
  在视觉链路上）。

### 验证证据
- `tsc --noEmit` EXIT=0。
- `scratch/vision-probe.test.mjs` **26 条断言全过**，直接跑 vision-probe.ts + model-queue.ts
  本体。含**用真实事故数据复现**（prompt_tokens=26 + 「您没有提供图片」→ 判 blind）、
  429→unknown、换模型使旧结论失效、老配置无 vision 字段不报错、PNG 魔数校验。
- dev server `/identify` 加载无 console / server 错误。
- ⛔ **未验证**：面板 UI（admin 角色后面，无管理员登录态）；**「视觉自检」按钮点下去的
  真实往返也没跑过** —— 它要真 key。用户登录后对每条序列点一次即可，
  预期：qwen3.5-omni-flash → pass，deepseek-v4-flash → blind。

### 顺带解决的历史欠账
续15 记的「`ai_model_config` 序列 3 也是 deepseek-v4-flash，仍待处理」——
现在不用手工改：对它点一次「视觉自检」，测出 blind 后运行时会自动跳过。

### 下一步
CP3 = 落地顺序表第 2 项：`species_dossiers` 表 + 命中即拼装。**这是整个方案的关键一步**
（多数请求 3–10 分钟 → 2 秒）。需要一次 Supabase 迁移，按惯例由用户在 dashboard 执行。

## ✅ 2026-07-20（续18）— CP3：物种资料包 species_dossiers（tsc EXIT=0；⚠️ 迁移待应用）

落地顺序表第 2 项 —— **整个方案的关键一步**。同一物种的内容**只写一次、全站复用**。

### 内容分两类（这是整套设计的轴心）
- **物种级**（通用）：词源 / 形态 / 生境 / 人文 / 养护 / 标签 / IUCN —— 同一物种人人一样。
- **照片级**（个人）：拍摄记录、拍摄地点/时间、照片本身、**置信度、补拍建议**。
资料包只存前者；草稿 = 资料包 + 后者。清单写死在 `PHOTO_SPECIFIC_FIELDS`，
**新增 AiMeta 字段时必须回来判断它归哪一类**（漏一个 = 甲的信息串进乙的草稿）。

### 顺带修掉一个真实存在的串味 bug
旧的「扫最近 50 条草稿」复用路径只覆盖了 field_notes，**把来源草稿的
`identification_confidence` 和 `needs_more_photos_*` 一并继承了过来** ——
甲那张糊照的「疑似 + 请补拍花的特写」会原样出现在乙的清晰照草稿上，补拍关卡因此失效。
现在两条复用路径都走 `assembleDraftMeta`，先剥光照片级字段再合并。测试里有专门一条。

### 审核模型（用户拍板，已落进代码）
`unverified` = AI 生成、照常全站复用；管理员改过 → `curated` → **AI 永不覆写**
（`shouldOverwriteDossier`）。另加一条：**退化产出不许覆盖好资料包** —— 新内容缺长正文
（morphology_zh / habitat_zh）就整个不写，免得一次截断把好资料包换成坏的。

### 读写接法
- **读**：`buildDraftContent` 的复用分支，查两层 —— ① species_dossiers ②旧的扫草稿启发式
  （过渡期兜底，资料包铺开后可删②）。命中 → 只调一次小模型写拍摄记录 → 2 秒出稿。
- **写**：`runEnrichCore` 生成成功后 `void upsertDossier(...)`，**非致命**（内容已经给到
  用户了，缓存没存上不该让他白等）。
- **未接**：quickIdentifyDraft 的完整流水线兜底路径目前只读不写。留给后续，先小步。

### ⚠️ 用户必须做的一件事：应用迁移
`supabase/migrations/20260720120000_species_dossiers.sql` —— 按惯例在 Supabase dashboard
执行（本项目无本地 CLI）。表开 RLS 且**不建 policy** = 只有 service-role 能读写。

**迁移没应用也不会坏**：`loadDossier` 把「表不存在」当成「没有资料包」，降级到旧路径，
行为与改造前一致。已用只读探针 `scratch/check_dossier_table.mjs` 实测确认当前
返回 `PGRST205 Could not find the table` —— 也就是说这条降级路径是**跑过的**，
可以先部署代码、再补迁移。

### 验证证据
- `tsc --noEmit` EXIT=0。
- `scratch/species-dossier.test.mjs` **16 条断言全过**（需先 esbuild bundle，跑法写在文件
  头部；bundle 只替 node 解析 import，跑的仍是本体）。含照片级字段泄漏、phase-1 摘要卡
  不得当资料包、curated 保护、退化产出保护。
- dev server `/identify` 加载无 console / server 错误。
- 只读探针确认表尚未建立 → 降级路径实测生效。
- ⛔ **未验证**：命中/写入的真实往返 —— 要迁移应用 + 一次真实识别。
  用户应用迁移后，连着识别同一物种两次：第一次慢（完整生成），第二次应当在几秒内出稿，
  服务端日志出现 `[Dossier] 命中「…」`。

### 下一步
CP4 = 落地顺序表第 3 项：图片视觉验证 + 按器官标签入槽 + 署名/许可证。
这一步直接兑现用户最初的诉求「配图能展示叶、花、果、生境」，
并顺带修掉 CC-BY-NC 图片未署名的版权敞口。资料包的 `images` 字段就是给它准备的。

## ✅ 2026-07-20（续19）— CP4a：配图许可与署名（tsc EXIT=0；NOT deployed）

落地顺序表第 3 项的前半。**先修版权，再谈器官**——因为两者共用同一条数据管道，
而版权是正在发生的实际风险。

### 🔴 实测发现：线上有四到五成配图是「保留所有权利」
2026-07-20 用真实 API 量的（`scratch/species-photos.test.mjs` 头部记了取样来源）：

| 物种 | 可复用许可 | **带器官标注** |
|---|---|---|
| 沙冬青 | 12/20 | **1/20** |
| 柠条锦鸡儿 | 18/40 | 4/40 |
| 玫瑰 | 31/40 | 10/40 |
| 蒲公英 | 31/40 | 4/40 |

iNat 用 **`license_code: null` 表示「保留所有权利」**，旧代码把它和其它许可一视同仁，
`rehostImages` 转存进我们自己的 bucket、页面上不署名。这不是"少写一行 credit"，
是实打实的侵权敞口。右列同时证明：**靠 iNat 器官标注撑不起「叶花果生境」**（最低 5%），
CP4b 的视觉验证不是镀金，是必需。

### 改法
- **新** `src/lib/species-photos.ts` —— `PhotoCandidate` 类型 + 许可归一化 / 准入 / 署名串。
  纯函数无依赖。
  - **`null` / 空 / 未知一律拒收**（把未知当可用正是问题根源）。
  - **ND（禁止演绎）也拒收** —— `rehostImages` 会缩到 1280px 转 WebP，那是演绎行为。
  - Commons 给的是带版本号的 `cc-by-sa-4.0`，**必须裁掉版本号**否则全被误杀（有测试）。
- `fetchSpeciesPhotos` 重写：返回**带许可与署名的候选**而非裸 URL；四级数据源
  （iNat / GBIF / Commons / 标本图版）每级都先过许可闸门再进多样性挑选；
  Commons 请求加 `extmetadata` 才拿得到 License/Artist。被拦下的张数**打日志**——
  否则"图变少了"会变成查不出原因的玄学问题。
- `rehostImages(cands, prefix)` 现在收发都是候选对象：**转存只换 url，署名字段原样保留**
  （图进了我们的 bucket 并不改变著作权归属）。
- 两套模板都渲染署名条：`premium-page.ts` 的 `slot()` 改为 `<figure>` + `<figcaption>`；
  `plant-html-template.ts` 每张分区图后加 `{{sec_img_N_credit}}`。
  **用户自己的 hero 照片不署第三方名**（有断言）。

### 两个只有真看了才会发现的版式 bug（都已修）
1. **CSS 特异性**：`.img-credit`（0,1,0）被 `.section-body p`（0,1,1）盖住，字号变成 16px。
   改用 `.section-body p.img-credit`。
2. **grid 布局**：`<p>` 成了 `.section-with-img` 的**独立 grid 子项**，被自动布局丢到
   隔壁格子（实测 alignedToImg=false）。改成 `<figure class="sec-figure">` 把
   「图 + 署名」包成一个子项。`draft-enhance.ts` 的 `img.sec-img` 选择器不受影响（已查）。
   ⚠️ 顺带记一条：模板 CSS 在 TS 模板字符串里，**注释里不能出现反引号**，会截断字符串。

### 验证证据
- `tsc --noEmit` EXIT=0。
- `scratch/species-photos.test.mjs` **19 条断言全过**（许可字符串全部取自真实 API 响应）。
- **真实数据端到端**：抓真的 iNat（沙冬青 20 张）→ 过闸门 → 渲染两套模板，实测
  「可用 12 / 拦下 8」；**8 张保留所有权利的图 URL 一张都没出现在两个页面里**；
  署名条可点回原始观测页；hero 图未被安上第三方署名。
- **浏览器实测版式**（DOM 量的，不是看截图）：5 条署名 11px、居中对齐于图片、
  距图 8px、不超出图宽；375px 移动端无横向溢出。
  （⛔ 截图管线在本环境拍出来是空白页，DOM 测量与之矛盾；以 DOM 数据为准。）

### 下一步
CP4b = 视觉验证器官 + 按标签入槽 + 缺失器官如实标注「暂无花期照片」。
数据管道已经铺好（`PhotoCandidate.organ` 字段就位），只差那次视觉调用与分槽逻辑。

### 续19 补记 —— lint 状态
新增/改动的 9 个文件跑 eslint：prettier 类已全部 `--fix`，`no-useless-escape` 已修，
只剩 **5 处 `no-explicit-any`**，全是 `(supabaseAdmin as any)` —— `site_config` 与
`species_dossiers` 都不在 Supabase 生成的 types.ts 里，与全仓既有做法一致
（identify-plant.functions.ts 一个文件就有 91 处同类）。**刻意保留**。
（`npm run lint` 全仓 59673 个问题，绝大多数是 supabase/functions 下的历史欠账，与本轮无关。）

四套纯函数测试全绿回归：gold-skill 20 / vision-probe 26 / species-photos 19 /
species-dossier 16 / tentative 15。

## ✅ 2026-07-20（续20）— CP4b：按器官入槽（tsc EXIT=0；NOT deployed）

**这一步兑现的正是用户最初那句诉求：「配图能展示植物的叶、花、果、生境特征」。**
改造前是**按位置**填（`sec_img_1..5` 顺序塞进固定小节），没有任何机制保证第 2 张真是花。

### 三段式
1. **视觉模型现看现标**（`classifyPhotoOrgans`）—— 一次调用看最多 14 张缩略图，
   每张返回 `{organ, usable, caption_zh}`。为什么不能靠数据源标注：续19 实测覆盖率
   最低只有 5%（沙冬青 1/20）。
2. **按标签入槽**（`photo-slots.ts` 的 `assignSlots`）。
3. **缺了就如实说**，不塞随机图。

### 四条刻意的规则
- **在转存之前分类**。用数据源小图（iNat `/large.`→`/medium.`）判器官，
  只有中选的图才进 `rehostImages` —— 省带宽、省 Supabase 存储、不为丢弃的图付转存成本。
- **分两轮分配**：第一轮只认首选器官（保证叶槽拿叶、花槽拿花），第二轮才降级。
  否则一个 want 靠前的槽会把后面槽**唯一的那张花**吃掉（有测试专门盯这条）。
- **绝不拿 want 之外的图填槽**。只有叶子时，花槽必须留空并写「暂无该物种的花期公开照片」。
  一张标着「花」的叶子特写，比一个空位对读者伤害大得多。
- **模型判不准就置空**（`normalizeOrgan` 把 other/乱码归 `""`），空器官不被任何槽命中
  = 自动弃用。猜一个器官比留空危险。
- 整条链路**非致命**：分类失败原样退回数据源标注，绝不连累出稿。

### 又抓到三个只有真看了才会发现的问题
1. **`<figure>` 的 UA 默认 `margin:1em 40px`** —— 我把 `<div class="img-slot">` 换成
   `<figure>` 时引入的，叠上 `width:100%` 把金叶详页撑出横向滚动条
   （实测 scrollWidth 786 > clientWidth 762）。加 `margin:0` 修掉。
2. **稀有种会一次缺六个槽**，全按 4:3 撑开 = 六个 548px 的大空洞。新增 `.no-organ`
   修饰类（虚线瘦条，实测 548px → 64px），与「图加载失败」的 4:3 占位区分开。
3. **`<img src="">` 在部分浏览器会被解析成「重新请求当前页」**，光靠 CSS 隐藏管不住。
   缺图时同时给 `hidden` 属性。
⚠️ **我在这一轮又犯了一次上一轮刚记过的错**：模板 CSS 在 TS 模板字符串里，
注释里写了反引号 → 直接截断字符串、esbuild 报 `Expected ";"`。**下次改这两个模板前先看这条。**

### 验证证据
- `tsc --noEmit` EXIT=0；六套纯函数测试全绿：gold-skill 20 / vision-probe 26 /
  species-photos 19 / **photo-slots 14** / species-dossier 16 / tentative 15。
- **稀有种场景实测**（只有 2 张叶 + 1 张植株，没有花果）：
  金叶 9 槽 → 3 个有图（1 个降级命中）、6 个空槽各自写明缺什么；
  草稿 5 槽 → 3 有图 2 空。逐槽核对 `feat-4/5/6` **完全没有 `<img>` 标签**，
  只有「暂无该物种的花期/果实/花果期公开照片」。
- **浏览器 DOM 实测**：空槽 64px 虚线条；桌面 762px 与移动 375px 均
  `scrollWidth === clientWidth`（无横向溢出）；有图的槽署名 10–11px 正常。
- lint：本轮 9 个文件已全部清干净（`--fix` + 手工修 `no-explicit-any`）。
  identify-plant.functions.ts 里剩的 3 处 `no-unused-expressions` 在用量统计聚合那段，
  **是既有代码，与本轮无关**（已核对行号）。
- ⛔ **未验证**：`classifyPhotoOrgans` 的真实模型往返 —— 要真 key。
  上线后看服务端日志 `[PhotoOrgans]` 与 `[PhotoSlots]` 两行即可确认：
  前者报器官分布，后者报「N/9 槽有图…缺：…」。

### 落地顺序表状态
0 skill ✅ / 1 视觉准入 ✅ / 2 资料包 ✅ / 3 配图许可+器官 ✅ / **4 Queues 待做** /
**5 撰稿看图 + 质量闸门 待做**。

## ✅ 2026-07-20（续21）— CP5 Queues + CP6 撰稿看图与质量闸门（tsc/build EXIT=0；NOT deployed）

落地顺序表的最后两项。**⚠️ 队列已在 Cloudflare 账号里建好，但代码还没部署。**

### CP5：长任务真正搬上 Queues

#### 官方文档查证结果（推翻了续15 的一个猜测）
| 项 | 值 | 来源 |
|---|---|---|
| **是否需要 Workers Paid** | **不需要** | limits 页：限制对 Paid/Free 同样适用，**只有消息保留期不同**（免费 24h 不可配，付费可配到 14 天） |
| 消费者挂钟 | **15 分钟**/次调用 | 同上 |
| 消息大小 | 128 KB | 同上 |
| max_retries | 最多 100 | 同上 |
| handler 签名 | `async queue(batch: MessageBatch<Body>, env, ctx)` | javascript-apis 页 |

续15 写的「几乎可以确定账号是 Workers Paid（否则用不了 Queues）」是**错的** —— Queues 免费版就能用。

#### 改动
- **`src/lib/job-queue.ts`（新）** —— `enqueueJob(jobId)` / `parseJobMessage(body)`。
  **消息里只放 jobId**：真实入参（email、金叶那条链路的「用户自带模型配置」，含 API Key）
  存 site_config 的任务行。理由有二：① 队列消息在 CF 侧最长留存 24 小时，不该拿它存密钥；
  ② 消息永远远小于 128KB，不可能被 draft 撑爆。
- **`worker-ctx.ts`** —— Store 增加 `env`，新增 `currentEnv()`。server fn 靠它拿 producer 绑定。
  顺手**修掉一段被续14 推翻的过时注释**（原文说 waitUntil 不受 100s 响应上限约束，
  实际它自己只有 30s）。
- **`server.ts`** —— 默认导出加 `queue()` 消费者。**每条消息单独 ack**，一批里某个失败
  不连累同批已完成的（那正是「扣两次叶子」的成因）。失败**不 retry**：生成失败已写进
  任务行且已烧过 token，重投只会再烧一遍。脏消息直接 ack 丢弃，避免无限重投。
- **`identify-plant.functions.ts`** —— 新增 `runQueuedJob(jobId)`，**队列消费者与
  waitUntil 退路共用的唯一入口**。两个 start server fn 改成「建任务 → 入队；
  入队失败才退回 keepAlive」。
- **`wrangler.jsonc`** —— producer 绑定 `PLANT_JOBS` + consumer（`max_batch_size:1`，
  每个任务本身几分钟，攒批只会让先到的干等；`max_retries:1` + DLQ）。
- **`background-jobs.ts`** —— JobRecord 增加 `payload`。

#### 两条刻意的设计
- **幂等**：Queues 是至少一次语义，可能重投。`runQueuedJob` 开头检查
  `job.status !== "running"` 就直接返回 —— 否则一次重投 = 用户被扣两次叶子 + 多一个重复页面。
- **消费者重跑 preflight**：消息里没有 `pre` 对象，而且重跑本身是好事 —— 投递可能延迟，
  草稿状态与叶子余额都可能变了，拿陈旧快照去扣费才危险。server fn 里那次 preflight 保留，
  作用是让「叶子不够」「已生成过」**当场**报错，而不是排队三十秒后才在轮询里冒出来。

#### ⚠️ 已在账号里创建的资源（可逆）
```
plant-jobs      66b173e2db7247c69f1dc09084c681aa
plant-jobs-dlq  17f17a3ec3464e64946c15d707bbaef2
```
不需要了就 `npx wrangler queues delete plant-jobs`（先把 wrangler.jsonc 的 queues 段删掉，
否则 deploy 会因绑定不存在而失败）。

### CP6：撰稿看得见图 + 质量闸门
- **撰稿看图**：金叶三轮撰稿的 prompt 里加「本页配图清单」——有哪些部位的图、
  **缺哪些部位**。缺的部位明确要求「不要写『如图』『见下图』」，否则模型会指着一个空槽说话。
  这是 CP4b 分槽的直接红利：在此之前根本不知道哪张图是什么。
- **`src/lib/quality-gate.ts`（新）** —— 落库/扣叶**之前**的结构性验收。
  在此之前，只要 JSON 能 parse 就落库、扣叶、`submitted_for_review=true`，
  一次被截断的生成照样收用户一枚叶子。
  闸门位置刻意选在**渲染/上传/入库/扣费全部之前**，抛出去 = 用户既没拿到东西也没被扣钱。
  - 草稿：形态 / 生境为空或过短 → fatal；其余偏短只 warn；**大面积偏短由总量兜底判 fatal**。
  - 金叶严一档（要收金叶且直接进公开档案）：五个正文字段任一不达标即 fatal；
    特征卡 <3 张 fatal、4–5 张 warn。
  - **刻意不判内容真假** —— 那是反虚构协议和联网调研的职责，这里只拦明显残次品。
  - **闸门太严比没有闸门更糟**（用户重试还得再烧一遍 token），所以有专门的
    「正常产出必须放行」测试。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0。
- **八套纯函数测试全绿**：gold-skill 20 / vision-probe 26 / species-photos 19 /
  photo-slots 14 / **quality-gate 16** / species-dossier 16 / tentative 15 / **job-queue 5**。
- `wrangler deploy --dry-run` 通过，绑定表里确认 `env.PLANT_JOBS (plant-jobs) → Queue`。
- 检查了构建产物：入口是普通对象字面量 `{ fetch, queue }`，**没有退回续14 那个
  「导出原型链不止于 Object」的 10021 部署失败**。
- dev server `/identify` 加载无 console / server 错误。
- ⛔ **未验证**：队列的真实端到端 —— 需要部署后点一次「进一步生成草稿」。
  验收点：任务不再在第 26 秒停摆；日志出现 `[job-queue] 已入队`、
  `[QualityGate] enrich draft …`、`[PhotoOrgans]`、`[PhotoSlots]`。
  若看到 `[job-queue] 没有 PLANT_JOBS 绑定` 说明绑定没生效，任务会退回 26 秒的老路。

### 落地顺序表：全部完成
0 skill ✅ / 1 视觉准入 ✅ / 2 资料包 ✅ / 3 配图许可+器官 ✅ / 4 Queues ✅ / 5 撰稿看图+闸门 ✅

## ✅ 2026-07-23 — 分享卡三修 + 草稿第四节改名与宽度 + **金叶详页闸门失败的根因**（tsc/build EXIT=0；NOT deployed）

用户一次提了六件事。前五件是界面，第六件是这轮真正的收获。

### 1. 分享卡头像「时而有时而没有」= 竞态，不是 CORS
`drafts.$id.tsx` 的自动出卡 effect 只等 `draft` 和 `leaves` 两个查询，**没等 profiles**。
识别完这张卡是自动弹的，`creatorProfile` 那条查询常常还在飞 → `avatar_url` 是 undefined
→ 画灰圆。第二次进同一页命中 React Query 缓存（staleTime 5min）就有头像了 ——
「时而有时而没有」正是缓存命中与否的差别。
**修法**：把 profiles 的 queryFn 抽成 `fetchCreatorProfile`，出卡那一刻用
`qc.ensureQueryData` **现取**（命中缓存同步返回，未命中就 dedupe 到在飞的那次请求），
外面套 2.5s `Promise.race` 兜底。
**刻意不去 gate 那个 effect** —— 查询卡住就永远不出卡，比少个头像糟得多。

### 2–3. 保存到相册 → 保存/分享；未登录时三个按钮排成一行
未登录时「登录/注册」原本是**上面单独一行**的整宽按钮，把弹层顶高，
底部按钮行正好压在手机浏览器地址栏底下点不到。现在全部塞进同一行，按数量逐档让位：
- **≥3 个 → 收掉图标**。`cardActionIcons = count <= 2`。
  ⚠️ **这条是靠截图才发现的**：3 个按钮时我先量了 button 的 scrollW/clientW 判定「不溢出」，
  截图里却是「保存/…」—— 量错了对象，truncate 发生在**里面的 span** 上。
  按 375px 算：按钮 96px，px-3(24)+图标(16)+gap(6)=46，只剩 50px 装 5 个字（需 60px）。
- **≥4 个（未登录 + 疑似）→ 再降 text-xs + px-1.5**，每个 71px 仍不截断。
弹层另加 `max-h-[92dvh] overflow-y-auto`（`dvh` 跟着地址栏收放走）。

### 4. 第四节 名称溯源 → **名称和分类趣闻**
`plant-html-template.ts`（h2 / en 副标 / `.no-title` 眉标 / alt）、`quality-gate.ts` 的 label、
`photo-slots.ts` 的槽名、`drafts.$id.tsx` 那句功能说明，一并改。
**prompt 同步扩写**（`identify-plant.functions.ts` 的 `name_origin_zh` 条）：标题既然承诺了
「分类趣闻」，就得真要求模型写属的归并/移出、异名争议、长期混淆的近似种 —— 光改标题
不改 prompt = 标题骗人。
眉标变长后在 375px 折成两行，两处 `@media(max-width:640px)`（模板 + `draft-enhance` 的
viewer 样式）各加一条 `letter-spacing:.12em;font-size:11px` 压回一行（实测 33px → 15px）。

### 5. 草稿正文 iframe 与上方卡片同宽
iframe 原先是裸 `w-full`，连同模板自己的纸底渐变在电脑上一路铺满整个窗口，
跟上面 `mx-auto max-w-5xl px-6` 的窄卡片对不齐。包一层 `mx-auto w-full max-w-5xl sm:px-6`。
**手机保持通栏**（sm 以下不加 px-6）—— 375px 本就不足 max-w-5xl，再削 24px 只会更挤。
实测 1600px：iframe 可见边缘 312→1288，与简介卡 312→1288 **逐像素重合**；
375px：iframe 仍 0→375，内部无横向溢出。

### 6. 🔴 金叶详页「五个正文分区全是空的」—— **schema 从来没发给模型**
用户报错原文：`生成的详页不完整（开篇导语是空的；株型总览是空的；生境正文是空的；
生态功能是空的；分布与入侵是空的）`。五个字段横跨三轮撰稿，不可能三轮同时写不动。

**根因**：三条 transport 里**只有 `geminiChat` 把 schema 真发出去了**
（`generationConfig.responseSchema`）。`openaiCompatChat` 与 `anthropicChat` 拿到 `schema`
参数后**只在 system prompt 末尾加一句「只返回一个 JSON 对象」，字段名一个字都没告诉模型**。
而 `intro_zh` / `form_overview_zh` / `habitat_zh` 这些键名**只存在于 schema 里**，
`premiumPrompt1/2/3` 全篇是中文散文描述。于是非 Gemini 模型自己造键名
（intro / introduction / 开篇导语…），`JSON.parse` 照样成功（所以没报 GOLD_BAD_JSON），
闸门一读 `fields.intro_zh` 全是 undefined → 判「是空的」。
最讽刺的是 prompt 里白纸黑字写着「严格按给定 JSON 结构返回」—— 那个「给定结构」
**压根没随请求发出去**。（`feature_cards` 这种一眼能猜中的键名反而蒙对了，
所以报错里没有「只生成了 N 张特征卡」这一条 —— 这正是「键名对不上」而非
「模型写不动」的旁证。）

**修法**：新增 `schemaInstruction(schema)`，把 JSON Schema 序列化后写进 system prompt，
明说「键名逐字照抄、required 一个不能少、不要包外层」。两条路径同时接上。
**刻意不用** OpenAI 的 `response_format:{type:"json_schema"}` —— 中转五花八门，
不认的直接 400，认一半的返回空串（`send()` 里那条关于 json_object 的注释就是前车之鉴）。
写进 prompt 最差只是模型不听话，不会把整条链路打挂。
顺带把 `anthropicChat` 的 `max_tokens` 8000 → 16000（与 OpenAI 路径取齐）：
金叶第一轮要一次写 6 张特征卡 + 导语 + 株型总览的中英双语，8000 挡不住。

**顺带加的两件事**
- 闸门拦下时 `console.error` 打出**三轮各自实际返回的顶层键名** + 用的哪个 provider/model。
  下次一眼分清「键名对不上」还是「真写不出内容」，不必再靠推理。
- 闸门文案 `请换一个更强的模型` → `请在管理后台的「小P蛙模型」控制台把序列 1 换成长文能力
  更强的模型（详页由该控制台驱动）`。原文案没说去哪换、也没说是哪个控制台。

**金叶详页的模型来自哪里**（这次查清楚了，写下来免得再找）：
`runGoldCore` 走 `xiaopTextCall`，优先级 = 浏览器 localStorage `xiaop_user_model_v1`
（/identify 的「小P蛙模型设置」）> `site_config.xiaop_model_config`（管理后台「小P蛙模型」）
> `.env` GEMINI_API_KEY + `AI_MODEL`。**不是**「草稿生成模型」那个控制台。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` 通过（模板 CSS 字符串没被注释截断）。
- `quality-gate` 16 条、`photo-slots` 14 条断言全过。
- 浏览器 **DOM 实测**（375px）：2/3/3/4 四种按钮组合 `oneRow=true`，
  每个 span `scrollWidth === clientWidth`（无截断）。
- 浏览器 DOM 实测（1600px / 375px）：iframe 对齐与无溢出，数据见上。
- eslint：改动区域 0 问题（`drafts.$id.tsx` 剩的 7 条 prettier 在 226/1667 附近，
  是本轮之前就有的未提交代码；`identify-plant.functions.ts` 的 98 条是既有欠账）。
- ⛔ **未验证**：真实模型往返 —— 本机连 Supabase 一直 ECONNRESET（探针脚本连挂两次，
  按项目规矩停手），dev server 上数据加载不出来，没法开真草稿页。
  上线后验收点：金叶失败时看日志 `[QualityGate] gold <id> 各轮顶层键：p1=[…]`——
  若键名已是 intro_zh/habitat_zh 等却仍为空，才是真的该换模型。

### Blockers
- 本机到 Supabase 的 TLS 连接被重置（`scratch` 探针 + dev server 均如此），
  所以**没能读出 `site_config.xiaop_model_config` 里当前配的到底是哪个模型**。
  探针脚本留在 scratchpad，网络通的时候跑一次即可（key 已打码）。

## ✅ 2026-07-23（续二）— 正名核对机制：内核完成并**全量实测**（tsc/build EXIT=0；NOT deployed，名录未导入）

用户交来 `植物界-2025-47927.xlsx`（中国生物物种名录 2025 版·植物界），要求：
① 放进本站核对机制 ② 收录进已收录档案检索 ③ 把 AI 识别 / 银叶草稿 / 金叶创建 / 编辑提交
四条链路的名字换成正名 ④ 其它名字用括号标同种异名 / 别名 / 旧名。

### 这张表能做什么、**不能**做什么（先看这段再改代码）
表里**只有正名（accepted names），没有异名列**。所以：
- ✅ 拉丁名命中 → 中文正名、科中文名、属中文名一律以名录为准，模型给的写法降级为别名。
- ✅ 中文名命中而拉丁名没命中 → 用中文名反查；但 **17 个中文名对应多个物种**
  （龙须菜、沙蓬…），一律判 `ambiguous`，**不猜**。
- ❌ **把异名映射到正名做不到**。`Triglochin palustre` 是不是 `T. palustris` 的异名，
  这表答不了 —— 那需要 POWO/IPNI 级别的异名索引。
- 拉丁名没命中有三种可能，代价差别极大，所以**绝不自动改名**：①模型用了异名（改名对）
  ②境外物种（改名会造出假的中国分布记录）③模型认错了物种（改名把错误洗成"权威"）。

### 已完成
- **[name-authority.ts](src/lib/name-authority.ts)** —— 纯函数内核，无网络无数据库。
  `canonicalKey()` / `resolveName()`，四条匹配路径：精确 → 双名+种下等级 → 拉丁词尾
  性数折叠（fuzzy，强制标「待人工确认」）→ 中文名反查。
- **[name-authority.functions.ts](src/lib/name-authority.functions.ts)** —— 服务端。
  `applyNameAuthority()`（四条链路共用的应用器）、`checkNameFn`、`searchChecklistFn`。
  候选查询是**一个来回**（`name_key.eq OR genus_la.ilike OR chinese_name.eq`），
  不把 47,927 条塞进 Worker bundle。
- **[20260723120000_species_checklist.sql](supabase/migrations/20260723120000_species_checklist.sql)**
  —— 建表 + trigram 索引 + 公开只读 RLS；另加 `plants.name_authority jsonb` 留痕列
  与「待人工复核」偏索引。**⏳ 待去控制台执行。**
- **[convert_species_checklist.mjs](scratch/convert_species_checklist.mjs)** / 
  **[import_species_checklist.mjs](scratch/import_species_checklist.mjs)** —— xlsx→NDJSON→库，
  导入可断点续跑（本机 ECONNRESET 常态）。
- 接入两条链路：`buildDraftContent`（**AI 识别 + 银叶草稿共用的咽喉点**，位置刻意在配图与
  HTML 渲染之前）、`runGoldCore`（在三轮撰稿之前，让 prompt 拿到正名与正确科属）。

### 🔴 只有跑全量才会暴露的四个 bug（都已修，已固化成测试）
第一版 `canonicalKey` 在 6 条手写用例上全绿，一上 47,927 条真数据立刻碎：
1. **转换脚本自己实现了一遍归一化** → 去掉杂交符 `×` 之后忘了重新 trim，
   `× Bolboschoenoplectus mariqueter` 入库的键带前导空格，与查询端算的键**永不相等**。
   → 改成转换脚本 `import { canonicalKey }` 直接用同一份实现（`node --experimental-strip-types` 跑）。
2. **命名人没剥干净**：`Ammopiptanthus mongolicus (Maxim. ex Kom.) Cheng f.` 只去了括号，
   残留 `cheng f.` → 被错判成「本双名下唯一的种下等级」，note 还煞有介事地说已采用该等级。
3. **栽培品种名被吃掉**：藁本 / 川芎 / 抚芎 / 金芎 只靠 `'Chuanxiong'` 区分 —— 26 组碰撞。
4. **大写种下加词**：源数据写 `var. Nacusua` / `cv. Stripe`（不合规范但就是这么写的），
   按「大写=命名人」判会停手 → 新木姜子与新木姜子(原变种)同键 —— 11 组碰撞。

**方向性教训**：第一版思路是「**只挑**属名+种加词」，于是 forma 第二级、杂交式第二加词、
品种名统统被吃掉。改成「**默认保留，只在确认是命名人时才丢**」才对 —— 权威表的归一化
宁可键多，不可键少：键多只是少匹配一次，键少是两个物种被唯一约束吞掉一个。

### 验证证据
- **47,927 → 47,927 个唯一 name_key，零碰撞**。
- **自洽性回归：47,927 / 47,927 条名录名字回喂自己判 `accepted`**（305 ms）。
- 真实输入抽查：`*Triglochin maritimum* L.` → renamed/latin-fuzzy（正确，标待人工）；
  `Ammopiptanthus mongolicus (Maxim. ex Kom.) Cheng f.` → accepted/latin-exact（正确，
  修 bug 前这条是错的）；无学名 → unmatched 不动。
- [name-authority.test.mjs](scratch/name-authority.test.mjs) **25 条断言全过**
  （含上述四个 bug 各自的回归用例）。
- `tsc --noEmit` EXIT=0；`npm run build` 通过。

### ⏳ 本项未做完的部分
- **名录进「已收录档案检索」的 UI**：`searchChecklistFn` 已写好（含 `in_site` 标记，
  能一眼看出「名录有、本站还没做」的空白），但 [plants.index.tsx](src/routes/plants.index.tsx)
  还没接上。
- **编辑提交链路**：编辑器是浏览器直写 `plants`（RLS），不是服务端 fn。这条路上
  **不应静默改写人写的名字** —— 该做成保存时弹「名录正名是 X，你写的是 Y」让编辑定夺。
  `checkNameFn` 已备好，UI 未做。
- **别名括号的前端渲染**：留痕已落到 `ai_payload._name_authority` / `plants.name_authority`，
  页面还没读它渲染「正名（异名：X）」。
- ⛔ **名录尚未导入线上库**，所以线上一切照旧、零影响。导入两步：
  ① 控制台执行迁移 ② `node --experimental-strip-types scratch/convert_species_checklist.mjs <xlsx> <out.ndjson>`
  然后 `node scratch/import_species_checklist.mjs <out.ndjson>`。

### 用户其余三项需求（本轮**未开始**）
- 简介卡下重复的 `#tag` 列表 → 换成「手动添加#tag标签」彩色按钮（只能下拉选已有标签）。
- 添加/编辑内容页消失的「+标签#tag」按钮要补回；标签下按科/属/识别地点/各名录筛选加条目。
- 项目/博客页的 PDF/PPT 渲染成压缩图片，右键只能存图片、存不到源文件。

## ✅ 2026-07-23（续三）— #tag 按钮改造 + 编辑器补回 +标签 + PDF→图片（tsc/build EXIT=0；NOT deployed）

### 1. ✅ 简介卡下重复的 `#tag` 列表 → 彩色「手动添加 #tag 标签」按钮
[drafts.$id.tsx](src/routes/drafts.$id.tsx) 原先把 `draft.tags` 原样铺成一排
`#盐生植物 #多年生草本 …` —— 与学名下面那排自动识别出的特征词**是同一批内容**，
同屏重复，而且什么都点不了。
- 新增 [tag-picker.tsx](src/components/tag-picker.tsx)：**只能从已建标签里选，不能自己敲名字**。
  为什么定死这条：人人自由输入会立刻长出「盐生植物 / 盐生 / 耐盐植物」三个各挂两条的
  僵尸标签，专题页就废了。要新标签走 `allowCreate`（只给编辑）。
- 标签列表**第一次打开才拉**（识别完自动弹卡那一刻页面已经在并发好几个查询）。
- 写库乐观更新 + 失败回滚；能改的人 = 草稿主人 + 编辑。

### 2. ✅ 编辑器「+标签#tag」按钮补回
根因：那块 UI 埋在 [plant-editor.tsx](src/components/plant-editor.tsx) 的
`{htmlUrl && …}` 里面 —— **只有传了 HTML 文件才出现**，富文本模式和「还没上传」时整个不见。
挪到 fieldset 末尾常驻，并补上就地新建标签（以前要跳去管理页建，回来编辑内容全丢）。
新建后自动勾选。

### 3. 🟡 PDF → 压缩图片（代码完成，**dev 下未跑通，见 Blockers**）
- 新增 [doc-to-images.ts](src/lib/doc-to-images.ts) + [block-editor.tsx](src/components/block-editor.tsx)
  的 `BlockEditorHandle.appendImages`（`uploadFile` 只能返回一个 URL，装不下一份 PDF 的 N 页）。
- 接进 [project-editor.tsx](src/components/project-editor.tsx) 与 [blog-editor.tsx](src/components/blog-editor.tsx)：
  「插入 PDF（转为图片）」按钮 + **拦截 BlockNote 自己的 uploadFile**。
  ⚠️ 拦截那一层是**安全边界**：不拦的话把 PDF 拖进正文，原来那句「压缩失败就传原件」
  会把源 PDF 原样传上去 —— 正是要防的事。
- **设计要点：源文件一次都不上传**。转换全在浏览器做，只有渲染出的图片进 storage，
  服务器上压根没有那份 PDF。靠前端拦右键 / 关 contextmenu 都是纸糊的（F12 就绕过），
  只有「不存在」是真的拿不到。右键存**图**永远拦不住，那也不是用户要拦的。
- **PPT 不做**：浏览器里没有可靠办法渲染 PPTX（一包 XML + 主题 + 字体 + 动画，
  正确出图等于实现半个 PowerPoint）；服务端转要 LibreOffice，而本站跑在 Workers 上没有那个进程。
  改成抛一个**说清下一步**的错误：请先导出为 PDF。
- pdfjs-dist 6.1.200 已装（npm，bun 装报 IntegrityCheckFailed）。构建产物确认**懒加载**：
  `pdf-*.js` 431 KB + `pdf.worker.min-*.mjs` 1.25 MB 均为独立 chunk，主包不受影响。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` 通过。
- 浏览器实测查明并修掉一个真 bug：**pdfjs v6 的 worker 是 ES module**，
  用 `?url` + `workerSrc` 会让 pdfjs 拿 classic `new Worker()` 去加载 →
  `SyntaxError: Cannot use import statement outside a module` → getDocument()
  **静默永久 pending**（不报错不 reject）。已改 `?worker` + `workerPort`。
  实测证据：classic worker 报上述 SyntaxError，`{type:"module"}` 的 `moduleOk:true`。
- ⛔ 三个编辑器都在登录后面，**未做界面实测**（不输入用户凭据）。

### Blockers
- 🔴 **PDF 转换在 dev 下仍挂死在 `getDocument()`**，已连续多次未通过，按项目规矩停手。
  已查明并排除的：worker 类型（已修）、worker 构造器可用（`?worker` 返回 function、
  `workerPort` 设置成功）。**决定性对照实验**：完全相同的 PDF，
  直接 `import("/node_modules/pdfjs-dist/build/pdf.min.mjs")` + `?worker` → `numPages:1` 成功；
  经由 `src/lib/doc-to-images.ts`（内部 `import("pdfjs-dist")` 裸包名）→ 永久 pending。
  → **强指向主线程与 worker 加载到两份不同的 pdfjs 实例**（`.vite/deps/` 副本 vs 真实文件）。
  已加 `optimizeDeps.exclude: ["pdfjs-dist"]`（[vite.config.ts](vite.config.ts)）并重启 dev + 清 `.vite`，
  仍未通过。**下一步建议**：① 确认 exclude 真的生效（看 network 里 pdfjs 的实际 URL 是不是
  还带 `.vite/deps`）；② 或者两边都改成显式 `pdfjs-dist/build/*` 路径并为其加一份
  `declare module` 的 .d.ts（本轮用 `as string` 绕类型，反而让 Vite 不再解析该说明符）；
  ③ 生产构建**不走 optimizeDeps**，所以很可能只是 dev 独有问题 —— 部署后先在线上试一次
  再决定要不要继续在本地折腾。

## ✅ 2026-07-24 — 换用《中国植物物种名录 2026》（**带异名**）+ 修复二次复核假故障（tsc/build EXIT=0；NOT deployed）

### 1. 🔴 二次复核「未运行」的真凶 = `response_format` 被中转拒收
用户报：识别出疑似时前台说「二次自动复核：未运行 —— 复核未能完成（模型限流、超时或未配置）」，
但后台自检**全绿**：✅ 确认读图（四个方块颜色顺序全对）、✅ 连通正常（该 Key 可见 229 个模型）。

**根因**：`secondOpinionIdentify` 无条件发 `response_format: {type:"json_object"}`。
而复核链路配的基本都是第三方聚合中转（能列 229 个模型的那种），中转对这个参数支持
五花八门 —— 不认的直接 400，认一半的返回空串。
**代码里早有这个教训的成品写法**：`callAiIdentify` 第 1953 行
`...(provider === "custom" ? {} : { response_format: … })`，`send()` 第 6350 行也专门注释过。
复核这处是漏网的。
症状之所以极具迷惑性：**后台那两个自检请求都不带这个参数**，所以全绿；偏偏真复核带，于是必挂。

**已修**：① 复核不再发 `response_format`（prompt 里已写死"只返回一个 JSON 对象"，
`cleanJson()` 能剥 ``` 围栏）；② **报真实原因**，不再拿「限流/超时/未配置」三选一去猜 ——
新增 `noteFailure()`/`takeSecondOpinionFailures()`，把 HTTP 状态码+响应体片段、
30s 超时、空内容、「序列项全被测出不读图」「控制台没配模型」逐条写进 trace 呈给用户。
原来那句猜测里三个原因**没有一个**对得上真实故障，用户只能一脸问号。

### 2. ✅ 名录升级到 2026 版 —— 异名映射从「做不到」变成「做得到」
2025 版只有正名，所以上一轮我在代码和迁移里写死了「把异名映射到正名做不到，
那需要 POWO/IPNI 级别的异名索引」。**2026 版就是那个索引**：
120,307 条 = 47,469 接受名 + 72,838 异名，每条异名带 `accepted_name_code` 指向正名。
另外多了省级分布（47,197 条）和独立中文俗名表（16,929 条）——
别名/俗名终于有权威来源，不必再靠模型编。

- 抽取 [extract_col2026.py](scratch/extract_col2026.py)（sheet1 解包后 138 MB，iterparse 流式读）
  → 归一化 [build_col2026.mjs](scratch/build_col2026.mjs)（`import { canonicalKey }`，与查询端共用一份实现）
- 新迁移 [20260724120000_species_checklist_2026.sql](supabase/migrations/20260724120000_species_checklist_2026.sql)：新表 `species_names`
- 解析器：新增 `collapseCandidates()` + `NameStatus.synonym` + `ChecklistLookup.allByLatin`

### 🔴 只有真数据才会暴露的 schema 级发现：**`name_key` 绝不能加 UNIQUE**
上一轮 2025 版的迁移写的是 `name_key text not null unique` —— 那张表恰好零重复，
所以看起来没问题。**2026 版直接崩**：120,307 条 → 118,839 个唯一键，1,373 组重复，分三类：
- 532 组 同一正名的不同写法 → 无害
- 264 组 一个正名 + 一个异名同键 → **以正名为准**
- 577 组 **多个不同正名同键** → 真·同名异物，判 ambiguous 不猜
→ 主键改成 `name_code`（名录自己的 ID），`name_key` 只做普通索引。

### 验证证据（全量 120,307 条）
- **① 接受名自洽：47,469 / 47,469 判 accepted**（建索引 745 ms）
- **② 异名→正名：71,096 / 72,838 正确映射（97.6%）**，且**每一条都有交代**：
  · 1,185 条真·同名异物 → ambiguous（按设计不猜）
  · 557 条 → accepted：这些名字**既是某分类单元的正名、又是另一个的异名**，
    取正名用法（有人写 `Cornus sanguinea` 时意图压倒性是那个正名物种）。
  71,096 + 1,185 + 557 = 72,838 ✓ 无一遗漏
- ③ 抽查：3 条真实异名逐一核对正名正确（Physcomitrium acuminatum→eurystomum、
  Maackia amurensis var. typica→amurensis、Rhododendron qiangangense→tenue）；
  沙冬青现在能从名录取到俗名（蒙古黄花木/冬青/蒙古沙冬青），不再靠模型编。
- [name-authority.test.mjs](scratch/name-authority.test.mjs) 25 条断言全过；`tsc` EXIT=0；`npm run build` 通过。

### ⏳ 待办
- 名录**尚未导入线上库**（旧的 2025 表也没导过）→ 线上零影响。
  导入需先改 [import_species_checklist.mjs](scratch/import_species_checklist.mjs) 指向新表 `species_names`。
- `name-authority.functions.ts` 仍查旧表名 `species_checklist`，要改成 `species_names` 并带上
  异名/俗名/分布字段。
- 别名括号的前端渲染、名录进「已收录档案检索」的 UI、编辑提交链路的核对提示 —— 均未做。

## ✅ 2026-07-24（续）— 名录导入线上库 + **真实往返验证通过**（8/8）

用户拍板：**2025 版整个丢弃，只用 2026 版**。已删 `20260723120000_species_checklist.sql`
及其转换/回归脚本（`convert_species_checklist.mjs`、`real_check.mjs`）。

### 线上状态（**已生效**，与之前所有「NOT deployed」的条目不同）
- `species_names` 表已建（用户在控制台执行 20260724120000 迁移）
- **120,307 条全部导入，零跳过零失败**，库内计数 = 120,307 ✓
- `plants.name_authority` 留痕列已就位

### 打通的这条路
- [import_col2026.mjs](scratch/import_col2026.mjs)（原 import_species_checklist.mjs）——
  去重键 `name_key` → **`name_code`**。这不是形式改动：12 万条里 1,373 组同键，
  拿 name_key 去重会直接吞掉不同物种。
- [name-authority.functions.ts](src/lib/name-authority.functions.ts) 改查 `species_names`，
  并新增**一次必要的补查**：命中异名时正名常常不在第一批候选里 ——
  **实测 34,962 条异名（占 48%）的正名在不同属**（属被拆并正是产生异名的主因），
  按属捞根本捞不到。没这次补查，一半的异名查询会退回「标注不改名」。
- 检索改成异名感知：搜到异名换成正名再去重（用户拿旧书上的名字来搜，正是最该接住的情形）。
- [types.ts](src/integrations/supabase/types.ts) 手工补 `species_names`（托管库无本地 CLI）。

### 验证证据（**打到线上库**，不是内存索引）
[roundtrip_col2026.mjs](scratch/roundtrip_col2026.mjs) —— 走与服务端逐字同构的查询：
```
✅ 命中正名 + 命名人混在学名里   沙冬青（别名：蒙古黄花木；冬青；蒙古沙冬青）  2 候选 · 5354ms(冷)
✅ 模型用了别的中文名 → 换正名   圆果水麦冬 → 海韭菜                        2 候选 · 715ms
✅ 拉丁词尾性数错配 → fuzzy      Triglochin maritimum L. → maritima         2 候选 · 658ms
✅ 异名→正名（跨属）             Dracocephalum stewartianum → Nepeta stewartiana 多花荆芥  123 候选 · 1107ms
✅ 异名→正名（跨属+种下等级）     Parthenocissus henryana var. glaucescens → Yua thomsonii var. glaucescens  36 候选
✅ 异名→正名（属被拆分）          Racomitrium fasciculare var. orientale → Dilutineuron fasciculare 丛枝藓  82 候选
✅ 不在名录 → unmatched 一字不改  Adansonia notarealis                       1 候选 · 597ms
✅ 只有中文名 → 补上学名科属      沙冬青                                     1 候选 · 475ms
→ 8/8 通过
```
- 顺带验了 PostgREST 的类型往返：`common_names` text[] 回来是**真数组**，
  `is_accepted` 是真布尔，`distribution_zh` 正常。
- 单元测试 25 条全过；`tsc --noEmit` EXIT=0；`npm run build` 通过。
- 修掉一处漏网的旧书名（unmatched 的 note 还写着「中国生物物种名录 2025」）。
  新文案顺带说明：**名录已含 7.2 万条异名，所以「只是用了旧名」基本可排除** ——
  走到 unmatched 多半是境外物种或识别有误。

### ⏳ 下一步（前端，均未做）
- 别名括号的页面渲染（留痕已落 `ai_payload._name_authority` / `plants.name_authority`）
- 名录进「已收录档案检索」的 UI（`searchChecklistFn` 已就绪，plants.index.tsx 未接）
- 编辑提交链路的核对提示（编辑器是浏览器直写，不该静默改人写的名字）
- ⚠️ 代码改了但**站点尚未部署** —— 线上仍跑旧代码，还不会用这张表。

## ✅ 2026-07-24（续二）— 前端三块 + **已部署上线**（Version 41569210）

### 1. 别名括号的页面渲染
新增 [name-authority-badge.tsx](src/components/name-authority-badge.tsx)：`readNameStamp()` +
`<NameAuthorityNote>`。接到两处：[drafts.$id.tsx](src/routes/drafts.$id.tsx)（读
`ai_payload._name_authority`，放在学名下方）、[plants.$slug.tsx](src/routes/plants.$slug.tsx)
（读 `plants.name_authority`，放在正文 iframe **之前** —— 正文是上传的整页 HTML，
插不进去，而「这名字被自动改过」必须在读正文之前就看到）。
**只读不算**：核对是服务端在内容生成那一刻做完的，页面重算既拿不到名录也会每次渲染打库。
四种状态各自配色/图标；**renamed / synonym 一定显示 `was` 原值** ——
不显示原文等于把一次自动改写藏起来，fuzzy 那条路是会错的，藏起来就没人能发现。

### 2. 名录进「已收录档案检索」
新增 [checklist-results.tsx](src/components/checklist-results.tsx)，接在
[plants.index.tsx](src/routes/plants.index.tsx) 本站结果**之后**（先站内、后名录）。
两层意义：① 搜旧名也能中（服务端把异名折算到正名再去重）②`in_site` 标出
「名录有、本站还没做」的空白 —— 那正是把国家名录接进检索页的全部意义：**它是选题清单**。
未收录的排在前面。查询 ≥2 字才触发（单字命中几千条，既慢又没用）。

### 3. 编辑提交链路的核对提示
[plant-editor.tsx](src/components/plant-editor.tsx) 保存前跑 `checkNameFn`，
不一致时弹窗给三个选择：返回修改 / 保持我写的直接保存 / 采用名录正名。
**刻意只提示、不静默改写** —— 这条链路上的名字是编辑亲手敲的，不是模型生成的。
AI 那两条链路可以自动对齐（模型本没有署名权），但把人写的名字在他不知情时换掉是另一回事：
名录也会有他知道而我们不知道的例外。采纳正名时原名并入中文俗名，不丢信息。
核对服务挂掉一律放行，绝不挡保存。

### 验证证据（**线上实测**，非本地）
- 部署：`wrangler deploy` Version ID `41569210-b95b-4155-9efb-d7bf60446622`，
  触发器 plantspedia.club / www 均已更新。
  ⚠️ 第一次部署报 `Completion token has already been consumed [code: 100312]`——
  资产上传的重试把 token 用掉了，**重跑一次即成功**，不是代码问题。
- **https://plantspedia.club/plants?q=Dracocephalum+stewartianum**（一个异名，
  且正名跨属跨科）→ 返回「多花荆芥 Nepeta stewartiana 唇形科 · 四川、云南、西藏 · 待收录」。
  这条走完了全链路：浏览器 → searchChecklistFn → Supabase 两次查询（trigram + 正名补查）
  → 异名折算 → 去重 → 渲染。
- 本地实测 `?q=沙冬青` → 名录命中 2 个：小沙冬青（待收录）/ 沙冬青（本站已收录），
  分布「新疆」「内蒙古、宁夏、甘肃」正常。控制台零报错。
- 顺带暴露一个**真实的站内命名不一致**：本站条目叫「蒙古沙冬青」，名录正名是「沙冬青」。
  这正是这套机制要解决的问题，现在检索页上一眼可见。
- `tsc --noEmit` EXIT=0；`npm run build` 通过；单元测试 25 条全过；往返验证 8/8。

### 现在线上是什么状态
名录 120,307 条已在库、代码已部署 → **正名核对对新产生的内容已经生效**：
AI 识别 / 银叶草稿（buildDraftContent）、金叶详页（runGoldCore）、编辑提交（弹窗）。
**存量内容不会被回溯改名**（没写回填脚本，也不该在没人看的情况下批量改历史条目）。

## ✅ 2026-07-24（续三）— PDF 渲染真凶查明 + 注册入口拆分 + 标签统一（tsc/build EXIT=0；~~NOT deployed~~ → **实际已随 07-25 15:11 的 adf3316b 上线**（见文首「部署真相」））

### 1. 🎉 PDF→图片：**Blocker 解除**，但真凶不是之前记的那个
上一轮把它记成「dev 下 getDocument() 挂死，疑似主线程与 worker 加载了两份 pdfjs 实例」。
本轮用一份手写的最小 PDF（public 下临时放一份，测完删）在浏览器里做了**无需登录**的
实测，结论是：**那个判断是错的**。

- `getDocument()` **根本没挂**。改成显式深路径 `import("pdfjs-dist/build/pdf.min.mjs")`
  （与 worker 的 `pdf.worker.min.mjs?worker` 同一份构建产物，见
  [src/pdfjs-dist.d.ts](src/pdfjs-dist.d.ts)）后，network 里两边都走
  `/node_modules/pdfjs-dist/build/*`、没有 `.vite/deps` 副本，`getDocument` **124 ms**
  返回 `numPages:2`。裸包名之所以可疑，是它按 `main` 解析到**未压缩的 pdf.mjs**，
  与压缩版 worker 不是同一份产物。
- **真正卡死的是 `page.render()`**，原因是**后台标签页里 `requestAnimationFrame` 不触发**。
  pdfjs 的 InternalRenderTask 默认一帧画一块（源码 `useRequestAnimationFrame: !intentPrint`）,
  于是 render().promise **既不 resolve 也不 reject**——无异常、无日志、无网络请求，
  和「getDocument 挂死」的表象一模一样。上一轮之所以误判，是因为它俩长得完全一样。
- **四组对照实验**（同一份 PDF，`document.visibilityState === "hidden"`）：

  | 写法 | 结果 | `_useRequestAnimationFrame` |
  |---|---|---|
  | 默认 | ❌ 8s 超时未完成 | true |
  | 设 `task.onContinue = c => c()` | ❌ 8s 超时未完成 | true |
  | **`intent: "print"`** | ✅ **3 ms** | false |
  | 手改私有 `_useRequestAnimationFrame` | ✅ 2 ms | false |

  `onContinue` **没用** —— 它交回来的「继续」函数内部仍走 `_scheduleNext()` → rAF。
  已采用 `intent: "print"`：这是唯一能翻掉那个 flag 的**公开 API**，语义上也正是
  「这一页打印出来长什么样」。
- 顺手修掉一个真 bug：**文件名与 MIME 不一致**。原来写死
  `blob.type === "image/webp" ? "webp" : "jpg"`，而 `compressImage` 对 <200 KB 的图
  **原样返回不转码** → PNG 内容被命名成 `page-001.jpg`。改用站内既有的 `extForMime()`。

**实测证据**（浏览器，隐藏标签页，`npm run dev`）：
```
2 页 300×200 PDF  → 2195 ms · page-001.png/page-002.png · 名实相符 ✓
1 页 A4 PDF       → 1297 ms · page-001.webp · image/webp · 282 KB（走到了压缩路径）✓
PPT 拦截          → 抛「请先导出为 PDF」的说明性错误 ✓
```
A4 那页的成图已截图核对：45 行文字全部清晰、Helvetica 正常（未内嵌标准字体不影响）。

- **PPT 仍然不做**，理由不变（浏览器渲染不了 PPTX；服务端要 LibreOffice，Workers 上没有）。
- ⛔ 三个编辑器（project / blog / plant）仍**未做界面实测**——都在登录后面，不输入用户凭据。
  转换本身已验证；剩下没验的只有「按钮点下去→插进正文」那一段接线。

### 2. ✅ 登录页拆出「去注册」，不再逼所有人写编辑申请
[login.tsx](src/routes/login.tsx) 原先唯一的注册入口挂在「申请成为编辑」上 ——
只想评论 / 提交识别草稿的访客也得写一份 ≥20 字的简述、还要等审核。
- [signup.tsx](src/routes/signup.tsx) 一个路由两种意图，靠 `?mode=` 分：
  `mode=register` 普通注册（无简述）/ `mode=editor` 编辑申请（现状）。
  **默认 editor**，因为站头和邮件里的 `/signup` 旧链接不带 mode，语义不能悄悄改。
- **零数据库改动**：`handle_new_user()` 是看 `raw_user_meta_data->>'editor_application_bio'`
  有没有值才建 editor_applications 行的，普通注册压根不发这个字段。
- 登录失败且 `Invalid login credentials` 时额外弹一句提示。措辞是**两问**
  （「还没注册过？还是密码记错了？」）—— Supabase 出于账号枚举防护，
  邮箱不存在和密码错回的是同一句，服务端不肯说是哪种，不能断言用户不存在。
- 已实测：`/login` 两个按钮并排；`/signup?mode=register` 无简述框；`/signup` 仍是编辑申请。

### 3. ✅ 「手动添加 #tag 标签」黑底白字，两处统一
- [tag-picker.tsx](src/components/tag-picker.tsx) 按钮 `bg-vermilion` → **`bg-ink text-background`**。
- [plant-editor.tsx](src/components/plant-editor.tsx) 的「项目标签 #tag」原先是把全部标签
  平铺成一墙 chip，与草稿页简介卡那个按钮**明明是同一件事却长得完全不同**。
  换成同一个 TagPicker（`allowCreate`，编辑可就地新建）。
  新增 `onTagsLoaded` 回调 + `tagIdByName` **ref**：TagPicker 对外说标签**名**，
  plant-editor 存的是 **id**（保存要算增删差集）；就地新建时「刷新列表」和
  「onChange 带上新名字」在同一个 tick，走 useState 会查不到新 id，ref 是同步写的。
- **顺带把两套标签的界面命名分开**（这是用户问「这些标签到底有什么用」的根因）：
  `plants.tags` / `plant_drafts.tags`（text[]，AI 自动填）栏位标题改成
  **「特征词（逗号分隔 · 供搜索与卡签，不建专题）」**；`tags` 表 + `plant_tags` 关联
  那一套改称 **「主题标签 #tag（决定这条详页出现在哪些专题页）」**。
  以前两者都叫「标签」，谁也说不清区别。

### 4. ✅ 标签管理页「+ 从已收录的条目中选择」加三个筛选
[admin.tags.tsx](src/routes/_authenticated/admin.tags.tsx) 检索框右边：
- **入侵 GRIIS 名单** —— 复用 `buildConservationMatcher` + `GRIIS_DEGREES`，与 /plants 的
  GRIIS 筛选**同一套 matcher、同一份 registry 数据**，两边结果必然一致。
  下拉只列库里真有的等级，另加「仅 GRIIS 名单内（任意等级）」。
- **创建日期** —— `plants.created_at` 起止两端**含当天**（比的是 ISO 前 10 位，
  直接拿整串比会把当天全排除）。
- **识别地点** —— 条目表没有这个字段。新增
  [`fetchPlantCapturePlaces()`](src/lib/drafts.ts)：`plant_drafts.published_plant_id`
  → `capture_place`，分页拉全表、同条目取**最早**那条草稿（与详页页头口径一致）。
  因为 capture_place 粒度极不统一（「鄂尔多斯市」到整条街道地址），做成
  **子串匹配 + datalist 提示**，不是硬枚举下拉；另给一个「（无识别地点 / 非识别来源）」哨兵值。
- 两张附表都 `enabled: pickerOpen` —— 只在选择器真展开时才拉。
- 工具条显示「匹配 n / 总数 · 已选 m」和「清除筛选」。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0。
- pdfjs 仍是**独立懒加载 chunk**（`pdf.min-*.js` 428 KB + `pdf.worker.min-*.js` 1.19 MB），
  主包不受影响。
- 浏览器实测：PDF 转换（见上表）、`/login`、`/signup` 两种 mode。
- ⛔ 标签相关的三处 UI（admin.tags / plant-editor / 草稿页简介卡）**只过了 tsc+build，
  未做界面实测** —— 全在登录后面。

### 下一步
- 部署（本轮所有改动均**未上线**）。
- 三个编辑器插 PDF 的按钮接线做一次界面实测。
- 站头那两个「申请成为编辑」是否也要拆出「注册」（本轮只改了登录页，用户只提了登录页）。

## ✅ 2026-07-24 — 2026 名录回填：两条人工判定已上线 + 批量回填器（已部署 Version 524c1309）

### 部署踩的坑（两次报错**原因不同**，别混为一谈）
- 第一次 `token already consumed` = 连接断在**重试之间**（上传已消费掉 token 又重发）。
- 第二次 `fetch failed` = 连接**根本没建起来**。日志铁证：第一个 GET 200 成功、第二个
  查 secrets 的 GET 就挂 —— **连小请求都断**，所以不是「5MB 包太大被掐」，是链路抖动。
- ✅ **解法 = 自动重试循环**（`/tmp/deploy_retry.sh`，失败等 10s 重来，最多 20 次）。
  实测第 1 发就中。curl 探 api.cloudflare.com 返回 400 即代表**网络通**（裸请求本就该 400）。

### 两条歧义条目已人工定夺并改完（含正文）
- **蝎尾菊 → 猬菊** `Olgaea lomonossowii`（种加词少写一个 s，同一株植物）
- **多枝岩黄芪 → 羊柴** `Corethrodendron fruticosum`（属被拆分后的新组合）
  - 🔑 **歧义是被命名人解开的**：名录里 `Hedysarum fruticosum` 有两条异名 ——
    `auct. non Pall.`→蒙古羊柴、`Pall.`→羊柴(原变种)。站内条目学名正是 `Pall.`，唯一确定。
    机器当初判不了，只因它没拿命名人比对。**命名人是消歧的关键信息，别当噪音丢掉。**
- 脚本 [rename_entries_2026.mjs](scratch/rename_entries_2026.mjs)，dry-run→apply，已实测回读验证。

### 🔴 正文批量替换的四类改坏（全是真数据跑出来的，手写用例一个都想不到）
写在 [backfill_stock_2026.mjs](scratch/backfill_stock_2026.mjs) 里，**改这类脚本前先读这段**：
1. **调换被自己后面的规则撤销**：先把「A又名B」翻成「B又名A」，紧接着的通用替换
   A→B 又把它改回去。→ 翻面后的旧名要用**哨兵包起来**，全部替换跑完再还原。
   ⚠️ 哨兵**不能含旧名**（第一版用 `§§蝎尾菊§§`，通用替换照样伸进去改），
   也不能用 `KO`/`KN` 这种正文里可能出现的字母（会被错还原成物种名）。
2. **子串碰撞**：慈姑 ⊂ 野慈姑 → 正文里本就正确的「野慈姑」被改成「野野慈姑」。
   → 旧名是新名子串时，先把已有的新名保护起来。
3. **镜像写法**：我只处理了「新名（旧名）」，真数据里大量是「旧名（新名）」
   （狭叶柴胡（红柴胡））和「新名，又名旧名」（拉拉藤，又名猪殃殃）。两个方向都要覆盖。
4. **🔴 近似种对比自指**（最阴险，没叠字没括号，前三类检测器全抓不到）：
   原文在拿旧名和新名当**两个不同分类单元**比较 ——「部分分类处理将猪殃殃视为拉拉藤的亚种」
   改完变成「将拉拉藤视为拉拉藤的亚种」。辽东栎→蒙古栎、中间荸荠→沼泽荸荠、慈姑→野慈姑
   都是这种。**这种页面不能机器改，整页跳过交人工。**
   - 检测器的松紧要分开：`视为/归入/混淆/近缘` 等强连接词可以隔一段话；
     `与/和` 太常见（"形态与生境"里就有），必须要求两名**紧挨着**，否则误报。

### 另外两条方法论（本轮吃了亏）
- **检测器必须比对替换前后**，只报**新增**的问题。正文里本来就有的叠字（实测「锦葵锦葵」
  写在 alt 属性里）不是这次改出来的，拿它拦下一次正当回填毫无道理。
- **探针脚本的 catch 不许静默返回 []** —— 「没数据」和「没连上」会分不清。本轮就因此
  误报过「该正名没有异名」和「按学名查不到」，还据此给了错误解释（真因是列名写错
  `accepted_name`，实际是 `accepted_code`，400 被吞了）。

### 回填盘子
| 类别 | 条数 | 处理 |
|---|---:|---|
| 🔴 异名→正名 + 🟠 名称/科名不一致 + ➕人工定夺 4 条 | **69** | 自动改（含正文） |
| ⏭️ 近似种对比自指，机器不能改 | **5** | 整页跳过，待人工/AI 重写正文 |
| ⏸️ 柽柳 | 1 | **用户尚未定夺**，明确不动 |
| ✅ 与名录一致 | 154 | 不动 |

### ⏳ 待办
- 上面 69 条的 `--apply`（dry-run 已干净）。
- 5 页近似种对比的正文重写（建议走金叶重生成，而不是手改）。
- 柽柳的人工定夺。
- **用户报的新 bug 未查**：识别出疑似时提示「二次自动复核：未运行（模型限流/超时/未配置）」，
  但后台自检显示读图 ✅、连通 ✅、可见 229 个模型。→ 复核那条链路的失败原因文案与
  真实状态对不上，要查 `secondOpinionIdentify` 的静默 null 分支。
- 前端三块（#tag 按钮改造、+标签#tag 补回并支持按科属/地点/各名录筛选、
  项目/博客 PDF/PPT 转图片防下载）—— **本轮未开始**。

## ✅ 2026-07-24（续）— 存量回填已 APPLY + 复核 bug 已修（待部署复核修复）

### 回填结果（已写入线上库）
- **69 条**存量条目按 2026 名录改完（字段 + Storage 正文），+ 猬菊/羊柴 2 条 = 库里 71 条 2026 留痕。
- **5 页**近似种对比自指整页跳过（猪殃殃/辽东栎/中间荸荠/慈姑/茶条枫）—— 待金叶重生成正文。
- **柽柳** 待用户定夺（正名 Tamarix chinensis，但名录分布不含内蒙古）。
- 重试循环踩到「apply 跨两次」：第一遍改 38 条断网，第二遍重跑，已改的判 accepted 跳过，
  补完剩 31 条 → 合计 69。**幂等，重跑安全**（这正是 dry-run/apply 都从名录现判、不靠外部状态的好处）。
- 实测受保护片段生效：热亚海芋页「海芋属」保留 3 处、0 处误改；碱韭页「多根葱」归零。

### 🔴 复核「未运行」的真凶（用户报的 bug，已修，**待部署**）
用户看到「二次自动复核：未运行（模型限流/超时/未配置）」，但后台自检显示 ✅ 读图 ✅ 连通 229 模型。
- **两个问题叠加**：
  ① **配置**：二次复核控制台只配了 `qwen3.8-max-preview`，它 07-24 视觉自检被判 `blind`。
     用户看到的 ✅ 是**另一个控制台**（xiaop_model_config 的 kimi，07-23 pass）的；
     「可见 229 模型」只证明 Key 连得通，**不代表该模型读图**。
  ② **代码 bug**（[identify-plant.functions.ts](src/lib/identify-plant.functions.ts) `withSecondOpinionSlots`）：
     blind 过滤被兜底架空 —— 剔除 blind 项后 `seeing` 为空，就回退 `loadSecondOpinionConfig()`，
     而它读的正是**同一控制台的 sequence[0]**（刚被剔除的瞎模型），照样打一遍、必然失败，
     且因 slots 非空，「全部不读图」的说明不会报出 → 用户只看到语焉不详的「复核未能完成」。
  - **修**：配了序列但全 blind → 直接 `[]`（不再兜底回同一个瞎模型），并报明是哪个模型、去哪换。
- ⏳ **待部署**：这个修复 + 上一轮的 schema-instruction 修复都在 dist 里没上线。
- ⏳ **用户侧**：去二次复核控制台换一个能读图的视觉模型，点「视觉自检」验证。

### 前端三块 —— 刚开始摸排
- 简介卡重复 `#tag` **不在** buildSummaryCardHtml（那里只有 registryChipsHtml，是要保留的）。
  真正的 `#盐生植物…` 在 [drafts.$id.tsx](src/routes/drafts.$id.tsx) 约 1100 行（`draft.tags` 平铺）。
- 待做：①简介卡 #tag → 彩色「手动添加#tag标签」下拉按钮（只选已有标签）
  ②编辑页补回「+标签#tag」按钮 + 按科属/地点/各名录筛选加条目
  ③项目/博客 PDF/PPT 转压缩图片、右键只能存图。

## ✅ 2026-07-24（续四）— 二次复核超时真凶 + 手动 tag 置顶绿框 + 十星打分（tsc/build EXIT=0；~~NOT deployed~~ → **实际已随 07-25 15:11 的 adf3316b 上线**（见文首「部署真相」））

用户线上实测报告：`二次自动复核：未运行 —— qwen3.7-plus 超过 30 秒未返回`，
「换了好几个模型，而且自检三条链路通过了，但仍然是二次复核没有运行」。

### 1. 🔴 复核超时 —— 症结是「自检根本测不出真复核要多久」
**这和 07-24 上午那个 `response_format` 的坑是同一类错误**：拿一个**不具代表性的探针**
去证明真实链路可用。
- 视觉自检发的是 **846 字节四色小图 + 只要四个词的回答**（约 2 秒）；
- 真复核发的是**整张实拍照片 + 最多 4 张补拍照 + 要一段 150–260 字导语**；
- 而复核链路配的多半是**推理模型**（qwen3 / glm / deepseek 的 thinking 版），
  默认先写一大段思维链才作答 —— 40 秒以上是常态。

自检回答的是「key 能用吗、模型看得见图吗」，**从来不回答「它够不够快」**。全绿是真的，
复核超时也是真的，两者不矛盾 —— 但界面上只写了「超过 30 秒未返回」，读起来像自相矛盾。

**五处改动**（[identify-plant.functions.ts](src/lib/identify-plant.functions.ts)、
[ai-key-pool.ts](src/lib/ai-key-pool.ts)、[vision-probe.ts](src/lib/vision-probe.ts)）：
1. **关思考，厂商无关**。新增 `THINKING_OFF` = `{enable_thinking:false,
   reasoning_effort:"low", thinking:{type:"disabled"}}`（Qwen / OpenAI / GLM 三种写法一起发）。
   同时把这三个键加进 `TUNABLE_PARAMS` —— 于是既有的「**从 400 报错里认出是哪个参数惹的祸、
   摘掉重试**」机制自动罩住它们，不用维护「哪家支持哪个参数」的表。复核与顶替定种两条路都加。
2. **改流式**。复核从 `postOpenAICompat` 换成 `postOpenAICompatStream`。中转在上游没吐完
   之前一个字节都不回，整段生成时间全砸在「等第一个字节」上；开流后 token 边生成边回。
   中转不支持流式会回 599（该函数既有约定），**退回非流式再打一次**，不白判失败。
3. **总预算取代每项 30 秒**。原来每项固定 30 秒 × N 项 —— 配 3 项最坏 90 秒，而 phase-1 是
   **前台 HTTP 请求**，Cloudflare 边缘 100 秒就掐，等于把整次识别一起赔进去。
   现在 `SECOND_OPINION_TOTAL_BUDGET_MS = 45s` 跨全部序列项共享，单项封顶 28s，
   剩余不足 8s 就不再起新的一项，并**如实告诉用户还剩几项没试**。
4. **缩输入缩输出**。补拍照 4 张 → 2 张（图片是最重的输入，第 3、4 张对结论的边际贡献
   远不抵它对超时的贡献）；`max_tokens` 3000 → 1200（这张卡最长字段就是 260 字导语；
   这个上限同时是**思维链的天花板**，调小 = 给「想太久」封顶）。
5. **报真话**。超时文案改成点破自检局限的一整段：写明实际等了多少秒、说明自检为什么
   测不出这个、并给出可执行的下一步（换非推理 / turbo / non-thinking 版本，慢的排后面）。
   另外 `probeSlotVisionFn` 现在**量自检本身的耗时**并写进检测说明
   （新增 `speedNote()`）：≥12 秒直接判「真复核几乎必然超时」，≥5 秒警告偏慢，
   即使很快也明说「快不等于复核不会超时」。

⛔ **没验的部分**：改动全在服务端识别链路上，需要真实 API key + 登录才跑得起来，
**本地没有实测**。只过了 tsc / build。上线后请看服务端日志里的
`[SecondOpinion] … 复核完成，耗时 N ms`（新加的）来确认。

### 2. ✅ 手动挂的 #tag 排第一 + 绿框
- [conservation.ts](src/lib/conservation.ts) 新增 chip 类型 **`tag_manual`**，与 `tag` 分开：
  `tag` = AI 自动填的**特征词**（只进搜索和卡签）；`tag_manual` = 人在「手动添加 #tag 标签」
  里挑的、**`tags` 表里真实存在**的主题标签（决定进哪个专题页）。
  两者都躺在同一个 `tags` text[] 里，光看数组分不出来 —— 靠**名字在不在 tags 表里**判定。
- **排在全部 chip 最前**（在重点保护、CITES 之前）。理由：这排卡签里其余各项都是
  「按学名自动匹配名录」的机器判断，只有它是一次明确的**人的判断**。
- **绿框**：网页 `border-2 border-leaf-deep bg-leaf-deep/10` + 半粗字；
  分享卡（canvas）同色 + 描边 `lineWidth` 2→4（卡上没有 hover 和链接，只剩颜色和线宽能表达）。
- **slug 从库里带走，不用 slugifyTag 现算** —— slug 是建标签那一刻存进库的，规则日后一改
  现算就全 404。`RegistryChip.slug` 由 `useRegistryChips` 从 `tags` 表填。
- 🔴 顺带修掉一个**真实存在但一直没人碰到的断链**：原来 tag chip 的链接写
  `params={{ slug: c.label }}` —— 拿**标签名**当 slug。中文标签的 slug 是
  `slugifyTag()` 编码过的十六进制串，两者根本不相等，点进去必然 404。
  现在 `tag_manual` 用库里的真 slug；`tag`（特征词）维持原状（那条路本来就只对纯 ASCII 有效）。
- 🔴 还修掉一个**数据来源不一致**：主题标签在草稿和已发布条目上**存的地方不一样** ——
  草稿写 `plant_drafts.tags`，而编辑器写的是 **`plant_tags` 关联表**（`plants.tags` 里只有特征词）。
  `useRegistryChips` 新增 `plantId` 参数：给了才会把关联表里挂的主题标签算进来，
  [plants.$slug.tsx](src/routes/plants.$slug.tsx) 已传。不改的话，编辑在详页编辑器里挂的标签
  **一个都不会出现在卡签里**。
- [drafts.$id.tsx](src/routes/drafts.$id.tsx)：把 `tagDraftLocal` 乐观状态**提到
  `useRegistryChips` 之前**，卡签读 `draftTags` 而不是 `draft.tags` —— 否则刚挂上的标签
  要等一次 refetch 才出现在卡签里，用户点完看不到反应会以为没存上。

### 3. ✅ 十星置信度打分
- [identify-trace.ts](src/lib/identify-trace.ts) 新增纯函数 `confidenceStars(pct)` →
  1–10（`CONFIDENCE_STARS_TOTAL = 10`，每颗 10%）。
  用 **ceil 不用 round**：`computeIdentifyConfidence` 下限是 5%，四舍五入会得到 0 颗星，
  而「0 颗星」看起来等于「没识别出来」，与「识别出来了但把握很低」不是一回事。
  满星只可能来自 100%，而该函数永不返回 100 —— 满星是刻意留白的。
- **草稿页**：新增 [confidence-stars.tsx](src/components/confidence-stars.tsx)，
  渲染在「识别过程 · 综合可信度 x%」正下方。星形用**内联 SVG** 画，不用 ★ 字符 ——
  那个字符各系统字体的字面大小/基线差得远，十颗排一行会歪。空心星也画出轮廓，
  不然用户数不出满分是多少。
- **分享卡**：`ShareCardData.confidencePct` → 照片**右上角**一枚半透明深色圆角徽标，
  内容「置信度：x 颗星」+ 十颗星（`drawStar` 手算五角星路径，同样为了跨端一致）。
  画在照片**上面**是刻意的：分享卡多半被截图转发，看到的人只扫一眼图，
  把握程度必须和照片同框，否则一张「疑似」卡会被当成确诊结果传出去。
  已发布详页的分享卡不传这个字段 → 整枚徽标不画。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0。
- 浏览器实测（无需登录，直接 import 模块跑）：
  - 星级取整：`0%→0★ 5%→1★ 10%→1★ 45%→5★ 50%→5★ 51%→6★ 90%→9★ 99%→10★`
  - chip 排序：`tag_manual:北方湿地(beifang-shidi)` → `protected:国家二级保护` →
    `griis:入侵物种` → `catalog:鄂尔多斯` → `tag:盐生植物` → `tag:多年生草本` ✓
    （手动的排第一并带上了库里的真 slug，AI 特征词沉到最后）
  - 真渲染了一张 1080×1920 分享卡并截图核对：徽标稳稳压在照片右上角，
    5 颗琥珀实心 + 5 颗白描边空心，深色底衬在浅色照片上清晰可读。
- ⛔ **复核链路本身没有实测**（需真实 key + 登录）；标签相关的三处 UI 也仍未做界面实测。

### 下一步
- 部署（07-24 续三、续四两批改动均**未上线**）。
- 上线后看 `[SecondOpinion]` 日志确认复核是否真的跑完了，以及耗时多少。

## ✅ 2026-07-25 — 二次复核超时真凶 + 手动标签置顶绿框 + 10星打分（tsc/build EXIT=0；已浏览器实测；~~NOT deployed~~ → **实际已随 07-25 15:11 的 adf3316b 上线**（见文首「部署真相」））

用户报（线上）：识别「Pentanema britannica」综合可信度 45%，二次复核显示
「未运行 —— qwen3.7-plus 超过 30 秒未返回」，且换了几个模型、自检三条链路全过，
复核照样不运行。另提三项新需求：手动加的 tag 要排第一 + 绿框；置信度除百分比外加 10 星打分。

### 1. 🔴 二次复核超时 —— 根因是「推理模型 + 非流式 + 每项 30s」三者叠加
不是 bug，是**配置注定超时**。qwen3.7-plus / glm-thinking 这类推理模型默认先写一大段
思维链再作答，加上复核发的是整张实拍照 + 要 150–260 字导语，40 秒起步。而 phase-1 是
前台 HTTP 请求，Cloudflare 边缘 100 秒就掐 —— 每项 30s × 多个序列项直接把整次识别赔进去。
- **总预算跨序列项**：`SECOND_OPINION_TOTAL_BUDGET_MS=45s`，见底就停、不再起注定超时的新项，
  如实报「预算已用完，还剩 N 项未试」。（原来是每项固定 30s，最坏 90s。）
- **改流式** `postOpenAICompatStream`：复核多走第三方聚合中转，中转**上游没吐完前一个字节都不回**，
  整段时间全砸在等首字节 —— 这正是「换几个模型都不行」的直接原因。流式后 token 边生成边回，
  同样的模型常能在预算内跑完。中转不支持流式会回 599 → 自动退回非流式重试一次。
- **厂商无关地关思考**：新增 [ai-key-pool.ts](src/lib/ai-key-pool.ts) 的 `THINKING_OFF`
  （`enable_thinking:false` / `reasoning_effort:"low"` / `thinking:{type:"disabled"}` 三写法一起发），
  并把这三个键加进 `TUNABLE_PARAMS` —— 不认的那个被 400 拒收时，既有的「从报错里认出参数、
  去掉重试」机制会自动摘掉。既不用维护「哪家支持哪个」的表，也不会多发一个键把请求打死。
- **缩输入**：补拍照 4→2 张（图是最重的输入）；`max_tokens` 3000→1200（给推理模型思维链封顶）。
- **报真实原因**：超时信息带**实测耗时**，并点破「后台自检全绿 ≠ 真复核能跑完」——
  自检发 846 字节小图 + 只要四个词的回答（约 2 秒），真复核是整张实拍照 + 一段导语，
  两者根本不是一个量级。**这就是用户最费解那一点的答案**。视觉自检结果里也追加了本次自检
  耗时（[vision-probe.ts](src/lib/vision-probe.ts) `speedNote`）：连自检都慢的模型跑复核必超预算。
- ⚠️ **改完复核更可能"跑完"，但不保证一定"确诊"**——它照样可能诚实地维持疑似。用户如果
  仍看到「未运行」，控制台该换的是**非推理的视觉模型**（或该模型的 non-thinking / turbo 版），
  失败信息现在会明说这一点。

### 2. ✅ 手动加的主题标签：排第一 + 绿框
- [conservation.ts](src/lib/conservation.ts) 新增 chip 种类 `tag_manual`，与 `tag` 分开：
  `tag` = `plants.tags` 里 AI 填的**特征词**；`tag_manual` = 名字命中 `tags` 表的**主题标签**
  （人在「手动添加 #tag 标签」里挑的）。`registryChips` 把 `tag_manual` **排在全部 chip 最前**
  （它是这排里唯一一次「人的判断」，其余全是按学名自动匹配名录的机器判断）。
  slug 从库里带过来、不现算（现算规则一改老链接全 404）。
- 区分两者靠新增的 `knownTags`（名字→slug 映射）。[use-registry-chips.ts](src/lib/use-registry-chips.ts)
  拉 `tags` 表 + `plant_tags` 关联表传进去。**草稿**的主题标签在 `plant_drafts.tags`（与特征词
  同数组，靠是否命中 tags 表分开）；**已发布条目**在 `plant_tags` 关联表，所以详情页额外传
  `plantId`，否则手动挂的标签一个都不显示。
- 绿框：[registry-chips.tsx](src/components/registry-chips.tsx) `tag_manual` =
  `border-2 border-leaf-deep bg-leaf-deep/10 text-leaf-deep font-semibold`
  （粗全实边框，与 protected 的 `border-leaf-deep/50` 细半透明边区分开）；
  分享卡 [share-card.ts](src/lib/share-card.ts) `chipColors` 里 `bold:true` → 描边 4px。
  永远可点进专题页（slug 是库里真值）。

### 3. ✅ 10 星置信度打分
- [identify-trace.ts](src/lib/identify-trace.ts) 新增纯函数 `confidenceStars(pct)=0..10`
  （`ceil(pct/10)`，保证任何有效结果≥1 星；满星只可能来自 100%，而算法上限 99% → 刻意留白）。
- 草稿页：「识别过程 · 综合可信度 x%」下面渲染
  [confidence-stars.tsx](src/components/confidence-stars.tsx)（10 颗 SVG 星，黄实/灰空 + 「置信度：x 颗星」）。
- 分享卡：照片**右上角**画「置信度：x 颗星」+ 10 星徽标（半透明深底衬托，浅色天空也看得见）。
  手画五角星路径，不用 `★` 字符（各系统字面大小/基线差太多，十颗排一行会歪）。两处共用
  `confidenceStars()` 取整，同一次识别页面与卡上星数必然一致。
  ⚠️ 卡签**不传**给识别分享卡（替用户断言物种身份），但置信度星**必传** —— 它标的恰恰是
  「这结论有多不确定」，越疑似越该带上。

### 验证证据（浏览器实测，无需登录）
- `confidenceStars`：0→0 / 5→1 / 11→2 / 19→2 / 45→**5** / 99→10 / 100→10。
  用户报的那次（gemini low=45、Pl@ntNet 19% 不计入）→ 45% → **5 星**。
- `registryChips` 排序：主题标签「北方湿地」(tag_manual, 带 slug) **第一**，
  然后 protected/cites/griis/catalog，AI 特征词「盐生植物」(tag) **最后**。
- **真渲染一张分享卡**并截图核对：照片右上角「置信度：5 颗星」5 金 5 空；chip 行
  北方湿地(粗绿框)→国家二级保护(细绿)→CITES 附录II(紫)→盐生植物(灰)。
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0；vision-probe 单测 26 条全过。
- ⛔ 二次复核的超时修复**只能靠线上真识别验证**（要模型调用 + 登录 + 真照片），本地无法实测；
  代码路径已 tsc/build 通过，逻辑见上。

### 下一步
- 部署（本轮全部未上线）。
- 上线后用一次真识别验证二次复核能在预算内跑完；若仍超时，按失败信息在控制台换非推理视觉模型。

## ✅ 2026-07-25（续）— 草稿页三修 + PDF 插入真凶查明（tsc/build EXIT=0；已浏览器实测；~~NOT deployed~~ → **实际已随 07-25 15:11 的 adf3316b 上线**（见文首「部署真相」））

用户报四件：①植物人文没放在 section i ②配图宽度没和拍摄记录配图框对齐 ③进一步介绍草稿页
「莫名其妙的空挡」还在 ④项目/博客页 PDF/PPTX 转图片的显示还是 bug。**先问清了两处意图**：
①用户要「植物人文换位置」→ 追问后拍板**放最前成 Section I**；④用户描述具体现象＝
「插入文件按钮非常难选择到 + 选了 pdf/ppt 后预览里没展示」。

### 1. ✅ 植物人文 → Section I（[plant-html-template.ts](src/lib/plant-html-template.ts)）
新顺序：**I 植物人文 · II 形态特征 · III 生境与分布 · IV 名称和分类趣闻 · V 生长条件**。
- 🔑 **只改罗马数字与 DOM 先后，`sec_img_N`↔内容的绑定保持不变**（人文=sec_img_4、
  形态=sec_img_2、生境=sec_img_3）—— 这是 [photo-slots.ts](src/lib/photo-slots.ts) `DRAFT_SLOTS`
  的口径，动了它「花/果配到人文栏、叶配到形态栏」的器官分配就全乱。
- draft-enhance 的「点击替换」按 DOM 序（querySelectorAll）读写 slot 下标，viewer 与
  replaceImageInDraftHtml 两边同序，reorder 后仍一致，不破。
- ⚠️ **副作用（已告知用户，未改）**：人文槽只收 flower/fruit/specimen，公开图最少，
  所以 Section I 现在**经常是空槽**（「暂无花果公开照片」）。用户此次只选了「换位置」，
  没选「给人文栏兜底配图」，故未动 photo-slots 的诚实空槽设计。若要让首栏别老空，
  下一步可给人文槽加 plant/habitat 兜底（仍保留「真没有才空」）。

### 2. ✅ 配图框对齐拍摄记录（同文件 CSS）
`.sec-img` 的裱边从薄的 `0 0 0 3px/4px`（且无投影）改成与 hero `.img-slot` **完全同一套**：
`0 0 0 5px paper, 0 0 0 6px rule-soft, 0 14px 30px -12px rgba(30,16,8,.26)`。
`.sec-figure` 宽 280→320。浏览器实测 `getComputedStyle(...).boxShadow` 两者**逐字节相等**。

### 3. ✅ 「莫名其妙的空挡」＝ `.section-with-img{align-items:center}`
center 把配图/「暂无」虚线框吊在正文垂直中央，正文一长，图上下各裂一片空白。
改 **`align-items:start`**（顶对齐），图跟正文首行齐平，短的一侧只在下方留白＝正常。
渲染实测：5 个分区高度归一（有图区 249px），无浮空缝隙。

### 4. 🎯 PDF/PPTX 显示：**建了临时路由 `/pdftest` 全链路实测——PDF 管线本身没 bug**
- 用 reportlab 造了张 3 页真 PDF，在**真 Vite/BlockNote 环境**里跑
  `docToImages → appendImages → onChange 序列化 → .prose-project 显示`：
  **3 页全部渲染成 image/png(93–98KB)、序列化 HTML 有 3 个 `<img>`、编辑器与显示 div 都
  正常出图（893×1263，complete=true），控制台零报错。** 测完已删路由与测试 PDF。
- 先前怀疑的两条都被实测推翻：① BlockNote `onChange` **确实**会在程序化 `insertBlocks`
  上触发（源码：绑在 tiptap `update` 事件，`onChange(e,t=!0)` 默认不过滤）→ 图会进 HTML；
  ② `.prose-project` 能正常渲染 BlockNote 全量 HTML 的 `.bn-visual-media` 图。
- **真因＝用户根本没能把图插进去**：ⓐ「插入文件按钮非常难选择到」——按钮原来是
  `text-xs` 细边框、和一长串说明挤在 `flex-wrap` 同一行，窄屏难点中；ⓑ `accept` 只收 `.pdf`，
  用户想插 PPT 时文件在选择框里被灰掉、**根本选不中**（＝「很难选择到文件」的另一半），
  而 PPT 本就该走「先导出 PDF」，却连选中拿到那句提示的机会都没有。
- **✅ 改法**（[project-editor.tsx](src/components/project-editor.tsx) +
  [blog-editor.tsx](src/components/blog-editor.tsx)）：按钮放大成 `border-2 + text-sm + font-semibold`、
  说明挪到按钮**下方单独成行**；`accept` 放开到 pdf+ppt+pptx+odp，选中 PPT 后
  `docToImages` 给出「请先导出为 PDF」的明确 toast。
- ⚠️ **诚实边界**：我只能证明 happy path 通。若用户手上**某个具体 PDF** 仍不显示，
  那是文件级问题（加密/扫描件/异常字体），需要用户把那份 PDF 发来复现——非本轮能覆盖。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0；pdfjs 仍是独立懒加载 chunk（428KB+1.19MB），
  主包不受影响；`dist/` 里无 pdftest 残留。
- 草稿模板：浏览器实测顺序 = I 植物人文…V 生长条件；框 boxShadow 与 hero 逐字节相等；
  align=start、分区高度归一。
- PDF：`/pdftest` 端到端实测（见上），三处计数 imgcount=3 / displayImgs=3 / editorImgs=3。

### 下一步
- 部署（本轮四项改动**均未上线**）。
- 上线后请用户复测：①草稿页植物人文在最前、配图框与拍摄记录同款、无空挡；
  ②项目/博客编辑器「插入 PDF/幻灯片」按钮好点了、PDF 能逐页出图。
- 若某具体 PDF 仍不显示 → 要用户提供该文件。
- （可选）给人文图槽加 plant/habitat 兜底，避免 Section I 常空。

## ✅ 2026-07-25（续二）— 人文配图兜底 + 草稿三档区分 + 分享卡 og:*（tsc/build EXIT=0；已实测；~~NOT deployed~~ → **实际已随 07-25 15:11 的 adf3316b 上线**（见文首「部署真相」））

用户三项新需求：①植物人文配图用**植株/插画**兜底、**生境图不在此兜底**；②待审草稿列表把
**银叶草稿 / 金叶skill / 快速识别简介**三档区分开；③点分享链接不要固定「Plantspedia·全民植物志 /
由社区共同编纂…」，要**植物照片做缩略图 + 标题「Plantspedia草木志·植物名」+ 简介用该植物 summary**。

### 1. ✅ 人文图槽兜底（[photo-slots.ts](src/lib/photo-slots.ts)）
`DRAFT_SLOTS` 植物人文 `want`：`["flower","fruit","specimen"]` → **`["flower","fruit","specimen","plant"]`**。
- 加 `plant`（植株）、保留 `specimen`（插画/标本），**刻意不加 habitat** —— 生境图有自己的
  「生境与分布」栏，挪来人文既跑题、又会把那栏抽空（用户明确要求）。missingNote 改「暂无该物种的公开配图」。
- assignSlots 两轮制保证不抢：人文 want[0]=flower，round-1 不碰 plant；只有 round-2 且还有富余
  plant 时才兜底，名称/生长两个 want[0]=plant 的槽照旧优先。`scratch/photo-slots.test.mjs` **14 条全过**。

### 2. ✅ 草稿三档判据修正（[draft-card.tsx](src/components/draft-card.tsx) `draftTier`）
老 bug：银叶判据是「html_content 非空」，可**快速识别也会把简介摘要卡写进 html_content**，
于是所有快速草稿被错标成「银叶草稿」，三档在列表里根本分不开（STATE 2026-07-21 早记过这坑）。
- 改判据：银叶 = **`ai_payload._enriched === true`**；金叶 = `published_plant_id` 非空；其余 = 快速识别简介。
  老草稿无 `_enriched` 字段时，才回落到「html_content > 4000 字符 ≈ 整页正文」的长度启发式。
- 标签统一成用户用词：**银叶草稿 / 金叶详页 / 快速识别简介**。逻辑替身测试 **6/6 过**
  （quick/silver/gold/老银叶/老快速/无payload 全部判对）。
- ⚠️ **数据事实（已告知用户）**：金叶 skill 是**一键直接落库到 `plants`**（source=gold_oneclick，
  status 立即 published），**不进待审 `plant_drafts` 队列**。所以「待审草稿列表」里实际只会出现
  银叶+快速两档；金叶那档只在已收录视图/未来若把金叶改走审核时才出现。若用户要金叶也过审，
  是另一处流程改动，本轮没做。

### 3. ✅ 分享卡 og:*（[plants.$slug.tsx](src/routes/plants.$slug.tsx) + [drafts.$id.tsx](src/routes/drafts.$id.tsx)）
根因：plants.$slug 的 `head()` 只写了 `title`/`description`/`og:image`，**没写 `og:title`/`og:description`**，
于是这两个**继承 [__root.tsx](src/routes/__root.tsx) 的站点默认**（"Plantspedia·全民植物志 / 由社区共同编纂…"）——
微信/Twitter 抓的正是 og:*，所以分享出去永远是那句固定文案。
- plants.$slug `head()` 重写：显式写全 `og:title`/`og:description`/`og:image`/`twitter:*`；
  **标题=`Plantspedia草木志·{中文名}`**、描述=该植物 `summary`（截 180）、缩略图=`cover_url`。
- drafts.$id **原来根本没有 loader/head**（分享草稿链接=站点默认）。新增 `loader`（匿名 client 走 SSR，
  `try/catch` 读不到就回 null、不阻塞）+ 同款 `head()`（缩略图用草稿 `photo_url`）；loader 结果顺手
  当 useQuery 的 `initialData`，省一次首屏抓取。plant_drafts RLS 是 `GRANT SELECT TO anon` +
  `FOR SELECT USING(true)`，匿名 SSR 读得到 → 草稿分享卡同样生效。
- **SSR 实测**（`curl` 原始 HTML）：`/plants/pentanema-britannica…`（旋覆花）→
  `<title>` 与 `og:title` = `Plantspedia草木志·旋覆花`、`og:description` = 旋覆花真实 summary、
  `og:image` = 该条目 Supabase 照片绝对 URL、`twitter:card=summary_large_image`。
  草稿路由用不存在 id 实测 HTTP 200、优雅回落默认标题、不 500。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0。
- photo-slots 单测 14/14；draftTier 逻辑替身 6/6；plants.$slug og:* SSR 原始 HTML 实测通过。

### 下一步
- 部署（续、续二两批共 7 处改动**均未上线**）。
- 上线后复测微信/Twitter 分享一条已收录条目 → 应显示植物照片 + 「Plantspedia草木志·名称」+ 简介。
- 若要金叶 skill 产物也进「待审」队列并在列表里显示金叶档，需单独改金叶落库流程（本轮未做）。

## 🔧 2026-07-26 — 卡签配色分名录 + 底部只留手动标签 + 项目页分享/编辑 + 补拍多图（四项全完成）

用户四项需求**全部完成**：`tsc --noEmit` EXIT=0，四项都在 dev（:5203，连生产 Supabase）
实测过。**均未部署。**

### 1. ✅ 卡签一名录一色系（4 个渲染孪生体必须同改）
用户要求：手动标签加粗描边（保留）但底色要与其它区分；GRIIS 入侵=橙、国家保护名录=粉、
内蒙古/地区保护名录=黄、CITES=紫（原样）、GTS=蓝、自动特征词=无底色（原样）。
- [conservation.ts](src/lib/conservation.ts)：`RegistryChipKind` 把 `protected` **拆成**
  `protected_national` / `protected_regional`；`registryChips()` 按 `list.province === "国家"` 分派。
  province 为空按地区处理（国家名录一定带「国家」，缺省更可能是地方名录漏填）。
- 三处渲染端同步：[registry-chips.tsx](src/components/registry-chips.tsx) TONE（网页 CSS）、
  [share-card.ts](src/lib/share-card.ts) `chipColors()` + PALETTES 加 protNat/protReg/gtsBlue/griisOrange
  （light+dark 各一套）、[identify-plant.functions.ts](src/lib/identify-plant.functions.ts)
  `registryChipsHtml()` TONE（服务端简介卡，旧 `protected` 键保留兜底）。
- ⚠️ 坑：这四处是**同一排卡签的四个实现**，漏一个就会出现「网页粉、分享卡绿」的不一致。
- **手动标签「一标签一绿」**（用户原话：不同的绿色系对应不同的手动添加标签）：
  conservation.ts 加 `manualTagTone(name)`（djb2 哈希 % 4）+ `RegistryChip.tone`，
  `registryChips()` 建 tag_manual chip 时算好带出去。三个渲染端各存同一组色号：
  墨绿 #2d6a4f / 青绿 #17726b / 苔绿 #5b7c2a / 松绿 #3f8f5a（分享卡深色主题另有提亮版）。
  纯哈希 → 三处不查库也永远同色；撞色无害（绿号只做视觉区分，身份靠 slug+文字）。
  ⚠️ registry-chips.tsx 的类名**必须写成完整静态字符串**，拼接的 `bg-[${x}]` Tailwind 扫不到。
- 实测（dev + 生产数据）：肉苁蓉 → 国家二级=粉 / 内蒙古省级=黄 / CITES 附录II=紫 三色分明；
  红豆草黄芪 → `圣水草原的植被` 苔绿 2px 描边 + 12% 底色 + 600 字重，其余 8 个特征词
  1px 边、`rgba(0,0,0,0)` 无底色。

### 2. ✅ 底部 #tag 只留手动添加的标签（[drafts.$id.tsx](src/routes/drafts.$id.tsx)）
`draft.tags` 里混着 AI 特征词与手动主题标签，底部 TagPicker 原先把**两拨都**铺成可删的 #标签。
- 加 `manualDraftTags` / `autoDraftTags`（按名字在不在 `tags` 表里切分，复用 `["all-tags"]` 缓存
  —— useRegistryChips 已在拉，不额外发请求）；TagPicker 只吃 manual 那拨。
- `saveManualDraftTags()` 写库时把 autoDraftTags **原样并回去**，特征词一个都不能丢
  （它们还要喂顶部卡签行和搜索）。顶部卡签行行为不变（两拨都显示，特征词无底色）。

### 3. ✅ 项目页分享/编辑按钮（[projects.$id.tsx](src/routes/projects.$id.tsx)）
镜像博客页：`canEdit = user.id === project.author_id` → 自己的项目显示「编辑」（→
`/admin/projects/edit/$id`）+ ShareButton；别人的只有 ShareButton。

### 3 实测：匿名访客看别人的项目 → 只有「分享」，无「编辑」。（登录态那一支没验，无凭据。）

### 4. ✅ 补拍最多 3 张同时识别
**关键发现：识别管线本来就支持多图** —— `priorInline: InlineImage[]` 一路喂给 Pl@ntNet 后的
一线模型与二次复核模型（`secondOpinionIdentify` 刻意 `slice(0,2)` prior + 当前 1 张 = 3 张上限，
注释写明「每多一张都同时推高上传耗时与首字延迟」）。用户要的「一次 3 张」正好落在这个既有
上限内，**不必改模型侧**，只需让补拍能一次带 2 张额外新图进来。三处上限必须同为 3：
`MAX_RETAKE_PHOTOS`（客户端）、`SubmitInput.extra_photos.max(2)`、模型侧 slice(0,2)。

服务端 [identify-plant.functions.ts](src/lib/identify-plant.functions.ts)：
- `SubmitInput` 加 `extra_photos`（≤2 张 `{base64,mime}`）。
- 额外照与主图**并行上传**，但**失败不致命**：主图传不上=没封面必须报错，角度照传失败只是
  少一个视角（模型吃的是内存字节、根本不经过存储）→ 只有传成功的 URL 才进 `allPhotos`，
  免得草稿相册里出现裂图。
- 额外照转 InlineImage **插在 priorInline 最前面**：下游一律 slice 取前几张，这一轮刚拍的
  比几轮前的旧照更该被看见。
- `plantNetIdentify()` 加第三参 `extraDataUrls`：Pl@ntNet 官方支持一次多图综合打分，是它自家
  的提准手段。⚠️ `images` 与 `organs` 必须**成对**追加，少一个 organs 整个请求 400。

客户端 [camera-identify.tsx](src/components/camera-identify.tsx)：
- **删掉补拍的自动提交**（原来一选完就识别）——一次能带 3 张时自动提交会把用户锁死在第 1 张。
  现在停在预览页，由「AI识别」一次性提交。
- 补拍时相册 input 开 `multiple`：一次选 3 张 = 主图 + 2 张角度照，不用点三轮。
- 预览下方新增角度照面板：主图 + 可删角度照缩略图、「再拍一张 / 从相册加一张」（到 3 张后
  自动隐藏）、张数计数。`addExtraFromCamera/Album` **不重置也不重新请求定位**（坐标属于这一
  株植物，主图那次已取好，再走一遍只会把好不容易拿到的坐标清空）。
- 角度照 blob: URL 在卸载时 revoke —— 识别成功是 SPA 跳转、document 不销毁，不显式回收
  每补拍一轮泄漏几 MB。

**实测**（dev :5203，用 canvas 造图注入 file input）：
- 相册一次选 3 张 → 「本次将同时识别 3 张照片」、2 个可删缩略图、加号按钮消失；选第 4 张被
  上限挡下并提示；× 删除后计数回退、按钮复现。
- 拦截 fetch 抓到真实请求体：`extra_photos` = 1 项 `{base64: 6584 chars, mime: image/jpeg}`，
  同时带 `retake_count:1` / `species_hint_title:绶草` / `species_hint_sci:Spiranthes sinensis`
  （**故意拦下没真发**，不烧一次识别额度）。

### ⚠️ 排查笔记：自动化浏览器里 toast 永不消失 ≠ bug
测试时看到「正在优化图片…」等 loading toast 一直堆着，一度以为是 `toast.dismiss` 失效。
实测：`document.hidden === true`、`hasFocus === false`（Browser pane 的页面跑在隐藏态），
连 `duration:800` 的普通 toast 也不消失 —— 是浏览器对隐藏页的定时器节流，不是应用问题。
**别为这个"修" sonner。** 另：`querySelectorAll('[data-sonner-toast]').remove()` 会把 React
管的节点抽走，下次渲染直接 `insertBefore` 崩页——要藏就注入 CSS，别删节点。

### 下一步
- 部署（本轮四项 + 上面两批共 11 处改动**全部未上线**）。
- 上线后建议实测一次真补拍（一次传 3 张）：看 Pl@ntNet 是否接受多图（不接受会 400，
  链路会静默退回单图 hint —— 日志里搜 `[Pl@ntNet] HTTP 400`）。

## ✅ 2026-07-26 — 识别两个真 bug：假失败（Load failed 但后台已成功）+ 模型闲聊污染字段
（tsc/build EXIT=0；81 条单测全过；识别页浏览器实测无回归；**NOT deployed**）

用户报两件：①识别中切出浏览器再回来必显示「识别失败（网络未连通）…等待了约 101 秒」，
**但重点一次就弹「这张照片已经识别过」——后台其实早就成功了，报错是假的**；
②疑似状态下补拍，出现「疑似长刚毛草（疑似）。地点：…。状态：已完成识别与撰写。返回：JSON
格式数据。…祝您生活愉快！再见！。注：以上内容为模拟回复…。再见！。祝好！」这类模型元话语 + 复读。

⚠️ **协作提示**：排查期间发现**另一个会话正在并发编辑** `camera-identify.tsx`(09:48) /
`identify-plant.functions.ts`(09:56) / `STATE.md`(10:02)（它在加「一次识别最多 3 张照片」
`MAX_RETAKE_PHOTOS`/`extra_photos`）。已暂停并请用户关掉那个会话后才动这两个文件，
**未覆盖它的改动**（本轮改动是在它 1143/9587 行的版本之上做的）。

### 根因（都已用代码坐实）
1. **假失败**：`quickIdentifyDraft` 是**同步 server fn**，Pl@ntNet + 二次复核 + 出卡 + 写库
   全挂在一个 HTTP 请求上（**不走**现成的后台队列，那套只服务 enrich/gold）。识别是个
   **有副作用的写操作**：撞上 Cloudflare 边缘 ~100 秒上限时连接被掐，但服务端照样跑完并
   `insert` 了草稿（`_photo_sha256` 也在同一条 insert 里）。而客户端 catch 里**一行确认代码都没有**，
   直接把「响应没回来」判成「事情没做成」。
2. **闲聊污染**：污染的字段是 **`title` 不是 summary**（那段脏文本与 `draftTitleFor` 的输出
   逐字吻合：`疑似` + `长刚毛草（疑似）。地点…`）。两处缺陷叠加：
   - `TENTATIVE_RE` 是 `^` 锚定的**只剥前缀**，模型把「（疑似）」写在名字**后面**时剥不掉，
     前面再加一个就成了「疑似X（疑似）」；
   - 原来的 `.slice(0, 200)` 让 137 字的整段闲聊大摇大摆走过去落进 DB。
   - ⚠️ **`cleanJson` 不是本次根因** —— 闲聊在 JSON **内部**，parse 是成功的。
     （它在非 Gemini 链路上是另一个隐患，本轮没动。）
   - 嫌疑源头：`secondOpinionIdentify` 是 phase-1 里唯一**不发 `response_format`** 的调用
     （:1377 注释写明是刻意的，怕第三方中转 400），叠加 `temperature: 0` 贪心解码 ——
     正是复读循环的标准配方。但出卡链路虽有 `responseSchema`，**照样能把闲聊塞进 string 字段**，
     所以代码层面**分不出是哪个模型**，要看线上日志。

### 1. ✅ 疑似标记 + 物种名闸门（[tentative.ts](src/lib/tentative.ts)）
- `TENTATIVE_SUFFIX_RE` + `stripTentativeMarks()`：剥名字**两端**的疑似标记（可重复）。
  ⚠️ 只能用于**名称字段** —— 正文「目前只能算疑似」结尾那个是正常表达，剥了会把话说反，
  所以 summary 一律仍走 `stripTentativePrefix`。
- `sanitizeSpeciesName()`：**一个物种名里不可能有句末标点** → 在第一个 `。！？；：` 处截断，
  60 字封顶。这比「猜像不像闲聊」的启发式可靠 —— 它不猜模型想说什么，只认「名字不长这样」。
- `META_NOISE` 词表（要求**完全等于**）：截断后只剩「状态」「祝好」这类词判为无效名、返回 `""`，
  好让 `draftTitleFor` 的 `||` 真正退回 `scientific_name`。没这步会在库里留下一个叫「状态」的植物。
- `isTentative` 认第三种表达（标在名字上）。
- ⚠️ **有意的行为变更**（改了一条既有测试的期望）：模型写 `confidence=high` 却把名字写成
  「疑似X」时，现在**倒向存疑**（旧行为是剥掉疑似、信 high）。依据是 `normalizeIdentification`
  早已确立的「任一处露出疑似 → 全部疑似」+ 项目反复强调的「错误定种比暂不定种更糟」。
  代价：补拍更容易被激活（保守方向）。**已告知用户，可一行改回。**

### 2. ✅ 字段级闲聊消毒（新增 [model-chatter.ts](src/lib/model-chatter.ts)）
- `stripModelChatter()`：① 元话语标记处截断 ② 复读检测（同一 ≤40 字句子出现 ≥3 次 →
  从第 2 次处切）。词表**刻意极短且都足够刺眼**（「以上内容为模拟回复」这种），
  「结果 / 说明 / 状态」等日常词**故意不收** —— 「结果表明该种耐旱」是完全正常的句子。
  误伤一段正常导语比漏掉一次闲聊更糟（前者天天发生）。
- 接进 `normalizeIdentification`（唯一规范化入口，出卡+复核两条链路都过它），
  **必须在疑似前缀逻辑之前**跑，否则「疑似」会被加在闲聊前面。
- 非疑似分支补了兜底文案，避免消毒后留一张白卡。

### 3. ✅ 断线自愈（[camera-identify.tsx](src/components/camera-identify.tsx) + [explain-error.ts](src/lib/explain-error.ts)）
- catch 里：网络层失败且有照片指纹 → 浮层改「正在确认结果」→ 按 **0/3/8/15 秒退避回查
  `findDraftByPhotoHash` 4 次**（约 26 秒）→ 命中就当成功走完。
  **为什么要退避重查**：连接被掐那一刻服务端多半还在收尾，只查一次会扑空 = 把成功误判成失败。
- 抽出 `goToDraft()` 给正常路径和自愈路径共用，免得自愈少做一步（如忘了清 React Query 缓存）。
- **补拍现在也算 hash**（原来 `if (retakeCtx) return void runIdentify(null)` 直接传 null，
  自愈在补拍路径上是死的 —— 而补拍恰恰最容易断）。
- `explain-error.ts`：导出 `NETWORK_MSG` / `isNetworkError()` 供复用（不复制正则）；
  文案从**断言「失败」**改成「未收到结果」；新增 `serverStateChecked` 三态 ——
  已查证没有→「可以放心重试」；没查证→「先别急着重试，去『我的草稿』看一眼」。
  这条排在所有网络原因**之前**（它决定用户下一步该不该重试，比「为什么断的」更要紧）。
- 错误横幅标题三档：`识别失败` / `识别未完成（已确认库里没有结果）` / `未收到结果（可能已完成）`。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0。
- 单测 **81 条全过**：`scratch/tentative.test.mjs` 36（含用户报的整段原文直接喂进去）、
  `scratch/model-chatter.test.mjs` 21、`scratch/explain-error.test.mjs` 17、
  `scratch/recover-decision.test.mjs` 7（catch 分支判定表替身，防三元写反）。
- 浏览器实测 `/identify` 正常渲染、控制台零错误（无回归）。
- ⛔ **自愈主路径本地无法实测** —— 要真手机 + 真照片 + 真模型调用才能造出「服务端写了库但
  客户端没收到」。只能上线后验。

### 下一步
- 部署（本轮 3 处 + 之前 11 处改动**全部未上线**）。
- 上线后复测：①切后台造一次断线 → 应显示「正在确认结果」而不是「识别失败」，
  且能自动跳到草稿；②观察是否还出现闲聊污染的 title。
- **已知未修（本轮刻意不做，避免一次上太多）**：补拍合并时 `ai_payload` 是**整体替换**，
  重建时不读旧值 → 原草稿第一次识别的 `_photo_sha256` **会被抹掉**，一株植物只要补拍过一次，
  首图查重就永久失效。建议改存 `_photo_sha256_all` 数组 + 查询用 `.or()` 同时匹配两处。
  （注：本轮让补拍也传 hash 后，合并草稿至少会保住**最新那张**的指纹，比原来只多不少。）
- **可选的更划算方案（修 6′）**：把**二次复核**踢进后台队列。它独占 45 秒预算，是撞 100 秒
  上限的主要来源。让 phase-1 拿到「疑似」就先出卡返回，复核完成后回写草稿、由草稿页轮询刷新。
  比「把整个 phase-1 搬上队列」（要拆 600 行 handler、照片不能进 payload）划算得多。

---

## 🆕 2026-07-26 草稿页五修（简介卡 / 空槽说明 / 编辑采纳按钮 / 小P蛙范围）

用户一条反馈里的五件事，全部落地。tsc=0、build=0、lint=0，**未部署**。

### 1. ✅ 换上配图后仍显示「暂无该物种的…公开照片」（本轮真 bug）
- **根因**：缺器官照片时模板给该槽位留 `<img class="sec-img" data-missing-organ hidden src="">`
  + 一行 `<p class="img-missing">暂无该物种的植株公开照片</p>`。而 **`hidden` 在这里是无效的** ——
  `.sec-img{display:block}` 是作者样式，压得住 UA 的 `[hidden]{display:none}`；真正让空槽不显示的是
  `img.sec-img[src=""]{display:none}`。编辑器右键换图时是通过 `figure` 找到那个隐藏 img 的
  （html-doc-editor 的 onCtx 会 `closest("figure")?.querySelector("img")`），**只改了 src**，
  于是图立刻显示、说明还在 → 图旁边写着「没有图」。
- **修**：[draft-enhance.ts](src/lib/draft-enhance.ts) 新增
  - `stripStaleMissingNotes(html)`：纯字符串（服务端 Workers 没有 DOM 也能用），逐个 `<figure>`
    看「img 有非空 src」→ 摘掉 `p.img-missing` 与 `hidden/data-missing-organ`。
  - `clearMissingOrganMarkers(img)`：DOM 版，换图那一刻用。
  接入 5 处：`replaceImageInDraftHtml`（点击替换）、html-doc-editor 的 `replaceActiveSrc`（右键换图）、
  `enhanceDraftHtmlForViewing`（**视图兜底：库里已经存坏的老草稿现在就不显示了**）、
  drafts.$id 的 `handleHtmlSaved`（保存即写干净）、`approvePlantDraft` 发布前（否则会带到正式条目页）。
- 验证：`scratch`/scratchpad 里 5 条用例全过（含真实模板 markup、src 带 `$1` 的替换陷阱、
  空槽必须保留说明、混合页只清有图的那个）。

### 2. ✅ 银叶草稿的简介卡去掉「疑似」+ 去掉补拍框
- 新增 `showTentativeOnCard = draftTentative && notEnriched`：卡上的「疑似」前缀与那个琥珀色
  补拍框**只在快速识别简介那一档**出现。理由：银叶草稿是用户花银叶让 AI 通读资料写出的成篇内容，
  读完一整篇笃定的科普再抬头看见「其实我不确定这是什么」，是自己拆自己的台；纠错的正确时机是
  正文下面那个「草稿内容和我的观察不符」。
- 标题两条分支都先 `stripTentativeMarks(draft.title)` —— 库里存的 title **本身**常带「疑似」
  （`draftTitleFor` 写的），不剥就白改。
- **`draftTentative` 本身没动**：分享卡、铜叶计数、补拍关卡仍按真实置信度走。

### 3. ✅ 正文下新增编辑专属绿框「草稿内容符合我的观察」
- 位置：紧跟「草稿内容和我的观察不符」（同一 section，读完正文之后才看得见的位置）。
- 仅 `isEditor` 可见；点击 = `onAdoptApprove()`（采纳标记 → 识别人该枚铜叶 ×2 → 审核通过并收录），
  与顶部「采纳识别」同一条服务端路径。已收录时换成「已采纳并收录为条目」的静态绿章。

### 4. ✅ 小P蛙「讨论范围」纳入简介卡，且真能改它
- `pageSections` 第一项恒为 `DRAFT_CARD_SCOPE`（"快速识别简介卡"）。以前的范围列表只扫
  html_content 里的小标题，而**简介卡不在 html_content 里**（是 plant_drafts 的列），
  所以「卡上学名/摘要写错了」这类最常见的问题以前根本没法交给小P蛙。
- 新增 [draft-card-fields.ts](src/lib/draft-card-fields.ts)（零依赖，客户端/服务端共用）：
  scope 常量 + 7 个字段（title / scientific_name / common_names_zh / common_name_en /
  family / genus / summary）+ 标签 / 快照文本 / 逐字段 diff。
- `askDraftAgentFn`：**始终**附一份卡面快照；scope=简介卡时喂用户自己拍的照片（卡上显示的就是它们）。
- `applyDraftAgentEditFn`：scope=简介卡走**另一条路** —— 结构化 JSON 出 7 个字段、只接受字符串值、
  漏字段用原值补齐、名称过 `sanitizeSpeciesName` 形状闸门、写 `plant_drafts` 列并返回 `{card:{changes}}`
  （**不返回 html**）。客户端据此只补一条修改记录 + 刷新，不走 saveDraftHtml。
- 修改记录不带 before/after 快照 → `EditLogSection.canRevert` 自然不给「撤销」按钮
  （撤销是按 before_html 还原 html_content 的，对字段改动会张冠李戴）。

### 5. ✅ 编辑可手改简介卡（DraftCardEditor）
- 卡右上角「编辑简介卡内容」（`canEditCard = 编辑 or 管理员`，与标签同权），展开 7 个字段的表单，
  直接 `supabase.from("plant_drafts").update()` + 记一条修改记录。
- 提示语点明「中文名里若还留着『疑似』，直接删掉即可」——这是把 #2 的显示层处理变成**永久**修正的地方。

### ⚠️ 已知遗留（本轮刻意不做）
- **快速识别简介的 html_content 副本不同步**：卡的 7 个字段是列，而 `notEnriched` 草稿的
  html_content 里另存了一份 `buildSummaryCardHtml` 生成的卡 HTML。改字段不会改它；如果编辑
  **不生成银叶正文就直接收录**一份快速草稿，发布出去的正文仍是旧文字（plants 行的
  title/summary 取的是列，所以只有正文这一处旧）。重生成需要 chips/trace/photos 全套重跑，
  且会抹掉编辑手改过的卡 HTML —— 风险大于收益，故留给用户决定。
- **`!anyMarked` 导致所有配图都画红虚线**：viewer script 里 `isDefault = 有 data-default-img ||
  文档里没有任何 data-default-img`。老草稿/全部换过图的草稿会满页红虚线 +「可点击替换」提示。
  本轮未动（不是用户所报问题，且它是老草稿的兜底）。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0；`npm run lint` EXIT=0。
- `stripStaleMissingNotes` 5 条用例全过（scratch/missing-notes.test.ts）。
- 浏览器：dev 起在 5203，`/drafts/<不存在的 id>` 正常渲染「草稿不存在或已被删除」、控制台零错误
  （证明新模块图在浏览器里解析正常）。
- ⛔ **编辑态 UI 本地未能实测**：绿框按钮 / 简介卡编辑器 / 小P蛙简介卡改写都要**编辑账号登录**
  （站内已无 mock 登录），且草稿列表对匿名用户不可见。请登录后在真草稿页上复看这四处。

### 下一步
- **✅ 已部署**：Version `0ae81b77-11ce-455c-bfc7-2dd59d1cd82e`，2026-07-26 18:41 CST
  （连同积压的另两轮一起）。提交检查点 `fd4fae8`。
- **⛔ 唯一剩下的事：用编辑账号在一份银叶草稿上线上复看四点** ——
  ① 配图下不再有「暂无…照片」；② 卡上无「疑似」、无补拍框；③ 正文下有绿框按钮、点了进已收录；
  ④ 小P蛙范围里有「快速识别简介卡」，让它改学名/摘要后卡上真的变。
  （若手机上看到的还是旧界面 → 是 PWA service worker 缓存，不是部署没成功；见 memory
  「PWA service worker caching」。）
- 若 ④ 改完卡上没变：先看页面底部「修改记录」有没有那条「小P蛙改写（快速识别简介卡）」——
  有记录说明写库成功、问题在缓存刷新；没记录说明服务端那条分支没走到。

## ✅ 2026-07-28 — 序列能力顺位 + 推理开关 + 模型类型建议（tsc EXIT=0；**NOT deployed**）

用户线上三处报错串成一条线：①二次复核 `qwen3.7-plus` **28 秒没返回** → 复核判「未运行」；
②小P蛙序列 1 配了**纯文本**的 `qwen3.7-max`，带图调用 HTTP 400
`InternalError.Algo.InvalidParameter: … [Unexpected item type in content.]`，
且**整条序列停在第 1 项**（后面已验证读图的 gemini-3.5-flash 压根没试）；
③银叶/金叶配图空缺 —— 而**配图的器官分类正是走小P蛙序列**，②直接把③也废了。

### 1. ✅ 漏洞 B：能力型 400 要顺位（用户定夺：交给序列二顶上）
[model-queue.ts](src/lib/model-queue.ts) `shouldFailOver` 原来只认「讲可用性的 400」
（未开通/欠费/模型不存在）。新增 **`CAPABILITY_400`** —— 「**这个模型没这项能力**」
（`unexpected item type` / `content must be a string` / `not support …image|vision` /
`不支持图片` / `仅支持文本` …）。请求完全合法，只是这一项不会读图 → **必须顺位**。
- ⚠️ 同时加 **`BAD_IMAGE_400` 一票否决**：话里在说**这张图本身**不行（format / 过大 /
  解码 / 损坏）的，换谁都挂，不顺位、也不能把真错误埋掉。
  现有断言 `"Invalid image format: webp not supported"` 正是靠它保持 false。
- 反向语序模式**刻意限定**成 `image_input|image_url|vision|multimodal`，
  不写宽泛的 `image .* not supported` —— 否则「webp 这种**格式**不支持」会被误判成能力问题。
- `scratch/failover.test.mjs` 扩到 **25 条全过**（含用户那条 400 原文）。

### 2. ✅ 推理（思维链）开关 —— 每个模型一个，三态
`ModelSlot.thinking?: "on" | "off"`，**不设 = 跟随控制台默认**（三态而非布尔：
以后调默认值时，老配置不会僵在旧默认上）。
- **`THINKING_DEFAULTS`**：`enrich`=**on**（唯一真吃思维链的链路，且跑在 Queues
  的 15 分钟挂钟里，不赶时间）；`card` / `second_opinion` / `xiaop` / `ai` 全 **off**
  （都卡在用户等待的实时路径上，干的是机械活）。未知控制台保守 off。
- `looksReasoningModel()` 是**启发式**，只用来在界面上提示 + 挑初始默认，**不替管理员决定**：
  开关永远显示、永远可改。理由就是 `qwen3.7-max` —— 名字像旗舰推理模型，实际是纯文本模型。
  `NON_THINKING_HINT`（turbo/flash/instruct/non-thinking）优先级高于推理特征。
- 接线：`thinkingParams(cfg)` 替掉三处硬编码 `...THINKING_OFF`；
  slot→cfg 处调 `thinkingOf(slot, consoleId)`；
  **小P蛙那条原来一个关思考参数都不发**，现在也走同一套（`openaiCompatChat` 加第 8 个参数）。
- 持久化：`readModelQueue` / `writeModelQueue` / `ModelSlotSchema`(zod) /
  `saveModelQueueFn` handler **四处**都补了字段，否则会被静默丢弃。
  ⚠️ 推理开关**不**跟着换模型清空（不同于 vision）：它是「这条链路要快还是要深」的判断，
  换个模型 ID 照样成立；vision 才是对某个具体模型的实测结论。
- `scratch/thinking-toggle.test.mjs` **30 条全过**（识别 / 默认值 / 覆盖 / 存取往返）。

### 3. ✅ 模型类型建议（五个控制台各一份）
[model-queue-console.tsx](src/components/model-queue-console.tsx) `CONSOLE_ADVICE`：
每个控制台写明 **needs（该配什么）/ why / avoid（常见配错）/ thinkingWhy**。
五个控制台界面长得一模一样、要求却天差地别 —— 尤其 **xiaop 兼着配图器官识别**，
管理员从界面上完全看不出这里需要视觉模型（这就是③的成因）。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0；改动的两个文件 eslint 零非格式错误。
- `scratch/failover.test.mjs` 25/25、`scratch/thinking-toggle.test.mjs` 30/30。
- **浏览器实测**（dev 5203 → 草稿页 → 小P蛙 → 模型设置，走 localStorage 那条不需管理员）：
  建议框与推理开关都渲染；下拉三档齐全；把模型改成 `qwen3.7-plus-2026-05-26` 并切「强制开启」
  → 「⚠️ 看着像推理模型…」警告如期出现，徽标变「当前：开（不发关思考参数）」；控制台零报错。
- 🐛 实测中发现并已修：建议文案里的 `**粗体**` markdown 会以**字面星号**渲染
  （`<p>` 里是纯文本）→ `CONSOLE_ADVICE` 的 needs/why/avoid 改成 `React.ReactNode`，
  两处改用真 `<b>`。重测已无字面星号。

### ⚠️ 尚未修的（配图链路，已诊断未动手）
1. **`classifyPhotoOrgans` 全有或全无**：`if (thumbs.length !== batch.length) return cands;`
   —— 8 张里坏 1 张 → 整批退回空标签 → 一张也进不了槽。且 `fetchInlineImage` 是全文件
   **唯一不带 User-Agent** 的 fetch（Wikimedia 对裸 UA 会 403）。
2. **`loadXiaoPQueue` 没有 `?? loadAiQueue()` 兜底**（对比 loadCardQueue / loadEnrichQueue）。
3. **`openaiCompatChat` 的盲退级**：中转拒收图片时会**去掉图重发** —— 对聊天合理，
   对器官分类是灾难（没看见图却照编一串标签）。需要 `noBlindFallback` 开关。
4. **`user_photos` 从没进过配图链路** —— 用户自己拍的花/叶特写是手上最贴题的图源，
   目前只喂给小P蛙问答。

### 下一步
- 部署（本轮**均未上线**）。上线后：小P蛙序列 1 报 400 应自动顺位到 gemini-3.5-flash；
  二次复核在控制台可见「推理模式」开关且默认关。
- 再按上面 4 条修配图（建议顺序：先加可见性日志 → 再改逐张容错）。

## ✅ 2026-07-28（续）— 金叶/器官识别拆出独立控制台 + 配图机制修复（tsc/build EXIT=0；已实测；**NOT deployed**）

用户两条指令：①把金叶创建的模型从小P蛙里拆出来独立配置；②修银叶/金叶的配图机制。
配图的两个决策点问过用户，均选推荐项：**器官识别给独立控制台**、**用户实拍进候选池**。

### 1. ✅ 拆出两个新控制台（`xiaopTextCall` 原来被 5 类活共用）
`xiaopTextCall` 新增 `consoleId` 参数，决定读哪个序列 + 用谁的推理默认值。
- **`gold` 金叶详页模型**（`gold_model_config`），兜底链 **gold → enrich → ai**。
  刻意**不回退小P蛙**：金叶写整份公开档案，与 enrich 同属长文诉求；小P蛙是为交互问答调的快模型。
  推理默认 **on**（跑在队列 15 分钟挂钟里，不赶时间）。
- **`organ` 配图器官识别模型**（`organ_model_config`），兜底链 **organ → card → ai**
  （器官识别要「能读图 + 快 + 便宜」＝ 出卡AI 的画像）。推理默认 **off**（机械打标签）。
  🔑 **这就是配图全空的真凶**：器官识别原来挂在小P蛙序列上，用户在小P蛙配了纯文本
  `qwen3.7-max` → 带图调用一路 400 → 全站配图归零，而且不报错、名字上也想不到两者相连。
- 报错文案跟着链路走：金叶失败不再说「给小P蛙换模型」。
- 两块面板已挂上 `/identify`，`CONSOLE_ADVICE` 各写一份「该配什么/为什么/常见配错」。

### 2. ✅ 配图：器官分类从「全批放弃」改成「逐张容错」
- `classifyPhotoOrgans` 原来 `if (thumbs.length !== batch.length) return cands;` ——
  **8 张里坏 1 张 → 整批退回空标签 → 一张也进不了槽**。改成只把取到的那些送去分类。
- ⚠️ **最危险的一处**：模型看到的编号是「送出子集」的下标，不是 batch 下标。不映射就会把
  器官**系统性错标到别的图上**（一张标着「花」的叶子特写比空槽有害得多）。
  映射逻辑抽成纯函数 `applyOrganVerdicts`（[species-photos.ts](src/lib/species-photos.ts)），
  `scratch/organ-verdicts.test.mjs` **16 条**专测错位场景。
  prompt 里的数量/下标也一并改用 `sendable.length`（否则模型按 batch.length 编号，全对不上）。
- `fetchInlineImagesIndexed`：保序、失败留 null（旧的 `fetchInlineImages` 会 filter 掉，
  于是调用方根本对不上是哪几张 —— 这正是「全批放弃」写法的由来）。
- **`fetchInlineImage` 补 User-Agent** —— 它曾是全文件唯一的裸 fetch 图片请求，
  Wikimedia 对裸 UA 直接 403。顺手把三处 `"Plantspedia/1.0"` 收成 `PLANTSPEDIA_UA` 常量。

### 3. ✅ 转存改「逐张回落」
`rehostImages` → `rehostImagesIndexed`（保序，失败留 null）+ `rehostImagesAligned`（逐张回落）。
旧写法 `rehosted.length === chosen.length ? rehosted : chosen` 只要一张失败就**整页退回外链**，
而外链是 inat/gbif/wikimedia 域名、国内加载不出 ——
日志里 `[PhotoSlots]` 显示 5/5 槽有图，用户看到的却是一排裂图。

### 4. ✅ 用户实拍进配图候选池（此前完全没被用过）
`userPhotoCandidates()`（纯函数）把 `photo_url` + `user_photos` 组装成候选，**排在池子最前**。
- ⚠️ **刻意不直接塞进空槽**：和外部图一起过 `classifyPhotoOrgans` 现看现标，器官对不上
  自然进不了槽。明确知道缺「花」时塞一张叶子照是误导，比空槽有害。
- 署名走新增的 `SITE_LICENSE = "site-contributed"`（已加进 `REUSABLE_LICENSES`），
  `licenseLabel` 对它返回**空串** —— 站内投稿没有标准许可徽标，语义由 sourceName
  「本站用户实拍」承担，避免拼出「本站用户授权 · 本站用户实拍」这种同义反复。
- 银叶（`buildDraftContent` 新增 `userPhotos`/`photographer` 入参）与金叶两条链路都接了。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0。
- 新增/改动的 4 个文件 eslint **0 错**；`identify-plant.functions.ts` 的 `any` 计数
  **93 → 93 未变**（那些是 site_config 查询的历史存量）。
- 测试：failover 25 / thinking-toggle 32 / organ-verdicts 16 / photo-slots 14 / species-photos 19，全过。
- 浏览器实测：草稿页 → 小P蛙 → 模型设置，建议框与推理开关正常渲染、无字面星号、控制台零报错。
- ⚠️ `scratch/job-queue.test.mjs` 与 `species-dossier.test.mjs` 失败，是 **Node ESM 无扩展名
  import 的既有问题**（`ERR_MODULE_NOT_FOUND: ./plants` / `./worker-ctx`），本轮未碰这些文件。
- ⛔ **配图是否真的变多，只能上线后用一次真识别 + 真 enrich 验证** —— 要模型调用与外网抓图。

### 尚未修的（配图，已诊断）
1. **`openaiCompatChat` 的盲退级**：中转拒收图片时会**去掉图重发** —— 对聊天合理，
   对器官分类是灾难（没看见图却照编标签）。需要 `noBlindFallback` 开关，分类链路传 true。
2. **金叶 `premium-page.ts:625/630`**：`feature_cards.slice(0,6)` 决定渲染几张图，
   模型只返回 4 张卡时第 5/6 张图已抓取/分类/转存，却**没有落点**被静默吞掉。
3. **金叶「人文·科学绘图」槽结构性必空**：`specimen` 只在第 4/5 级图源产出，
   而那两级被 `picked.length < n` 守着 —— 物种在 iNat 收录越好，越轮不到标本层。
4. 上线后先看日志 `[PhotoOrgans]…候选 N 张 / 实际看图 M 张` 与 `[PhotoSlots]…x/5 槽有图`，
   再决定要不要加量（子请求上限已非约束：07-21 起 Workers Paid，50→1000）。

### 下一步
- 部署（07-28 两批改动**均未上线**）。
- 上线后到 `/identify` 配置**新的两个控制台**（留空也能跑，会自动借用 enrich / 出卡AI）。

## ✅ 2026-07-28（续二）— 配图剩余三条（tsc/build EXIT=0；纯函数已实测；**NOT deployed**）

### 1. ✅ 盲退级：加 `noBlindFallback` 闸门
`openaiCompatChat` 第 8 个参数从裸 `thinking` 改成 options 对象
（`{ thinking?, noBlindFallback? }`），并在「去掉图重发」那条降级路径上加闸门。
- 🔑 **发现一个此前没注意到的交互**：盲退级发生在 `openaiCompatChat` **内部**，
  它把能力型 400 吞成一个纯文本 200 —— 于是续一加的 `CAPABILITY_400` 顺位
  **根本没机会触发**。修好它，「第一个不行第二个顶上」才真的成立。
- `xiaopTextCall` 新增 `imagesEssential?: boolean`（默认 false）：
  **器官识别**传 true（看不见图的器官判定是纯编造，且 HTTP 200 无从察觉，宁可 400 顺位）；
  **视觉自检**也传 true（否则中转拒图 → 偷偷去掉图 → 模型答错颜色 → 判 blind，
  结论碰巧对但**原因完全错**，真相是中转拒图、换个中转就好）。
  小P蛙聊天保持默认 false —— 带图提问退化成纯文本回答仍然对用户有用。
- 真降级时补了一行 `console.warn`，不再无声无息。

### 2. ✅ 金叶落单配图不再被静默吞掉（[premium-page.ts](src/lib/premium-page.ts)）
`featHtml` 原来 `cards.map(...)`，模型只写 4 张卡时下标 4、5 的图**已抓取/分类/转存/占了存储**，
却因为循环只跑 4 轮而消失。
- ⚠️ **刻意不把它们挪进前面几张卡** —— schema 要求「恰好 6 张，依次 根株/茎/叶/花/果/物候」，
  所以 `images[i]` 与 `feature_cards[i]` 是**语义绑定**的；下标 4 是「果实」，塞进标题写着
  「叶」的卡里就是错标，正是 `slot()` 注释反对的那种伤害。
- 改法：新增「补充图像 · Additional images」带，图注**如实写出是哪个器官**
  （根与株型/茎/叶/花/果实与种子/物候与繁殖）。正常 6 张卡的页面**完全不受影响**。
- `scratch/gold-orphan-images.test.mjs` **14 条**（含「果实图绝不能混进前 4 张卡」）。
  ⚠️ 该测试要先用 esbuild 打包（premium-page.ts 有无扩展名 import，node 直跑不了）：
  `./node_modules/.bin/esbuild src/lib/premium-page.ts --bundle --format=esm --platform=neutral --outfile=<scratchpad>/premium-page.bundle.mjs`

### 3. ✅ 「人文·科学绘图」不再结构性必空
`fetchSpeciesPhotos` 新增 `opts.specimenFloor`，金叶传 **2**。
- 病根：第 4/5 级（标本台纸、Commons 图版）都被 `picked.length < n` 守着，
  **物种在 iNat 收录越好，前三级越早填满 n，这两级越轮不到跑**；而 `GOLD_SLOTS[7]`
  的 want 是单元素 `["specimen"]`，零降级余地 → 越常见的物种那个槽越是恒空。
- 改法：加 `specimenDeficit()` / `wantMore()` / `takeCount(forSpecimen)`；
  **第 1、2 级的提前 `return finish()` 也一并改成 `!wantMore()`** —— 不改这两处，
  常见种在第 1 级就返回了，配额形同虚设（这是最容易漏的一处，grep 逐个核对过）。
  `commonsSearch` 加第 4 个参数 `take`，默认沿用旧行为，不影响第 3 级。
- `finish()` 日志改成无条件打印 `采用 x/n 张（标本/图版 s/floor）`，上线后一眼可查。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0；premium-page.ts 非 prettier 错误 0 条；
  `identify-plant.functions.ts` 的 `any` 计数仍是 **93**（未新增）。
- 测试：failover 25 / thinking-toggle 32 / organ-verdicts 16 / gold-orphan-images 14 /
  photo-slots 14 / species-photos 19 / quality-gate 16 / gold-skill 20，**全过**。
- ⛔ 三条的**真实效果都只能上线后验**：盲退级要真中转拒图；标本配额要真抓 GBIF/Commons；
  落单配图要模型真的少写卡。纯函数层面已尽可能覆盖。

### 下一步
- 部署（07-28 三批改动**均未上线**）。
- 上线后重点看日志：
  `[SpeciesPhotos]…采用 x/14 张（标本/图版 s/2）` → 「人文·科学绘图」槽是否还空；
  `[PhotoOrgans]…候选 N 张 / 实际看图 M 张` → 逐张容错是否生效；
  `[openaiCompatChat] … 拒收图片，已去掉图重发` → 若出现在非小P蛙链路即是漏网。
- 到 `/identify` 配置新增的两个控制台（金叶详页模型 / 配图器官识别模型），留空也能跑。

## ✅ 2026-07-29 — 配图全面降级 + AI 控制台职责说明 + 小P蛙通知中心（前两刀）
（tsc/build EXIT=0；已浏览器实测；**NOT deployed**；迁移**已由用户在控制台执行**）

### 1. ✅ 配图不再留空槽（用户明确推翻「诚实空槽」设计）
- `DRAFT_SLOTS` / `GOLD_SLOTS` 的 `want` **全部列满 6 个器官**。金叶原来有
  **5 个单器官刚性槽**（叶/花/果/科学绘图 + 根株），零降级余地 —— 那是金叶配图
  常年大面积留空的直接原因。
- `assignSlots` 从两轮扩到**四轮**：
  ① want[0] 精确 → ② want[1..] 降级 → ③ **收 organ==="" 的图**（视觉分类失败时的
  救命稻草，旧版这里直接整页零配图）→ ④ **复用已用过的图**（候选比槽少时，
  优先复用「本站用户实拍」）。只有**候选池一张图都没有**才可能空。
- ⚠️ **我保留了一条用户没要求但必须有的**：降级命中时图注**如实写明画面是什么**
  （「图为植株 · 该物种的果实照片暂缺」）。不加这句，「果实卡里放植株照」就是
  `slot()` 注释一直反对的那种误导。银叶走新增的 `section_notes` 通道、
  金叶走 `RenderPhoto.note`，两处都**不进署名 `<a>`**（它是内容事实、不是版权信息）。
- `scratch/photo-slots.test.mjs` **重写**：删掉三条编码旧设计的断言
  （「绝不拿 want 之外的图填槽」「只有一张图就只能填一个槽」「空槽带说明」），
  文件头写明删了哪三条、为什么。现 **18 条全过**。

### 2. ✅ 每个 AI 控制台列出「负责哪些工作」
`CONSOLE_ADVICE` 加 `jobs: string[]`，7 个控制台逐条列出影响面（如器官识别那条：
「银叶草稿：判断每张候选配图展示的是花/叶/果/植株/生境/标本」「金叶详页：9 个图槽
的分配全依赖这一步」）。理由：光说「该配能读图的模型」不够，管理员真正要知道的是
**「我改这一项会影响站上哪些功能」**，而控制台名字传达不了这件事。
浏览器实测（临时路由 `/advicetest`，验完已删）渲染正常。

### 3. ✅ 小P蛙通知中心 —— 刀 1（数据层）+ 刀 2（浮标 UI）
**用户 2026-07-29 两处拍板**：①已读判据 = **进过那份草稿的详情页**（不是在小P蛙里
点卡片）；②**存库**（跨设备可见），重点照顾注册用户与编辑，匿名用户不进动态流。

- **迁移 `20260729120000_task_feed.sql`（用户已在 Supabase 控制台执行并验证）**：
  15 列、3 个索引 + 1 个唯一索引（user+kind+draft）、2 条 policy、1 个触发器。
  🔑 触发器 `task_feed_guard_update_trg` 是关键：policy 允许本人 update（为了标已读），
  但 RLS **表达不了「只能改 read_at 这一列」**，没有它前端可以伪造「任务已完成」。
  service-role 显式放行。`types.ts` 手工补了这张表。
- **分工**：`site_config` 的 job 行 = 执行状态（6h 后清），`task_feed` = 动态流 + 已读（长期）。
  两边都写是刻意的 —— 动态流写挂了不影响任务本身（`upsertTaskFeed` 全程吞异常）。
- **接入点**：`runQueuedJob` 是银叶/金叶的唯一公共出入口，钩一处覆盖两条链路。
  `feedStart`（入队即落地，避免冷启动几十秒的「点了没反应」空窗）/ `onPhase` 镜像 /
  `feedFinish`（补标题·封面·摘要 + 重标未读）/ 失败写 error。
  ⚠️ **只在阶段推进时镜像，不跟心跳** —— 心跳 15 秒一次，跟着写会白白翻倍子请求。
- **前端**：`use-task-feed.ts`（有任务在跑 5 秒轮询、全闲退到 60 秒）、
  `task-feed-badges.tsx`（进度条在图标**下面**、未读圆圈在**右上角**，用户指定的位置）、
  `task-feed-launcher.tsx`（全局浮标 + 摘要卡列表）。
  🔑 **为什么要新做一个全局浮标**：原小P蛙（draft-agent-panel）**只挂在草稿页和条目页**，
  而用户要的恰恰是「去识别下一株时也能看到进度」—— 那两页都不在路上。
  用 `XiaoPAgentMountedContext` 让两者**同页只出现一只青蛙**：有对话面板的页面上
  全局那只让位，由对话面板那只用**同一套组件**画角标。
- 已读：`drafts.$id.tsx` 挂载时调 `markDraftReadFn`，真的清掉未读才 invalidate 动态流。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0；新文件非 prettier 错误 0 条。
- `scratch/task-feed.test.mjs` **21 条**（未读计数 / 进度条选谁 / 失联判定 / 三色语义
  «进度条与圆圈必须同色» / DB 行解析）；photo-slots **18 条**；总计 **9 套 217 条全过**。
- 浏览器实测三色角标（临时路由 `/feedtest`，验完已删）：圆圈橙1/蓝12/绿3、
  进度条绿20%/蓝55%/橙88%、128→「99+」、0% 时留可见小段、全闲时整块不渲染。

### 下一步（刀 3、刀 4 未做）
- **刀 3**：小P蛙**对话框内**逐条列摘要卡。现在列表在全局浮标的独立面板里，
  草稿页/条目页那只青蛙点开的仍是纯对话 —— 两者尚未合并。
- **刀 4（最重）**：识别搬上队列 = 绿色那条 + 相框里的详细进度。要拆
  `quickIdentifyDraft` 那 600 行 handler、照片改走 Storage URL（**payload 绝不能塞
  base64**，`pruneExpiredJobs` 会把所有 job 行全量拉回解析）、放开匿名轮询
  （`pollJobFn` 现挂着 `requireSupabaseAuth`；`readJob(id, userId?)` 的 userId 本来就可选）。
- ⛔ 动态流的**端到端**效果只能上线后验：要真登录 + 真跑一轮银叶/金叶。
  纯函数与渲染层已尽可能覆盖。

## ✅ 2026-07-29（续）— 刀 3 + 刀 4：识别搬上队列 + 小P蛙对话框列摘要卡

### 刀 3 ✅ 摘要卡列表并进小P蛙对话框
- 新 `task-feed-list.tsx`，全局浮标与草稿页那只青蛙**共用同一份**（同一份东西在两处
  长得不一样是 bug 不是特性）。
- 对话框加「对话 / 任务动态」切换条，**只在有动态可看时出现**。
- 点开青蛙时：**有未读就直接落在动态流**上（用户点它的动机十有八九是「刚才那株出来了吗」），
  没未读才回到对话。

### 刀 4 ✅ 识别搬上 Cloudflare Queues（本轮最重、风险最高）
根治 07-26 那个「等 101 秒报 Load failed、其实后台已成功」—— 整条识别挂在一个 HTTP
请求上必然撞边缘 100 秒上限，锁屏/切后台更早断。

- **把 `quickIdentifyDraft` 的 handler 体（4268–4926，658 行）原样抽成模块级
  `runQuickIdentifyCore(data, onPhase, opts)`**，一行逻辑没改。同步入口保留成薄封装。
- 新 `startQuickIdentifyFn`（登录用户走它）：照片**先传 Storage** → 建 job → 入队 → 立刻返回 jobId。
  🔑 **payload 绝不能塞 base64**：`pruneExpiredJobs` 每次建任务都会把所有 job 行全量拉回解析，
  塞一张 8MB 图会撑爆它。所以 payload 只带地址，消费者用地址把字节取回来。
  `opts.photoUrl/extraUrls` 让核心跳过重复上传，避免同一张图存两份。
- `JobRecord.kind` 加 `quick_identify`；`draftId` 允许空串（**新建识别的草稿是跑完才有的**，
  补拍合并才一开始就有）。`runQueuedJob` 加识别分支，跑完把 `feedDraftId` 补上再 feedFinish。
- 核心里插了 4 个 `onPhase`（读图 8% → 定种 25% → 出卡 72% → 写库 90%），
  相框里显示**真实**阶段 + 绿色进度条，并写明「可以锁屏或去识别下一株」。
- 客户端：登录走 `startIdentify` + `awaitJob` 轮询；匿名仍走同步老路。
  **断线自愈逻辑原样保留** —— 轮询本身也会断，断了照样要回查一次。

### 🔴 本轮踩到并修好的真 bug（只有 dev 抓得到）
把 handler 体抽成模块级函数后，它调用的 `resolveCreator` 里那句
`await import("@tanstack/react-start/server")` **泄进了客户端依赖图** ——
以前它只从 handler 闭包里可达，而编译器会把 handler 体从客户端产物剥掉。
症状极具迷惑性：**`npm run build` EXIT=0 照过，dev server 直接 500**。
修法：按报错自己的建议新建 `src/lib/request-auth.server.ts`（`.server.ts` 是本仓库
既有的服务端边界约定），**两处**都改走它。
⚠️ 教训：抽取 handler 体时必须查一遍它的调用链里有没有服务端专用 import，
且**光看 build 通过不足以确认**，一定要在 dev 里真打开页面。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0；服务端日志零错误；
  `/identify` 在 dev 里真实渲染通过（修复前是 500）。
- 10 套测试 **217 条全过**。
- ⛔ 端到端只能上线后验：要真登录 + 真拍一张 + 真跑一轮。

## ✅ 2026-07-29（续二）— 小P蛙上全站 + 失败终于看得见（tsc/build EXIT=0；已浏览器实测；**NOT deployed**）

用户反馈三件事：① 识别页没有小P蛙；② 有小P蛙的页面上，图标下面没进度条、右上角没角标；
③ 识别失败首次报「任务在服务端异常结束（多为触及平台单次请求上限）」。①② 已修，③ 见 Blockers。

### 🔴 修掉的两个真 bug（都是「上一轮自认为做好了」的东西）

**bug 1 — 全局浮标在动态流为空时整个不渲染。**
`task-feed-launcher.tsx` 里原有一行 `if (!rows.length) return null`。新用户、或还没跑过任何
任务的用户，动态流本来就是空的 → **全站除了草稿页/条目页，一只青蛙都没有**。
识别页正是其中之一。通知为空只该让**角标**不画，不该让入口消失。

**bug 2 — 让位机制用 React context，方向反了，从来没生效过。**
全局那只挂在 `__root.tsx`，页面自带的那只在 `<Outlet/>` **里面** —— 是全局那只的
**兄弟节点的后代**。context 只能向下流，后代里的 Provider 对上面的兄弟毫无影响，
`useContext` 永远读到默认值 false。这个 bug 一直被 bug 1 掩盖着（两只都没出现，
自然看不出去重失效），修好 bug 1 的同一刻就会暴露成右下角并排两只。
改用模块级订阅仓库 [xiaop-mounted.ts](src/lib/xiaop-mounted.ts)：页面自带的那只挂载时登记，
全局那只 `useSyncExternalStore` 订阅后让位。**计数不用布尔** —— 路由切换时新页面的 panel
可能先挂载、旧页面的后卸载，布尔会被后卸载那次误置回 false。

### 🔴 改的过程中现做现踩的第三个（只有浏览器抓得到，tsc/build 全绿）
全局那只渲染的也是 `XiaoPAgentPanel`，于是它**把自己登记成了「页面自带的青蛙」** →
看到有人登记 → 让位 → 登记随之消失 → 又出现 → 无限循环。
React 报 `Maximum update depth exceeded`（栈顶 `forceStoreRerender`），
整个 `TaskFeedLauncher` 被错误边界吃掉，**页面上反而一只青蛙都没有**。
修法：`XiaoPAgentPanel` 加 `registerAsPageAgent`（默认 true），全局那只传 **false**。
⚠️ 教训与 07-29 上一轮同款：`tsc --noEmit` + `npm run build` 双绿**证明不了组件能跑**，
必须在浏览器里真打开。

### 做了什么
- **全站小P蛙**：`TaskFeedLauncher` 从「纯通知浮标」升级成完整的 `XiaoPAgentPanel`，
  挂在根上，**每一页都有**。三合一：当前页对话 / 任务动态列表 / 模型设置。
- **新服务端通道 `askPageAgentFn`**（identify-plant.functions.ts）：正文由客户端从
  DOM 的 `<main>` 抓（抓 body 会把页眉页脚和小P蛙自己的对话记录一起喂进 prompt），
  上限 8000 字。支持联网检索与网络参考图，**`canEdit` 恒为 false**。
  🔑 **为什么刻意不给它落地改写**：能改的页面（草稿 / 已发布条目）各自挂着专用面板，
  那两条路带着 scope 标注、改写、写 plant_edits、可撤销的一整套；让一个只拿到 DOM 文本、
  够不着数据源的通用通道去「改页面」，只会写出改不到实处也无法回滚的东西。
  system prompt 里明确要求它把用户引到能改的那两类页面去。开场白也按 `canApply` 分两种说法。
- **失败终于看得见**：新增 `failedCounts` / `totalFailed`，`TaskUnreadRings` 多一个
  **红圈**（三色之外单独一个 —— 失败若也按类着色，用户分不出「绿3」是三条成了还是三条炸了）。
  新 `markFailedReadFn`：**打开「任务动态」列表即视为已读**。失败的任务往往根本没有草稿页
  可进（识别炸了就没建成草稿），沿用「进过详情页才算已读」那条规则的话，红圈永远消不掉。
  只动 error 行，顺手清掉未读的完成项等于把用户还没看的结果偷偷标掉。
- `markFailedRead` 必须是 `useCallback` 稳定引用：调用点是 useEffect，每渲染换个新函数
  会打成请求风暴（标记→刷新之间 failedTotal 还是 >0，早退那道闸拦不住）。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0。
- `scratch/task-feed.test.mjs` 从 21 条加到 **28 条**（新增 7 条：失败按类计数 / 已看过的
  失败不计 / 失败与「完成未读」互不串味 / 失败不画进度条）。
- **浏览器实测**（dev :5203）：识别页出现小P蛙并能打开面板；`/plants`、`/plants/$slug`
  各恰好 **1 只**；条目页 ⇄ 识别页 SPA 来回切换（含 history.back）始终 **1 只**，
  控制台无新增报错；开场白在不能改写的页面上正确改口。
- ⛔ **未验证**：小P蛙对话的真实往返（`askPageAgentFn` 挂 `requireSupabaseAuth`，
  本地登录不了）；红圈与 `markFailedReadFn` 的端到端（要真跑一个失败任务）。

### 下一步
- 部署（07-28 三批 + 07-29 三批改动**全部未上线**）。上线后要看：识别页有青蛙、
  登录后问一句本页问题能答、跑一个失败任务红圈亮起、点开「任务动态」后红圈消失。

### 🔴 Blockers — 识别失败：「任务在服务端异常结束」
用户 07-29 首次遇到。文案出自 [poll-job.ts:83](src/lib/poll-job.ts:83) 的 `snap.stale` 分支 ——
**含义是任务行连丢 2 分钟心跳**，即那个 isolate 真的没了。已排除的两条：
队列消费者是 `async queue()` 里 `await`（15 分钟挂钟），**不是** waitUntil 那条 26 秒的路
（[server.ts:115](src/server.ts:115)）；`max_retries: 1` 也不会导致重复烧。
剩下最可能的是**单次调用的子请求数或 CPU 时间超限**——
识别一趟要：取图 + Pl@ntNet + 若干 Gemini + 联网调研 + 配图检索 + 多次 Supabase 写 +
每 15 秒一次心跳，条数很容易堆上去。
⚠️ **本地复现不了**（见 memory「本地模拟器不能验证平台限制」），必须拿生产日志：
    npx wrangler tail --format pretty
复现一次失败的识别，看抛出来的原话是 `Too many subrequests` 还是 `Exceeded CPU time limit` ——
两者的修法完全不同（前者砍子请求数/升套餐，后者拆任务），**没拿到这行之前不要动手改**。

### ✅ 已部署 — Version `d03bad76-4725-4bca-9708-9784943202d0`，2026-07-29
提交 `6c2f918`，一次性上线 07-28 三批 + 07-29 三批（此前全部积压未上线）。
线上实测：`plantspedia.club/identify` 有小P蛙、`/plants/$slug` 恰好 1 只、控制台无报错。
仍未验证（要真登录 / 真跑一个失败任务）：对话往返、红圈亮起与消失。

## ✅ 2026-07-29（续三）— 识别的绿色进度条 + 金叶超时报错认错了主人

用户上线后实测反馈两件事。

### 🔴 bug 1 — 快速识别全程在动态流里「不存在」，所以永远没有绿色进度条
`upsertTaskFeed` 开头是 `if (!input.userId || !input.draftId) return;`，而**新建**识别的
草稿是跑完才写出来的，入队时 `draftId` 是空串 → **整趟识别一条动态记录都没有**，
进度条自然无从画起。上一轮把这行注释成「这是刻意的，不是漏」—— 是漏。
相框里还写着「完成后小P蛙会亮起绿色角标」，等于承诺了一件做不到的事。

修法（**不加迁移**）：迁移里的唯一索引是
`(user_id, kind, draft_id) where draft_id is not null` —— **部分索引**，
draft_id 为空的行不在管辖内，`onConflict` 无从落脚。所以这一路改成：
- `upsertTaskFeed` 没有 draftId 时按 **jobId** 先查后写（多一次读，onPhase 一趟只 4 次）；
- `startQuickIdentifyFn` 一入队就 `feedStart`，缩略图直接用刚传上去的原图，绿条立刻可见；
- 草稿诞生时 `adoptFeedDraft` 把占位那条认领过去。
  🔑 **不认领会留下一条永远 running 的孤儿**：feedFinish 按 draft_id 另写一条，
  占位那条没人再更新，20 分钟后被判失联，用户看到一条永远转圈的幽灵。
  认领撞上部分唯一索引时（补拍重识别，该草稿已有同类动态）直接删占位。

### 🔴 bug 2 — 进度条排在名牌后面，被挤出屏幕
浮标离底边只有 32px（`md:bottom-8`），三条进度条约 30px —— 三个任务一起跑时
正好被挤出可视区。移到**图标正下方、名牌之上**，既符合用户说的「图标下面」，
又不再受底边距约束。

### 🔴 bug 3 — 金叶超时却报「小P 响应超时」，还让人去改小P的模型设置
用户原话：「金叶模型是单独配置的，怎么会涉及到小P响应超时？」—— 问得对。
`openaiCompatChat` 是**共享传输层**（小P/识别/银叶/金叶/器官识别全走它），
两条报错文案把「小P」写死了，于是金叶失败把管理员指到完全无关的控制台去。
同一个坑在 `runModelQueue` 那层已经修过（7382 行有注释），传输层这层漏了。
修法：加 `opts.label`，`callSlot` 按 consoleId 传真名。

顺带修掉一个真约束错配：单次请求超时写死 120 秒。金叶跑在队列里（15 分钟挂钟），
而 kimi-k3 这类先写一大段思维链的推理模型一次调用常超 2 分钟 → 必然超时。
新增 `opts.timeoutMs`，`BACKGROUND_CONSOLES = {gold, enrich}` 放宽到 300 秒。
⚠️ **`card` / `second_opinion` 故意不放宽**：它们在 `runQuickIdentifyCore` 里，
而那条核心**匿名用户仍走同步 HTTP** —— 放宽会先撞边缘 100 秒硬上限，
用户看到「Load failed」而不是一句说得清的超时，反而更糟。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0；task-feed 单测 28 条全过。
- `identify-plant.functions.ts` 的 97 条 lint 错误是**既有的**（stash 前后同数），
  非本轮引入；`task-feed.functions.ts` / `draft-agent-panel.tsx` lint 干净。
- ⛔ 端到端仍要上线后真跑：绿条是否在识别期间出现、金叶超时文案是否自称「金叶详页模型」。

### ✅ 已部署 — Version `d2153c0b-5200-4d37-8787-b32507f55cf3`，2026-07-29（提交 `1bea744`）

## ✅ 2026-07-29（续四）— 进度条一任务一根 + 报错自称修干净 + 名牌不再压条

用户第二轮实测反馈三件事，全部落地。

### 🔴 上一轮没修干净：金叶报「小P 调用失败 (HTTP 524)」
上一轮只改了**超时**那两句文案，而三条传输层里还有 6 处把「小P」写死：
`openaiCompatChat` 的 `调用失败/未返回有效内容`、`anthropicChat` 的同两句、
`geminiChat` 的 `未返回有效内容/响应超时` 以及它传给轮换器的 `label`。
现在 `geminiChat` / `anthropicChat` 各加一个 `who = "小P"` 尾参，`callSlot` 统一算出
`who` 再分发给三条路。**教训：这类「文案认错主人」的 bug 要按函数全量 grep，
不能只修用户这次撞到的那一句。**

顺带加了 `upstreamHint()`：524 / 504 / 522 / 502 / 503 追加一句人话解释。
🔑 **524 是中转/厂商那端超时，不是本站掐的** —— 上一轮把 gold 的 `timeoutMs`
放宽到 300 秒对它**无效**（AbortController 根本没来得及触发），能做的只有说清楚
「谁超时了、该去哪个控制台改什么」。

### 🔴 两个识别只画一根绿条
`activeByKind` 每类只留最近更新的那条 —— 同时跑两个识别就只有一根条，
用户以为另一个没起来。新增 `runningTasks()`：**一个在跑的任务一根条**，
颜色仍按类走（两个识别 = 两根绿）。排序按 **createdAt 升序**，
用 updatedAt 会让进度一动就换位、看着像进度在乱跳。超过 5 根折叠成「+N 个在跑」。

### 🔴 白名牌压住进度条
名牌带 `shadow-sm`，阴影糊在 6px 高的细条上像被啃掉一半。
进度条组现在有自己的不透明卡片（`bg-paper/95` + 边框）+ `relative z-10`，条高 6→8px。

### 验证证据
- `tsc --noEmit` EXIT=0；`npm run build` EXIT=0；改动文件 lint 干净。
- `scratch/task-feed.test.mjs` **36 条**（新增 8 条覆盖 runningTasks：
  「两个识别+一个金叶=三根条」「同类不合并」「updatedAt 变了也不换位」「失联/失败/已完成不画条」）。
- 浏览器实测：在 /identify 注入三根条（绿35% / 绿8% / 橙62%）截图确认 ——
  三根都在、名牌在下方且不重叠（gapToCaption=4px）、整块没被挤出可视区。
