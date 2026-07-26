/**
 * 正名核对机制 —— 以《中国植物物种名录 2026 版》为准绳（含异名映射）。
 *
 * 起因：在此之前，一份草稿叫什么名字完全由模型说了算。同一物种在站内可能同时存在
 * 「海韭菜」「圆果水麦冬」三种写法；科名更乱 —— 模型常给出 APG 之前的旧科。
 * 全站没有任何一处在核对。
 *
 * ## 这套机制能做什么、不能做什么（**先看这段再改代码**）
 *
 * 名录表里 **只有正名（accepted names），没有异名（synonym）列**。所以：
 *
 *  ✅ **拉丁名命中** → 中文正名、科中文名、属中文名一律以名录为准；模型给的不同写法
 *     降级为别名，用括号保留（不丢信息，也不让它当主名）。
 *  ✅ **中文名命中而拉丁名没命中** → 用中文名反查拉丁正名。但 17 个中文名对应多个物种
 *     （同名异物，如「龙须菜」「沙蓬」），这种一律判 `ambiguous`，**不猜**。
 *  ❌ **把异名映射到正名做不到**。`Triglochin palustre` 是不是 `T. palustris` 的异名，
 *     这张表答不了 —— 那需要 POWO/IPNI 级别的异名索引。拉丁名没命中时我们只标注、不改写。
 *
 * 「拉丁名没命中」有三种截然不同的可能，代价差别很大，所以**绝不自动改名**：
 *   ① 模型用了异名/旧名（改名是对的）；
 *   ② 这是个境外物种，本来就不该在中国名录里（改名会造出一个假的中国分布记录）；
 *   ③ 模型认错了物种（改名等于把错误洗成"权威"）。
 *
 * 纯函数、无网络无数据库 —— `scratch/name-authority.test.mjs` 直接跑本体。
 */

/** 名录表的一行（`species_checklist`）。 */
export type ChecklistEntry = {
  /** 名录自己的 ID。**真正的主键** —— name_key 不唯一（577 组同名异物）。 */
  name_code?: string;
  name_key: string;
  /** 这条名字的正名的 name_key。接受名指向自己；异名指向正名；接不上时 null。 */
  accepted_key?: string | null;
  is_accepted?: boolean;
  /** accepted name / synonym / ambiguous synonym / misapplied name / … */
  status?: string;
  /** 名录给的中文俗名/别名。有了它就不必再靠模型编俗名。 */
  common_names?: string[] | null;
  /** 省级分布，如「黑龙江、吉林、内蒙古」。 */
  distribution_zh?: string | null;
  scientific_name: string;
  chinese_name: string | null;
  family_la: string | null;
  family_zh: string | null;
  genus_la: string | null;
  genus_zh: string | null;
  order_zh?: string | null;
  class_zh?: string | null;
  phylum_zh?: string | null;
  rank?: string | null;
};

/** 别名的三种成色。分不清就用「别名」—— 说「旧名」是个断言，我们多数时候没资格断。 */
export type AliasKind = "异名" | "别名" | "旧名";

export type NameAlias = { name: string; kind: AliasKind };

export type NameStatus =
  /** 模型给的名字与名录完全一致，什么都不用改。 */
  | "accepted"
  /** 拉丁名命中名录，但中文名/科名与名录不符 → 已按名录改写，原名降级为别名。 */
  | "renamed"
  /** 输入的学名在名录里**是个异名** → 已换成它的正名，原名记为「异名」（有权威依据）。 */
  | "synonym"
  /** 中文名命中多个物种（同名异物）→ 不猜，交给人。 */
  | "ambiguous"
  /** 拉丁名不在名录里 → 只标注，不改写。 */
  | "unmatched";

export type NameVerdict = {
  status: NameStatus;
  /** 应当作为主标题展示的中文正名。unmatched 时原样回传模型给的名字。 */
  acceptedZh: string | null;
  /** 应当展示的拉丁正名。 */
  acceptedLa: string | null;
  familyLa: string | null;
  familyZh: string | null;
  genusLa: string | null;
  genusZh: string | null;
  /** 要用括号保留的其它名字（已去重、已剔除与正名相同的）。 */
  aliases: NameAlias[];
  /** 命中方式，写进审计日志用。 */
  matchedBy: "latin-exact" | "latin-infraspecific" | "latin-fuzzy" | "chinese" | "none";
  /** 给编辑看的一句话。ok 时为空。 */
  note: string;
};

