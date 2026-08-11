# Plantspedia MCP（本机 stdio）

批量识别植物 → 在 plantspedia.club 建简介摘要卡草稿 → 打标签。

**只给 owner 自己用**（不对其他编辑开放，因此不做多租户鉴权）。

## 设计要害：只收证据，不收结论

| 谁做 | 做什么 |
|---|---|
| 你的 agent | 用**自己的** Pl@ntNet key + **自己的**视觉模型做识别 —— 绕开本站限流与配额 |
| Plantspedia 服务端 | 校验字段 → 算综合可信度 → 渲染卡片 → 落库 |

工具**只接受**：`plantnet.score`（原始 0–1 分）、`model_verdict.confidence`（high/medium/low 三档）。
**不接受**：agent 自报的可信度百分比、agent 自己写的卡片 HTML。

这样即使换 agent、换模型，卡片格式与可信度口径也一致 —— 那部分根本不在 agent 手里，
走的是与站内识别**同一段代码**（`computeIdentifyConfidence()` / `buildSummaryCardHtml()`）。

> ⚠️ 已知局限：本站**无法验证 agent 是否真调了 Pl@ntNet**（score 可伪造）。
> 这是「agent 自带引擎」这条路的固有代价，你已确认接受（只有你自己在用）。
> 缓解：每条记录都带 `_identify_trace.source="mcp"`，可溯源、可整批回滚。

## 安装

### 1. 在 Supabase 里设 token

到 Supabase Dashboard → SQL Editor 执行（token 已随机生成好，可直接用）：

```sql
insert into site_config (key, value)
values ('mcp_token', '{"token":"DyfY286DWnRQx_45nU8J8R1QhNGBZF-W5dabLCAw_xc"}'::jsonb)
on conflict (key) do update set value = excluded.value;
```

### 2. 装依赖

```bash
cd mcp && npm init -y && npm i @modelcontextprotocol/sdk
```

### 3. 接进 Claude Code

```bash
claude mcp add plantspedia --env PLANTSPEDIA_MCP_TOKEN=DyfY286DWnRQx_45nU8J8R1QhNGBZF-W5dabLCAw_xc -- node /Users/xiezongxiu/Desktop/plantspedia/mcp/plantspedia-mcp.mjs
```

## 两个工具

- **`plantspedia_list_tags`** — 列出站内已有标签。**建卡前必须先调**：提交时只能用已有标签，
  站内不存在的会被拒绝（避免冒出「鄂尔多斯植物」/「鄂尔多斯市植物」这类近义重复）。
- **`plantspedia_submit_identification`** — 提交一张照片的识别结果并建卡。

## 用法示例（对 agent 说的话）

> 把 `~/Desktop/植物照片/` 里的照片批量识别建卡，都打上「鄂尔多斯」标签。
> 每张先用我的 Pl@ntNet key 调专业引擎，再用你自己看图给出中文名和导语；
> 拿不准就诚实给 low。

agent 会：`list_tags` 确认标签 → 逐张调 Pl@ntNet + 自己看图 → `submit_identification`。

## 自带的保护

- **照片查重**：指纹为原始文件字节的 SHA-256（与站内 camera-identify 同口径），
  重复提交同一张图会被挡下并返回已有草稿，不重复建卡。
- **疑似单独标记**：`confidence=low` 的会标成「疑似」，在站内待审列表里可单独复核。
- **用量留痕**：每条记 `provider=mcp+plantnet`、`task_type=mcp_ingest`，
  token 计 0（这两个引擎都不花本站的钱），但记录必须在 —— 否则站内会凭空多出一批查不到出处的草稿。

## 排错

```bash
# 直接打端点看鉴权是否通
curl -X POST https://plantspedia.club/api/mcp/tags \
  -H "authorization: Bearer $PLANTSPEDIA_MCP_TOKEN" \
  -H 'content-type: application/json' -d '{}'
```

- `未授权：服务端未配置 mcp_token` → 第 1 步的 SQL 没执行
- `未授权：token 不匹配` → 环境变量与库里的值不一致
- `这些标签站内不存在` → 先调 `list_tags`，用返回的原名
