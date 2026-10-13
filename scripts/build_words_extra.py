#!/usr/bin/env python3
"""Build public/data/cedict-extra.tsv.gz: multi-character words that CC-CEDICT lacks, taken from
English Wiktionary via kaikki.org (wiktextract, CC BY-SA 4.0). Same format as cedict.tsv.gz.

Usage (run with python3 -I):
  build_words_extra.py <repo-root> [--refetch]

Step 1 streams the ~1.2 GB Chinese extraction through curl and keeps entries whose headword is
2+ Han code points in <repo>/.cache/raw/kaikki/words.jsonl. Step 2 converts and writes the file.
"""
import gzip, json, os, re, subprocess, sys, unicodedata
from collections import Counter, defaultdict

URL = "https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl"
UA = "Dushu-data-builder/0.1"

HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿〇\U00020000-\U0003347f]")


def all_han(w):
    return len(w) >= 1 and all(HAN.fullmatch(c) for c in w)


def fetch(raw_path):
    os.makedirs(os.path.dirname(raw_path), exist_ok=True)
    tmp = raw_path + ".part"
    n = kept = 0
    with subprocess.Popen(["curl", "-sS", "--fail", "-A", UA, URL], stdout=subprocess.PIPE) as p, \
            open(tmp, "w", encoding="utf-8") as out:
        for line in p.stdout:
            n += 1
            m = re.match(rb'.*?"word": "((?:[^"\\]|\\.)*)"', line[:4000000], re.S)
            if not m:
                continue
            d = json.loads(line)
            w = d.get("word", "")
            if len(w) < 2 or not all_han(w) or d.get("pos") == "character":
                continue
            keep = {
                "word": w, "pos": d.get("pos", ""),
                "sounds": [s for s in d.get("sounds", []) if "zh_pron" in s and "Mandarin" in s.get("tags", [])],
                "forms": [{"form": f.get("form", ""), "tags": f.get("tags", [])} for f in d.get("forms", [])],
                "head": [t.get("expansion", "") for t in d.get("head_templates", [])],
                "senses": [{"glosses": s.get("glosses", []), "tags": s.get("tags", []),
                            "raw_tags": s.get("raw_tags", [])} for s in d.get("senses", [])],
            }
            out.write(json.dumps(keep, ensure_ascii=False) + "\n")
            kept += 1
        if p.wait() != 0:
            raise SystemExit("curl failed; kept nothing")
    os.replace(tmp, raw_path)
    print(f"fetched {n} lines, kept {kept} multi-character entries", file=sys.stderr)


# ---------------------------------------------------------------- pinyin ---

TONE = {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}
UNMARK = {c: (b, i + 1) for b, cs in TONE.items() for i, c in enumerate(cs)}
INITIALS = ["zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x",
            "r", "z", "c", "s", "y", "w"]
FINALS = set("""a o e ai ei ao ou an en ang eng ong er i ia ie iao iu ian in iang ing iong u ua uo uai ui
uan un uang ueng ü üe üan ün""".split())
SYLLABLES = set()
for _i in INITIALS + [""]:
    for _f in FINALS:
        if _i == "" and _f[0] in "iuü":
            continue  # written with y/w, never a bare syllable
        SYLLABLES.add(_i + _f)
SYLLABLES |= {"yi", "ya", "yo", "ye", "yao", "you", "yan", "yin", "yang", "ying", "yong", "wu", "wa", "wo",
              "wai", "wei", "wan", "wen", "wang", "weng", "yu", "yue", "yuan", "yun"}
for _i in "jqxy":
    for _f in ("u", "ue", "uan", "un"):
        SYLLABLES.add(_i + _f)
SYLLABLES |= {"hm", "hng", "m", "ng", "n", "ê", "lo", "yo", "dei", "nei", "gei", "kei", "lüe", "lün", "nüe",
              "den", "nou", "lia", "dia", "cei", "zei", "tei", "shei", "zhei", "chua", "fiao", "te", "me",
              "yai", "nia", "rua", "sei", "ken", "keng", "lun", "ei", "o", "eng", "ng", "hei", "lv"}


