import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Camera, Globe } from "lucide-react";
import { CameraCaptureDialog } from "@/components/camera-capture-dialog";
import { ImageSearchDialog } from "@/components/html-doc-editor";
import { uploadAssetFn } from "@/lib/identify-plant.functions";
import { compressImage } from "@/lib/image-compress";

type Names = {
  scientific_name?: string | null;
  common_name_en?: string | null;
  common_names_zh?: string | null;
};

/**
 * Dialog for replacing one default section illustration on a draft. Offers two
 * paths: live camera capture (uploaded via the anon-capable uploadAssetFn) or
 * online image search (iNaturalist / Wikimedia / GBIF), with the search box
 * prefilled to the scientific name and one-tap chips for the other names.
 *
 * onReplaced is called with the new public image URL; the parent rewrites the
 * draft HTML, persists it, and unmounts this dialog.
 */
export function ReplacePhotoDialog({
  draftId,
  slot,
  names,
  onReplaced,
  onClose,
}: {
  draftId: string;
  slot: number;
  names: Names;
  onReplaced: (url: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "camera" | "search">("choose");
  const [busy, setBusy] = useState(false);
  const upload = useServerFn(uploadAssetFn);

  // Scientific names often include the author citation — use genus + species
  // (first two words) for the most reliable taxon match.
  const sci = (names.scientific_name || "").trim();
  const sciCore = sci.split(/\s+/).slice(0, 2).join(" ");
  const en = (names.common_name_en || "").trim();
  const zh = (names.common_names_zh || "").split(/[,，]/)[0].trim();
  const initialQuery = sciCore || en || zh;
  const nameChips = [
    sciCore && { label: "拉丁学名", value: sciCore },
    en && { label: "英文俗名", value: en },
    zh && { label: "中文常用名", value: zh },
  ].filter(Boolean) as { label: string; value: string }[];

  const handleCapture = async (blob: Blob) => {
    setMode("choose");
    setBusy(true);
    try {
      let file: Blob | File = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });
      try {
        file = await compressImage(file as File, 1280, 1280, 0.8);
      } catch {
        /* fall back to original blob */
      }
      const base64 = await blobToBase64(file);
      const res = await upload({
        data: {
          bucket: "plant-images",
          path: `drafts/replace/${draftId}-${slot}-${Date.now()}.jpg`,
          file_base64: base64,
          content_type: "image/jpeg",
        },
      });
      await onReplaced((res as { url: string }).url);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "上传失败，请重试");
      setBusy(false);
    }
  };

  if (mode === "camera") {
    return <CameraCaptureDialog onCapture={handleCapture} onClose={() => setMode("choose")} />;
  }

  if (mode === "search") {
    return (
      <ImageSearchDialog
        initialQuery={initialQuery}
        nameChips={nameChips}
        onClose={onClose}
        onPick={(url) => {
          void onReplaced(url);
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-[65] bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-ink shadow-xl w-full max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h3 className="label text-vermilion">替换这张配图</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-ink-faint hover:text-ink text-xl leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div className="p-4 space-y-3">
          {busy ? (
            <p className="text-sm text-ink-faint text-center py-6">正在上传替换…</p>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setMode("camera")}
                className="w-full border border-ink px-4 py-3 flex items-center gap-3 hover:bg-ink hover:text-background transition-colors text-left"
              >
                <Camera className="w-5 h-5 shrink-0" />
                <span>
                  <span className="block text-sm font-semibold">现场拍摄更换</span>
                  <span className="block text-xs text-ink-faint">打开摄像头拍一张新的配图</span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMode("search")}
                className="w-full border border-ink px-4 py-3 flex items-center gap-3 hover:bg-ink hover:text-background transition-colors text-left"
              >
                <Globe className="w-5 h-5 shrink-0" />
                <span>
                  <span className="block text-sm font-semibold">联网搜索替换</span>
                  <span className="block text-xs text-ink-faint">从 iNaturalist / Wikimedia / GBIF 选图</span>
                </span>
              </button>
            </>
          )}
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
      const comma = dataUrl.indexOf(",");
      resolve(dataUrl.slice(comma + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
