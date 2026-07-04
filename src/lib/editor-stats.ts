// Pure aggregation helpers for the homepage "Contributors" column.
// No DB access here — the raw rows are fetched server-side (admin client) and
// passed to aggregateEditorColumn, so anonymous homepage visitors get the stats
// without needing direct (RLS-restricted) read access to user_roles/profiles.

export type EditorColumnEntry = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  joined_at: string | null;
  /** Activity areas, formatted as 省市的区县、区县；省市的区县 */
  areas: string;
  /** 红框：提交编辑量（text=1, image=2, catalog_create=2, tag_create=1；不含已撤销） */
  editScore: number;
  /** 蓝圈：AI 识别 + 草稿编辑（识别=1, 更改配图=1, 更改文字=1） */
  identifyScore: number;
  /** 绿圈：已发表博客数 */
  blogScore: number;
  total: number;
};

export type RawStatsData = {
  roles: { user_id: string; role: string }[];
  profiles: { id: string; display_name: string | null; avatar_url: string | null; created_at: string | null }[];
  edits: { editor_id: string; kind: string; reverted: boolean | null }[];
  drafts: { created_by: string | null; capture_place: string | null }[];
  blogs: { author_id: string; published: boolean }[];
};

const EDIT_WEIGHTS: Record<string, number> = {
  text: 1,
  image: 2,
  catalog_create: 2,
  tag_create: 1,
};

const PROVINCE_PREFIX =
  /^(内蒙古自治区|广西壮族自治区|宁夏回族自治区|新疆维吾尔自治区|西藏自治区|内蒙古|广西|宁夏|新疆|西藏|北京市|天津市|上海市|重庆市|北京|天津|上海|重庆|香港特别行政区|澳门特别行政区|香港|澳门|[一-龥]{2,3}省)/;

/** Reduce a reverse-geocoded place string to a city-level label. Best-effort. */
export function cityOf(place: string | null | undefined): string | null {
  if (!place) return null;
  let s = place.trim();
  if (!s) return null;
  s = s.replace(PROVINCE_PREFIX, "");
  const m =
    s.match(/^([一-龥]{2,6}?市)/) || // clean city at the start, e.g. 鄂尔多斯市
    s.match(/([一-龥]{2,4}市)/) || // any city token
    s.match(/^([一-龥]{2,4}?(?:区|县|旗|盟|州))/); // clean district at the start, e.g. 康巴什区 / 伊金霍洛旗
  if (m) return m[1];
  return null; // unparseable (e.g. street-level strings) → omit rather than show garbage
}

// ─── China admin-division backfill ──────────────────────────────────────────
// Reverse-geocoded strings have inconsistent granularity: some skip the
// prefecture city ("内蒙古自治区康巴什区…", "海南省秀英区美好路"), some give only a
// district ("伊金霍洛旗"), some only a city ("鄂尔多斯市"). This directory lets us
// backfill the missing province/city from a known district (or province from a
// bare city) so every record for a place collapses onto the same 省→市→区
// hierarchy. Seeded for the site's focus regions (Ordos / Hainan); extend as
// new areas appear.
const CITY_DIRECTORY: { province: string; city: string; districts: string[] }[] = [
  {
    province: "内蒙古自治区",
    city: "鄂尔多斯市",
    districts: ["东胜区", "康巴什区", "达拉特旗", "准格尔旗", "鄂托克前旗", "鄂托克旗", "杭锦旗", "乌审旗", "伊金霍洛旗"],
  },
  {
    // 榆林市与鄂尔多斯接壤；定边县是陕/蒙/宁三省交界县，逆地理编码常把临界点误判到
    // 内蒙古一侧（"内蒙古自治区定边县"），靠这张表把已知区县权威地纠回陕西。
    // 这些县名全国唯一，强制归属安全。
    province: "陕西省",
    city: "榆林市",
    districts: ["榆阳区", "横山区", "神木市", "府谷县", "靖边县", "定边县", "绥德县", "米脂县", "佳县", "吴堡县", "清涧县", "子洲县"],
  },
  { province: "海南省", city: "海口市", districts: ["秀英区", "龙华区", "琼山区", "美兰区"] },
  { province: "海南省", city: "三亚市", districts: ["海棠区", "吉阳区", "天涯区", "崖州区"] },
];

