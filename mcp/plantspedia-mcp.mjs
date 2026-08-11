#!/usr/bin/env node
// ═══ Plantspedia MCP（本机 stdio）═══════════════════════════════════════════
//
// 让外部 agent（Claude Code 等）批量识别植物并在 plantspedia.club 建卡。
//
// **分工**（这是整个设计的要害）：
//   - agent 侧：用**自己的** Pl@ntNet key 和**自己的**视觉模型做识别 —— 绕开本站的
//     限流与配额，这正是选这条路的理由。
//   - 本站侧：校验字段 → 用 `computeIdentifyConfidence()` 算综合可信度 → 用
//     `buildSummaryCardHtml()` 渲染卡片 → 落库。
//
// 所以本工具**只收证据、不收结论**：
//   ✅ plantnet.score（原始 0–1 分）、model_verdict.confidence（high/medium/low 三档）
//   ❌ 自报的可信度百分比、agent 自己写的卡片 HTML
// 这样接入几个不同的 agent，出来的卡片格式与可信度口径也一致 —— 因为那部分不在 agent 手里。
//
// ── 安装 ────────────────────────────────────────────────────────────────────
//   npm i -g @modelcontextprotocol/sdk        # 或在本目录 npm i
//   在 Supabase 的 site_config 表插一行：key='mcp_token'，value={"token":"<随机长字符串>"}
//   export PLANTSPEDIA_MCP_TOKEN=<同一个字符串>
//   （可选）export PLANTSPEDIA_BASE=https://plantspedia.club
//
// ── 接进 Claude Code ────────────────────────────────────────────────────────
//   claude mcp add plantspedia -- node /Users/xiezongxiu/Desktop/plantspedia/mcp/plantspedia-mcp.mjs
//   记得把 PLANTSPEDIA_MCP_TOKEN 配到环境里。

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const BASE = (process.env.PLANTSPEDIA_BASE || "https://plantspedia.club").replace(/\/+$/, "");
const TOKEN = process.env.PLANTSPEDIA_MCP_TOKEN || "";

if (!TOKEN) {
  console.error("[plantspedia-mcp] 缺少环境变量 PLANTSPEDIA_MCP_TOKEN —— 无法调用站点接口。");
}

