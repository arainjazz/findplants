#!/usr/bin/env python3
"""Generate the CITES + GRIIS conservation seed migrations.

GRIIS: real data pulled from the GBIF-hosted "GRIIS - China" checklist
(dataset 6d11211b-caa0-4e63-b99c-e944099d5017): 450 plant species, degree
derived from the SpeciesProfile isInvasive flag (Invasive -> 'invasive',
otherwise 'established'). The 4-level DwC granularity (casual/widespreadInvasive)
is NOT present in the GBIF version, so only invasive/established are used.
Input: /tmp/griis_final.json (produced by the GBIF fetch step).

CITES: China-relevant subset of the stable whole-family / whole-genus plant
listings in the CITES Appendices, plus a handful of species-level Chinese
listings. Encoded at family/genus/species rank. Appendix values 'I'/'II'.

Both seeds are idempotent (DELETE-by-kind then INSERT) and emit NULL::text[]
for empty excluded_names (Postgres text[] gotcha).
"""
import json, unicodedata, re, sys

def norm(s):
    # Mirror of JS normalizeSciName (src/lib/catalogs.ts). The hybrid marker (× or a
    # standalone "x") is dropped: "Populus × irtyschensis" -> "populus irtyschensis".
    if not s:
        return ""
    v = unicodedata.normalize("NFKD", s)
    v = "".join(c for c in v if not unicodedata.combining(c))
    v = re.sub(r"[*_]", "", v)  # markdown emphasis (AI-written italic names)
    v = re.sub(r"\([^)]*\)", " ", v)
    v = re.sub(r"[×✕⨯]", " ", v)
    v = re.sub(r"\s+", " ", v).strip().lower()
    toks = [t for t in v.split(" ") if t and t != "x"]
    if len(toks) >= 2:
        v = f"{toks[0]} {toks[1]}"
        return v
    return toks[0] if toks else ""

def norm_genus(s):
    # single-token normalization for genus/family rank; drops the nothogenus
    # marker so "×Chitalpa" -> "chitalpa" rather than "xchitalpa".
    v = unicodedata.normalize("NFKD", s)
    v = "".join(c for c in v if not unicodedata.combining(c))
    v = re.sub(r"[×✕⨯]", " ", v)
    toks = [t for t in re.sub(r"\s+", " ", v).strip().lower().split(" ") if t and t != "x"]
    return toks[0] if toks else ""

def sql_str(s):
    return "'" + s.replace("'", "''") + "'"

def excl_sql(names):
    if not names:
        return "NULL::text[]"
    inner = ",".join(sql_str(norm(n)) for n in names)
    return f"ARRAY[{inner}]::text[]"

def row(sci, zh, status, rank, excl=None):
    n = norm_genus(sci) if rank in ("genus", "family") else norm(sci)
    zh_sql = sql_str(zh) if zh else "NULL"
    return f"  ({sql_str(sci)}, {sql_str(n)}, {zh_sql}, {sql_str(status)}, {sql_str(rank)}, {excl_sql(excl)})"

