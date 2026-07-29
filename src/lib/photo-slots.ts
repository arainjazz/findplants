/**
 * 配图**按器官入槽** —— 兑现「配图能展示叶、花、果、生境」。
 *
 * 改造前的做法是**按位置**填：`sec_img_1..5` 顺序塞进固定小节，没有任何机制保证第 2 张
 * 真的是花。而 2026-07-20 实测，iNat 的器官标注覆盖率低到撑不起这件事：
 *   沙冬青 1/20 · 柠条锦鸡儿 4/40 · 玫瑰 10/40 · 蒲公英 4/40
 * 所以器官标签必须由**视觉模型现看现标**（见 identify-plant.functions.ts 的
 * classifyPhotoOrgans），本模块负责拿到标签之后的分配。
 *
 * 最重要的一条设计：**缺某个器官就如实说「暂无花期公开照片」，绝不拿一张随机图糊过去。**
 * 对一个科普站而言，诚实比填满更值钱 —— 一张标着「花」的叶子特写，比一个空槽伤害大得多。
 *
 * 纯函数，无网络无数据库 —— `scratch/photo-slots.test.mjs` 直接跑本体。
 */

import type { Organ, PhotoCandidate } from "./species-photos";

export type SlotSpec = {
  /** 模板里的槽位名，仅用于日志。 */
  key: string;
  /**
   * 想要的器官，**按优先级排列**。第一个拿不到就顺着往下退。
   *
   * 📌 2026-07-29 起**每个槽都必须列全 6 个器官**（用户决定：不再允许空槽）。
   * 从前这里只写 1–3 个，`want` 之外一律拒收，于是金叶的「果实」「科学绘图」等
   * 单器官刚性槽常年空着。现在 `want` 是**完整的降级链**，链末仍拿不到时还有
   * 第三、四轮兜底（见 assignSlots），只有候选池**一张图都没有**才会真的空。
   */
  want: Organ[];
  /** 连一张候选都没有时（极罕见）写在页面上的说明。 */
  missingNote: string;
};

/** 器官的中文短名 —— 图注要如实说出画面里实际是什么。 */
const ORGAN_ZH: Record<Organ, string> = {
  leaf: "叶",
  flower: "花",
  fruit: "果实",
  plant: "植株",
  habitat: "生境",
  specimen: "标本或图版",
  "": "",
};

/**
 * 草稿页 5 个分区图槽（对应 plant-html-template 的 sec_img_1..5）。
 *
 * 每条 `want` 都列全 6 个器官 —— 前几位是这一栏**真正想要**的，后面纯属兜底。
 * 顺序不是随手排的：它决定了「实在没有花的时候，这一栏宁可要什么」。
 */
