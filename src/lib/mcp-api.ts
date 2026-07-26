// ═══ MCP HTTP 端点 ═══════════════════════════════════════════════════════════
//
// 为什么单独开一组 `/api/mcp/*` 而不是复用 server fn：TanStack Start 的 server-fn URL
// （`/_serverFn/<hash>`）是**内部实现细节**，hash 随构建变化，外部进程没法稳定调用。
// 这里给 MCP 一个契约稳定的入口。
//
// 鉴权：`Authorization: Bearer <token>`，比对 `site_config.mcp_token`。
// 只有 owner 自己在本机用（用户已确认不对其他编辑开放），所以不做多租户、不做 OAuth。

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** 常数时间比较 —— 避免用 `===` 比 token 时泄漏前缀信息。 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function authorize(request: Request): Promise<string | null> {
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return "缺少 Authorization: Bearer <token>";
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as any)
      .from("site_config")
      .select("value")
      .eq("key", "mcp_token")
      .maybeSingle();
    const raw = (data as { value?: unknown } | null)?.value;
    if (!raw) return "服务端未配置 mcp_token（请在 site_config 里设一个随机长字符串）";
    const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
    const expected = String(typeof cfg === "string" ? cfg : (cfg?.token ?? ""));
    if (!expected) return "服务端 mcp_token 为空";
    if (!safeEqual(token, expected)) return "token 不匹配";
    return null;
  } catch (e) {
    return `鉴权检查失败：${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * 处理 `/api/mcp/*`。**不属于本前缀的请求返回 null**，由调用方继续走正常渲染管线。
 */
export async function handleMcpRequest(request: Request): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/mcp/")) return null;
  if (request.method !== "POST") return json({ error: "只接受 POST" }, 405);

  const authErr = await authorize(request);
  if (authErr) return json({ error: `未授权：${authErr}` }, 401);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: "请求体不是合法 JSON" }, 400);
  }

  try {
    // ── 列出已有标签 ──────────────────────────────────────────────────────
    // agent **只能从已有标签里选**（用户已定），所以必须先能列出来。
    if (url.pathname === "/api/mcp/tags") {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await (supabaseAdmin as any)
        .from("tags")
        .select("id, name, slug")
        .order("name");
      if (error) return json({ error: error.message }, 500);
      return json({ tags: data ?? [] });
    }

    // ── 摄入一条识别结果 ──────────────────────────────────────────────────
    if (url.pathname === "/api/mcp/identify") {
      const v = body?.model_verdict;
      // 严格校验：宁可拒绝也不要建出一张字段残缺的卡。
      if (!body?.photo_base64 || typeof body.photo_base64 !== "string") {
        return json({ error: "缺少 photo_base64" }, 400);
      }
      if (!v?.scientific_name || !v?.summary_zh || !v?.model) {
        return json(
          { error: "model_verdict 必须含 scientific_name / summary_zh / model" },
          400,
        );
      }
      if (!["high", "medium", "low"].includes(v?.confidence)) {
        return json(
          {
            error:
              "model_verdict.confidence 只接受 high / medium / low 三档。" +
              "本站不接受 agent 自报的百分比 —— 综合可信度由服务端统一计算。",
          },
          400,
        );
      }
      // **强制要求显式给出 plantnet 字段**（可以是 null，但必须写出来）。
      // 这是为了逼着 agent 真的去调专业引擎，而不是只用自己的模型糊弄过去。
      if (!("plantnet" in body)) {
        return json(
          {
            error:
              "必须显式提供 plantnet 字段（调用 Pl@ntNet 的结果；确实没调到就传 null）。",
          },
          400,
        );
      }

      // 标签白名单：只允许已有标签，防止冒出「鄂尔多斯植物」「鄂尔多斯市植物」这类近义标签。
      let tags: string[] = Array.isArray(body.tags) ? body.tags.map(String) : [];
      if (tags.length) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: known } = await (supabaseAdmin as any).from("tags").select("name");
        const allowed = new Set((known ?? []).map((t: any) => String(t.name)));
        const unknown = tags.filter((t) => !allowed.has(t));
        if (unknown.length) {
          return json(
            {
              error: `这些标签站内不存在：${unknown.join("、")}。只能使用已有标签（先调 /api/mcp/tags 查询）。`,
            },
            400,
          );
        }
      }

      // 照片查重：同一张图重复提交时直接返回已有草稿，不重复建卡。
      if (body.photo_sha256 && /^[a-f0-9]{64}$/.test(String(body.photo_sha256))) {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: hit } = await (supabaseAdmin as any)
          .from("plant_drafts")
          .select("id, title")
          .eq("ai_payload->>_photo_sha256", String(body.photo_sha256))
          .limit(1);
        const found = (hit ?? [])[0];
        if (found) {
          return json({
            duplicate: true,
            draftId: found.id,
            title: found.title,
            message: "这张照片已经识别过，未重复建卡。",
          });
        }
      }

      const { ingestMcpIdentification } = await import("./identify-plant.functions");
      const result = await ingestMcpIdentification({
        photo_base64: body.photo_base64,
        photo_mime: String(body.photo_mime || "image/jpeg"),
        lat: body.lat ?? null,
        lng: body.lng ?? null,
        place: body.place ?? null,
        tags,
        plantnet: body.plantnet ?? null,
        model_verdict: v,
        photo_sha256: body.photo_sha256,
      });
      return json({ duplicate: false, ...result });
    }

    return json({ error: `未知端点 ${url.pathname}` }, 404);
  } catch (e) {
    console.error("[MCP API] handler failed:", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}
