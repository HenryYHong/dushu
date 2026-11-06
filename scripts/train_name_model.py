#!/usr/bin/env python3
"""Build public/data/name-model.tsv.gz: the name model (src/core/nameModel.ts, ARCHITECTURE.md §4.9 Detection v12).

Usage (python3 -I, from a venv with numpy, scipy and scikit-learn; Node 22 on PATH for `sites`):
  train_name_model.py texts  <repo> <corpus> <work>   split the training texts into <work>/texts/<id>.txt
  train_name_model.py priors <repo> <corpus> <work>   character priors -> <work>/priors.tsv.gz (a model with no weights)
  train_name_model.py sites  <repo> <work>            every candidate of every training text, with its features, read through
                                                      the app (scripts/eval/zh-name-sites.run.ts) -> <work>/sites.tsv
  train_name_model.py train  <repo> <work> [--labels FILE ...] [--threshold P,Q] [--report FILE] [--out FILE]
                                                      fit the weights -> <repo>/public/data/name-model.tsv.gz and the check
                                                      fixture tests/core/fixtures/name-model-check.tsv

<corpus> is the offline text folder (wikisource/{orig,simp}/<id>.txt.gz with works.tsv and pieces.tsv; wikipedia/simp/*.txt.gz),
built once from the zh.wikisource dump of 2026-10-01 (public domain in the US: first published in 1930 or earlier) and the
Hugging Face copy of the Chinese Wikipedia of 2023-11-01 (CC BY-SA 4.0). Nothing of their text is shipped: the model holds
weights and per-character numbers only.

1. texts: the public-domain books as the reader would have them (the original script): each novel whole, and each piece of an
   author's collection or each tale of a story collection as a short text. Left out: the four novels in public/samples (the
   tuned books are measured, never trained on) and the works of tests/corpus and the sealed set (the corpus builder left those
   out already). The owner's books are never read here.
2. priors: from the Wikidata name list (public/data/names.tsv.gz, CC0) against how often each character occurs in running text
   (the books above and one shard of Wikipedia, simplified): for each character, log-odds × 2 of opening a person's name as a
   surname (`sur`), of standing in a given name (`giv`), in a foreign name (`tra`) and at the end of a place's name (`pla`); and
   the title tails: pairs that follow six or more different surnames in that text but are hardly ever a given name in the list
   (中丞, 监生, 大喜: a rank, a title or a phrase after a surname).
3. sites: detection over each training text with the name list, recording every string the model is asked about
   (core/lexicon.ts modelNames, DetectOptions.nameSites) and every name the rules found, with nameFeatures computed by the app.
4. train: a softmax regression (none, person, place). Labels: a string the name list holds is a person (p) or a place (l, o); a
   name or place the rules found is one (silver); hand labels (scripts/data/name-model-labels.tsv and any --labels FILE: word,
   label, optional text id; label person, place or none; 421 strings judged in context, picked where earlier models were sure)
   override both; the rest is unlabeled and counts as none with weight UNLABELED_WEIGHT (names the list lacks are among
   them, so the scores rank rather than give probabilities; the threshold is set on hand-judged candidates).
"""
import gzip, hashlib, json, math, os, random, re, subprocess, sys
from collections import Counter, defaultdict

HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿]")
# The tuned samples: measured on, never trained on.
SAMPLES = {"hongloumeng", "xiyouji", "sanguo-yanyi", "shuihu"}
# Collections of short pieces (stories, tales, essays): each piece is a text of its own.
PIECES = {"yushi-mingyan", "jingshi-tongyan", "xingshi-hengyan", "chuke-paian", "erke-paian", "shidiantou", "xihu-erji",
          "zuixingshi", "doupeng-xianhua", "shierlou", "baogongan", "yeyu-qiudenglu", "yingchuang-yicao", "xieduo", "yetan-suilu",
          "jiandeng-xinhua", "yuchu-xinzhi", "soushenji", "shishuo-xinyu"}
# Histories and the classics: their names are the list's, and they are long; left out of the texts (still in the priors' counts).
SKIP = {"shiji", "hanshu", "houhanshu", "sanguozhi", "zizhi-tongjian", "lunyu", "mengzi", "zhuangzi", "xunzi", "hanfeizi",
        "lvshi-chunqiu", "zuozhuan", "zhanguoce", "guoyu", "wenxin-diaolong", "tangshi-sanbaishou", "songci-sanbaishou",
        "youmengying", "caigentan", "renxue", "bianfa-tongyi", "renjian-cihua"}
