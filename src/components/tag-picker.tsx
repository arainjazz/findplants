import { useEffect, useMemo, useRef, useState } from "react";
import { Tag as TagIcon, Plus, X, Check } from "lucide-react";
import { fetchAllTags, createTag, type TagWithCount } from "@/lib/tags";
import { useAuth } from "@/hooks/use-auth";

// ─── 「手动添加 #tag 标签」选择器 ────────────────────────────────────────────
//
// 起因：简介摘要卡的学名下面已经有一排自动识别出来的特征词（盐生植物 / 多年生草本 /
// halophyte…），而摘要下面又把**同一批词**原样铺一遍 `#盐生植物 #多年生草本 …`。
// 同一屏出现两次，下面那排还什么都点不了 —— 纯噪音。
//
// 换成这个选择器。**核心规则：只能从已建好的标签里选，不能自己敲名字。**
// 为什么这么定：标签是用来把条目归拢成专题的（`tags` 表 + `plant_tags` 关联），
// 人人自由输入会立刻长出「盐生植物 / 盐生 / 耐盐植物」三个各挂两条的僵尸标签，
// 专题页就废了。要新标签走 `allowCreate`（只给编辑用），走 createTag 正式建一个。

type Props = {
  /** 已选中的标签**名字**（草稿/条目的 tags 是 text[]，存名字不存 id）。 */
  value: string[];
  onChange: (next: string[]) => void;
  /** 允许就地新建标签。只在编辑器里开 —— 访客不该能凭空造标签。 */
  allowCreate?: boolean;
  /** 按钮文案，默认「手动添加 #tag 标签」。 */
  label?: string;
  /** 紧凑模式（简介卡里用）。 */
  compact?: boolean;
  disabled?: boolean;
  /**
   * 每次拉到（或新建后重拉）标签全表都会回调一次。
   * 给需要「名字 → id」的调用方用（plant-editor 存的是 tag id）：新建标签后
   * onChange 会紧接着带上新名字，调用方得先拿到含新标签的列表才能查出 id。
   */
  onTagsLoaded?: (tags: TagWithCount[]) => void;
};

export function TagPicker({
  value,
  onChange,
  allowCreate = false,
  label = "手动添加 #tag 标签",
  compact = false,
  disabled = false,
  onTagsLoaded,
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [all, setAll] = useState<TagWithCount[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  // 回调放进 ref：直接进 useEffect 依赖会让每次父组件重渲染都重跑一遍拉取。
  const onLoadedRef = useRef(onTagsLoaded);
  onLoadedRef.current = onTagsLoaded;

  // 标签列表只在**第一次打开**时拉，不在 mount 时拉 —— 简介卡是识别完自动弹的，
  // 那一刻页面已经在并发好几个查询，没必要为一个可能永远不点的按钮再加一条。
  useEffect(() => {
    if (!open || all.length || loading) return;
    setLoading(true);
    fetchAllTags()
      .then((list) => {
        setAll(list);
        onLoadedRef.current?.(list);
      })
      .catch(() => setErr("标签列表加载失败"))
      .finally(() => setLoading(false));
  }, [open, all.length, loading]);

  // 点外面关掉。
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const selected = useMemo(() => new Set(value), [value]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((t) => t.name.toLowerCase().includes(q));
  }, [all, filter]);

  const toggle = (name: string) => {
    if (selected.has(name)) onChange(value.filter((v) => v !== name));
    else onChange([...value, name]);
  };

  const doCreate = async () => {
    const name = newName.trim();
    if (!name || !user) return;
    setErr(null);
    try {
      await createTag(
        { name, description: "" },
        user.id,
        user.user_metadata?.display_name ?? user.email ?? "编辑",
      );
      const fresh = await fetchAllTags();
      setAll(fresh);
      // ⚠️ 必须在 onChange **之前**同步告知调用方新列表：按 id 存标签的调用方
      // （plant-editor）要靠它才能把下面这个新名字解析成 id。
      onLoadedRef.current?.(fresh);
      setNewName("");
      setCreating(false);
      // 新建完直接挂上 —— 编辑点「新建」十有八九就是要给当前这条用。
      if (!selected.has(name)) onChange([...value, name]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "新建标签失败");
    }
  };

  return (
    <div className="relative" ref={boxRef}>
      <div className={`flex flex-wrap items-center ${compact ? "gap-1.5" : "gap-2"}`}>
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-full bg-vermilion/10 text-vermilion border border-vermilion/30 px-2.5 py-0.5 text-xs"
          >
            #{name}
            {!disabled && (
              <button
                type="button"
                onClick={() => toggle(name)}
                className="hover:text-ink transition-colors"
                aria-label={`移除标签 ${name}`}
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            // 黑底白字（bg-ink / text-background）—— 用户指定。同一个按钮同时出现在
            // 简介摘要卡和 skill 详页编辑器里，两处必须长得一模一样，否则会被当成
            // 两个不同的功能。
            className={`inline-flex items-center gap-1.5 rounded-full bg-ink text-background hover:bg-vermilion transition-colors ${
              compact ? "px-2.5 py-1 text-xs" : "px-3 py-1.5 text-sm"
            }`}
          >
            <TagIcon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            {label}
          </button>
        )}
      </div>

      {open && (
        <div className="absolute z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-rule bg-background shadow-lg">
          <div className="border-b border-rule p-2">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="筛选已有标签…"
              className="w-full border border-rule px-2 py-1 text-xs outline-none focus:border-ink"
            />
            {/* 这个框只筛选、**不创建**。输入什么都不会变成新标签。 */}
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {loading && <p className="p-2 text-xs text-ink-faint">加载中…</p>}
            {!loading && !shown.length && (
              <p className="p-2 text-xs text-ink-faint">
                {all.length ? "没有匹配的标签。" : "还没有任何标签。"}
                {allowCreate ? "" : "标签需由编辑在「添加/编辑内容」页创建。"}
              </p>
            )}
            {shown.map((t) => {
              const on = selected.has(t.name);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.name)}
                  className={`flex w-full items-center justify-between px-2 py-1.5 text-left text-xs hover:bg-paper-deep/40 ${
                    on ? "text-vermilion" : "text-ink-soft"
                  }`}
                  title={t.description ?? ""}
                >
                  <span className="truncate">#{t.name}</span>
                  <span className="ml-2 flex shrink-0 items-center gap-1 opacity-60">
                    {t.plant_count}
                    {on && <Check className="h-3 w-3" />}
                  </span>
                </button>
              );
            })}
          </div>

          {allowCreate && user && (
            <div className="border-t border-rule p-2">
              {creating ? (
                <div className="flex items-center gap-1">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void doCreate();
                      }
                      if (e.key === "Escape") setCreating(false);
                    }}
                    placeholder="新标签名"
                    className="min-w-0 flex-1 border border-rule px-2 py-1 text-xs outline-none focus:border-ink"
                  />
                  <button
                    type="button"
                    onClick={() => void doCreate()}
                    className="shrink-0 bg-ink px-2 py-1 text-xs text-background"
                  >
                    建
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreating(true)}
                  className="flex w-full items-center gap-1.5 px-1 py-1 text-xs text-ink-soft hover:text-ink"
                >
                  <Plus className="h-3 w-3" />
                  新建一个标签 #tag
                </button>
              )}
            </div>
          )}
          {err && <p className="border-t border-rule p-2 text-xs text-vermilion">{err}</p>}
        </div>
      )}
    </div>
  );
}