// ── 归一化 ────────────────────────────────────────────────────────────────────

/**
 * 名录匹配键：**保留种下等级**（subsp./var./f.）。
 *
 * 与 `catalogs.ts` 的 `normalizeSciName` 和 `plants.ts` 的 `speciesKey` 刻意不同 ——
 * 那两个都截断到前两个词，而名录里有 7,569 条种下等级名，截断会把
 * `Campylopus atrovirens var. cucullatifolius` 和 `var. atrovirens` 合并成同一个键。
 */
export function checklistKey(s: string | null | undefined): string {
  if (!s) return "";
  return (
    s
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "") // 去变音符：Isoëtes → Isoetes
      .replace(/[*_]/g, "") // 模型爱把学名写成 *斜体*
      .replace(/\([^)]*\)/g, " ") // 去括号内的命名人
      .replace(/[×✕⨯]/g, " ") // 杂交符
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase()
      // 种下等级缩写统一成带点形式：ssp → subsp.、var → var.
      .replace(/\bssp\.?\b/g, "subsp.")
      .replace(/\bsubsp\b(?!\.)/g, "subsp.")
      .replace(/\bvar\b(?!\.)/g, "var.")
      .replace(/\bf\b(?!\.)(?=\s)/g, "f.")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** 种下等级标记。 */
const RANK_MARKERS = new Set(["subsp.", "var.", "f.", "fo.", "subvar.", "cv.", "forma"]);

/** 命名人里的小写连接词。不拦住它们会被当成种加词收进键里（`Maxim. ex Kom.` 的 ex）。 */
const AUTHOR_CONNECTORS = new Set([
  "ex",
  "et",
  "and",
  "in",
  "non",
  "nom",
  "comb",
  "sensu",
  "auct",
  "emend",
  "nud",
  "illeg",
]);

/**
 * **匹配键** —— 只保留「属名 + 种加词 [+ 种下等级标记 + 种下加词]」，把命名人整段丢掉。
 *
 * 为什么不能只靠 `checklistKey`：模型极爱把命名人写进学名
 * （`Ammopiptanthus mongolicus (Maxim. ex Kom.) Cheng f.`）。去掉括号那段之后
 * 还剩个尾巴 `cheng f.`，键就对不上名录了 —— 全量实测里这种情况会被错判成
 * 「双名下唯一的种下等级」，note 还煞有介事地说"已采用某某种下等级"。
 *
 * 判命名人靠**大小写**（在小写化之前分词）：种加词与种下加词一律小写，命名人一律首字母大写。
 * 而 `f.` 既是 forma 也是命名人的 filius —— 用「后面还跟着一个小写词才算等级标记」区分：
 *   `Campylopus atrovirens f. cucullatifolius` → f. 是等级；
 *   `Ammopiptanthus mongolicus Cheng f.`       → f. 在末尾，是 filius，丢掉。
 */
