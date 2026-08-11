// ─── 全站的小P蛙 ──────────────────────────────────────────────────────────────
//
// 挂在 `__root.tsx` 上，**每一页都出现**（用户 2026-07-29：「小P蛙图标应该出现在
// 所有页面上」）。它同时是三件事：
//   ① 对话入口 —— 针对**当前这一页**的内容问答（正文从 DOM 抓，见 readPageText）；
//   ② 通知中心 —— 图标下面的三色进度条、右上角的三色未读圆圈、点开的摘要卡列表；
//   ③ 模型设置 —— 用户自带模型的入口（这三个视图都由 XiaoPAgentPanel 提供）。
//
// **与页面自带的那两只（drafts/$id、plants/$slug）的分工**：那两页的正文在库里，
// 小P蛙能改写并保存；本组件拿到的只是 DOM 文本，**只问不改**（askPageAgentFn 里
// canEdit 恒为 false）。所以那两页上本组件让位，由页面自带的那只接管 —— 让位靠
// `lib/xiaop-mounted.ts` 的登记处，不是 context（原来那版方向反了，从未生效）。
//
// 🔑 **本组件不再因为「动态流为空」就整个消失**。原来那行 `if (!rows.length) return null`
// 是「识别页没有小P蛙」的直接原因：新用户、或还没跑过任何任务的用户，动态流是空的，
// 于是全站除了草稿页/条目页以外一只青蛙都看不到。通知为空只该让**角标**不画，
// 不该让入口消失。

import { useCallback } from "react";
import { useRouterState } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { XiaoPAgentPanel, type AgentAskResult, type AgentHistory } from "./draft-agent-panel";
import { askPageAgentFn } from "@/lib/identify-plant.functions";
import { userModelArg } from "@/lib/xiaop-user-model";
import { usePageXiaoPMounted, useHydrated } from "@/lib/xiaop-mounted";
import { useAuth } from "@/hooks/use-auth";

/** 送给模型的页面正文上限。够覆盖一屏到几屏内容，又不至于让每轮对话都贵得离谱。 */
const PAGE_TEXT_LIMIT = 8000;
/** 每轮最多送几张页面上的照片。每张都进 prompt，多了就是纯烧钱。 */
const PAGE_IMG_LIMIT = 4;
/**
 * 「这是一张照片，还是一个图标」的两道判据。
 *
 * ⚠️ 别只按渲染尺寸卡：识别页那条缩略图条（主图 + 角度照）是 `w-14 h-14` = **56px**，
 * 而用户问的「这三张图」正是它们 —— 阈值定在 96 会把要看的图恰好全挡在外面。所以
 * 渲染尺寸只用来滤掉图标/头像（48px 以下，站内 logo 是 40px），真正区分照片靠**原始
 * 尺寸**：照片动辄上千像素，界面图标不会。
 */
const PAGE_IMG_MIN_BOX = 48;
const PAGE_IMG_MIN_NATURAL = 256;

type PageImages = {
  /** http(s) 的图：只送 URL，由服务端去抓（不吃浏览器的 CORS）。 */
  imageUrls: string[];
  /** blob: / data: 的图：服务端取不到，客户端压好转 base64 送上去。 */
  inlineImages: { mimeType: string; base64: string }[];
};

/**
 * 把当前页面上**用户看得见的照片**收集起来喂给小P蛙。
 *
 * 为什么非要有这一步：识别页刚拍/刚选的原图是 `URL.createObjectURL` 出来的 `blob:`
 * 地址 —— 只在这个浏览器标签页里有意义，服务端拿到它什么也取不到。所以 blob:/data:
 * 走 canvas 压一遍转 base64，http(s) 仍旧交给服务端抓（跨域图在 canvas 上会污染画布，
 * `toDataURL` 直接抛 SecurityError，客户端这条路反而走不通）。
 */
