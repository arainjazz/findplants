import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { speciesKey } from "./plants";

// ─── 「这个物种已经有人做过了」查询 ──────────────────────────────────────────
// 识别出**非疑似**结果后，草稿页在关掉分享卡时用它决定要不要拦一下：库里已经有同物种的
// 银叶草稿 / 金叶详页时，先把现成的推给用户，别让他再白花一枚银叶等好几分钟。
//
// 走服务端（service role）而不是前端直查：要跨用户统计「几份 / 几人」，前端受 RLS 限制
// 拿不全别人的草稿，算出来的数字会偏小且因人而异。

const Input = z.object({
  scientificName: z.string().max(300).nullable().optional(),
  /** 当前这份草稿自己不算进去。 */
  excludeDraftId: z.string().uuid().nullable().optional(),
  /**
   * 当前这个**已收录条目**自己不算进去。
   * 条目页也要显示这一块（2026-07-31），不排除的话金叶详页上会出现一个指向自己的按钮。
   */
  excludePlantSlug: z.string().max(200).nullable().optional(),
});

/**
 * 一份站内已有内容的类别 —— **颜色和文案完全由它决定**（用户 2026-07-31 定的规矩）：
 *   · 🟢 `quick`  快速简介卡        —— 一次识别落下的摘要卡（`_enriched=false` 的草稿，或它采纳成的条目）
 *   · 🔵 `silver` 银叶科普          —— 花一枚银叶生成正文的草稿，或它采纳成的条目
 *   · 🟠 `gold`   金叶 skill 创建详页 —— 站内一键生成（`source=gold_oneclick`）
 *   · 🟠 `skill`  skill 科普详页     —— 编辑用 skill 做好后上传的页（没花金叶，故不写「金叶」）
 *
 * 从前只有两类：蓝框=银叶草稿、橙框=**一切** plants 行。于是银叶草稿采纳成的条目（假连翘
 * 就是）被涂成橙色、写作「科普详页」——它明明是银叶科普；更糟的是同一份内容还会在蓝框里
 * 以草稿身份再出现一次。类别改由**内容来源**判定后这两个毛病一起消失。
 */
export type SpeciesExistingKind = "quick" | "silver" | "gold" | "skill";

/** 一类里的**其中一份**。份数 >1 时按钮下会展开成一行一份的列表。 */
export type SpeciesExistingEntry = {
  title: string;
  /** 显示名：登录用户取 `profiles.display_name`，访客草稿退到 `creator_label`。 */
  author: string | null;
  /** 尚未收录的草稿去向。`kind=silver` 时就地展开，其余跳草稿页。 */
  draftId?: string;
  /** 已收录条目去向（跳详页）。与 `draftId` 二选一。 */
  slug?: string;
  /** ISO 时间串；列表里只显示到「日」。 */
  createdAt: string | null;
  /** 拍摄地点。`plants` 没有这一列 —— 采纳来的条目借它来源草稿的 `capture_place`。 */
  place: string | null;
  /** 缩略图。条目取 `cover_url`，为空时退到来源草稿的 `photo_url`。 */
  thumb: string | null;
  /** true = 已收录条目（跳详页），false = 未收录草稿。 */
  published: boolean;
};

export type SpeciesExistingItem = {
  kind: SpeciesExistingKind;
  title: string;
  /** 显示名：登录用户取 `profiles.display_name`，访客草稿退到 `creator_label`。 */
  author: string | null;
  /** 尚未收录的草稿去向。`kind=silver` 时就地展开，其余跳草稿页。 */
  draftId?: string;
  /** 已收录条目去向（跳详页）。与 `draftId` 二选一。 */
  slug?: string;
  /** 同类共几份 / 出自几位用户（>1 时按钮上缀一句）。 */
  count: number;
  userCount: number;
  /**
   * 这一类下的**全部**份数（顺序即展示顺序），`entries[0]` 就是上面那几个代表字段。
   *
   * 从前只返回代表这一条，`count` 却报的是全组数量 —— 于是按钮上写着「共 2 份」，
   * 第二份却没有任何入口点得到（用户 2026-08-09 报的：拂子茅 4 份内容只有 2 个入口）。
   * 这个列表就是那个缺掉的入口。
   */
  entries: SpeciesExistingEntry[];
};

export type SpeciesExisting = {
  /** 每类最多一条，顺序即展示顺序（快速卡 → 银叶 → 金叶 → skill）。 */
  items: SpeciesExistingItem[];
};

/** 展示顺序：先最轻的快速卡，再银叶，最后两种详页。 */
const KIND_ORDER: SpeciesExistingKind[] = ["quick", "silver", "gold", "skill"];

const EMPTY: SpeciesExisting = { items: [] };

