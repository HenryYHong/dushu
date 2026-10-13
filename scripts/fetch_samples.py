#!/usr/bin/env python3
"""Fetch the public-domain sample books from zh.wikisource.org into public/samples/.

Usage (run with python3 -I):  fetch_samples.py <repo-root> [--refresh]

Raw API responses are cached under <repo>/.cache/raw/wikisource/ so reruns are offline.
Output: public/samples/<id>.txt (one paragraph per line, UTF-8) and public/samples/index.json.
Text is Wikisource's own; Lu Xun's stories are converted from the 1938 edition's traditional
characters to simplified with the app's own OpenCC tables (public/data/t2s.tsv.gz).
"""
import gzip, html, json, os, re, subprocess, sys, time, unicodedata, urllib.parse
from html.parser import HTMLParser

API = "https://zh.wikisource.org/w/api.php"
UA = "Dushu-sample-fetcher/0.1"
HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿\U00020000-\U0003134f]")

# Old glyph forms used in the 1938 Lu Xun edition that OpenCC's table lacks (mapped to standard traditional first).
OLD_FORMS = {"淸": "清", "儍": "傻", "煑": "煮", "鎭": "鎮", "衞": "衛", "啓": "啟", "麽": "麼", "糢": "模",
             "纔": "才", "恠": "怪", "嚮": "向", "溼": "濕", "牀": "床", "靑": "青", "鄕": "鄉", "汚": "污",
             "嬾": "懶", "姪": "侄", "揑": "捏", "粃": "秕", "寃": "冤", "呪": "咒", "硏": "研", "吿": "告"}

# ------------------------------------------------------------- fetching ---


class Fetcher:
    def __init__(self, cache_dir, refresh=False):
        self.dir, self.refresh, self.last = cache_dir, refresh, 0.0
        os.makedirs(cache_dir, exist_ok=True)

    def _call(self, params, name):
        path = os.path.join(self.dir, name)
        if os.path.exists(path) and not self.refresh:
            return json.load(open(path, encoding="utf-8"))
        url = API + "?format=json&" + urllib.parse.urlencode(params)
        for attempt in range(8):
            wait = 1.5 - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            out = subprocess.run(["curl", "-sS", "-A", UA, url], capture_output=True).stdout
            try:
                data = json.loads(out)
            except ValueError:
                time.sleep(2 + attempt * 3)  # rate limited (HTTP 429 body is not JSON)
                continue
            if "error" in data:
                raise SystemExit(f"API error for {name}: {data['error']}")
            json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False)
            return data
        raise SystemExit(f"giving up on {name}")

    def wikitext(self, title):
        d = self._call({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                        "redirects": 1, "titles": title}, "wt-" + re.sub(r"\W", "_", title) + ".json")
        page = next(iter(d["query"]["pages"].values()))
        if "revisions" not in page:
            raise SystemExit(f"page missing: {title}")
        return page["revisions"][0]["slots"]["main"]["*"]

    def html(self, title):
        d = self._call({"action": "parse", "prop": "text", "redirects": 1, "disablelimitreport": 1,
                        "page": title}, "html-" + re.sub(r"\W", "_", title) + ".json")
        return d["parse"]["text"]["*"]


# ------------------------------------------------------- wikitext cleaning ---


def strip_templates(s):
    """Replace {{另|a|b}} / {{另2|a|note}} with a, drop every other template (nesting-safe)."""
    while True:
        m = None
        for m in re.finditer(r"\{\{([^{}]*)\}\}", s):
            pass
        if not m:
            return s
        def repl(m):
            parts = m.group(1).split("|")
            if parts[0].strip() in ("另", "另2") and len(parts) > 1:
                return parts[1]
            return ""
        s = re.sub(r"\{\{([^{}]*)\}\}", repl, s)


def clean_wikitext(s):
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    s = strip_templates(s)
    s = re.sub(r"\[\[(?:File|Image|Category|category|檔案|文件|分類):[^\]]*\]\]", "", s)
    s = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    return html.unescape(s)


def between(s, start, end):
    i = s.find(start)
    j = s.find(end, i + len(start)) if i >= 0 else -1
    if i < 0 or j < 0:
        raise SystemExit(f"markers {start!r}..{end!r} not found")
    return s[i + len(start):j]


