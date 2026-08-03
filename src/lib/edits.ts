import { supabase } from "@/integrations/supabase/client";

export type EditorApplication = {
  id: string;
  user_id: string;
  email: string;
  bio: string;
  status: "pending" | "approved" | "rejected";
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function fetchApplications(status?: "pending" | "approved" | "rejected") {
  let q = supabase
    .from("editor_applications")
    .select("*")
    .order("created_at", { ascending: false });
  if (status) q = q.eq("status", status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as EditorApplication[];
}

export async function fetchMyApplication(userId: string) {
  const { data, error } = await supabase
    .from("editor_applications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as EditorApplication | null;
}

export async function approveApplication(app: EditorApplication, adminId: string) {
  // 1. grant editor role (idempotent)
  const { error: roleErr } = await supabase
    .from("user_roles")
    .insert({ user_id: app.user_id, role: "editor" });
  // ignore unique conflict
  if (roleErr && !String(roleErr.message).toLowerCase().includes("duplicate")) throw roleErr;

  const { error } = await supabase
    .from("editor_applications")
    .update({
      status: "approved",
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      reject_reason: null,
    })
    .eq("id", app.id);
  if (error) throw error;
}

export async function rejectApplication(app: EditorApplication, adminId: string, reason: string) {
  const { error } = await supabase
    .from("editor_applications")
    .update({
      status: "rejected",
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      reject_reason: reason,
    })
    .eq("id", app.id);
  if (error) throw error;
}

export type PlantEdit = {
  id: string;
  plant_id: string;
  editor_id: string;
  editor_name: string | null;
  kind:
    | "text"
    | "image"
    | "revert"
    | "catalog_create"
    | "catalog_append"
    | "create"
    | "tag_create"
    | "html_save"
    | "branch"
    | "merge"
    | "draft_image"
    | "draft_text"
    | "draft_approve"
    | "draft_reject"
    | "ai_page_edit"
    | "blog_publish"
    | "blog_edit";
  marker_n: number;
  block_path: string | null;
  before_html: string | null;
  after_html: string | null;
  summary: string | null;
  catalog_id: string | null;
  entry_ids: string[] | null;
  source: string | null;
  reverted: boolean;
  reverted_by: string | null;
  reverted_at: string | null;
  adopted?: boolean;
  adopted_by?: string | null;
  adopted_at?: string | null;
  created_at: string;
};

function decodeSnapshotAttr(value: string | null): string | null {
  if (!value) return null;
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"');
}

function cssPath(el: Element | null): string | null {
  if (!el) return null;
  const parts: string[] = [];
  let cur: Element | null = el;
  const root = el.ownerDocument?.body ?? null;
  while (cur && cur !== root) {
    const tag = cur.tagName.toLowerCase();
    const parentEl: HTMLElement | null = cur.parentElement;
    if (!parentEl) break;
    const siblings = (Array.from(parentEl.children) as Element[]).filter(
      (child) => child.tagName === cur!.tagName,
    );
    parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(cur) + 1})`);
    cur = parentEl;
  }
  return parts.join(" > ") || null;
}

// ── Log 分类：创建记录 vs 修改记录 ────────────────────────────────────────────
// 「创建记录」= 产生了一份新内容（新条目 / 新草稿 / 新博文 / 新项目 / 新评论 / 新名录 /
// 新标签）；「修改记录」= 对已有页面的编辑改动。两者在 Log 里点标题切换。

export type LogCategory = "create" | "modify";

const CREATE_KINDS = new Set<PlantEdit["kind"]>([
  "create", // skill 上传/批量创建的植物详页（含金叶一键，source 里区分）
  "catalog_create",
  "tag_create",
  "blog_publish",
  "draft_approve", // 采纳草稿 = 产生了一条正式收录条目
]);

/** Which Log tab an edit row belongs to. Anything not a known creation is a 修改. */
export function logCategory(kind: PlantEdit["kind"]): LogCategory {
  return CREATE_KINDS.has(kind) ? "create" : "modify";
}

/**
 * Creation records that plant_edits does NOT contain, rebuilt from the source tables.
 *
 * Why this exists: `plant_edits.kind` has a narrow DB CHECK constraint that silently
 * rejects blog_publish / draft_* / ai_page_edit rows (the inserts are `.catch`-swallowed),
 * and AI drafts / projects / comments were never logged as edits at all. Verified against
 * the live table: only create / html_save / draft_approve / text / image / draft_reject /
 * merge rows actually exist. So the 创建记录 tab reads the real objects instead of a log
 * that was never written — which also means the history is complete retroactively.
 *
 * Returns PlantEdit-shaped rows (synthetic ids prefixed so they're never mistaken for
 * real log rows — they carry no snapshot and must not offer 撤销).
 */
export type DerivedCreation = PlantEdit & {
  /** Always true — marks a row assembled here rather than read from plant_edits. */
  derived: true;
  /** Where this creation lives, for the row's link. */
  target: { kind: "draft" | "blog" | "project" | "comment" | "plant"; id: string; slug?: string };
};

export async function fetchDerivedCreations(userId?: string): Promise<DerivedCreation[]> {
  const mk = (
    id: string,
    kind: PlantEdit["kind"],
    created_at: string,
    editor_id: string | null,
    editor_name: string | null,
    summary: string,
    target: DerivedCreation["target"],
    source: string | null = null,
  ): DerivedCreation =>
    ({
      id: `derived:${id}`,
      plant_id: target.kind === "plant" ? target.id : "",
      editor_id: editor_id ?? "",
      editor_name,
      kind,
      marker_n: 0,
      block_path: null,
      before_html: null,
      after_html: null,
      summary,
      catalog_id: null,
      entry_ids: null,
      source,
      reverted: false,
      reverted_by: null,
      reverted_at: null,
      created_at,
      derived: true,
      target,
    }) as DerivedCreation;

  const out: DerivedCreation[] = [];
  const only = <T extends { [k: string]: any }>(rows: T[] | null, col: string) =>
    userId ? (rows ?? []).filter((r) => r[col] === userId) : (rows ?? []);

  // AI 识别草稿（= 待审简介卡；未采纳的草稿也算一次创建）
  try {
    const { data } = await supabase
      .from("plant_drafts")
      .select("id,title,created_at,created_by,creator_label,status")
      .order("created_at", { ascending: false });
    for (const d of only(data, "created_by")) {
      out.push(
        mk(
          d.id,
          "create",
          d.created_at,
          d.created_by,
          d.creator_label,
          `AI 识别草稿「${d.title}」`,
          { kind: "draft", id: d.id },
          "ai_identify",
        ),
      );
    }
  } catch {
    /* table/columns missing → skip this source */
  }

  // 博客
  try {
    const { data } = await supabase
      .from("blog_posts")
      .select("id,slug,title,created_at,author_id,author_name,published");
    for (const b of only(data, "author_id")) {
      out.push(
        mk(
          b.id,
          "blog_publish",
          b.created_at,
          b.author_id,
          b.author_name,
          `${b.published ? "发布" : "创建"}博文「${b.title}」`,
          { kind: "blog", id: b.id, slug: b.slug },
        ),
      );
    }
  } catch {
    /* skip */
  }

  // 项目
  try {
    const { data } = await supabase
      .from("projects")
      .select("id,title,created_at,author_id,author_name,published");
    for (const p of only(data, "author_id")) {
      out.push(
        mk(
          p.id,
          "create",
          p.created_at,
          p.author_id,
          p.author_name,
          `${p.published ? "发布" : "创建"}项目「${p.title}」`,
          { kind: "project", id: p.id },
          "project",
        ),
      );
    }
  } catch {
    /* skip */
  }

  // 评论
  try {
    const { data } = await supabase
      .from("plant_comments")
      .select("id,body,created_at,author_id,author_name,plant_id");
    for (const c of only(data, "author_id")) {
      out.push(
        mk(
          c.id,
          "create",
          c.created_at,
          c.author_id,
          c.author_name,
          `发表评论：${String(c.body ?? "").slice(0, 40)}`,
          { kind: "comment", id: c.plant_id },
          "comment",
        ),
      );
    }
  } catch {
    /* skip */
  }

  return out.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

export async function fetchAllEdits() {
  const { data, error } = await supabase
    .from("plant_edits")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const edits = (data ?? []) as PlantEdit[];
  const existingIds = new Set(edits.map((e) => e.id));
  const recovered = await recoverMissingHtmlMarkerEdits(existingIds);
  return [...edits, ...recovered].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

async function recoverMissingHtmlMarkerEdits(existingIds: Set<string>): Promise<PlantEdit[]> {
  const { data: plants } = await supabase
    .from("plants")
    .select("id, html_url")
    .eq("content_type", "html")
    .not("html_url", "is", null)
    .order("updated_at", { ascending: false })
    .limit(20);
  const out: PlantEdit[] = [];
  for (const plant of plants ?? []) {
    try {
      const html = await fetch(plant.html_url as string).then((r) => r.text());
      const doc = new DOMParser().parseFromString(html, "text/html");
      doc.querySelectorAll<HTMLElement>(".lov-edit-mark[data-edit-id]").forEach((mark) => {
        const id = mark.dataset.editId;
        if (!id || existingIds.has(id)) return;
        const tip = mark.getAttribute("data-tip") || "";
        const stamp = tip.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})/);
        const host = mark.closest("[data-edit-mark-host]") as HTMLElement | null;
        const before = decodeSnapshotAttr(mark.getAttribute("data-before-html"));
        const after =
          decodeSnapshotAttr(mark.getAttribute("data-after-html")) ?? host?.outerHTML ?? null;
        out.push({
          id,
          plant_id: plant.id as string,
          editor_id: "",
          editor_name: tip.match(/编辑：([^·\n]+)/)?.[1]?.trim() || "编辑者",
          kind: tip.includes("图片") ? "image" : "text",
          marker_n: Number(mark.dataset.editN || 0),
          block_path: cssPath(host),
          before_html: before,
          after_html: after,
          summary: null,
          catalog_id: null,
          entry_ids: null,
          source: "html_editor",
          reverted: false,
          reverted_by: null,
          reverted_at: null,
          created_at: stamp
            ? `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:00+08:00`
            : new Date().toISOString(),
        });
        existingIds.add(id);
      });
    } catch {
      // Ignore inaccessible historical HTML files; database rows remain authoritative.
    }
  }
  return out;
}

/**
 * Edits authored by a single user — used to scope the 修改记录 page so a
 * non-owner editor only sees their OWN history (including entries an admin has
 * reverted/rejected, which keep editor_id = the original author). Owner (admin)
 * still uses fetchAllEdits. NOTE: this is UI scoping; DB-level enforcement needs
 * the plant_edits SELECT RLS to be tightened (see plan — requires a migration).
 */
export async function fetchEditsForUser(userId: string) {
  const { data, error } = await supabase
    .from("plant_edits")
    .select("*")
    .eq("editor_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PlantEdit[];
}

export async function fetchEditsForPlant(plantId: string) {
  const { data, error } = await supabase
    .from("plant_edits")
    .select("*")
    .eq("plant_id", plantId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PlantEdit[];
}

export type OriginProvenance = {
  /** 最早识别者显示名（登录用户取 display_name，访客草稿取 creator_label）。 */
  identifierName: string;
  /** 识别地点（草稿 capture_place，可能为空）。 */
  place: string | null;
  /** 识别时间（最早那条草稿的 created_at）。 */
  identifiedAt: string;
};

/**
 * 溯源：某「AI 识别条目」最早是由哪位用户、在何地、何时识别的。
 * 采纳草稿后草稿不删除（status→approved, published_plant_id 指向条目），故可回溯。
 * 取指向该条目的最早一条草稿。采纳编辑/时间不在这里取——由页面用现有
 * `plantEdits` 的 `create` 行获得（editor_name 已是解析好的名字，省一次查询）。
 */
export async function fetchOriginProvenance(plantId: string): Promise<OriginProvenance | null> {
  const { data: draft, error } = await supabase
    .from("plant_drafts")
    .select("created_by, creator_label, capture_place, created_at")
    .eq("published_plant_id", plantId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!draft) return null;

  let identifierName = draft.creator_label || "访客";
  if (draft.created_by) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", draft.created_by)
      .maybeSingle();
    if (prof?.display_name) identifierName = prof.display_name;
  }

  return {
    identifierName,
    place: draft.capture_place ?? null,
    identifiedAt: draft.created_at,
  };
}

// ─── 条目的分角色贡献 ────────────────────────────────────────────────────────
//
// 用户 2026-08-01：「合并后还能清晰追溯不同的识别人和生成人」「合并后也是能追溯不同的
// 创建者的贡献」。页尾原来只有一行「创建者 / 共建者」加一行「最早识别」——同一条目被
// 多次补拍、多人识别、再由别人花银叶生成时，这些人全被那一行「最早」盖掉了。
//
// 角色取自三处，互不重叠：
//   · identify —— 每一份指向本条目的来源草稿的创建者（补拍/多人识别就有多条）
//   · enrich   —— 花掉那枚银叶的人（`ai_payload._enriched_by`，2026-08-01 起才记；
//                 存量草稿没有这个字段 → 退回识别人并标 `inferred`，页面上注明「同识别人」）
//   · adopt/merge/edit —— 由页面已有的 `plantEdits` 渲染，不在这里重复查

export type PlantContributorRole = "identify" | "enrich";

export type PlantContributor = {
  role: PlantContributorRole;
  name: string;
  at: string;
  place?: string | null;
  draftId: string;
  /** 存量数据缺字段、由识别人推断出来的 —— 页面必须注明，不能假装是查到的。 */
  inferred?: boolean;
};

/** 一份来源草稿在**结构化字段**上的说法 —— 给矛盾比对用（见 lib/field-conflicts.ts）。 */
export type PlantSourceClaim = {
  draftId: string;
  /** 「宗秀 · 07/30 识别」，直接当矛盾表里的「谁说的」。 */
  from: string;
  title: string | null;
  scientific_name: string | null;
  family: string | null;
  genus: string | null;
  common_name_en: string | null;
  common_names_zh: string | null;
};

export type PlantProvenance = { contributors: PlantContributor[]; sources: PlantSourceClaim[] };

export async function fetchPlantProvenance(plantId: string): Promise<PlantProvenance> {
  const { data: drafts, error } = await supabase
    .from("plant_drafts")
    .select(
      "id, created_by, creator_label, capture_place, created_at, title, scientific_name, family, genus, common_name_en, common_names_zh, enriched:ai_payload->>_enriched, enrichedBy:ai_payload->>_enriched_by, enrichedAt:ai_payload->>_enriched_at",
    )
    .eq("published_plant_id", plantId)
    .order("created_at", { ascending: true });
  if (error || !drafts?.length) return { contributors: [], sources: [] };

  type Row = {
    id: string;
    created_by: string | null;
    creator_label: string | null;
    capture_place: string | null;
    created_at: string;
    title: string | null;
    scientific_name: string | null;
    family: string | null;
    genus: string | null;
    common_name_en: string | null;
    common_names_zh: string | null;
    enriched: string | null;
    enrichedBy: string | null;
    enrichedAt: string | null;
  };
  const rows = drafts as unknown as Row[];

  // 一次把所有用到的显示名查回来（识别人 + 生成人），别逐条查。
  const ids = [
    ...new Set(rows.flatMap((r) => [r.created_by, r.enrichedBy]).filter(Boolean) as string[]),
  ];
  const nameById = new Map<string, string>();
  if (ids.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", ids);
    for (const p of profs ?? []) if (p.display_name) nameById.set(p.id, p.display_name);
  }
  const nameOf = (userId: string | null, fallback: string | null) =>
    (userId ? nameById.get(userId) : null) || fallback || "访客";

  const contributors: PlantContributor[] = [];
  const sources: PlantSourceClaim[] = [];
  const md = (ts: string) => {
    try {
      return new Date(ts).toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
    } catch {
      return ts.slice(5, 10);
    }
  };
  for (const r of rows) {
    const who = nameOf(r.created_by, r.creator_label);
    contributors.push({
      role: "identify",
      name: who,
      at: r.created_at,
      place: r.capture_place,
      draftId: r.id,
    });
    if (r.enriched === "true") {
      // 记到了生成人且查得到显示名才算「查到的」；否则退回识别人并标 inferred。
      const known = r.enrichedBy ? nameById.get(r.enrichedBy) : undefined;
      contributors.push({
        role: "enrich",
        name: known || who,
        at: r.enrichedAt || r.created_at,
        draftId: r.id,
        inferred: !known,
      });
    }
    sources.push({
      draftId: r.id,
      from: `${who} · ${md(r.created_at)} 识别`,
      title: r.title,
      scientific_name: r.scientific_name,
      family: r.family,
      genus: r.genus,
      common_name_en: r.common_name_en,
      common_names_zh: r.common_names_zh,
    });
  }
  return { contributors, sources };
}

/** Change log for a draft. Draft edit rows are tagged `block_path = draft:<id>`
 *  (see logDraftEditFn) so they can be listed without a schema change. */
export async function fetchEditsForDraft(draftId: string) {
  const { data, error } = await supabase
    .from("plant_edits")
    .select("*")
    .eq("block_path", `draft:${draftId}`)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as PlantEdit[];
}

export async function fetchEditById(id: string) {
  const { data, error } = await supabase.from("plant_edits").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as PlantEdit | null;
}

export async function isCurrentUserAdmin(userId: string | undefined | null) {
  if (!userId) return false;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !!data;
}

/**
 * Admin-only client revert/restore. If the edit is currently NOT reverted,
 * we swap its host block to `before_html` (undo). If it IS already reverted,
 * we swap back to `after_html` (restore). Locates the host via the
 * `data-edit-id` marker first, then falls back to `block_path` (cssPath).
 */
export async function revertEdit(edit: PlantEdit, currentUserId: string, bucket = "plant-html") {
  // 1. Look up plant html url
  const { data: plant, error: pErr } = await supabase
    .from("plants")
    .select("id, slug, html_url, content_type")
    .eq("id", edit.plant_id)
    .maybeSingle();
  if (pErr) throw pErr;
  if (!plant?.html_url) throw new Error("找不到对应的 HTML 文件");

  // 2. Fetch HTML
  const text = await fetch(plant.html_url).then((r) => r.text());
  const doc = new DOMParser().parseFromString(text, "text/html");

  // 3. Locate the host block: marker first, then block_path fallback
  const marker = doc.querySelector(`[data-edit-id="${cssEscape(edit.id)}"]`);
  let host: Element | null = marker?.closest("[data-edit-mark-host]") ?? null;
  if (!host && edit.block_path) {
    try {
      host = doc.querySelector(edit.block_path);
    } catch {
      host = null;
    }
  }
  if (!host) throw new Error("找不到该修改对应的内容块（页面可能已被覆盖）");

  // 4. Decide direction: undo vs restore
  const restoring = edit.reverted;
  const embeddedBefore = marker
    ? decodeSnapshotAttr(marker.getAttribute("data-before-html"))
    : null;
  const embeddedAfter = marker ? decodeSnapshotAttr(marker.getAttribute("data-after-html")) : null;
  const currentHtml = host.outerHTML;
  const beforeSnapshot = edit.before_html || embeddedBefore;
  const afterSnapshot = edit.after_html || embeddedAfter || currentHtml;
  const snapshot = restoring ? afterSnapshot : beforeSnapshot;
  if (!snapshot) {
    throw new Error(restoring ? "缺少“修改后”快照，无法恢复" : "缺少“修改前”快照，无法撤销");
  }
  const wrap = doc.createElement("div");
  wrap.innerHTML = snapshot;
  const newNode = wrap.firstElementChild;
  if (!newNode) throw new Error("快照解析失败");
  host.replaceWith(newNode);

  // 5. Upload as a new HTML file
  const fullDoc = "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
  const blob = new Blob([fullDoc], { type: "text/html" });
  const path = `${currentUserId}/revert-${Date.now()}.html`;
  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(path, blob, { cacheControl: "3600", upsert: false, contentType: "text/html" });
  if (upErr) throw upErr;
  const newUrl = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;

  // 6 + 7. 落库：换 plants.html_url + 翻 plant_edits.reverted。
  //
  // 🔴 这两笔**走服务端函数**（2026-07-31）。原先是客户端直写，靠 `plant_edits` 的
  // UPDATE RLS 兜底 —— 而那条策略是 admin-only，于是「撤销」实际只有 admin 做得了，
  // 资深编辑点了会在第 7 步静默失败、第 6 步却已经写进去了（内容换了、记录没翻）。
  // 服务端函数用 service-role 一次做完，权限判定收在 roles.functions.ts 里。
  // DOM 那一半留在浏览器（DOMParser 服务端没有），所以只把结果传过去。
  if (edit.editor_id) {
    const { applyRevertFn } = await import("@/lib/roles.functions");
    await applyRevertFn({
      data: {
        plantId: plant.id,
        newHtmlUrl: newUrl,
        editId: edit.id,
        beforeHtml: beforeSnapshot,
        afterHtml: afterSnapshot,
        restoring,
      },
    });
  } else {
    // 历史遗留：这条修改在库里没有对应行（editor_id 为空），补插一条。
    // INSERT 的 RLS 认「本人 + 已批准编辑」，客户端写得进去，不必绕服务端。
    const { error: updErr } = await supabase
      .from("plants")
      .update({ html_url: newUrl })
      .eq("id", plant.id);
    if (updErr) throw updErr;

    const { error: insErr } = await supabase.from("plant_edits").insert({
      id: edit.id,
      plant_id: plant.id,
      editor_id: currentUserId,
      editor_name: edit.editor_name || "历史编辑者",
      kind: edit.kind,
      marker_n: edit.marker_n,
      block_path: edit.block_path,
      before_html: beforeSnapshot,
      after_html: afterSnapshot,
      reverted: !restoring,
      reverted_by: restoring ? null : currentUserId,
      reverted_at: restoring ? null : new Date().toISOString(),
    });
    if (insErr && !String(insErr.message).toLowerCase().includes("duplicate")) throw insErr;
  }

  // 8. Audit row
  await supabase.from("plant_edits").insert({
    plant_id: plant.id,
    editor_id: currentUserId,
    editor_name: "admin",
    kind: "revert",
    marker_n: 0,
    block_path: edit.block_path,
    before_html: restoring ? beforeSnapshot : afterSnapshot,
    after_html: restoring ? afterSnapshot : beforeSnapshot,
  });

  return {
    newUrl,
    slug: plant.slug,
    restored: restoring,
  };
}