const DISTRICT_TO_CITY = new Map<string, { province: string; city: string }>();
const CITY_TO_PROVINCE = new Map<string, string>();
for (const c of CITY_DIRECTORY) {
  CITY_TO_PROVINCE.set(c.city, c.province);
  for (const d of c.districts) DISTRICT_TO_CITY.set(d, { province: c.province, city: c.city });
}

// Short provincial-unit names → canonical full form, so "内蒙古" and
// "内蒙古自治区" land in the same group.
const PROVINCE_CANON: Record<string, string> = {
  内蒙古: "内蒙古自治区",
  广西: "广西壮族自治区",
  宁夏: "宁夏回族自治区",
  新疆: "新疆维吾尔自治区",
  西藏: "西藏自治区",
  香港: "香港特别行政区",
  澳门: "澳门特别行政区",
};

// Township / street / road tokens that must never be mistaken for a district.
const STREET_NOISE = /^[一-龥]{2,8}?(?:街道办事处|街道办|街道|苏木|嘎查|社区|镇|乡|村)/;

/** First known district name occurring anywhere in the string (robust to
 *  street noise like "兴盛街道办东胜区"). */
function findKnownDistrict(s: string): string {
  for (const d of DISTRICT_TO_CITY.keys()) if (s.includes(d)) return d;
  return "";
}

/** Parse a reverse-geocoded place into province / city / district tokens,
 *  backfilling skipped levels from the directory and dropping street noise. */
export function parsePlace(place: string | null | undefined): { province: string; city: string; district: string } {
  const empty = { province: "", city: "", district: "" };
  if (!place) return empty;
  let s = place.trim();
  if (!s) return empty;
  let province = "";
  let city = "";
  const muni = s.match(/^(北京|上海|天津|重庆)市?/);
  if (muni) {
    city = muni[1] + "市";
    s = s.slice(muni[0].length);
  } else {
    const prov = s.match(
      /^(内蒙古自治区|广西壮族自治区|宁夏回族自治区|新疆维吾尔自治区|西藏自治区|香港特别行政区|澳门特别行政区|[一-龥]{2,3}省|内蒙古|广西|宁夏|新疆|西藏|香港|澳门)/,
    );
    if (prov) {
      province = PROVINCE_CANON[prov[1]] ?? prov[1];
      s = s.slice(prov[0].length);
    }
    // A city token must NOT swallow a 区/县/旗 — otherwise a "district-before-city"
    // geocode like "康巴什区鄂尔多斯市…" gets grabbed whole as the city and splits
    // the group into garbage ("内蒙古自治区康巴什区鄂尔多斯市康巴什区").
    const cityM = s.match(/^((?:(?![区县旗])[一-龥]){2,8}?(?:市|自治州|地区|盟))/);
    if (cityM) {
      city = cityM[1];
      s = s.slice(cityM[0].length);
    }
  }
  // District: prefer a known district found anywhere (survives street noise);
  // else strip a leading township/street token and match 区/县/旗 (not 市 — a
  // trailing 市 is a county-level city, handled above, never a district).
  let district = findKnownDistrict(place);
  if (!district) {
    const distM = s.replace(STREET_NOISE, "").match(/^([一-龥]{2,6}?(?:区|县|旗))/);
    district = distM ? distM[1] : "";
  }
  // Backfill / correct levels. A known district is AUTHORITATIVE for its
  // province+city, so override rather than fill-if-empty — otherwise a garbled
  // city parsed from a "district-before-city" geocode would survive and split
  // the group.
  const known = district ? DISTRICT_TO_CITY.get(district) : undefined;
  if (known) {
    province = known.province;
    city = known.city;
  }
  if (city && !province) province = CITY_TO_PROVINCE.get(city) ?? "";
  return { province, city, district };
}

