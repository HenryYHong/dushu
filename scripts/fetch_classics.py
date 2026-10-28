#!/usr/bin/env python3
"""Fetch the Four Great Classical Novels from zh.wikisource.org into public/samples/.

Usage (run with python3 -I):  fetch_classics.py <repo-root> [--refresh] [--book xiyouji,...]

Editions (all complete on Wikisource's main work page for each novel):
  xiyouji      西遊記      100 hui, Wikisource main text ("世德堂本" base, 吳承恩)
  hongloumeng  紅樓夢      120 hui, Wikisource's digitized collated text: hui 1-80 on the 庚辰本,
                          hui 81-120 on the 程甲本 (曹雪芹 / 高鶚), without 批語
  sanguo       三國演義    120 hui, 毛宗崗 revision (羅貫中)
  shuihu       水滸傳      120 hui, 袁無涯刊本 "忠義水滸全傳" (施耐庵). The 100-hui 容與堂本
                          on Wikisource is only partly transcribed (31 hui), so the 120-hui text is used.
Raw API responses are cached under <repo>/.cache/raw/classics/ so reruns are offline.
Output: public/samples/<id>.txt (first line = title; one paragraph per line; each chapter starts
with "第N回<U+3000>couplet title") and the appended entries of public/samples/index.json.
"""
import html, json, os, re, subprocess, sys, time, urllib.parse

API = "https://zh.wikisource.org/w/api.php"
UA = "Dushu-data-builder/0.1"
HAN = re.compile(r"[㐀-䶿一-鿿豈-﫿\U00020000-\U0003134f]")
SP = "　"

BOOKS = {
    "xiyouji": dict(page="西遊記", title="西遊記", author="吳承恩", n=100, file="xiyouji.txt",
                    edition="Wikisource main text of 西遊記 (世德堂本 lineage), 100 hui"),
    "hongloumeng": dict(page="紅樓夢", title="紅樓夢", author="曹雪芹、高鶚", n=120, file="hongloumeng.txt",
                        edition="Wikisource collated text, hui 1-80 from the 庚辰本 and hui 81-120 from the 程甲本, no commentary"),
    "sanguo": dict(page="三國演義", title="三國演義", author="羅貫中", n=120, file="sanguo.txt",
                   edition="毛宗崗 revised edition, 120 hui"),
    "shuihu": dict(page="水滸傳 (120回本)", title="水滸傳", author="施耐庵", n=120, file="shuihu.txt",
                   edition="袁無涯刊本 忠義水滸全傳, 120 hui"),
}

# ------------------------------------------------------------- fetching ---


class Fetcher:
    def __init__(self, cache_dir, refresh=False):
        self.dir, self.refresh, self.last = cache_dir, refresh, 0.0
        os.makedirs(cache_dir, exist_ok=True)

    def call(self, params, name):
        path = os.path.join(self.dir, name)
        if os.path.exists(path) and not self.refresh:
            return json.load(open(path, encoding="utf-8"))
        url = API + "?format=json&" + urllib.parse.urlencode(params)
        for attempt in range(10):
            wait = 2.0 - (time.time() - self.last)
            if wait > 0:
                time.sleep(wait)
            self.last = time.time()
            out = subprocess.run(["curl", "-sS", "-A", UA, url], capture_output=True).stdout
            try:
                data = json.loads(out)
            except ValueError:
                time.sleep(3 + attempt * 4)  # rate limited (the 429 body is not JSON)
                continue
            if "error" in data:
                raise SystemExit(f"API error for {name}: {data['error']}")
            json.dump(data, open(path, "w", encoding="utf-8"), ensure_ascii=False)
            return data
        raise SystemExit(f"giving up on {name}")

    def wikitexts(self, titles, tag):
        """Batch several titles in one query. Returns {title: wikitext}."""
        d = self.call({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                       "redirects": 1, "titles": "|".join(titles)}, f"wt-{tag}.json")
        q = d["query"]
        alias = {}
        for key in ("normalized", "redirects"):
            for r in q.get(key, []):
                alias[r["to"]] = alias.get(r["from"], r["from"])
        out = {}
        for page in q["pages"].values():
            if "revisions" not in page:
                raise SystemExit(f"page missing: {page.get('title')}")
            t = alias.get(page["title"], page["title"])
            out[t] = page["revisions"][0]["slots"]["main"]["*"]
        return out


# ------------------------------------------------------------ cleaning ---

NUM = "〇一二三四五六七八九"