export function canonicalKey(s: string | null | undefined): string {
  if (!s) return "";
  let cleaned = s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[*_]/g, "")
    .replace(/\([^)]*\)/g, " ") // 括号里的命名人
    .replace(/[×✕⨯]/g, " × ") // 杂交符**保留**（见下）并独立成词
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

  // 栽培品种名（引号里那段）单独抽出来。它绝不能丢 —— 名录里
  // `Conioselinum anthriscoides`(藁本) / `…'Chuanxiong'`(川芎) / `…'Fuxiong'`(抚芎)
  // 只靠这段区分，丢了就是四个不同物种挤成一个键（全量导出实测 26 组这种碰撞）。
  let cultivar = "";
  const cm = cleaned.match(/'([^']+)'/);
  if (cm) {
    cultivar = cm[1].trim().toLowerCase();
    cleaned = cleaned.replace(cm[0], " ").replace(/\s+/g, " ").trim();
  }

  const normRank = (t: string) =>
    t
      .toLowerCase()
      .replace(/^ssp\.?$/, "subsp.")
      .replace(/^subsp$/, "subsp.")
      .replace(/^var$/, "var.")
      .replace(/^subvar$/, "subvar.")
      .replace(/^fo$/, "fo.")
      .replace(/^cv$/, "cv.");
  /** 全小写纯字母（可带连字符）= 加词。命名人要么首字母大写，要么带点。 */
  const isEpithet = (t: string) => /^[a-z][a-z-]*$/.test(t);

  const toks = cleaned.split(" ").filter(Boolean);
  const out: string[] = [];
  let i = 0;
  if (toks[0] === "×") {
    out.push("×"); // 属级杂交名，如 × Bolboschoenoplectus mariqueter
    i = 1;
  }
  if (i >= toks.length) return "";
  out.push(toks[i].toLowerCase()); // 属名
  i++;

  // 一路收下去，**遇到第一个命名人就整段停手** —— 命名人后面不会再有名字成分。
  // 这个方向很关键：默认是「保留」，只在确认是命名人时才丢。反过来做（只挑
  // 属名+种加词）会把 forma 的第二级、杂交式的第二个加词、品种名统统吃掉。
  let afterRank = false; // 上一个收下的词是不是等级标记
  for (; i < toks.length; i++) {
    const t = toks[i];
    if (t === "×") {
      out.push("×"); // 杂交式名：Bolbitis angustipinna × sinensis
      afterRank = false;
      continue;
    }
    const m = normRank(t);
    if (RANK_MARKERS.has(m)) {
      out.push(m);
      afterRank = true;
      continue;
    }
    // 等级标记后面那一个词**无条件**当种下加词收下。植物学规范要求它小写，
    // 但名录源数据里大量写成大写（`subsp. Attenuate`、`var. Nacusua`、`cv. Stripe`）——
    // 按「大写=命名人」判会在这里停手，于是「新木姜子」和「新木姜子(原变种)」
    // 挤成同一个键（全量导出实测 11 组）。
    if (afterRank && /^[A-Za-z][A-Za-z-]*$/.test(t)) {
      out.push(t.toLowerCase());
      afterRank = false;
      continue;
    }
    if (isEpithet(t) && !AUTHOR_CONNECTORS.has(t)) {
      out.push(t);
      continue;
    }
    break; // 命名人（Cheng / L. / Maxim.）开始了
  }
  // 末尾的孤立等级标记是命名人的 filius（`Cheng f.`），不是 forma —— 丢掉。
  while (out.length && RANK_MARKERS.has(out[out.length - 1])) out.pop();
  if (cultivar) out.push(`'${cultivar}'`);
  return out.join(" ");
}

/** 只取属名 + 种加词的键，用于「名录只有种下等级 / 模型只给了双名」的互查。 */
export function binomialKey(s: string | null | undefined): string {
  const k = canonicalKey(s);
  if (!k) return "";
  const t = k.split(" ").filter((x) => x !== "×"); // 属级杂交符不参与双名
  return t.length >= 2 ? `${t[0]} ${t[1]}` : (t[0] ?? "");
}

/**
 * 拉丁词尾的性数变体：`maritimum` / `maritimus` / `maritima` 是同一个种加词跟着属名的
 * 性走。模型常配错性。把词尾折叠掉，做**一次明确标记为 fuzzy 的**兜底匹配。
 *
 * 只折叠公认的形容词词尾对，不做通用编辑距离 —— 后者会把 *Carex nigra* 和
 * *Carex negra* 这种真不同的名字也拉到一起。
 */
export function genderFoldKey(s: string | null | undefined): string {
  const k = binomialKey(s);
  if (!k) return "";
  const [g, ep] = k.split(" ");
  if (!ep) return k;
  const folded = ep
    .replace(/(um|us|a|is|e|os|on)$/u, "~")
    .replace(/(ii|i)$/u, "~"); // 人名种加词 -ii / -i 混用
  return `${g} ${folded}`;
}

// ── 查表接口 ──────────────────────────────────────────────────────────────────

/**
 * 解析器只依赖这个接口，不直接碰数据库 —— 所以测试可以塞一个内存实现进来。
 * 服务端实现见 `name-authority.functions.ts`。
 */