async function callApi(path, payload) {
  const r = await fetch(`${BASE}/api/mcp/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify(payload ?? {}),
  });
  const text = await r.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`站点返回的不是 JSON（HTTP ${r.status}）：${text.slice(0, 300)}`);
  }
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

const server = new Server(
  { name: "plantspedia", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

const TOOLS = [
  {
    name: "plantspedia_list_tags",
    description:
      "列出 Plantspedia 站内已有的标签。批量建卡前**必须先调这个** —— 提交时只能使用已有标签，" +
      "站内不存在的标签会被拒绝（避免冒出「鄂尔多斯植物」「鄂尔多斯市植物」这类近义重复标签）。",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "plantspedia_submit_identification",
    description:
      "把**一张**照片的识别结果提交到 Plantspedia，建成一张简介摘要卡草稿。\n\n" +
      "调用前你需要自己完成识别：① 用你自己的 Pl@ntNet API key 调 " +
      "https://my-api.plantnet.org/v2/identify/all 拿到物种与 score；② 用你自己的视觉模型看图，" +
      "给出学名、中文名与 150–260 字的趣味导语。\n\n" +
      "**重要**：本工具只收「证据」不收「结论」。综合可信度百分比由 Plantspedia 服务端统一计算，" +
      "不要也无法传入自己算的百分比；卡片 HTML 也由服务端渲染。confidence 只能是 high/medium/low。\n" +
      "识别不确定时**必须诚实给 low**（会被标为「疑似」并单独归组，供人工复核）—— " +
      "错误定种比暂不定种更糟。",
    inputSchema: {
      type: "object",
      required: ["photo_path", "plantnet", "model_verdict"],
      properties: {
        photo_path: { type: "string", description: "本地照片的绝对路径（JPEG/PNG）" },
        lat: { type: "number", description: "拍摄纬度，可选" },
        lng: { type: "number", description: "拍摄经度，可选" },
        place: { type: "string", description: "拍摄地点中文描述，可选" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "要打的标签，**只能用 plantspedia_list_tags 返回的已有标签名**",
        },
        plantnet: {
          type: ["object", "null"],
          description:
            "你调 Pl@ntNet 得到的结果；**必须显式提供**，确实没调到就传 null（会如实记录为未参与）。",
          properties: {
            scientific_name: { type: "string" },
            score: { type: "number", description: "Pl@ntNet 原始分数，0–1 之间" },
            family: { type: "string" },
            genus: { type: "string" },
          },
        },
        model_verdict: {
          type: "object",
          required: ["scientific_name", "confidence", "summary_zh", "model"],
          description: "你自己的视觉模型给出的判定",
          properties: {
            scientific_name: { type: "string" },
            title: { type: "string", description: "中文物种名" },
            common_name_en: { type: "string" },
            common_names_zh: { type: "string" },
            family: { type: "string", description: "科（中文+拉丁）" },
            genus: { type: "string", description: "属（中文+拉丁）" },
            confidence: {
              type: "string",
              enum: ["high", "medium", "low"],
              description: "只有三档。不确定时必须给 low。",
            },
            summary_zh: {
              type: "string",
              description: "150–260 字趣味导语，博物学家口吻；不要罗列科属形态，不要复述拍摄地点",
            },
            model: { type: "string", description: "你实际使用的模型名，如实填写（会进用量与痕迹）" },
          },
        },
      },
    },
  },
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    if (name === "plantspedia_list_tags") {
      const r = await callApi("tags", {});
      const names = (r.tags || []).map((t) => t.name);
      return {
        content: [
          {
            type: "text",
            text: names.length
              ? `站内已有 ${names.length} 个标签：\n${names.join("\n")}`
              : "站内还没有任何标签。请先到管理后台创建，再来批量建卡。",
          },
        ],
      };
    }

    if (name === "plantspedia_submit_identification") {
      const buf = await readFile(args.photo_path);
      // 指纹用**原始文件字节**算，与站内 camera-identify 的口径一致 —— 同一张图重复提交
      // 会被站点挡下并返回已有草稿，不会重复建卡。
      const sha = createHash("sha256").update(buf).digest("hex");
      const ext = String(args.photo_path).toLowerCase();
      const mime = ext.endsWith(".png")
        ? "image/png"
        : ext.endsWith(".webp")
          ? "image/webp"
          : "image/jpeg";

      const r = await callApi("identify", {
        photo_base64: buf.toString("base64"),
        photo_mime: mime,
        lat: args.lat ?? null,
        lng: args.lng ?? null,
        place: args.place ?? null,
        tags: args.tags ?? [],
        plantnet: args.plantnet ?? null,
        model_verdict: args.model_verdict,
        photo_sha256: sha,
      });

      if (r.duplicate) {
        return {
          content: [
            { type: "text", text: `⏭ 跳过（这张照片已识别过）：${r.title}\n草稿：${BASE}/drafts/${r.draftId}` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text:
              `✅ 已建卡：${r.title}\n` +
              `综合可信度：${r.confidencePct}%（由 Plantspedia 服务端统一计算）\n` +
              `${r.tentative ? "⚠️ 判定为「疑似」，已标记待人工复核\n" : ""}` +
              `草稿：${BASE}/drafts/${r.draftId}`,
          },
        ],
      };
    }

    return { content: [{ type: "text", text: `未知工具：${name}` }], isError: true };
  } catch (e) {
    return {
      content: [{ type: "text", text: `失败：${e instanceof Error ? e.message : String(e)}` }],
      isError: true,
    };
  }
});

await server.connect(new StdioServerTransport());
console.error(`[plantspedia-mcp] 已启动，目标站点 ${BASE}`);