async function readPageImages(): Promise<PageImages> {
  const out: PageImages = { imageUrls: [], inlineImages: [] };
  if (typeof document === "undefined") return out;
  const root = document.querySelector("main") ?? document.body;
  if (!root) return out;
  const seen = new Set<string>();
  const local: HTMLImageElement[] = [];
  for (const img of Array.from(root.querySelectorAll("img"))) {
    const src = img.currentSrc || img.src;
    if (!src || seen.has(src) || /\.svg(\?|$)/i.test(src)) continue;
    const box = img.getBoundingClientRect();
    // 画不出来的不算「看得见」—— 草稿页那几张塌成 2×2 的预加载图就是这一类。
    if (box.width < PAGE_IMG_MIN_BOX || box.height < PAGE_IMG_MIN_BOX) continue;
    const natural = Math.max(img.naturalWidth || 0, img.naturalHeight || 0);
    const isLocal = /^(blob:|data:image\/)/i.test(src);
    if (!isLocal && natural && natural < PAGE_IMG_MIN_NATURAL) continue;
    seen.add(src);
    if (/^https?:/i.test(src)) {
      if (out.imageUrls.length < PAGE_IMG_LIMIT) out.imageUrls.push(src);
    } else if (/^(blob:|data:image\/)/i.test(src) && local.length < PAGE_IMG_LIMIT) {
      local.push(img);
    }
  }
  // 本地图优先：识别页上「用户刚拍的那几张」正是这一类，比页面上的示例图重要得多。
  // 先转完再让位 —— 转失败的（跨域污染、取不到位图）不该白占名额。
  for (const img of local.slice(0, PAGE_IMG_LIMIT)) {
    const inline = await imgToInline(img);
    if (inline) out.inlineImages.push(inline);
  }
  out.imageUrls = out.imageUrls.slice(0, Math.max(0, PAGE_IMG_LIMIT - out.inlineImages.length));
  return out;
}

/** 把一张已经画在页面上的 <img> 压到 1024px 以内、转成 base64 JPEG。取不到就返回 null。 */
async function imgToInline(
  img: HTMLImageElement,
): Promise<{ mimeType: string; base64: string } | null> {
  try {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return null;
    const scale = Math.min(1, 1024 / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    // 跨域图会把画布染上污点，这一句直接抛 —— 交给 catch 静默丢弃即可（那类图有
    // http(s) 地址，本来就该走服务端抓取那条路）。
    const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
    const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
    if (!base64 || base64.length > 3_500_000) return null;
    return { mimeType: "image/jpeg", base64 };
  } catch {
    return null;
  }
}

/**
 * 把当前页面的可见文本抓出来喂给小P蛙。
 *
 * 优先 `<main>`：站内页面的正文都在里面，抓 body 会把页眉、页脚、导航连同小P蛙
 * 自己的对话记录一起塞进去 —— 对话记录进 prompt 会让它把自己说过的话当成页面内容。
 */
function readPageText(): string {
  if (typeof document === "undefined") return "";
  const root = document.querySelector("main") ?? document.body;
  if (!root) return "";
  const raw = (root as HTMLElement).innerText ?? "";
  // 连续空行压成一行：站内页面里大量空 div 会撑出几十行空白，白白占 token。
  return raw
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, PAGE_TEXT_LIMIT);
}

export function TaskFeedLauncher() {
  const { user } = useAuth();
  const pageHasOwn = usePageXiaoPMounted();
  const hydrated = useHydrated();
  const askPage = useServerFn(askPageAgentFn);
  // 路径既用来告诉模型「用户在看哪一页」，也用来分隔每页各自的对话记忆。
  const path = useRouterState({ select: (s) => s.location.pathname });

  const ask = useCallback(
    async (question: string, history: AgentHistory): Promise<AgentAskResult> => {
      const pics = await readPageImages();
      const res = (await askPage({
        data: {
          path,
          pageTitle: typeof document !== "undefined" ? document.title.slice(0, 300) : undefined,
          pageText: readPageText(),
          question,
          history,
          imageUrls: pics.imageUrls.length ? pics.imageUrls : undefined,
          inlineImages: pics.inlineImages.length ? pics.inlineImages : undefined,
          userModel: userModelArg(),
        },
      })) as AgentAskResult;
      return res;
    },
    [askPage, path],
  );

  // 这条通道落不了地（服务端也把 canEdit 钉死成 false），所以 apply 永远不会被调到。
  // 留一个会抛错的实现而不是空函数：真被调到了要立刻看得见，而不是静默无事发生。
  const apply = useCallback(async () => {
    throw new Error("这一页的内容不能由小P蛙直接改写。可到植物条目页或草稿页找我。");
  }, []);

  // 页面自带完整面板时让位（草稿页 / 条目页）。首帧一并让掉 —— 服务端读不到登记状态，
  // 直接画会在那两页上闪出第二只青蛙。
  if (!hydrated || pageHasOwn) return null;

  return (
    <XiaoPAgentPanel
      // 每页各自的对话记忆：从识别页切到名录再切回来，刚才聊的还在。
      storageKey={`page:${path}`}
      canApply={false}
      isRegistered={!!user}
      // 🔴 全站这只**绝不能**登记 —— 它就是靠登记表决定自己该不该出现的那个组件。
      // 登记 = 自己把自己关掉、然后又出现，React 直接报 Maximum update depth exceeded。
      registerAsPageAgent={false}
      ask={ask}
      apply={apply}
    />
  );
}