def syl_to_numbered(s):
    """'quèshuō'-style syllable -> 'que4'; None if not a plausible syllable."""
    s = unicodedata.normalize("NFC", s.strip())
    tone = 5
    base = []
    for ch in s:
        if ch in UNMARK:
            b, t = UNMARK[ch]
            base.append(b)
            tone = t
        elif ch in "ńň" or ch in "ǹ" or ch == "ḿ":
            base.append({"ń": "n", "ň": "n", "ǹ": "n", "ḿ": "m"}[ch])
            tone = {"ń": 2, "ň": 3, "ǹ": 4, "ḿ": 2}[ch]
        else:
            base.append(ch)
    b = "".join(base).lower()
    if not re.fullmatch(r"[a-zü]+", b):
        return None
    # u after j q x y is written u but is ü; normalise explicitly
    if re.match(r"^[jqxy]u", b) and not b.startswith("yu") or b.startswith("yu"):
        pass
    if re.match(r"^[nl]v", b):
        b = b[0] + "ü" + b[2:]
    if b == "ê":
        pass
    return b + str(tone)


def split_pinyin(text, n, erhua=False):
    """Split a tone-marked string like 'quèshuō' or 'què shuō' into syllables; want n of them.
    With erhua (word ends in 兒/儿) the final r folded into the previous syllable ('dǎgōur')
    is expanded to a separate 'er5' syllable."""
    text = unicodedata.normalize("NFC", text.strip())
    text = re.sub(r"\(.*?\)", "", text)
    text = text.replace("\u2019", "'")
    if re.search(r"[\[\]^:{}<>=*/0-9\u00b9\u00b2\u00b3\u2070-\u2079\u207a-\u207c]", text):
        return None
    parts = [p for p in re.split(r"[\s\-\u00b7]+", text) if p]
    out = []
    for p in parts:
        for x in p.split("'"):
            if x:
                out.append((x, x[0].isupper()))
    res = []
    for k, (p, cap) in enumerate(out):
        r_suffix = False
        if erhua and k == len(out) - 1 and p.endswith("r") and len(p) > 1:
            p = p[:-1]
            r_suffix = True
        sy = greedy(p.lower())
        if sy == [None]:
            return None
        res.append((sy[0], cap))
        res.extend((x, False) for x in sy[1:])
        if r_suffix:
            res.append(("er", False))
    if len(res) != n:
        return None
    nums = []
    for sy, cap in res:
        x = syl_to_numbered(sy)
        if x is None:
            return None
        base = re.sub(r"\d$", "", x)
        if base not in SYLLABLES and base.replace("ü", "u") not in SYLLABLES:
            return None
        nums.append(x[0].upper() + x[1:] if cap else x)
    return nums


def plain(s):
    return "".join(UNMARK[c][0] if c in UNMARK else c for c in unicodedata.normalize("NFC", s)).lower()


def is_marked(seg):
    return sum(1 for c in seg if c in UNMARK or c in "ńňǹḿ")


def greedy(p):
    """Split an unspaced pinyin run into syllables. Among valid parses, keep syllables with at most
    one tone mark, prefer the parse with the most tone-marked syllables, then the longest-first split."""
    p = unicodedata.normalize("NFC", p)
    pl = plain(p)
    memo = {}

    def best(i):
        if i == len(p):
            return (0, [])
        if i in memo:
            return memo[i]
        res = None
        for j in range(min(len(p), i + 7), i, -1):
            seg = pl[i:j]
            if not (seg in SYLLABLES or seg.replace("ü", "u") in SYLLABLES):
                continue
            m = is_marked(p[i:j])
            if m > 1:
                continue
            rest = best(j)
            if rest is None:
                continue
            cand = (rest[0] + (1 if m else 0), [p[i:j]] + rest[1])
            if res is None or cand[0] > res[0]:
                res = cand
        memo[i] = res
        return res

    r = best(0)
    return [None] if r is None else r[1]


# --------------------------------------------------------------- entries ---

