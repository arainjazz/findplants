/**
 * 把「浏览器原生网络错误」翻译成用户能看懂的原因 + 下一步。
 *
 * 背景：识别失败时前端直接把 `e.message` 抛给用户，于是屏幕上只会出现
 * `Load failed`（Safari / iOS WebKit 的措辞）或 `Failed to fetch`（Chrome / Edge）。
 * 这两条是同一个 `TypeError`：**fetch 在网络层就失败了，压根没拿到任何 HTTP 响应**——
 * 所以服务端那套「原因 + 怎么办」的报错文案根本没机会产生。用户看到的等于一句废话。
 *
 * 服务端抛的错（`AI 额度已用完…`、`HTTP 429…`）已经自带原因，原样透出即可。
 */

type Ctx = {
  /** 请求从发出到失败经过的毫秒数——用来区分「秒失败=断网」和「久等后断=超时/挂起」。*/
  elapsedMs?: number;
  /** 上传体积（字节）。手机端大图 + 弱网是本项目最常见的 fetch 失败原因。*/
  sizeBytes?: number;
  /** 出现在文案里的动作名，如「识别」「保存配置」。*/
  action?: string;
  /**
   * 调用方是否**已经回查过服务端**、确认这件事确实没做成。
   *
   * 为什么需要它：网络层失败只说明「响应没回来」，**不说明「事情没做成」**。识别是个
   * 有副作用的写操作——服务端跑完会把草稿写进库，客户端却可能什么都没收到。此时对用户
   * 说「失败了，请重试」是错的，重试会白烧一整轮模型。
   * true = 已回查且确实没有 → 可以放心让用户重试；
   * false/未传 = 没查过 → 必须提醒用户「先去看看是不是已经成好了」。
   */
  serverStateChecked?: boolean;
};

/** 浏览器网络层失败的特征串。导出供调用方复用——别再复制一份正则出去。 */
export const NETWORK_MSG =
  /failed to fetch|load failed|networkerror|network request failed|connection (closed|reset)|the network connection was lost/i;

/** 这个错误是不是「网络层没拿到响应」（区别于服务端明确抛回来的业务错误）。 */
export function isNetworkError(e: unknown): boolean {
  return e instanceof Error && NETWORK_MSG.test(e.message || "");
}

export function explainError(e: unknown, ctx: Ctx = {}): string {
  const action = ctx.action ?? "识别";

  if (!(e instanceof Error)) {
    return `${action}失败（UNKNOWN）：收到了无法解析的错误 ${JSON.stringify(e)?.slice(0, 120)}，请重试。`;
  }

  const raw = e.message || "";

  // 用户主动/系统被动中断：切走 App、页面跳转、点了取消。
  if (e.name === "AbortError" || /aborted/i.test(raw)) {
    return `${action}中断：请求在完成前被取消（多半是切走了 App 或页面被刷新）。请留在本页重试。`;
  }

  if (!NETWORK_MSG.test(raw)) {
    // 服务端错误已经写清了原因，原样给用户；只在完全空消息时兜底。
    return raw || `${action}失败（UNKNOWN）：发生了未知错误，请重试。`;
  }

  // ——以下都是网络层失败。给出「它到底代表什么」+ 按现场证据排序的可能原因。——
  const seconds = ctx.elapsedMs != null ? Math.round(ctx.elapsedMs / 1000) : null;
  const mb = ctx.sizeBytes != null ? ctx.sizeBytes / 1024 / 1024 : null;

  // ⚠️ 措辞刻意不写「失败」：网络层断开只证明**响应没回来**，不证明**服务端没做成**。
  // 线上真实案例：识别请求在 101 秒时断掉、前端报「识别失败」，但服务端早已把草稿写进库了
  // （用户重点一次立刻弹「这张照片已经识别过」）。断言失败是错的，还会诱导用户白烧一轮模型。
  const head =
    `${action}未收到结果（网络未连通）：浏览器报「${raw}」——` +
    `这不是 AI 拒绝了你，而是请求发出后没能拿到服务器的回应` +
    (seconds != null ? `（等待了约 ${seconds} 秒）` : "") +
    "。";

  const causes: string[] = [];

  // 排在所有网络原因**之前**：它决定用户下一步该不该重试，比「为什么断的」更要紧。
  if (ctx.serverStateChecked === true) {
    causes.push("✓ 已自动回查服务端：确实没有留下这次的结果，可以放心重试。");
  } else if (ctx.serverStateChecked === false) {
    causes.push(
      `⚠️ 先别急着重试：${action}可能**已经在服务端完成了**，只是结果没传回来。请先去「我的草稿」看一眼有没有新条目，有就直接用，别重复跑一轮。`,
    );
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    causes.push("① 设备当前处于离线状态 —— 请先恢复 Wi-Fi / 移动数据，再重试。");
  } else {
    if (seconds != null && seconds >= 25) {
      causes.push(
        `① 超时最可能：等了 ${seconds} 秒才断。识别要串联多个 AI 服务，弱网下手机会在中途掐掉连接（iOS 锁屏/切后台尤其容易）。重试时请保持本页在前台、屏幕不熄。`,
      );
    } else {
      causes.push("① 网络切换或信号抖动 —— Wi-Fi 与 5G 之间跳变会让上传中的连接直接失效。请确认信号稳定后重试。");
    }
    if (mb != null && mb >= 2) {
      causes.push(`② 上传体积偏大（本次约 ${mb.toFixed(1)} MB）—— 弱网下大图更容易传到一半断掉。可换一张更小的照片试试。`);
    }
    causes.push(
      `${mb != null && mb >= 2 ? "③" : "②"} 线路被拦截 —— 若你在使用代理 / VPN，请检查它是否中途掉线（本项目托管在 Cloudflare，国内直连有时不稳）。`,
    );
    causes.push(
      `${mb != null && mb >= 2 ? "④" : "③"} 服务端短暂不可用 —— 若连试 2 次都在同一秒数上失败，多半是站点本身出了问题，请稍后再来。`,
    );
  }

  return `${head}\n可能原因（按可能性排序）：\n${causes.join("\n")}`;
}