def han_count(text):
    return len(HAN.findall(text))


def lines_of(text):
    out = []
    for ln in text.split("\n"):
        ln = ln.strip().lstrip(":*#; 　").strip()
        ln = re.sub(r"\s+", " ", ln)
        if ln:
            out.append(ln)
    return out


# ------------------------------------------------------------------ poems ---

POEMS = [  # (wikisource title, display title, author, which <poem> block)
    ("靜夜思", "靜夜思", "李白", 1),     # block 1 = the Tang Poems 300 version (明月)
    ("春曉 (孟浩然)", "春曉", "孟浩然", 0),
    ("登鸛雀樓 (王之渙)", "登鸛雀樓", "王之渙", 0),
    ("相思", "相思", "王維", 0),
    ("江雪", "江雪", "柳宗元", 0),
    ("遊子吟 (孟郊)", "遊子吟", "孟郊", 0),
    ("詠鵝", "詠鵝", "駱賓王", 0),
    ("鹿柴 (王維)", "鹿柴", "王維", 0),
]


def poem_block(wt, index):
    blocks = re.findall(r"<poem>(.*?)</poem>", wt, flags=re.S)
    if len(blocks) <= index:
        raise SystemExit("poem block missing")
    return clean_wikitext(blocks[index])


def join_couplets(verse):
    """One line per sentence: some pages put one verse per line, some two."""
    out, buf = [], ""
    for v in verse:
        buf += v
        if buf.endswith("。"):
            out.append(buf)
            buf = ""
    return out + ([buf] if buf else [])


def build_poems(f):
    out = ["唐詩八首"]
    for title, name, author, idx in POEMS:
        verse = lines_of(poem_block(f.wikitext(title), idx))
        couplets = join_couplets(verse)
        out += [f"{name}　{author}"] + couplets
    return out


# ------------------------------------------------------------ Lu Xun (HTML) ---


