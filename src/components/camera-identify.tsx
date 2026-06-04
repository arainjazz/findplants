import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { submitPlantDraft } from "@/lib/identify-plant.functions";
import { toast } from "sonner";

type Phase = "idle" | "permission" | "ready" | "captured" | "submitting";

export function CameraIdentify() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const capturedBlobRef = useRef<Blob | null>(null);
  const navigate = useNavigate();
  const submit = useServerFn(submitPlantDraft);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startCamera = async () => {
    setPhase("permission");
    setStatusText("正在请求摄像头权限…");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setPhase("ready");
      setStatusText("");
      // Request geolocation in parallel (non-blocking)
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          () => setCoords(null),
          { timeout: 8000, maximumAge: 60_000 },
        );
      }
    } catch (e) {
      setPhase("idle");
      toast.error(e instanceof Error ? e.message : "无法访问摄像头");
    }
  };

  const captureFrame = async () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement("canvas");
    const w = video.videoWidth;
    const h = video.videoHeight;
    // Cap to ~1280 on the long side to keep payload reasonable.
    const scale = Math.min(1, 1280 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", 0.85),
    );
    if (!blob) return toast.error("拍照失败");
    capturedBlobRef.current = blob;
    setPreviewUrl(URL.createObjectURL(blob));
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setPhase("captured");
  };

  const retake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    capturedBlobRef.current = null;
    startCamera();
  };

  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast.error("请选择图片文件");
    capturedBlobRef.current = file;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(URL.createObjectURL(file));
    // 1) Try EXIF GPS from the uploaded photo itself (most accurate).
    let gotExif = false;
    try {
      const exifr = (await import("exifr")).default;
      const gps = await exifr.gps(file);
      if (gps && typeof gps.latitude === "number" && typeof gps.longitude === "number") {
        setCoords({ lat: gps.latitude, lng: gps.longitude });
        gotExif = true;
        toast.success("已从照片 EXIF 中读取拍摄地点");
      }
    } catch {
      /* ignore */
    }
    // 2) Fall back to current browser geolocation if EXIF missing.
    if (!gotExif && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => setCoords(null),
        { timeout: 8000, maximumAge: 60_000 },
      );
    }
    setPhase("captured");
  };

  const onSubmit = async () => {
    const blob = capturedBlobRef.current;
    if (!blob) return;
    setPhase("submitting");
    setStatusText("AI 正在识别植物…");
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
      setStatusText("");
      toast.error(e instanceof Error ? e.message : "识别失败，请重试");
    }
  };

  return (
    <section className="mb-12 border-2 border-ink bg-paper-deep/30 p-6 md:p-8">
      <div className="flex items-start justify-between flex-wrap gap-4 mb-4">
        <div className="min-w-0 flex-1">
          <p className="label text-vermilion mb-1">AI copilot · Plantspedia</p>
          <FitOneLine className="font-display font-bold text-ink block w-full">让 AI 识别植物身份并向你介绍这位新遇见的朋友吧</FitOneLine>
          <FitOneLine className="text-ink-faint block w-full mt-1" weight={400}>访客也能直接拍摄并生成草稿，等待编辑审核后正式收录。</FitOneLine>
        </div>
        {coords && (
          <p className="label text-xs text-ink-faint inline-flex items-center gap-1">
            <MapPinIcon className="w-3.5 h-3.5" />
            {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
          </p>
        )}
      </div>

      {phase === "idle" && (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={startCamera}
            className="flex-1 bg-ink text-background px-6 py-3 hover:bg-vermilion transition-colors font-semibold inline-flex items-center justify-center gap-2"
          >
            <CameraIcon className="w-5 h-5" />
            <span>打开摄像头拍照</span>
          </button>
          <label className="flex-1 border-2 border-ink px-6 py-3 hover:bg-ink hover:text-background transition-colors text-center cursor-pointer font-semibold inline-flex items-center justify-center gap-2">
            <GalleryIcon className="w-5 h-5" />
            <span>从相册选择</span>
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={onUpload} />
          </label>
        </div>
      )}


      {(phase === "permission" || phase === "ready") && (
        <div>
          <div className="bg-black overflow-hidden mb-4 max-h-[60vh]">
            <video ref={videoRef} playsInline muted className="w-full h-auto block" />
          </div>
          {phase === "ready" && (
            <button
              onClick={captureFrame}
              className="w-full bg-vermilion text-background px-6 py-3 font-semibold hover:bg-ink transition-colors inline-flex items-center justify-center gap-2"
            >
              <CameraIcon className="w-5 h-5" />
              <span>拍摄</span>
            </button>
          )}
          {statusText && <p className="text-sm text-ink-faint mt-2">{statusText}</p>}
        </div>
      )}

      {(phase === "captured" || phase === "submitting") && previewUrl && (
        <div>
          <div className="bg-paper-deep border border-rule overflow-hidden mb-4">
            <img src={previewUrl} alt="captured" className="w-full h-auto max-h-[60vh] object-contain mx-auto block" />
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onSubmit}
              disabled={phase === "submitting"}
              className="flex-1 bg-ink text-background px-6 py-3 hover:bg-vermilion transition-colors font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              {phase === "submitting" ? <span>AI 识别中… 约需 10–30 秒</span> : (<><SparkleIcon className="w-5 h-5" /><span>让 AI 识别并生成草稿</span></>)}
            </button>
            <button
              onClick={retake}
              disabled={phase === "submitting"}
              className="border border-ink px-6 py-3 hover:bg-ink hover:text-background transition-colors disabled:opacity-60"
            >
              重新拍摄
            </button>
          </div>
          {statusText && <p className="text-sm text-ink-faint mt-2">{statusText}</p>}
        </div>
      )}
    </section>
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

// Flat-style inline SVG icons (stroke = currentColor so they inherit theme).
function CameraIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h2l1.2-2h6.6L16.5 6h2A2.5 2.5 0 0 1 21 8.5v9A2.5 2.5 0 0 1 18.5 20h-13A2.5 2.5 0 0 1 3 17.5v-9Z"/>
      <circle cx="12" cy="13" r="3.6"/>
    </svg>
  );
}

function GalleryIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="13" rx="2"/>
      <circle cx="8.5" cy="9" r="1.4"/>
      <path d="m4 16 4.5-4.5 4 4 3-3L20 17"/>
    </svg>
  );
}

function MapPinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/>
      <circle cx="12" cy="10" r="2.6"/>
    </svg>
  );
}

function SparkleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.5 5.5l2.8 2.8M15.7 15.7l2.8 2.8M5.5 18.5l2.8-2.8M15.7 8.3l2.8-2.8"/>
    </svg>
  );
}

// Renders text as SVG so it always fits the container width on one line,
// scaling font size down on narrow screens without truncating.
function FitOneLine({
  children,
  className,
  weight = 700,
}: {
  children: string;
  className?: string;
  weight?: number;
}) {
  const ref = useRef<SVGTextElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number }>({ w: 1000, h: 100 });
  useEffect(() => {
    if (!ref.current) return;
    const bb = ref.current.getBBox();
    if (bb.width > 0 && bb.height > 0) setBox({ w: bb.width, h: bb.height });
  }, [children, weight]);
  return (
    <svg
      viewBox={`0 0 ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      className={className}
      role="img"
      aria-label={children}
    >
      <text
        ref={ref}
        x="0"
        y={box.h * 0.82}
        fontSize={box.h * 0.9}
        fontWeight={weight}
        fill="currentColor"
        style={{ fontFamily: "inherit" }}
      >
        {children}
      </text>
    </svg>
  );
}

