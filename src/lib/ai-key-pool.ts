/** Split a comma-joined API key pool (the console stores multi-key configs this way). */
export function splitKeyPool(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
}

/** 401/403 = key belongs to another vendor or was revoked; 429 = rate limited. */
export function keyRejected(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

/**
 * POST with `Authorization: Bearer <key>`, rotating across the pool. The console keeps
 * ONE key list shared across providers, so a pool routinely holds other vendors' keys
 * (a Gemini "AQ.…" sitting above a Moonshot "sk-…"); sending the joined string as a
 * bearer token is an automatic 401. A rejected key advances to the next one — anything
 * else (200, 400, 5xx) is returned as-is so the caller's own retry logic still applies.
 */
export async function bearerFetchRotating(
  url: string,
  keyPoolRaw: string,
  init: RequestInit & { headers?: Record<string, string> },
): Promise<Response> {
  const keys = splitKeyPool(keyPoolRaw);
  const pool = keys.length ? keys : [String(keyPoolRaw ?? "")];
  let resp!: Response;
  for (let i = 0; i < pool.length; i++) {
    resp = await fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${pool[i]}` },
    });
    if (resp.ok || !keyRejected(resp.status)) break;
  }
  return resp;
}

/**
 * 各家对「可调参数」的支持差别很大，不支持时一律回 400 而不是忽略。已知例子：
 * Kimi K3 只允许 `temperature: 1`（显式传 0 就报 `invalid temperature: only 1 is
 * allowed for this model`），OpenAI 的 o 系列同理，部分中转不认 `response_format`。
 *
 * 与其为每家维护一张「支持哪些参数」的表（新模型一出就过期），不如**从报错里认**：
 * 400 的错误文本提到了我们发出去的哪个可调参数，就把那个参数删掉重试一次。
 * 厂商无关，新模型不用改代码。
 */
const TUNABLE_PARAMS = [
  "temperature",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "response_format",
  "max_tokens",
  // ⚠️ 「关思考」的三种主流写法，见 THINKING_OFF。各家名字不一样、且互相不认：
  // 发过去不支持的那个多半被忽略，但也有中转直接 400 —— 所以必须列进来，
  // 好让上面那套「从 400 报错里认出是哪个参数惹的祸，去掉重试」的机制罩住它们。
  "enable_thinking",
  "reasoning_effort",
  "thinking",
] as const;

/**
 * 「别思考，直接答」——**厂商无关**的关思考参数集。
 *
 * 为什么需要：二次复核配的常是 qwen3 / glm / deepseek 这类**推理模型**，默认会先生成
 * 一大段思维链再作答。复核的活儿是「再看一眼图，给个物种和档位」，思考链对结论几乎没有
 * 增益，却能把一次调用从 8 秒拖到 40 秒以上 —— 于是必然撞上超时，前台显示「二次复核未运行」。
 *
 * 三个键一起发：不支持的那个通常被静默忽略；真被 400 拒收时，postOpenAICompat 会从报错
 * 文本里认出它并去掉重试（TUNABLE_PARAMS 已收录）。所以既不用维护「哪家支持哪个」的表，
 * 也不会因为多发一个键把请求打死。
 */
export const THINKING_OFF = {
  enable_thinking: false, // 阿里 Qwen3 / DashScope
  reasoning_effort: "low", // OpenAI o 系列 / 部分中转
  thinking: { type: "disabled" }, // 智谱 GLM / Anthropic 风格
} as const;

/**
 * 「请思考」—— 与 `THINKING_OFF` 严格对称的**开**思考参数集。
 *
 * 为什么需要它（2026-07-30 用户要求「点击开关是真的能开也能关」）：
 * 在此之前，`thinking: "on"` 的实现是**一个参数都不发**、让模型按自己的默认来。
 * 于是这个开关只有一半是真的 —— 「关」真能关，「开」只是「不管」。
 * 后果在金叶详页上被实测抓住：`gold` 控制台默认 `"on"`，配的又是 kimi-k3
 * （推理模型，自己默认开思维链），管理员在界面上看不到任何「已开启」的动作，
 * 却每次都因为模型想太久、网关等不到字节而 HTTP 524。
 *
 * 三个键一起发，理由与 THINKING_OFF 逐条对应：不支持的那个通常被静默忽略，
 * 真被 400 拒收时 postOpenAICompat 会从报错文本里认出它并去掉重试。
 *
 * ⚠️ `reasoning_effort` 刻意用 `"medium"` 而不是 `"high"`：这里要表达的是
 * 「按正常强度思考」，不是「用尽预算深思」。后者在长文链路上很容易把单次调用
 * 拖过中转的网关时限（正是 524 的成因），不该由一个「开/关」开关悄悄带来。
 */
export const THINKING_ON = {
  enable_thinking: true, // 阿里 Qwen3 / DashScope
  reasoning_effort: "medium", // OpenAI o 系列 / 部分中转
  thinking: { type: "enabled" }, // 智谱 GLM / Anthropic 风格
} as const;

/**
 * Gemini 的思考参数。**与上面那套 OpenAI 兼容的键完全不同**，所以单独一份 ——
 * 放在这里是为了让「三家各自怎么开关思考」都待在同一个文件里，别散落到调用处。
 *
 * 代际差异是硬的，不能只发一种：
 * · **Gemini 3**（`gemini-3*`）用 `thinkingLevel: "low" | "high"`，
 *   而且**没有「完全关闭」这一档** —— 最低就是 low。所以「关」对 Gemini 3 的真实含义是
 *   「把思考强度压到最低」，不是「不思考」。这一点必须写明，否则以后有人会拿它当
 *   「已彻底关闭」的依据去查别的 bug。
 * · **Gemini 2.5 及更早**用 `thinkingBudget`：`0` = 真关闭，`-1` = 动态（模型自己定）。
 *
 * ⚠️ 代际只能从模型名猜，而名字从来不是能力契约。猜错时 Gemini 直接 400，
 * 且 `callGeminiWithRotation` 对 400 的策略是「配置错误，每个 key 结果一样 → 立刻上抛」，
 * **没有**本文件 `postOpenAICompat` 那套「去掉惹祸的参数重试」。所以 geminiChat 里额外
 * 加了一道「400 点名 thinking 字段就去掉该字段重发」的安全网 —— 两处要一起看。
 */
export function geminiThinkingConfig(model: string, thinkingOn: boolean): Record<string, unknown> {
  if (/^gemini-3/i.test(String(model ?? "").trim())) {
    return { thinkingConfig: { thinkingLevel: thinkingOn ? "high" : "low" } };
  }
  return { thinkingConfig: { thinkingBudget: thinkingOn ? -1 : 0 } };
}

/** 400 文本里点名了哪些我们发过的可调参数。 */
export function offendingParams(errorText: string, body: Record<string, unknown>): string[] {
  const t = errorText.toLowerCase();
  return TUNABLE_PARAMS.filter((p) => p in body && t.includes(p));
}

/**
 * POST 一个 OpenAI 兼容请求；若因某个可调参数被 400 拒收，去掉该参数重试一次。
 * 只重试一次 —— 第二次还 400 就是真的请求有问题，再试下去只是拖时间。
 */
export async function postOpenAICompat(
  url: string,
  keyPoolRaw: string,
  body: Record<string, unknown>,
  opts: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> {
  const send = (b: Record<string, unknown>) =>
    bearerFetchRotating(url, keyPoolRaw, {
      method: "POST",
      signal: opts.signal,
      headers: { "Content-Type": "application/json", ...(opts.headers ?? {}) },
      body: JSON.stringify(b),
    });

  const resp = await send(body);
  if (resp.status !== 400) return resp;

  const text = await resp.clone().text();
  const drop = offendingParams(text, body);
  if (!drop.length) return resp; // 400 与参数无关 → 原样返回，别掩盖真错误
  const retryBody = { ...body };
  for (const p of drop) delete retryBody[p];
  console.warn(`[OpenAI-compat] 该模型不接受 ${drop.join(" / ")}，已去掉重试`);
  return send(retryBody);
}

/**
 * 流式版本 —— 专治 524 / 504。
 *
 * 生成一份完整草稿要几十秒到几分钟，中转网关（Moonshot 前面就是 Cloudflare）在
 * 上游长时间不吐字节时会直接判超时返回 524，重试多少次都一样，因为每次都同样慢。
 * 开 `stream: true` 后 token 是边生成边回的，网关一直看得到数据，就不会超时。
 *
 * 为了让调用方无感，这里把 SSE 增量拼回一个**和普通响应同形**的 Response
 * （`choices[0].message.content` + `usage`），上层的 `resp.json()` 照旧能用。
 */
export async function postOpenAICompatStream(
  url: string,
  keyPoolRaw: string,
  body: Record<string, unknown>,
  opts: { headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> {
  const resp = await postOpenAICompat(url, keyPoolRaw, { ...body, stream: true }, opts);
  // 非 2xx（含不支持流式而报错的中转）→ 原样交回，由调用方决定降级/报错。
  if (!resp.ok || !resp.body) return resp;

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let content = "";
  let usage: unknown = null;
  let sawAnyChunk = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // SSE：事件之间用空行分隔，每行以 "data: " 开头。
      const lines = buf.split("\n");
      buf = lines.pop() ?? ""; // 最后一行可能不完整，留到下一轮
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const j = JSON.parse(payload);
          sawAnyChunk = true;
          const delta = j.choices?.[0]?.delta?.content;
          if (typeof delta === "string") content += delta;
          // 有些服务只在最后一个 chunk 带 usage。
          if (j.usage) usage = j.usage;
        } catch {
          /* 半个 JSON / 心跳行，跳过 */
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // 对方回了 200 但根本不是 SSE（有些中转把 stream 参数忽略了）→ 让调用方回退非流式。
  if (!sawAnyChunk) {
    return new Response(JSON.stringify({ error: { message: "NOT_A_STREAM" } }), {
      status: 599,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ choices: [{ message: { content } }], usage }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
