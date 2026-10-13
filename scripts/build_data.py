#!/usr/bin/env python3
"""Build Dushu's dictionary data from the raw sources in .cache/raw/.

Usage: python3 scripts/build_data.py [--download] [--book-words] [--repair-extra]

--book-words rebuilds only public/data/book-words.tsv.gz from scripts/data/book-words.tsv (no raw sources needed).

--repair-extra rewrites public/data/cedict-extra.tsv.gz in place (no raw sources needed): it re-splits run-together
pinyin that was cut at the wrong place (三公 "sang1 ong1" for san1 gong1, 不能 "bun4 eng2" for bu4 neng2) by choosing the
split every character's known readings agree with, and drops rows that are only a dialect word (Hokkien, Cantonese, Wu
...) the books never use, or whose reading no character of the word has. Safe to run again.

--download fetches the sources first (CC-CEDICT, Unihan, jieba's dict.txt.big,
CJKRadicals, OpenCC tables, the HSK list and the Jigmo fonts). Without it the
script expects them to be in .cache/raw/ already.

Writes public/data/*.tsv.gz, public/data/meta.json and public/fonts/*.woff2.
The formats are documented in ARCHITECTURE.md §3; keep the two in sync.
"""
import gzip
import io
import json
import os
import re
import subprocess
import sys
import unicodedata
import zipfile
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, ".cache", "raw")
OUT = os.path.join(ROOT, "public", "data")
FONTS = os.path.join(ROOT, "public", "fonts")

SOURCES = {
    "cedict/cedict.txt.gz": "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz",
    "unihan/Unihan.zip": "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip",
    "ucd/CJKRadicals.txt": "https://www.unicode.org/Public/UCD/latest/ucd/CJKRadicals.txt",
    "ucd/ReadMe.txt": "https://www.unicode.org/Public/UCD/latest/ucd/ReadMe.txt",
    "jieba/dict.txt.big": "https://raw.githubusercontent.com/fxsjy/jieba/master/extra_dict/dict.txt.big",
    "hsk/complete.min.json": "https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/main/complete.min.json",
    "opencc/STCharacters.txt": "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/STCharacters.txt",
    "opencc/STPhrases.txt": "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/STPhrases.txt",
    "opencc/TSCharacters.txt": "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt",
    "opencc/TSPhrases.txt": "https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSPhrases.txt",
    "jigmo/Jigmo-20250912.zip": "https://kamichikoichi.github.io/jigmo/Jigmo-20250912.zip",
}


