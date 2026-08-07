// ─── 刚拍的那张照片，留在内存里给分享卡直接用 ─────────────────────────────────
//
// 出卡（renderShareCard）要把用户的照片画进 canvas，原来一律 `fetch(draft.photo_url)`
// 从云端存储把**刚刚上传上去的同一张图**再下载一遍。识别完自动弹卡这条路上，这是白等的
// 一段：字节本来就还在手里（就是刚提交上去的那个 blob），而存储那边的对象带着
// `cache-control: no-cache`，浏览器每次都得真跑一趟网络（线上实测 226KB/张）。
// 用户 2026-08-06 报的「停在已完成界面很久才弹出分享卡」，这是其中一段。
//
// 于是：拍完跳转前把 blob 挂在这里，草稿页出卡时优先用它。**只放一张**（下一次识别直接
// 顶掉上一张并回收 URL），刷新页面就没了 —— 那时照常回落到云端地址，功能不依赖它。
//
// blob: URL 是同源的，画进 canvas 不会污染，导出 PNG 照常。

type FreshPhoto = { draftId: string; url: string; at: number };

let current: FreshPhoto | null = null;

/** 超过这个时长就不再采信（照片可能已经被别的流程换掉了）。出卡是识别完几秒内的事，
 *  这个上限只是防呆，不是正常路径会碰到的东西。 */
const MAX_AGE_MS = 10 * 60_000;

/** 识别刚成功、正要跳去草稿页时调用。传 null 等于只清掉上一张。 */
export function rememberFreshPhoto(draftId: string, blob: Blob | null): void {
  if (current) {
    URL.revokeObjectURL(current.url);
    current = null;
  }
  if (!blob || typeof URL.createObjectURL !== "function") return;
  try {
    current = { draftId, url: URL.createObjectURL(blob), at: Date.now() };
  } catch {
    /* createObjectURL 理论上不会抛；真抛了就当没有这份快捷方式 */
  }
}

/** 出卡时调用：这份草稿有刚拍的本地原图就返回它，否则返回 null（调用方回落云端地址）。 */
export function freshPhotoUrl(draftId: string): string | null {
  if (!current || current.draftId !== draftId) return null;
  if (Date.now() - current.at > MAX_AGE_MS) return null;
  return current.url;
}
