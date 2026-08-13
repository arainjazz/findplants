import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { isAllowedImageHost, hostOf } from "@/lib/image-host-allowlist";

const ProxyImageInput = z.object({ url: z.string().url().max(2000) });

/**
 * Fetch an external image server-side and return it as a `data:` URL. This lets the
 * client draw cross-origin images (iNaturalist / GBIF / Wikimedia CDNs that send no
 * CORS headers) onto a <canvas> without tainting it — the share-card renderer falls
 * back to this when a direct CORS fetch of the cover fails. Size/type-capped;
 * returns `{ dataUrl: null }` on any failure so the caller degrades gracefully.
 */
export const proxyImageDataUrlFn = createServerFn({ method: "POST" })
  .inputValidator((input) => ProxyImageInput.parse(input))
  .handler(async ({ data }) => {
    try {
      const u = new URL(data.url);
      if (u.protocol !== "https:" && u.protocol !== "http:") return { dataUrl: null };
      // 白名单之外一律不抓（判定与断言都在 image-host-allowlist.ts）。和其它失败一样
      // 静默回 null —— 调用方（share-card）本来就会退到占位图，这里抛错只会把「一张卡
      // 画不出来」升级成「整个分享流程报错」。
      const ownHost = hostOf(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL);
      if (!isAllowedImageHost(u.hostname, ownHost)) return { dataUrl: null };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12_000);
      let r: Response;
      try {
        r = await fetch(data.url, {
          signal: controller.signal,
          headers: { "User-Agent": "Plantspedia/1.0 (share-card)" },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!r.ok) return { dataUrl: null };
      const ct = (r.headers.get("content-type") || "").split(";")[0].trim();
      if (!ct.startsWith("image/")) return { dataUrl: null };
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 8_000_000) return { dataUrl: null }; // 8MB cap
      const b64 = Buffer.from(new Uint8Array(buf)).toString("base64");
      return { dataUrl: `data:${ct};base64,${b64}` };
    } catch {
      return { dataUrl: null };
    }
  });