MIN_PIECE_HAN = 1500
# Wikipedia articles read as texts: shards and the least Han characters.
WIKI_SHARDS = ["zhwiki-03", "zhwiki-04"]
WIKI_MIN_HAN = 5000
# A prior's floor (log-odds × 2): what a character never seen in that part of a name gets (nameModel.ts reads a missing one so).
FLOOR = -12
# Title tails: a surname prior at least this strong, and this many different surnames before the pair.
STRONG_SURNAME = 5
TAIL_SURNAMES = 6


def read_gz(path):
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return f.read()


def han_count(s):
    return len(HAN.findall(s))


def cmd_texts(repo, corpus, work):
    ws = os.path.join(corpus, "wikisource")
    works = {}
    with open(os.path.join(ws, "works.tsv"), encoding="utf-8") as f:
        head = f.readline().rstrip("\n").split("\t")
        for line in f:
            row = dict(zip(head, line.rstrip("\n").split("\t")))
            works[row["id"]] = row
    pieces = defaultdict(list)
    with open(os.path.join(ws, "pieces.tsv"), encoding="utf-8") as f:
        f.readline()
        for line in f:
            w, page, year, rev, chars = line.rstrip("\n").split("\t")
            pieces[w].append((page, int(chars)))
    out = os.path.join(work, "texts")
    os.makedirs(out, exist_ok=True)
    made = []
    for wid, row in sorted(works.items()):
        if wid in SAMPLES or wid in SKIP:
            continue
        path = os.path.join(ws, "orig", wid + ".txt.gz")
        if not os.path.exists(path):
            continue
        lines = read_gz(path).split("\n")[1:]
        if wid not in PIECES and not wid.endswith("-pre1931"):
            text = "\n".join(lines)
            with open(os.path.join(out, wid + ".txt"), "w", encoding="utf-8") as g:
                g.write(text)
            made.append((wid, han_count(text)))
            continue
        # Split at the pieces: a heading line, then body lines that add up to the piece's characters.
        at = 0
        for k, (page, chars) in enumerate(pieces[wid]):
            if at >= len(lines):
                break
            at += 1  # the heading
            body, n = [], 0
            while at < len(lines) and n < chars:
                body.append(lines[at])
                n += len(lines[at])
                at += 1
            text = "\n".join(body)
            if han_count(text) >= MIN_PIECE_HAN:
                pid = f"{wid}~{k:03d}"
                with open(os.path.join(out, pid + ".txt"), "w", encoding="utf-8") as g:
                    g.write(text)
                made.append((pid, han_count(text)))
    made += wiki_texts(corpus, out)
    with open(os.path.join(work, "texts.tsv"), "w", encoding="utf-8") as g:
        for pid, n in made:
            g.write(f"{pid}\t{n}\n")
    print(f"{len(made)} texts, {sum(n for _, n in made):,} Han characters")


def wiki_texts(corpus, out):
    """Long Wikipedia articles (plot summaries, biographies, histories) as short texts: a fixed quarter of those of WIKI_MIN_HAN
    Han characters or more in two shards, without the articles about the owner's books."""
    wp = os.path.join(corpus, "wikipedia")
    skip = set()
    with open(os.path.join(wp, "owner-book-articles.tsv"), encoding="utf-8") as f:
        f.readline()
        for line in f:
            skip.add(line.split("\t")[1])
    made = []
    for shard in WIKI_SHARDS:
        with gzip.open(os.path.join(wp, "orig", shard + ".txt.gz"), "rt", encoding="utf-8") as f:
            body = []
            for line in f:
                line = line.rstrip("\n")
                if line:
                    body.append(line)
                    continue
                if body:
                    title, text = body[0], "\n".join(body[1:])
                    body = []
                    if title in skip or han_count(text) < WIKI_MIN_HAN:
                        continue
                    if int(hashlib.md5(title.encode("utf-8")).hexdigest(), 16) % 4:
                        continue
                    pid = f"wiki~{shard[-2:]}~{len(made):04d}"
                    with open(os.path.join(out, pid + ".txt"), "w", encoding="utf-8") as g:
                        g.write(text)
                    made.append((pid, han_count(text)))
    return made


