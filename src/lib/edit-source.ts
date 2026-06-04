// Identifiers describing how an edit was made.
// Stored verbatim in plant_edits.source so the edits log can show whether a
// change came from the in-page HTML editor, a form, a batch upload, or an
// AI model running on a specific deployment platform.

export const SOURCE_HTML_EDITOR = "html_editor";
export const SOURCE_PLANT_EDITOR = "plant_editor";
export const SOURCE_BATCH_UPLOAD = "batch_upload";
export const SOURCE_CATALOG_EDITOR = "catalog_editor";
export const SOURCE_TAG_EDITOR = "tag_editor";
export const SOURCE_BLOG_EDITOR = "blog_editor";

// AI-driven edits encode the model + platform so the log can read e.g.
// "AI · google/gemini-3-flash-preview @ lovable-ai (目录补充)".
export function aiSource(opts: {
  model: string;
  platform: string; // e.g. "lovable-ai", "openai", "supabase-edge"
  via?: string; // optional entry-point suffix, e.g. "catalog_editor"
}) {
  const tag = `ai:${opts.model}@${opts.platform}`;
  return opts.via ? `${tag}+${opts.via}` : tag;
}

export type EditSourceParts = {
  ai: { model: string; platform: string } | null;
  via: string | null;
};

export function parseSource(raw: string | null | undefined): EditSourceParts {
  if (!raw) return { ai: null, via: null };
  const [head, tail] = raw.split("+");
  if (head.startsWith("ai:")) {
    const body = head.slice(3);
    const at = body.lastIndexOf("@");
    const model = at === -1 ? body : body.slice(0, at);
    const platform = at === -1 ? "" : body.slice(at + 1);
    return { ai: { model, platform }, via: tail ?? null };
  }
  return { ai: null, via: head };
}

const VIA_LABEL: Record<string, string> = {
  html_editor: "HTML 编辑器",
  plant_editor: "条目表单",
  batch_upload: "批量上传",
  catalog_editor: "地区目录编辑",
  tag_editor: "标签管理",
  blog_editor: "博客编辑器",
};

export function sourceLabel(raw: string | null | undefined): string {
  const { ai, via } = parseSource(raw);
  const viaText = via ? VIA_LABEL[via] ?? via : "";
  if (ai) {
    const head = `AI · ${ai.model}${ai.platform ? ` @ ${ai.platform}` : ""}`;
    return viaText ? `${head}（${viaText}）` : head;
  }
  return viaText || "—";
}

export function sourceIsAI(raw: string | null | undefined): boolean {
  return parseSource(raw).ai !== null;
}