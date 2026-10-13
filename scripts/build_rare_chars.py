#!/usr/bin/env python3
"""Build public/data/chars-extra.tsv.gz: readings and definitions for rare Han characters
that Unihan lacks, taken from English Wiktionary via kaikki.org (wiktextract, CC BY-SA 4.0).

Usage (run with python3 -I):
  build_rare_chars.py <repo-root> [--refetch]

Step 1 streams the ~1.2 GB Chinese extraction through curl and keeps only single-character
entries in <repo>/.cache/raw/kaikki/chars.jsonl (a few MB). Step 2 merges them against
public/data/chars.tsv.gz and writes the supplement.
"""
import gzip, json, os, re, subprocess, sys, unicodedata, random
from collections import Counter, defaultdict

URL = "https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl"
UA = "Dushu-data-builder/0.1"

BLOCKS = [
    (0x3400, 0x4DBF, "Ext A"), (0x4E00, 0x9FFF, "URO"), (0xF900, 0xFAFF, "Compat"),
    (0x20000, 0x2A6DF, "Ext B"), (0x2A700, 0x2B73F, "Ext C"), (0x2B740, 0x2B81F, "Ext D"),
    (0x2B820, 0x2CEAF, "Ext E"), (0x2CEB0, 0x2EBEF, "Ext F"), (0x2F800, 0x2FA1F, "Compat Supp"),
    (0x30000, 0x3134F, "Ext G"), (0x31350, 0x323AF, "Ext H"), (0x2EBF0, 0x2EE5F, "Ext I"),
    (0x323B0, 0x3347F, "Ext J"), (0x2E80, 0x2FDF, "Radicals"),
]


def block_of(cp):
    for lo, hi, name in BLOCKS:
        if lo <= cp <= hi:
            return name
    return "Other"


def is_han(ch):
    return block_of(ord(ch)) != "Other"


def fetch(raw_path):
    os.makedirs(os.path.dirname(raw_path), exist_ok=True)
    cmd = ["curl", "-sS", "--fail", "-A", UA, URL]
    tmp = raw_path + ".part"
    n = kept = 0
    with subprocess.Popen(cmd, stdout=subprocess.PIPE) as p, open(tmp, "w", encoding="utf-8") as out:
        for line in p.stdout:
            n += 1
            # entries are large; skip the JSON parse unless the line could be a one-character word
            if not re.search(rb'"word": "(?:[^"\\]|\\.){1,12}"', line):
                continue
            d = json.loads(line)
            w = d.get("word", "")
            if len(w) != 1 or not is_han(w):
                continue
            keep = {
                "word": d["word"], "pos": d.get("pos", ""),
                "sounds": [s for s in d.get("sounds", []) if "zh_pron" in s and "Mandarin" in s.get("tags", [])],
                "glosses": [g for s in d.get("senses", []) for g in s.get("glosses", [])],
                "head": [t.get("expansion", "") for t in d.get("head_templates", [])],
            }
            out.write(json.dumps(keep, ensure_ascii=False) + "\n")
            kept += 1
        if p.wait() != 0:
            raise SystemExit("curl failed; kept nothing")
    os.replace(tmp, raw_path)
    print(f"fetched {n} lines, kept {kept} single-character entries", file=sys.stderr)


# ---------------------------------------------------------------- pinyin ---

TONE = {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}
MARKED = {c: (b, i + 1) for b, cs in TONE.items() for i, c in enumerate(cs)}
SYL = re.compile(r"^[a-zü]+$")


def is_syllable(s):
    """A plausible tone-marked or plain pinyin syllable (no digits, no Latin junk)."""
    d = unicodedata.normalize("NFC", s)
    return bool(d) and len(d) <= 7 and bool(re.fullmatch(r"[a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ]+", d))


def numbered_to_marked(s):
    m = re.fullmatch(r"([a-zü]+?)([1-5])", s)
    if not m:
        return s
    base, t = m.group(1), int(m.group(2))
    if t == 5:
        return base
    i = None
    for k in ("a", "e"):
        if k in base:
            i = base.index(k)
            break
    if i is None and "ou" in base:
        i = base.index("o")
    if i is None:
        vs = [j for j, c in enumerate(base) if c in TONE]
        i = vs[-1] if vs else None
    if i is None:
        return base
    return base[:i] + TONE[base[i]][t - 1] + base[i + 1:]


def clean_reading(r):
    r = unicodedata.normalize("NFC", r.strip().lower().replace("u:", "ü").replace("v", "ü") if re.search(r"\d", r) else r.strip().lower())
    if re.search(r"\d", r):
        r = numbered_to_marked(r)
    r = unicodedata.normalize("NFC", r)
    return r if is_syllable(r) else ""


def readings_of(entry):
    out = []
    for s in entry["sounds"]:
        tags = s.get("tags", [])
        if "Pinyin" not in tags and "Hanyu-Pinyin" not in tags:
            continue
        if "Mandarin" not in tags or "Cantonese" in tags:
            continue
        pron = s["zh_pron"]
        # "ēi (ei¹)" -> keep the part before any parenthesis
        pron = re.sub(r"\(.*?\)", "", pron)
        for part in re.split(r"[,;/、]", pron):
            r = clean_reading(part)
            if r and r not in out:
                out.append(r)
    return out


