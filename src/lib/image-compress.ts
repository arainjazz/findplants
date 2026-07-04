/**
 * Client-side image compression utility.
 * Resizes images to a maximum boundary (default 1600px) and compresses quality
 * to save network bandwidth and storage space in Supabase.
 */
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

        // Determine output type (WebP is ideal, fallback to JPEG for standard photos)
        // PNGs are output as PNGs to preserve transparency, otherwise JPEG.
        const outputType = file.type === "image/png" ? "image/png" : "image/jpeg";

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
