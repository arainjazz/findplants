import xiaopLogoUrl from "@/assets/xiaop-logo.png";

/**
 * 小P蛙 (Plantspedia AI agent) brand mark — the user's frog logo (white background
 * stripped to transparent). Exclusive to the AI agent; not used for AI-identify.
 */
export function XiaoPLogo({ className, title }: { className?: string; title?: string }) {
  return (
    <img
      src={xiaopLogoUrl}
      alt={title ?? "小P蛙"}
      className={`object-contain ${className ?? ""}`}
      draggable={false}
    />
  );
}
