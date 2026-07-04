import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { submitPlantDraft } from "@/lib/identify-plant.functions";
import { toast } from "sonner";

type Phase = "idle" | "captured" | "submitting";

const LOADING_STEPS = [
  "🔍 正在读取照片地理与环境数据...",
  "🧠 正在提取花叶边缘与色彩形态特征...",
  "📖 正在对比 Plantspedia 植物志库...",
  "✍️ 正在整理并自动排版中英科普资料...",
  "💾 正在写入云端，即将生成草稿..."
];

export function CameraIdentify() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Captured photo's natural aspect ratio (w/h). Drives the viewfinder frame so
  // its border hugs the real image instead of letterboxing a fixed square.
  const [imgAspect, setImgAspect] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const albumInputRef = useRef<HTMLInputElement | null>(null);
  const capturedBlobRef = useRef<Blob | null>(null);
  const navigate = useNavigate();
  const submit = useServerFn(submitPlantDraft);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // Progressive loader steps animation
  useEffect(() => {
    if (phase !== "submitting") {
      setStepIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setStepIndex((prev) => {
        if (prev < LOADING_STEPS.length - 1) {
          return prev + 1;
        }
        return prev;
      });
    }, 3500);

    return () => clearInterval(interval);
  }, [phase]);

  // Shared pipeline: read location (EXIF for picked files, geolocation otherwise),
  // compress, generate a preview, and move to the "captured" review state.
  const ingestImage = async (file: File, { tryExif }: { tryExif: boolean }) => {
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }

    const toastId = toast.loading("正在优化图片并读取地理位置...");

    // 1) Try EXIF GPS from the original uploaded photo itself (most accurate).
    let gotExif = false;
    if (tryExif) {
      try {
        const exifr = (await import("exifr")).default;
        const gps = await exifr.gps(file);
        if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
          setCoords({ lat: gps.latitude, lng: gps.longitude });
          gotExif = true;
        }
      } catch {
        /* ignore */
      }
    }

    // 2) Fall back to current browser geolocation if EXIF missing. Native-camera
    //    captures usually carry no GPS EXIF, so this is the common path.
    if (!gotExif && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          toast.success("已获取当前位置 GPS 坐标");
        },
        () => setCoords(null),
        { timeout: 8000, maximumAge: 60_000 },
      );
    }

    // 3) Compress the image to save bandwidth and storage space
    let url: string;
    try {
      const { compressImage } = await import("@/lib/image-compress");
      const compressed = await compressImage(file, 1200, 1200, 0.75);
      capturedBlobRef.current = compressed;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      url = URL.createObjectURL(compressed);
      setPreviewUrl(url);
    } catch {
      // Fallback to original file if compression fails
      capturedBlobRef.current = file;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      url = URL.createObjectURL(file);
      setPreviewUrl(url);
    }

    // Measure the real aspect ratio so the frame can adapt to the画幅.
    setImgAspect(await readAspect(url));

    setPhase("captured");
    toast.dismiss(toastId);
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    void ingestImage(file, { tryExif: true });
  };

  // Open the phone's NATIVE camera app (full focus/zoom/flash, real-framing viewfinder)
  // via a file input with capture=environment. The photo it returns flows through the
  // exact same pipeline as an album pick — so what you shoot is what gets identified.
  const openCamera = () => {
    if (cameraInputRef.current) {
      cameraInputRef.current.value = ""; // allow re-taking the same shot
      cameraInputRef.current.click();
    }
  };

  const retake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setImgAspect(null);
    capturedBlobRef.current = null;
    setCoords(null);
    setPhase("idle");
    // Reset inputs
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (albumInputRef.current) albumInputRef.current.value = "";
  };

  const onSubmit = async () => {
    const blob = capturedBlobRef.current;
    if (!blob) return;
    setPhase("submitting");
    try {
      const base64 = await blobToBase64(blob);
      const res = await submit({
        data: {
          photo_base64: base64,
          photo_mime: blob.type || "image/jpeg",
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        },
      });
      toast.success("识别成功！正在跳转草稿…");
      navigate({ to: "/drafts/$id", params: { id: (res as { draftId: string }).draftId } });
    } catch (e) {
      setPhase("captured");
      toast.error(e instanceof Error ? e.message : "识别失败，请重试");
    }
  };

  return (
    <div className="max-w-md mx-auto w-full bg-paper-deep/35 border border-rule/70 p-4 md:p-5 rounded-3xl shadow-lg mb-12 select-none animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* 1. Viewfinder area — outer centers the frame so a portrait shot stays
          centred; the inner frame's border hugs the real image 画幅. */}
      <div className="w-full flex justify-center">
      <div
        className="scanner-view rounded-2xl relative overflow-hidden bg-background border border-rule/35 shadow-inner"
        style={frameStyle(phase, imgAspect)}
      >
        {/* L-Corners */}
        <div className="scan-corner scan-corner-tl" />
        <div className="scan-corner scan-corner-tr" />
        <div className="scan-corner scan-corner-bl" />
        <div className="scan-corner scan-corner-br" />

        {phase === "idle" ? (
          <>
            {/* Grid background & crosshair */}
            <div className="scanner-grid scanner-grid-animated" />
            <div className="scanner-focus-target" />

            {/* Prompt information */}
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center z-10 pointer-events-none">
              <div className="w-14 h-14 rounded-full bg-ink/5 flex items-center justify-center border border-rule/15 text-ink-soft mb-3 animate-pulse">
                <CameraIcon className="w-7 h-7" />
              </div>
              <p className="text-sm font-bold text-ink-soft leading-snug">点击下方快门调用相机拍摄，或上传已有照片</p>
              <p className="text-xs text-ink-faint leading-normal mt-2 max-w-[220px]">
                建议尽量使照片清晰且主体突出，可在设置中开启位置授权获取分布地图。
              </p>
            </div>
          </>
        ) : (
          <>
            {/* Image display — the frame now matches the photo's真实画幅, so
                object-cover fills it edge-to-edge with no crop and no letterbox. */}
            <img
              src={previewUrl!}
              alt="captured plant"
              className="w-full h-full object-cover transition-opacity duration-300"
            />

            {/* GPS Overlay Badge */}
            {coords && (
              <div className="absolute top-4 right-4 bg-background/85 backdrop-blur-md border border-rule/55 px-2.5 py-1 rounded-full text-[10px] font-semibold tracking-wider text-ink-soft inline-flex items-center gap-1 shadow-sm z-10 animate-in fade-in slide-in-from-top-2 duration-300">
                <MapPinIcon className="w-3.5 h-3.5 text-vermilion" />
                <span>{coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</span>
              </div>
            )}

            {/* Laser scanning line */}
            {phase === "submitting" && <div className="scan-laser-line" />}

            {/* Progressive Loader Card Overlay */}
            {phase === "submitting" && (
              <div className="absolute inset-0 bg-background/45 backdrop-blur-xs flex items-center justify-center p-4 z-20 animate-in fade-in duration-300">
                <div className="bg-background/95 border border-rule/80 p-5 rounded-2xl shadow-xl max-w-[280px] w-full text-center flex flex-col items-center gap-4 animate-in fade-in zoom-in-95 duration-200">
                  <div className="relative w-10 h-10">
                    <div className="w-10 h-10 rounded-full border-[3px] border-rule/20 border-t-vermilion animate-spin" />
                  </div>
                  <div className="space-y-1 w-full">
                    <p className="text-xs font-bold text-vermilion tracking-widest uppercase">AI 深度分析中</p>
                    <p className="text-xs text-ink-soft font-medium min-h-[36px] flex items-center justify-center px-2">
                      {LOADING_STEPS[stepIndex]}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* 2. Control bar */}
      <div className="mt-4 pt-2">
        {phase === "idle" ? (
          <div className="flex items-center justify-between px-6">
            {/* Gallery Upload Button */}
            <button
              onClick={() => albumInputRef.current?.click()}
              title="选择相册照片"
              className="w-12 h-12 rounded-full border border-rule bg-background flex items-center justify-center text-ink hover:bg-ink hover:text-background transition-all cursor-pointer shadow-sm active:scale-90"
            >
              <GalleryIcon className="w-5 h-5" />
            </button>

            {/* Core Shutter Camera Button — opens the phone's native camera app */}
            <button
              onClick={openCamera}
              title="调用相机拍摄"
              className="w-18 h-18 rounded-full border-2 border-ink flex items-center justify-center cursor-pointer shadow-md bg-paper active:scale-90 transition-all group"
            >
              <div className="w-14 h-14 bg-ink rounded-full group-hover:bg-vermilion transition-colors" />
            </button>

            {/* Info / Tips Button */}
            <button
              onClick={() => toast.info("💡 拍照提示：对焦清晰、光线充足并尽量使单种植物居中，能显著提高 AI 识别准确率。")}
              title="使用小贴士"
              className="w-12 h-12 rounded-full border border-rule bg-background flex items-center justify-center text-ink-soft hover:bg-ink hover:text-background transition-all cursor-pointer shadow-sm active:scale-90"
            >
              <InfoIcon className="w-5 h-5" />
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between px-6 gap-4">
            {/* Cancel / Retake Button */}
            <button
              onClick={retake}
              disabled={phase === "submitting"}
              title="重新拍摄"
              className="w-12 h-12 rounded-full border border-rule bg-background flex items-center justify-center text-ink-soft hover:border-destructive hover:text-destructive hover:bg-destructive/5 transition-all cursor-pointer shadow-sm active:scale-90 disabled:opacity-50"
            >
              <RotateCcwIcon className="w-5 h-5" />
            </button>

            {/* AI identify — compact flat icon button (short label stays tidy on mobile) */}
            <button
              onClick={onSubmit}
              disabled={phase === "submitting"}
              title="让 AI 识别并生成草稿"
              className="w-18 h-18 rounded-full border-2 border-ink bg-paper flex flex-col items-center justify-center gap-1 hover:bg-vermilion hover:border-vermilion hover:text-background active:scale-90 transition-all shadow-md cursor-pointer disabled:opacity-50"
            >
              {phase === "submitting" ? (
                <span className="w-6 h-6 rounded-full border-[3px] border-ink/20 border-t-ink animate-spin" />
              ) : (
                <>
                  <SparkleIcon className="w-5 h-5" />
                  <span className="text-[11px] font-bold leading-none tracking-wide">AI识别</span>
                </>
              )}
            </button>

            {/* Info Button */}
            <button
              onClick={() => toast.info("💡 提示：照片已选择。点击中间的“AI识别”按钮即可触发大语言模型生成精美双语科普文案。")}
              title="说明"
              className="w-12 h-12 rounded-full border border-rule bg-background flex items-center justify-center text-ink-soft hover:bg-ink hover:text-background transition-all cursor-pointer shadow-sm active:scale-90"
            >
              <InfoIcon className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>

      {/* Hidden file inputs. The camera one uses capture=environment → native camera
          app (rear lens) on phones; on desktop it falls back to a file picker. */}
      <input
        type="file"
        ref={cameraInputRef}
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onUpload}
      />
      <input
        type="file"
        ref={albumInputRef}
        accept="image/*"
        className="hidden"
        onChange={onUpload}
      />
    </div>
  );
}

// Read an image's natural aspect ratio (width / height) from an object URL.
// Resolves null if it can't be measured (caller then keeps the default frame).
function readAspect(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () =>
      resolve(im.naturalWidth && im.naturalHeight ? im.naturalWidth / im.naturalHeight : null);
    im.onerror = () => resolve(null);
    im.src = url;
  });
}

// Size the viewfinder frame. Idle (or unmeasured) → the original fixed scanner
// box. Once a photo is captured, the frame takes the photo's真实画幅: landscape/
// square drive off full width; portrait drives off height so it never overflows.
function frameStyle(phase: Phase, aspect: number | null): React.CSSProperties {
  if (phase === "idle" || !aspect) {
    return { width: "100%", height: "40vh", minHeight: 280 };
  }
  if (aspect >= 1) {
    return { width: "100%", aspectRatio: String(aspect), maxHeight: "62vh" };
  }
  return { height: "62vh", aspectRatio: String(aspect), maxWidth: "100%", minHeight: 280 };
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

// Flat SVG icons
function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2l1.2-2h6.6L16.5 6h2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9Z"/>
      <circle cx="12" cy="13" r="3.6"/>
    </svg>
  );
}

function GalleryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
      <circle cx="9.5" cy="9.5" r="1.5"/>
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>
    </svg>
  );
}

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/>
      <circle cx="12" cy="10" r="3"/>
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"/>
    </svg>
  );
}

function RotateCcwIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
      <path d="M3 3v5h5"/>
    </svg>
  );
}

function InfoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="12" cy="12" r="10"/>
      <path d="M12 16v-4"/>
      <path d="M12 8h.01"/>
    </svg>
  );
}
