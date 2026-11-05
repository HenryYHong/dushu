#!/usr/bin/env python3
"""Train public/data/reading-model.tsv.gz: the reading model for one-character tokens (src/core/readingModel.ts,
ARCHITECTURE.md §4.1 Reading model).

Usage (python3 -I, from a venv with numpy, scipy and scikit-learn; Node 22 on PATH):
  train_reading_model.py <repo-root> [--report] [--refetch] [--threshold P]

1. Fetches CPP (github.com/kakaobrain/g2pM, data/{train,dev,test}.{sent,lb}: Apache-2.0 code, sentences from Chinese
   Wikipedia, CC BY-SA) into <repo>/.cache/raw/cpp and checks each file's sha256.
2. Reads every CPP sentence through the app (scripts/eval/zh-reading-sites.run.ts, run by node inside Vitest): for each item
   whose character is a one-character token that no rule's case read, the features the app computes (siteFeatures) and the
   reading the rules give it. The model is trained on exactly what the app will show it.
3. Trains one logistic regression per character on the train and dev splits (never on test, which the CPP benchmark
   scores). The rules' reading is class 0 and gets PRIOR pseudo-examples with no features, so the model has to see the
   other reading often enough in CPP before it is sure of it. Characters the model would never change are left out.
4. Writes the model (weights rounded to 2 decimals) and tests/core/fixtures/reading-model-check.tsv: the features and
   scores of the invented sentences in scripts/data/reading-model-check.txt, which tests/core/readingModel.test.ts checks
   against the TypeScript.

--report also trains on train alone and prints accuracy on dev and test at several thresholds. The trained model is
CC BY-SA 4.0 (it is made from CPP's Wikipedia sentences): credited in About, README and ARCHITECTURE §8.
"""
import gzip, hashlib, json, math, os, shutil, subprocess, sys
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
FEATURES_VERSION = 1
# Inverse regularization, pseudo-examples of the rules' reading, features seen fewer times than this are dropped.
C = 1.0
PRIOR = 4
MIN_COUNT = 2
PRUNE = 0.05
# Probability the model must reach to change a reading, and the characters it may change: both set on the hand-labeled
# calibration set (tests/corpus/zh/readings-calibration.tsv, 734 places in the held-out corpus and public/samples). CPP's
# sentences are Wikipedia's, and for most characters the reading they favor is not the one books mean (藏 zàng for Tibet,
# 少 shào, 为 wéi as "to be", 钻 zuàn, 塞 sài, 舍 shè …): the model's changes there were right less than 60% of the time.
# These are the characters whose changes were right at least 90% of the time and whose other reading books rarely mean.
THRESHOLD = 0.7
# A first judged sample of the corpus and tuned-book diff (69 of 100 right) took out 应 (yīng "should" in verse and the old
# novels), 耙 (bà, the harrow of village novels), 臊 (sāo, a smell), 拗 (ǎo, to bend), 煞 (shā) and 鹄 (gǔ, a target).
ALLOW = set("传杓相刹艮率藉圜裨脯茆什奔宿隽苕茄杈颉槛镝仔姥畜")
# Particles and interjections: the rules own them (NOT_FOR_MODEL in src/core/readingModel.ts).
NOT_FOR_MODEL = set("了着著得地的儿兒么麼罢罷吧呢啊呀哇啦哪嘛哟喔哦噢呐咯哩唻嘞呗唄啰囉耶邪欤歟乎哉兮焉矣也夫唉嗯哼嘿哈喂呸噫嘻吁咦嗨呃嗳噯哎呦呵嚯个個们們子头頭一不")


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
        sys.exit("reading the sentences through the app failed")


def read_cpp_sites(path):
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            r = line.rstrip("\n").split("\t")
            rows.append({"split": r[0], "ch": r[2], "gold": r[3], "one": r[5] == "1", "app": r[6],
                         "eligible": r[7] == "1", "fallback": r[8], "features": r[9:] if r[7] == "1" else []})
    return rows


def read_chars(path):
    own = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            ch, readings = line.rstrip("\n").split("\t")
            own[ch] = set(readings.split())
    return own


