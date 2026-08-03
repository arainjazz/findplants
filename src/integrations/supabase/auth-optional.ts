// ─── 可选登录的 serverFn 中间件 ────────────────────────────────────────────────
//
// 与同目录 `auth-middleware.ts` 的 `requireSupabaseAuth` 是一对：那个「没令牌就抛」，
// 这个「没令牌就放行，但 userId 给 null」。**两者的共同底线是一样的**：
// userId 只可能来自**服务端验过的令牌**，绝不采信前端传来的任何 id ——
// 否则任何人填一个别人的 uuid 就能读走别人的任务、以别人的名义写动态流。
//
// 为什么需要它（2026-08-03）：匿名识别原本走同步老路，整条链挂在一个 HTTP 请求上，
// 必然撞 Cloudflare 边缘 100 秒上限。要把匿名也搬进队列，`startQuickIdentifyFn` /
// `pollJobFn` / `cancelJobFn` 就得同时接待「登录的」和「没登录的」两种人。
//
// ⚠️ **令牌无效 ≠ 匿名**：带了 Authorization 却验不过（伪造 / 过期没刷上）一律抛错。
// 悄悄降级成匿名的话，登录用户的任务会落到一个匿名 id 名下 —— 他自己反而查不到了。
// 只有「压根没带 Authorization 头」才算匿名。
//
// 注：`auth-middleware.ts` 顶上写着「自动生成，勿直接编辑」，所以这里另起一个文件。

import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

export const optionalSupabaseAuth = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    // 单一出口：两条分支都要产出同一个 context 形状，否则 handler 那头拿到的
    // userId 类型会随分支漂移（string | null 与 string 混在一起，推断直接崩）。
    let userId: string | null = null;

    const request = getRequest();
    const authHeader = request?.headers?.get("authorization");
    const token =
      authHeader && authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : "";

    // 带了令牌就必须验得过；没带 = 匿名访客，正常放行。
    if (token) {
      const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const SUPABASE_PUBLISHABLE_KEY =
        process.env.SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
        throw new Error(
          "Missing Supabase environment variable(s): SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY.",
        );
      }

      const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      });

      const { data, error } = await supabase.auth.getClaims(token);
      if (error || !data?.claims?.sub) throw new Error("Unauthorized: Invalid token");
      userId = data.claims.sub as string;
    }

    return next({ context: { userId } });
  },
);
