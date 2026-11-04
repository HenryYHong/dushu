"""Every place two Chinese dumps differ: the word groupings or the readings, region by region, with counts and contexts.

    python3 -I scripts/eval/zh-diff.py BEFORE AFTER OUT [book ...] [--sample N] [--seed S] [--genres FILE]

BEFORE and AFTER are dump folders written by scripts/eval/zh-dump.mjs (one folder per book with full.txt). OUT gets:

- summary.tsv: one row per distinct change (kind, before, after, total, per-book counts, contexts), most frequent first;
- <book>.tsv: the same for one book;
- sample.tsv, with --sample N: N changed places drawn at random (seeded, --seed, default 1), for judging a change by hand
  (better / same / worse).

kind is "seg" (the tokens differ; readings shown), "read" (the same token got another reading) or "text" (the text itself
changed, from an importer or a conversion change; aligned with difflib). A region runs between two token boundaries both
dumps share, so one changed cut is one region however far its effect reaches. --genres reads "id<TAB>genre" lines
(tests/corpus/zh/texts.tsv) and adds counts per genre to the printout. Prints counts only, never book text.
"""
import difflib
import os
import random
import re
import sys
from collections import defaultdict

TOK = re.compile(r'^(.*?)\{([^{}]*)\}$', re.S)


def chapters(path):
    """{chapter: [(text, reading or None), ...]}: the blocks of a chapter joined (a block break is not a token)."""
    out = defaultdict(list)
    with open(path, encoding='utf8') as f:
        for line in f:
            line = line.rstrip('\n')
            if '\t' not in line:
                continue
            key, body = line.split('\t', 1)
            ch = key.split('.')[0]
            for part in body.split('|'):
                if part == '':
                    continue
                m = TOK.match(part)
                out[ch].append((m.group(1), m.group(2)) if m else (part, None))
    return out


def spans(toks):
    pos, res = 0, []
    for t, py in toks:
        res.append((pos, pos + len(t), t, py))
        pos += len(t)
    return res


def show(sp):
    return '|'.join(f'{t}{{{py}}}' if py else t for _, _, t, py in sp)


def ctx(text, a, b, mark):
    return f'{text[max(0, a - 8):a]}【{mark}】{text[b:b + 8]}'


def diff_book(bdir, adir, book, agg):
    bf, af = os.path.join(bdir, book, 'full.txt'), os.path.join(adir, book, 'full.txt')
    if not (os.path.exists(bf) and os.path.exists(af)):
        return
    B, A = chapters(bf), chapters(af)
    for ch in sorted(set(B) | set(A), key=lambda c: int(c) if c.isdigit() else 0):
        bs, as_ = spans(B.get(ch, [])), spans(A.get(ch, []))
        btext, atext = ''.join(s[2] for s in bs), ''.join(s[2] for s in as_)
        if btext == atext or len(btext) == len(atext):
            blocks = [(0, 0, len(btext))]
            if btext != atext:
                for i, (x, y) in enumerate(zip(btext, atext)):
                    if x != y:
                        agg[('text', x, y)][book].append(ctx(atext, i, i + 1, y))
        else:
            sm = difflib.SequenceMatcher(None, btext, atext, autojunk=False)
            blocks = []
            for op, i1, i2, j1, j2 in sm.get_opcodes():
                if op == 'equal':
                    blocks.append((i1, j1, i2 - i1))
                else:
                    agg[('text', btext[i1:i2][:20], atext[j1:j2][:20])][book].append(ctx(atext, j1, j2, atext[j1:j2][:20]))
        for bi, aj, n in blocks:
            # the tokens of each side that lie wholly inside this aligned stretch, in its own coordinates
            bt = [(s - bi, e - bi, t, py) for s, e, t, py in bs if s >= bi and e <= bi + n]
            at = [(s - aj, e - aj, t, py) for s, e, t, py in as_ if s >= aj and e <= aj + n]
            bb = {s for s, *_ in bt} | {e for _, e, *_ in bt}
            ab = {s for s, *_ in at} | {e for _, e, *_ in at}
            common = sorted(bb & ab)
            bi_, ai_ = 0, 0
            for k in range(len(common) - 1):
                lo, hi = common[k], common[k + 1]
                bseg, aseg = [], []
                while bi_ < len(bt) and bt[bi_][0] < hi:
                    if bt[bi_][0] >= lo:
                        bseg.append(bt[bi_])
                    bi_ += 1
                while ai_ < len(at) and at[ai_][0] < hi:
                    if at[ai_][0] >= lo:
                        aseg.append(at[ai_])
                    ai_ += 1
                if not bseg or not aseg:
                    continue
                if len(bseg) == 1 and len(aseg) == 1:
                    (_, _, t1, p1), (_, _, t2, p2) = bseg[0], aseg[0]
                    if p1 != p2 and t1 == t2 and p1 and p2:
                        agg[('read', f'{t1}{{{p1}}}', f'{t2}{{{p2}}}')][book].append(ctx(atext, aj + lo, aj + hi, t2))
                    continue
                agg[('seg', show(bseg), show(aseg))][book].append(ctx(atext, aj + lo, aj + hi, show(aseg)))


