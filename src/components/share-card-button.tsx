import { useEffect, useRef, useState } from "react";
import { ImageDown, Share2, X as CloseIcon } from "lucide-react";
import { toast } from "sonner";
import { renderShareCard, shareOrSaveImage, type ShareCardData } from "@/lib/share-card";

/**
 * Reusable「生成分享卡」button + preview modal. Used on published plant detail pages
 * (and reusable elsewhere) to render the same 1080×1920 share card the draft page
 * produces. Offers light/dark theme + 中/EN language toggles that re-render on change.
 *
 * Pass the plant data as a partial ShareCardData (without theme/lang — those are
 * driven by the in-modal toggles).
 */
export function ShareCardButton({
  card,
  shareUrl,
  filenameBase,
  className,
}: {
  /** Card content minus theme/lang (controlled here). */
  card: Omit<ShareCardData, "theme" | "lang">;
  /** URL attached to the system share sheet (defaults to current location). */
  shareUrl?: string;
  /** Basis for the downloaded PNG filename. */
  filenameBase?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [url, setUrl] = useState<string | null>(null);
  const blobRef = useRef<Blob | null>(null);

  const t = (zh: string, en: string) => (lang === "en" ? en : zh);

  // Regenerate whenever the modal is open and theme/lang change.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setBusy(true);
    renderShareCard({ ...card, theme, lang })
      .then((blob) => {
        if (cancelled) return;
        blobRef.current = blob;
        setUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
      })
      .catch((e) => {
        if (!cancelled) toast.error(e instanceof Error ? e.message : "生成分享卡失败");
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
    // card is captured by value each open; theme/lang drive re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, theme, lang]);

  const close = () => {
    setOpen(false);
    setUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    blobRef.current = null;
  };

  const onShare = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    const base = (filenameBase || card.scientificName || card.title || "plant")
      .replace(/[^\w一-龥-]+/g, "_")
      .slice(0, 40);
    const how = await shareOrSaveImage(blob, `plantspedia-${base}.png`, {
      url: shareUrl || (typeof window !== "undefined" ? window.location.href : undefined),
      text: t(
        `我在 Plantspedia 认识了「${card.title}」，点开看看这株植物 🌿`,
        `Meet "${card.title}" on Plantspedia 🌿`,
      ),
      title: `Plantspedia · ${card.title}`,
    });
    if (how === "downloaded")
      toast.success(
        t("已保存图片（链接已复制到剪贴板）", "Image saved — link copied to clipboard"),
      );
    else if (how === "shared")
      toast.success(t("已打开分享面板（链接已复制备用）", "Share sheet opened — link also copied"));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="生成分享卡"
        className={
          className ??
          "inline-flex items-center gap-1.5 border border-ink/40 px-3 py-1.5 text-xs hover:bg-ink hover:text-background transition-colors"
        }
      >
        <ImageDown className="size-3.5" />
        分享卡
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[80] bg-black/70 flex items-center justify-center p-4"
          onClick={close}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-background border border-ink shadow-xl w-full max-w-sm p-4 flex flex-col items-center max-h-[92vh] overflow-auto"
          >
            <div className="flex items-center justify-between w-full mb-3">
              <p className="label text-leaf-deep">{t("分享卡", "Share card")}</p>
              <button
                onClick={close}
                className="text-ink-faint hover:text-ink p-1"
                aria-label="关闭"
              >
                <CloseIcon className="size-4" />
              </button>
            </div>

            {/* Theme + language toggles */}
            <div className="flex items-center justify-center gap-2 w-full mb-3 text-xs">
              <div className="inline-flex border border-rule rounded-sm overflow-hidden">
                <ToggleBtn active={theme === "light"} onClick={() => setTheme("light")}>
                  {t("浅色", "Light")}
                </ToggleBtn>
                <ToggleBtn active={theme === "dark"} onClick={() => setTheme("dark")}>
                  {t("深色", "Dark")}
                </ToggleBtn>
              </div>
              <div className="inline-flex border border-rule rounded-sm overflow-hidden">
                <ToggleBtn active={lang === "zh"} onClick={() => setLang("zh")}>
                  中文
                </ToggleBtn>
                <ToggleBtn active={lang === "en"} onClick={() => setLang("en")}>
                  EN
                </ToggleBtn>
              </div>
            </div>

            <div className="w-full aspect-[9/16] border border-rule rounded-md bg-paper-deep/30 flex items-center justify-center overflow-hidden">
              {url ? (
                <img
                  src={url}
                  alt={t("分享卡预览", "Share card preview")}
                  className={`w-full h-auto ${busy ? "opacity-60" : ""}`}
                />
              ) : (
                <span className="text-xs text-ink-faint">{t("正在生成…", "Rendering…")}</span>
              )}
            </div>

            <p className="text-[11px] text-ink-faint mt-2 text-center leading-relaxed">
              {t(
                "手机上点「分享 / 存相册」会调起系统分享面板，可直接发到微信、小红书、微博等；也可长按上图保存。",
                "On mobile, tap Share / Save to open the system share sheet; or long-press the image to save.",
              )}
            </p>

            <div className="flex gap-2 mt-3 w-full">
              <button
                onClick={onShare}
                disabled={busy || !url}
                className="flex-1 bg-leaf-deep text-background px-4 py-2.5 text-sm font-semibold hover:bg-leaf transition-colors inline-flex items-center justify-center gap-1.5 cursor-pointer rounded-sm disabled:opacity-50"
              >
                <Share2 className="w-4 h-4" />
                {t("分享 / 存相册", "Share / Save")}
              </button>
              <button
                onClick={close}
                className="border border-rule text-ink-faint px-4 py-2.5 text-sm hover:border-ink hover:text-ink transition-colors cursor-pointer rounded-sm"
              >
                {t("关闭", "Close")}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 transition-colors ${active ? "bg-ink text-background" : "text-ink-faint hover:text-ink"}`}
    >
      {children}
    </button>
  );
}