def forms_of(e):
    w = e["word"]
    trad = [f["form"] for f in e["forms"] if "Traditional-Chinese" in f["tags"] and all_han(f["form"])]
    simp = [f["form"] for f in e["forms"] if "Simplified-Chinese" in f["tags"] and all_han(f["form"])]
    # head template: "卻說 • (卻说)" style, or "X (Y)" ; try to recover simp in parens
    t = trad[0] if trad else w
    s = simp[0] if simp else None
    if s is None:
        for h in e["head"]:
            m = re.match(r"^\s*(\S+)\s*[•·]?\s*\((\S+?)\)", h)
            if m and all_han(m.group(1)) and all_han(m.group(2)) and len(m.group(2)) == len(m.group(1)):
                if m.group(1) == w:
                    s = m.group(2)
                    break
    if s is None:
        s = w
    if len(t) != len(s):
        return None
    return t, s


def readings_of(e, n, erhua=False):
    out = []
    for s in e["sounds"]:
        tags = s.get("tags", [])
        if "Pinyin" not in tags or "Cantonese" in tags:
            continue
        pron = s["zh_pron"]
        for part in re.split(r"[,;/、]", pron):
            nums = split_pinyin(part, n, erhua)
            if nums:
                r = " ".join(nums)
                if r not in out:
                    out.append(r)
    return out


REGISTER = {
    "literary": "(literary)", "dialectal": "(dialect)", "Classical Chinese": "(Classical Chinese)",
    "Classical": "(Classical Chinese)", "colloquial": "(colloquial)", "archaic": "(archaic)",
    "dated": "(dated)", "obsolete": "(obsolete)", "slang": "(slang)", "vulgar": "(vulgar)",
    "Hokkien": "(Hokkien)", "Cantonese": "(Cantonese)", "Wu": "(Wu)", "Min": "(Min)", "Hakka": "(Hakka)",
    "Taiwan": "(Taiwan)", "Taiwanese Mandarin": "(Taiwan)", "Beijing": "(Beijing)", "idiomatic": "(idiom)",
    "Early Mandarin": "(Early Mandarin)", "Old Chinese": "(Old Chinese)", "Middle Chinese": "(Middle Chinese)",
    "Jin": "(Jin)", "Xiang": "(Xiang)", "Gan": "(Gan)", "Northern Mandarin": "(Northern Mandarin)",
    "Mandarin": "(Mandarin)", "Singapore": "(Singapore)", "Malaysia": "(Malaysia)", "Hong Kong": "(Hong Kong)",
    "regional": "(regional)", "rare": "(rare)", "figurative": "(figurative)", "euphemistic": "(euphemism)",
    "derogatory": "(derogatory)", "honorific": "(honorific)", "humble": "(humble)", "formal": "(formal)",
    "polite": "(polite)", "historical": "(historical)", "Buddhism": "(Buddhism)", "Daoism": "(Daoism)",
    "idiom": "(idiom)", "proverb": "(proverb)", "chengyu": "(idiom)", "informal": "(informal)",
    "Internet": "(Internet)", "Mainland China": "(Mainland China)",
}
ALTFORM = re.compile(r"^(?:(?:alternative|alternate|obsolete|archaic|variant|dated|nonstandard|non-standard|"
                     r"rare|ancient|traditional|simplified|Cantonese|Hokkien|Taiwanese|erhua|Hong Kong)\b[^;]{0,60}?"
                     r"\b(?:form|variant|spelling|writing|name|term)s? (?:of|for)\b\s*|"
                     r"(?:alternative|variant|obsolete) (?:of|for)\s+)(.*)$", re.I)
MARKUP = re.compile(r"\[.*?\]")
BAD_GLOSS = re.compile(r"^\s*$|romanization|^\s*\(.*?\)\s*$|Please see|^Used in|^Appears in|^Only used in", re.I)


def clean_gloss(g):
    g = unicodedata.normalize("NFC", g)
    g = g.replace("/", " or ").replace("\t", " ").replace("\n", " ")
    g = re.sub(r"\s+", " ", g).strip().rstrip(".;, ")
    return g