/**
 * Normalize a raw `capture_place` into a tidy, consistent label for
 * lists/cards/tables. Our stored strings have inconsistent granularity
 * (e.g. "鄂尔多斯市" vs "内蒙古自治区康巴什区青春山街道呼和塔拉路"); this drops the
 * province prefix and street-level noise, keeping the city + district level
 * that's comparable across records. Falls back to the trimmed original when
 * nothing parseable is found (so we never drop a real place), and returns ""
 * for empty input (callers append their own "未知地点").
 */
export function displayPlace(place: string | null | undefined): string {
  if (!place) return "";
  const trimmed = place.trim();
  if (!trimmed) return "";
  const { city, district } = parsePlace(trimmed);
  if (city && district && district !== city) return city + district;
  if (district) return district;
  if (city) return city;
  return trimmed; // street-only / unrecognized → keep original rather than drop
}

/**
 * Format a set of place strings into 省市区、区；省市区 — grouped by province+city,
 * districts within each ordered by how many records mention them (most first),
 * and the groups themselves ordered by total records (most active area first).
 */
export function formatActivityAreas(places: (string | null | undefined)[]): string {
  type Group = { head: string; total: number; order: number; districts: Map<string, number> };
  const byKey = new Map<string, Group>();
  let seq = 0;
  for (const place of places) {
    const { province, city, district } = parsePlace(place);
    const head = province + city;
    const key = head || district;
    if (!key) continue;
    let g = byKey.get(key);
    if (!g) {
      g = { head, total: 0, order: seq++, districts: new Map() };
      byKey.set(key, g);
    }
    g.total += 1;
    if (district && district !== city) {
      g.districts.set(district, (g.districts.get(district) ?? 0) + 1);
    }
  }
  const groups = Array.from(byKey.values()).sort((a, b) => b.total - a.total || a.order - b.order);
  const parts = groups.map((g) => {
    const ds = Array.from(g.districts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .map(([d]) => d);
    if (g.head && ds.length) return `${g.head}${ds.join("、")}`;
    if (g.head) return g.head;
    return ds.join("、");
  });
  return parts.join("；");
}

export function aggregateEditorColumn(d: RawStatsData): EditorColumnEntry[] {
  const ids = Array.from(new Set((d.roles ?? []).map((r) => r.user_id))).filter(Boolean);
  const profById = new Map((d.profiles ?? []).map((p) => [p.id, p]));

  const entries: EditorColumnEntry[] = ids.map((id) => {
    const prof = profById.get(id);

    let editScore = 0;
    let draftImage = 0;
    let draftText = 0;
    for (const e of d.edits ?? []) {
      if (e.editor_id !== id) continue;
      if (e.kind === "draft_image") draftImage += 1;
      else if (e.kind === "draft_text") draftText += 1;
      else if (!e.reverted) editScore += EDIT_WEIGHTS[e.kind] ?? 0;
    }

    let identifyCount = 0;
    const places: (string | null)[] = [];
    for (const dr of d.drafts ?? []) {
      if (dr.created_by !== id) continue;
      identifyCount += 1;
      places.push(dr.capture_place);
    }

    let blogScore = 0;
    for (const b of d.blogs ?? []) {
      if (b.author_id === id && b.published) blogScore += 1;
    }

    const identifyScore = identifyCount + draftImage + draftText;
    return {
      id,
      display_name: prof?.display_name || "编辑者",
      avatar_url: prof?.avatar_url ?? null,
      joined_at: prof?.created_at ?? null,
      areas: formatActivityAreas(places),
      editScore,
      identifyScore,
      blogScore,
      total: editScore + identifyScore + blogScore,
    };
  });

  return entries
    .filter((e) => e.total > 0 || e.areas.length > 0)
    .sort((a, b) => b.total - a.total || a.display_name.localeCompare(b.display_name, "zh"));
}