export type ChecklistLookup = {
  /** 精确匹配 name_key（已 checklistKey 归一化）。 */
  byLatin: (key: string) => ChecklistEntry | null;
  /** 双名键匹配：名录里以该双名开头的全部条目（含种下等级）。 */
  byBinomial: (key: string) => ChecklistEntry[];
  /** 中文名精确匹配，可能多条（同名异物）。 */
  byChinese: (name: string) => ChecklistEntry[];
  /** 性数折叠后的兜底匹配。 */
  byGenderFold?: (key: string) => ChecklistEntry[];
  /** 按 name_key 取**全部**同键行（一键可能多行，见 name_key 非唯一那段注释）。 */
  allByLatin?: (key: string) => ChecklistEntry[];
};

/** 从一批名录行构造内存版 lookup（测试用；服务端小结果集也用它）。 */
/**
 * 一个 name_key 可能对应多行。把它们收敛成**一个该采用的正名条目**，或判定歧义。
 *
 * 实测 120,307 条名录里 1,373 组同键，分三类，处理方式完全不同：
 *   · 532 组 同一个正名的不同写法      → 无害，取那个正名
 *   · 264 组 一个正名 + 一个异名同键    → **以正名为准**（这个名字作为正名的用法胜出）
 *   · 577 组 多个不同的正名同键        → 真·同名异物，**判歧义，绝不猜**
 */
export function collapseCandidates(
  rows: ChecklistEntry[],
  byAcceptedKey: (k: string) => ChecklistEntry | null,
): { entry: ChecklistEntry | null; wasSynonym: boolean; ambiguous: boolean } {
  const usable = rows.filter((r) => r.scientific_name);
  if (!usable.length) return { entry: null, wasSynonym: false, ambiguous: false };

  const targets = new Set(usable.map((r) => r.accepted_key ?? r.name_key).filter(Boolean));
  const accepted = usable.filter((r) => r.is_accepted !== false && r.accepted_key !== null);

  let pick: ChecklistEntry | null = null;
  if (targets.size <= 1) {
    pick = usable.find((r) => r.is_accepted) ?? usable[0];
  } else {
    const acc = usable.filter((r) => r.is_accepted);
    if (acc.length === 1) pick = acc[0]; // 正名 vs 异名 → 正名赢
    else return { entry: null, wasSynonym: false, ambiguous: true }; // 真·同名异物
  }
  void accepted;
  if (!pick) return { entry: null, wasSynonym: false, ambiguous: false };

  // 命中的是异名 → 顺着 accepted_key 找到正名那一行。
  if (!pick.is_accepted && pick.accepted_key && pick.accepted_key !== pick.name_key) {
    const target = byAcceptedKey(pick.accepted_key);
    if (target) return { entry: target, wasSynonym: true, ambiguous: false };
    // 正名不在手上这批候选里（实测 6 条指向表外）→ 不改名，只标注。
    return { entry: null, wasSynonym: true, ambiguous: false };
  }
  return { entry: pick, wasSynonym: false, ambiguous: false };
}

export function buildLookup(entries: ChecklistEntry[]): ChecklistLookup {
  const byKey = new Map<string, ChecklistEntry>();
  const allByKey = new Map<string, ChecklistEntry[]>();
  const byBi = new Map<string, ChecklistEntry[]>();
  const byZh = new Map<string, ChecklistEntry[]>();
  const byFold = new Map<string, ChecklistEntry[]>();
  const push = (m: Map<string, ChecklistEntry[]>, k: string, e: ChecklistEntry) => {
    if (!k) return;
    const a = m.get(k);
    if (a) a.push(e);
    else m.set(k, [e]);
  };
  for (const e of entries) {
    // 一律现算 canonicalKey，**不信 name_key 字段** —— 导入脚本与本模块必须用同一套
    // 归一化，否则库里存的键和查询时算的键会悄悄错开（全量实测踩过一次：转换脚本
    // 自己实现的归一化在去掉杂交符 × 后没有重新 trim，留了个前导空格）。
    const k = canonicalKey(e.scientific_name) || e.name_key;
    if (k) {
      // 同键多行时 byKey 只留**接受名**那一行（旧调用方拿单条的语义不变）；
      // 需要全部候选去判歧义的走 allByLatin。
      const prev = byKey.get(k);
      if (!prev || (e.is_accepted && !prev.is_accepted)) byKey.set(k, e);
      push(allByKey, k, e);
    }
    push(byBi, binomialKey(e.scientific_name), e);
    if (e.chinese_name) push(byZh, e.chinese_name.trim(), e);
    push(byFold, genderFoldKey(e.scientific_name), e);
  }
  return {
    byLatin: (k) => byKey.get(k) ?? null,
    allByLatin: (k) => allByKey.get(k) ?? [],
    byBinomial: (k) => byBi.get(k) ?? [],
    byChinese: (n) => byZh.get(n.trim()) ?? [],
    byGenderFold: (k) => byFold.get(k) ?? [],
  };
}