class PagesText(HTMLParser):
    """Collect paragraphs inside <div class="prp-pages-output">, skipping page-number marks."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.depth = 0       # div depth inside the pages block, 0 = outside
        self.skip = 0        # depth of ignorable elements
        self.cur, self.paras = [], []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        cls = a.get("class", "")
        if self.depth == 0:
            if tag == "div" and "prp-pages-output" in cls:
                self.depth = 1
            return
        if tag == "div":
            self.depth += 1
        if self.skip:
            self.skip += 1
        elif tag in ("sup", "style", "script") or "pagenum" in cls or "ws-noexport" in cls or "reference" in cls or "mw-editsection" in cls:
            self.skip = 1
        elif tag == "br":
            self.flush()
        elif tag in ("p", "dd", "dt", "li", "h1", "h2", "h3", "h4"):
            self.flush()

    def handle_endtag(self, tag):
        if self.depth == 0:
            return
        if self.skip:
            self.skip -= 1
        if tag == "div":
            self.depth -= 1
            if self.depth == 0:
                self.flush()
        elif tag in ("p", "dd", "dt", "li", "h1", "h2", "h3", "h4"):
            self.flush()

    def handle_data(self, data):
        if self.depth and not self.skip:
            self.cur.append(data)

    def flush(self):
        t = re.sub(r"[\s​]+", " ", "".join(self.cur)).strip()
        self.cur = []
        if t:
            self.paras.append(t)


def luxun_paragraphs(f, title):
    p = PagesText()
    p.feed(f.html(title))
    p.close()
    return p.paras


def load_t2s(root):
    phrases, chars = {}, {}
    with gzip.open(os.path.join(root, "public/data/t2s.tsv.gz"), "rt", encoding="utf-8") as fh:
        for ln in fh:
            if ln.startswith("#"):
                continue
            a, b = ln.rstrip("\n").split("\t")[:2]
            (chars if len(a) == 1 else phrases)[a] = b
    return phrases, chars


def to_simplified(text, tables):
    phrases, chars = tables
    maxlen = max(map(len, phrases))
    text = "".join(OLD_FORMS.get(c, c) for c in text)
    out, i = [], 0
    while i < len(text):
        for n in range(min(maxlen, len(text) - i), 1, -1):
            if text[i:i + n] in phrases:
                out.append(phrases[text[i:i + n]])
                i += n
                break
        else:
            out.append(chars.get(text[i], text[i]))
            i += 1
    return "".join(out)


# ------------------------------------------------------------------- books ---


def build_lunyu(f):
    wt = f.wikitext("論語/學而第一")
    body = between(wt, "<onlyinclude>", "</onlyinclude>")
    body = re.sub(r"<div id=[^>]*>.*?</div>", "", body, flags=re.S)
    return ["學而第一"] + lines_of(clean_wikitext(body))


def build_xiyouji(f):
    wt = f.wikitext("西遊記/第001回")
    body = wt.split("}}", 1)[1]            # drop the {{header ...}} block (no nested braces inside)
    body = body.split("{{footer", 1)[0]
    lines = lines_of(clean_wikitext(body))
    return ["第一回 靈根育孕源流出 心性修持大道生"] + lines


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = args[0] if args else "."
    f = Fetcher(os.path.join(root, ".cache/raw/wikisource"), refresh="--refresh" in sys.argv)
    t2s = load_t2s(root)
    outdir = os.path.join(root, "public/samples")
    os.makedirs(outdir, exist_ok=True)

    def luxun(title):
        paras = luxun_paragraphs(f, title)
        return [title] + [to_simplified(p, t2s) for p in paras]

    books = [
        dict(id="tang-poems", title="唐詩八首", author="李白、王維等", script="traditional", level="Beginner",
             lines=build_poems(f), source="https://zh.wikisource.org/wiki/唐詩三百首",
             blurb="Eight short, famous Tang poems, mostly four lines each, ideal for your first real reading.",
             note="Tang dynasty poems from the 8th century, in the public domain worldwide."),
        dict(id="kong-yiji", title="孔乙己", author="鲁迅", script="simplified", level="Intermediate",
             lines=None, wsid="孔乙己", source="https://zh.wikisource.org/wiki/孔乙己",
             blurb="A short story about a failed scholar who drinks at a village tavern, one of the most famous works of modern Chinese fiction.",
             note="Published in 1919, so it is in the US public domain (published before 1931)."),
        dict(id="guxiang", title="故乡", author="鲁迅", script="simplified", level="Intermediate",
             lines=None, wsid="故鄉", source="https://zh.wikisource.org/wiki/故鄉",
             blurb="A man returns to his hometown and finds that both the place and his childhood friend have changed.",
             note="Published in 1921, so it is in the US public domain (published before 1931)."),
        dict(id="kuangren-riji", title="狂人日记", author="鲁迅", script="simplified", level="Advanced",
             lines=None, wsid="狂人日記", source="https://zh.wikisource.org/wiki/狂人日記",
             blurb="China's first modern vernacular short story, the diary of a man who fears everyone around him wants to eat him.",
             note="Published in 1918, so it is in the US public domain (published before 1931)."),
        dict(id="lunyu-xue-er", title="論語·學而", author="孔子弟子", script="traditional", level="Advanced",
             lines=build_lunyu(f), source="https://zh.wikisource.org/wiki/論語/學而第一",
             blurb="The first chapter of the Analects, sixteen short sayings on learning and character, in classical Chinese.",
             note="Composed more than 2,000 years ago, in the public domain worldwide."),
        dict(id="xiyouji-1", title="西遊記 第一回", author="吳承恩", script="traditional", level="Advanced",
             lines=build_xiyouji(f), source="https://zh.wikisource.org/wiki/西遊記/第001回",
             blurb="The Monkey King is born from a stone, finds a home at Flower-Fruit Mountain, and sets out to learn immortality.",
             note="Written in the 16th century, in the public domain worldwide."),
    ]

    index = []
    for b in books:
        lines = b["lines"] if b["lines"] is not None else luxun(b["wsid"])
        lines = [unicodedata.normalize("NFC", ln) for ln in lines]
        if b["script"] == "simplified":
            lines[0] = b["title"]
        text = "\n".join(lines) + "\n"
        fname = b["id"] + ".txt"
        with open(os.path.join(outdir, fname), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        index.append(dict(id=b["id"], title=b["title"], author=b["author"], script=b["script"], file=fname,
                          level=b["level"], blurb=b["blurb"], source=b["source"], note=b["note"]))
        print(f"{b['id']:14} {han_count(text):6} Han chars  {len(lines):4} lines")
    with open(os.path.join(outdir, "index.json"), "w", encoding="utf-8") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main()
