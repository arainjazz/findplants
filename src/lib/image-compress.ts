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
  quality = 0.8
): Promise<Blob | File> {
  // Only compress images, and skip small files (less than 200KB) to avoid overhead
  if (!file.type.startsWith("image/") || file.size < 200 * 1024) {
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
        const outputType = supportsWebP()
          ? "image/webp"
          : file.type === "image/png"
            ? "image/png"
            : "image/jpeg";

        canvas.toBlob(
          (blob) => {
            if (blob) {
              // Return original file if the compressed blob is somehow larger (rare)
              if (blob.size >= file.size) {
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