/**
 * 「这张照片是不是已经识别过了」。
 *
 * 指纹 = **原始文件字节**的 SHA-256（客户端在压缩之前算，见 camera-identify）。用原始字节
 * 而不是压缩后的：同一个文件重新选一次，原始字节必然一模一样；压缩是有损再编码，不保证
 * 跨次比特一致。
 *
 * 存在 `ai_payload._photo_sha256` 而不是新开一列：hosted Supabase 加列要人工去 dashboard
 * 跑迁移，能不加就不加。代价是这个 JSON 路径没索引 —— 目前草稿量级下无所谓，真慢了再补
 * 一个 `create index on plant_drafts ((ai_payload->>'_photo_sha256'))`。
 */
export const findDraftByPhotoHash = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ draftId: string; title: string | null } | null> => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: rows } = await (supabaseAdmin as any)
        .from("plant_drafts")
        .select("id, title, created_at")
        .eq("ai_payload->>_photo_sha256", data.hash)
        .order("created_at", { ascending: false })
        .limit(1);
      const hit = (rows ?? [])[0];
      return hit ? { draftId: hit.id, title: hit.title ?? null } : null;
    } catch (e) {
      // 查重失败绝不能挡住识别 —— 大不了重复识别一次。
      console.warn("[PhotoDedup] lookup failed:", e);
      return null;
    }
  });