# ── CITES ────────────────────────────────────────────────────────────────────
# (taxon, chinese, appendix, rank, excluded)
CITES = [
    # Whole families (App II) — no China-native App I members in these families.
    ("Cactaceae", "仙人掌科", "II", "family", None),
    ("Cyatheaceae", "桫椤科", "II", "family", None),
    # Tree-fern genera (App II) — for genus-token matching (plants carry Latin genus).
    ("Alsophila", "桫椤属", "II", "genus", None),
    ("Gymnosphaera", "黑桫椤属", "II", "genus", None),
    ("Sphaeropteris", "白桫椤属", "II", "genus", None),
    ("Cyathea", "桫椤属", "II", "genus", None),
    # Cycads (App II).
    ("Cycas", "苏铁属", "II", "genus", None),
    # Carnivorous pitcher plants (App II).
    ("Nepenthes", "猪笼草属", "II", "genus", None),
    # Agarwood (App II, whole genus since 2005).
    ("Aquilaria", "沉香属", "II", "genus", None),
    # Rosewood (App II, whole genus since CoP17 2017).
    ("Dalbergia", "黄檀属", "II", "genus", None),
    # Yews (App II — all Chinese Taxus species listed).
    ("Taxus", "红豆杉属", "II", "genus", None),
    # Aloes (App II) — except the cultivated Aloe vera.
    ("Aloe", "芦荟属", "II", "genus", ["Aloe vera"]),
    # Orchid genera (all Orchidaceae are App II except the App I genera below).
    ("Dendrobium", "石斛属", "II", "genus", None),
    ("Cymbidium", "兰属", "II", "genus", None),
    ("Bletilla", "白及属", "II", "genus", None),
    ("Bulbophyllum", "石豆兰属", "II", "genus", None),
    ("Gastrodia", "天麻属", "II", "genus", None),
    ("Pleione", "独蒜兰属", "II", "genus", None),
    ("Cypripedium", "杓兰属", "II", "genus", None),
    ("Calanthe", "虾脊兰属", "II", "genus", None),
    ("Habenaria", "玉凤花属", "II", "genus", None),
    ("Liparis", "羊耳蒜属", "II", "genus", None),
    ("Goodyera", "斑叶兰属", "II", "genus", None),
    ("Spiranthes", "绶草属", "II", "genus", None),
    ("Anoectochilus", "开唇兰属", "II", "genus", None),
    ("Phalaenopsis", "蝴蝶兰属", "II", "genus", None),
    ("Vanda", "万代兰属", "II", "genus", None),
    # Orchid genera in Appendix I.
    ("Paphiopedilum", "兜兰属", "I", "genus", None),
    # Species-level Chinese listings (App II).
    ("Cibotium barometz", "金毛狗", "II", "species", None),
    ("Cistanche deserticola", "肉苁蓉", "II", "species", None),
    ("Dioscorea deltoidea", "三角叶薯蓣", "II", "species", None),
    ("Podophyllum hexandrum", "桃儿七", "II", "species", None),
    ("Sinopodophyllum hexandrum", "桃儿七", "II", "species", None),
    ("Rauvolfia serpentina", "蛇根木", "II", "species", None),
    # Species-level Chinese listing (App I).
    ("Saussurea costus", "云木香", "I", "species", None),
    # ── Additional China-relevant I/II confirmed from the official 2023 booklet ──
    ("Rhodiola", "红景天属", "II", "genus", None),          # 景天科 Rhodiola spp. II
    ("Nardostachys grandiflora", "甘松", "II", "species", None),  # 败酱科 II ★中国
    ("Renanthera imschootiana", "云南火焰兰", "I", "species", None),  # 兰科 App I ★中国
    # ── Appendix III (from CITES 2023 附录III; full plant listing) ──────────────
    # China-distributed (★) — the ones that actually match Chinese flora.
    ("Quercus mongolica", "蒙古栎", "III", "species", None),        # 壳斗科（俄罗斯列入）
    ("Pinus koraiensis", "红松", "III", "species", None),          # 松科（俄罗斯列入）
    ("Fraxinus mandshurica", "水曲柳", "III", "species", None),     # 木樨科（俄罗斯列入）
    ("Gnetum montanum", "买麻藤", "III", "species", None),         # 买麻藤科（尼泊尔列入）
    ("Podocarpus neriifolius", "百日青", "III", "species", None),   # 罗汉松科（尼泊尔列入）
    ("Tetracentron sinense", "水青树", "III", "species", None),     # 水青树科（尼泊尔列入）
    ("Magnolia liliifera", "盖裂木", "III", "species", None),       # 木兰科（尼泊尔列入 var. obovata）
    # Non-China country listings (South Africa / Seychelles etc.) — complete the appendix.
    ("Conophytum", "肉锥花属", "III", "genus", None),              # 番杏科（南非）
    ("Mestoklema tuberosum", "块茎密叶枝玉", "III", "species", None),
    ("Raphionacme zeyheri", "绿花白皮玉", "III", "species", None),
    ("Crassothonna clavifolia", "棒叶敦菊木", "III", "species", None),
    ("Othonna armiana", "疣基厚敦菊", "III", "species", None),
    ("Othonna cacalioides", "蟹甲厚敦菊", "III", "species", None),
    ("Othonna euphorbioides", "刺烛厚敦菊", "III", "species", None),
    ("Othonna retrorsa", "反折厚敦菊", "III", "species", None),
    ("Tylecodon bodleyae", "毛花奇峰木", "III", "species", None),
    ("Tylecodon nolteei", "厚叶奇峰木", "III", "species", None),
    ("Tylecodon reticulatus", "网状奇峰木", "III", "species", None),
    ("Monsonia herrei", "刺羽龙骨葵", "III", "species", None),
    ("Monsonia multifida", "多裂龙骨葵", "III", "species", None),
    ("Monsonia patersonii", "硬皮龙骨葵", "III", "species", None),
    ("Pelargonium crassicaule", "粗茎天竺葵", "III", "species", None),
    ("Pelargonium triste", "羽叶天竺葵", "III", "species", None),
    ("Lodoicea maldivica", "巨籽棕", "III", "species", None),
    ("Meconopsis regia", "尼泊尔绿绒蒿", "III", "species", None),
    ("Adenia spinosa", "多刺蒴莲", "III", "species", None),
    ("Portulacaria pygmaea", "矮瓷玲珑", "III", "species", None),
]

