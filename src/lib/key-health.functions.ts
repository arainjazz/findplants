import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ─── 单个 API Key 的「连通性 + 余额/配额」体检 ────────────────────────────────
// 每个已配置的 key 各自一个刷新按钮，按下才发请求（不做轮询：这些接口本身要么消耗配额、
// 要么有速率限制，后台定时刷会把额度悄悄烧掉）。
//
// 与既有「视觉自检」的分工：视觉自检回答「这个模型**能不能看图**」（要发一张真图，只对
// LLM 有意义）；这里回答「这个 key **通不通、还剩多少**」。Pl@ntNet 不是 LLM，没有视觉
// 自检可言，但它恰恰是最需要看配额的那个 —— 免费额度 500 次/天，以前完全是黑盒，只有
// 撞上 429 的那一刻才知道用光了。

export type KeyHealth = {
  ok: boolean;
  /** 一句话结论，直接显示给管理员。 */
  detail: string;
  /** 能读到就填：剩余可用次数 / 额度。读不到保持 null —— **绝不猜**。 */
  remaining: number | null;
  /** 额度上限（若接口给了）。 */
  limit: number | null;
  /** 本站自己记的「已耗尽」标记状态（仅 Pl@ntNet 有）。 */
  localState?: string | null;
};

const Input = z.object({
  target: z.enum(["plantnet", "openai-compat"]),
  /** openai-compat 用：不传则用库里保存的配置。 */
  apiKey: z.string().max(400).optional(),
  baseUrl: z.string().max(300).optional(),
  model: z.string().max(200).optional(),
  /** 序列项的 provider。gemini / anthropic 走各自的原生 API，不是 OpenAI 兼容格式。 */
  provider: z.string().max(40).optional(),
});

async function assertAdmin(supabase: any, userId: string) {
  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  if (!roles?.some((r: { role: string }) => r.role === "admin")) {
    throw new Error("仅管理员可做 Key 体检");
  }
}

