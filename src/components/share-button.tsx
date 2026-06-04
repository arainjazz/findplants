import { useEffect, useMemo, useState } from "react";
import { Share2, Copy, X as CloseIcon, Check, QrCode } from "lucide-react";
import { toast } from "sonner";
import {
  SiWechat, SiSinaweibo, SiXiaohongshu, SiTiktok, SiX, SiFacebook,
  SiTelegram, SiWhatsapp, SiNotion, SiEvernote, SiZhihu, SiDouban, SiGmail,
} from "react-icons/si";
import { FaLinkedin } from "react-icons/fa";
import type { ComponentType } from "react";

type Platform = {
  key: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
  color: string;
  webUrl?: (url: string, title: string) => string;
  appOnly?: boolean;
  appShareDeepLink?: string;
  note?: string;
};

const PLATFORMS: Platform[] = [
  // App-only platforms — show the page QR for the user to scan with the
  // platform's in-app scanner. (Cross-app deep links into compose screens
  // are not publicly supported.)
  { key: "wechat", label: "微信", Icon: SiWechat, color: "#07C160", appOnly: true,
    note: "打开微信 → 右上角「+」→ 扫一扫，扫描二维码后转发给好友或朋友圈" },
  { key: "xiaohongshu", label: "小红书", Icon: SiXiaohongshu, color: "#FF2442", appOnly: true,
    note: "打开小红书 → 右上角扫一扫，识别后即可一键转发或写笔记" },
  { key: "douyin", label: "抖音", Icon: SiTiktok, color: "#000000", appOnly: true,
    note: "打开抖音 → 搜索框右侧扫一扫，识别后可拍同款或转发" },

  // Web platforms — open the official share-intent URL directly
  { key: "weibo", label: "微博", Icon: SiSinaweibo, color: "#E6162D",
    webUrl: (url, title) => `https://service.weibo.com/share/share.php?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}` },
  { key: "zhihu", label: "知乎", Icon: SiZhihu, color: "#0066FF",
    webUrl: (url, title) => `https://www.zhihu.com/share?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}` },
  { key: "douban", label: "豆瓣", Icon: SiDouban, color: "#2D963A",
    webUrl: (url, title) => `https://www.douban.com/share/service?href=${encodeURIComponent(url)}&name=${encodeURIComponent(title)}` },
  { key: "x", label: "X", Icon: SiX, color: "#000000",
    webUrl: (url, title) => `https://twitter.com/intent/tweet?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}` },
  { key: "facebook", label: "Facebook", Icon: SiFacebook, color: "#1877F2",
    webUrl: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}` },
  { key: "linkedin", label: "LinkedIn", Icon: FaLinkedin, color: "#0A66C2",
    webUrl: (url) => `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}` },
  { key: "telegram", label: "Telegram", Icon: SiTelegram, color: "#26A5E4",
    webUrl: (url, title) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(title)}` },
  { key: "whatsapp", label: "WhatsApp", Icon: SiWhatsapp, color: "#25D366",
    webUrl: (url, title) => `https://api.whatsapp.com/send?text=${encodeURIComponent(title + " " + url)}` },
  { key: "notion", label: "Notion", Icon: SiNotion, color: "#000000",
    webUrl: (url, title) => `https://www.notion.so/?addPage=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`,
    note: "在 Notion 中粘贴下方链接生成卡片" },
  { key: "evernote", label: "印象笔记", Icon: SiEvernote, color: "#00A82D",
    webUrl: (url, title) => `https://www.yinxiang.com/etn/save/?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}` },
  { key: "email", label: "邮件", Icon: SiGmail, color: "#EA4335",
    webUrl: (url, title) => `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(url)}` },
];

