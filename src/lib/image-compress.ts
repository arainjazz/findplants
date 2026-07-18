/**
 * Client-side image compression utility.
 * Resizes images to a maximum boundary (default 1600px) and re-encodes them —
 * preferring WebP, which is typically 25–35% smaller than JPEG at the same
 * visual quality and far smaller than PNG for photos — to save storage and
 * bandwidth. Falls back to JPEG/PNG when the browser can't encode WebP.
 *
 * IMPORTANT: the returned Blob's `.type` is the ACTUAL output MIME. Callers must
 * declare the upload `content_type`/`contentType` from the returned blob's
 * `.type` (not the original File's type) or the stored object will be mislabeled
 * and may fail to render. Use `extForMime(blob.type)` to pick a matching path
 * extension.
 */

let _webpSupported: boolean | null = null;
function supportsWebP(): boolean {
  if (_webpSupported !== null) return _webpSupported;
  try {
    const c = document.createElement("canvas");
    c.width = 1;
    c.height = 1;
    _webpSupported = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch {
    _webpSupported = false;
  }
  return _webpSupported;
}

/** Map an image MIME type to a file extension (no dot). */
export function extForMime(mime: string | undefined, fallback = "jpg"): string {
  switch (mime) {
    case "image/webp":
      return "webp";
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/avif":
      return "avif";
    case "image/gif":
      return "gif";
    case "image/svg+xml":
      return "svg";
    default:
      return fallback;
  }
}

export async function compressImage(
  file: File,
  maxWidth = 1600,
  maxHeight = 1600,
  quality = 0.8,
  /**
   * 强制输出格式，覆盖默认的「优先 WebP」。
   *
   * ⚠️ 识别链路必须传 "image/jpeg"：**Pl@ntNet 只接受 JPEG / PNG**，收到 WebP 会直接
   * 400「Unsupported file type for image[0] (jpeg or png)」。而本函数默认输出 WebP，
   * 于是每一张识别照片都被 Pl@ntNet 拒收 —— 专业定种整条链路静默失效、用量表里只剩
   * gemini。这个坑排查了很久，改默认值前务必想清楚。
   */
  preferType?: "image/jpeg" | "image/png" | "image/webp"
): Promise<Blob | File> {
  if (!file.type.startsWith("image/")) return file;

  // 需要强制转码到指定格式时，**即使文件很小也必须转** —— 调用方要的是格式，不是体积。
  const mustConvert = !!preferType && file.type !== preferType;

  // Skip small files (less than 200KB) to avoid overhead — unless we must convert.
  if (!mustConvert && file.size < 200 * 1024) {
    return file;
  }

  // Skip vector images (SVG) and animations (GIF) to prevent breaking them
  if (file.type === "image/svg+xml" || file.type === "image/gif") {
    return file;
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          resolve(file);
          return;
        }

        let width = img.width;
        let height = img.height;

        // Calculate aspect-ratio bounds
        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          } else {
            width = Math.round((width * maxHeight) / height);
            height = maxHeight;
          }
        }

        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, 0, 0, width, height);

        // WebP is the big storage win (handles both photos and transparency).
        // Fall back to PNG (to keep alpha) or JPEG when WebP encoding is
        // unavailable in this browser.
        const outputType =
          preferType ??
          (supportsWebP()
            ? "image/webp"
            : file.type === "image/png"
              ? "image/png"
              : "image/jpeg");

        canvas.toBlob(
          (blob) => {
            if (blob) {
              // Return original file if the compressed blob is somehow larger (rare).
              // 但强制转码时不能这么退 —— JPEG 往往比同质量 WebP 大，一退就把格式退回
              // WebP，Pl@ntNet 又会 400。此时体积让位于格式。
              if (!mustConvert && blob.size >= file.size) {
                resolve(file);
              } else {
                resolve(blob);
              }
            } else {
              resolve(file);
            }
          },
          outputType,
          quality
        );
      };
      img.onerror = () => {
        resolve(file);
      };
    };
    reader.onerror = () => {
      resolve(file);
    };
  });
}
