import { useEffect, useState, type ReactNode } from "react";

/**
 * <img> that falls back to `fallback` when the src is empty OR fails to load
 * (e.g. a Supabase object that was deleted → 404). Prevents broken-image boxes
 * from showing on the homepage / cards.
 */
export function SafeImg({
  src,
  alt,
  className,
  loading,
  fallback,
}: {
  src?: string | null;
  alt?: string;
  className?: string;
  loading?: "lazy" | "eager";
  fallback: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false); // reset when the url changes
  }, [src]);
  if (!src || failed) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt ?? ""}
      className={className}
      loading={loading}
      onError={() => setFailed(true)}
    />
  );
}
