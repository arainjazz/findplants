// ─── 按显示尺寸取图 ──────────────────────────────────────────────────────────
//
// 2026-08-15 用户：「跳转不慢了，只是图片加载出来的速度慢一些」。实测根因是
// **页面上每一张缩略图下的都是原图**：`/plants` 那 15 张 62×62 的方图，每张 **395KB**、
// 900×1200 —— 一屏就是近 6MB，手机蜂窝上自然是一张一张慢慢显形。
//
// Supabase Storage 自带图片变换（`/render/image/public/…?width=&quality=`），本项目的
// 计划**已经开着**（实测 200）。同一张图实测：
//     原图 395KB → width=160 **27KB**（-93%）→ width=320 52KB → width=800 136KB（-66%）
// 而且带 `Accept: image/webp` 时直接回 **WebP**，不用自己转码；cache-control 与原图
// 一样是 `public, max-age=3600`，CF 边缘照样 HIT。
//
// ⚠️ **只改自家 Supabase 公开对象的地址**。iNaturalist / GBIF / Wikimedia 那些外链、
// `data:` / `blob:`（识别页刚拍的那张就是 blob:）一律原样返回 —— 拿别人家的域名去套
// Supabase 的变换路径只会 404。
//
// ⚠️ 宽度**归到几档**而不是照实数传：CF 是按 URL 缓存的，一人一个宽度等于人人都
// 回源；归档之后大家共用同几份。
//
// 🔴 **`resize=contain` 少不得**（实测踩过）。Supabase 的变换默认是 `cover`，而缺省的
// height **取原图高**，所以只传 `width=128` 拿回来的是 **128×1200** —— 900×1200 的照片
// 被切成一条竖条，不是缩略图。加上 `contain` 才是等比缩放：
//     width=128            → 128×1200（竖条，29KB）❌
//     width=128&resize=contain → 128×171（等比，7.7KB）✅
// 顺带还更小 —— 竖条那一份把原图整个高度都留着了。
// contain 不会放大：原图比目标窄时按原尺寸返回。裁剪交给 CSS 的 object-cover。

/** 允许的宽度档位（CSS 宽 ×2 之后向上取最近的一档）。 */
const BUCKETS = [128, 160, 256, 320, 480, 640, 800, 1000, 1280, 1600] as const;

/** 自家 Storage 公开对象的地址长这样。 */
const PUBLIC_OBJECT = "/storage/v1/object/public/";
const RENDER_IMAGE = "/storage/v1/render/image/public/";

function bucketFor(cssWidth: number): number {
  const want = Math.round(cssWidth * 2); // 手机基本都是 2x/3x，统一按 2x 取
  return BUCKETS.find((b) => b >= want) ?? BUCKETS[BUCKETS.length - 1];
}

/**
 * 把自家 Supabase 图片地址换成「按显示尺寸生成的那一份」。
 *
 * @param url      原地址（可为空/外链/blob:，都会原样返回）
 * @param cssWidth 这张图在页面上**实际画多宽**（CSS px），函数内部按 2x 取档
 * @param quality  1–100，默认 72；大图（≥800 档）自动给到 78，免得主图看着发糊
 */
export function sizedImageUrl(
  url: string | null | undefined,
  cssWidth: number,
  quality?: number,
): string | undefined {
  if (!url) return undefined;
  // 已经是变换地址（或根本不是 http 地址）就别再套一层
  if (!/^https?:/i.test(url) || url.includes(RENDER_IMAGE)) return url;
  const at = url.indexOf(PUBLIC_OBJECT);
  if (at < 0) return url;

  // 原地址可能自带查询串（缓存刷新用的 `?t=`），要留着 —— 丢了会拿到旧图。
  const q = url.indexOf("?");
  const path = q < 0 ? url : url.slice(0, q);
  const existing = q < 0 ? "" : url.slice(q + 1);

  const width = bucketFor(cssWidth);
  const params = new URLSearchParams(existing);
  params.set("width", String(width));
  // 见文件头：没有它拿回来的是原高度的一条竖条，不是缩略图。
  params.set("resize", "contain");
  params.set("quality", String(quality ?? (width >= 800 ? 78 : 72)));
  return path.replace(PUBLIC_OBJECT, RENDER_IMAGE) + "?" + params.toString();
}
