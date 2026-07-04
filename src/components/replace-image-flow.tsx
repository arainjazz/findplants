import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ImageSearchDialog } from "@/components/html-doc-editor";
import { uploadAssetFn } from "@/lib/identify-plant.functions";
import { compressImage } from "@/lib/image-compress";

/**
 * 小P蛙换图流程（确定性，不经过大模型）：
 *   1. 从当前 HTML 里枚举所有 <img>，编辑点选要替换的那张；
 *   2. 打开在线搜图（iNaturalist / Wikimedia / GBIF）或本地上传选新图；
 *   3. 直接把 HTML 字符串里旧图的 src 替换为新 URL，交给宿主保存。
 * 相比让大模型重写整页 HTML 改一个 src，这条路径 100% 可靠且不花 token。
 */
export function ReplaceImageFlow({
  html,
  initialQuery,
  uploadPathPrefix,
  onDone,
  onClose,
}: {
  /** 当前页面/草稿的完整 HTML（用于枚举图片和做替换）。 */
  html: string;
  /** 搜图框预填词（一般为拉丁学名）。 */
  initialQuery: string;
  /** 本地上传落库路径前缀，如 `drafts/xiaop/<id>`；存 plant-images 桶。 */
  uploadPathPrefix: string;
  /** 替换完成：newHtml 为替换后的整页 HTML；old/new 供记日志。 */
  onDone: (newHtml: string, oldUrl: string, newUrl: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const upload = useServerFn(uploadAssetFn);
  const [target, setTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Enumerate candidate images from the HTML (dedup by src, skip data:/svg icons).
  const images = useMemo(() => {
    const out: { src: string; alt: string }[] = [];
    const seen = new Set<string>();
    const re = /<img\b[^>]*>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const tag = m[0];
      const src = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
      if (!src || src.startsWith("data:") || seen.has(src)) continue;
      seen.add(src);
      const alt = tag.match(/\balt\s*=\s*["']([^"']*)["']/i)?.[1] ?? "";
      out.push({ src, alt });
    }
    return out;
  }, [html]);

  const uploadFile = async (f: File): Promise<string> => {
    let file: Blob | File = f;
    try {
      file = await compressImage(f, 1600, 1600, 0.85);
    } catch {
      /* keep original */
    }
    const base64 = await blobToBase64(file);
    const res = (await upload({
      data: {
        bucket: "plant-images",
        path: `${uploadPathPrefix}-${Date.now()}.jpg`,
        file_base64: base64,
        content_type: file.type || "image/jpeg",
      },
    })) as { url: string };
    return res.url;
  };

  const applyPick = async (newUrl: string) => {
    if (!target || saving) return;
    setSaving(true);
    try {
      // Deterministic swap: replace every occurrence of the old URL inside a
      // src attribute (same photo reused twice should follow along).
      const newHtml = html.split(target).join(newUrl);
      await onDone(newHtml, target, newUrl);
    } finally {
      setSaving(false);
    }
  };

  // Step 2 — pick the NEW image (search or upload).
  if (target) {
    return (
      <ImageSearchDialog
        initialQuery={initialQuery}
        onClose={onClose}
        onUploadFile={uploadFile}
        onPick={(url) => {
          void applyPick(url);
        }}
      />
    );
  }

  // Step 1 — pick WHICH image on the page to replace.
  return (
    <div className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background border border-ink shadow-xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h3 className="label text-vermilion">第一步 · 点选要替换的配图</h3>
          <button type="button" onClick={onClose} className="text-ink-faint hover:text-ink text-xl leading-none" aria-label="关闭">
            ×
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {images.length === 0 ? (
            <p className="text-sm text-ink-faint">这页里没有找到可替换的图片。</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {images.map((im) => (
                <button
                  key={im.src}
                  type="button"
                  onClick={() => setTarget(im.src)}
                  className="group border border-rule hover:border-leaf text-left bg-paper-deep/30"
                  title={im.alt || im.src}
                >
                  <img src={im.src} alt={im.alt} loading="lazy" className="w-full h-32 object-cover bg-background" />
                  <div className="px-2 py-1.5 text-[11px] line-clamp-1 leading-snug text-ink-soft group-hover:text-leaf-deep">
                    {im.alt || "（无说明）"}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="border-t border-rule px-4 py-2 text-[11px] text-ink-faint">
          选中后进入第二步：在线搜图或本地上传新图，确认即替换并保存。
        </div>
      </div>
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
