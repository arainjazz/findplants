import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function htmlToText(html: string): string {
  // Strip head/script/style and tags, keep readable text
  const noHead = html.replace(/<head[\s\S]*?<\/head>/gi, " ");
  const noScripts = noHead
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const bodyMatch = noScripts.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : noScripts;
  const text = body
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 30000);
}

function cleanJson(str: string): string {
  let cleaned = str.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/```$/, "").trim();
  }
  return cleaned;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { htmlUrl, html } = await req.json();
    let raw = html as string | undefined;
    if (!raw && htmlUrl) {
      const r = await fetch(htmlUrl);
      if (!r.ok) throw new Error(`无法获取 HTML：${r.status}`);
      raw = await r.text();
    }
    if (!raw) throw new Error("缺少 htmlUrl 或 html");

    const text = htmlToText(raw);

    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");

    const systemPrompt = `你是植物信息抽取助手。给定一个植物图鉴页面的纯文本，
严格只通过 JSON 结构返回结果。规则：
- title：植物中文名称。优先取页面 H1/标题/中文名，找不到留空。
- scientific_name：拉丁学名（含命名人，如 "Butomus umbellatus L."）。找不到留空。
- common_name_en：英文俗名 / common name（例如 "Flowering rush"）。优先取页面中明确标注的 common name / English name；
  若同时给出多个，挑选最常用的一个；找不到留空字符串。
- slug：基于「拉丁学名」生成的 URL 友好字符串。**必须只包含 ASCII 小写字母、数字、连字符**，
  绝对禁止出现任何中文、空格或其他 Unicode 字符（例如正确："butomus-umbellatus"；错误："花蔺-butomus"）。
  若无法从拉丁学名生成合法 ASCII slug，则返回空字符串。
- family：**仅科（family）**。中文+拉丁，例如 "花蔺科 Butomaceae"。
  绝对禁止把属写进这个字段。如果原文写成 "花蔺科 Butomaceae 花蔺属 Butomus"，
  本字段只能填 "花蔺科 Butomaceae"，属必须单独写进 genus。
- genus：**仅属（genus）**。中文+拉丁，例如 "花蔺属 Butomus"。
  如果原文里科属写在一起，必须把属拆出来填到这里；
  如果原文没有属，但拉丁学名首词是属名，请补全为 "<中文属名> <属>" 或至少返回 "<属>"。
  绝对不要留空，除非确实无法判断。
- habitat：本字段实际表示「物种入侵 Invasion」信息。
  若页面提及该物种在某些区域构成入侵（invasive / 入侵 / 归化 / 外来入侵 等），写一句简短中文说明：在哪些国家/地区构成入侵；
  若页面没有任何入侵相关记载，必须填写固定字符串 "无记录"。不要写普通的生境/分布。
- tags：标签数组，自动包含可识别到的：年限（一年生/二年生/多年生）、关键生境词（湿地/水生/旱生/草本/木本等）、IUCN 评级（LC/NT/VU/EN/CR/DD）、入侵相关词（invasive/入侵物种 等，若适用）。
- iucn_status：仅当原文明确写出 IUCN 评级时填入对应代码（EX/EW/CR/EN/VU/NT/LC/DD），找不到则返回空字符串。
- summary：植物简介，150-250 字。优先抽取页面"简介/概述/描述/Introduction/Description"段落原文，去除标签；找不到则基于全文摘要。
找不到的字段返回空字符串或空数组（habitat 例外，按上面规则填 "无记录"），不要编造。`;

    if (geminiKey) {
      let model = Deno.env.get("AI_MODEL") || "gemini-1.5-flash";
      if (model === "gemini-2.5-flash") {
        model = "gemini-1.5-flash";
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
      const schema = {
        type: "object",
        properties: {
          title: { type: "string" },
          scientific_name: { type: "string" },
          common_name_en: { type: "string" },
          slug: { type: "string" },
          family: { type: "string" },
          genus: { type: "string" },
          habitat: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          iucn_status: { type: "string" },
          summary: { type: "string" },
        },
        required: [
          "title",
          "scientific_name",
          "common_name_en",
          "slug",
          "family",
          "genus",
          "habitat",
          "tags",
          "iucn_status",
          "summary",
        ]
      };

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            { role: "user", parts: [{ text: `以下是页面正文文本：\n\n${text}` }] }
          ],
          systemInstruction: {
            parts: [{ text: systemPrompt }]
          },
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: schema
          }
        })
      });

      if (!resp.ok) {
        const t = await resp.text();
        console.error("Gemini API Error in extract-plant-meta:", resp.status, t);
        throw new Error(`Gemini extract-meta error (HTTP ${resp.status})`);
      }

      const data = await resp.json();
      const txt = data.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) throw new Error("Gemini 未返回有效文本");
      
      const parsed = JSON.parse(cleanJson(txt));
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (openaiKey) {
      const apiBase = Deno.env.get("OPENAI_API_BASE") || Deno.env.get("AI_API_BASE") || "https://api.openai.com/v1";
      const model = Deno.env.get("OPENAI_MODEL") || Deno.env.get("AI_MODEL") || "gpt-4o-mini";
      
      const resp = await fetch(`${apiBase}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openaiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `以下是页面正文文本：\n\n${text}` }
          ],
          response_format: { type: "json_object" }
        })
      });

      if (!resp.ok) {
        const t = await resp.text();
        console.error("OpenAI API Error in extract-plant-meta:", resp.status, t);
        throw new Error(`OpenAI extract-meta error (HTTP ${resp.status})`);
      }

      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new Error("OpenAI 未返回内容");
      
      const parsed = JSON.parse(cleanJson(content));
      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (lovableKey) {
      const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: `以下是页面正文文本：\n\n${text}` },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_plant_meta",
                description: "返回从植物页面抽取出的结构化信息",
                parameters: {
                  type: "object",
                  properties: {
                    scientific_name: { type: "string" },
                    title: { type: "string" },
                    common_name_en: { type: "string" },
                    slug: { type: "string" },
                    family: { type: "string" },
                    genus: { type: "string" },
                    habitat: { type: "string" },
                    tags: { type: "array", items: { type: "string" } },
                    iucn_status: { type: "string" },
                    summary: { type: "string" },
                  },
                  required: [
                    "title",
                    "scientific_name",
                    "common_name_en",
                    "slug",
                    "family",
                    "genus",
                    "habitat",
                    "tags",
                    "iucn_status",
                    "summary",
                  ],
                  additionalProperties: false,
                },
              },
            },
          ],
          tool_choice: { type: "function", function: { name: "extract_plant_meta" } },
        }),
      });

      if (!aiResp.ok) {
        if (aiResp.status === 429)
          return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        if (aiResp.status === 402)
          return new Response(JSON.stringify({ error: "AI 额度已用完，请到工作区充值" }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        const t = await aiResp.text();
        console.error("AI gateway error", aiResp.status, t);
        throw new Error(`AI 网关错误 ${aiResp.status}`);
      }

      const data = await aiResp.json();
      const call = data.choices?.[0]?.message?.tool_calls?.[0];
      const args = call?.function?.arguments;
      if (!args) throw new Error("AI 未返回结构化结果");
      const parsed = typeof args === "string" ? JSON.parse(args) : args;

      return new Response(JSON.stringify(parsed), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("AI 提取服务未配置。请在 Supabase Secrets 中设置 GEMINI_API_KEY 或 OPENAI_API_KEY。");
  } catch (e) {
    console.error("extract-plant-meta error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
