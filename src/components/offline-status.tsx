import { useEffect, useState } from "react";
import { Wifi, WifiOff, X } from "lucide-react";

export function OfflineStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const [showBanner, setShowBanner] = useState(false);
  const [bannerType, setBannerType] = useState<"offline" | "restored">("offline");

  useEffect(() => {
    if (typeof window === "undefined") return;

    setIsOnline(navigator.onLine);
    if (!navigator.onLine) {
      setBannerType("offline");
      setShowBanner(true);
    }

    const handleOnline = () => {
      setIsOnline(true);
      setBannerType("restored");
      setShowBanner(true);
      // Auto-hide the restored banner after 4 seconds
      const timer = setTimeout(() => {
        setShowBanner(false);
      }, 4000);
      return () => clearTimeout(timer);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setBannerType("offline");
      setShowBanner(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  if (!showBanner) return null;

  return (
    // 靠左：右下角常驻着小P蛙（浮标 + 进度条 + 名牌），压在它上面会盖掉任务进度。
    <div className="fixed bottom-6 left-6 z-50 animate-fade-in-up">
      <div
        className={`flex items-center gap-3 px-4 py-3 rounded border shadow-2xl backdrop-blur-md max-w-sm ${
          bannerType === "offline"
            ? "bg-black/90 border-red-500 text-white"
            : "bg-black/90 border-emerald-500 text-white"
        }`}
      >
        <span className="shrink-0">
          {bannerType === "offline" ? (
            <WifiOff className="w-5 h-5 text-red-500 animate-pulse" />
          ) : (
            <Wifi className="w-5 h-5 text-emerald-500" />
          )}
        </span>
        <div className="flex-1 min-w-0 pr-1">
          <p className="font-display font-semibold text-xs leading-tight">
            {bannerType === "offline" ? "您已进入离线状态" : "网络已恢复连接"}
          </p>
          <p className="text-[10px] text-ink-faint leading-normal mt-0.5">
            {bannerType === "offline"
              ? "页面已启用离线浏览，部分网络功能将受限。"
              : "已重新连接至网络，您可以继续进行编辑和探索。"}
          </p>
        </div>
        <button
          onClick={() => setShowBanner(false)}
          className="text-ink-faint hover:text-white shrink-0 p-0.5 rounded-full hover:bg-white/10 transition-colors"
          aria-label="关闭"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}
