#!/usr/bin/env python3
"""Train public/data/reading-model.tsv.gz: the reading model for one-character tokens (src/core/readingModel.ts,
ARCHITECTURE.md §4.1 Reading model).

Usage (python3 -I, from a venv with numpy, scipy and scikit-learn; Node 22 on PATH):
  train_reading_model.py <repo-root> [--books DIR] [--books2 DIR] [--report FILE] [--decide] [--refetch] [--cached]
                         [--candidates FILE]

1. Fetches CPP (github.com/kakaobrain/g2pM, data/{train,dev,test}.{sent,lb}: Apache-2.0 code, sentences from Chinese
   Wikipedia, CC BY-SA) into <repo>/.cache/raw/cpp and checks each file's sha256.
2. Reads through the app (scripts/eval/zh-reading-sites.run.ts, run by node inside Vitest) every one-character place of the
   characters below, with the features the app computes (siteFeatures), the rules' reading and whether one of the rules' own
   cases decided it: CPP, the books in public/samples, the public-domain books in --books (default <repo>/.cache/raw/reading-books,
   fetched by scripts/fetch_reading_books.py from scripts/data/reading-model-books.tsv) and in --books2 (default
   <repo>/.cache/raw/reading-books-2, the 98 works of scripts/data/reading-model-books-2.tsv, 19 million Han characters of Ming and
   Qing novels, late-Qing and 1920s prose and classical texts; of these only the rule-decided and hand-labeled places are kept)
   and the texts of the held-out corpus. --cached reuses the last run's site files (only to iterate on the training itself).
3. Trains one logistic regression per character on
   - CPP's train and dev splits (never test, which the CPP benchmark scores): the right readings, Wikipedia's;
   - silver labels: what a rule's own case read in public/samples and both sets of books (never its default), weighted below CPP;
   - the hand-labeled places of tests/corpus/zh/readings-calibration.tsv outside the held-out third (`held_out`).
   The rules' reading is class 0 and gets PRIOR pseudo-examples with no features, so the model has to see the other reading
   often enough before it is sure of it.
4. With --decide, sets each character's threshold on the training hand labels (out of fold: the threshold where a right change
   counting 1 and a wrong one WRONG_COST gain the most) and keeps a character only where, on the held-out third of the hand
   labels, it changes at least MIN_CHANGES readings (MIN_CHANGES_KEPT for the characters enabled before, KEPT), is right at least
   ENABLE_RIGHT of the time when it does and gets more of them right than the rules. ENABLED holds the outcome, so a retrain gives
   the same characters. A character's threshold may be higher for changing to one of its readings ({"": 0.8, "wei2": 0.9}:
   threshold:为:wei2 in the file). A character listed in CARRIED keeps an earlier model unchanged, read from
   scripts/data/reading-model-carried.tsv (none since 2026-11-05).
   --report FILE writes the per-character table.
5. Writes the model (weights rounded to 2 decimals) and tests/core/fixtures/reading-model-check.tsv: the features and scores of
   the invented sentences in scripts/data/reading-model-check.txt, which tests/core/readingModel.test.ts checks against the
   TypeScript.

--candidates FILE writes places to hand-label next (where the model would change the rules' reading, and a sample where it
would not). The trained model is CC BY-SA 4.0 (it is made from CPP's Wikipedia sentences): credited in About, README and
ARCHITECTURE §8.
"""
import gzip, hashlib, json, math, os, random, shutil, subprocess, sys
from collections import Counter, defaultdict

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.linear_model import LogisticRegression

