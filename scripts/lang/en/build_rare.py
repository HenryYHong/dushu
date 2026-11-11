#!/usr/bin/env python3
"""Build the English dictionary's rare words: public/data/en/rare/<xx>.tsv.gz.

    python3 -I scripts/lang/en/build_rare.py [--ecdict FILE]

build_en.py keeps the ECDICT words a reader is likely to meet (ranked, on an exam list, or met in the starter books): about
68,000. Older books use rarer ones (caviller, cavilling's noun), and the word card found nothing for them. This writes every
other single ECDICT word that has a Chinese translation, about 340,000, into small files by the word's first two letters
(cavillers -> rare/ca.tsv.gz). The card fetches one only when the main dictionary has no entry (src/lang/spaced/rareWords.ts),
and the service worker keeps it once fetched; nothing here is downloaded ahead.

Each line: key (lower case), TAB, the translation as ECDICT has it, its lines joined by " | " ("n. 吹毛求疵的人"). Run it after
build_en.py (it reads that build's entries.tsv.gz to leave out what the main dictionary already has). Standard library only.
"""
import collections, csv, gzip, os, re, shutil, sys

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(REPO, 'public', 'data', 'en', 'rare')
MAIN = os.path.join(REPO, 'public', 'data', 'en', 'entries.tsv.gz')
WORD = re.compile(r"[a-z][a-z'\-]*")
# A translation is cut here: the card shows a line or two, and the files stay small.
MAX_GLOSS = 120


def shard(key: str) -> str:
    """The file a key is in: its first two letters, '_' for anything else (a-, x'). Mirrored in rareWords.ts."""
    return ''.join(c if 'a' <= c <= 'z' else '_' for c in (key + '_')[:2])


def gloss(translation: str) -> str:
    lines = [re.sub(r'\s+', ' ', l).strip() for l in translation.replace('\\n', '\n').split('\n')]
    out = ' | '.join(l for l in lines if l)
    return out if len(out) <= MAX_GLOSS else out[:MAX_GLOSS - 1].rstrip(' |,;，；') + '…'


def main() -> None:
    args = sys.argv[1:]
    src = args[args.index('--ecdict') + 1] if '--ecdict' in args else os.path.join(REPO, '.cache', 'raw', 'ecdict', 'ecdict.csv')
    have = set()
    with gzip.open(MAIN, 'rt', encoding='utf-8') as f:
        for line in f:
            if not line.startswith('#'):
                have.add(line.split('\t', 1)[0].lower())
    rows: dict[str, str] = {}
    with open(src, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            w = r['word']
            key = w.lower()
            if ' ' in w or len(w) > 30 or not WORD.fullmatch(key) or key in have:
                continue
            g = gloss(r['translation'])
            if not g:
                continue
            # The lower-case row wins over a capitalized one (polish over Polish).
            if key not in rows or w == key:
                rows[key] = g
    shards: dict[str, list[str]] = collections.defaultdict(list)
    for key in sorted(rows):
        shards[shard(key)].append(f'{key}\t{rows[key]}\n')
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    total = 0
    for name, lines in sorted(shards.items()):
        path = os.path.join(OUT, f'{name}.tsv.gz')
        # mtime 0: the same words make the same bytes, so a rebuild changes no file it need not.
        with open(path, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', compresslevel=9, mtime=0) as gz:
            gz.write(''.join(lines).encode('utf-8'))
        total += os.path.getsize(path)
    print(f'{len(rows)} rare words in {len(shards)} files, {total / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