CITES_NOTE = ("《濒危野生动植物种国际贸易公约》(CITES) 附录 I/II/III 植物条目（据 2023-02-23 生效版官方中文本整理）。"
              "附录 I/II 收录与中国相关的主要类群（整科/整属统一管制条目 + 中国分布的种级条目，如红景天属、甘松、云南火焰兰等）；"
              "附录 III 收录全部植物条目，其中蒙古栎、红松、水曲柳、买麻藤、百日青、水青树等为中国分布种（由俄罗斯/尼泊尔单方列入）。"
              "多肉大戟属（仅多肉种受管）、人参（仅俄罗斯种群受管）等无法按学名精确区分的条目未纳入。"
              "来源：CITES 附录 I、II 和 III（2023 年 2 月 23 日生效）中华人民共和国濒危物种进出口管理办公室编印。")

def emit_cites():
    lines = []
    lines.append("-- Seed: CITES 附录（中国相关） 国际贸易管制. kind=cites.")
    lines.append("-- Idempotent: clears all cites taxa/lists before re-inserting.")
    lines.append("-- China-relevant subset of stable whole-family/genus CITES plant listings + key species.")
    lines.append("DELETE FROM public.conservation_taxa t USING public.conservation_lists l")
    lines.append("  WHERE t.list_id = l.id AND l.kind = 'cites';")
    lines.append("DELETE FROM public.conservation_lists WHERE kind = 'cites';")
    lines.append("WITH new_list AS (")
    lines.append("  INSERT INTO public.conservation_lists (kind, name, province, version, source_url, source_note)")
    lines.append("  VALUES ('cites', 'CITES 附录（中国相关）', NULL, '2023',")
    lines.append("          'https://cites.org/eng/app/appendices.php',")
    lines.append(f"          {sql_str(CITES_NOTE)})")
    lines.append("  RETURNING id")
    lines.append(")")
    lines.append("INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)")
    lines.append("SELECT nl.id, v.sci, v.norm, v.zh, v.status, v.rank, v.excl FROM new_list nl, (VALUES")
    body = [row(sci, zh, st, rk, ex) for (sci, zh, st, rk, ex) in CITES]
    lines.append(",\n".join(body))
    lines.append(") AS v(sci, norm, zh, status, rank, excl);")
    return "\n".join(lines) + "\n"

# ── GRIIS ────────────────────────────────────────────────────────────────────
GRIIS_NOTE = ("全球外来入侵物种数据库中国名录（GRIIS - China），经 GBIF 托管版本（数据集 6d11211b-caa0-4e63-b99c-e944099d5017）导出的植物类群，"
              "共 450 种。入侵等级来自 GBIF SpeciesProfile 的 isInvasive 标记：Invasive→invasive（明确入侵），其余→established（已建群外来种）；"
              "GBIF 托管版本不含 casual/widespreadInvasive 的四级细分，故本名录仅区分 invasive/established 两级。来源：GBIF GRIIS - China。")

def emit_griis(data):
    seen = set()
    rows = []
    for o in data:
        sci = (o.get("sci") or "").strip()
        if not sci:
            continue
        n = norm(sci)
        if not n or n in seen:
            continue
        seen.add(n)
        rows.append(row(sci, None, o["degree"], "species", None))
    lines = []
    lines.append("-- Seed: GRIIS 全球入侵等级（中国名录） GRIIS-China. kind=griis.")
    lines.append("-- Idempotent: clears all griis taxa/lists before re-inserting.")
    lines.append(f"-- {len(rows)} plant species from the GBIF-hosted GRIIS-China checklist.")
    lines.append("DELETE FROM public.conservation_taxa t USING public.conservation_lists l")
    lines.append("  WHERE t.list_id = l.id AND l.kind = 'griis';")
    lines.append("DELETE FROM public.conservation_lists WHERE kind = 'griis';")
    lines.append("WITH new_list AS (")
    lines.append("  INSERT INTO public.conservation_lists (kind, name, province, version, source_url, source_note)")
    lines.append("  VALUES ('griis', 'GRIIS 全球入侵等级（中国）', NULL, '2023',")
    lines.append("          'https://www.gbif.org/dataset/6d11211b-caa0-4e63-b99c-e944099d5017',")
    lines.append(f"          {sql_str(GRIIS_NOTE)})")
    lines.append("  RETURNING id")
    lines.append(")")
    lines.append("INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)")
    lines.append("SELECT nl.id, v.sci, v.norm, v.zh, v.status, v.rank, v.excl FROM new_list nl, (VALUES")
    lines.append(",\n".join(rows))
    lines.append(") AS v(sci, norm, zh, status, rank, excl);")
    return "\n".join(lines) + "\n", len(rows)