// ── 解析 ──────────────────────────────────────────────────────────────────────

export type NameInput = {
  /** 模型/编辑给的中文名（草稿的 title）。 */
  title?: string | null;
  /** 模型/编辑给的拉丁学名。 */
  scientificName?: string | null;
  /** 模型给的科（可能是中文、拉丁或"XX科 Xxxaceae"混排）。 */
  family?: string | null;
  genus?: string | null;
  /** 逗号分隔的中文俗名，一并收进别名。 */
  commonNamesZh?: string | null;
};

const clean = (s: string | null | undefined) => (s ?? "").replace(/[*_]/g, "").trim();

/** 「水麦冬科 Juncaginaceae」这种混排里把拉丁部分抠出来。 */
function latinPartOf(s: string): string {
  const m = clean(s).match(/[A-Z][a-z]+(?:aceae|idae|ales)\b/);
  return m ? m[0] : "";
}

function dedupeAliases(list: NameAlias[], accepted: (string | null)[]): NameAlias[] {
  const skip = new Set(accepted.filter(Boolean).map((x) => x!.trim()));
  const seen = new Set<string>();
  const out: NameAlias[] = [];
  for (const a of list) {
    const n = clean(a.name);
    if (!n || skip.has(n) || seen.has(n)) continue;
    seen.add(n);
    out.push({ name: n, kind: a.kind });
  }
  return out;
}

/**
 * 核对一份内容的名字，给出应当落库/展示的正名与别名。
 *
 * **不抛异常、不做网络**。任何拿不准的情况都退回 `unmatched` 并原样保留输入 ——
 * 核对机制卡住一条草稿的代价，远大于它漏掉一次改名。
 */
