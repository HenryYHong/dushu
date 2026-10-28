#!/usr/bin/env python3
"""Fetch the short modern classics (1919-1928, public domain) from zh.wikisource.org into public/samples/.

Usage (run with python3 -I):  fetch_stories.py <repo-root> [--refresh]

Uses fetch_samples.py's fetcher, so raw API responses are cached under <repo>/.cache/raw/wikisource/. Each story is
written to public/samples/<id>.txt (title first, then one paragraph per line) and merged into public/samples/index.json
by id, before the Four Great Classical Novels, leaving every other entry as it is. The texts are the first editions'
traditional characters, converted to simplified with the app's own OpenCC tables, as Lu Xun's stories are.
"""
import json, os, re, sys, unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fetch_samples import Fetcher, PagesText, clean_wikitext, han_count, lines_of, load_t2s, to_simplified  # noqa: E402

GROUP = "Short Modern Classics"

# Old glyph forms in these editions that the OpenCC table lacks, mapped to the form modern editions print.
OLD_FORMS = {"旣": "既", "爲": "为", "敎": "教", "眞": "真", "卽": "即", "槪": "概", "羣": "群", "峯": "峰", "綫": "线",
             "竝": "并", "譁": "哗", "麪": "面", "甯": "宁", "淨": "净", "囘": "回", "迴": "回", "吿": "告",
             "覩": "睹", "觔": "斤", "澘": "潸", "祇": "只", "賸": "剩", "畱": "留", "輭": "软", "楡": "榆", "繋": "系",
             "朶": "朵", "怱": "匆", "偸": "偷", "嬝": "袅", "牠": "它", "櫂": "棹", "尙": "尚", "尅": "克", "盌": "碗",
             "鬭": "斗", "嘷": "嗥", "簷": "檐", "礮": "炮", "鎗": "枪", "燄": "焰"}

# Lines left out: the bare date 朱自清 signed 匆匆 with ("三月二十八日"), which reads as noise on its own.
DROP = {"congcong": {"三 二八"}}

# Easiest first: (id, Wikisource title, title, author, traditional author, level, year, died, blurb)
STORIES = [
    ("luohuasheng", "落花生", "落花生", "许地山", "許地山", "Intermediate", 1922, 1941,
     "A family harvests peanuts, and over dinner the father says what the humble peanut can teach them. A school favorite. Written in 1922, it often writes the possessive de with an older character, di."),
    ("chabuduo", "差不多先生傳", "差不多先生传", "胡适", "胡適", "Intermediate", 1919, 1962,
     "The comic life of Mr. More-or-Less, who thinks close enough is always good enough, right up to the end."),
    ("yijian-xiaoshi", "一件小事", "一件小事", "鲁迅", "魯迅", "Intermediate", 1919, 1936,
     "A rickshaw puller stops to help an old woman, and the passenger in a hurry sees himself in a new light. Very short."),
    ("congcong", "匆匆", "匆匆", "朱自清", "朱自清", "Intermediate", 1922, 1948,
     "A short prose poem on how the days slip away, one of the best-loved essays in modern Chinese."),
    ("beiying", "背影", "背影", "朱自清", "朱自清", "Intermediate", 1925, 1948,
     "A son remembers his father crossing the railway tracks to buy him oranges. Perhaps the most famous essay in Chinese."),
    ("zaibie-kangqiao", "再別康橋", "再别康桥", "徐志摩", "徐志摩", "Intermediate", 1928, 1931,
     "Saying goodbye to Cambridge. A short poem many Chinese readers know by heart."),
    ("baicaoyuan", "從百草園到三味書屋", "从百草园到三味书屋", "鲁迅", "魯迅", "Intermediate", 1926, 1936,
     "Lu Xun remembers the wild garden he played in as a boy, and the old-style school he was sent to next."),
    ("shexi", "社戲", "社戏", "鲁迅", "魯迅", "Intermediate", 1922, 1936,
     "Boys row through the night to a village opera, then steal beans on the way home. Lu Xun at his warmest."),
    ("hetang-yuese", "荷塘月色", "荷塘月色", "朱自清", "朱自清", "Advanced", 1927, 1948,
     "A walk by a lotus pond on a moonlit night. Rich, careful description, a classic of modern prose."),
    ("a-q-zhengzhuan", "阿Q正傳", "阿Q正传", "鲁迅", "魯迅", "Advanced", 1921, 1936,
     "The novella of Ah Q, a village laborer who turns every defeat into a victory in his head. Lu Xun's best-known work."),
]


class StoryText(PagesText):
    """PagesText, also leaving out an editor's note shown as a tooltip on a word (一件小事's date line has one)."""

    def handle_starttag(self, tag, attrs):
        if self.depth and not self.skip and "variant-tooltip" in dict(attrs).get("class", ""):
            if tag == "div":
                self.depth += 1
            self.skip = 1
            return
        super().handle_starttag(tag, attrs)


def paragraphs(f, title):
    """The story's paragraphs: from the scanned edition's pages when the page transcludes them, else from the wikitext."""
    wt = f.wikitext(title)
    if "<pages " in wt:
        p = StoryText()
        p.feed(f.html(title))
        p.close()
        return p.paras
    return lines_of(clean_wikitext(wt))


def simplified(text, t2s):
    return to_simplified("".join(OLD_FORMS.get(c, c) for c in text), t2s)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    root = args[0] if args else "."
    f = Fetcher(os.path.join(root, ".cache/raw/wikisource"), refresh="--refresh" in sys.argv)
    t2s = load_t2s(root)
    outdir = os.path.join(root, "public/samples")
    path = os.path.join(outdir, "index.json")
    idx = json.load(open(path, encoding="utf-8"))
    ours = {s[0] for s in STORIES}
    idx = [e for e in idx if e["id"] not in ours]
    at = next((i for i, e in enumerate(idx) if e.get("group") == "Four Great Classical Novels"), len(idx))

    entries = []
    for sid, ws, title, author, trad_author, level, year, died, blurb in STORIES:
        paras = [simplified(p, t2s) for p in paragraphs(f, ws)]
        paras = [p for p in paras if p not in DROP.get(sid, ())]
        if paras and paras[0] == title:
            paras = paras[1:]  # the page's own heading
        lines = [unicodedata.normalize("NFC", ln) for ln in [title] + paras]
        text = "\n".join(lines) + "\n"
        with open(os.path.join(outdir, sid + ".txt"), "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
        entries.append({
            "id": sid, "title": title, "author": author, "script": "simplified", "file": sid + ".txt", "level": level,
            "blurb": blurb, "source": "https://zh.wikisource.org/wiki/" + ws,
            "note": f"Published in {year}, so it is in the US public domain (published before 1931). {trad_author} died in {died}.",
            "chars": han_count(text), "group": GROUP,
            "simplified": {"title": title, "author": author},
            "traditional": {"title": ws, "author": trad_author},
        })
        print(f"{sid:16} {han_count(text):6} Han chars  {len(lines):4} lines")
    idx[at:at] = entries
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(idx, fh, ensure_ascii=False, indent=2)
        fh.write("\n")


if __name__ == "__main__":
    main()
