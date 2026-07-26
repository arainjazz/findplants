import { supabase } from "@/integrations/supabase/client";

export type Tag = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  expected_count: number | null;
  created_by: string;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * `plant_count` = 已发布条目数；`draft_count` = 挂在草稿上的数量。
 * **两者必须分开**：专题页展示的是「已收录多少」，而用户在识别卡上挂标签产生的是草稿，
 * 混成一个数会让「已收录 3 种」里其实有 2 条还没审。但也不能只数条目 —— 那正是
 * 「手动添加的标签下面永远是 0」这个 bug 的由来。
 */
export type TagWithCount = Tag & { plant_count: number; draft_count: number };

export function slugifyTag(s: string) {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g, (m) => encodeURIComponent(m).replace(/%/g, ""))
    .replace(/[^a-z0-9\-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `t-${Date.now().toString(36)}`;
}

// ─── 一个标签下到底挂了哪些东西 ──────────────────────────────────────────────
//
// 🔴 这里曾经有一个把整套标签功能架空的 bug（2026-07-24 用户报「手动添加的标签下面的
// 条目永远为 0」）：计数和专题页都**只数 `plant_tags` 关联表**，而标签实际上有三个来源，
// 关联表只是其中之一：
//
//   ① `plant_tags` 关联表          —— 编辑在「添加/编辑内容」页勾选时写的
//   ② `plants.tags`      (text[]) —— 编辑器那栏「特征词」，以及从草稿采纳时带过来的
//   ③ `plant_drafts.tags`(text[]) —— **草稿页简介摘要卡上那个「手动添加 #tag 标签」按钮**
//
// 用户最常用的恰恰是 ③（识别完当场挂一个），而它**永远不会**产生 ① 的行 —— 于是标签建好
// 、挂上了、卡签也显示了，专题页和计数却始终是 0。表现得像标签功能根本没生效。
//
// 修法：membership 一律走**三者并集**，且 ②③ 按**标签名**匹配（那两列存的就是名字）。
// 计数、专题页、首页的主题标签浏览器全部改用这一个函数，避免三处各算各的又不一致。

/** 一个标签挂着的条目 id 与草稿 id。 */
export type TagMembership = { plantIds: string[]; draftIds: string[] };

/**
 * PostgREST 默认单次最多回 1000 行，三张表都可能超过 —— 不分页的话，超出的部分
 * **静默丢失**，表现为「有些条目就是不算进标签里」，比整个查询失败还难查。
 *
 * `run(from, to)` 由调用方给，好让 supabase-js 的表名/列名类型推导正常工作
 * （把表名当字符串参数传进来会让它退化成 never）。
 */
async function pageAll<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await run(from, from + PAGE - 1);
    // 计数是锦上添花，查不到就当空 —— 别让一次失败把整个页面拖垮。
    if (error) break;
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * 算出每个标签挂了哪些条目 / 草稿。三个来源取并集，见上方注释。
 *
 * @param tags 已建标签（要用它们的 name 去匹配两张表的 text[] 列）
 */
export async function fetchTagMembership(tags: Tag[]): Promise<Map<string, TagMembership>> {
  const byId = new Map<string, { plants: Set<string>; drafts: Set<string> }>();
  for (const t of tags) byId.set(t.id, { plants: new Set(), drafts: new Set() });
  if (!tags.length) return new Map();

  // 名字 → 标签 id。大小写不敏感：`fetchTagByName` 用的是 ilike，建标签时的查重也是，
  // 所以「盐生植物」和「盐生植物 」以外的大小写差异不该在这里变成两个标签。
  const idByName = new Map<string, string>();
  for (const t of tags) idByName.set(t.name.trim().toLowerCase(), t.id);
  const resolve = (raw: unknown): string | null => {
    if (typeof raw !== "string") return null;
    return idByName.get(raw.trim().toLowerCase()) ?? null;
  };

  type TagArrayRow = { id: string; tags: string[] | null };
  const [links, plants, drafts] = await Promise.all([
    pageAll<{ tag_id: string; plant_id: string }>((from, to) =>
      supabase.from("plant_tags").select("tag_id,plant_id").range(from, to),
    ),
    pageAll<TagArrayRow>((from, to) => supabase.from("plants").select("id,tags").range(from, to)),
    // 被否掉的草稿不该算进任何专题。
    pageAll<TagArrayRow>((from, to) =>
      supabase.from("plant_drafts").select("id,tags").neq("status", "rejected").range(from, to),
    ),
  ]);

  for (const l of links) byId.get(l.tag_id)?.plants.add(l.plant_id);
  for (const p of plants) for (const n of p.tags ?? []) {
    const id = resolve(n);
    if (id) byId.get(id)!.plants.add(p.id);
  }
  for (const d of drafts) for (const n of d.tags ?? []) {
    const id = resolve(n);
    if (id) byId.get(id)!.drafts.add(d.id);
  }

  return new Map(
    Array.from(byId, ([id, v]) => [id, { plantIds: [...v.plants], draftIds: [...v.drafts] }]),
  );
}

export async function fetchAllTags(): Promise<TagWithCount[]> {
  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  const tags = (data ?? []) as Tag[];
  if (tags.length === 0) return [];
  const membership = await fetchTagMembership(tags);
  return tags.map((t) => {
    const m = membership.get(t.id);
    return {
      ...t,
      plant_count: m?.plantIds.length ?? 0,
      draft_count: m?.draftIds.length ?? 0,
    };
  });
}

export async function fetchTagBySlug(slug: string) {
  const { data, error } = await supabase
    .from("tags")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  return data as Tag | null;
}

export async function fetchTagByName(name: string) {
  const { data } = await supabase
    .from("tags")
    .select("*")
    .ilike("name", name.trim())
    .maybeSingle();
  return (data ?? null) as Tag | null;
}

/**
 * 一个标签下的**已发布条目 id**。
 *
 * ⚠️ 只读关联表 —— 这是**给标签管理页的「已纳入此标签的物种」用的**：那个列表每行带一个
 * 「×」解绑按钮，而解绑走 `detachPlantFromTag`（删关联表的行）。把 `plants.tags` 里靠名字
 * 匹配上的条目也列进去，用户点了「×」会发现删不掉（那个名字在 text[] 里，不在关联表里）。
 * 要「这个标签总共挂了什么」请用 `fetchTagMembership`。
 */
export async function fetchPlantIdsForTag(tagId: string): Promise<string[]> {
  const { data } = await supabase.from("plant_tags").select("plant_id").eq("tag_id", tagId);
  return (data ?? []).map((r) => r.plant_id as string);
}

export async function fetchTagsForPlant(plantId: string): Promise<Tag[]> {
  const { data } = await supabase
    .from("plant_tags")
    .select("tags(*)")
    .eq("plant_id", plantId);
  return (data ?? []).map((r) => (r as { tags: Tag }).tags).filter(Boolean);
}

export async function fetchAllPlantTags(): Promise<{ tag_id: string; plant_id: string }[]> {
  const { data, error } = await supabase.from("plant_tags").select("tag_id,plant_id");
  if (error) throw error;
  return (data ?? []) as { tag_id: string; plant_id: string }[];
}

export async function createTag(input: { name: string; description: string }, userId: string, userName: string) {
  const slug = slugifyTag(input.name);
  const { data, error } = await supabase
    .from("tags")
    .insert({
      slug,
      name: input.name.trim(),
      description: input.description.trim() || null,
      created_by: userId,
      created_by_name: userName,
    })
    .select()
    .single();
  if (error) throw error;
  await supabase.from("plant_edits").insert({
    plant_id: null,
    editor_id: userId,
    editor_name: userName,
    kind: "tag_create",
    marker_n: 0,
    source: "tag_editor",
    summary: `${userName} 创建了 #${input.name} 标签`,
  });
  return data as Tag;
}

export async function updateTag(id: string, patch: Partial<Pick<Tag, "name" | "description" | "expected_count">>) {
  const { error } = await supabase.from("tags").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTag(id: string) {
  const { error } = await supabase.from("tags").delete().eq("id", id);
  if (error) throw error;
}

export async function attachPlantsToTag(tagId: string, plantIds: string[], userId: string) {
  if (plantIds.length === 0) return;
  const rows = plantIds.map((pid) => ({ tag_id: tagId, plant_id: pid, added_by: userId }));
  const { error } = await supabase.from("plant_tags").upsert(rows, { onConflict: "tag_id,plant_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function detachPlantFromTag(tagId: string, plantId: string) {
  const { error } = await supabase.from("plant_tags").delete().eq("tag_id", tagId).eq("plant_id", plantId);
  if (error) throw error;
}