export function resolveName(input: NameInput, lookup: ChecklistLookup): NameVerdict {
  const inTitle = clean(input.title);
  const inSci = clean(input.scientificName);
  const commonNames = clean(input.commonNamesZh)
    .split(/[,，、;；]/)
    .map((x) => x.trim())
    .filter(Boolean);

  const base = (): NameVerdict => ({
    status: "unmatched",
    acceptedZh: inTitle || null,
    acceptedLa: inSci || null,
    familyLa: latinPartOf(input.family ?? "") || null,
    familyZh: null,
    genusLa: null,
    genusZh: null,
    aliases: [],
    matchedBy: "none",
    note: "",
  });

  const fromEntry = (
    e: ChecklistEntry,
    matchedBy: NameVerdict["matchedBy"],
    /** 输入的学名在名录里是个**异名**，本条是顺着 accepted_key 找到的正名。 */
    wasSynonym = false,
  ): NameVerdict => {
    const aliases: NameAlias[] = [];
    // 模型给的中文名与名录正名不同 → 它降级为别名。分不清是异名还是俗名，
    // 所以统一叫「别名」；只有当它同时是名录里**另一个物种**的正名时才值得警告。
    if (inTitle && e.chinese_name && inTitle !== e.chinese_name) {
      aliases.push({ name: inTitle, kind: "别名" });
    }
    // 模型给的学名写法与名录不同（大小写/性数/斜体/命名人）→ 记为异名待查
    if (inSci && canonicalKey(inSci) !== canonicalKey(e.scientific_name)) {
      // wasSynonym 时这是名录**认定**的异名；否则只是写法不同，也归到异名待查。
      aliases.push({ name: inSci, kind: "异名" });
    }
    for (const c of commonNames) aliases.push({ name: c, kind: "别名" });
    // 名录自带的中文俗名 —— 有了权威来源，不必再靠模型编「别名」。
    for (const c of e.common_names ?? []) aliases.push({ name: c, kind: "别名" });

    const changed =
      (!!inTitle && !!e.chinese_name && inTitle !== e.chinese_name) ||
      (!!inSci && canonicalKey(inSci) !== canonicalKey(e.scientific_name));

    const notes: string[] = [];
    if (wasSynonym) {
      // 这一句是 2026 版才敢说的：以前只能含糊地讲「写法不同」，现在名录明确
      // 告诉我们输入那个名字**是个异名**，以及它的正名是谁。
      notes.push(
        `《中国植物物种名录 2026》记载「${inSci}」为异名，正名是「${e.chinese_name ?? e.scientific_name}」（${e.scientific_name}），已按正名改写`,
      );
    } else if (changed) {
      notes.push(
        `已按《中国植物物种名录 2026》改用正名「${e.chinese_name ?? e.scientific_name}」` +
          `（${e.scientific_name}）`,
      );
    }
    if (matchedBy === "latin-fuzzy") {
      notes.push(
        `⚠️ 学名是按拉丁词尾性数折叠后匹配上的（原文「${inSci}」→ 名录「${e.scientific_name}」），请人工确认`,
      );
    }
    if (matchedBy === "latin-infraspecific") {
      notes.push(`名录中本双名下只有一个种下等级条目，已采用「${e.scientific_name}」`);
    }

    return {
      status: wasSynonym
        ? "synonym"
        : changed || matchedBy === "latin-fuzzy"
          ? "renamed"
          : "accepted",
      acceptedZh: e.chinese_name ?? inTitle ?? null,
      acceptedLa: e.scientific_name,
      familyLa: e.family_la,
      familyZh: e.family_zh,
      genusLa: e.genus_la,
      genusZh: e.genus_zh,
      aliases: dedupeAliases(aliases, [e.chinese_name, e.scientific_name]),
      matchedBy,
      note: notes.join("；"),
    };
  };

  // ① 拉丁名精确命中。
  //    2026 版起 name_key **不唯一**（577 组真·同名异物），所以先拿全部同键候选
  //    交给 collapseCandidates 收敛：同一正名的不同写法 → 取正名；正名与异名同键
  //    → 正名赢；多个不同正名同键 → 判歧义不猜。命中异名时顺 accepted_key 找正名。
  const key = canonicalKey(inSci);
  if (key) {
    const rows = lookup.allByLatin?.(key) ?? [];
    if (rows.length) {
      const col = collapseCandidates(rows, (k) => lookup.byLatin(k));
      if (col.ambiguous) {
        const v = base();
        v.status = "ambiguous";
        v.note =
          `「${inSci}」在《中国植物物种名录 2026》里对应 ${rows.length} 个**不同物种**的正名` +
          `（${[...new Set(rows.map((r) => r.family_la).filter(Boolean))].slice(0, 3).join(" / ")}），` +
          `这是同名异物，无法确定是哪一个，未改名。`;
        return v;
      }
      if (col.entry) return fromEntry(col.entry, "latin-exact", col.wasSynonym);
      if (col.wasSynonym) {
        // 名录说它是异名，但正名那一行不在表内（实测 6 条）→ 只标注，不改名。
        const v = base();
        v.status = "ambiguous";
        v.note = `《中国植物物种名录 2026》记载「${inSci}」为异名，但其正名条目缺失，未改名，请人工核对。`;
        return v;
      }
    }
    const exact = lookup.byLatin(key);
    if (exact) return fromEntry(exact, "latin-exact");

    // ② 模型给双名、名录里只有该双名的**唯一一个**种下等级条目 → 可以采用。
    //    多个种下等级时不猜（那是在替用户断言他没断言的事）。
    const bi = lookup.byBinomial(binomialKey(inSci));
    if (bi.length === 1 && canonicalKey(bi[0].scientific_name) !== key) {
      return fromEntry(bi[0], "latin-infraspecific");
    }
    if (bi.length > 1) {
      const v = base();
      v.status = "ambiguous";
      v.note =
        `名录中「${binomialKey(inSci)}」下有 ${bi.length} 个种下等级条目` +
        `（${bi.slice(0, 3).map((x) => x.scientific_name).join("、")}…），无法确定是哪一个，未改名。`;
      return v;
    }

    // ③ 性数折叠兜底 —— 明确标 fuzzy，必须人工确认
    const fold = lookup.byGenderFold?.(genderFoldKey(inSci)) ?? [];
    if (fold.length === 1) return fromEntry(fold[0], "latin-fuzzy");
  }

  // ④ 拉丁名没命中，试中文名反查
  if (inTitle) {
    const zh = lookup.byChinese(inTitle);
    if (zh.length === 1) {
      const v = fromEntry(zh[0], "chinese");
      // 中文命中但拉丁名对不上：这恰恰是最该让人看一眼的情况 —— 可能模型给的是异名，
      // 也可能它把中文名安到了错的物种上。所以**不采用**名录学名，只提示。
      if (inSci && canonicalKey(inSci) !== canonicalKey(zh[0].scientific_name)) {
        v.status = "ambiguous";
        v.acceptedLa = inSci;
        v.note =
          `中文名「${inTitle}」在名录中对应 ${zh[0].scientific_name}，` +
          `而本条给的学名是 ${inSci} —— 两者不一致，未自动改名，请人工核对。`;
        return v;
      }
      return v;
    }
    if (zh.length > 1) {
      const v = base();
      v.status = "ambiguous";
      v.note =
        `「${inTitle}」在名录中是 ${zh.length} 个物种的正名（同名异物：` +
        `${zh.map((x) => x.scientific_name).join("、")}），无法确定是哪一个。`;
      return v;
    }
  }

  // ⑤ 全没命中 —— 只标注，绝不改写
  const v = base();
  v.aliases = dedupeAliases(
    commonNames.map((n) => ({ name: n, kind: "别名" as AliasKind })),
    [inTitle, inSci],
  );
  // 2026 版名录已含 72,838 条异名，所以「模型用了旧名」这个可能性基本被排除了 ——
  // 走到这里多半是境外物种或识别有误。两种都不该自动改名。
  v.note = inSci
    ? `学名「${inSci}」不在《中国植物物种名录 2026》中（该名录已含 7.2 万条异名，` +
      `故「只是用了旧名」基本可排除）。可能是境外物种，或识别有误 —— ` +
      `已保留原名未作改动，请人工核对。`
    : "本条没有学名，无法与名录核对。";
  return v;
}