def ts_sets(repo):
    """SURNAMES, COMPOUND_SURNAMES and TRANSLIT_CHARS from src/core/names.ts."""
    src = open(os.path.join(repo, "src", "core", "names.ts"), encoding="utf-8").read()
    def block(name):
        m = re.search(r"export const " + name + r"[^=]*=\s*new Set\(\[(.*?)\]\);", src, re.S)
        return m.group(1)
    surnames = set("".join(re.findall(r"'([^']*)'", block("SURNAMES"))))
    compound = set(re.findall(r"'([^']{2})'", block("COMPOUND_SURNAMES")))
    translit = set("".join(re.findall(r"'([^']*)'", block("TRANSLIT_CHARS"))))
    return surnames, compound, translit


def text_counts(repo, corpus):
    """Han characters in running text, simplified: the training books and one Wikipedia shard."""
    c = Counter()
    ws = os.path.join(corpus, "wikisource", "simp")
    for f in sorted(os.listdir(ws)):
        if f.endswith(".txt.gz") and f[:-7] not in SAMPLES:
            c.update(HAN.findall(read_gz(os.path.join(ws, f))))
    with gzip.open(os.path.join(corpus, "wikipedia", "simp", "zhwiki-02.txt.gz"), "rt", encoding="utf-8") as f:
        for line in f:
            c.update(HAN.findall(line))
    return c


