import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function decodeEntities(text: string) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function attr(html: string, selector: RegExp) {
  const match = html.match(selector);
  return match?.[1] ? decodeEntities(match[1].trim()) : "";
}

function absolutize(value: string, base: string) {
  try {
    return new URL(value, base).href;
  } catch {
    return value;
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function htmlToText(html: string) {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  ).slice(0, 24000);
}

function extractImageCandidates(html: string, baseUrl: string) {
  const candidates = [
    attr(html, /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i),
    attr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["'][^>]*>/i),
    attr(html, /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i),
    attr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["'][^>]*>/i),
  ];
  const imgRegex = /<img\b[^>]+src=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(imgRegex)) candidates.push(match[1]);
  return unique(candidates.map((src) => absolutize(src, baseUrl))).slice(0, 12);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { url } = await req.json();
    if (!url || typeof url !== "string") throw new Error("缺少文章网址");
    const normalizedUrl = new URL(url).href;

    const browserHeaders = {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    };
    let response = await fetch(normalizedUrl, {
      headers: browserHeaders,
      redirect: "follow",
    });
    let html = response.ok ? await response.text() : "";
    if (!response.ok || !html) {
      // Fallback: jina reader proxy bypasses anti-bot blocks (zhihu, etc.)
      const proxyUrl = `https://r.jina.ai/${normalizedUrl}`;
      const proxied = await fetch(proxyUrl, { headers: browserHeaders, redirect: "follow" });
      if (!proxied.ok) throw new Error(`无法读取文章：${response.status}`);
      html = await proxied.text();
    }
    const title =
      attr(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      attr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["'][^>]*>/i) ||
      attr(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
      normalizedUrl;
    const description =
      attr(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      attr(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
      attr(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["'][^>]*>/i);
    const imageCandidates = extractImageCandidates(html, normalizedUrl);
    const text = htmlToText(html);

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY 未配置");

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          {
            role: "system",
            content:
              "你是植物图鉴的推荐阅读编辑。严格只用 recommend_post 工具返回：精炼标题、最适合作为预览的图片 URL、80-140 字中文精彩摘录。不要编造正文没有的信息。图片只能从候选列表中选择。",
          },
          {
            role: "user",
            content: JSON.stringify({
              url: normalizedUrl,
              title,
              description,
              imageCandidates,
              text,
            }),
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "recommend_post",
              description: "返回推荐博文预览卡片信息",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  image_url: { type: "string" },
                  excerpt: { type: "string" },
                },
                required: ["title", "image_url", "excerpt"],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: "function", function: { name: "recommend_post" } },
      }),
    });

    if (!aiResp.ok) {
      if (aiResp.status === 429) {
        return new Response(JSON.stringify({ error: "请求过于频繁，请稍后再试" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResp.status === 402) {
        return new Response(JSON.stringify({ error: "AI 额度已用完，请到工作区充值" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI 识别失败：${aiResp.status}`);
    }

    const data = await aiResp.json();
    const args = data.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    const parsed = args ? (typeof args === "string" ? JSON.parse(args) : args) : {};

    return new Response(
      JSON.stringify({
        url: normalizedUrl,
        title: parsed.title || title,
        image_url: parsed.image_url || imageCandidates[0] || "",
        excerpt: parsed.excerpt || description || text.slice(0, 140),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("extract-recommended-post error", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "未知错误" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