def download():
    for rel, url in SOURCES.items():
        path = os.path.join(RAW, rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        print("fetch", url)
        subprocess.run(["curl", "-sSL", "--fail", "--max-time", "900", "-o", path, url], check=True)


def raw(rel):
    return os.path.join(RAW, rel)


def write_gz(name, header_lines, rows):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    buf = io.StringIO()
    for h in header_lines:
        buf.write("# " + h + "\n")
    n = 0
    for r in rows:
        buf.write("\t".join(r) + "\n")
        n += 1
    with open(path, "wb") as fh, gzip.GzipFile(fileobj=fh, mode="wb", compresslevel=9, mtime=0) as f:
        f.write(buf.getvalue().encode("utf-8"))
    print(f"wrote {name}: {n} rows, {os.path.getsize(path) / 1e6:.2f} MB")
    return n


# ---------------------------------------------------------------- pinyin ----

def numbered_syllables(py):
    """CEDICT pinyin -> numbered syllables with ü (never u: or v)."""
    return py.replace("u:", "ü").replace("U:", "Ü")


TONE_MARKS = {"a": "āáǎà", "e": "ēéěè", "i": "īíǐì", "o": "ōóǒò", "u": "ūúǔù", "ü": "ǖǘǚǜ"}
MARK_TO_BASE = {}
for base, marks in TONE_MARKS.items():
    for t, m in enumerate(marks, 1):
        MARK_TO_BASE[m] = (base, t)
        MARK_TO_BASE[m.upper()] = (base.upper(), t)


def marked_to_numbered(s):
    """Unihan 'hǎo' -> 'hao3'; no mark -> tone 5."""
    out, tone = [], 5
    for ch in unicodedata.normalize("NFC", s):
        if ch in MARK_TO_BASE:
            b, tone = MARK_TO_BASE[ch]
            out.append(b)
        else:
            out.append(ch)
    return "".join(out) + str(tone)


def hsk_numbered(marked, word, bases):
    """HSK list pinyin ("bù lìyú", "yǒujìnr") -> numbered syllables, one per Han char ("bu4 li4 yu2")."""
    letters, tones = [], []
    for ch in unicodedata.normalize("NFC", marked.lower()):
        if ch in MARK_TO_BASE:
            b, t = MARK_TO_BASE[ch]
            letters.append(b); tones.append(t)
        elif ch.isalpha() or ch == "ü":
            letters.append(ch); tones.append(0)
    text, n = "".join(letters), len(word)
    best = {0: []}  # position -> syllable cut list, filled left to right
    for i in range(len(text)):
        if i not in best:
            continue
        for j in range(i + 1, min(len(text), i + 6) + 1):
            if (text[i:j] in bases or text[i:j] == "r") and j not in best:
                best[j] = best[i] + [(i, j)]
    cuts = best.get(len(text))
    if not cuts or len(cuts) != n:
        return numbered_syllables(marked)
    out = []
    for i, j in cuts:
        tone = next((t for t in tones[i:j] if t), 5)
        out.append(text[i:j] + str(tone))
    return " ".join(out)


def is_han(ch):
    cp = ord(ch)
    return 0x3400 <= cp <= 0x9FFF or 0xF900 <= cp <= 0xFAFF or 0x20000 <= cp <= 0x3FFFF


# ---------------------------------------------------------------- CEDICT ----

CEDICT_RE = re.compile(r"^(\S+) (\S+) \[([^\]]*)\] /(.*)/\s*$")


def load_cedict():
    entries, meta = [], {}
    with gzip.open(raw("cedict/cedict.txt.gz"), "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#!"):
                k, _, v = line[2:].strip().partition("=")
                meta[k.strip()] = v.strip()
                continue
            if line.startswith("#") or not line.strip():
                continue
            m = CEDICT_RE.match(line)
            if not m:
                print("skip cedict line:", line.strip()[:80])
                continue
            trad, simp, py, defs = m.groups()
            entries.append([trad, simp, numbered_syllables(py), defs])
    return entries, meta


# ---------------------------------------------------------------- Unihan ----

def cp_to_char(tok):
    tok = tok.split("<")[0]
    return chr(int(tok[2:], 16))


def load_unihan():
    z = zipfile.ZipFile(raw("unihan/Unihan.zip"))
    fields = defaultdict(dict)
    wanted = {
        "kMandarin", "kHanyuPinyin", "kXHC1983", "kTGHZ2013", "kSMSZD2003Readings", "kHanyuPinlu",
        "kDefinition", "kTotalStrokes", "kRSUnicode", "kSimplifiedVariant", "kTraditionalVariant",
        "kSemanticVariant", "kZVariant", "kSpecializedSemanticVariant", "kCompatibilityVariant",
    }
    for name in z.namelist():
        if not name.endswith(".txt"):
            continue
        for line in z.read(name).decode("utf-8").splitlines():
            if not line.startswith("U+"):
                continue
            cp, key, val = line.split("\t", 2)
            if key in wanted:
                fields[cp_to_char(cp)][key] = val
    return fields


READING_RE = re.compile(r"[a-zǜ-ͯà-ǜ]+", re.I)


def unihan_readings(f):
    """Tone-marked readings, most customary first, deduplicated."""
    seen, out = set(), []

    def add(r):
        r = unicodedata.normalize("NFC", r.strip())
        if r and r not in seen:
            seen.add(r)
            out.append(r)

    for r in f.get("kMandarin", "").split():
        add(r)
    for r in f.get("kHanyuPinlu", "").split():
        add(r.split("(")[0])
    for key in ("kXHC1983", "kTGHZ2013", "kSMSZD2003Readings", "kHanyuPinyin"):
        for item in f.get(key, "").split():
            vals = item.split(":", 1)[-1]
            for r in vals.split(","):
                add(r.replace("*", ""))
    return [r for r in out if READING_RE.fullmatch(r)]


def variants(f, key):
    out = []
    for tok in f.get(key, "").split():
        if tok.startswith("U+"):
            out.append(cp_to_char(tok))
    return out


# ------------------------------------------------------------------ main ----

BOOK_WORDS_SRC = os.path.join(ROOT, "scripts", "data", "book-words.tsv")


def build_book_words():
    """Curated senses for the words the books use most (public/data/book-words.tsv.gz).

    CC-CEDICT lists the rarer sense of many common words first (行者 "pedestrian", 只見 "to see over and over", 姨娘 "maternal
    aunt", 罷 "to stop"). These rows are written by hand for Dushu from reading 西遊記, 紅樓夢, 活着 and 射雕英雄传 and are
    original wording (CC0). The loader puts a row ahead of the CC-CEDICT rows for its headword; a row with the same trad, simp and
    pinyin as a CC-CEDICT row replaces that row's definitions. The optional fifth column is a segmentation count, so a variant
    spelling that no word list has (鴻濛) is still cut as one word.
    """
    rows = []
    seen = set()
    with open(BOOK_WORDS_SRC, encoding="utf-8") as f:
        for n, line in enumerate(f, 1):
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            cols = line.split("\t")
            if not 4 <= len(cols) <= 5:
                raise SystemExit(f"book-words.tsv line {n}: expected 4 or 5 tab-separated columns")
            trad, simp, pinyin, defs = cols[:4]
            if not (all(is_han(c) for c in trad) and all(is_han(c) for c in simp)):
                raise SystemExit(f"book-words.tsv line {n}: headword must be Han characters")
            if not all(re.fullmatch(r"[A-Za-zü]+[1-5]", t) for t in pinyin.split(" ")):
                raise SystemExit(f"book-words.tsv line {n}: pinyin must be numbered syllables (capitalized for a proper noun), got {pinyin!r}")
            if (trad, simp, pinyin) in seen:
                raise SystemExit(f"book-words.tsv line {n}: duplicate row")
            seen.add((trad, simp, pinyin))
            rows.append(cols[:4] + ([cols[4]] if len(cols) == 5 and cols[4].strip().isdigit() else []))
    write_gz(
        "book-words.tsv.gz",
        [
            "Curated senses for words in classic and modern Chinese novels, written for Dushu (CC0 1.0). Source: scripts/data/book-words.tsv",
            "trad<TAB>simp<TAB>pinyin (numbered, ü)<TAB>definitions joined by /<TAB>optional segmentation count",
            "A row replaces the CC-CEDICT row with the same trad, simp and pinyin, or is added, and is listed first for its headword.",
        ],
        rows,
    )
    return len(rows)


def read_gz_rows(name):
    path = os.path.join(OUT, name)
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return [line.rstrip("\n").split("\t") for line in f if line.strip() and not line.startswith("# ")]


def base_of_marked(s):
    return "".join(MARK_TO_BASE[c][0] if c in MARK_TO_BASE else c for c in unicodedata.normalize("NFC", s.lower()))


DIALECT_DEF = re.compile(r"^\((Hokkien|Taiwanese Hokkien|Cantonese|Min|Min Nan|Eastern Min|Wu|Hakka|Teochew|Hainanese|Shanghainese|Xiang|Gan|Jin|Dungan)\b", re.I)


def repair_cedict_extra():
    """Fix cedict-extra.tsv.gz: wrong syllable cuts and dialect-only words (see the module docstring)."""
    readings = defaultdict(set)
    for r in read_gz_rows("chars.tsv.gz") + read_gz_rows("chars-extra.tsv.gz"):
        for x in r[1].split(","):
            if x:
                readings[r[0]].add(base_of_marked(x))
    valid = set()
    for r in read_gz_rows("cedict.tsv.gz"):
        for t in r[2].split(" "):
            if re.fullmatch(r"[A-Za-zü]+[1-5]", t):
                valid.add(re.sub(r"[1-5]$", "", t).lower())
        if len(r[1]) == 1 or len(r[0]) == 1:
            for ch in set(r[0] + r[1]):
                if len(ch) == 1:
                    readings[ch].update(re.sub(r"[1-5]$", "", t).lower() for t in r[2].split(" ") if re.fullmatch(r"[A-Za-zü]+[1-5]", t))
    valid |= {b for bs in readings.values() for b in bs}
    counts = {}
    for r in read_gz_rows("words.tsv.gz"):
        if len(r) > 1 and r[1].isdigit():
            counts[r[0]] = int(r[1])

    def fits(ch, base):
        known = readings.get(ch)
        return base in valid and (not known or base in known)

    def resplit(word, syl):
        letters = "".join(re.sub(r"[1-5]$", "", t) for t in syl)
        tones = [re.search(r"[1-5]$", t).group(0) for t in syl]
        caps = set()
        at = 0
        for t in syl:
            if t[:1].isupper():
                caps.add(at)
            at += len(re.sub(r"[1-5]$", "", t))
        lower = letters.lower()
        n = len(word)
        # Longest syllable first at every position is what cut the word wrongly, so search all cuts and keep the
        # first one in which every character takes one of its own readings.
        def go(i, pos):
            if i == n:
                return [] if pos == len(lower) else None
            for j in range(min(len(lower), pos + 6), pos, -1):
                if fits(word[i], lower[pos:j]):
                    rest = go(i + 1, j)
                    if rest is not None:
                        return [(pos, j)] + rest
            return None
        cuts = go(0, 0)
        if cuts is None:
            return None
        out = []
        for k, (a, b) in enumerate(cuts):
            piece = letters[a:b]
            if a in caps:
                piece = piece[:1].upper() + piece[1:]
            out.append(piece + tones[k])
        return out

    rows = read_gz_rows("cedict-extra.tsv.gz")
    fixed, dropped, left = 0, 0, 0
    out = []
    for r in rows:
        trad, simp, pinyin, defs = r[:4]
        first = defs.split("/")[0]
        if DIALECT_DEF.match(first) and counts.get(trad, 0) == 0 and counts.get(simp, 0) == 0:
            dropped += 1
            continue
        syl = pinyin.split(" ")
        if len(syl) == len(simp) == len(trad) and all(re.fullmatch(r"[A-Za-zü]+[1-5]", t) for t in syl):
            bad = any(not fits(ch, re.sub(r"[1-5]$", "", t).lower()) for ch, t in zip(trad, syl))
            if bad:
                again = resplit(trad, syl)
                if again:
                    r = [trad, simp, " ".join(again), defs]
                    fixed += 1
                else:
                    # A colloquial or Taiwan reading no character of the word has (鞋帶兒 "hai2 dai1 er5"): better no row,
                    # so the word reads from its characters, than a reading that is wrong in a book.
                    left += 1
                    continue
        out.append(r)
    write_gz(
        "cedict-extra.tsv.gz",
        [
            "Wiktionary multi-character words missing from CC-CEDICT, via kaikki.org (wiktextract) — CC BY-SA 4.0, https://en.wiktionary.org/",
            "trad<TAB>simp<TAB>pinyin (numbered, ü, space-separated)<TAB>definitions joined by /",
            "same format as cedict.tsv.gz; no headword here (either script) appears in cedict.tsv.gz",
            "repaired by build_data.py --repair-extra: pinyin re-cut where a character's own readings disagree; dialect-only words and words with a reading no character has dropped",
        ],
        out,
    )
    print(f"cedict-extra: {fixed} readings re-cut, {dropped} dialect rows dropped, {left} rows dropped for a reading none of their characters has")
    return len(out)


def main():
    if "--book-words" in sys.argv:
        build_book_words()
        return
    if "--repair-extra" in sys.argv:
        repair_cedict_extra()
        return
    if "--download" in sys.argv:
        download()

    cedict, cedict_meta = load_cedict()
    print("cedict entries:", len(cedict), cedict_meta.get("date"))

    # jieba frequencies (dict.txt.big covers both scripts)
    jieba = {}
    with open(raw("jieba/dict.txt.big"), encoding="utf-8") as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2 and parts[1].isdigit():
                jieba[parts[0]] = max(jieba.get(parts[0], 0), int(parts[1]))
    print("jieba words:", len(jieba))

    # HSK
    syllable_bases = {re.sub(r"[1-5]$", "", t).lower() for e in cedict for t in e[2].split() if re.fullmatch(r"[A-Za-zü]+[1-5]", t)}
    hsk_rows, hsk_only = [], []
    cedict_simp = {e[1] for e in cedict}
    cedict_heads = cedict_simp | {e[0] for e in cedict}
    for e in json.load(open(raw("hsk/complete.min.json"), encoding="utf-8")):
        simp = e["s"]
        new = [int(l[1:]) for l in e["l"] if l[0] == "n"]
        old = [int(l[1:]) for l in e["l"] if l[0] == "o"]
        forms = e.get("f", [])
        trad = forms[0]["t"] if forms else simp
        hsk_rows.append([simp, trad, str(min(new)) if new else "", str(min(old)) if old else "", str(e.get("q", ""))])
        if simp not in cedict_heads:
            for fm in forms:
                hsk_only.append([fm["t"], simp, hsk_numbered(fm["i"]["y"], simp, syllable_bases), "/".join(fm["m"]) or "(HSK word)"])
    print("hsk words:", len(hsk_rows), "not in CEDICT:", len(hsk_only))

    all_entries = cedict + hsk_only
    write_gz(
        "cedict.tsv.gz",
        [
            "CC-CEDICT " + cedict_meta.get("date", "") + " — CC BY-SA 4.0, https://cc-cedict.org/wiki/ (MDBG)",
            "trad<TAB>simp<TAB>pinyin (numbered, ü, space-separated)<TAB>definitions joined by /",
            f"last {len(hsk_only)} rows: HSK words missing from CC-CEDICT (complete-hsk-vocabulary, MIT)",
        ],
        all_entries,
    )

    # Unihan characters
    uni = load_unihan()
    char_rows, n_reading, n_def = [], 0, 0
    cedict_single_py = defaultdict(list)
    for trad, simp, py, _ in cedict:
        if len(trad) == 1:
            cedict_single_py[trad].append(py)
        if len(simp) == 1:
            cedict_single_py[simp].append(py)
    for ch in sorted(uni, key=ord):
        f = uni[ch]
        reads = unihan_readings(f)
        if reads:
            n_reading += 1
        if f.get("kDefinition"):
            n_def += 1
        sem = []
        for key in ("kSemanticVariant", "kZVariant", "kSpecializedSemanticVariant"):
            for v in variants(f, key):
                if v != ch and v not in sem:
                    sem.append(v)
        char_rows.append([
            ch,
            ",".join(reads),
            f.get("kDefinition", ""),
            f.get("kTotalStrokes", "").split()[0] if f.get("kTotalStrokes") else "",
            f.get("kRSUnicode", "").split()[0] if f.get("kRSUnicode") else "",
            "".join(v for v in variants(f, "kSimplifiedVariant") if v != ch),
            "".join(v for v in variants(f, "kTraditionalVariant") if v != ch),
            "".join(sem),
            "".join(variants(f, "kCompatibilityVariant")),
        ])
    print("unihan chars:", len(char_rows), "with Mandarin reading:", n_reading, "with definition:", n_def)
    write_gz(
        "chars.tsv.gz",
        [
            "Unihan (Unicode Character Database) — Unicode License v3, https://www.unicode.org/terms_of_use.html",
            "char<TAB>readings (tone marks, comma-sep, most customary first)<TAB>definition<TAB>total strokes<TAB>radical.strokes (kRSUnicode)<TAB>simplified variants<TAB>traditional variants<TAB>semantic/Z variants<TAB>compatibility->unified",
        ],
        char_rows,
    )

    # Segmentation vocabulary: every CEDICT/HSK headword + every Unihan char,
    # with jieba counts (trad falls back to its simplified pair's count).
    words = {}
    for trad, simp, _, _ in all_entries:
        fs = jieba.get(simp, 0)
        ft = jieba.get(trad, 0) or fs
        words[simp] = max(words.get(simp, 0), fs)
        words[trad] = max(words.get(trad, 0), ft)
    for row in char_rows:
        ch = row[0]
        if ch not in words:
            words[ch] = jieba.get(ch, 0)
    # Common jieba-only compounds (山上, 窗外, 很久) so they segment as words; the popup shows their parts.
    # Count >= 200 and the demonstrative/particle filter were chosen on tests/core/gold.ts (held-out F1 0.969 -> 0.995).
    bad_first = set("这那哪每某各本该此其這該一二三四五六七八九十两兩几幾百千万萬半数數")  # demonstratives, numerals (一只 → 一|只)
    bad_last = set("了的着过吗呢吧啊么著過嗎麼")
    compounds = 0
    for w, c in jieba.items():
        if (c >= 200 and w not in words and 2 <= len(w) <= 4 and all(is_han(ch) for ch in w)
                and w[0] not in bad_first and w[-1] not in bad_last):
            words[w] = c
            compounds += 1
    print("jieba-only compounds added:", compounds)
    total = sum(words.values())
    write_gz(
        "words.tsv.gz",
        [
            "Segmentation vocabulary: CC-CEDICT + HSK headwords, all Unihan chars, and jieba-only compounds with count >= 200; counts from jieba dict.txt.big (MIT). 0 = unseen.",
            f"total={total}",
            "word<TAB>count",
        ],
        ([w, str(c)] for w, c in sorted(words.items(), key=lambda kv: (-kv[1], kv[0]))),
    )

    write_gz(
        "hsk.tsv.gz",
        [
            "complete-hsk-vocabulary (Yanis Zafirópulos, MIT) — https://github.com/drkameleon/complete-hsk-vocabulary",
            "simp<TAB>trad<TAB>HSK 3.0 level (1-6, 7 = 7-9)<TAB>HSK 2.0 level (1-6)<TAB>frequency rank",
        ],
        hsk_rows,
    )

    # OpenCC tables, first candidate only
    def opencc(*names):
        rows = {}
        for n in names:
            with open(raw(f"opencc/{n}.txt"), encoding="utf-8") as f:
                for line in f:
                    if line.startswith("#") or "\t" not in line:
                        continue
                    k, v = line.rstrip("\n").split("\t", 1)
                    rows.setdefault(k, v.split(" ")[0])
        return [[k, v] for k, v in rows.items() if k != v]

    lic = "OpenCC (BYVoid) — Apache-2.0, https://github.com/BYVoid/OpenCC ; key<TAB>first candidate"
    write_gz("t2s.tsv.gz", [lic], opencc("TSPhrases", "TSCharacters"))
    write_gz("s2t.tsv.gz", [lic], opencc("STPhrases", "STCharacters"))

    # Radicals: number (with ' for simplified forms) -> radical char, unified char
    rad_rows = []
    with open(raw("ucd/CJKRadicals.txt"), encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            num, rc, uc = [p.strip() for p in line.split(";")]
            rad_rows.append([num, chr(int(rc, 16)) if rc else "", chr(int(uc, 16))])
    write_gz("radicals.tsv.gz", ["Unicode CJKRadicals.txt — number<TAB>radical char<TAB>unified ideograph"], rad_rows)

    # Fonts: Jigmo (CC0) as woff2 for glyphs the system fonts lack
    from fontTools.ttLib import TTFont
    os.makedirs(FONTS, exist_ok=True)
    z = zipfile.ZipFile(raw("jigmo/Jigmo-20250912.zip"))
    font_cps = set()
    for name in ("Jigmo.ttf", "Jigmo2.ttf", "Jigmo3.ttf"):
        src = next(n for n in z.namelist() if n.endswith("/" + name) or n == name)
        out = os.path.join(FONTS, name.replace(".ttf", ".woff2"))
        font = TTFont(io.BytesIO(z.read(src)))
        font_cps |= set(font.getBestCmap().keys())
        if not os.path.exists(out):
            font.flavor = "woff2"
            font.save(out)
        print(f"font {out}: {os.path.getsize(out) / 1e6:.1f} MB")
    with open(os.path.join(FONTS, "Jigmo-LICENSE.txt"), "wb") as f:
        f.write(z.read(next(n for n in z.namelist() if n.endswith("LICENSE.txt"))))

    unified = [r[0] for r in char_rows if not r[8]]
    missing_glyph = [c for c in unified if ord(c) not in font_cps]
    ucd_version = re.search(r"version ([\d.]+)", open(raw("ucd/ReadMe.txt")).read())
    meta = {
        "built": cedict_meta.get("date", ""),
        "unicode": ucd_version.group(1) if ucd_version else "",
        "counts": {
            "cedict": len(cedict),
            "hskOnly": len(hsk_only),
            "unihanChars": len(char_rows),
            "unifiedIdeographs": len(unified),
            "withReading": n_reading,
            "withDefinition": n_def,
            "segWords": len(words),
            "noJigmoGlyph": len(missing_glyph),
        },
        "noJigmoGlyphSample": missing_glyph[:20],
        "sources": [
            {"name": "CC-CEDICT", "license": "CC BY-SA 4.0", "url": "https://cc-cedict.org/wiki/"},
            {"name": "Unihan / UCD", "license": "Unicode License v3", "url": "https://www.unicode.org/terms_of_use.html"},
            {"name": "jieba dict.txt.big", "license": "MIT", "url": "https://github.com/fxsjy/jieba"},
            {"name": "complete-hsk-vocabulary", "license": "MIT", "url": "https://github.com/drkameleon/complete-hsk-vocabulary"},
            {"name": "OpenCC", "license": "Apache-2.0", "url": "https://github.com/BYVoid/OpenCC"},
            {"name": "Jigmo fonts (GlyphWiki)", "license": "CC0 1.0", "url": "https://kamichikoichi.github.io/jigmo/"},
            {"name": "Wiktionary (via kaikki.org)", "license": "CC BY-SA 4.0", "url": "https://kaikki.org/"},
            {"name": "hanzi-writer", "license": "MIT", "url": "https://hanziwriter.org/"},
            {"name": "hanzi-writer-data (Make Me a Hanzi)", "license": "Arphic Public License", "url": "https://github.com/chanind/hanzi-writer-data"},
        ],
    }
    meta["counts"]["bookWords"] = build_book_words()
    with open(os.path.join(OUT, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    print(json.dumps(meta["counts"], indent=2))


if __name__ == "__main__":
    main()