# ── GTS (GlobalTree red list) ────────────────────────────────────────────────
GTS_NOTE = ("GlobalTree 全球树木红色名录（中国受威胁树种）。物种范围取自 BGCI GlobalTreeSearch 的中国树种清单（GlobalTreeSearch_China.csv，"
            "共 4554 种），濒危等级 CR/EN/VU 由该清单逐种比对 IUCN 红色名录（经 GBIF species/iucnRedListCategory 获取，"
            "Global Tree Assessment 的评估结果即发布于 IUCN 红色名录）后取受威胁子集。仅保留 CR/EN/VU；LC/NT/DD/未评估的树种不纳入。"
            "来源：BGCI GlobalTreeSearch (tools.bgci.org/global_tree_search.php) + IUCN 红色名录（经 GBIF）。")

def emit_gts(data):
    seen = set()
    rows = []
    for o in data:
        sci = (o.get("taxon") or "").strip()
        code = o.get("code")
        if not sci or code not in ("CR", "EN", "VU"):
            continue
        n = norm(sci)
        if not n or n in seen:
            continue
        seen.add(n)
        rows.append(row(sci, None, code, "species", None))
    lines = []
    lines.append("-- Seed: GTS 全球树木红色名录（中国受威胁树种） GlobalTree. kind=gts.")
    lines.append("-- Idempotent: clears all gts taxa/lists before re-inserting.")
    lines.append(f"-- {len(rows)} threatened (CR/EN/VU) China trees: GlobalTreeSearch China × IUCN Red List.")
    lines.append("DELETE FROM public.conservation_taxa t USING public.conservation_lists l")
    lines.append("  WHERE t.list_id = l.id AND l.kind = 'gts';")
    lines.append("DELETE FROM public.conservation_lists WHERE kind = 'gts';")
    lines.append("WITH new_list AS (")
    lines.append("  INSERT INTO public.conservation_lists (kind, name, province, version, source_url, source_note)")
    lines.append("  VALUES ('gts', 'GTS 全球树木红色名录（中国）', NULL, '2023',")
    lines.append("          'https://tools.bgci.org/global_tree_search.php',")
    lines.append(f"          {sql_str(GTS_NOTE)})")
    lines.append("  RETURNING id")
    lines.append(")")
    lines.append("INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)")
    lines.append("SELECT nl.id, v.sci, v.norm, v.zh, v.status, v.rank, v.excl FROM new_list nl, (VALUES")
    lines.append(",\n".join(rows))
    lines.append(") AS v(sci, norm, zh, status, rank, excl);")
    return "\n".join(lines) + "\n", len(rows)

if __name__ == "__main__":
    base = "supabase/migrations"
    cites_sql = emit_cites()
    with open(f"{base}/20260703210000_seed_cites_china.sql", "w") as f:
        f.write(cites_sql)
    print(f"wrote CITES seed: {len(CITES)} taxa")

    griis_data = json.load(open("/tmp/griis_final.json"))
    griis_sql, n = emit_griis(griis_data)
    with open(f"{base}/20260703220000_seed_griis_china.sql", "w") as f:
        f.write(griis_sql)
    print(f"wrote GRIIS seed: {n} taxa (from {len(griis_data)} fetched)")

    import os
    if os.path.exists("/tmp/gts_final.json"):
        gts_data = json.load(open("/tmp/gts_final.json"))
        gts_sql, ng = emit_gts(gts_data)
        with open(f"{base}/20260703230000_seed_gts_china.sql", "w") as f:
            f.write(gts_sql)
        print(f"wrote GTS seed: {ng} threatened taxa (from {len(gts_data)} CR/EN/VU fetched)")
    else:
        print("GTS: /tmp/gts_final.json not found — skipped")
