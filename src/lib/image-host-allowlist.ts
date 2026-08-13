/**
 * 「哪些图片主机允许服务端代抓」——`proxyImageDataUrlFn` 的**唯一防线**。
 *
 * 单独成一个模块，是为了让它能被**离线断言**（`scratch/check_image_host_allowlist.mjs`），
 * 跟 `place-from-amap` / `gcj02` 那几套一样：判定逻辑不依赖 `@tanstack/react-start`、
 * 不打网、不碰环境，纯输入输出，一条一条钉住。放在 server fn 文件里就只能靠人眼看了。
 *
 * 为什么必须有这道闸：那个 server fn 不带鉴权（游客也要能生成分享卡），而 server fn 在
 * `/_serverFn/<id>` 上公开可 POST、id 就写在客户端 bundle 里。没有白名单它等于一个
 * **开放图片代理** —— 任何人都能让 plantspedia 的 Worker 替他去抓任意 URL：拿我们的
 * 出口 IP 刷别人的站、把我们的带宽当 CDN、或者拿它探内网/云元数据地址。
 */

/**
 * 名单只列**站内真的会出现在 cover_url / photo_url 里的来源**：
 * 外部图基本都由 `rehostImages` 转存进自家桶了，但早期条目里还留着这三家的直链，
 * 不放行会让老页面的分享卡退成占位图。
 */
export const ALLOWED_IMAGE_HOSTS = [
  "inaturalist.org",
  "gbif.org",
  "wikimedia.org",
  "wikipedia.org",
];

/**
 * `host` 是否允许被代抓。`ownHost` 传自家 Supabase 存储桶的主机名（从环境变量现取，
 * 换项目时不用回来改名单）。
 *
 * 匹配按**后缀**（`upload.wikimedia.org` 命中 `wikimedia.org`），但要求前面必须是 `.`
 * —— 只写 `endsWith(d)` 的话 `evil-wikimedia.org` 也会蒙混过关，那等于白名单白设。
 */
export function isAllowedImageHost(host: string, ownHost?: string | null): boolean {
  const h = (host || "").trim().toLowerCase();
  if (!h) return false;
  const own = (ownHost || "").trim().toLowerCase();
  if (own && h === own) return true;
  return ALLOWED_IMAGE_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** 从 `SUPABASE_URL` 之类的完整地址里取主机名；取不到回 null（调用方当作「没有自家主机」）。 */
export function hostOf(url: string | undefined | null): string | null {
  const s = (url || "").trim();
  if (!s) return null;
  try {
    return new URL(s).hostname.toLowerCase();
  } catch {
    return null;
  }
}
