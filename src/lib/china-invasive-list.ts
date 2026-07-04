/**
 * 中国外来入侵物种名单 — the four official batches published by the environmental
 * authority (2003–2016), plus whether each species is also on the 《重点管理外来
 * 入侵物种名录》(农业农村部 567 号公告, 2022). Static reference data (40 species);
 * used to annotate the invasive-species card with 批次 + 重点管理 status, which is
 * factual and must NOT be left to the LLM. Matched by normalized binomial.
 */

export type ChinaInvasiveEntry = {
  batch: string; // 第一批 / 第二批 / …
  date: string; // 发布时间
  publisher: string; // 发布单位
  chinese: string; // 中文名
  family: string; // 科名
  keyManaged: boolean; // 是否纳入《重点管理外来入侵物种名录》
};

/** genus-species (lowercase) → entry. */
const RAW: Array<[string, ChinaInvasiveEntry]> = [
  ["Alternanthera philoxeroides", { batch: "第一批", date: "2003-01-10", publisher: "原国家环保总局", chinese: "空心莲子草", family: "苋科", keyManaged: true }],
  ["Ageratina adenophora", { batch: "第一批", date: "2003-01-10", publisher: "原国家环保总局", chinese: "破坏草", family: "菊科", keyManaged: true }],
  ["Ambrosia artemisiifolia", { batch: "第一批", date: "2003-01-10", publisher: "原国家环保总局", chinese: "豚草", family: "菊科", keyManaged: true }],
  ["Chromolaena odorata", { batch: "第一批", date: "2003-01-10", publisher: "原国家环保总局", chinese: "飞机草", family: "菊科", keyManaged: true }],
  ["Mikania micrantha", { batch: "第一批", date: "2003-01-10", publisher: "原国家环保总局", chinese: "薇甘菊", family: "菊科", keyManaged: true }],
  ["Lolium temulentum", { batch: "第一批", date: "2003-01-10", publisher: "原国家环保总局", chinese: "毒麦", family: "禾本科", keyManaged: false }],
  ["Sorghum halepense", { batch: "第一批", date: "2003-01-10", publisher: "原国家环保总局", chinese: "假高粱", family: "禾本科", keyManaged: true }],
  ["Spartina alterniflora", { batch: "第一批", date: "2003-01-10", publisher: "原国家环保总局", chinese: "互花米草", family: "禾本科", keyManaged: true }],
  ["Eichhornia crassipes", { batch: "第一批", date: "2003-01-10", publisher: "原国家环保总局", chinese: "凤眼莲", family: "雨久花科", keyManaged: true }],
  ["Amaranthus spinosus", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "刺苋", family: "苋科", keyManaged: true }],
  ["Dysphania ambrosioides", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "土荆芥", family: "苋科", keyManaged: false }],
  ["Pistia stratiotes", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "大薸", family: "天南星科", keyManaged: true }],
  ["Ambrosia trifida", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "三裂叶豚草", family: "菊科", keyManaged: true }],
  ["Flaveria bidentis", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "黄顶菊", family: "菊科", keyManaged: true }],
  ["Parthenium hysterophorus", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "银胶菊", family: "菊科", keyManaged: true }],
  ["Solidago canadensis", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "加拿大一枝黄花", family: "菊科", keyManaged: true }],
  ["Anredera cordifolia", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "落葵薯", family: "落葵科", keyManaged: true }],
  ["Cenchrus echinatus", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "蒺藜草", family: "禾本科", keyManaged: false }],
  ["Lantana camara", { batch: "第二批", date: "2010-01-07", publisher: "环境保护部", chinese: "马缨丹", family: "马鞭草科", keyManaged: true }],
  ["Amaranthus retroflexus", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "反枝苋", family: "苋科", keyManaged: false }],
  ["Aster subulatus", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "钻叶紫菀", family: "菊科", keyManaged: false }],
  ["Bidens pilosa", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "三叶鬼针草", family: "菊科", keyManaged: true }],
  ["Conyza canadensis", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "小蓬草", family: "菊科", keyManaged: true }],
  ["Conyza sumatrensis", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "苏门白酒草", family: "菊科", keyManaged: true }],
  ["Erigeron annuus", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "一年蓬", family: "菊科", keyManaged: false }],
  ["Praxelis clematidea", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "假臭草", family: "菊科", keyManaged: true }],
  ["Xanthium spinosum", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "刺苍耳", family: "菊科", keyManaged: true }],
  ["Ipomoea purpurea", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "圆叶牵牛", family: "旋花科", keyManaged: false }],
  ["Cenchrus longispinus", { batch: "第三批", date: "2014-08-15", publisher: "环保部 + 中科院", chinese: "长刺蒺藜草", family: "禾本科", keyManaged: true }],
  ["Amaranthus palmeri", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "长芒苋", family: "苋科", keyManaged: true }],
  ["Ageratum conyzoides", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "藿香蓟", family: "菊科", keyManaged: true }],
  ["Bidens frondosa", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "大狼杷草", family: "菊科", keyManaged: false }],
  ["Cabomba caroliniana", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "水盾草", family: "莼菜科", keyManaged: true }],
  ["Ipomoea cairica", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "五爪金龙", family: "旋花科", keyManaged: true }],
  ["Sicyos angulatus", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "刺果瓜", family: "葫芦科", keyManaged: true }],
  ["Mimosa bimucronata", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "光荚含羞草", family: "豆科", keyManaged: true }],
  ["Phytolacca americana", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "垂序商陆", family: "商陆科", keyManaged: true }],
  ["Avena fatua", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "野燕麦", family: "禾本科", keyManaged: true }],
  ["Solanum aculeatissimum", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "喀西茄", family: "茄科", keyManaged: false }],
  ["Solanum rostratum", { batch: "第四批", date: "2016-12-12", publisher: "环保部 + 中科院", chinese: "黄花刺茄", family: "茄科", keyManaged: true }],
];

const norm = (s: string) =>
  (s || "").toLowerCase().replace(/[×✕]/g, " ").replace(/\s+/g, " ").trim().split(" ").slice(0, 2).join(" ");

const INDEX = new Map<string, ChinaInvasiveEntry>(RAW.map(([sci, e]) => [norm(sci), e]));

/** Look up a species (any binomial form incl. authorship) in the national list. */
export function lookupChinaInvasive(scientificName: string | null | undefined): ChinaInvasiveEntry | null {
  const key = norm(scientificName || "");
  if (!key) return null;
  return INDEX.get(key) ?? null;
}

/** For the "第几批" filter, in publication order. */
export const CHINA_INVASIVE_BATCHES = ["第一批", "第二批", "第三批", "第四批"] as const;
