import { useState } from "react";
import type { PlantEdit } from "@/lib/edits";

const KIND_LABEL: Record<string, string> = {
  text: "修改文字",
  image: "更换配图",
  html_save: "编辑正文",
  revert: "撤销修改",
  create: "创建条目",
  branch: "建立分支",
  merge: "合并",
  catalog_create: "新建名录",
  catalog_append: "补充名录",
  tag_create: "新建标签",
  draft_text: "修改文字",
  draft_image: "更换配图",
  draft_approve: "收录",
  draft_reject: "驳回",
  ai_page_edit: "小P蛙改写",
  blog_publish: "发布博文",
};

function kindLabel(k: string) {
  return KIND_LABEL[k] ?? "修改";
}

function fmt(ts: string) {
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return ts;
  }
}

/**
 * Collapsible 修改记录 (change log) shown at the bottom of a species page (AI draft
 * or published detail). Lists every change (editor- or 小P蛙-made), newest first.
 * Default collapsed. Only editors see the per-row 撤销 button (`onRevert`); a row is
 * revertable when it carries a snapshot or is a known block edit, and isn't already reverted.
 */
export function EditLogSection({
  edits,
  isEditor,
  onRevert,
  reverting,
  defaultOpen = false,
}: {
  edits: PlantEdit[];
  isEditor: boolean;
  onRevert?: (edit: PlantEdit) => void;
  reverting?: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const canRevert = (e: PlantEdit) =>
    isEditor &&
    !!onRevert &&
    e.kind !== "revert" &&
    !e.reverted &&
    (!!e.before_html || ["text", "image", "html_save"].includes(e.kind));

  return (
    <section className="mt-10 border-t border-rule pt-4">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 text-left cursor-pointer group"
        aria-expanded={open}
      >
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-ink-faint transition-transform ${open ? "rotate-90" : ""}`}
          aria-hidden="true"
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className="label text-vermilion">修改记录 · Change log</span>
        <span className="text-xs text-ink-faint">（{edits.length}）</span>
        <span className="ml-auto text-[11px] text-ink-faint group-hover:text-ink">
          {open ? "收起" : "展开"}
        </span>
      </button>

      {open && (
        <div className="mt-3">
          {edits.length === 0 ? (
            <p className="text-xs text-ink-faint py-4">暂无修改记录。</p>
          ) : (
            <ul className="divide-y divide-rule-soft border-y border-rule">
              {edits.map((e) => (
                <li key={e.id} className="py-2.5 flex items-start gap-3 text-sm">
                  <span
                    className={`mt-0.5 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                      e.kind === "ai_page_edit" || e.source === "xiaop_agent"
                        ? "border-leaf/50 text-leaf-deep bg-leaf/10"
                        : "border-rule text-ink-faint"
                    }`}
                  >
                    {e.kind === "ai_page_edit" || e.source === "xiaop_agent" ? "小P蛙" : kindLabel(e.kind)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-ink leading-snug break-words">
                      {e.summary || kindLabel(e.kind)}
                      {e.reverted && <span className="ml-2 text-[10px] text-ink-faint">（已撤销）</span>}
                    </p>
                    <p className="text-[11px] text-ink-faint mt-0.5">
                      {e.editor_name || "—"} · {fmt(e.created_at)}
                    </p>
                  </div>
                  {canRevert(e) && (
                    <button
                      onClick={() => onRevert!(e)}
                      disabled={reverting === e.id}
                      className="shrink-0 text-[11px] text-destructive hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      {reverting === e.id ? "撤销中…" : "撤销"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!isEditor && edits.length > 0 && (
            <p className="text-[11px] text-ink-faint mt-2">仅编辑可撤销修改。</p>
          )}
        </div>
      )}
    </section>
  );
}
