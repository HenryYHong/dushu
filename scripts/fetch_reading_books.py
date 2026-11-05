#!/usr/bin/env python3
"""Fetch the public-domain books the reading model learns from (scripts/train_reading_model.py): the pinned zh.wikisource
revisions listed in scripts/data/reading-model-books.tsv, written as one .txt per book (a heading per page) to
<repo>/.cache/raw/reading-books, which the training script reads.

Usage: python3 -I scripts/fetch_reading_books.py <repo-root> [--pages DIR]

--pages DIR reads pages fetched before (DIR/<id>/NNN.json, {"title", "revid", "text"}) instead of asking Wikisource. Every book
in the list was first published in 1930 or earlier (US public domain) and none is in tests/corpus/zh, public/samples or the
sealed test set. One request at a time with a pause between them, as Wikimedia asks of bots.
"""
import json, os, re, subprocess, sys, time, urllib.parse
from html.parser import HTMLParser

UA = "Dushu-sample-fetcher/0.1 (personal reading app)"
API = "https://zh.wikisource.org/w/api.php"
NUM = "一二三四五六七八九十"
SKIP_CLASS = re.compile(r"(^|\s)(noprint|ws-noexport|ws-pagenum|pagenum|licenseContainer|licensetpl|mw-editsection|reference|references|"
                        r"mw-references-wrap|navbox|toc|ws-summary|metadata|ambox|hatnote|infobox|mw-empty-elt|thumb|gallery|catlinks|"
                        r"reflist|wikitable|ws-header|wst-header|mw-ref)(\s|$)")
SKIP_TAGS = {"head", "title", "style", "script", "rt", "rp", "sup", "figure", "figcaption", "math", "noscript", "table"}
BLOCK = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li", "dd", "dt", "blockquote", "tr", "br", "hr", "center", "pre", "section", "ul", "ol", "dl"}
VOID = {"br", "hr", "img", "meta", "link", "input", "wbr", "col", "area", "base", "source", "track", "embed", "param"}
# Furniture lines: notes, license notices, navigation, page numbers.
FURNITURE = re.compile(r"^(註釋|注釋|注释|參考文獻|参考文献|本作品.*|.*公有領域.*|.*公有领域.*|.*著作權.*|.*著作权.*|上一[回篇章卷].*|下一[回篇章卷].*|←.*|.*→|"
                       r"[\[〔（(]?[0-9０-９]{1,3}[\]〕）)]?)$")
CJK_SPACE = re.compile(r"(?<=[、-鿿＀-￯\U00020000-\U0003ffff]) +| +(?=[、-鿿＀-￯\U00020000-\U0003ffff])")


class Text(HTMLParser):
    """A MediaWiki page's HTML as lines of text, one per block, without the page's furniture."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack, self.lines, self.cur = [], [], []

    def skipping(self):
        return any(s for _, s in self.stack)

    def flush(self):
        t = re.sub(r"[ \t\r\n\f\v\xa0]+", " ", "".join(self.cur)).strip(" ")
        self.cur = []
        t = CJK_SPACE.sub("", t)
        if t:
            self.lines.append(t)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        skip = tag in SKIP_TAGS or bool(SKIP_CLASS.search(a.get("class") or "")) or "display:none" in (a.get("style") or "").replace(" ", "")
        if tag in BLOCK and not self.skipping():
            self.flush()
        if tag not in VOID:
            self.stack.append((tag, skip))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                was = self.skipping()
                del self.stack[i:]
                if tag in BLOCK and not was:
                    self.flush()
                return

    def handle_data(self, data):
        if not self.skipping():
            self.cur.append(data)


def lines_of(html):
    p = Text()
    p.feed(html)
    p.close()
    p.flush()
    out = []
    for line in p.lines:
        line = line.replace("​", "").replace("﻿", "").strip()
        if line and not FURNITURE.match(line):
            out.append(line)
    return out


def cn(n):
    if n <= 10:
        return NUM[n - 1]
    if n < 20:
        return "十" + NUM[n - 11]
    t, u = divmod(n, 10)
    return NUM[t - 1] + "十" + (NUM[u - 1] if u else "")


def fetch(revid):
    params = {"action": "parse", "oldid": revid, "prop": "text", "disablelimitreport": 1, "disableeditsection": 1,
              "format": "json", "formatversion": 2}
    url = API + "?" + urllib.parse.urlencode(params)
    for i in range(5):
        r = subprocess.run(["curl", "-sS", "--fail", "-A", UA, "--max-time", "90", url], capture_output=True)
        time.sleep(1.5)
        if r.returncode == 0:
            return json.loads(r.stdout)["parse"]["text"]
        time.sleep(10 * (i + 1))
    sys.exit(f"could not fetch revision {revid}")


def main():
    argv = sys.argv[1:]
    if not argv:
        sys.exit(__doc__)
    repo = os.path.abspath(argv[0])
    pages = os.path.abspath(argv[argv.index("--pages") + 1]) if "--pages" in argv else None
    out = os.path.join(repo, ".cache", "raw", "reading-books")
    os.makedirs(out, exist_ok=True)
    books = {}
    with open(os.path.join(repo, "scripts", "data", "reading-model-books.tsv"), encoding="utf-8") as f:
        for line in f:
            if line.startswith("#") or not line.strip():
                continue
            id_, title, kind, n, page, revid = line.rstrip("\n").split("\t")
            books.setdefault(id_, (title, kind, []))[2].append((int(n), page, revid))
    for id_, (title, kind, rows) in books.items():
        body = [title]
        for k, (n, page, revid) in enumerate(sorted(rows), 1):
            if pages:
                with open(os.path.join(pages, id_, f"{n:03d}.json"), encoding="utf-8") as f:
                    html = json.load(f)["text"]
            else:
                html = fetch(revid)
            heading = f"第{cn(k)}回" if kind == "novel" else f"第{cn(k)}篇"
            body.append(f"{heading}　{page.split('/')[-1]}")
            body += ["　　" + line for line in lines_of(html)]
        text = "\n".join(body) + "\n"
        with open(os.path.join(out, id_ + ".txt"), "w", encoding="utf-8") as f:
            f.write(text)
        han = len(re.findall("[㐀-鿿]", text))
        print(f"{id_}\t{han} Han characters")


if __name__ == "__main__":
    main()