UA = "Dushu-data-builder/0.1 (personal reading app)"
CPP_URL = "https://raw.githubusercontent.com/kakaobrain/g2pM/master/data/"
CPP_SHA256 = {
    "train.sent": "6029a6881e97e79163d0e66879e8c47eb83b6a4e208b3f5622ed2029a160dc39",
    "train.lb": "4476a4cf96046f41e1d826318322f583f39c88fd141604135c6484e36f63c616",
    "dev.sent": "57add0fe20514112ee93516ad25491ecae649363a291a12b62f31b5dd355273e",
    "dev.lb": "61d0cbc31e38cddfba8502f73504df95700f85b827c61587cff492b6881e8690",
    "test.sent": "c34e2073b0c7e468b92903b021a7d42bacc87f88ea6c06863e9fa5cdfd727cbe",
    "test.lb": "1101ba8bb0842b4fe273690c4c1899cdaf656ee1d79ebba4fb8dc10fbcc598f8",
}
# Must match READING_FEATURES_VERSION in src/core/readingModel.ts.
FEATURES_VERSION = 2
# The characters trained: the common ones whose rules leave a default (为 得 着 长 …) and the rare ones of the first model.
COMMON = "为得着长应将中还种便处差少藏当降难好数量调重行都觉教干背盛挑冲转散发分只系塞薄那舍强祇给监弄"
RARE = "传杓相刹艮率藉圜裨脯茆什奔宿隽苕茄杈颉槛镝仔姥畜"
TRAINED = COMMON + RARE
# Inverse regularization, pseudo-examples of the rules' reading, features seen fewer times than this are dropped, weights
# smaller than PRUNE are left out of the file.
C = 0.5
PRIOR = 4
MIN_COUNT = 2
PRUNE = 0.05
# How much each kind of example counts: a hand label, a CPP sentence, a rule's case in a book, a reviewed default. Set on the
# training hand labels (out of fold): the reviewed defaults of public/samples teach the very misreadings the hand labels fix
# (遇着 zhe, 当兵，为钱 wéi), so they count for nothing; the rules' own cases count less than CPP's right readings.
W_HAND = 10.0
W_CPP = 0.5
W_SILVER = 0.3
W_REVIEWED = 0.0
# At most this many silver examples of one reading of one character (the classics have thousands of 着 zhe).
SILVER_CAP = 6000
# The default threshold, the ones a character may get, what a wrong change costs against a right one when a threshold is set
# (9: what a threshold adds must be right 90% of the time), how often its changes must be right, and on how many held-out places
# at least. The first model's rare characters have too few held-out places each: they are kept together when their held-out
# changes are right ENABLE_RIGHT of the time, each one unless one of its own held-out changes was wrong.
THRESHOLD = 0.7
GRID = (0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95)
WRONG_COST = 9
ENABLE_RIGHT = 0.9
MIN_CHANGES = 5
# The first model's features and threshold, which its rare characters keep.
FIRST_FEATURES = {"w-1", "w+1", "w-2", "w+2", "c-1", "c-2", "c-3", "c+1", "c+2", "c+3", "cc-", "cc+", "c-+", "E", "S", "L-1", "V-1",
                  "L+1", "V+1", "N+1", "ce", "Vce", "Nce", "Vmax"}
FIRST_THRESHOLD = 0.7
# Characters the held-out hand labels enabled, with their thresholds (--decide decides again and prints what to put here). With the
# 3,210 hand labels of 2026-11 and the second set of books, 着 长 中 还 种 差 少 好 passed besides 藏 数 (report in ARCHITECTURE §4.1),
# and their changes in the held-out corpus and the tuned books were judged; 得 passed but failed that judgement (NOT_FOR_MODEL),
# 都 (4 of 4 at 0.9), 薄 (12 of 14), 当 (17 of 22), 应 量 难 and the rest did not pass. 为 is carried (CARRIED). The first model's 24
# rare characters passed together. With the 2,540 hand labels of 2026-11-05 (of the readings a blind measurement found wrong in
# older books), 为 retrained is right at 127 of 173 held-out places (72 of 72 changes) against the carried model's 126, and 64 of
# the 71 places where the two differ in the held-out corpus and the tuned books were judged its way (5 the other, 2 neither), so
# it is no longer carried; 得 passed at 0.99 (63 of 63; at 0.95, 36 of the 239 judged changes, most in the tuned books,
# were wrong: the complement after an adjective, 痛得 乱得, read dé), and 将 (37 of 37), 祇 (15 of 15, zhǐ for 只) and 给 (5 of 5, jǐ) are new;
# 那 (2 of 3), 教 舍 (3 of 3), 监 (4 of 5), 强 弄 应 did not pass. Changing 为 to wéi asks 0.85 (at 0.65, 8 of the 43 judged changes
# between the two bars were wrong).
# Rule cases take 为 + someone + what is felt or lived for them (为朋友高兴: wèi), 藏宝 (cáng), a rate before an adverb (率 lǜ) and
# 魂不着体 (zhuó) from the model, where reviews found it wrong.
ENABLED = {"为": {"": 0.65, "wei2": 0.85}, "得": 0.99, "着": 0.85, "长": 0.85, "将": 0.6, "中": 0.95, "还": 0.9, "种": 0.95, "差": 0.9, "少": 0.95,
           "藏": 0.85, "好": 0.9, "数": 0.7, "祇": 0.95, "给": 0.85,
           **{ch: FIRST_THRESHOLD for ch in RARE},
           # 率 "to lead" (shuài): every place in the tuned books where the model leaned to it below the first threshold was
           # shuài (王浚率水兵, 曹嵩率家小, 普天率土); the rate is read by the rules.
           "率": 0.55}
