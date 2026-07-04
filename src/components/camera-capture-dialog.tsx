import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

/**
 * Self-contained live-camera capture modal built on getUserMedia. Opens the
 * device camera (rear by default, front/back toggle), and on shutter hands the
 * captured frame back as a JPEG Blob via onCapture. Falls back with a clear
 * message when the camera API is unavailable or permission is denied.
 *
 * Mirrors the capture logic in camera-identify.tsx but is reusable (e.g. the
 * draft "replace photo → take on site" flow).
 */
export function CameraCaptureDialog({
  onCapture,
  onClose,
  title = "现场拍摄替换配图",
}: {
  onCapture: (blob: Blob) => void;
  onClose: () => void;
  title?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  };

  const start = async (mode: "environment" | "user") => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持摄像头，请改用「联网搜索」替换");
      return;
    }
    try {
      stopStream();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      });
      streamRef.current = stream;
      setFacingMode(mode);
      setError(null);
      setReady(true);
    } catch (err) {
      const denied =
        err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "SecurityError");
      setError(
        denied
          ? "摄像头权限被拒绝，请在浏览器设置中允许后重试，或改用「联网搜索」替换"
          : "无法打开摄像头，请改用「联网搜索」替换",
      );
    }
  };

  // Start the camera on mount; always stop tracks on unmount.
  useEffect(() => {
    void start("environment");
    return () => stopStream();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bind the live stream once the <video> is rendered; re-bind on flip.
  useEffect(() => {
    if (ready && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {
        /* autoplay may defer until gesture; ignore */
      });
    }
  }, [ready, facingMode]);

  const snap = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      toast.error("摄像头尚未就绪，请稍候再试");
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      toast.error("拍摄失败，请重试");
      return;
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    stopStream();
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) {
      toast.error("拍摄失败，请重试");
      return;
    }
    onCapture(blob);
  };

  const flip = () => void start(facingMode === "environment" ? "user" : "environment");
  const close = () => {
    stopStream();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4"
      onClick={close}
    >
      <div
        className="bg-background border border-ink shadow-xl w-full max-w-md flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h3 className="label text-vermilion">{title}</h3>
          <button
            type="button"
            onClick={close}
            className="text-ink-faint hover:text-ink text-xl leading-none"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="relative bg-black aspect-[4/3] w-full overflow-hidden">
          {error ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-white/90">
              {error}
            </div>
          ) : (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: facingMode === "user" ? "scaleX(-1)" : undefined }}
            />
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 gap-4">
          <button
            type="button"
            onClick={close}
            title="取消"
            className="w-11 h-11 rounded-full border border-rule bg-background flex items-center justify-center text-ink-soft hover:border-destructive hover:text-destructive transition-all active:scale-90"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
          </button>
          <button
            type="button"
            onClick={snap}
            disabled={!!error}
            title="拍摄"
            className="w-16 h-16 rounded-full border-2 border-ink bg-paper flex items-center justify-center active:scale-90 transition-all disabled:opacity-40"
          >
            <span className="w-12 h-12 bg-vermilion rounded-full" />
          </button>
          <button
            type="button"
            onClick={flip}
            disabled={!!error}
            title="切换前后摄像头"
            className="w-11 h-11 rounded-full border border-rule bg-background flex items-center justify-center text-ink-soft hover:bg-ink hover:text-background transition-all active:scale-90 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 19H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h3l2-2h6l1 1" /><path d="M16 3.5 18.5 6 16 8.5" /><path d="M22 11.5a4 4 0 0 0-4-4h-4" /><circle cx="12" cy="13" r="3" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}
