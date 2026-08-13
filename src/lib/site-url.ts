/**
 * 站点规范来源，以及把站内相对路径拼成绝对地址的小工具。
 *
 * 为什么需要：`og:image` / `twitter:image` **必须是绝对 URL**。微信、Twitter、Telegram
 * 这些抓取器拿到 `/default-og-image.jpg` 这样的相对路径时行为各不相同，多数直接当无效
 * 值丢掉 —— 于是分享出去连兜底图都没有。站内三处分享卡 meta（植物详页 / 博客详页 /
 * 草稿页）以前都写的相对路径。
 *
 * 域名写死成 `plantspedia.club`（不带 www）：这两个域名指向同一个 Worker，分享卡里
 * 该固定用哪一个是**内容决策**而不是运行时信息 —— 抓取器缓存的是 URL，同一张图在两个
 * 域名下会被当成两份。SSR 期间也没有稳定可靠的方式反推「用户当初从哪个域名进来」。
 */
export const SITE_ORIGIN = "https://plantspedia.club";

/** 站点默认分享图（1200×630，放在 `public/`）。没有封面的条目一律回落到它。 */
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/default-og-image.jpg`;

/**
 * 把 `url` 变成绝对地址。
 *
 * 已经是绝对地址的原样返回 —— 封面绝大多数是 Supabase 存储桶的公开链接
 * （`https://xxx.supabase.co/...`），不能给它们再加前缀。空值回落到默认分享图。
 */
export function absoluteUrl(url: string | null | undefined): string {
  const s = (url ?? "").trim();
  if (!s) return DEFAULT_OG_IMAGE;
  if (/^https?:\/\//i.test(s)) return s;
  return `${SITE_ORIGIN}${s.startsWith("/") ? "" : "/"}${s}`;
}
