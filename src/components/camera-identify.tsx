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
    if (navigator.geolocation) {
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
        <div>
          <p className="label text-vermilion mb-1">Photo → AI</p>
          <h2 className="font-display text-2xl md:text-3xl font-bold">拍一张植物，让 AI 写一页</h2>
          <p className="text-sm text-ink-faint mt-1">
            访客也能直接拍摄并生成草稿，等待编辑审核后正式收录。位置信息来自浏览器定位。
          </p>
        </div>
        {coords && (
          <p className="label text-xs text-ink-faint">
            📍 {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
          </p>
        )}
      </div>

      {phase === "idle" && (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={startCamera}
            className="flex-1 bg-ink text-background px-6 py-3 hover:bg-vermilion transition-colors font-semibold"
          >
            📷 打开摄像头拍照
          </button>
          <label className="flex-1 border-2 border-ink px-6 py-3 hover:bg-ink hover:text-background transition-colors text-center cursor-pointer font-semibold">
            🖼 从相册选择
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
              className="w-full bg-vermilion text-background px-6 py-3 font-semibold hover:bg-ink transition-colors"
            >
              📸 拍摄
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
              className="flex-1 bg-ink text-background px-6 py-3 hover:bg-vermilion transition-colors font-semibold disabled:opacity-60"
            >
              {phase === "submitting" ? "AI 识别中… 约需 10–30 秒" : "✨ 让 AI 识别并生成草稿"}
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