def train(rows, own, splits):
    """One model per character: {ch: (readings, bias, {feature: weights})}, readings[0] the rules' usual reading."""
    by_char = defaultdict(list)
    for x in rows:
        if x["eligible"] and x["split"] in splits and x["gold"] in own.get(x["ch"], ()):
            by_char[x["ch"]].append(x)
    models = {}
    for ch in sorted(by_char):
        if ch not in ALLOW or ch in NOT_FOR_MODEL:
            continue
        xs = by_char[ch]
        usual = Counter(x["fallback"] for x in xs).most_common(1)[0][0]
        golds = Counter(x["gold"] for x in xs)
        if set(golds) <= {usual}:
            continue
        readings = [usual] + sorted(g for g in golds if g != usual)
        counts = Counter(f for x in xs for f in x["features"])
        vocab = sorted(f for f, k in counts.items() if k >= MIN_COUNT)
        index = {f: i for i, f in enumerate(vocab)}
        ri, ci, y = [], [], []
        for i, x in enumerate(xs):
            for f in x["features"]:
                j = index.get(f)
                if j is not None:
                    ri.append(i)
                    ci.append(j)
            y.append(readings.index(x["gold"]))
        # The rules' reading as pseudo-examples with no features: a prior toward what the rules say.
        y += [0] * PRIOR
        X = csr_matrix((np.ones(len(ri)), (ri, ci)), shape=(len(y), max(1, len(vocab))))
        lr = LogisticRegression(C=C, max_iter=5000, tol=1e-8)
        lr.fit(X, y)
        coef = lr.coef_
        icpt = lr.intercept_
        if len(readings) == 2:
            # sklearn keeps one row for two classes: the log-odds of class 1.
            diff = coef[0:1]
            bias = [float(icpt[0])]
        else:
            diff = coef[1:] - coef[0]
            bias = [float(b - icpt[0]) for b in icpt[1:]]
        weights = {}
        for f, j in index.items():
            w = [round(float(diff[k, j]), 2) for k in range(len(readings) - 1)]
            if max(abs(v) for v in w) >= PRUNE:
                weights[f] = w
        models[ch] = (readings, [round(b, 2) for b in bias], weights)
    return models


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


def choose(models, ch, fallback, features, threshold):
    m = models.get(ch)
    if not m or fallback not in m[0]:
        return fallback, None
    sc = scores(m, features)
    best = max(sc, key=lambda x: x[1])
    return (best[0] if best[1] >= threshold else fallback), best[1]


def prune_unused(models, rows, threshold):
    """Drops characters whose model never changes a training site's reading even at half the threshold."""
    by_char = defaultdict(list)
    for x in rows:
        if x["eligible"]:
            by_char[x["ch"]].append(x)
    keep = {}
    for ch, m in models.items():
        if any(choose(models, ch, x["fallback"], x["features"], min(threshold, 0.5))[0] != x["fallback"] for x in by_char[ch]):
            keep[ch] = m
    return keep


def evaluate(models, rows, split, threshold):
    xs = [x for x in rows if x["split"] == split]
    n = len(xs)
    app = sum(x["app"] == x["gold"] for x in xs)
    now = 0
    one = [x for x in xs if x["one"]]
    app1 = sum(x["app"] == x["gold"] for x in one)
    now1 = 0
    changed = right = 0
    for x in xs:
        got = x["app"]
        if x["eligible"]:
            pick, _ = choose(models, x["ch"], x["fallback"], x["features"], threshold)
            if pick != x["fallback"]:
                got = pick
                changed += 1
                right += pick == x["gold"]
        now += got == x["gold"]
        if x["one"]:
            now1 += got == x["gold"]
    return (f"{split} @{threshold}: strict {100 * app / n:.2f} -> {100 * now / n:.2f}, one-character {100 * app1 / len(one):.2f} -> "
            f"{100 * now1 / len(one):.2f}; changed {changed}, right {right}")