# Characters whose model is carried unchanged from scripts/data/reading-model-carried.tsv (with its thresholds), not retrained.
CARRIED = set()
# Characters enabled before the bar rose to MIN_CHANGES: they stay while their held-out changes are right ENABLE_RIGHT of the time
# and number at least MIN_CHANGES_KEPT (the first bar), since a native review checked every change they made.
KEPT = set("为藏数")
MIN_CHANGES_KEPT = 3
# Particles and interjections: the rules own them (NOT_FOR_MODEL in src/core/readingModel.ts). 着 and 得 are not among them: where
# their rules fall back to zhe and de, the model may read zháo, zhuó and dé (得 only when it is 0.99 sure: below that it read the
# complement after an adjective as dé in modern novels).
NOT_FOR_MODEL = set("了著地的儿兒么麼罢罷吧呢啊呀哇啦哪嘛哟喔哦噢呐咯哩唻嘞呗唄啰囉耶邪欤歟乎哉兮焉矣也夫唉嗯哼嘿哈喂呸噫嘻吁咦嗨呃嗳噯哎呦呵嚯个個们們子头頭一不")


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch_cpp(raw, refetch):
    os.makedirs(raw, exist_ok=True)
    for name, digest in CPP_SHA256.items():
        path = os.path.join(raw, name)
        if refetch or not os.path.exists(path):
            subprocess.run(["curl", "-sS", "--fail", "-L", "-A", UA, "-o", path + ".part", CPP_URL + name], check=True)
            os.replace(path + ".part", path)
        if sha256(path) != digest:
            sys.exit(f"{path}: sha256 differs from the pinned one; delete it and run with --refetch")


def run_sites(repo, args):
    """Runs scripts/eval/zh-reading-sites.run.ts inside Vitest (the app's own TypeScript)."""
    node = shutil.which("node")
    if not node:
        sys.exit("node (22) is not on PATH")
    vitest = os.path.join(repo, "node_modules", "vitest", "vitest.mjs")
    env = dict(os.environ, ZH_EVAL_ENTRY="scripts/eval/zh-reading-sites.run.ts", ZH_EVAL_ARGS=json.dumps(args))
    r = subprocess.run([node, vitest, "run", "--config", "scripts/eval/zh.vitest.config.mts"], cwd=repo, env=env,
                       stdout=subprocess.DEVNULL)
    if r.returncode:
        sys.exit("reading the texts through the app failed")