def main(argv):
    opts = {'--sample': 0, '--seed': 1, '--genres': None}
    pos = []
    i = 0
    while i < len(argv):
        if argv[i] in opts:
            opts[argv[i]] = argv[i + 1]
            i += 2
        else:
            pos.append(argv[i])
            i += 1
    if len(pos) < 3:
        print(__doc__, file=sys.stderr)
        return 2
    bdir, adir, out = pos[:3]
    books = pos[3:] or sorted(d for d in os.listdir(bdir) if os.path.isdir(os.path.join(bdir, d)))
    os.makedirs(out, exist_ok=True)
    agg = defaultdict(lambda: defaultdict(list))
    for b in books:
        diff_book(bdir, adir, b, agg)
    rows = []
    for (kind, before, after), per in agg.items():
        total = sum(len(v) for v in per.values())
        ctxs = [c for v in per.values() for c in v[:2]][:4]
        rows.append((total, kind, before, after, per, ctxs))
    rows.sort(key=lambda r: (-r[0], r[1], r[2]))
    with open(os.path.join(out, 'summary.tsv'), 'w', encoding='utf8') as f:
        f.write('# kind\tbefore\tafter\ttotal\tper book\tcontexts\n')
        for total, kind, before, after, per, ctxs in rows:
            f.write(f'{kind}\t{before}\t{after}\t{total}\t{", ".join(f"{b}:{len(v)}" for b, v in sorted(per.items(), key=lambda x: -len(x[1])))}\t{" ／ ".join(ctxs)}\n')
    for b in books:
        mine = [(len(per[b]), kind, before, after, per[b]) for (kind, before, after), per in agg.items() if b in per]
        mine.sort(key=lambda r: -r[0])
        with open(os.path.join(out, f'{b}.tsv'), 'w', encoding='utf8') as f:
            f.write('# kind\tbefore\tafter\tcount\tcontexts\n')
            for n, kind, before, after, cs in mine:
                f.write(f'{kind}\t{before}\t{after}\t{n}\t{" ／ ".join(cs[:3])}\n')
    n = int(opts['--sample'])
    if n:
        places = [(b, kind, before, after, c) for (kind, before, after), per in agg.items() for b, cs in per.items() for c in cs]
        places.sort()
        rnd = random.Random(int(opts['--seed']))
        pick = rnd.sample(places, min(n, len(places)))
        with open(os.path.join(out, 'sample.tsv'), 'w', encoding='utf8') as f:
            f.write('# book\tkind\tbefore\tafter\tcontext\tjudgement (better / same / worse)\n')
            for p in pick:
                f.write('\t'.join(p) + '\t\n')
    kinds = defaultdict(int)
    for total, kind, *_ in rows:
        kinds[kind] += total
    print(f'{len(rows)} distinct changes, {sum(r[0] for r in rows)} places: ' + ', '.join(f'{k} {v}' for k, v in kinds.items()))
    if opts['--genres']:
        genre = {}
        for line in open(opts['--genres'], encoding='utf8'):
            if line.startswith('#') or '\t' not in line:
                continue
            c = line.rstrip('\n').split('\t')
            genre[c[0]] = c[1]
        per_genre = defaultdict(lambda: defaultdict(int))
        for (kind, _b, _a), per in agg.items():
            for b, cs in per.items():
                per_genre[genre.get(b, '?')][kind] += len(cs)
        for g in sorted(per_genre):
            print(f'  {g}: ' + ', '.join(f'{k} {v}' for k, v in sorted(per_genre[g].items())))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