// ── 展示 ──────────────────────────────────────────────────────────────────────

/**
 * 把正名 + 别名拼成展示用标题：`海韭菜（别名：圆果水麦冬；异名：Triglochin maritimum）`
 * 同类别名合并在一个前缀下，避免「（别名：A）（别名：B）」这种碎片。
 */
export function formatTitleWithAliases(v: NameVerdict, maxAliases = 4): string {
  const main = v.acceptedZh || v.acceptedLa || "";
  if (!v.aliases.length) return main;
  const groups = new Map<AliasKind, string[]>();
  for (const a of v.aliases.slice(0, maxAliases)) {
    const g = groups.get(a.kind);
    if (g) g.push(a.name);
    else groups.set(a.kind, [a.name]);
  }
  const parts = [...groups.entries()].map(([k, names]) => `${k}：${names.join("、")}`);
  return `${main}（${parts.join("；")}）`;
}

/** 科的展示：`水麦冬科 Juncaginaceae`。名录没给中文科名时退回拉丁。 */
export function formatFamily(v: NameVerdict): string {
  if (v.familyZh && v.familyLa) return `${v.familyZh} ${v.familyLa}`;
  return v.familyZh || v.familyLa || "";
}

/** 核对结论要不要拦人工看一眼。 */
export function needsReview(v: NameVerdict): boolean {
  return v.status === "ambiguous" || v.matchedBy === "latin-fuzzy";
}
