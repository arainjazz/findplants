# Plantspedia MCP（本机 stdio）· 批量识别建卡 —— 方案设计

> 状态：**设计稿，未实现**。2026-07-22 与用户敲定方向后写。
> 用户已定的口径：方案 B（外部 agent 自带 Pl@ntNet key）、本机 stdio、疑似照收但单独标出、
> 仅管理员/编辑、不消耗叶片。

## 0. 一句话

给外部 agent（Claude Code / 其它 MCP 客户端）开一组**窄接口**，让它自己去调 Pl@ntNet 和
自己的视觉模型做识别，然后把**结构化结果**交回本站落库建卡；**可信度由本站算，不接受
agent 自报**。

---

## 1. 为什么这样切分（核心矛盾及其解决）

用户最担心的两点：「**格式如何统一**」「**置信度标准如何一致**」。

矛盾在于：方案 B 让 agent 自带模型 → 绕开了本站的限流与配额（这是选它的理由），
但也意味着**本站失去了对识别过程的控制**。如果 MCP 工具设计成「agent 传一段 HTML/一个
百分比进来」，那格式和标准就完全依赖 agent 自觉 —— 换个 agent、换个模型，出来的卡就不一样。

**解决办法：把「判断」和「表达」分开。**

| 谁做 | 做什么 | 为什么 |
|---|---|---|
| 外部 agent | 调 Pl@ntNet、调视觉模型，**产出原始判定**（学名、档位、引擎分数） | 它自带 key，绕开本站限流 |
| **本站** | 校验字段 → **用 `identify-trace.ts` 算可信度** → 渲染卡片 HTML → 落库 | 保证所有卡片同一套标准、同一个模板 |

**agent 只能提交「证据」，不能提交「结论」。** 具体到接口上：

- ❌ 不接受 `confidence_pct: 87`（agent 自报的百分比）
- ❌ 不接受 `card_html: "<div>…"`（agent 自己写的卡片）
- ✅ 只接受 `plantnet: { scientific_name, score }` + `model_verdict: { scientific_name, confidence: high|medium|low }`
- 可信度由服务端调 `computeIdentifyConfidence()` 得出 —— **与站内识别走完全相同的代码路径**

这样即使十个不同的 agent 接进来，出来的卡片格式、可信度口径、疑似判据都是一致的，
因为那部分根本不在 agent 手里。

---

## 2. 工具清单（4 个，刻意做窄）

### `plantspedia_batch_start`
开一个批次。返回 `batch_id`。
- 入参：`tags: string[]`（这批要打的标签）、`note?: string`
- 用途：让 agent 能分批提交、失败可续，也让站内能按批次展示结果

### `plantspedia_submit_identification`
**主力工具。**提交一张照片的识别结果，落库建卡。
```jsonc
{
  "batch_id": "…",
  "photo": { "base64": "…", "mime": "image/jpeg" },   // 或 "url"
  "capture": { "lat": 39.6, "lng": 109.8, "place": "伊金霍洛旗" },
  "plantnet": {                    // agent 用**自己的 key** 调 Pl@ntNet 的原始结果
    "scientific_name": "Artemisia annua",
    "score": 0.71,                 // 原始 0–1 分数，本站换算成 %
    "family": "菊科 Asteraceae",
    "genus": "蒿属 Artemisia"
  },
  "model_verdict": {               // agent 自己的视觉模型判定
    "scientific_name": "Artemisia annua",
    "title": "黄花蒿",
    "confidence": "medium",        // 只收 high|medium|low 三档
    "summary_zh": "150–260 字导语",
    "model": "gpt-5-vision"        // 如实记录，进用量/痕迹
  }
}
```
- **服务端做的事**：zod 严格校验 → `normalizeIdentification()` 统一疑似信号 →
  构造 `IdentifyTrace` → `computeIdentifyConfidence()` 算分 → `buildSummaryCardHtml()` 渲染 →
  写 `plant_drafts`（含 `tags`、`_identify_trace`、`_photo_sha256`）
- **照片查重复用现成的 `findDraftByPhotoHash`**：agent 重复提交同一张图会被挡下并返回已有 draft_id

### `plantspedia_batch_status`
查批次进度与结果清单。返回每张的 `draft_id / 物种 / 可信度% / 是否疑似`。
- **疑似单独成组**（用户已定：照收但标出来），方便事后人工复核

### `plantspedia_list_tags`
列出站内已有标签，避免 agent 凭空造出「鄂尔多斯植物」「鄂尔多斯市植物」两个近义标签。

---

## 3. 「合规的识别引擎」怎么配

用户问：**别的编辑的 agent 接进来，如何保证用的是合规引擎？**

三道闸：

1. **必须提供 `plantnet` 字段**（可为 `null`，但要显式写 `null` 并说明原因）。
   缺字段 → 直接拒绝。这逼着 agent 真的去调 Pl@ntNet，而不是只用自己的模型糊弄。
2. **`model` 字段必填且如实记录**，进 `_identify_trace` 与用量表。事后能追责到具体模型。
3. **`confidence` 只收三档**，不收百分比 —— 从接口层杜绝「agent 编一个 92%」。

⚠️ **但要说清楚一个诚实的局限**：本站**无法验证 agent 是否真的调了 Pl@ntNet**
（它完全可以伪造一个 score）。这是方案 B 的固有代价 —— 把识别放到站外，就放弃了对过程的
强制力。缓解手段：`_identify_trace` 里记下 `source: "mcp"` 与提交者身份，出问题能溯源、能整批回滚。
**如果这个风险不可接受，就只能回到方案 A（MCP 只触发站内管线）。**

---

## 4. 鉴权（stdio 版很简单）

本机 stdio → MCP server 以**你自己的身份**跑在你机器上，配置文件里放一个
**管理员 Service Token**（新建一张 `mcp_tokens` 表，或复用现有 admin 会话）。

- 不需要做 OAuth、不需要开放网络端点
- token 存 `~/.plantspedia-mcp.json`，**不进仓库**
- 每个工具调用都过 `requireSupabaseAuth` 等价的校验 + admin/editor 角色检查

> 若将来要给别的编辑用：他们各自在自己机器上跑一份，各用各的 token。
> **不建议**做成 Cloudflare 远程 MCP —— 那要处理多租户鉴权、限流、滥用，复杂度是本机版的数倍，
> 而当前只有你和少数编辑在用。

---

## 5. 复杂度评估

| 部分 | 工作量 | 说明 |
|---|---|---|
| MCP server 骨架（stdio） | 小 | `@modelcontextprotocol/sdk`，4 个工具 |
| `submit_identification` server fn | **中** | 主要工作量：字段校验 + 复用现有渲染/落库链路 |
| 批次表 + 状态查询 | 小 | 一张 `identify_batches` 表（需你在 dashboard 跑迁移） |
| 站内批次结果页 | 中 | 可延后：先用 `batch_status` 在 agent 那边看 |

**建议先做最小闭环**：`submit_identification` + `list_tags` 两个工具，不做批次表
（tags 直接随每次提交传）。跑通一批之后再决定要不要批次管理。

---

## 6. 待你确认

1. **Pl@ntNet 伪造风险**（§3 末）能否接受？不接受则回到方案 A。
2. 先做**最小闭环**（2 个工具、无批次表）还是**完整版**（4 个工具 + 批次表 + 结果页）？
3. 标签策略：agent 只能从**已有标签**里选，还是允许它创建新标签？
