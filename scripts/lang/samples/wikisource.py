#!/usr/bin/env python3 -I
"""Turn a rendered Wikisource page (fetch.sh wikisource ...) into plain paragraphs.

  python3 -I wikisource.py page.html out.txt [--verse]

Headings (h2-h4) become "## " lines. Paragraph-like blocks (p, dd, li, div.poem) become blank-line separated
paragraphs. With --verse, <br> and newlines inside a block start a new paragraph (one verse line each).
Navigation boxes, edit links, page numbers, reference markers and styles are dropped."""
import re, sys, unicodedata
from html.parser import HTMLParser

SKIP_CLASS = re.compile(r'(wsbox|headertemplate|footertemplate|noprint|mw-editsection|pagenum|ws-noexport|mw-empty-elt|reference|catlinks|ws-header|ws-footer|toc|navbox|thumb|mw-heading-edit|licenseContainer|sisterproject|metadata|ambox|ns-0-header|licence)', re.I)
BLOCK = {'p', 'dd', 'li', 'blockquote'}
HEAD = {'h1', 'h2', 'h3', 'h4'}
VOID = {'br', 'img', 'hr', 'meta', 'link', 'input', 'wbr'}

class P(HTMLParser):
    def __init__(self, verse):
        super().__init__(convert_charrefs=True)
        self.verse = verse; self.out = []; self.cur = []; self.stack = []; self.skip = 0; self.head = False
    def flush(self, head=False):
        s = re.sub(r'[ \t ]+', ' ', ''.join(self.cur)).strip()
        self.cur = []
        if s: self.out.append(('## ' if head else '') + s)
    def handle_starttag(self, tag, attrs):
        a = dict(attrs); cls = (a.get('class') or '') + ' ' + (a.get('id') or '')
        if tag in VOID:
            if tag == 'img' and not self.skip and len(a.get('alt') or '') <= 2 and (a.get('alt') or '').isalpha():
                self.cur.append(a['alt'])  # a drop cap
            if tag == 'br' and not self.skip:
                if self.verse: self.flush(self.head)
                else: self.cur.append(' ')
            return
        skip = tag in ('style', 'script', 'table', 'noscript') or bool(SKIP_CLASS.search(cls)) or (a.get('typeof') or '').startswith('mw:Transclusion') and False
        if tag == 'sup' and 'reference' not in cls: skip = False if False else skip
        self.stack.append((tag, skip))
        if skip: self.skip += 1; return
        if self.skip: return
        if tag in BLOCK or tag in HEAD or tag == 'div' and 'poem' in cls: self.flush(self.head)
        if tag in HEAD: self.head = True
    def handle_endtag(self, tag):
        if tag in VOID: return
        # pop to matching
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                popped = self.stack[i:]; del self.stack[i:]
                sk = sum(1 for t in popped if t[1]); self.skip -= sk
                break
        else: return
        if self.skip: return
        if tag in BLOCK or tag in HEAD or tag == 'div':
            self.flush(self.head and tag in HEAD)
            if tag in HEAD: self.head = False
    def handle_data(self, d):
        if self.skip: return
        if self.verse: d = d.replace('\n', ' ')
        self.cur.append(d.replace('\n', ' '))

def convert(html, verse=False):
    p = P(verse); p.feed(html); p.flush()
    return unicodedata.normalize('NFC', '\n\n'.join(p.out))

if __name__ == '__main__':
    verse = '--verse' in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    txt = convert(open(args[0], encoding='utf-8').read(), verse)
    open(args[1], 'w', encoding='utf-8').write(txt + '\n')
    print(len(txt))
