import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { speciesKey } from "./plants";
import { computeIdentifyConfidence, type IdentifyTrace } from "./identify-trace";
import { tentativeResolution } from "./tentative";
import { coarsenPlace } from "./protected-coords";

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
  /** ISO 时间串；列表里显示到「分」。 */
  createdAt: string | null;
  /**
   * 拍摄地点 —— 也就是**坐标反查出来的那个地名**（识别时由 `reverseGeocode` 写进
   * `capture_place`）。`plants` 没有这一列，采纳来的条目借它来源草稿的。
   *
   * 🔒 这里给出的已经是**对外可见**的值：命中重点保护名录的物种，服务端在这一步就已经
   * 粗化到区/县/旗（`coarsenPlace`），粗化不出来就写「地点已隐去」。
   *
   * ⚠️ **不要在这个接口里回传经纬度。** 用户 2026-08-11 的要求是「展示坐标背后代表的
   * 地点，保护名单里的物种除外」—— 而对保护物种来说，把精确坐标塞进 JSON 再在前端
   * 决定不画出来，等于照样公开（页面源码里就能读到）。判据与脱敏都必须留在服务端，
   * 与地图那条路（geo-sightings.functions.ts）同一个规矩。
   */
  place: string | null;
  /** true = 上面那个地点是保护物种粗化过的（行上给一句解释）。 */
  placeCoarsened: boolean;
  /**
   * 综合可信度%。**与草稿页同一套算法**（`computeIdentifyConfidence`）—— 同一份草稿在
   * 两处显示两个数字是最糟的结果，所以判据字段一个都不省，包括那个 219 字的 summary。
   * 条目行借它**真来源草稿**的；借不到就是 null（不显示，不编一个数出来）。
   */
  confidencePct: number | null;
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
        //
        // `x:ai_payload->>k` / `x:ai_payload->k` 是 PostgREST 的 JSON 取值别名（`->>` 出文本、
        // `->` 出对象），这样不必把整个 ai_payload（很大）拉回来 300 份。取这几个子字段是为了
        // 让每一行都能算出**与草稿页同一个**综合可信度%：算法要痕迹 + 置信档 + 「疑似」判据 +
        // 人工解除留痕（见 identify-trace.ts / tentative.ts）。
        //
        // `summary` 是唯一一个非取不可的大字段（全库 251 份平均 219 字 ≈ 64KB）：模型经常
        // 不设 `identification_confidence=low`，而是把「疑似」写在摘要开头 —— 实测有 3 份
        // 草稿**只有这一个信号**。省掉它，那几份在这里会算出 70%、在草稿页上却是 45%，
        // 同一份草稿两个数字。宁可多传 64KB（服务端内部查询，还有 5 分钟前端缓存）。
        (supabaseAdmin as any)
          .from("plant_drafts")
          .select(
            "id, title, created_by, creator_label, scientific_name, family, created_at, capture_place, photo_url, published_plant_id, summary, ai_model, retake_count, enriched:ai_payload->>_enriched, trace:ai_payload->_identify_trace, conf:ai_payload->>identification_confidence, diag:ai_payload->_editor_diagnosis, xfix:ai_payload->_xiaop_id_fix",
          )
          .ilike("scientific_name", `${genus}%`)
          .order("created_at", { ascending: false })
          .limit(300),
        (supabaseAdmin as any)
          // id 用来和草稿的 published_plant_id 对上（判断这一行是不是采纳来的）；
          // author_id 用来写「谁创建的」；created_at 决定同类里挑哪一份当代表。
          .from("plants")
          .select("id, slug, title, scientific_name, family, source, created_at, author_id, cover_url")
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
        /** 名录匹配要用（科级条目：整个科都受保护的情形）。 */
        family: string | null;
        created_at: string | null;
        capture_place: string | null;
        photo_url: string | null;
        published_plant_id: string | null;
        summary: string | null;
        ai_model: string | null;
        retake_count: number | null;
        enriched: string | null;
        trace: IdentifyTrace | null;
        conf: string | null;
        diag: unknown;
        xfix: unknown;
      };
      type PlantRow = {
        id: string;
        slug: string;
        title: string;
        scientific_name: string | null;
        family: string | null;
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
      //
      // ⚠️ 但「来源」必须是**真来源**。`published_plant_id` 有两条写入路径（都在
      // identify-plant.functions.ts）：**采纳收录**——先有草稿，才落成条目；**并入已有条目**
      // ——条目早就在了，只是把这次观测当一张「补充观测」卡片追加到页尾。两者写的字段
      // 一模一样，光看这一列分不出来，于是后来并进去的快速卡会把一份正经详页**降级**成
      // 绿框「快速简介卡」。猪毛蒿就是这么丢掉入口的（用户 2026-08-11 报「有详页但是不
      // 显示」）：2026-07-13 导入的 skill 详页，被 07-25 / 08-11 两份并入的快速卡判成
      // quick，那一栏里再没有任何一个写着「详页」的按钮。
      //
      // 判据用时间序：采纳必然「草稿在前、条目在后」（条目就是那一刻建的），并入必然反过来。
      // 实测全库 283 个条目判出 10 份「晚于条目」的关联，每一份都对得上 plant_edits 里的
      // merge 记录 —— 零误判。反向漏网仍有（并入的草稿恰好建于条目之前时认不出来，全库 4 例），
      // 那是维持现状，不是新错。
      const plantCreatedAt = new Map(plants.map((p) => [p.id, p.created_at]));
      const isSourceDraft = (d: DraftRow) => {
        if (!d.published_plant_id) return false;
        const plantAt = plantCreatedAt.get(d.published_plant_id);
        // 时间缺一头就无从判断 —— 退回旧行为（算作来源），宁可少改也不错改。
        if (!plantAt || !d.created_at) return true;
        return Date.parse(d.created_at) <= Date.parse(plantAt);
      };

      const sourceEnriched = new Map<string, boolean>();
      for (const d of drafts) {
        if (!isSourceDraft(d)) continue;
        sourceEnriched.set(
          d.published_plant_id!,
          (sourceEnriched.get(d.published_plant_id!) ?? false) || d.enriched === "true",
        );
      }

      /**
       * 一份草稿的综合可信度%。**与草稿页（drafts.$id.tsx）逐参数同源** —— 同一份草稿在
       * 两处显示两个数字是最糟的结果，所以那三样都不能省：老草稿的「只含置信档的最小痕迹」
       * 兜底、整份 meta（「疑似」可能只写在摘要或标题里）、人工解除留痕。
       * 摘要按「列优先」取即可：建卡时 `summary` 列就是从 `summary_zh` 写下来的
       * （identify-plant.functions.ts 各处 `summary:` 落库），列空则 payload 里也是空的。
       */
      const confidenceOf = (d: DraftRow): number => {
        const conf = (d.conf ?? "").toString();
        const trace: IdentifyTrace = d.trace ?? {
          primaryEngine: "none",
          primaryLabel: "",
          primaryPct: null,
          phase1Model: (d.ai_model ?? "").toString(),
          phase1Confidence: conf,
          review: { ran: false, reason: "本次识别早于该功能上线，没有留下过程记录" },
          retakeCount: Number(d.retake_count ?? 0),
        };
        return computeIdentifyConfidence(
          trace,
          (d.scientific_name ?? "").toString(),
          { identification_confidence: conf, summary_zh: d.summary, title: d.title },
          tentativeResolution({ _editor_diagnosis: d.diag, _xiaop_id_fix: d.xfix }),
        ).pct;
      };

      // plants 没有 capture_place / 可信度，封面也可能是空的 —— 采纳来的条目就借它
      // **来源草稿**的。列表里要靠这几样把同物种的几份区分开（多半是不同人在不同地点拍的）。
      //
      // 地点与可信度都只认真来源（并入型条目借不到）：这两样都是**那一次观测的事实**，
      // 把一次补充观测的地点或可信度挂到一份百科详页上，读者会当成这一页就是那么来的。
      // 缩略图则**照借不误** —— 那只是视觉辅助，同物种的照片当封面兜底不会让人误读，
      // 而空缩略图会让一行塌成灰块。
      const fromSourceDraft = new Map<
        string,
        { place: string | null; thumb: string | null; confidencePct: number | null }
      >();
      for (const d of drafts) {
        if (!d.published_plant_id) continue;
        const cur = fromSourceDraft.get(d.published_plant_id);
        const src = isSourceDraft(d);
        fromSourceDraft.set(d.published_plant_id, {
          place: cur?.place || (src ? d.capture_place || null : null),
          thumb: cur?.thumb || d.photo_url || null,
          confidencePct: cur?.confidencePct ?? (src ? confidenceOf(d) : null),
        });
      }

      // 🔒 重点保护物种的地点粗化。这一栏里的每一行都是**同一个物种**，所以只判一次。
      //
      // 判据必须留在服务端：前端拿到什么就等于公开了什么（页面源码里读得到），而这一栏
      // 列的是**别人**的观测点 —— 与地图那条路（geo-sightings.functions.ts）同一个处境，
      // 那里也是服务端脱敏。身份一律不看（不像草稿页会给站长/资深编辑/本人放行）：
      // 一份紧凑的清单没必要为此多跑一趟鉴权，分享卡那条路同样是「命中名录就一律模糊」。
      let protectedSpecies = false;
      try {
        const { loadConservationMatcherCached } = await import("./geo-sightings.functions");
        const { match } = await loadConservationMatcherCached();
        // 科名一定要给：**兰科全科**是国家二级，绶草这类只在科一级命中（`match` 的
        // family 分支）。草稿没有就退到条目那一行，两边都空才作罢。
        const hit = match(
          drafts[0]?.scientific_name ?? plants[0]?.scientific_name ?? null,
          drafts[0]?.family ?? plants[0]?.family ?? null,
        );
        protectedSpecies = hit.protectedLists.size > 0;
      } catch (e) {
        // 名录查不动时**按保护处理**（宁可少给信息，也不能把一株四合木的位置漏出去）。
        console.warn("[SpeciesExisting] conservation matcher failed, coarsening places:", e);
        protectedSpecies = true;
      }
      /** 对外可见的地点文字。保护物种砍到区/县/旗，砍不出来就整个隐去。 */
      const shownPlace = (place: string | null) =>
        protectedSpecies ? coarsenPlace(place) || "地点已隐去" : place;

      type Raw = {
        kind: SpeciesExistingKind;
        title: string;
        draftId?: string;
        slug?: string;
        userId: string | null;
        label: string | null;
        createdAt: string | null;
        place: string | null;
        confidencePct: number | null;
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
          place: shownPlace(src?.place ?? null),
          confidencePct: src?.confidencePct ?? null,
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
          place: shownPlace(d.capture_place ?? null),
          confidencePct: confidenceOf(d),
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
            placeCoarsened: protectedSpecies && !!g.place,
            confidencePct: g.confidencePct,
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
