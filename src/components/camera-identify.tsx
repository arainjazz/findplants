import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { quickIdentifyDraft } from "@/lib/identify-plant.functions";
import { findDraftByPhotoHash } from "@/lib/species-existing.functions";
import { keepVisualAdvice } from "@/lib/retake-advice";
import { explainError, isNetworkError } from "@/lib/explain-error";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

type Phase = "idle" | "captured" | "submitting";

const LOADING_STEPS = [
  "🔍 正在读取照片地理与环境数据...",
  "🧠 正在提取花叶边缘与色彩形态特征...",
  "📖 正在对比 Plantspedia 植物志库...",
  "✍️ 正在整理并自动排版中英科普资料...",
  "💾 正在写入云端，即将生成草稿..."
];

/** 补拍复核上下文：从草稿页「去补拍」带来，count=本次是第几次补拍（≥3 服务端强制出结论）。
 *  advice=首次识别给出的「需要补拍哪些部位」具体建议（needs_more_photos_zh）。
 *  pick=true 时不自动弹相机，让用户在「打开相机」和「选择相册图片」之间自己选
 *  （走「草稿内容和我的观察不符」进来的场景——用户手里可能已经有更合适的照片了）。 */
export type RetakeContext = {
  count: number;
  title?: string;
  sci?: string;
  advice?: string;
  mergeDraftId?: string;
  pick?: boolean;
};

/** 补拍一次最多带几张照片。3 = 主图 + 2 张额外角度照，和服务端 `extra_photos` 的 max(2)、
 *  以及模型侧一直以来的「prior.slice(0,2) + 当前 1 张」上限是同一个数——三处必须一致，
 *  改这里就要同时改 SubmitInput.extra_photos 的 .max()。 */
const MAX_RETAKE_PHOTOS = 3;

// Ordinal label for the retake counter. 3 is the last allowed retake (server forces
// a final result at count ≥ 3), so it reads「最后一次补拍」.
function retakeOrdinal(count: number): string {
  if (count >= 3) return "最后一次补拍";
  return count === 1 ? "第一次补拍" : count === 2 ? "第二次补拍" : `第 ${count} 次补拍`;
}