def cmd_priors(repo, corpus, work):
    surnames, compound, translit = ts_sets(repo)
    text = text_counts(repo, corpus)
    total = sum(text.values())
    sur, giv, tra, pla = Counter(), Counter(), Counter(), Counter()
    with gzip.open(os.path.join(repo, "public", "data", "names.tsv.gz"), "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            name, kind = line.rstrip("\n").split("\t")
            chars = list(name)
            n = len(chars)
            if kind in ("l", "o"):
                pla[chars[-1]] += 1
            if n >= 3 and sum(ch in translit for ch in chars) >= n - 1:
                tra.update(chars)
            if kind != "p" or n > 4:
                continue
            if n >= 3 and name[:2] in compound:
                given = chars[2:]
            elif chars[0] in surnames and n <= 3:
                sur[chars[0]] += 1
                given = chars[1:]
            elif n <= 3 and not all(ch in translit for ch in chars):
                given = chars
            else:
                continue
            giv.update(given)
    vocab = len(text) + 1

    def lo(counter, ch):
        if not counter[ch]:
            return FLOOR
        p = (counter[ch] + 0.5) / (sum_of[id(counter)] + 0.5 * vocab)
        q = (text[ch] + 1) / (total + vocab)
        return max(FLOOR, min(-FLOOR, round(2 * math.log(p / q))))

    sum_of = {id(x): sum(x.values()) for x in (sur, giv, tra, pla)}
    rows = []
    for ch in sorted(set(sur) | set(giv) | set(tra) | set(pla)):
        if sur[ch] + giv[ch] + tra[ch] + pla[ch] < 2:
            continue
        rows.append((ch, lo(sur, ch), lo(giv, ch), lo(tra, ch), lo(pla, ch)))
    tails = title_tails(repo, corpus, rows)
    write_model(os.path.join(work, "priors.tsv.gz"), rows, None, tails)
    print(f"{len(rows)} characters; persons with a surname {sum(sur.values()):,}, given-name characters {sum(giv.values()):,},"
          f" foreign-name characters {sum(tra.values()):,}, places {sum(pla.values()):,}; text {total:,} Han")


def title_tails(repo, corpus, rows):
    """Pairs that follow many surnames in running text but are (almost) never a given name in the list: a rank, a title, a
    kinship word or a phrase after a surname (中丞, 监生, 举人, 大喜), not a given name (建国). A surname here is a character
    whose `sur` prior is at least STRONG_SURNAME, so that 王 the king and 于 the preposition count little; the pair follows six or
    more of them, twelve, or six about evenly (four or more surnames' worth)."""
    strong = {r[0] for r in rows if r[1] >= STRONG_SURNAME}
    given = Counter()
    with gzip.open(os.path.join(repo, "public", "data", "names.tsv.gz"), "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            name, kind = line.rstrip("\n").split("\t")
            if kind == "p" and len(name) == 3:
                given[name[1:]] += 1
    pat = re.compile("(?=([" + "".join(sorted(strong)) + "])([\u4e00-\u9fff]{2}))")
    files = [os.path.join(corpus, "wikisource", "simp", f) for f in sorted(os.listdir(os.path.join(corpus, "wikisource", "simp")))
             if f.endswith(".txt.gz") and f[:-7] not in SAMPLES]
    files += [os.path.join(corpus, "wikipedia", "simp", s + ".txt.gz") for s in ("zhwiki-01", "zhwiki-02")]

    def sightings():
        for path in files:
            with gzip.open(path, "rt", encoding="utf-8") as f:
                for line in f:
                    for m in pat.finditer(line):
                        yield m.group(1), m.group(2)

    # Two passes: the pairs after enough different surnames, then how evenly those surnames share them. A given name that a few
    # people of a book bear (蔡天化, 黄天化; 陈希真) has one to three surnames that take nearly all its sightings; a title has many.
    seen = defaultdict(set)
    for sur, t in sightings():
        if len(seen[t]) < TAIL_SURNAMES:
            seen[t].add(sur)
    keep = {t for t, v in seen.items() if len(v) >= TAIL_SURNAMES and given[t] <= 1}
    del seen
    before = defaultdict(Counter)
    for sur, t in sightings():
        if t in keep:
            before[t][sur] += 1
    out = []
    for t, c in before.items():
        n = sum(c.values())
        even = n * n / sum(v * v for v in c.values())
        if n >= 12 and (len(c) >= 12 or even >= 4):
            out.append(t)
    return sorted(out)


HEADER = """# Dushu name model: a softmax regression (none, person, place) over a repeated string's shape, its statistics in the book and
# character priors (src/core/nameModel.ts, ARCHITECTURE.md §4.9). Made by scripts/train_name_model.py.
# Character priors from the Wikidata name list (CC0 1.0, https://www.wikidata.org) against character counts of running text;
# weights learned from Chinese Wikipedia text (CC BY-SA 4.0, Wikipedia contributors, https://zh.wikipedia.org; changed: only
# statistics are kept) and public-domain books from zh.wikisource (first published in 1930 or earlier). Treated as CC BY-SA 4.0.
# format 1
"""


def write_model(path, chars, model, tails):
    lines = [HEADER.rstrip("\n")]
    lines.append("!features\t1")
    if model:
        lines.append(f"!threshold:person\t{model['threshold_person']}")
        lines.append(f"!threshold:place\t{model['threshold_place']}")
        for group, t in sorted(SHAPE_THRESHOLDS.items()):
            lines.append(f"!threshold:person:{group}\t{t}")
        lines.append("!bias\t" + "\t".join(f"{b:.2f}" for b in model["bias"]))
        for feat, ws in sorted(model["weights"].items()):
            lines.append(feat + "\t" + "\t".join(f"{w:.2f}" for w in ws))
    for row in chars:
        lines.append("=" + row[0] + "\t" + "\t".join(str(v) for v in row[1:]))
    lines.extend("~" + t for t in tails)
    data = ("\n".join(lines) + "\n").encode("utf-8")
    with open(path, "wb") as f:
        f.write(gzip.compress(data, compresslevel=9, mtime=0))


# Unlabeled candidates count as none at this weight (names the list lacks are among them).
UNLABELED_WEIGHT = 0.3
# Hand labels outweigh the rest.
HAND_WEIGHT = 5.0
# L2 strength (scikit-learn's C).
C = 0.5
CLASSES = ["none", "person", "place"]
# How sure the model must be before detection takes a string as a person, as a place (--threshold P,Q overrides), and a person
# of a shape group (nameModel.ts shapeGroup) whose hand labels are right more often or less often than the rest: numbered names
# and honorifics (七大人, 四婶, 黄三, 老五) and a given name and a kinship character (附姐) were right at 0.7 (7 of 7, 33 of 34);
# two characters of no shape (宫娥, 太尊, 真君 against 道荣, 佳蕙) and foreign names of three or four characters (fragments of longer
# ones) were wrong a fifth of the time at 0.9, and three or four characters of no shape are often a term (宏原子, 安全声明).
THRESHOLDS = [0.85, 0.9]
SHAPE_THRESHOLDS = {"numhon": 0.65, "numjin": 0.65, "laonum": 0.65, "surnum": 0.7, "kin": 0.7, "er": 0.8,
                    "-2": 0.95, "-3": 0.9, "-4": 0.95, "translit3": 0.93, "translit4": 0.93}
# The check fixture: this many sites, picked by a fixed seed.
CHECK_SITES = 16
PLACE_END = set("岛山庄寺城府村镇峰谷关江河湖海岭洞殿堡宫楼阁庙塔桥坡寨营州县国亭郡观湾沟屯坪园路街巷坊号堂斋居")


def read_sites(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        head = f.readline().rstrip("\n").split("\t")
        for line in f:
            r = dict(zip(head, line.rstrip("\n").split("\t")))
            r["features"] = r["features"].split(" ") if r["features"] else []
            rows.append(r)
    return rows


def read_labels(paths):
    """Hand labels: rows of word, label (person, place, none) and optionally the text id; a row with a text id wins there."""
    by_text, by_word = {}, {}
    for path in paths or []:
        with open(path, encoding="utf-8") as f:
            for line in f:
                if not line.strip() or line.startswith("#"):
                    continue
                cols = line.rstrip("\n").split("\t")
                word, label = cols[0], cols[1]
                if label not in CLASSES:
                    raise SystemExit(f"{path}: unknown label {label!r}")
                if len(cols) > 2 and cols[2]:
                    by_text[(cols[2], word)] = label
                else:
                    by_word[word] = label
    return by_text, by_word


def label_of(r, hand):
    """-> (class index, weight, source) or None for a site left out."""
    by_text, by_word = hand
    h = by_text.get((r["text"], r["simp"])) or by_text.get((r["text"], r["word"])) or by_word.get(r["simp"]) or by_word.get(r["word"])
    if h:
        return CLASSES.index(h), HAND_WEIGHT, "hand"
    if r["found"] == "name":
        return 1, 1.0, "rules"
    if r["found"] == "place":
        return 2, 1.0, "rules"
    if r["list"] == "person":
        return 1, 1.0, "list"
    if r["list"] in ("place", "org") and (len(r["simp"]) >= 3 or r["simp"][-1] in PLACE_END):
        return 2, 1.0, "list"
    if r["list"]:
        return None
    return 0, UNLABELED_WEIGHT, "unlabeled"


def fit(rows, labels, weights, c=None):
    import numpy as np
    from scipy.sparse import csr_matrix
    from sklearn.linear_model import LogisticRegression
    vocab = {}
    ind, ptr = [], [0]
    for r in rows:
        for f in r["features"]:
            ind.append(vocab.setdefault(f, len(vocab)))
        ptr.append(len(ind))
    x = csr_matrix((np.ones(len(ind)), ind, ptr), shape=(len(rows), len(vocab)))
    m = LogisticRegression(C=c or C, max_iter=3000)
    m.fit(x, np.array(labels), sample_weight=np.array(weights))
    names = sorted(vocab, key=vocab.get)
    return {"bias": list(m.intercept_), "weights": {f: list(m.coef_[:, i]) for i, f in enumerate(names)}}


def score(model, feats):
    z = list(model["bias"])
    for f in feats:
        w = model["weights"].get(f)
        if w:
            z = [a + b for a, b in zip(z, w)]
    top = max(z)
    e = [math.exp(v - top) for v in z]
    return [v / sum(e) for v in e]


def folds(rows, k=5):
    """Cross-validation folds by text, so no text is in both halves."""
    return [int(hashlib.md5(r["text"].encode("utf-8")).hexdigest(), 16) % k for r in rows]


def cmd_train(repo, work, labels=None, threshold=None, report=None, out=None):
    rows = [r for r in read_sites(os.path.join(work, "sites.tsv")) if r["backed"] == "1"]
    hand = read_labels(labels)
    data = []
    for r in rows:
        lab = label_of(r, hand)
        if lab:
            data.append((r, *lab))
    print(f"{len(data)} sites:", dict(Counter((CLASSES[y], src) for _, y, _, src in data)))
    # Out-of-fold scores for every site, for the report and the threshold.
    fold = folds([d[0] for d in data])
    oof = [None] * len(data)
    for k in range(5):
        tr = [i for i in range(len(data)) if fold[i] != k]
        m = fit([data[i][0] for i in tr], [data[i][1] for i in tr], [data[i][2] for i in tr])
        for i in range(len(data)):
            if fold[i] == k:
                oof[i] = score(m, data[i][0]["features"])
    model = fit([d[0] for d in data], [d[1] for d in data], [d[2] for d in data])
    lines = []
    for cls in (1, 2):
        lines.append(f"## {CLASSES[cls]}: out-of-fold, hand-labeled sites")
        hl = [(oof[i][cls], data[i][1] == cls) for i in range(len(data)) if data[i][3] == "hand" and oof[i][cls] == max(oof[i])]
        for t in (0.5, 0.6, 0.7, 0.8, 0.85, 0.9, 0.95):
            sel = [ok for p, ok in hl if p >= t]
            if sel:
                lines.append(f"  >= {t}: {len(sel)} taken, {sum(sel)} right ({100 * sum(sel) / len(sel):.1f}%)")
    print("\n".join(lines))
    if report:
        with open(report, "w", encoding="utf-8") as g:
            g.write("\n".join(lines) + "\n")
            g.write("text\tsimplified\tsource\tlabel\tp_none\tp_person\tp_place\tword\n")
            for i, (r, y, w, src) in enumerate(data):
                g.write(f"{r['text']}\t{r['simp']}\t{src}\t{CLASSES[y]}\t" + "\t".join(f"{p:.3f}" for p in oof[i]) + f"\t{r['word']}\n")
    model["weights"] = {f: w for f, w in model["weights"].items() if max(abs(v) for v in w) >= 0.005}
    model["threshold_person"], model["threshold_place"] = threshold or THRESHOLDS
    chars, tails = [], []
    with gzip.open(os.path.join(work, "priors.tsv.gz"), "rt", encoding="utf-8") as f:
        for line in f:
            if line.startswith("="):
                cols = line.rstrip("\n").split("\t")
                chars.append((cols[0][1:], *cols[1:]))
            elif line.startswith("~"):
                tails.append(line[1:].rstrip("\n"))
    path = out or os.path.join(repo, "public", "data", "name-model.tsv.gz")
    write_model(path, chars, model, tails)
    print(f"{path}: {len(model['weights'])} features, {os.path.getsize(path):,} bytes")
    if not out:
        write_check(repo, model, [d[0] for d in data])


def write_check(repo, model, rows):
    """tests/core/fixtures/name-model-check.tsv: features of a few training sites and the scores the written weights give them
    (rounded as in the file), which tests/core/nameModel.test.ts checks against the TypeScript."""
    rounded = {"bias": [round(b, 2) for b in model["bias"]],
               "weights": {f: [round(w, 2) for w in ws] for f, ws in model["weights"].items()}}
    pick = random.Random(7).sample(rows, CHECK_SITES)
    path = os.path.join(repo, "tests", "core", "fixtures", "name-model-check.tsv")
    with open(path, "w", encoding="utf-8") as g:
        g.write("# features (space-separated)\tp_none\tp_person\tp_place: scores of the written model (scripts/train_name_model.py)\n")
        for r in pick:
            p = score(rounded, r["features"])
            g.write(" ".join(r["features"]) + "\t" + "\t".join(f"{v:.6f}" for v in p) + "\n")
    print(f"{path}: {len(pick)} sites")


def run_tool(repo, entry, args):
    """Run one of the scripts/eval/zh-*.run.ts tools inside Vitest, as scripts/eval/zh-dump.mjs does."""
    env = dict(os.environ, ZH_EVAL_ENTRY=entry, ZH_EVAL_ARGS=json.dumps(args))
    vitest = os.path.join(repo, "node_modules", "vitest", "vitest.mjs")
    r = subprocess.run(["node", vitest, "run", "--config", "scripts/eval/zh.vitest.config.mts"], cwd=repo, env=env)
    if r.returncode:
        raise SystemExit(f"{entry} failed")


def cmd_sites(repo, work, model=None, out=None, texts=None):
    args = {"model": model or os.path.join(work, "priors.tsv.gz"), "out": out or os.path.join(work, "sites.tsv")}
    if texts:
        args["files"] = texts
    else:
        args["dir"] = os.path.join(work, "texts")
    run_tool(repo, "scripts/eval/zh-name-sites.run.ts", args)


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd = argv[1]
    if cmd == "texts":
        cmd_texts(argv[2], argv[3], argv[4])
    elif cmd == "priors":
        cmd_priors(argv[2], argv[3], argv[4])
    elif cmd == "sites":
        cmd_sites(argv[2], argv[3])
    elif cmd == "train":
        opts = {"labels": [os.path.join(argv[2], "scripts", "data", "name-model-labels.tsv")], "threshold": None, "report": None, "out": None}
        rest = argv[4:]
        while rest:
            a = rest.pop(0)
            if a == "--labels":
                opts["labels"].append(rest.pop(0))
            elif a == "--threshold":
                opts["threshold"] = [float(x) for x in rest.pop(0).split(",")]
            elif a == "--report":
                opts["report"] = rest.pop(0)
            elif a == "--out":
                opts["out"] = rest.pop(0)
            elif a == "--unlabeled-weight":
                global UNLABELED_WEIGHT
                UNLABELED_WEIGHT = float(rest.pop(0))
            elif a == "--c":
                global C
                C = float(rest.pop(0))
        cmd_train(argv[2], argv[3], **opts)
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