# ----------------------------------------------------------- definitions ---

VARIANT = re.compile(r"^(?:\w[\w ,'-]*? )?(?:alternative|alternate|variant|obsolete|archaic|dated|nonstandard|non-standard|simplified|traditional|ancient|erhua|Japanese|Korean|Vietnamese)\b.*?\b(?:form|variant|spelling|character|of)\b", re.I)
PURE_VARIANT = re.compile(r"^(?:(?:alternative|alternate|obsolete|archaic|variant|ancient|nonstandard|non-standard|dated|rare|simplified|traditional|standard|Japanese|Korean|Vietnamese)\b[^;]*?\b(?:form|variant|spelling|character|writing) of\b|(?:alternative|variant|obsolete|ancient) (?:form|character) of\b|(?:Alternative|Variant|Obsolete) (?:of|for)\b|(?:erhua|Taiwanese|Hong Kong)\b.*\bof\b)", re.I)
SKIP = re.compile(r"^(?:\s*$|\(.*?\)\s*$|.*\bromanization\b.*|.*\bpronunciation spelling\b.*)", re.I)


def clean_gloss(g):
    g = re.sub(r"\s+", " ", g).strip().rstrip(".;, ")
    return g


def definition_of(entries):
    good, weak = [], []
    for e in entries:
        for g in e["glosses"]:
            g = clean_gloss(g)
            if not g or SKIP.match(g) or "Please see" in g:
                continue
            if "Chinese character" in g and "unknown" in g.lower():
                continue
            if g.lower().startswith(("(radical", "kangxi radical")) and False:
                continue
            (weak if PURE_VARIANT.match(g) else good).append(g)
    chosen = good or weak
    seen, res = set(), []
    for g in chosen:
        if g not in seen:
            seen.add(g)
            res.append(g)
    out = ""
    for g in res:
        cand = g if not out else out + "; " + g
        if len(cand) > 300:
            break
        out = cand
    if not out and res:
        out = res[0][:300]
    return out.replace("\t", " ").replace("\n", " ")


# ------------------------------------------------------------------ main ---

def load_unihan(path):
    rows = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            p = line.rstrip("\n").split("\t")
            rows[p[0]] = (p[1] if len(p) > 1 else "", p[2] if len(p) > 2 else "")
    return rows


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = args[0] if args else "."
    raw = os.path.join(root, ".cache/raw/kaikki/chars.jsonl")
    if "--refetch" in sys.argv or not os.path.exists(raw):
        fetch(raw)
    uni = load_unihan(os.path.join(root, "public/data/chars.tsv.gz"))

    by_char = defaultdict(list)
    with open(raw, encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            by_char[e["word"]].append(e)

    rows, stats = [], Counter()
    no_r = [c for c, (r, d) in uni.items() if not r and is_han(c)]
    no_d = [c for c, (r, d) in uni.items() if not d and is_han(c)]
    gained_r, gained_d = Counter(), Counter()
    totals = Counter(block_of(ord(c)) for c in uni)
    for ch in sorted(by_char, key=ord):
        if ch not in uni:
            stats["not in unihan table"] += 1
            continue
        ur, ud = uni[ch]
        ents = by_char[ch]
        rd = []
        for e in ents:
            for r in readings_of(e):
                if r not in rd:
                    rd.append(r)
        df = definition_of(ents)
        new_r = rd if not ur else []
        new_d = df if not ud else ""
        if not new_r and not new_d:
            continue
        rows.append((ch, ",".join(new_r), new_d))
        b = block_of(ord(ch))
        if new_r:
            gained_r[b] += 1
        if new_d:
            gained_d[b] += 1

    out = os.path.join(root, "public/data/chars-extra.tsv.gz")
    with open(out, "wb") as raw_f:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_f, mtime=0, compresslevel=9) as gz:
            gz.write("# Wiktionary via kaikki.org (wiktextract) — CC BY-SA 4.0, https://kaikki.org/ . "
                     "Fills gaps in Unihan only.\n".encode())
            gz.write("# char<TAB>readings (tone marks, comma-sep)<TAB>definition ('; '-joined, max 300 chars)\n".encode())
            for r in rows:
                gz.write(("\t".join(r) + "\n").encode())

    print(f"rows: {len(rows)}   Unihan reading-less: {len(no_r)}   definition-less: {len(no_d)}")
    print(f"reading-less chars that gained a reading: {sum(gained_r.values())}")
    print(f"definition-less chars that gained a definition: {sum(gained_d.values())}")
    print(f"{'block':12} {'total':>7} {'+reading':>9} {'+defn':>7}")
    for _, _, name in BLOCKS:
        if totals[name] or gained_r[name] or gained_d[name]:
            print(f"{name:12} {totals[name]:7} {gained_r[name]:9} {gained_d[name]:7}")
    random.seed(7)
    print("spot checks:")
    for ch, r, d in random.sample(rows, min(10, len(rows))):
        print(f"  {ch} U+{ord(ch):04X}  {r or '-'}  |  {d[:110]}")


if __name__ == "__main__":
    main()