export function CameraIdentify({ retake: retakeCtx = null }: { retake?: RetakeContext | null } = {}) {
  const retakeMode = !!retakeCtx;
  // 上一轮的补拍建议，滤掉「摸一摸 / 闻一闻」这类拍不出来的条目：库里的旧草稿存的还是
  // prompt 加禁令之前的文案，照搬出来只会让用户白跑一趟（他们只能回传照片）。
  const visualAdvice = keepVisualAdvice(retakeCtx?.advice);
  const { user } = useAuth(); // 获取当前登录用户
  const [phase, setPhase] = useState<Phase>("idle");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  // Captured photo's natural aspect ratio (w/h). Drives the viewfinder frame so
  // its border hugs the real image instead of letterboxing a fixed square.
  const [imgAspect, setImgAspect] = useState<number | null>(null);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [geoRequested, setGeoRequested] = useState(false); // track if we've requested geolocation
  // Coarse location-permission status, surfaced on the review screen so a wrong
  // "deny" tap doesn't silently persist. "denied" → we show a re-acquire button
  // + settings guide instead of failing quietly.
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "granted" | "denied" | "unavailable" | "timeout">("idle");
  const [stepIndex, setStepIndex] = useState(0);
  // Last identify failure, kept on screen (a toast vanishes before the user can read
  // the cause). Server errors already carry「原因 + 怎么办」in their message.
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // 断线自愈期间盖在加载浮层上的说明。非空 = 请求已经断了，正在回查服务端有没有其实做成。
  // 这段时间**绝不能**显示「识别失败」——那正是要修的误报。
  const [recoverNote, setRecoverNote] = useState<string | null>(null);
  // 错误横幅的标题该怎么写。断言「失败」的门槛很高：只有服务端明确拒绝，或回查确认过
  // 库里确实没有，才算真失败；连接断了又没查证过，只能说「状态未知」。
  const [errorKind, setErrorKind] = useState<"failed" | "no-result" | "unknown">("failed");
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const albumInputRef = useRef<HTMLInputElement | null>(null);
  const capturedBlobRef = useRef<Blob | null>(null);
  // 补拍专用：同一株植物的**额外角度照**（最多 2 张），和主图在同一次请求里一起识别。
  // 只在补拍模式下收集——首次识别时用户还没被告知该拍哪儿，多要照片只是白加负担。
  const [extraShots, setExtraShots] = useState<{ blob: Blob; url: string }[]>([]);
  // 下一次文件选择是要「加一张额外角度照」还是「换掉主图」。原生 input 的 change 事件里
  // 分不出是哪个按钮打开的，所以在点击时先记下来。
  const addingExtraRef = useRef(false);
  // Mirror of `coords` for reads inside async callbacks (avoids stale closures)
  // — ingestImage must not wipe coords already obtained at shutter-tap time.
  const coordsRef = useRef<{ lat: number; lng: number } | null>(null);
  // GPS parsed from the photo's own EXIF metadata. Used as a FALLBACK when the
  // live browser geolocation is denied/unavailable (e.g. Chrome iOS without the
  // permission) — reading EXIF needs no permission prompt.
  const exifCoordsRef = useRef<{ lat: number; lng: number } | null>(null);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const submit = useServerFn(quickIdentifyDraft);
  const findDuplicate = useServerFn(findDraftByPhotoHash);
  // 非空 = 这张照片以前识别过，弹「去看看 / 再识别一次」确认框。
  const [dupHit, setDupHit] = useState<{ draftId: string; title: string | null; hash: string } | null>(
    null,
  );
  // The user's ORIGINAL (uncompressed) file — kept so "保存原图到相册" saves the good
  // copy. A web-camera capture is NOT auto-saved to the iPhone album, so this button
  // is the user's escape hatch to keep the shot (re-identify later from good signal).
  const originalFileRef = useRef<File | null>(null);

  // 补拍等待选照片时，取景框和快门整块藏起来：横幅上已经给了「打开相机 / 上传相册」两个
  // 按钮，下面再摆一个可点的取景框+快门，用户就得猜该点哪个。选完照片后照常显示预览。
  const hideViewfinder = retakeMode && phase === "idle";

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // 角度照的 blob: URL 在离开本组件时回收。识别成功后是 SPA 路由跳走、document 不销毁，
  // 浏览器不会自动释放这些 URL —— 不显式 revoke 就等于每补拍一轮泄漏几 MB。
  const extraShotsRef = useRef<{ blob: Blob; url: string }[]>([]);
  useEffect(() => {
    extraShotsRef.current = extraShots;
  }, [extraShots]);
  useEffect(
    () => () => {
      extraShotsRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    },
    [],
  );

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

  const applyCoords = (c: { lat: number; lng: number } | null) => {
    coordsRef.current = c;
    setCoords(c);
  };

  /**
   * Request the browser's live position.
   *
   * ⚠️ MUST be called from a real user gesture (a click/tap handler), NOT from the
   * file-input `change` event. When the native camera closes, the page has just
   * regained focus and has NO user activation — Chrome on iOS then silently denies
   * geolocation and never shows its permission prompt (Safari is lenient and still
   * prompts, which is why the two browsers behaved differently). So we fire this on
   * the shutter/album tap, before the picker opens.
   *
   * Once a site is set to "denied" no code can force a re-prompt; we detect that via
   * the Permissions API and route the user to the settings guide instead.
   */
  const requestGeo = () => {
    if (!navigator.geolocation) {
      setGeoStatus("unavailable");
      return;
    }
    setGeoRequested(true);
    setGeoStatus("loading");

    // iOS WKWebView (which Chrome iOS is built on) has a long-standing bug: with
    // enableHighAccuracy the request can hang forever and fire NEITHER callback,
    // ignoring the built-in `timeout` — so the spinner would spin indefinitely and
    // the user never gets a prompt OR an error. This settled/hard-timer pair
    // guarantees the flow always resolves. We also use COARSE accuracy: network/
    // Wi-Fi positioning is faster and far less likely to hang than GPS, and
    // district-level is all the reverse-geocoder needs.
    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimer);
      setGeoRequested(false);
      fn();
    };

    const hardTimer = setTimeout(() => {
      settle(() => {
        if (exifCoordsRef.current) {
          if (!coordsRef.current) applyCoords(exifCoordsRef.current);
          setGeoStatus("granted");
          toast.success("✓ 已使用照片自带位置", { id: "geo-exif" });
          return;
        }
        console.warn("[Geolocation] hard timeout — no callback fired (likely iOS Location Services off for Chrome)");
        setGeoStatus("timeout");
        toast.error("定位无响应：请检查 iOS 设置 → 隐私与安全性 → 定位服务，确认已开启且 Chrome 设为「使用 App 期间」", {
          id: "geo-timeout",
          duration: 9000,
        });
      });
    }, 13_000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        settle(() => {
          applyCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
          setGeoStatus("granted");
          toast.success("✓ 已获取当前位置", { id: "geo-success" });
        });
      },
      (err) => {
        console.warn("[Geolocation] Failed or denied:", err.code, err.message);
        settle(() => {
          // If the photo carries EXIF GPS, we still have a location — surface it.
          if (exifCoordsRef.current) {
            if (!coordsRef.current) applyCoords(exifCoordsRef.current);
            setGeoStatus("granted");
            toast.success("✓ 已使用照片自带位置", { id: "geo-exif" });
          } else if (err.code === err.PERMISSION_DENIED) {
            setGeoStatus("denied");
            toast.info("未获取到定位权限 — 地点很重要，请点「开启定位」重试", { id: "geo-denied" });
          } else {
            // POSITION_UNAVAILABLE / TIMEOUT — usually iOS Location Services off.
            setGeoStatus("timeout");
            toast.error("暂时拿不到定位：请检查 iOS 设置 → 隐私与安全性 → 定位服务 是否已为 Chrome 开启，再点「开启定位」重试", {
              id: "geo-failed",
              duration: 9000,
            });
          }
        });
      },
      { timeout: 12_000, maximumAge: 60_000, enableHighAccuracy: false },
    );
  };

  // Probe the real permission state so the banner can tell "还没授权（点一下就能弹框）"
  // apart from "已被拒绝（只能去设置里改）". Not supported everywhere → undefined.
  const [permState, setPermState] = useState<PermissionState | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const p = await navigator.permissions?.query({ name: "geolocation" as PermissionName });
        if (!p || cancelled) return;
        setPermState(p.state);
        p.onchange = () => setPermState(p.state);
      } catch {
        /* Permissions API unsupported (older Safari) — banner falls back to generic copy */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 补拍模式下**不自动弹相机**：用户手里可能已经有更合适的照片了，相机弹出来会盖住
  // 「打开相机补拍 / 上传相册补拍」这两个按钮，等于替用户做了选择。两个入口一起摆出来、
  // 由用户点，是这里唯一的进入方式。（RetakeContext.pick 因此不再影响行为，保留只为兼容
  // 已发出去的 /identify?pick=1 链接。）

  // 补拍**不再**一选完就自动识别：现在一次最多能带 3 张，自动提交会把用户锁死在第 1 张，
  // 根本没机会补上另外两个角度（这正是补拍最需要的东西）。改成选完停在预览页，由用户按
  // 「AI识别」决定什么时候连同已加的角度照一起发。

  // Shared pipeline: compress the image, generate a preview, and move to the "captured"
  // review state. Geolocation strategy depends on the source:
  // - Camera shutter → browser's live geolocation (where the user is NOW)
  // - Album upload → photo's EXIF GPS first (where it was TAKEN), browser location as fallback
  const ingestImage = async (file: File, { tryExif }: { tryExif: boolean }) => {
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }

    originalFileRef.current = file;
    const toastId = toast.loading("正在优化图片并获取位置...");

    // NOTE: do NOT reset coords/geoStatus here. The live position was already
    // requested from the shutter/album TAP (a real user gesture) — resetting would
    // throw away a good fix, and re-requesting from this `change` handler is exactly
    // the no-user-activation path that Chrome iOS silently denies.
    exifCoordsRef.current = null;

    // For album uploads (tryExif=true), prioritize EXIF GPS — it reflects where the
    // photo was taken, not where the user is now scrolling through their library.
    // For shutter captures (tryExif=false), skip EXIF and use live geolocation only.
    if (tryExif) {
      try {
        const exifr = (await import("exifr")).default;
        const gps = await exifr.gps(file);
        if (gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude)) {
          exifCoordsRef.current = { lat: gps.latitude, lng: gps.longitude };
          // For album uploads, EXIF GPS wins — apply it immediately, overriding any
          // stale browser location from a previous tap.
          applyCoords({ lat: gps.latitude, lng: gps.longitude });
        } else {
          // No EXIF GPS in the photo → fall back to browser's live location if available,
          // or request it if not already in flight.
          if (!coordsRef.current && geoStatus !== "loading" && !geoRequested) requestGeo();
        }
      } catch {
        // EXIF read failed → fall back to browser location
        if (!coordsRef.current && geoStatus !== "loading" && !geoRequested) requestGeo();
      }
    } else {
      // Shutter capture: browser's live geolocation was already requested on tap.
      // Last-resort retry only if the tap-time request produced nothing and none is
      // in flight. On Chrome iOS this will fail silently (no activation) — that's fine.
      if (!coordsRef.current && geoStatus !== "loading" && !geoRequested) requestGeo();
    }

    // Compress the image to save bandwidth and storage space
    let url: string;
    try {
      const { compressImage } = await import("@/lib/image-compress");
      // 必须输出 JPEG：Pl@ntNet 只收 JPEG/PNG，压成默认的 WebP 会被它 400 拒收，
      // 导致专业定种整条链路静默失效（用量表里只剩 gemini）。体积让位于可识别性。
      const compressed = await compressImage(file, 1200, 1200, 0.75, "image/jpeg");
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

  /** 额外角度照：只压缩 + 存进内存，**不碰定位**。位置属于「这一株植物」，主图那次已经定好了，
   *  再让每张角度照去改一遍 coords，只会把好不容易拿到的坐标覆盖成空。 */
  const ingestExtras = async (files: File[]) => {
    const room = MAX_RETAKE_PHOTOS - 1 - extraShots.length;
    if (room <= 0) {
      toast.info(`一次最多识别 ${MAX_RETAKE_PHOTOS} 张照片`);
      return;
    }
    const picked = files.filter((f) => f.type.startsWith("image/")).slice(0, room);
    if (!picked.length) {
      toast.error("请选择图片文件");
      return;
    }
    const toastId = toast.loading("正在优化图片...");
    const { compressImage } = await import("@/lib/image-compress");
    const added: { blob: Blob; url: string }[] = [];
    for (const f of picked) {
      let blob: Blob = f;
      try {
        // 同样强制 JPEG：这几张会一起发给 Pl@ntNet，而它只收 JPEG/PNG。
        blob = await compressImage(f, 1200, 1200, 0.75, "image/jpeg");
      } catch {
        /* 压缩失败就用原文件，识别照常 */
      }
      added.push({ blob, url: URL.createObjectURL(blob) });
    }
    setExtraShots((prev) => [...prev, ...added].slice(0, MAX_RETAKE_PHOTOS - 1));
    toast.dismiss(toastId);
    if (files.length > picked.length)
      toast.info(`已加入 ${picked.length} 张，一次最多识别 ${MAX_RETAKE_PHOTOS} 张`);
  };

  const removeExtra = (idx: number) => {
    setExtraShots((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const asExtra = addingExtraRef.current;
    addingExtraRef.current = false;
    if (asExtra) {
      void ingestExtras(files);
      return;
    }
    void ingestImage(files[0], { tryExif: true });
    // 补拍时相册允许一次多选：第 1 张当主图，其余的直接补成额外角度照——用户手里本来就有
    // 好几个角度时，这样一次就选完了，不必「选一张 → 加一张 → 再加一张」点三轮。
    if (retakeMode && files.length > 1) void ingestExtras(files.slice(1));
  };

  // Open the phone's NATIVE camera app (full focus/zoom/flash, real-framing viewfinder)
  // via a file input with capture=environment. The photo it returns flows through the
  // exact same pipeline as an album pick — so what you shoot is what gets identified.
  //
  // We ask for the position HERE, inside the tap handler, while the page still has
  // user activation — this is what makes Chrome iOS actually show its permission
  // prompt. The GPS fix resolves in the background while the camera app is open.
  const openCamera = () => {
    applyCoords(null);
    requestGeo();
    if (cameraInputRef.current) {
      cameraInputRef.current.value = ""; // allow re-taking the same shot
      cameraInputRef.current.click();
    }
  };

  // Album pick: same gesture-time request. EXIF GPS from the chosen photo still acts
  // as the fallback if the live fix is denied.
  const openAlbum = () => {
    applyCoords(null);
    requestGeo();
    albumInputRef.current?.click();
  };

  // 加一张额外角度照。和 openCamera/openAlbum 的关键差别：**不重置也不重新请求定位** ——
  // 坐标属于这一株植物，主图那一次已经取好了。
  const addExtraFromCamera = () => {
    addingExtraRef.current = true;
    if (cameraInputRef.current) {
      cameraInputRef.current.value = "";
      cameraInputRef.current.click();
    }
  };
  const addExtraFromAlbum = () => {
    addingExtraRef.current = true;
    if (albumInputRef.current) {
      albumInputRef.current.value = "";
      albumInputRef.current.click();
    }
  };

  const retake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setImgAspect(null);
    capturedBlobRef.current = null;
    originalFileRef.current = null;
    exifCoordsRef.current = null;
    applyCoords(null);
    setGeoRequested(false);
    setGeoStatus("idle");
    setPhase("idle");
    // 主图都撤了，额外角度照留着没有意义（它们只在有主图的那次请求里一起发出去）。
    setExtraShots((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
    addingExtraRef.current = false;
    // Reset inputs
    if (cameraInputRef.current) cameraInputRef.current.value = "";
    if (albumInputRef.current) albumInputRef.current.value = "";
  };

  // Save the ORIGINAL photo to the user's device/album. Web can't write the camera
  // roll silently, so we use the native share sheet (iOS shows「存储图像」) and fall
  // back to a plain download where sharing files isn't supported.
  const saveToAlbum = async () => {
    const file = originalFileRef.current;
    if (!file) return;
    const nav = navigator as Navigator & {
      canShare?: (d: { files: File[] }) => boolean;
      share?: (d: { files: File[]; title?: string }) => Promise<void>;
    };
    try {
      if (nav.share && nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: "植物照片" });
        return;
      }
    } catch {
      /* user cancelled or share unsupported → fall through to download */
    }
    try {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name || `plant-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("已导出原图，请在下载/分享中保存到相册", { id: "album-save" });
    } catch {
      toast.error("保存失败，请长按图片手动保存");
    }
  };

  /** 原始文件字节的 SHA-256（十六进制）。压缩前算 —— 压缩是有损再编码，不保证跨次比特一致，
   *  而同一个文件重新选一次，原始字节必然一模一样。 */
  const hashOriginalFile = async (): Promise<string | null> => {
    try {
      const f = originalFileRef.current;
      if (!f || !crypto?.subtle) return null;
      const buf = await f.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", buf);
      return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
    } catch {
      return null; // 查重是锦上添花，算不出来就当没有
    }
  };

  /** 点「识别」的入口：先查这张照片是不是识别过。补拍不查 —— 补拍本来就是同一株植物再拍，
   *  而且要合并回原草稿，弹「已识别过」纯属添乱。 */
  const onSubmit = async () => {
    if (!capturedBlobRef.current) return;
    // 补拍**照样算 hash**，只是跳过「已识别过」弹窗（补拍本来就是同一株再拍，弹窗纯属添乱）。
    // 以前这里直接传 null，导致断线自愈在补拍路径上完全失效 —— 而补拍恰恰是最容易断的一环
    // （照片更多、还要多带上历轮照片一起送模型）。
    if (retakeCtx) return void runIdentify(await hashOriginalFile());
    const hash = await hashOriginalFile();
    if (hash) {
      try {
        const hit = await findDuplicate({ data: { hash } });
        if (hit) {
          setDupHit({ ...hit, hash });
          return; // 交给弹窗决定：跳过去看，还是再识别一次
        }
      } catch {
        /* 查重失败不挡识别 */
      }
    }
    void runIdentify(hash);
  };

  const runIdentify = async (photoSha256: string | null) => {
    const blob = capturedBlobRef.current;
    if (!blob) return;

    // If geolocation is still pending, wait up to 3 seconds for it to complete
    if (geoRequested) {
      const waitId = toast.loading("等待位置信息...");
      let waited = 0;
      while (geoRequested && waited < 3000) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        waited += 300;
      }
      toast.dismiss(waitId);
    }

    // For album uploads, EXIF GPS was already applied to coords if present.
    // For shutter captures, coords holds the browser's live location.
    const finalCoords = coords;

    setPhase("submitting");
    setErrorMsg(null);
    // 失败时用来判断「秒断（断网/切网）」还是「久等后断（超时/后台挂起）」——
    // 光看 `Load failed` 这串字是分不出来的。
    const startedAt = Date.now();
    try {
      const base64 = await blobToBase64(blob);
      // 额外角度照与主图同一次请求发出，服务端把它们一起喂给 Pl@ntNet 和视觉模型。
      const extras = await Promise.all(
        extraShots.slice(0, MAX_RETAKE_PHOTOS - 1).map(async (s) => ({
          base64: await blobToBase64(s.blob),
          mime: s.blob.type || "image/jpeg",
        })),
      );
      const res = await submit({
        data: {
          photo_base64: base64,
          photo_mime: blob.type || "image/jpeg",
          ...(extras.length ? { extra_photos: extras } : {}),
          lat: finalCoords?.lat ?? null,
          lng: finalCoords?.lng ?? null,
          logged_in_user_id: user?.id, // 传递登录用户 ID
          retake_count: retakeCtx?.count ?? 0,
          species_hint_title: retakeCtx?.title,
          species_hint_sci: retakeCtx?.sci,
          merge_draft_id: retakeCtx?.mergeDraftId,
          photo_sha256: photoSha256 ?? undefined,
        },
      });
      toast.success("已生成简介摘要卡，正在跳转…");
      goToDraft((res as { draftId: string }).draftId);
    } catch (e) {
      // ── 断线自愈 ────────────────────────────────────────────────────────────
      // 识别是个**有副作用的写操作**：服务端跑完就把草稿写进库了。而网络层失败只说明
      // 「响应没回来」，完全不说明「事情没做成」—— 线上真实案例是等到 101 秒（Cloudflare
      // 边缘响应上限）连接被掐，前端报「识别失败」，用户重点一次却立刻弹「这张照片已经
      // 识别过」：后台早就成功了。所以报错之前，先拿照片指纹回查一次。
      let checked: boolean | undefined;
      if (isNetworkError(e) && photoSha256) {
        setRecoverNote("连接断了，正在确认识别是否已经完成…");
        const hitId = await findDraftAfterDisconnect(photoSha256);
        if (hitId) {
          toast.success("识别其实已经完成了，正在跳转…");
          goToDraft(hitId);
          return; // ← 不报错：这次是成功的
        }
        checked = true; // 回查过、确实没有 → 让文案告诉用户可以放心重试
      } else if (isNetworkError(e)) {
        checked = false; // 没指纹可查（算 hash 失败）→ 文案要提醒用户先去草稿列表看看
      }
      setRecoverNote(null);
      setPhase("captured");
      setErrorKind(checked === true ? "no-result" : checked === false ? "unknown" : "failed");
      const msg = explainError(e, {
        elapsedMs: Date.now() - startedAt,
        sizeBytes: blob.size,
        action: "识别",
        serverStateChecked: checked,
      });
      setErrorMsg(msg);
      toast.error(msg, { duration: 12000 });
    }
  };

  /** 成功收尾：清缓存 → 标记「刚识别完」→ 跳转。正常路径与断线自愈路径共用，
   *  免得自愈少做一步（比如忘了清缓存）而出现「跳过去还是旧草稿」这种二次 bug。 */
  const goToDraft = (draftId: string) => {
    // 补拍合并回同一份草稿时，/drafts/$id 会命中 React Query 缓存（staleTime=5min、
    // 不 refetchOnWindowFocus）→ 页面渲染的是**补拍前**的旧草稿：retake_count 还是 0、
    // ai_payload 还是上一轮的「疑似」。分享卡是 draft 一到就自动生成的，于是「本轮铜叶 +N」
    // 按 N=1 画出去、关卡后的补拍横幅也倒回「第一次补拍」。必须先把缓存丢掉，让页面拿新数据。
    // leaves 同理：本轮铜叶刚变，叶章统计不能用旧值。
    qc.removeQueries({ queryKey: ["draft", draftId] });
    if (user?.id) qc.removeQueries({ queryKey: ["leaves", user.id] });

    // Signal the draft page to auto-open the share card as the first screen.
    try {
      sessionStorage.setItem("plantspedia:justIdentified", draftId);
    } catch {
      /* private mode / storage disabled — the card still opens via the button */
    }
    navigate({ to: "/drafts/$id", params: { id: draftId } });
  };

  /**
   * 连接断了之后，回查服务端到底有没有把这次识别写成草稿。
   *
   * 为什么要**退避重查几次**而不是查一次就下结论：连接被掐的那一刻，服务端多半还在
   * 收尾（写库、补 retake_count/user_photos 那几个 best-effort 更新）。立刻查很可能扑空，
   * 而它两三秒后就写进去了 —— 只查一次等于把「其实成功了」误判成失败，正是要修的那个 bug。
   *
   * 总共约 26 秒。真失败的用户要多等这段时间才看到错误文案，换回的是不必白烧一整轮模型。
   */
  const findDraftAfterDisconnect = async (hash: string): Promise<string | null> => {
    const waits = [0, 3000, 8000, 15000];
    for (const w of waits) {
      if (w) await new Promise((r) => setTimeout(r, w));
      try {
        const hit = await findDuplicate({ data: { hash } });
        if (hit) return hit.draftId;
      } catch {
        /* 回查本身也可能因为同一个弱网失败 —— 继续下一轮，别就此判死 */
      }
    }
    return null;
  };

  return (
    <div className="max-w-md mx-auto w-full bg-paper-deep/35 border border-rule/70 p-4 md:p-5 rounded-3xl shadow-lg mb-12 select-none animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* 「这张照片已经识别过」——省掉一次完全重复的识别（也省一次模型调用）。
          刻意做成必须选一个的弹窗而不是 toast：默认行为选错了代价不对称——误跳走只是多点一下，
          误重复识别则是白等一轮 + 库里多一条重复草稿。 */}
      {dupHit && (
        <div
          className="fixed inset-0 z-[90] bg-black/70 flex items-center justify-center p-4"
          onClick={() => setDupHit(null)}
        >
          <div
            className="bg-background border border-ink shadow-xl w-full max-w-sm p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="label text-leaf-deep mb-1">这张照片已经识别过</p>
            <p className="text-[12px] text-ink-faint mb-4 leading-relaxed">
              你之前用同一张照片识别过
              {dupHit.title ? <strong className="text-ink">「{dupHit.title}」</strong> : "一次"}。
              可以直接去看那份简介摘要卡，不必再等一轮识别。
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => {
                  const to = dupHit.draftId;
                  setDupHit(null);
                  navigate({ to: "/drafts/$id", params: { id: to } });
                }}
                className="w-full border border-leaf-deep/60 text-leaf-deep px-4 py-2.5 text-sm font-semibold hover:bg-leaf-deep hover:text-background transition-colors cursor-pointer rounded-sm"
              >
                是，去看已有的简介摘要卡
              </button>
              <button
                onClick={() => {
                  const h = dupHit.hash;
                  setDupHit(null);
                  void runIdentify(h);
                }}
                className="w-full border border-rule text-ink-soft px-4 py-2.5 text-sm hover:border-ink hover:text-ink transition-colors cursor-pointer rounded-sm"
              >
                否，再识别一次
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Safety notice — always visible above the viewfinder. AI identifications are
          not a food/medicinal-use authority; keep this prominent and bold. */}
      <p className="text-center text-sm font-bold text-leaf-deep mb-3 leading-snug px-2">
        AI 识别内容不能采纳为食用药用参考！
      </p>

      {/* Retake mode — arrived from a draft's「去补拍」. Show what we're re-checking and
          a one-tap camera button (fallback when the auto-open was blocked). */}
      {retakeMode && phase === "idle" && (
        <div className="mb-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-center space-y-2">
          <p className="text-sm font-semibold text-amber-700 leading-snug">
            正在补拍复核{retakeCtx?.title ? `「${retakeCtx.title}」` : ""}（{retakeOrdinal(retakeCtx?.count ?? 1)}）
          </p>
          {visualAdvice && (
            <div className="text-left mx-auto max-w-[300px] rounded-lg bg-background/60 border border-amber-500/25 px-2.5 py-2">
              <p className="text-[11px] font-semibold text-amber-700 mb-0.5">上次识别建议补拍：</p>
              <p className="text-[11px] text-ink-soft leading-relaxed whitespace-pre-line">{visualAdvice}</p>
            </div>
          )}
          <p className="text-[11px] text-ink-faint leading-relaxed">
            请对准<strong>同一株植物</strong>按上面建议补拍更清晰的照片，
            <strong>尽量不要同时拍到多种植物</strong>。本次
            <strong>最多可拍 / 上传 {MAX_RETAKE_PHOTOS} 张不同角度</strong>
            一起识别（整株 / 叶 / 花果各一张最理想），选好第一张后可继续添加，点「AI识别」一并提交。
            {(retakeCtx?.count ?? 0) >= 3 && "本次为第 3 次补拍，将直接给出最终结论。"}
          </p>
          {/* 补拍的**唯一**两个入口：现拍 or 用相册里已有的照片。两条路都走同一个 onSubmit，
              都按 retakeCtx.count 记作这一次补拍（次数来自上下文，与照片来源无关）。
              下面的取景框在补拍时是藏起来的 —— 两处都能点会让人不知道该点哪个。 */}
          <div className="flex flex-col gap-2 pt-0.5">
            <button
              onClick={openCamera}
              className="inline-flex items-center justify-center gap-1.5 bg-amber-600 text-background px-5 py-2.5 text-sm font-semibold rounded-full hover:bg-amber-500 transition-colors cursor-pointer"
            >
              <CameraIcon className="w-4 h-4" />
              打开相机补拍
            </button>
            <button
              onClick={openAlbum}
              className="inline-flex items-center justify-center gap-1.5 border border-amber-600 text-amber-700 px-5 py-2.5 text-sm font-semibold rounded-full hover:bg-amber-600 hover:text-background transition-colors cursor-pointer"
            >
              <GalleryIcon className="w-4 h-4" />
              上传相册补拍
            </button>
          </div>
          <p className="text-[10px] text-ink-faint">两种方式都记作一次补拍（{retakeOrdinal(retakeCtx?.count ?? 1)}）</p>
        </div>
      )}

      {/* 1. Viewfinder area — outer centers the frame so a portrait shot stays
          centred; the inner frame's border hugs the real image 画幅. */}
      <div className={`w-full flex justify-center ${hideViewfinder ? "hidden" : ""}`}>
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
                建议尽量使照片清晰且主体突出。拍摄时会请求定位，用于记录分布地图。
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
                    {/* 连接断了但正在回查时，换一套文案 —— 这时候再滚「AI 深度分析中」是撒谎，
                        而直接报「识别失败」又往往是误报（服务端多半已经写完库了）。 */}
                    <p className="text-xs font-bold text-vermilion tracking-widest uppercase">
                      {recoverNote ? "正在确认结果" : "AI 深度分析中"}
                    </p>
                    <p className="text-xs text-ink-soft font-medium min-h-[36px] flex items-center justify-center px-2">
                      {recoverNote ?? LOADING_STEPS[stepIndex]}
                    </p>
                    {recoverNote && (
                      <p className="text-[10px] text-ink-faint leading-relaxed px-1 pt-0.5">
                        请稍候，先别重新识别 —— 后台可能已经跑完了
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </div>

      {/* 补拍多角度：主图选好后，最多再加 2 张同一株植物的其它角度，同一次请求一起识别。
          多角度是提准最实在的一招——Pl@ntNet 官方就按多图综合打分，视觉模型也一次看全。
          只在补拍模式出现：首次识别时用户还不知道该拍哪里，先要照片只是徒增负担。 */}
      {retakeMode && phase !== "idle" && (
        <div className="mt-3 rounded-2xl border border-leaf/35 bg-leaf/5 px-3 py-2.5 space-y-2">
          <p className="text-[11px] font-semibold text-leaf-deep leading-snug">
            本次将同时识别 <span className="tabular-nums">{extraShots.length + 1}</span> 张照片
            {extraShots.length + 1 < MAX_RETAKE_PHOTOS && (
              <span className="font-normal text-ink-faint">
                （还可再加 {MAX_RETAKE_PHOTOS - 1 - extraShots.length} 张，多角度更容易定到种）
              </span>
            )}
          </p>

          {/* 缩略图条：第一张是主图（不可删——删了就没得识别了），后面是可删的角度照 */}
          <div className="flex items-center gap-2 flex-wrap">
            {previewUrl && (
              <div className="relative w-14 h-14 rounded-lg overflow-hidden border border-leaf/40 shrink-0">
                <img src={previewUrl} alt="主图" className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-ink/70 text-background text-[9px] text-center leading-[13px]">
                  主图
                </span>
              </div>
            )}
            {extraShots.map((s, i) => (
              <div
                key={s.url}
                className="relative w-14 h-14 rounded-lg overflow-hidden border border-rule shrink-0"
              >
                <img src={s.url} alt={`角度照 ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  onClick={() => removeExtra(i)}
                  disabled={phase === "submitting"}
                  title="移除这张"
                  className="absolute top-0 right-0 w-5 h-5 bg-ink/75 text-background text-[13px] leading-[20px] text-center hover:bg-destructive transition-colors cursor-pointer disabled:opacity-50"
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          {extraShots.length + 1 < MAX_RETAKE_PHOTOS && phase !== "submitting" && (
            <div className="flex gap-2">
              <button
                onClick={addExtraFromCamera}
                className="flex-1 inline-flex items-center justify-center gap-1 border border-leaf/50 text-leaf-deep px-2 py-1.5 text-[11px] font-semibold rounded-full hover:bg-leaf-deep hover:text-background transition-colors cursor-pointer"
              >
                <CameraIcon className="w-3.5 h-3.5" />
                再拍一张
              </button>
              <button
                onClick={addExtraFromAlbum}
                className="flex-1 inline-flex items-center justify-center gap-1 border border-leaf/50 text-leaf-deep px-2 py-1.5 text-[11px] font-semibold rounded-full hover:bg-leaf-deep hover:text-background transition-colors cursor-pointer"
              >
                <GalleryIcon className="w-3.5 h-3.5" />
                从相册加一张
              </button>
            </div>
          )}
          <p className="text-[10px] text-ink-faint leading-relaxed">
            请都拍<strong>同一株植物</strong>的不同部位（如整株 / 叶 / 花或果），不要混入别的植物。
            拍好后点下方「AI识别」一起提交。
          </p>
        </div>
      )}

      {/* Idle: let the user grant location BEFORE opening the camera. Tapping here is
          a real user gesture, which is the only reliable way to make Chrome iOS show
          its permission prompt. */}
      {phase === "idle" && permState !== "granted" && (
        <div className="mt-3">
          {permState === "denied" ? (
            <div className="text-xs bg-amber-500/10 border border-amber-500/40 rounded-xl px-3 py-2 space-y-1">
              <p className="flex items-center gap-1.5 font-semibold text-amber-700">
                <MapPinIcon className="w-3.5 h-3.5 shrink-0" />
                本站的定位权限已被拒绝
              </p>
              <p className="text-[11px] text-ink-faint leading-relaxed">
                浏览器不允许网页再次弹出授权框，需手动开启：Chrome 右下角 ⋯ → 设置 → 内容设置 → 位置信息 →
                允许 plantspedia.club；并确认 iOS 设置 → 隐私与安全性 → 定位服务 → Chrome 为「使用 App 期间」。
              </p>
            </div>
          ) : (
            <>
              <button
                onClick={requestGeo}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-ink-soft bg-paper-deep/40 hover:bg-paper-deep/70 border border-rule/50 rounded-xl px-3 py-2 transition-colors cursor-pointer"
              >
                <MapPinIcon className="w-3.5 h-3.5 text-vermilion shrink-0" />
                {geoStatus === "loading" ? "正在获取位置…" : geoStatus === "timeout" ? "定位无响应，点此重试" : "开启定位（记录这株植物的位置）"}
              </button>
              {geoStatus === "timeout" && (
                <p className="mt-1.5 text-[11px] text-amber-700 leading-relaxed">
                  一直转圈通常是 iOS 关掉了定位：请打开 iOS 设置 → 隐私与安全性 → 定位服务，确认总开关已开、且 Chrome 设为「使用 App 期间」并开启「精确位置」，再点上方按钮重试。
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Identify failure — stays on screen with the full cause + next step, so the
          user isn't left with a vanished toast saying only "429". */}
      {phase === "captured" && errorMsg && (
        <div className="mt-3 rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-destructive">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
            </svg>
            {errorKind === "failed"
              ? "识别失败"
              : errorKind === "no-result"
                ? "识别未完成（已确认库里没有结果）"
                : "未收到结果（可能已完成）"}
          </p>
          {/* whitespace-pre-line：网络类报错是「原因 ①②③」多行文案，不换行会挤成一团 */}
          <p className="mt-1 text-xs text-ink-soft leading-relaxed whitespace-pre-line">{errorMsg}</p>
          <button
            onClick={() => setErrorMsg(null)}
            className="mt-1.5 text-[11px] text-ink-faint hover:text-vermilion underline underline-offset-2 cursor-pointer"
          >
            知道了
          </button>
        </div>
      )}

      {/* Location status — only while reviewing a captured shot. Keeps the GPS
          state visible and gives a one-tap re-acquire so a mistaken "deny" isn't
          a dead end. */}
      {phase === "captured" && (
        <div className="mt-3">
          {geoStatus === "loading" || geoRequested ? (
            <div className="flex items-center gap-2 text-xs text-ink-soft bg-paper-deep/40 border border-rule/50 rounded-xl px-3 py-2">
              <span className="w-3.5 h-3.5 rounded-full border-2 border-rule/30 border-t-vermilion animate-spin shrink-0" />
              正在获取拍摄位置…
            </div>
          ) : coords ? (
            <div className="flex items-center gap-2 text-xs text-leaf-deep bg-leaf/10 border border-leaf/30 rounded-xl px-3 py-2">
              <MapPinIcon className="w-3.5 h-3.5 text-leaf-deep shrink-0" />
              <span className="tabular-nums">已获取位置 {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}</span>
              <button
                onClick={requestGeo}
                className="ml-auto text-[11px] text-ink-faint hover:text-vermilion underline underline-offset-2 cursor-pointer"
              >
                重新获取
              </button>
            </div>
          ) : (
            <div className="text-xs bg-amber-500/10 border border-amber-500/40 rounded-xl px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-2 text-amber-700">
                <MapPinIcon className="w-3.5 h-3.5 shrink-0" />
                <span className="font-semibold">未获取到拍摄位置</span>
                <button
                  onClick={requestGeo}
                  className="ml-auto px-2 py-0.5 rounded-full border border-amber-500/60 text-amber-700 hover:bg-amber-500 hover:text-background transition-colors text-[11px] font-medium cursor-pointer"
                >
                  开启定位
                </button>
              </div>
              <p className="text-[11px] text-ink-faint leading-relaxed">
                {geoStatus === "unavailable"
                  ? "此浏览器不支持定位。"
                  : geoStatus === "timeout"
                    ? "定位无响应（一直转圈）——十有八九是 iOS 关掉了定位。请打开 iOS 设置 → 隐私与安全性 → 定位服务：确认总开关已开，且 Chrome 一项设为「使用 App 期间」并打开「精确位置」，然后回来点「开启定位」。"
                    : permState === "denied"
                      ? "本站定位权限已被拒绝，浏览器不会再弹授权框。请到 Chrome ⋯ → 设置 → 内容设置 → 位置信息中允许本站，再确认 iOS 设置 → 隐私与安全性 → 定位服务 → Chrome 为「使用 App 期间」。"
                      : "地点对识别与分布地图很重要。点「开启定位」后应会弹出授权框；若无反应，请检查 Chrome 与 iOS 的定位权限。"}
              </p>
            </div>
          )}

          {/* Save original to album — web can't auto-save the camera roll, so offer
              it explicitly. Lets the user keep the shot to re-identify later if the
              signal is bad here. */}
          <button
            onClick={saveToAlbum}
            className="mt-2 w-full flex items-center justify-center gap-1.5 text-xs text-ink-soft bg-paper-deep/40 hover:bg-paper-deep/70 border border-rule/50 rounded-xl px-3 py-2 transition-colors cursor-pointer"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            保存原图到相册（信号不好时可稍后重新上传识别）
          </button>
        </div>
      )}

      {/* 2. Control bar — hidden alongside the viewfinder while a retake is waiting for
          a photo (the two banner buttons are the only entry point then). */}
      <div className={`mt-4 pt-2 ${hideViewfinder ? "hidden" : ""}`}>
        {phase === "idle" ? (
          <div className="flex items-center justify-between px-6">
            {/* Gallery Upload Button */}
            <button
              onClick={openAlbum}
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
      {/* 补拍时相册可一次多选（主图 + 最多 2 张角度照）；首次识别仍是单选——那时只收一张。 */}
      <input
        type="file"
        ref={albumInputRef}
        accept="image/*"
        multiple={retakeMode}
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
