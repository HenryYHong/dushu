#!/usr/bin/env python3
"""Build the search index of Aozora Bunko (青空文庫) for "Find a book": public/data/ja/aozora.tsv.gz.

    python3 -I scripts/lang/ja/build_aozora_index.py LIST.csv [RANKING.html]

Standard library only. LIST.csv is Aozora Bunko's catalog of every work and person, list_person_all_extended_utf8.csv inside
https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip; RANKING.html is an access ranking page,
https://www.aozora.gr.jp/access_ranking/2022_xhtml.html (the 500 most read works). Keep both in .cache/raw/aozora/.

One line per work that is out of copyright and has an XHTML file, most read first, then works in modern spelling, then by
reading: work id, title (with its subtitle), title in kana, authors, authors in kana, 1 when it is in modern spelling
(新字新仮名) else 0, the XHTML file as "<card>/<file>" (https://www.aozora.gr.jp/cards/<card>/files/<file>), its rank or empty.
The app searches it on the page and fetches the file through the sync server (src/ui/library/findBooks.ts).
"""
import csv, datetime, gzip, os, re, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(REPO, 'public', 'data', 'ja', 'aozora.tsv.gz')


def main(argv):
    if not argv:
        sys.exit(__doc__)
    ranks = {}
    if len(argv) > 1:
        html = open(argv[1], 'rb').read().decode('utf-8', 'replace')
        for i, card in enumerate(re.findall(r'cards/\d+/card(\d+)\.html', html)):
            ranks.setdefault(card.lstrip('0'), i + 1)
    works = {}
    with open(argv[0], encoding='utf-8-sig', newline='') as f:
        rows = csv.reader(f)
        head = next(rows)
        col = {name: i for i, name in enumerate(head)}
        for r in rows:
            if r[col['作品著作権フラグ']] != 'なし':
                continue
            url = r[col['XHTML/HTMLファイルURL']]
            m = re.match(r'^https?://www\.aozora\.gr\.jp/cards/(\d{6})/files/(\d+_\d+\.html)$', url)
            if not m:
                continue
            wid = r[col['作品ID']].lstrip('0')
            w = works.setdefault(wid, {
                'title': (r[col['作品名']] + (f"　{r[col['副題']]}" if r[col['副題']] else '')).strip(),
                'reading': r[col['作品名読み']].strip(),
                'authors': [], 'readings': [],
                'modern': '1' if r[col['文字遣い種別']] == '新字新仮名' else '0',
                'path': f'{m.group(1)}/{m.group(2)}',
            })
            if r[col['役割フラグ']] == '著者':
                name = (r[col['姓']] + r[col['名']]).strip()
                kana = (r[col['姓読み']] + r[col['名読み']]).strip()
                if name and name not in w['authors']:
                    w['authors'].append(name)
                    w['readings'].append(kana)
    clean = lambda s: re.sub(r'[\t\r\n]+', ' ', s)
    order = sorted(works.items(), key=lambda kv: (ranks.get(kv[0], 10 ** 6), kv[1]['modern'] != '1', kv[1]['reading']))
    lines = ['\t'.join([wid, clean(w['title']), clean(w['reading']), '、'.join(w['authors']), '、'.join(w['readings']), w['modern'], w['path'], str(ranks.get(wid, ''))])
             for wid, w in order]
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    head = (f'# Aozora Bunko (青空文庫) works out of copyright with an XHTML file, from its catalog, built {datetime.date.today().isoformat()}.\n'
            '# id\ttitle\treading\tauthors\tauthor readings\tmodern spelling\tcard/file\trank\n')
    with gzip.open(OUT, 'wt', encoding='utf-8', compresslevel=9) as f:
        f.write(head + '\n'.join(lines) + '\n')
    print(len(lines), 'works,', sum(1 for _, w in works.items() if w['modern'] == '1'), 'in modern spelling,', len(ranks), 'ranked;', os.path.getsize(OUT), 'bytes')


if __name__ == '__main__':
    main(sys.argv[1:])