def read_cpp_sites(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            r = line.rstrip("\n").split("\t")
            if r[7] != "1":
                continue
            rows.append({"src": "cpp", "split": r[0], "ch": r[2], "gold": r[3], "app": r[6], "decided": r[8] == "1",
                         "fallback": r[9], "features": r[10:]})
    return rows


def read_book_sites(path, src, keep=None):
    """The places of one sites file. `keep(text, block, offset, decided)` drops the rest as they are read (the second set of
    books is large: only its rule-decided places and its hand-labeled ones are kept)."""
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            r = line.rstrip("\n").split("\t", 7)
            if keep and not keep(r[0], r[1], int(r[2]), r[5] == "1"):
                continue
            rows.append({"src": src, "text": r[0], "block": r[1], "offset": int(r[2]), "ch": r[3], "fallback": r[4],
                         "decided": r[5] == "1", "context": r[6], "features": r[7].split("\t") if len(r) > 7 else []})
    return rows


def read_chars(path):
    own = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            ch, readings = line.rstrip("\n").split("\t")
            own[ch] = set(readings.split())
    return own


def read_labels(path):
    """Hand labels: {(text, block, offset): (char, reading, folder)}."""
    out = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            c = line.rstrip("\n").split("\t")
            out[(c[1], c[2], int(c[3]))] = (c[4], c[5], c[0])
    return out


def held_out(key):
    """The held-out third of the hand labels: chosen by a hash of the place, so it never changes as labels are added."""
    text, block, offset = key
    return int(hashlib.sha1(f"{text}/{block}/{offset}".encode()).hexdigest(), 16) % 3 == 0


def train_char(ch, xs, own, ys, ws, usual, c=None):
    """One character's model from examples xs (feature lists), labels ys, weights ws: (readings, bias, {feature: weights})."""
    readings = [usual] + sorted(set(y for y in ys if y != usual))
    if len(readings) < 2:
        return None
    counts = Counter(f for x in xs for f in set(x))
    index = {f: i for i, f in enumerate(sorted(f for f, k in counts.items() if k >= MIN_COUNT))}
    ri, ci, y, w = [], [], [], []
    for i, (x, lab, wt) in enumerate(zip(xs, ys, ws)):
        for f in set(x):
            j = index.get(f)
            if j is not None:
                ri.append(i)
                ci.append(j)
        y.append(readings.index(lab))
        w.append(wt)
    # The rules' reading as pseudo-examples with no features: a prior toward what the rules say.
    y += [0] * PRIOR
    w += [1.0] * PRIOR
    X = csr_matrix((np.ones(len(ri)), (ri, ci)), shape=(len(y), max(1, len(index))))
    lr = LogisticRegression(C=c or C, max_iter=3000, tol=1e-6)
    lr.fit(X, y, sample_weight=np.array(w))
    coef, icpt = lr.coef_, lr.intercept_
    if len(readings) == 2:
        # sklearn keeps one row for two classes: the log-odds of class 1.
        diff = coef[0:1]
        bias = [float(icpt[0])]
    else:
        diff = coef[1:] - coef[0]
        bias = [float(b - icpt[0]) for b in icpt[1:]]
    weights = {}
    for f, j in index.items():
        wv = [round(float(diff[k, j]), 2) for k in range(len(readings) - 1)]
        if max(abs(v) for v in wv) >= PRUNE:
            weights[f] = wv
    return readings, [round(b, 2) for b in bias], weights


def scores(model, features):
    readings, bias, weights = model
    z = [0.0] + list(bias)
    for f in features:
        w = weights.get(f)
        if w:
            for k, v in enumerate(w):
                z[k + 1] += v
    top = max(z)
    e = [math.exp(v - top) for v in z]
    s = sum(e)
    return [(r, v / s) for r, v in zip(readings, e)]


def bar(threshold, reading):
    """How sure the model must be to change to `reading`: `threshold` is a number, or {"": default, reading: higher}."""
    return threshold.get(reading, threshold[""]) if isinstance(threshold, dict) else threshold


def choose(model, fallback, features, threshold, own):
    """The reading the app would show: the model's best when it is at least `threshold` sure and one of the character's own."""
    if not model or fallback not in model[0]:
        return fallback, 0.0
    sc = scores(model, features)
    best = max(sc, key=lambda x: x[1])
    if best[0] == fallback or best[1] < bar(threshold, best[0]) or best[0] not in own:
        return fallback, best[1]
    return best[0], best[1]


class Data:
    """Every example, by character."""

    def __init__(self, cpp, books, labels, own):
        self.own = own
        self.by_char = defaultdict(list)
        self.hand = defaultdict(list)
        self.cpp_test = [x for x in cpp if x["split"] == "test"]
        for x in cpp:
            if x["split"] in ("train", "dev") and x["gold"] in own.get(x["ch"], ()):
                self.by_char[x["ch"]].append((x["features"] + ["D:cpp"], x["gold"], W_CPP))
        silver = defaultdict(list)
        self.sites = {}
        for x in books:
            key = (x["text"], x["block"], x["offset"])
            self.sites[key] = x
            # The rare characters learn from CPP and the hand labels alone, as in the first model: their rules' cases are narrow
            # (杀奔 径奔 bèn) and would teach the model to read every 奔 before a place as bèn.
            if key in labels or x["src"] == "corpus" or x["ch"] in RARE:
                continue
            if x["decided"]:
                silver[(x["ch"], x["fallback"])].append((x["features"], x["fallback"], W_SILVER))
            elif x["src"] == "samples":
                silver[(x["ch"], x["fallback"])].append((x["features"], x["fallback"], W_REVIEWED))
        rnd = random.Random(1)
        for (ch, _), xs in sorted(silver.items()):
            if len(xs) > SILVER_CAP:
                xs = rnd.sample(xs, SILVER_CAP)
            self.by_char[ch].extend(xs)
        self.missing = []
        for key, (ch, gold, folder) in sorted(labels.items()):
            x = self.sites.get(key)
            if not x or x["ch"] != ch:
                self.missing.append(key)
                continue
            self.hand[ch].append({"key": key, "x": x, "gold": gold, "held": held_out(key)})

    def usual(self, ch):
        eligible = [x["fallback"] for x in self.sites.values() if x["ch"] == ch and not x["decided"]]
        if eligible:
            return Counter(eligible).most_common(1)[0][0]
        return Counter(y for _, y, _ in self.by_char[ch]).most_common(1)[0][0]

    def fit(self, ch, hand_rows):
        if ch in RARE:
            # The first model's characters are trained as it was (CPP alone, its features and regularization), so what its
            # review checked stays as it was: with the new features and the hand labels, 奔 before any place became bèn
            # (奔回, 奔进 are bēn) and 十人传百, 门上传鼓 zhuàn.
            xs = [[f for f in x if f.split(":", 1)[0] in FIRST_FEATURES] for x, _, _ in self.by_char[ch]]
            ys = [y for _, y, _ in self.by_char[ch]]
            return train_char(ch, xs, self.own.get(ch, set()), ys, [1.0] * len(ys), self.usual(ch), c=1.0) if xs else None
        xs, ys, ws = [], [], []
        for x, y, w in self.by_char[ch]:
            xs.append(x), ys.append(y), ws.append(w)
        for h in hand_rows:
            xs.append(h["x"]["features"]), ys.append(h["gold"]), ws.append(W_HAND)
        if not xs:
            return None
        return train_char(ch, xs, self.own.get(ch, set()), ys, ws, self.usual(ch))


def tally(model, rows, threshold, own):
    """On hand-labeled places (where the model may speak): n, rules right, model right, changed, changes right."""
    n = rules = now = changed = right = 0
    for h in rows:
        x = h["x"]
        if x["decided"]:
            continue
        n += 1
        pick, _ = choose(model, x["fallback"], x["features"], threshold, own)
        rules += x["fallback"] == h["gold"]
        now += pick == h["gold"]
        if pick != x["fallback"]:
            changed += 1
            right += pick == h["gold"]
    return n, rules, now, changed, right


def calibrate(data, ch, train_rows):
    """The threshold that does the most good out of fold on the training hand labels: a right change counts 1 and a wrong one
    WRONG_COST, so the changes a threshold adds must be right 1 - 1 / (1 + WRONG_COST) of the time to pay for themselves (a single
    wrong change no longer pushes the threshold to the top once there are many labels). Ties go to the higher threshold; where
    no threshold gains, the top of GRID."""
    folds = [[h for h in train_rows if int(hashlib.sha1(repr(h["key"]).encode()).hexdigest(), 16) % 3 == k] for k in range(3)]
    oof = []
    for k in range(3):
        rest = [h for j in range(3) if j != k for h in folds[j]]
        m = data.fit(ch, rest)
        for h in folds[k]:
            oof.append((h, m))
    best = (0.0, GRID[-1], 0, 0)
    for t in GRID:
        changed = right = 0
        for h, m in oof:
            x = h["x"]
            if x["decided"]:
                continue
            pick, _ = choose(m, x["fallback"], x["features"], t, data.own.get(ch, set()))
            if pick != x["fallback"]:
                changed += 1
                right += pick == h["gold"]
        gain = right - WRONG_COST * (changed - right)
        if gain > best[0] or (gain == best[0] and gain > 0):
            best = (gain, t, changed, right)
    return best[1:]


def cpp_eval(models, rows, thresholds):
    n = app = now = changed = right = 0
    for x in rows:
        n += 1
        app += x["app"] == x["gold"]
        got = x["app"]
        if not x["decided"] and x["ch"] in models:
            pick, _ = choose(models[x["ch"]], x["fallback"], x["features"], thresholds[x["ch"]], {x["gold"], x["fallback"]} | set(models[x["ch"]][0]))
            if pick != x["fallback"]:
                got = pick
                changed += 1
                right += pick == x["gold"]
        now += got == x["gold"]
    return n, app, now, changed, right


def write_model(models, thresholds, path, default_threshold):
    lines = [
        "# Dushu reading model: one logistic regression per character, for one-character tokens the reading rules leave to",
        "# their default (src/core/readingModel.ts). Made by scripts/train_reading_model.py from CPP (Chinese Polyphones with",
        "# Pinyin, github.com/kakaobrain/g2pM, Apache-2.0), whose sentences come from Chinese Wikipedia (CC BY-SA 4.0), from",
        "# public-domain books (public/samples and Wikisource) and hand-labeled places in books and the held-out corpus.",
        "# License: CC BY-SA 4.0. Columns: char, readings (the first is the rules' default), biases of readings 2..K, then",
        "# one column per feature: the feature and its weights for readings 2..K.",
        f"!\tv\t{FEATURES_VERSION}",
        f"!\tthreshold\t{default_threshold}",
    ]
    for ch in sorted(models):
        t = thresholds[ch]
        if bar(t, "") != default_threshold:
            lines.append(f"!\tthreshold:{ch}\t{bar(t, '')}")
        for reading, v in sorted(t.items() if isinstance(t, dict) else []):
            if reading:
                lines.append(f"!\tthreshold:{ch}:{reading}\t{v}")
    for ch in sorted(models):
        readings, bias, weights = models[ch]
        cols = [ch, " ".join(readings), " ".join(f"{b:g}" for b in bias)]
        cols += [f + " " + " ".join(f"{v:g}" for v in w) for f, w in sorted(weights.items())]
        lines.append("\t".join(cols))
    data = ("\n".join(lines) + "\n").encode("utf-8")
    with open(path, "wb") as f:
        # mtime 0: the same model gives the same bytes.
        with gzip.GzipFile(filename="", mode="wb", fileobj=f, compresslevel=9, mtime=0) as gz:
            gz.write(data)
    return len(data)


def load_model(path):
    models = {}
    threshold = 1.0
    keyed = {}
    with (gzip.open(path, "rt", encoding="utf-8") if path.endswith(".gz") else open(path, encoding="utf-8")) as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            cols = line.split("\t")
            if cols[0] == "!":
                if cols[1] == "threshold":
                    threshold = float(cols[2])
                elif cols[1].startswith("threshold:"):
                    keyed[cols[1][10:]] = float(cols[2])
                continue
            weights = {}
            for c in cols[3:]:
                parts = c.split(" ")
                weights[parts[0]] = [float(v) for v in parts[1:]]
            models[cols[0]] = (cols[1].split(" "), [float(b) for b in cols[2].split(" ")], weights)
    # threshold:为 is the character's own, threshold:为:wei2 its threshold for changing to wéi.
    thresholds = {}
    for key, v in keyed.items():
        ch, _, reading = key.partition(":")
        if reading:
            t = thresholds.get(ch, keyed.get(ch, threshold))
            thresholds[ch] = {**(t if isinstance(t, dict) else {"": t}), reading: v}
        elif ch not in thresholds:
            thresholds[ch] = v
    return models, threshold, thresholds


def write_check(repo, work, model_path):
    """Scores of the invented check sentences under the written model, for tests/core/readingModel.test.ts."""
    src = os.path.join(repo, "scripts", "data", "reading-model-check.txt")
    out = os.path.join(work, "check-sites.tsv")
    models, _, _ = load_model(model_path)
    run_sites(repo, {"lines": src, "out": out, "only": "".join(sorted(models))})
    rows = ["# line\toffset\tchar\tfallback\tscores (reading:probability, 9 decimals)\tfeatures (made by scripts/train_reading_model.py)"]
    with open(out, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            r = line.rstrip("\n").split("\t")
            ch, decided, feats = r[2], r[4] == "1", r[6:]
            if ch not in models or decided:
                continue
            sc = scores(models[ch], feats)
            rows.append("\t".join([r[0], r[1], ch, r[3], " ".join(f"{k}:{p:.9f}" for k, p in sc)] + feats))
    dest = os.path.join(repo, "tests", "core", "fixtures", "reading-model-check.tsv")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write("\n".join(rows) + "\n")
    return len(rows) - 1


def texts_in(folder):
    return sorted(os.path.join(folder, f) for f in os.listdir(folder) if f.endswith(".txt"))


def main():
    argv = sys.argv[1:]
    if not argv:
        sys.exit(__doc__)
    repo = os.path.abspath(argv[0])
    opt = lambda name, default=None: argv[argv.index(name) + 1] if name in argv else default
    raw = os.path.join(repo, ".cache", "raw", "cpp")
    books_dir = os.path.abspath(opt("--books", os.path.join(repo, ".cache", "raw", "reading-books")))
    books2_dir = os.path.abspath(opt("--books2", os.path.join(repo, ".cache", "raw", "reading-books-2")))
    work = os.path.join(repo, ".cache", "raw", "reading-model")
    os.makedirs(work, exist_ok=True)
    fetch_cpp(raw, "--refetch" in argv)
    # The sites depend on the app's rules and dictionary, so they are read again on every run (--cached reuses the last run's
    # files, only to iterate on the training itself).
    cached = lambda *paths: "--cached" in argv and all(os.path.exists(p) for p in paths)
    sites_cpp, chars = os.path.join(work, "sites-cpp.tsv"), os.path.join(work, "chars-cpp.tsv")
    if not cached(sites_cpp, chars):
        run_sites(repo, {"cpp": raw, "splits": ["train", "dev", "test"], "out": sites_cpp, "chars": chars, "only": TRAINED})
    groups = {"samples": texts_in(os.path.join(repo, "public", "samples")), "books": texts_in(books_dir) if os.path.isdir(books_dir) else [],
              "books2": texts_in(books2_dir) if os.path.isdir(books2_dir) else [],
              "corpus": [p for d in ("public-domain", "cc-by", "cc-by-sa") for p in texts_in(os.path.join(repo, "tests", "corpus", "zh", d))]}
    if not groups["books"] or not groups["books2"]:
        print(f"no books in {books_dir} or {books2_dir}: run scripts/fetch_reading_books.py, and put the texts of"
              " scripts/data/reading-model-books-2.tsv in place, for the full model", file=sys.stderr)
    listed = os.path.join(repo, "scripts", "data", "reading-model-books-2.tsv")
    with open(listed, encoding="utf-8") as f:
        want = {c[0]: c[6] for c in (line.rstrip("\n").split("\t") for line in f if not line.startswith("#")) if len(c) > 6}
    have = {os.path.basename(p)[:-4]: p for p in groups["books2"]}
    for i, digest in sorted(want.items()):
        if i not in have or sha256(have[i]) != digest:
            print(f"{books2_dir}/{i}.txt is missing or not the listed text: its hand labels will be lost", file=sys.stderr)
    ids = Counter(os.path.basename(p)[:-4] for paths in groups.values() for p in paths)
    if any(k > 1 for k in ids.values()):
        sys.exit(f"two texts share an id: {[i for i, k in ids.items() if k > 1]}")
    labels = read_labels(os.path.join(repo, "tests", "corpus", "zh", "readings-calibration.tsv"))
    books = []
    own = read_chars(chars)
    for src, paths in groups.items():
        # Of the second set of books only the places a rule's case decided (silver labels) and the hand-labeled ones are kept.
        keep = (lambda t, b, o, decided: decided or (t, b, o) in labels) if src == "books2" else None
        for i in range(0, len(paths), 8):
            out, out_chars = os.path.join(work, f"sites-{src}-{i // 8}.tsv"), os.path.join(work, f"chars-{src}-{i // 8}.tsv")
            if not cached(out, out_chars):
                run_sites(repo, {"texts": paths[i:i + 8], "out": out, "chars": out_chars, "only": TRAINED})
            books += read_book_sites(out, src, keep)
            for ch, rs in read_chars(out_chars).items():
                own.setdefault(ch, set()).update(rs)
    data = Data(read_cpp_sites(sites_cpp), books, labels, own)
    lost = [k for k in data.missing if labels[k][0] in TRAINED]
    if lost:
        print(f"{len(lost)} hand-labeled places not found (texts or cuts changed): {lost[:5]}", file=sys.stderr)

    report = ["char\tlabels (train/held-out)\tthreshold\theld-out: places\trules right\tmodel right\tchanged\tchanges right\tenabled"]
    models, thresholds, results = {}, {}, {}
    enabled = None if "--decide" in argv else ENABLED
    carried, carried_t = ({}, {}) if not CARRIED else (lambda m: (m[0], m[2]))(load_model(os.path.join(repo, "scripts", "data", "reading-model-carried.tsv")))
    for ch in TRAINED:
        rows = data.hand[ch]
        train_rows = [h for h in rows if not h["held"]]
        test_rows = [h for h in rows if h["held"]]
        if ch in CARRIED:
            # Reported on the held-out labels, which the carried model's own training partly saw.
            t = carried_t[ch]
            results[ch] = (len(train_rows), len(test_rows), t) + tally(carried[ch], test_rows, t, own.get(ch, set()))
            continue
        m = data.fit(ch, train_rows)
        if not m or (enabled is not None and ch not in enabled):
            continue
        if enabled is not None:
            t = enabled[ch]
        elif ch in RARE:
            t = FIRST_THRESHOLD
        else:
            t = calibrate(data, ch, train_rows)[0] if train_rows else THRESHOLD
        results[ch] = (len(train_rows), len(test_rows), t) + tally(m, test_rows, t, own.get(ch, set()))
    rare = [results[ch] for ch in RARE if ch in results]
    rare_ok = sum(r[7] for r in rare) >= ENABLE_RIGHT * sum(r[6] for r in rare) and sum(r[6] for r in rare) >= MIN_CHANGES
    for ch, (n_train, n_test, t, n, rules, now, changed, right) in results.items():
        if enabled is not None or ch in CARRIED:
            ok = True
        elif ch in NOT_FOR_MODEL:
            ok = False  # the app never asks the model about particles
        elif ch in RARE:
            ok = rare_ok and right == changed
        else:
            need = MIN_CHANGES_KEPT if ch in KEPT else MIN_CHANGES
            ok = changed >= need and right >= ENABLE_RIGHT * changed and now > rules
        shown = " ".join(f"{r or '*'}:{v}" for r, v in t.items()) if isinstance(t, dict) else t
        report.append(f"{ch}\t{n_train}/{n_test}\t{shown}\t{n}\t{rules}\t{now}\t{changed}\t{right}\t{'yes' if ok else 'no'}")
        if ok:
            # The file's model is trained on every hand label, the held-out third included (or carried as it is).
            models[ch] = carried[ch] if ch in CARRIED else data.fit(ch, data.hand[ch])
            thresholds[ch] = t
    for name, chars in (("common", COMMON), ("rare", RARE)):
        r = [results[ch] for ch in chars if ch in results]
        on = [results[ch] for ch in chars if ch in models]
        report.append(f"# {name}, all trained: held-out places {sum(x[3] for x in r)}, rules right {sum(x[4] for x in r)}, model right "
                      f"{sum(x[5] for x in r)}, changed {sum(x[6] for x in r)}, right {sum(x[7] for x in r)}; enabled only: places "
                      f"{sum(x[3] for x in on)}, rules right {sum(x[4] for x in on)}, model right {sum(x[5] for x in on)}, changed "
                      f"{sum(x[6] for x in on)}, right {sum(x[7] for x in on)}")
    if enabled is None:
        report.append("# ENABLED = " + repr(thresholds))
    if "--candidates" in argv:
        write_candidates(data, opt("--candidates"), own)
    cpp = cpp_eval(models, data.cpp_test, thresholds)
    report.append(f"# CPP test (one-character places of these characters): {cpp[0]} items, rules {cpp[1]}, with the model {cpp[2]}; changed {cpp[3]}, right {cpp[4]}")
    print("\n".join(report))
    if opt("--report"):
        with open(opt("--report"), "w", encoding="utf-8") as f:
            f.write("\n".join(report) + "\n")
    path = os.path.join(repo, "public", "data", "reading-model.tsv.gz")
    size = write_model(models, thresholds, path, THRESHOLD)
    n_feat = sum(len(m[2]) for m in models.values())
    print(f"{len(models)} characters ({''.join(sorted(models))}), {n_feat} features, {size} bytes, {os.path.getsize(path)} gzipped")
    print(f"check sites: {write_check(repo, work, path)}")


def write_candidates(data, path, own):
    """Places to hand-label: where a model trained without them would change the rules' reading, and a sample of the rest."""
    rnd = random.Random(7)
    lines = ["# folder\ttext\tblock\toffset\tchar\trules\tmodel\tp\tcontext"]
    for ch in COMMON:
        m = data.fit(ch, data.hand[ch])
        if not m:
            continue
        labeled = {h["key"] for h in data.hand[ch]}
        changed, kept = [], []
        for key, x in data.sites.items():
            if x["ch"] != ch or x["decided"] or key in labeled:
                continue
            pick, p = choose(m, x["fallback"], x["features"], 0.5, own.get(ch, set()))
            (changed if pick != x["fallback"] else kept).append((x, pick, p))
        for x, pick, p in rnd.sample(changed, min(len(changed), 40)) + rnd.sample(kept, min(len(kept), 15)):
            lines.append("\t".join([x["src"], x["text"], x["block"], str(x["offset"]), ch, x["fallback"], pick, f"{p:.2f}", x["context"]]))
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
