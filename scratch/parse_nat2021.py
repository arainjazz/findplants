#!/usr/bin/env python3
# Parse the national 2021 protected-plant list into a seed migration for
# conservation_lists + conservation_taxa. Reliability over cleverness: every taxon
# line ends with 一级/二级, which is our record detector.
import re, sys, unicodedata

SRC = "/sessions/affectionate-gracious-hopper/mnt/plantspedia/scratch/nat2021_raw.txt"

def fold(s: str) -> str:
    """Strip combining diacritics: Isoëtes -> Isoetes, Houpoëa -> Houpoea."""
    return "".join(c for c in unicodedata.normalize("NFKD", s) if not unicodedata.combining(c))

def norm(s: str) -> str:
    """Mirror of JS normalizeSciName (src/lib/catalogs.ts): fold diacritics, drop
    parenthesised authorities, drop the hybrid marker (× or a standalone "x"),
    collapse ws, lowercase, keep first two tokens (genus + species).

    The marker is dropped, not kept: "Populus × irtyschensis" -> "populus irtyschensis".
    Keeping it truncated every hybrid in a genus to the same "<genus> x" key.
    Must stay byte-for-byte equivalent to the JS — this column is matched against it."""
    s = fold(s)
    s = re.sub(r"[*_]", "", s)  # markdown emphasis (AI-written italic names)
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"[×✕⨯]", " ", s)  # also splits the attached "×irtyschensis" form
    s = re.sub(r"\s+", " ", s).strip().lower()
    toks = [t for t in s.split(" ") if t and t != "x"]
    if len(toks) >= 2:
        return f"{toks[0]} {toks[1]}"
    return toks[0] if toks else ""

def norm_excl(name: str) -> str:
    return norm(name)

rows = []
with open(SRC, encoding="utf-8") as f:
    for raw in f:
        line = raw.rstrip("\n").strip()
        if not line:
            continue
        # Record detector: taxon lines end with the protection level.
        if line.endswith("一级"):
            level = "一级"
        elif line.endswith("二级"):
            level = "二级"
        else:
            continue  # family header / section / column header — skip
        body = line[: -len(level)].strip()

        # Split Chinese (prefix) from Latin (from first ASCII letter onward).
        m = re.search(r"[A-Za-z]", body)
        if not m:
            print("WARN no latin:", line, file=sys.stderr)
            continue
        zh = body[: m.start()].strip().rstrip("*").strip()
        latin = body[m.start():].strip()

        # Pull out the (excl. ...) clause if present.
        em = re.search(r"\(excl\.(.*?)\)", latin)
        excl_raw = em.group(1).strip() if em else ""
        latin_core = re.sub(r"\s*\(excl\..*?\)", "", latin).strip()

        # Rank + normalized key. Capture the group genus so exclusion abbreviations
        # ("K. davidiana") can be expanded against it.
        group_genus = None
        if "spp." in latin_core:
            pre = latin_core.split("spp.")[0].strip()
            first = pre.split()[0]
            group_genus = first
            fl = fold(first).lower()
            if "sect." in latin_core:
                # Section-level group (e.g. Camellia sect. Thea). We can't resolve section
                # membership from a binomial, and a genus-wide match would false-flag common
                # ornamentals (山茶/牡丹). Tag as 'section' — matcher ignores it (no auto-flag).
                rank, normalized = "section", fl
            elif fl.endswith("aceae") or fl.endswith("ceae"):
                rank, normalized = "family", fl
            else:
                rank, normalized = "genus", fl
            sci = latin_core
        else:
            rank, normalized, sci = "species", norm(latin_core), latin_core

        excludes = []
        if excl_raw:
            last_genus = group_genus  # seed with the group's genus for "X." abbreviations
            for part in re.split(r"[,&]", excl_raw):
                p = part.strip()
                if not p:
                    continue
                toks = p.split()
                if re.match(r"^[A-Z]\.$", toks[0]):
                    if last_genus:
                        toks[0] = last_genus
                else:
                    last_genus = toks[0]
                e = norm_excl(" ".join(toks))
                if e:
                    excludes.append(e)

        rows.append(dict(sci=sci, zh=zh, status=level, rank=rank,
                         normalized=normalized, excludes=excludes))

# ---- validation summary ----
from collections import Counter
by_rank = Counter(r["rank"] for r in rows)
by_level = Counter(r["status"] for r in rows)
norms = [r["normalized"] for r in rows]
dups = [n for n, c in Counter(norms).items() if c > 1]
print(f"total taxa: {len(rows)}", file=sys.stderr)
print(f"by rank: {dict(by_rank)}", file=sys.stderr)
print(f"by level: {dict(by_level)}", file=sys.stderr)
print(f"duplicate normalized keys ({len(dups)}): {dups[:20]}", file=sys.stderr)

def sq(s: str) -> str:
    return "'" + s.replace("'", "''") + "'"

def arr(lst):
    if not lst:
        return "NULL"
    return "ARRAY[" + ",".join(sq(x) for x in lst) + "]"

out = []
out.append("-- Seed: 国家重点保护野生植物名录 (2021). Generated from official gov.cn PDF.")
out.append("-- 455 species + 40 categories. * (农业农村部管辖) markers dropped from names.")
out.append("-- Idempotent: clears any prior 国家(2021) protected list before re-inserting.")
out.append("")
out.append("DELETE FROM public.conservation_taxa t USING public.conservation_lists l")
out.append("  WHERE t.list_id = l.id AND l.kind = 'protected' AND l.province = '国家';")
out.append("DELETE FROM public.conservation_lists WHERE kind = 'protected' AND province = '国家';")
out.append("")
out.append("WITH new_list AS (")
out.append("  INSERT INTO public.conservation_lists (kind, name, province, version, effective_date, source_url)")
out.append("  VALUES ('protected', '国家（2021）', '国家', '2021', DATE '2021-09-07',")
out.append("          'https://www.gov.cn/zhengce/zhengceku/2021-09/09/content_5636409.htm')")
out.append("  RETURNING id")
out.append(")")
out.append("INSERT INTO public.conservation_taxa (list_id, scientific_name, normalized_name, chinese_name, status, rank, excluded_names)")
out.append("SELECT nl.id, v.sci, v.norm, v.zh, v.status, v.rank, v.excl")
out.append("FROM new_list nl, (VALUES")
vals = []
for r in rows:
    zh = sq(r["zh"]) if r["zh"] else "NULL"
    excl = arr(r["excludes"])
    vals.append(f"  ({sq(r['sci'])}, {sq(r['normalized'])}, {zh}, {sq(r['status'])}, {sq(r['rank'])}, {excl})")
out.append(",\n".join(vals))
out.append(") AS v(sci, norm, zh, status, rank, excl);")
out.append("")

with open("/sessions/affectionate-gracious-hopper/mnt/plantspedia/scratch/nat2021_seed.sql", "w", encoding="utf-8") as f:
    f.write("\n".join(out))
print("wrote nat2021_seed.sql", file=sys.stderr)
