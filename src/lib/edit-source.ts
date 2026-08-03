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

/**
 * 修改记录里那枚来源徽章的文字。
 *
 * 🔴 **面向读者的这一行不写具体模型名**（用户 2026-07-31）。Log 是公开页面，而模型换得很勤 ——
 * 印在上面的 `google/gemini-x-flash@lovable-ai` 过两个月就是一条错误信息，且对读者毫无意义。
 * `plant_edits.source` 里存的原始串**不动**（溯源要用），只是渲染成中性的「AI 协作」。
 * 需要看真实模型的场合（管理员排查、用量对账）请用下面的 sourceLabelDetailed()。
 */
export function sourceLabel(raw: string | null | undefined): string {
  const { ai, via } = parseSource(raw);
  const viaText = via ? (VIA_LABEL[via] ?? via) : "";
  if (ai) {
    return viaText ? `AI 协作（${viaText}）` : "AI 协作";
  }
  return viaText || "—";
}

/** 带模型 / 平台的完整来源。**仅供管理员视角**，不要用在公开页面上。 */
export function sourceLabelDetailed(raw: string | null | undefined): string {
  const { ai, via } = parseSource(raw);
  const viaText = via ? (VIA_LABEL[via] ?? via) : "";
  if (ai) {
    const head = `AI · ${ai.model}${ai.platform ? ` @ ${ai.platform}` : ""}`;
    return viaText ? `${head}（${viaText}）` : head;
  }
  return viaText || "—";
}

export function sourceIsAI(raw: string | null | undefined): boolean {
  return parseSource(raw).ai !== null;
}
