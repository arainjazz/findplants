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
   * 想要的器官，**按优先级排列**。第一个拿不到就退而求其次。
   * 空数组 = 什么都行（兜底槽）。
   */
  want: Organ[];
  /** 缺图时写在页面上的中文说明，如「暂无该物种的花期公开照片」。 */
  missingNote: string;
};

/** 草稿页 5 个分区图槽（对应 plant-html-template 的 sec_img_1..5）。 */
export const DRAFT_SLOTS: SlotSpec[] = [
  { key: "名称和分类趣闻", want: ["plant", "habitat"], missingNote: "暂无该物种的植株公开照片" },
  { key: "形态特征", want: ["leaf", "flower", "plant"], missingNote: "暂无该物种的叶部公开照片" },
  { key: "生境与分布", want: ["habitat", "plant"], missingNote: "暂无该物种的生境公开照片" },
  {
    // 人文栏现在是 Section I（首栏），别老空着。允许回落到植株、插画/标本（specimen），
    // 但**刻意不收 habitat**（用户 2026-07-25：生境图不该配在人文这里兜底）——
    // 生境图有它自己的「生境与分布」栏，挪来人文栏既跑题又会把那栏抽空。
    key: "植物人文",
    want: ["flower", "fruit", "specimen", "plant"],
    missingNote: "暂无该物种的公开配图",
  },
  { key: "生长条件", want: ["plant", "habitat", "leaf"], missingNote: "暂无该物种的植株公开照片" },
];

/** 金叶详页 9 个图槽：6 张特征卡（根株/茎/叶/花/果/物候）+ 生境全景 + 2 张人文配图。 */
export const GOLD_SLOTS: SlotSpec[] = [
  { key: "特征卡·根与株型", want: ["plant"], missingNote: "暂无该物种的株型公开照片" },
  { key: "特征卡·茎", want: ["plant", "leaf"], missingNote: "暂无该物种的茎部公开照片" },
  { key: "特征卡·叶", want: ["leaf"], missingNote: "暂无该物种的叶部公开照片" },
  { key: "特征卡·花", want: ["flower"], missingNote: "暂无该物种的花期公开照片" },
  { key: "特征卡·果实与种子", want: ["fruit"], missingNote: "暂无该物种的果实公开照片" },
  {
    key: "特征卡·物候与繁殖",
    want: ["flower", "fruit"],
    missingNote: "暂无该物种的花果期公开照片",
  },
  { key: "生境全景", want: ["habitat", "plant"], missingNote: "暂无该物种的生境公开照片" },
  { key: "人文·科学绘图", want: ["specimen"], missingNote: "暂无该物种的标本或图版" },
  { key: "人文·图像", want: ["flower", "plant", "fruit"], missingNote: "暂无可用的人文配图" },
];

export type SlotAssignment = {
  spec: SlotSpec;
  /** 命中的图；null = 这个器官确实没有可用的公开照片。 */
  photo: PhotoCandidate | null;
  /** 是否降级命中（拿到的不是 want[0]）。仅用于日志与统计。 */
  fallback: boolean;
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
  const out: SlotAssignment[] = specs.map((spec) => ({ spec, photo: null, fallback: false }));

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

  const places = new Set<string>();

  // 第一轮：只发首选器官。
  out.forEach((a) => {
    const first = a.spec.want[0];
    if (!first) return;
    const hit = take(first, places);
    if (hit) a.photo = hit;
  });

  // 第二轮：还空着的槽按优先级降级。
  out.forEach((a) => {
    if (a.photo) return;
    for (const w of a.spec.want.slice(1)) {
      const hit = take(w, places);
      if (hit) {
        a.photo = hit;
        a.fallback = true;
        return;
      }
    }
    // want 为空 = 兜底槽，什么都能要。
    if (a.spec.want.length === 0) {
      for (const c of cands) {
        if (used.has(c.url)) continue;
        used.add(c.url);
        a.photo = c;
        a.fallback = true;
        return;
      }
    }
  });

  return out;
}

/** 分配结果的一行摘要，打日志用。 */
export function describeAssignment(out: SlotAssignment[]): string {
  const filled = out.filter((a) => a.photo).length;
  const fallbacks = out.filter((a) => a.fallback).length;
  const missing = out.filter((a) => !a.photo).map((a) => a.spec.key);
  return (
    `${filled}/${out.length} 槽有图（其中 ${fallbacks} 个降级命中）` +
    (missing.length ? `；缺：${missing.join("、")}` : "")
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