export const lookupSpeciesExisting = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => Input.parse(input))
  .handler(async ({ data }): Promise<SpeciesExisting> => {
    const key = speciesKey(data.scientificName ?? "");
    if (!key) return EMPTY;
    // 属名前缀粗筛（能走索引）→ 再用 speciesKey 精确比对。库里的 scientific_name 写法很不
    // 统一（带命名人、亚种、大小写、markdown 星号），直接等值匹配会漏掉一大半。
    const genus = key.split(" ")[0];
    if (!genus) return EMPTY;

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      const [draftRes, plantRes] = await Promise.all([
        // 快速卡也要查（`_enriched=false`）—— 常驻那一栏要把它绿框列出来。以前这里写死
        // `.eq(_enriched,"true")`，快速卡根本查不到。**弹窗的门槛没跟着放宽**：每次识别都会
        // 落一条快速卡，拿它弹推荐面板会变成天天打扰，见 drafts.$id 的 offerExistingWork。
        // `enriched:ai_payload->>_enriched` 是 PostgREST 的 JSON 取值别名，返回字符串 "true"/"false"，
        // 这样不必把整个 ai_payload（很大）拉回来 300 份。
        (supabaseAdmin as any)
          .from("plant_drafts")
          .select(
            "id, title, created_by, creator_label, scientific_name, created_at, capture_place, photo_url, published_plant_id, enriched:ai_payload->>_enriched",
          )
          .ilike("scientific_name", `${genus}%`)
          .order("created_at", { ascending: false })
          .limit(300),
        (supabaseAdmin as any)
          // id 用来和草稿的 published_plant_id 对上（判断这一行是不是采纳来的）；
          // author_id 用来写「谁创建的」；created_at 决定同类里挑哪一份当代表。
          .from("plants")
          .select("id, slug, title, scientific_name, source, created_at, author_id, cover_url")
          .ilike("scientific_name", `${genus}%`)
          .order("created_at", { ascending: false })
          .limit(300),
      ]);

      type DraftRow = {
        id: string;
        title: string | null;
        created_by: string | null;
        creator_label: string | null;
        scientific_name: string | null;
        created_at: string | null;
        capture_place: string | null;
        photo_url: string | null;
        published_plant_id: string | null;
        enriched: string | null;
      };
      type PlantRow = {
        id: string;
        slug: string;
        title: string;
        scientific_name: string | null;
        source: string | null;
        created_at: string | null;
        author_id: string | null;
        cover_url: string | null;
      };

      const drafts: DraftRow[] = (draftRes?.data ?? []).filter(
        (r: any) => speciesKey(r.scientific_name) === key,
      );
      const plants: PlantRow[] = (plantRes?.data ?? []).filter(
        (p: any) => speciesKey(p.scientific_name) === key,
      );

      // 本页自己当然不列。条目页还要连**它自己的来源草稿**一起排除 —— 那份草稿的正文
      // 就是这一页，再展开一遍只会看到同样的东西。
      const selfPlantId = data.excludePlantSlug
        ? (plants.find((p) => p.slug === data.excludePlantSlug)?.id ?? null)
        : null;

      const visiblePlants = plants.filter((p) => p.slug !== (data.excludePlantSlug ?? null));
      const shownPlantIds = new Set(visiblePlants.map((p) => p.id));
      const visibleDrafts = drafts.filter(
        (d) =>
          d.id !== data.excludeDraftId &&
          !(selfPlantId && d.published_plant_id === selfPlantId) &&
          // 已被采纳的草稿由**条目**代表：跳详页才是它的正式去处，不再以草稿身份重复一遍。
          !(d.published_plant_id && shownPlantIds.has(d.published_plant_id)),
      );

      // 条目的类别跟着**来源草稿**走：银叶草稿采纳来的仍是银叶科普，快速卡采纳来的仍是快速卡。
      // 一株植物可能有好几份草稿指向同一条目，只要其中一份是银叶，这一页就算银叶科普。
      const sourceEnriched = new Map<string, boolean>();
      for (const d of drafts) {
        if (!d.published_plant_id) continue;
        sourceEnriched.set(
          d.published_plant_id,
          (sourceEnriched.get(d.published_plant_id) ?? false) || d.enriched === "true",
        );
      }

      // plants 没有 capture_place，封面也可能是空的 —— 采纳来的条目就借它**来源草稿**的
      // 拍摄地点与照片。列表里要靠这两样把同物种的几份区分开（多半是不同地点拍的）。
      const fromSourceDraft = new Map<string, { place: string | null; thumb: string | null }>();
      for (const d of drafts) {
        if (!d.published_plant_id) continue;
        const cur = fromSourceDraft.get(d.published_plant_id);
        fromSourceDraft.set(d.published_plant_id, {
          place: cur?.place || d.capture_place || null,
          thumb: cur?.thumb || d.photo_url || null,
        });
      }

      type Raw = {
        kind: SpeciesExistingKind;
        title: string;
        draftId?: string;
        slug?: string;
        userId: string | null;
        label: string | null;
        createdAt: string | null;
        place: string | null;
        thumb: string | null;
        published: boolean;
      };
      const raws: Raw[] = [];
      // 条目在前、草稿在后：同一类里优先拿**已发布的条目**当代表（那是这份内容的正式家）。
      for (const p of visiblePlants) {
        const kind: SpeciesExistingKind =
          // 金叶一键优先级最高：哪怕恰好有草稿指过来，它也仍然是金叶详页。
          p.source === "gold_oneclick"
            ? "gold"
            : sourceEnriched.has(p.id)
              ? sourceEnriched.get(p.id)
                ? "silver"
                : "quick"
              : "skill";
        const src = fromSourceDraft.get(p.id);
        raws.push({
          kind,
          title: p.title,
          slug: p.slug,
          userId: p.author_id,
          label: null,
          createdAt: p.created_at ?? null,
          place: src?.place ?? null,
          thumb: p.cover_url || src?.thumb || null,
          published: true,
        });
      }
      for (const d of visibleDrafts) {
        raws.push({
          kind: d.enriched === "true" ? "silver" : "quick",
          title: d.title ?? "",
          draftId: d.id,
          userId: d.created_by,
          label: d.creator_label,
          createdAt: d.created_at ?? null,
          place: d.capture_place ?? null,
          thumb: d.photo_url ?? null,
          published: false,
        });
      }

      // 每一类**整组**都带回去（不再只留 group[0]）—— 前端点开「共 N 份」时要逐份列出来。
      const groups: Raw[][] = [];
      const items: SpeciesExistingItem[] = [];
      for (const kind of KIND_ORDER) {
        const group = raws.filter((r) => r.kind === kind);
        if (!group.length) continue;
        groups.push(group);
        items.push({
          kind,
          title: group[0].title,
          author: null,
          draftId: group[0].draftId,
          slug: group[0].slug,
          count: group.length,
          userCount: new Set(group.map((g) => g.userId).filter(Boolean)).size,
          entries: group.map((g) => ({
            title: g.title,
            author: null,
            draftId: g.draftId,
            slug: g.slug,
            createdAt: g.createdAt,
            place: g.place,
            thumb: g.thumb,
            published: g.published,
          })),
        });
      }

      // 「x 创建的」里的 x。**每一份**都要（列表里靠作者+时间区分两份），一次查完；
      // 访客草稿没有 created_by → 退到 creator_label。
      const ids = [...new Set(raws.map((r) => r.userId).filter(Boolean))] as string[];
      const nameById = new Map<string, string>();
      if (ids.length) {
        const { data: profs } = await (supabaseAdmin as any)
          .from("profiles")
          .select("id, display_name")
          .in("id", ids);
        for (const p of profs ?? []) if (p.display_name) nameById.set(p.id, p.display_name);
      }
      const nameOf = (r: Raw) => (r.userId ? nameById.get(r.userId) : null) || r.label || null;
      items.forEach((it, i) => {
        const group = groups[i];
        it.author = nameOf(group[0]);
        it.entries.forEach((e, j) => (e.author = nameOf(group[j])));
      });

      return { items };
    } catch (e) {
      // 纯锦上添花的功能：查不到就当没有，绝不能因此挡住用户正常的生成流程。
      console.warn("[SpeciesExisting] lookup failed:", e);
      return EMPTY;
    }
  });