def senses_of(e):
    good, weak = [], []
    for s in e["senses"]:
        gl = [clean_gloss(g) for g in s["glosses"][-1:]]  # most specific line of the gloss path
        labels = []
        for t in list(s["tags"]) + list(s["raw_tags"]):
            lab = REGISTER.get(t)
            if lab and lab not in labels:
                labels.append(lab)
        for g in gl:
            if not g or BAD_GLOSS.search(g):
                continue
            m = ALTFORM.match(g)
            if m and m.group(1):
                tgt = m.group(1).strip().rstrip(".")
                mm = re.match(r"([\u3400-\u4dbf\u4e00-\u9fff\U00020000-\U0003347f]+(?:\uff0f[\u3400-\u4dbf\u4e00-\u9fff\U00020000-\U0003347f]+)?)", tgt)
                if mm:
                    tgt = mm.group(1).replace("\uff0f", "|")
                else:
                    tgt = re.sub(r"\s*\(.*$", "", tgt)
                weak.append(("variant of " + tgt) if tgt else g)
                continue
            prefix = " ".join(l for l in labels if not g.startswith(l))
            good.append((prefix + " " + g).strip())
    chosen = good or weak
    seen, res = set(), []
    for g in chosen:
        if g not in seen:
            seen.add(g)
            res.append(g)
    return res[:10]


def load_cedict(path):
    heads = set()
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            p = line.rstrip("\n").split("\t")
            heads.add(p[0])
            heads.add(p[1])
    return heads


def load_variants(path):
    """Per-character relations from Unihan: simp[c], trad[c], variants[c]."""
    rel = {}
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            p = line.rstrip("\n").split("\t")
            if len(p) > 7:
                rel[p[0]] = set(p[5]) | set(p[6]) | set(p[7])
    return rel


def related(a, b, rel):
    if a == b or b in rel.get(a, ()) or a in rel.get(b, ()):
        return True
    # two hops: 衞 -> 衛 -> 卫, 帳 -> 賬 -> 账
    return any(b in rel.get(v, ()) or v in rel.get(b, ()) for v in rel.get(a, ()))


def fix_simp(t, s, rel):
    """Wiktionary now and then lists a different word's character as the simplified form
    (有甚 -> 有什, 兒 -> 仔); keep only pairs Unihan relates within two hops, else the traditional char."""
    return "".join(sc if related(tc, sc, rel) else tc for tc, sc in zip(t, s))


HEADER = [
    "# Wiktionary multi-character words missing from CC-CEDICT, via kaikki.org (wiktextract) — CC BY-SA 4.0, https://en.wiktionary.org/",
    "# trad<TAB>simp<TAB>pinyin (numbered, ü, space-separated)<TAB>definitions joined by /",
    "# same format as cedict.tsv.gz; no headword here (either script) appears in cedict.tsv.gz",
]


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = args[0] if args else "."
    raw = os.path.join(root, ".cache/raw/kaikki/words.jsonl")
    if "--refetch" in sys.argv or not os.path.exists(raw):
        fetch(raw)
    ced = load_cedict(os.path.join(root, "public/data/cedict.tsv.gz"))
    rel = load_variants(os.path.join(root, "public/data/chars.tsv.gz"))
    stats = Counter()
    rows = {}
    with open(raw, encoding="utf-8") as f:
        for line in f:
            e = json.loads(line)
            stats["entries"] += 1
            fm = forms_of(e)
            if not fm:
                stats["drop_forms"] += 1
                continue
            t, s = fm
            s2 = fix_simp(t, s, rel)
            if s2 != s:
                stats["simp_fixed"] += 1
                s = s2
            if t in ced or s in ced or e["word"] in ced:
                stats["in_cedict"] += 1
                continue
            n = len(t)
            rd = readings_of(e, n, t[-1] in "\u5152\u513f")
            if not rd:
                stats["drop_pinyin"] += 1
                continue
            gl = senses_of(e)
            if not gl:
                stats["drop_gloss"] += 1
                continue
            for r in rd[:3]:
                rows.setdefault((t, s, r), [])
                for g in gl:
                    if g not in rows[(t, s, r)]:
                        rows[(t, s, r)].append(g)
    out = []
    for (t, s, r), gl in sorted(rows.items()):
        gl = gl[:12]
        out.append(f"{t}\t{s}\t{r}\t{'/'.join(gl)}")
    stats["rows"] = len(out)
    dst = os.path.join(root, "public/data/cedict-extra.tsv.gz")
    with open(dst, "wb") as raw_out:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw_out, mtime=0, compresslevel=9) as gz:
            gz.write(("\n".join(HEADER + out) + "\n").encode("utf-8"))
    print(dict(stats), file=sys.stderr)


if __name__ == "__main__":
    main()
