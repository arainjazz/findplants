import { useCallback, useEffect, useRef } from "react";

/**
 * 编辑器的「未保存内容」本地快照。
 *
 * 解决的问题：博客 / 项目编辑器写到一半误刷新、误点返回、手机切后台被回收，内容**直接
 * 就没了** —— 这两个编辑器既没有本地暂存也没有离开提醒，而一篇调研成果可能是坐着写了
 * 一小时的东西。植物编辑器（plant-editor.tsx）早就有这套逻辑，这里把它抽出来复用，
 * 免得第三个编辑器又抄一遍抄歪。
 *
 * 三条关键约定，改的时候别破坏：
 *
 * 1. **恢复必须在 effect 里做，不能在渲染期读 localStorage**。这些编辑器挂在
 *    `_authenticated` 下、照样走 SSR：服务端渲染出来的是空表单，客户端首次渲染若直接
 *    读出草稿填进受控输入框，两边对不上就是一次 hydration mismatch。放进 effect 里
 *    等水合完成之后再改状态，是干净的。
 *
 * 2. **只在快照比库里的版本新时才恢复**（`savedAt > dbUpdatedAt`）。否则在别处保存过
 *    之后再回来编辑，会被一份更旧的本地残留悄悄覆盖 —— 那是比丢内容更糟的一类 bug。
 *
 * 3. **保存成功后必须 `clear()`**。留着的话下次打开又会「恢复」出一份和库里一模一样的
 *    内容，还白弹一条提示。
 */
export function useEditorDraft<T extends Record<string, unknown>>({
  key,
  dbUpdatedAt,
  baseline,
  snapshot,
  onRestore,
}: {
  /** 每份内容一个键，务必带上 id（新建用 "new"），否则两篇文章会互相串。 */
  key: string;
  /** 库里这份内容的 `updated_at`。新建时传 undefined。 */
  dbUpdatedAt?: string | null;
  /**
   * 「这份草稿是基于哪个版本改的」。传了就会连同草稿一起存，恢复时**必须仍然相等**
   * 才认；对不上说明库里那份在别处被改过（或被重置过），草稿已经过时，直接丢掉。
   *
   * 给**没有 `updated_at` 可比**的内容用 —— 「关于本站」的章节就是这样，整页作为一个
   * JSON 存在 site_config 里，单个章节没有自己的时间戳。传它比传 dbUpdatedAt 更准：
   * 比的是内容本身，不是两个时钟。两者可以只传其一。
   */
  baseline?: string;
  /** 当前表单的全部字段。每次变化都会写进 localStorage。 */
  snapshot: T;
  /** 命中更新的草稿时回调，把字段填回表单。只会被调用一次。 */
  onRestore: (draft: Partial<T>) => void;
}): { clear: () => void } {
  const hydratedRef = useRef(false);
  // onRestore 每次渲染都是新函数；放进 ref，免得它把恢复 effect 反复拉起来重跑。
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const clear = useCallback(() => {
    try {
      localStorage.removeItem(key);
    } catch {
      /* 隐私模式 / 存储被禁：本来就没存上，无所谓 */
    }
  }, [key]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return;
      const draft = JSON.parse(raw) as Partial<T> & { savedAt?: number; baseline?: string };
      const dbTime = dbUpdatedAt ? new Date(dbUpdatedAt).getTime() : 0;
      // 快照不比库里新 → 说明这份编辑早就存进去了，本地这份是残留，丢掉。
      if (!draft.savedAt || draft.savedAt <= dbTime) {
        localStorage.removeItem(key);
        return;
      }
      // 底本对不上 → 库里那份在别处被改过，草稿基于的已经不是现在这个版本，丢掉。
      if (baseline !== undefined && draft.baseline !== baseline) {
        localStorage.removeItem(key);
        return;
      }
      onRestoreRef.current(draft);
    } catch {
      /* 存的是坏 JSON / 读不到 storage：当作没有草稿，绝不因此把编辑器搞崩 */
    } finally {
      // 无论有没有恢复到东西，从这一刻起开始写快照。
      hydratedRef.current = true;
    }
  }, [key, dbUpdatedAt, baseline]);

  // 依赖数组盯的是**内容**而不是 snapshot 对象的引用 —— 后者每次渲染都是新的，
  // 直接放进 deps 等于每渲染一次写一次 localStorage。
  const serialized = JSON.stringify(snapshot);
  useEffect(() => {
    // 还没走完恢复那一步就写，会拿初始空表单把真正的草稿冲掉。
    if (!hydratedRef.current) return;
    try {
      localStorage.setItem(key, JSON.stringify({ ...snapshot, savedAt: Date.now(), baseline }));
    } catch {
      /* 超配额 / 隐私模式：存不下就算了，不打扰正在写东西的人 */
    }
    // snapshot 的内容变化已经由 serialized 表达；把对象本身放进来会让 effect 每渲染必跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, serialized]);

  return { clear };
}
