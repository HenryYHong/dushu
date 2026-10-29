#!/usr/bin/env python3 -I
"""Strip the Project Gutenberg header, footer and licence from a downloaded ebook text.
  python3 -I gutenberg.py in.txt out.txt
Prints the title line and the length. Every mention of Project Gutenberg is removed from the body."""
import re, sys, unicodedata
t = open(sys.argv[1], encoding='utf-8-sig').read().replace('\r\n', '\n').replace('\r', '\n')
a = re.search(r'\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*', t)
b = re.search(r'\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK', t)
body = t[a.end():b.start() if b else len(t)] if a else t
body = unicodedata.normalize('NFC', body).strip('\n')
open(sys.argv[2], 'w', encoding='utf-8').write(body + '\n')
print(len(body), 'Project Gutenberg' in body, t[:t.find('\n', t.find('Title:'))].split('Title:')[-1][:80] if 'Title:' in t else '')
