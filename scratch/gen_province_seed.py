#!/usr/bin/env python3
# Generic provincial protected-list seed generator.
# TSV lines: "zh<TAB>sci"  (species)  OR  "FAMILY<TAB>zhFamily<TAB>LatinFamily" (family group).
# Provincial lists have no 一级/二级 sub-levels -> status = '省级'.
# Usage: gen_province_seed.py <tsv> <province> <listName> <version> <sourceUrl> <outSql>
import re, sys, unicodedata

tsv, province, list_name, version, source_url, out_sql = sys.argv[1:7]

def fold(s): return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))
def norm(s):
    # Mirror of JS normalizeSciName (src/lib/catalogs.ts). The hybrid marker (× or a
    # standalone "x") is dropped: "Populus × irtyschensis" -> "populus irtyschensis".
    s = fold(s); s = re.sub(r"[*_]", "", s); s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"[×✕⨯]", " ", s)
    s = re.sub(r"\s+", " ", s).strip().lower(); t = [x for x in s.split(" ") if x and x != "x"]
    return f"{t[0]} {t[1]}" if len(t) >= 2 else (t[0] if t else "")

rows = []
seen = set()
for raw in open(tsv, encoding="utf-8"):
    line = raw.rstrip("\n")
    if not line.strip():
        continue
    parts = line.split("\t")
    if parts[0] == "FAMILY":
        zh, latin = parts[1].strip(), parts[2].strip()
        rows.append(dict(sci=latin + " spp.", zh=zh, rank="family", normalized=fold(latin).lower(), excl=[]))
        continue
    if len(parts) < 2:
        print("WARN skip:", line, file=sys.stderr); continue
    zh, sci = parts[0].strip(), parts[1].strip()
    n = norm(sci)
    key = ("species", n)
    if key in seen:
        print("DUP:", n, zh, file=sys.stderr); continue
    seen.add(key)
    rows.append(dict(sci=sci, zh=zh, rank="species", normalized=n, excl=[]))

from collections import Counter
print(f"{province}: {len(rows)} taxa | ranks={dict(Counter(r['rank'] for r in rows))}", file=sys.stderr)

def sq(s): return "'" + s.replace("'", "''") + "'"
def arr(l): return "NULL::text[]" if not l else "ARRAY[" + ",".join(sq(x) for x in l) + "]"

o = []
o.append(f"-- Seed: {list_name} 省级重点保护野生植物名录. province={province}.")
o.append("-- Idempotent: clears this province's protected list before re-inserting.")
o.append("DELETE FROM public.conservation_taxa t USING public.conservation_lists l")
o.append(f"  WHERE t.list_id = l.id AND l.kind = 'protected' AND l.province = {sq(province)};")
o.append(f"DELETE FROM public.conservation_lists WHERE kind = 'protected' AND province = {sq(province)};")
o.append("WITH new_list AS (")
o.append("  INSERT INTO public.conservation_lists (kind, name, province, version, source_url)")
o.append(f"  VALUES ('protected', {sq(list_name)}, {sq(province)}, {sq(version)}, {sq(source_url)})")
o.append("  RETURNING id")
o.append(")")
o.append("INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)")
o.append("SELECT nl.id, v.sci, v.norm, v.zh, '省级', v.rank, v.excl FROM new_list nl, (VALUES")
vals = [f"  ({sq(r['sci'])}, {sq(r['normalized'])}, {sq(r['zh'])}, {sq(r['rank'])}, {arr(r['excl'])})" for r in rows]
o.append(",\n".join(vals))
o.append(") AS v(sci, norm, zh, rank, excl);")
open(out_sql, "w", encoding="utf-8").write("\n".join(o) + "\n")
print("wrote", out_sql, file=sys.stderr)
