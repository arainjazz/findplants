import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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
