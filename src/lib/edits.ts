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
  let q = supabase.from("editor_applications").select("*").order("created_at", { ascending: false });
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
    const siblings = (Array.from(parentEl.children) as Element[]).filter((child) => child.tagName === cur!.tagName);
    parts.unshift(`${tag}:nth-of-type(${siblings.indexOf(cur) + 1})`);
    cur = parentEl;
  }
  return parts.join(" > ") || null;
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
        const after = decodeSnapshotAttr(mark.getAttribute("data-after-html")) ?? host?.outerHTML ?? null;
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
          created_at: stamp ? `${stamp[1]}-${stamp[2]}-${stamp[3]}T${stamp[4]}:${stamp[5]}:00+08:00` : new Date().toISOString(),
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
  const { data, error } = await supabase
    .from("plant_edits")
    .select("*")
    .eq("id", id)
    .maybeSingle();
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
export async function revertEdit(
  edit: PlantEdit,
  currentUserId: string,
  bucket = "plant-html",
) {
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
    try { host = doc.querySelector(edit.block_path); } catch { host = null; }
  }
  if (!host) throw new Error("找不到该修改对应的内容块（页面可能已被覆盖）");

  // 4. Decide direction: undo vs restore
  const restoring = edit.reverted;
  const embeddedBefore = marker ? decodeSnapshotAttr(marker.getAttribute("data-before-html")) : null;
  const embeddedAfter = marker ? decodeSnapshotAttr(marker.getAttribute("data-after-html")) : null;
  const currentHtml = host.outerHTML;
  const beforeSnapshot = edit.before_html || embeddedBefore;
  const afterSnapshot = edit.after_html || embeddedAfter || currentHtml;
  const snapshot = restoring ? afterSnapshot : beforeSnapshot;
  if (!snapshot) {
    throw new Error(
      restoring
        ? "缺少“修改后”快照，无法恢复"
        : "缺少“修改前”快照，无法撤销",
    );
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

  // 6. Update plant
  const { error: updErr } = await supabase
    .from("plants")
    .update({ html_url: newUrl })
    .eq("id", plant.id);
  if (updErr) throw updErr;

  // 7. Toggle reverted flag on the source edit (real DB rows only)
  if (edit.editor_id) {
    const { error: revErr } = await supabase
      .from("plant_edits")
      .update({
        before_html: beforeSnapshot,
        after_html: afterSnapshot,
        reverted: !restoring,
        reverted_by: restoring ? null : currentUserId,
        reverted_at: restoring ? null : new Date().toISOString(),
      })
      .eq("id", edit.id);
    if (revErr) throw revErr;
  } else {
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