def cn_num(n):
    if n < 10:
        return NUM[n]
    if n < 20:
        return "十" + (NUM[n % 10] if n % 10 else "")
    if n < 100:
        return NUM[n // 10] + "十" + (NUM[n % 10] if n % 10 else "")
    s = NUM[n // 100] + "百"
    r = n % 100
    if r == 0:
        return s
    if r < 10:
        return s + "零" + NUM[r]
    return s + NUM[r // 10] + "十" + (NUM[r % 10] if r % 10 else "")


def _template(m):
    parts = m.group(1).split("|")
    name = parts[0].strip()
    args = parts[1:]
    if name in ("另", "另2", "參", "僻字", "YL") and args:
        return args[0]  # variant / rare-glyph / reign-title templates: first argument is the text
    if name == "CJK-New-Char" and args:
        return chr(int(args[0], 16))
    if name in ("ppoem", "~~"):
        # verse / quotation wrapper: keep the text arguments, drop start=/end= options
        return "\n".join(a for a in args if not re.match(r"^\s*(start|end)\s*=", a))
    return ""  # center, gap, footers, quality banners, TA notes, ...


def strip_templates(s):
    """Innermost-first template resolution (see _template)."""
    pat = re.compile(r"\{\{([^{}]*)\}\}")
    while pat.search(s):
        s = pat.sub(_template, s)
    return s


def clean_inline(s):
    s = re.sub(r"<!--.*?-->", "", s, flags=re.S)
    s = re.sub(r"<ref[^>]*/>", "", s)
    s = re.sub(r"<ref[^>]*>.*?</ref>", "", s, flags=re.S)
    # language-converter markup: -{x}- keeps x; -{zh-hans:a;zh-hant:b}- keeps the traditional form b
    s = re.sub(r"-\{[^{}]*?zh-hant:([^;{}]*?)(?:;[^{}]*)?\}-", r"\1", s)
    s = re.sub(r"-\{([^{}|]*)\}-", r"\1", s)
    s = strip_templates(s)
    s = re.sub(r"\[\[(?:File|Image|Category|檔案|文件|分類)[:：][^\]]*\]\]", "", s, flags=re.I)
    s = re.sub(r"\[\[([^\]|]*)\|([^\]]*)\]\]", r"\2", s)
    s = re.sub(r"\[\[([^\]]*)\]\]", r"\1", s)
    s = re.sub(r"<br\s*/?>", "", s, flags=re.I)
    s = re.sub(r"<[^>]+>", "", s)
    s = s.replace("'''", "").replace("''", "")
    return html.unescape(s)


def parse_toc(wt, n):
    """-> {number: 'couplet title'} from the main page's table of contents."""
    titles = {}
    for ln in wt.split("\n"):
        m = re.match(r"^\*\s*\[\[/第(\d+)回\|(.*)$", ln)
        if not m:
            continue
        k = int(m.group(1))
        rest = m.group(2)
        # either "[[/第001回|第一回　　x　　y]]" or "[[/第001回|第一回]]　　x　　y"
        link, _, tail = rest.partition("]]")
        label = re.sub(r"^第[^\s　]*回", "", link) + " " + tail
        label = clean_inline(label.replace("-{广}-", "庵"))
        halves = [h for h in re.split(r"[\s　]+", label.strip()) if h]
        titles[k] = SP.join(halves)
    missing = [i for i in range(1, n + 1) if i not in titles]
    if missing:
        raise SystemExit(f"TOC lacks chapters {missing[:10]}")
    return titles


def clean_body(wt):
    s = re.sub(r"<!--.*?-->", "", wt, flags=re.S)
    s = re.sub(r"<onlyinclude>|</onlyinclude>|<noinclude>.*?</noinclude>", "", s, flags=re.S)
    s = re.sub(r"</?poem[^>]*>", "\n", s)
    s = s.replace("[雙尾蠍]", "「雙尾蠍」")  # source typo: stray ASCII brackets around a nickname
    s = clean_inline(s)
    out = []
    for ln in s.split("\n"):
        ln = ln.strip()
        ln = re.sub(r"^[:*#;\s　]+", "", ln)
        ln = re.sub(r"[\s　]+$", "", ln)
        ln = re.sub(r"[ \t]+", " ", ln)
        if not ln or ln.startswith("=") or ln in ("__TOC__", "__NOTOC__"):
            continue
        if not HAN.search(ln):
            continue
        if len(ln) < 30 and re.search(r"上一回|下一回|回目[录錄]", ln) and not re.search(r"[，。：；！？」]", ln):
            continue  # prev/next/contents navigation line
        out.append(ln)
    return out


# ---------------------------------------------------------------- build ---


def build(f, bid, spec):
    n = spec["n"]
    toc = parse_toc(f.wikitexts([spec["page"]], f"{bid}-toc")[spec["page"]], n)
    chapters = []
    per = 6
    for a in range(1, n + 1, per):
        names = [f"{spec['page']}/第{i:03d}回" for i in range(a, min(a + per, n + 1))]
        got = f.wikitexts(names, f"{bid}-{a:03d}")
        for i, nm in zip(range(a, a + per), names):
            lines = clean_body(got[nm])
            # drop a repeated heading line at the top of the body
            for k in range(min(3, len(lines))):
                if re.match(r"^第[〇一二三四五六七八九十百零兩两]+回[\s\u3000]", lines[k]) and len(lines[k]) < 60:
                    lines.pop(k)  # the chapter's own heading, repeated in the body
                    break
            chapters.append((i, toc[i], lines))
    out = [spec["title"]]
    for i, t, lines in chapters:
        out.append(f"第{cn_num(i)}回{SP}{t}")
        out.extend(lines)
    return chapters, "\n".join(out) + "\n"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = args[0]
    only = None
    for a in sys.argv[1:]:
        if a.startswith("--book="):
            only = a[7:].split(",")
    f = Fetcher(os.path.join(root, ".cache/raw/classics"), "--refresh" in sys.argv)
    stats = {}
    for bid, spec in BOOKS.items():
        if only and bid not in only:
            continue
        chapters, text = build(f, bid, spec)
        open(os.path.join(root, "public/samples", spec["file"]), "w", encoding="utf-8").write(text)
        hans = [len(HAN.findall(text))]
        stats[bid] = (len(chapters), sum(hans))
        print(bid, len(chapters), "chapters", sum(hans), "Han chars")
    update_index(root, stats)


BLURBS = {
    "xiyouji": ("Advanced", "The Monkey King and the monk Tang Sanzang travel west for the scriptures. All 100 chapters of Journey to the West.",
                "Wu Cheng'en, 16th century; public domain worldwide. Text: Wikisource, Shidetang-based edition."),
    "hongloumeng": ("Advanced", "The rise and fall of the Jia family, and Baoyu and Daiyu. All 120 chapters of Dream of the Red Chamber.",
                    "Cao Xueqin (ch. 1-80) and Gao E (ch. 81-120), 18th century; public domain worldwide. Text: Wikisource collated edition (Gengchen base for 1-80, Cheng-jia for 81-120)."),
    "sanguo": ("Advanced", "Liu Bei, Cao Cao and Zhuge Liang fight over what is left of the Han. All 120 chapters of Romance of the Three Kingdoms.",
               "Luo Guanzhong, 14th century, in the Mao Zonggang revision; public domain worldwide. Text: Wikisource."),
    "shuihu": ("Advanced", "108 outlaws gather at Liangshan Marsh. All 120 chapters of Water Margin.",
               "Shi Nai'an, 14th century; public domain worldwide. Text: Wikisource, the 120-chapter Yuan Wuya edition."),
}
SOURCES = {"xiyouji": "西遊記", "hongloumeng": "紅樓夢", "sanguo": "三國演義", "shuihu": "水滸傳_(120回本)"}


def update_index(root, stats):
    path = os.path.join(root, "public/samples/index.json")
    idx = json.load(open(path, encoding="utf-8"))
    by_id = {e["id"]: i for i, e in enumerate(idx)}
    for bid, spec in BOOKS.items():
        if bid not in stats:
            continue
        lvl, blurb, note = BLURBS[bid]
        entry = {"id": bid, "title": spec["title"], "author": spec["author"], "script": "traditional",
                 "file": spec["file"], "level": lvl, "blurb": blurb,
                 "source": "https://zh.wikisource.org/wiki/" + SOURCES[bid],
                 "note": note, "chapters": stats[bid][0], "chars": stats[bid][1],
                 "group": "The four great novels"}
        if bid in by_id:
            idx[by_id[bid]] = {**idx[by_id[bid]], **entry}  # keeps fields kept by hand (titles per script, cover)
        else:
            idx.append(entry)
    json.dump(idx, open(path, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    open(path, "a").write("\n")


if __name__ == "__main__":
    main()