export function ShareButton({ title, summary }: { title: string; summary?: string | null }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeQr, setActiveQr] = useState<Platform | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") setUrl(window.location.href);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activeQr) setActiveQr(null);
        else setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, activeQr]);

  const hasNative = typeof navigator !== "undefined" && typeof (navigator as Navigator).share === "function";

  const qrSrc = useMemo(
    () => `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=8&data=${encodeURIComponent(url)}`,
    [url],
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success("链接已复制");
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("复制失败，请手动选择");
    }
  };

  const onSystemShare = async () => {
    if (!hasNative) { copyLink(); return; }
    try {
      await (navigator as Navigator).share({ title, text: summary ?? title, url });
      setOpen(false);
    } catch {/* user cancelled */}
  };

  const onPlatformClick = (p: Platform) => {
    if (p.webUrl) {
      window.open(p.webUrl(url, title), "_blank", "noopener,noreferrer");
      setOpen(false);
    } else if (p.appOnly) {
      setActiveQr(p);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="分享"
        className="inline-flex items-center gap-1.5 border border-ink/40 px-3 py-1.5 text-xs hover:bg-ink hover:text-background transition-colors"
      >
        <Share2 className="size-3.5" />
        分享
      </button>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[80] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-background w-full sm:max-w-md sm:border-2 sm:border-ink shadow-2xl rounded-t-2xl sm:rounded-none max-h-[92vh] overflow-auto"
          >
            <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-rule sticky top-0 bg-background">
              <div>
                <p className="label text-vermilion">Share · 分享</p>
                <h3 className="font-display text-lg font-semibold truncate max-w-[18rem]">{title}</h3>
              </div>
              <button onClick={() => setOpen(false)} className="text-ink-faint hover:text-ink p-1" aria-label="关闭">
                <CloseIcon className="size-5" />
              </button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Link row — always visible, primary action on desktop */}
              <div className="flex items-stretch gap-2">
                <input
                  value={url}
                  readOnly
                  className="flex-1 min-w-0 border border-ink/40 px-3 py-2 text-xs bg-paper-deep/30 font-mono"
                  onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
                />
                <button
                  onClick={copyLink}
                  className={`px-3 py-2 text-sm transition-colors inline-flex items-center gap-1.5 ${
                    copied ? "bg-leaf-deep text-background" : "bg-ink text-background hover:bg-vermilion"
                  }`}
                >
                  {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>

              {hasNative && (
                <button
                  onClick={onSystemShare}
                  className="w-full border border-ink py-2.5 text-sm font-semibold hover:bg-ink hover:text-background transition-colors inline-flex items-center justify-center gap-2"
                >
                  <Share2 className="size-4" /> 系统分享…
                </button>
              )}

              {/* Platform grid */}
              <div>
                <p className="label text-[10px] mb-2 text-ink-faint">分享到</p>
                <div className="grid grid-cols-4 gap-2">
                  {PLATFORMS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => onPlatformClick(p)}
                      className="flex flex-col items-center gap-1.5 py-3 px-1 rounded-lg hover:bg-paper-deep transition-colors text-center group"
                      title={p.appOnly ? "扫描二维码打开" : "在新标签打开分享窗口"}
                    >
                      <span
                        className="w-11 h-11 rounded-full flex items-center justify-center text-white shadow-sm group-hover:scale-105 transition-transform"
                        style={{ background: p.color }}
                      >
                        <p.Icon className="w-5 h-5" />
                      </span>
                      <span className="text-[11px] leading-tight">{p.label}</span>
                      {p.appOnly && (
                        <span className="text-[9px] text-ink-faint -mt-0.5 inline-flex items-center gap-0.5">
                          <QrCode className="size-2.5" />扫码
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Always-visible QR for mobile handoff */}
              <details className="border-t border-rule pt-3">
                <summary className="cursor-pointer text-sm inline-flex items-center gap-2 hover:text-vermilion">
                  <QrCode className="size-4" /> 显示二维码（手机扫码打开）
                </summary>
                <div className="mt-3 flex justify-center">
                  <img src={qrSrc} alt="页面二维码" className="w-48 h-48 border border-rule p-2 bg-white" />
                </div>
              </details>
            </div>
          </div>
        </div>
      )}

      {activeQr && <QrModal platform={activeQr} url={url} title={title} onClose={() => setActiveQr(null)} onCopy={copyLink} />}
    </>
  );
}

function QrModal({
  platform,
  url,
  title,
  onClose,
  onCopy,
}: {
  platform: Platform;
  url: string;
  title: string;
  onClose: () => void;
  onCopy: () => void;
}) {
  // QR encodes this page URL — the user scans it with the target app's
  // built-in scanner and can then forward or re-post from inside the app.
  const qrTarget = url;
  const qr = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=8&data=${encodeURIComponent(qrTarget)}`;
  return (
    <div
      className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-background border-2 border-ink shadow-2xl w-full max-w-sm p-5 rounded-lg"
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full flex items-center justify-center text-white" style={{ background: platform.color }}>
              <platform.Icon className="w-4 h-4" />
            </span>
            <h3 className="font-display text-lg font-semibold">分享到 {platform.label}</h3>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            <CloseIcon className="size-4" />
          </button>
        </div>
        <p className="text-xs text-ink-faint mb-3">{platform.note}</p>
        <div className="border border-rule p-3 flex items-center justify-center bg-white rounded">
          <img src={qr} alt="二维码" className="w-[260px] h-[260px]" />
        </div>
        <p className="text-[11px] text-ink-faint mt-2 text-center">
          用 {platform.label} 内的「扫一扫」识别二维码即可转发本页
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={url}
            readOnly
            className="flex-1 border border-ink/40 px-2 py-1.5 text-xs bg-background"
            onClick={(e) => (e.currentTarget as HTMLInputElement).select()}
          />
          <button
            onClick={onCopy}
            className="bg-ink text-background px-3 py-1.5 text-xs hover:bg-vermilion transition-colors"
          >
            复制
          </button>
        </div>
        <p className="text-[10px] text-ink-faint mt-2 text-center">标题：{title}</p>
      </div>
    </div>
  );
}