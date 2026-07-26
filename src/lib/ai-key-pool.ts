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