def write_model(models, path, threshold):
    lines = [
        "# Dushu reading model: one logistic regression per character, for one-character tokens the reading rules leave to",
        "# their default (src/core/readingModel.ts). Made by scripts/train_reading_model.py from CPP (Chinese Polyphones with",
        "# Pinyin, github.com/kakaobrain/g2pM, Apache-2.0), whose sentences come from Chinese Wikipedia (CC BY-SA 4.0).",
        "# License: CC BY-SA 4.0. Columns: char, readings (the first is the rules' default), biases of readings 2..K, then",
        "# one column per feature: the feature and its weights for readings 2..K.",
        f"!\tv\t{FEATURES_VERSION}",
        f"!\tthreshold\t{threshold}",
    ]
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
    with gzip.open(path, "rt", encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("# "):
                continue
            cols = line.split("\t")
            if cols[0] == "!":
                if cols[1] == "threshold":
                    threshold = float(cols[2])
                continue
            weights = {}
            for c in cols[3:]:
                parts = c.split(" ")
                weights[parts[0]] = [float(v) for v in parts[1:]]
            models[cols[0]] = (cols[1].split(" "), [float(b) for b in cols[2].split(" ")], weights)
    return models, threshold


def write_check(repo, work, model_path):
    """Scores of the invented check sentences under the written model, for tests/core/readingModel.test.ts."""
    src = os.path.join(repo, "scripts", "data", "reading-model-check.txt")
    out = os.path.join(work, "check-sites.tsv")
    run_sites(repo, {"lines": src, "out": out})
    models, threshold = load_model(model_path)
    rows = ["# line\toffset\tchar\tfallback\tscores (reading:probability, 9 decimals)\tfeatures (made by scripts/train_reading_model.py)"]
    with open(out, encoding="utf-8") as f:
        for line in f:
            if line.startswith("#"):
                continue
            r = line.rstrip("\n").split("\t")
            ch, feats = r[2], r[5:]
            if ch not in models:
                continue
            sc = scores(models[ch], feats)
            rows.append("\t".join([r[0], r[1], ch, r[3], " ".join(f"{k}:{p:.9f}" for k, p in sc)] + feats))
    dest = os.path.join(repo, "tests", "core", "fixtures", "reading-model-check.tsv")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        f.write("\n".join(rows) + "\n")
    return len(rows) - 1


def main():
    argv = sys.argv[1:]
    if not argv:
        sys.exit(__doc__)
    repo = os.path.abspath(argv[0])
    threshold = THRESHOLD
    if "--threshold" in argv:
        threshold = float(argv[argv.index("--threshold") + 1])
    raw = os.path.join(repo, ".cache", "raw", "cpp")
    work = os.path.join(repo, ".cache", "raw", "reading-model")
    os.makedirs(work, exist_ok=True)
    fetch_cpp(raw, "--refetch" in argv)
    sites = os.path.join(work, "sites-cpp.tsv")
    chars = os.path.join(work, "chars-cpp.tsv")
    # The sites depend on the app's rules and dictionary, so they are read again on every run.
    run_sites(repo, {"cpp": raw, "splits": ["train", "dev", "test"], "out": sites, "chars": chars})
    rows = read_cpp_sites(sites)
    own = read_chars(chars)
    if "--report" in argv:
        m = prune_unused(train(rows, own, {"train"}), [x for x in rows if x["split"] == "train"], threshold)
        for t in (0.5, 0.7, 0.8, 0.9, 0.95):
            print("trained on train:", evaluate(m, rows, "dev", t))
    models = prune_unused(train(rows, own, {"train", "dev"}), [x for x in rows if x["split"] in ("train", "dev")], threshold)
    if "--report" in argv:
        for t in (0.5, 0.7, 0.8, 0.9, 0.95):
            print("trained on train+dev:", evaluate(models, rows, "test", t))
    path = os.path.join(repo, "public", "data", "reading-model.tsv.gz")
    size = write_model(models, path, threshold)
    n_feat = sum(len(m[2]) for m in models.values())
    print(f"{len(models)} characters, {n_feat} features, {size} bytes, {os.path.getsize(path)} gzipped; threshold {threshold}")
    print(f"check sites: {write_check(repo, work, path)}")


if __name__ == "__main__":
    main()
