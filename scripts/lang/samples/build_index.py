#!/usr/bin/env python3 -I
"""Writes public/samples/<lang>/index.json from meta.py, the .md files and covers.py:  python3 -I build_index.py [lang ...]"""
import json, os, re, sys, unicodedata
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib, meta, covers

for lang in sys.argv[1:] or list(meta.BOOKS):
    out = []
    for b in meta.BOOKS[lang]:
        path = os.path.join(lib.REPO, 'public', 'samples', lang, b['id'] + '.md')
        text = open(path, encoding='utf-8').read()
        assert unicodedata.is_normalized('NFC', text) and '�' not in text
        row = dict(id=b['id'], title=b['title'], author=b['author'], script='unknown', file=b['id'] + '.md', level=b['level'], blurb=b['blurb'], source=b['src'], note=b['note'])
        n = len(re.findall(r'^## ', text, re.M))
        if n: row['chapters'] = n
        row['chars'] = len(text)
        c = covers.COVERS.get((lang, b['id']))
        if c:
            row['cover'] = f"covers/{b['id']}.jpg"; row['coverCredit'] = c
            assert re.match(r'^covers/[a-z0-9-]+\.jpg$', row['cover'])
        assert re.match(r'^[a-z0-9-]+$', b['id'])
        assert '—' not in b['blurb'] and len(b['blurb']) < 260, b['id']
        out.append(row)
    open(os.path.join(lib.REPO, 'public', 'samples', lang, 'index.json'), 'w', encoding='utf-8').write(json.dumps(out, ensure_ascii=False, indent=2) + '\n')
    print(lang, len(out))