export const checkKeyHealthFn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data, context }): Promise<KeyHealth> => {
    const { supabase, userId } = context as { supabase: any; userId: string };
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.target === "plantnet") {
      // key 优先用页面上正在编辑的那个（还没保存也能先测），否则读库里已保存的。
      let apiKey = (data.apiKey || "").replace(/\s+/g, "");
      if (!apiKey) {
        const { data: row } = await (supabaseAdmin as any)
          .from("site_config")
          .select("value")
          .eq("key", "plantnet_api_key")
          .maybeSingle();
        const raw = (row as { value?: unknown } | null)?.value;
        if (raw) {
          const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
          apiKey = String(typeof cfg === "string" ? cfg : (cfg?.apiKey ?? "")).replace(/\s+/g, "");
        }
      }
      if (!apiKey) {
        return { ok: false, detail: "未配置 Pl@ntNet API Key。", remaining: null, limit: null };
      }

      // 读本站自己记的耗尽标记 —— 这是「为什么识别里 Pl@ntNet 没参与」的直接答案。
      let localState: string | null = null;
      try {
        const { data: st } = await (supabaseAdmin as any)
          .from("site_config")
          .select("value")
          .eq("key", "plantnet_quota_state")
          .maybeSingle();
        const raw = (st as { value?: unknown } | null)?.value;
        if (raw) {
          const cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
          const at = Date.parse(cfg?.exhaustedAt ?? "");
          if (Number.isFinite(at)) {
            const mins = Math.round((Date.now() - at) / 60000);
            localState =
              mins < 60
                ? `本站于 ${mins} 分钟前记录过额度耗尽（1 小时内会跳过 Pl@ntNet）`
                : `上次记录额度耗尽在 ${Math.round(mins / 60)} 小时前，已过退避窗口`;
          }
        }
      } catch {
        /* 读不到标记不影响体检结论 */
      }

      // 用 GET /v2/status 探活：**不消耗识别配额**，也不用伪造一张图去换答案。
      try {
        const r = await fetch(
          `https://my-api.plantnet.org/v2/status?api-key=${encodeURIComponent(apiKey)}`,
          { headers: { "User-Agent": "Plantspedia/1.0" } },
        );
        const body = await r.text().catch(() => "");
        // 配额有时在响应头里给（各家网关实现不一），能读到就读，读不到就如实说不知道。
        const hRemain = r.headers.get("x-ratelimit-remaining") ?? r.headers.get("x-quota-remaining");
        const hLimit = r.headers.get("x-ratelimit-limit") ?? r.headers.get("x-quota-limit");
        let remaining = hRemain != null && hRemain !== "" ? Number(hRemain) : null;
        let limit = hLimit != null && hLimit !== "" ? Number(hLimit) : null;
        // 正文若是 JSON，尝试取常见字段名。
        try {
          const j = JSON.parse(body);
          if (remaining == null && typeof j?.remaining === "number") remaining = j.remaining;
          if (limit == null && typeof j?.quota === "number") limit = j.quota;
        } catch {
          /* 不是 JSON 就算了 */
        }
        if (!Number.isFinite(remaining as number)) remaining = null;
        if (!Number.isFinite(limit as number)) limit = null;

        if (r.status === 401 || r.status === 403) {
          return {
            ok: false,
            detail: `Key 无效或已停用（HTTP ${r.status}）。请到 my.plantnet.org 重新获取。`,
            remaining,
            limit,
            localState,
          };
        }
        if (r.status === 429) {
          return {
            ok: false,
            detail: "额度已用尽（HTTP 429）。Pl@ntNet 免费额度为 500 次/天，等待重置即可。",
            remaining: remaining ?? 0,
            limit,
            localState,
          };
        }
        if (!r.ok) {
          return {
            ok: false,
            detail: `连通异常：HTTP ${r.status} ${body.slice(0, 120)}`,
            remaining,
            limit,
            localState,
          };
        }
        return {
          ok: true,
          detail:
            remaining != null
              ? `连通正常，剩余约 ${remaining}${limit != null ? ` / ${limit}` : ""} 次`
              : "连通正常。Pl@ntNet 未在响应中返回剩余次数，故无法显示具体余额（免费额度为 500 次/天）。",
          remaining,
          limit,
          localState,
        };
      } catch (e) {
        return {
          ok: false,
          detail: `请求失败：${e instanceof Error ? e.message : String(e)}`,
          remaining: null,
          limit: null,
          localState,
        };
      }
    }

    // ── 各家模型端点 ────────────────────────────────────────────────────────
    // 这些厂商**没有统一的余额查询接口**，各家路径与字段都不同，所以这里只做「连通性 +
    // key 是否有效 + 是否正在被限流」，不假装能读出余额。都用最轻的「列模型」接口：
    // 不产生 token 费用，也不会污染用量统计。
    const apiKey = (data.apiKey || "").replace(/\s+/g, "");
    if (!apiKey) {
      return { ok: false, detail: "缺少 API Key。", remaining: null, limit: null };
    }
    const provider = (data.provider || "").toLowerCase();

    // **gemini / anthropic 走各自的原生 API，不是 OpenAI 兼容格式**，所以 baseUrl 允许为空
    // （model-queue.ts 里这两家用官方地址时 baseUrl 就是 ""），端点和鉴权方式也各不相同。
    // 以前这里一律按 OpenAI 兼容处理，Gemini 只能报「缺少 Base URL」——按钮也因此被灰掉。
    let url: string;
    let headers: Record<string, string>;
    if (provider === "gemini") {
      const base = (data.baseUrl || "").trim().replace(/\/+$/, "") ||
        "https://generativelanguage.googleapis.com/v1beta";
      url = `${base}/models?key=${encodeURIComponent(apiKey)}`;
      headers = {}; // Gemini 用 query 参数带 key，不用 Authorization 头
    } else if (provider === "anthropic") {
      const base = (data.baseUrl || "").trim().replace(/\/+$/, "") || "https://api.anthropic.com/v1";
      url = `${base}/models`;
      headers = { "x-api-key": apiKey, "anthropic-version": "2023-06-01" };
    } else {
      const base = (data.baseUrl || "").trim().replace(/\/+$/, "");
      if (!base) {
        return { ok: false, detail: "缺少 Base URL。", remaining: null, limit: null };
      }
      url = `${base}/models`;
      headers = { Authorization: `Bearer ${apiKey}` };
    }

    try {
      const r = await fetch(url, { headers });
      const body = await r.text().catch(() => "");
      if (r.status === 401 || r.status === 403) {
        return {
          ok: false,
          detail: `Key 无效或无权限（HTTP ${r.status}）。注意别把 IAM 的 AK/SK 当成数据面 API Key。`,
          remaining: null,
          limit: null,
        };
      }
      if (r.status === 429) {
        return {
          ok: false,
          detail: "正在被限流（HTTP 429）—— key 本身有效，但当前速率/额度已打满。",
          remaining: null,
          limit: null,
        };
      }
      if (!r.ok) {
        return {
          ok: false,
          detail: `连通异常：HTTP ${r.status} ${body.slice(0, 140)}`,
          remaining: null,
          limit: null,
        };
      }
      let count = 0;
      try {
        const j = JSON.parse(body);
        // OpenAI 兼容 / Anthropic 用 `data`，Gemini 用 `models` —— 两个都认。
        const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j?.models) ? j.models : [];
        count = arr.length;
      } catch {
        /* ignore */
      }
      return {
        ok: true,
        detail:
          `连通正常，该 Key 可见 ${count} 个模型。` +
          `（各厂商没有统一的余额接口，本站不显示余额数字，以免给出编造的数值。）`,
        remaining: null,
        limit: null,
      };
    } catch (e) {
      return {
        ok: false,
        detail: `请求失败：${e instanceof Error ? e.message : String(e)}`,
        remaining: null,
        limit: null,
      };
    }
  });