export const DRAFT_SLOTS: SlotSpec[] = [
  {
    key: "名称和分类趣闻",
    want: ["plant", "habitat", "specimen", "leaf", "flower", "fruit"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "形态特征",
    want: ["leaf", "flower", "fruit", "plant", "specimen", "habitat"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "生境与分布",
    want: ["habitat", "plant", "leaf", "flower", "fruit", "specimen"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    // 人文栏是 Section I（首栏）。花/果/图版最贴题，生境排最后 ——
    // 它有自己的「生境与分布」栏，太早挪过来会把那栏抽空。
    key: "植物人文",
    want: ["flower", "fruit", "specimen", "plant", "leaf", "habitat"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "生长条件",
    want: ["plant", "habitat", "leaf", "flower", "fruit", "specimen"],
    missingNote: "暂无该物种的公开配图",
  },
];

/**
 * 金叶详页 9 个图槽：6 张特征卡（根株/茎/叶/花/果/物候）+ 生境全景 + 2 张人文配图。
 *
 * ⚠️ 这里从前有 **5 个单器官刚性槽**（叶/花/果/科学绘图各只认一种器官，零降级余地），
 * 是金叶配图常年大面积留空的直接原因 —— 尤其「果实与种子」和「人文·科学绘图」。
 * 现已全部改成完整降级链。
 */
export const GOLD_SLOTS: SlotSpec[] = [
  {
    key: "特征卡·根与株型",
    want: ["plant", "habitat", "leaf", "specimen", "flower", "fruit"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "特征卡·茎",
    want: ["plant", "leaf", "specimen", "habitat", "flower", "fruit"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "特征卡·叶",
    want: ["leaf", "plant", "specimen", "flower", "fruit", "habitat"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "特征卡·花",
    want: ["flower", "fruit", "plant", "specimen", "leaf", "habitat"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "特征卡·果实与种子",
    want: ["fruit", "flower", "plant", "specimen", "leaf", "habitat"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "特征卡·物候与繁殖",
    want: ["flower", "fruit", "plant", "leaf", "specimen", "habitat"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "生境全景",
    want: ["habitat", "plant", "leaf", "flower", "fruit", "specimen"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "人文·科学绘图",
    want: ["specimen", "plant", "flower", "leaf", "fruit", "habitat"],
    missingNote: "暂无该物种的公开配图",
  },
  {
    key: "人文·图像",
    want: ["flower", "plant", "fruit", "leaf", "habitat", "specimen"],
    missingNote: "暂无该物种的公开配图",
  },
];

export type SlotAssignment = {
  spec: SlotSpec;
  /** 命中的图；null 只在**候选池一张图都没有**时出现。 */
  photo: PhotoCandidate | null;
  /** 是否降级命中（拿到的不是 want[0]）。仅用于日志与统计。 */
  fallback: boolean;
  /**
   * 降级命中时的**如实说明**，如「图为植株 · 该物种的果实照片暂缺」。
   *
   * 不留空槽是用户 2026-07-29 的决定，但「这张图画的是什么」不能跟着一起含糊 ——
   * 一张标着「果实」的植株照会误导读者，而一句图注就能同时满足「有图」和「不骗人」。
   * `want[0]` 命中时为空串（图就是这一栏要的东西，无需解释）。
   */
  mismatchNote: string;
  /** 这张图是不是重复使用了（候选比槽少时的最后兜底）。 */
  reused: boolean;
};

/**
 * 把候选按器官分配到槽位。
 *
 * 算法刻意分两轮：
 *  - **第一轮只认首选器官**（`want[0]`）。先保证「叶槽拿到叶、花槽拿到花」，
 *    再谈别的 —— 否则一个 want 靠前的槽会把后面槽唯一的那张花给吃掉。
 *  - **第二轮按优先级降级**，同一张图不会被两个槽用（`used`）。
 *
 * 关键：**绝不拿 want 之外的图填槽**。宁可留空并写明缺什么，也不要把一张叶子摆在
 * 「花」的位置上 —— 那是对读者的误导，比空槽严重得多。
 * 唯一例外是 `want: []` 的兜底槽（当前没有，留作扩展）。
 */
export function assignSlots(cands: PhotoCandidate[], specs: SlotSpec[]): SlotAssignment[] {
  const used = new Set<string>();
  const out: SlotAssignment[] = specs.map((spec) => ({
    spec,
    photo: null,
    fallback: false,
    mismatchNote: "",
    reused: false,
  }));

  const take = (want: Organ, avoidPlaces: Set<string>): PhotoCandidate | null => {
    // 同一拍摄地/同一摄影者的图先跳过一轮，避免整页都是同一个人同一天拍的。
    for (const relax of [false, true]) {
      for (const c of cands) {
        if (used.has(c.url) || c.organ !== want) continue;
        if (!relax && c.place && avoidPlaces.has(c.place)) continue;
        used.add(c.url);
        if (c.place) avoidPlaces.add(c.place);
        return c;
      }
    }
    return null;
  };

  /** 降级命中时的如实图注。拿不到器官名（未知标签）就只说「暂缺」，不编。 */
  const noteFor = (spec: SlotSpec, got: PhotoCandidate): string => {
    const wantedZh = ORGAN_ZH[spec.want[0] ?? ""] || "";
    const gotZh = ORGAN_ZH[got.organ] || "";
    if (!wantedZh) return "";
    if (!gotZh) return `该物种的${wantedZh}照片暂缺，此处为其它公开配图`;
    return `图为${gotZh} · 该物种的${wantedZh}照片暂缺`;
  };

  const places = new Set<string>();

  // 第一轮：只发首选器官。先保证「叶槽拿到叶、花槽拿到花」。
  out.forEach((a) => {
    const first = a.spec.want[0];
    if (!first) return;
    const hit = take(first, places);
    if (hit) a.photo = hit;
  });

  // 第二轮：还空着的槽按 want 顺序降级。want 现在列全了 6 个器官，所以只要池子里
  // 还有**任何已识别器官**的余图，这一轮基本都能填上。
  out.forEach((a) => {
    if (a.photo) return;
    for (const w of a.spec.want.slice(1)) {
      const hit = take(w, places);
      if (hit) {
        a.photo = hit;
        a.fallback = true;
        a.mismatchNote = noteFor(a.spec, hit);
        return;
      }
    }
  });

  // 第三轮：**器官未知**（organ === ""）的余图也收。
  // 视觉分类失败、或模型判 other 的图会落在这里 —— 从前它们命不中任何 want，
  // 于是「分类一失败 → 整页零配图」。现在它们是最后一批真正的候选。
  out.forEach((a) => {
    if (a.photo) return;
    for (const c of cands) {
      if (used.has(c.url)) continue;
      used.add(c.url);
      a.photo = c;
      a.fallback = true;
      a.mismatchNote = noteFor(a.spec, c);
      return;
    }
  });

  // 第四轮：候选**比槽还少**时复用已用过的图，保证不留空（用户 2026-07-29 的要求）。
  // 优先复用「本站用户实拍」—— 那是拍的这一株、这个季节、这个地点，比任何外部图都贴题；
  // 其次按顺序复用。整页可能出现同一张图两次，这是「不留空」的必然代价，已知并接受。
  const pool = cands.filter((c) => used.has(c.url));
  if (pool.length) {
    const ordered = [
      ...pool.filter((c) => c.sourceName === "本站用户实拍"),
      ...pool.filter((c) => c.sourceName !== "本站用户实拍"),
    ];
    let k = 0;
    out.forEach((a) => {
      if (a.photo) return;
      const c = ordered[k++ % ordered.length];
      a.photo = c;
      a.fallback = true;
      a.reused = true;
      a.mismatchNote = noteFor(a.spec, c);
    });
  }

  return out;
}

/** 分配结果的一行摘要，打日志用。 */
export function describeAssignment(out: SlotAssignment[]): string {
  const filled = out.filter((a) => a.photo).length;
  const fallbacks = out.filter((a) => a.fallback).length;
  const reused = out.filter((a) => a.reused).length;
  const missing = out.filter((a) => !a.photo).map((a) => a.spec.key);
  return (
    `${filled}/${out.length} 槽有图（降级 ${fallbacks} 个，其中复用 ${reused} 张）` +
    // 走到这一步还缺，说明候选池**一张图都没有** —— 是检索/许可闸门的问题，不是分配的问题。
    (missing.length ? `；仍缺（候选池为空）：${missing.join("、")}` : "")
  );
}

/**
 * 视觉模型返回的器官标签 → 我们的 Organ。
 * 认不出来的一律归 `""`（= 未知，不会被任何槽的 want 命中，等于自动弃用）——
 * **猜一个器官比留空危险**：它会让一张莫名其妙的图堂而皇之地占住「花」的位置。
 */
export function normalizeOrgan(raw: unknown): Organ {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (/^leaf|叶/.test(s)) return "leaf";
  if (/^flower|花/.test(s)) return "flower";
  if (/^fruit|seed|果|种子/.test(s)) return "fruit";
  if (/^habitat|生境|景观/.test(s)) return "habitat";
  if (/^specimen|herbarium|illustration|标本|图版|绘图/.test(s)) return "specimen";
  if (/^plant|whole|株|植株/.test(s)) return "plant";
  return "";
}
