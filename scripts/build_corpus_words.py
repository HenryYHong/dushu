#!/usr/bin/env python3
"""Build public/data/corpus-words.tsv.gz: segmentation counts, read off free text, for dictionary words the jieba corpus never
counted, and words no dictionary has (ARCHITECTURE.md §3, §4.1).

Usage (run with python3 -I from the repository root; Node 22 on the PATH):
  build_corpus_words.py --text DIR --work DIR [--jobs 8] [--steps count,table,near,probe,build,diff] [--titles FILE]

--text is the offline corpus (not in the repository): wikipedia/simp/zhwiki-0N.txt.gz (articles: a title line, one paragraph per
line, a blank line between articles; Chinese Wikipedia, CC BY-SA 4.0), wikipedia/owner-book-articles.tsv (articles left out),
wikisource/simp/<id>.txt.gz (public-domain books: a title line, then paragraphs) and wikisource/works.tsv (id and genre). --work
holds what the steps write. The steps:

  count  cut every paragraph with the app's own segmenter (scripts/corpus-words.ts, dictionary only) in --jobs workers: Han
         tokens, and for dictionary words the jieba corpus counted fewer than 20 times how often they stand with a cut at both
         edges (about 30 minutes for 380 million characters with 8 workers)
  table  per word: its parts (the best cut of it into other dictionary words by jieba counts), a weighted rate (Wikipedia 0.4,
         Ming and Qing novels 0.3, prose of 1895-1930 0.15, classical texts 0.15, each a share of its own tokens), PMI over the
         parts, and the shortlist (rules below)
  near   each shortlisted word's count in each book, and the characters around it
  probe  each shortlisted word's reading, and the reading its parts have side by side
  build  the file: the shortlist less scripts/data/corpus-words-review.tsv's drops and less the words whose reading differs from
         their parts' (unless the review keeps them), each with just enough count to win where it stands free, plus the longer
         dictionary words that hold one of them and that the corpus never counted either, less the archaic words the books use
         mostly inside longer words; then the new words of scripts/data/corpus-words-new.tsv; and every word the review says
         yields to a dictionary word kept under the count at which that word wins where they overlap
  diff   the paragraphs that hold a word of the file, cut with and without it: per word, the places it joins cleanly and the
         places where the change crosses other words (read these before adding a drop to the review file)

The shortlist: a word of 2 to 4 characters that the jieba corpus never counted, simplified, mostly cut apart today (fewer than half
of its free-standing places joined), weighted count 20 or more on jieba's scale, PMI over its parts 4 or more, at least one part a
single character and none of the 150 commonest single-character tokens (unless PMI is 6 or more), not ending in 儿, not only slang
or a sexual sense, and a proper noun only when the books use it 20 times, it names no town, village, district or city and its
parts are not all among the 500 commonest single-character tokens. A word's count is min(its weighted count, max(6, 8 x the count
at which it beats its parts)); one book's share of a word is capped at twice the next book's, so a character's name in one novel
does not make the count.
"""
import argparse, csv, gzip, math, os, pickle, re, subprocess, sys
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'public', 'data')
REVIEW = os.path.join(ROOT, 'scripts', 'data', 'corpus-words-review.tsv')
NEW = os.path.join(ROOT, 'scripts', 'data', 'corpus-words-new.tsv')
OUT = os.path.join(DATA, 'corpus-words.tsv.gz')
TOOL = os.path.join(ROOT, '.cache', 'corpus-words.mjs')

GROUPS = ['wiki', 'novel', 'modern', 'classical']
SUPER = {'wiki': 'wiki', 'ming-novel': 'novel', 'qing-novel': 'novel', '1920s-fiction': 'modern', '1920s-mixed': 'modern',
         '1920s-prose': 'modern', 'late-qing-prose': 'modern', 'classical': 'classical'}
PI = {'wiki': 0.4, 'novel': 0.3, 'modern': 0.15, 'classical': 0.15}
DELTA = 4.0        # PMI over the parts
TOP_DELTA = 6.0    # PMI when a part is one of the commonest single-character tokens
MIN_EST = 20       # weighted count, jieba's scale
MARGIN = 8.0       # a word's count over the count at which it beats its parts
FLOOR_MIN = 6      # the least count a word gets (the floor is 5)
TOP_PROPER = 500   # a proper noun of two of the commonest single-character tokens (比干: 比 + 干) is those two words in a book
PIECE = 2 / 3      # an archaic word the books use this often inside longer words is counted only through them
SLANG = re.compile(r'^\([^)]*\b(slang|Internet|neologism|video games)\b', re.I)
ARCHAIC = re.compile(r'^(\([^)]*\) )*\(archaic\)', re.I)
UNSEEN_FLOOR = 5   # src/core/dict.ts: the floor of a dictionary word the corpus never saw
SEXUAL = re.compile(r'\b(blowjob|sex|sexual|penis|vagina|breasts?|orgasm|masturbat\w*|prostitut\w*|porn\w*)\b', re.I)
ADMIN = re.compile(r'\((a |an )?((rural|urban) )?(town|township|village|subdistrict|county|district|city|county-level city|'
                   r'prefecture-level city)\b|\(city in |^(an? )?((rural|urban) )?(village|township|town)\b|\(a province of [A-Z]|'
                   r'^(short for|abbr\. for) ', re.I)
HEADER = ('# format 1\n'
          '# Segmentation counts read off free text, on the scale of jieba\'s counts, for dictionary words the jieba corpus never '
          'counted, and words no dictionary has. Made by scripts/build_corpus_words.py from Chinese Wikipedia (by its '
          'contributors, CC BY-SA 4.0, https://zh.wikipedia.org; counted, not copied) and public-domain books from Wikisource; '
          'new words\' meanings from Wiktionary (CC BY-SA 4.0) or written for Dushu. This file: CC BY-SA 4.0.\n'
          '# word<TAB>count, or trad<TAB>simp<TAB>pinyin<TAB>defs<TAB>count for a word no dictionary has\n')


def jieba():
    out, total = {}, 1
    with gzip.open(os.path.join(DATA, 'words.tsv.gz'), 'rt', encoding='utf8') as f:
        for line in f:
            if line.startswith('#'):
                m = re.search(r'total=(\d+)', line)
                if m: total = int(m.group(1))
                continue
            w, c = line.rstrip('\n').split('\t')
            out[w] = int(c)
    return out, total


def specs(text):
    genre = {r['id']: r['genre'] for r in csv.DictReader(open(os.path.join(text, 'wikisource', 'works.tsv'), encoding='utf8'), delimiter='\t')}
    out = [os.path.join(text, 'wikipedia', 'simp', f) + ':wiki' for f in sorted(os.listdir(os.path.join(text, 'wikipedia', 'simp')))]
    books = os.path.join(text, 'wikisource', 'simp')
    out += [os.path.join(books, f) + ':' + genre[f[:-7]] for f in sorted(os.listdir(books)) if f[:-7] in genre]
    return out


def book_specs(text):
    books = os.path.join(text, 'wikisource', 'simp')
    return [os.path.join(books, f) + ':' + f[:-7] for f in sorted(os.listdir(books)) if f.endswith('.txt.gz')]


def node(args, jobs, outs):
    procs = [subprocess.Popen(['node', '--max-old-space-size=4000', TOOL] + a, stderr=subprocess.DEVNULL) for a in args]
    for p in procs:
        if p.wait() != 0: sys.exit('corpus-words.mjs failed')


def bundle():
    subprocess.run([os.path.join(ROOT, 'node_modules', '.bin', 'esbuild'), os.path.join(ROOT, 'scripts', 'corpus-words.ts'), '--bundle',
                    '--platform=node', '--format=esm', '--outfile=' + TOOL, '--log-level=warning'], check=True)


def step_count(a):
    bundle()
    skip = os.path.join(a.text, 'wikipedia', 'owner-book-articles.tsv')
    node([['count', DATA, os.path.join(a.work, 'w%d' % k), str(k), str(a.jobs), a.titles or '-', skip if os.path.exists(skip) else '-']
          + specs(a.text) for k in range(a.jobs)], a.jobs, None)
    tok, cand, gram, title = defaultdict(Counter), defaultdict(dict), defaultdict(Counter), defaultdict(dict)
    for k in range(a.jobs):
        p = os.path.join(a.work, 'w%d' % k)
        for line in open(p + '.tok.tsv', encoding='utf8'):
            t = line.rstrip('\n').split('\t')
            if len(t) == 3: tok[SUPER[t[0]]][t[1]] += int(t[2])
        for line in open(p + '.gram.tsv', encoding='utf8'):
            t = line.rstrip('\n').split('\t')
            if len(t) == 3: gram[SUPER[t[0]]][t[1]] += int(t[2])
        for suffix, into in (('.cand.tsv', cand), ('.title.tsv', title)):
            for line in open(p + suffix, encoding='utf8'):
                t = line.rstrip('\n').split('\t')
                if len(t) < 3: continue
                r = into[SUPER[t[0]]].setdefault(t[1], [0] * (len(t) - 2))
                for i, x in enumerate(t[2:]): r[i] += int(x)
    pickle.dump({'tok': dict(tok), 'cand': dict(cand), 'gram': dict(gram), 'title': dict(title)}, open(os.path.join(a.work, 'counts.pkl'), 'wb'))


def load_counts(a):
    return pickle.load(open(os.path.join(a.work, 'counts.pkl'), 'rb'))


def best_split(w, J, JT):
    """The best cut of w into dictionary words other than w (single characters always allowed), by jieba counts."""
    n = len(w)
    best = [None] * (n + 1)
    best[n] = (0.0, [])
    for i in range(n - 1, -1, -1):
        opts = []
        for j in range(i + 1, n + 1):
            s = w[i:j]
            if j - i == n or not (j - i == 1 or s in J): continue
            opts.append((math.log(J.get(s, 0) + 1) - math.log(JT) + best[j][0], [s] + best[j][1]))
        best[i] = max(opts)
    return best[0][1]


def step_table(a):
    C = load_counts(a)
    J, JT = jieba()
    N = {g: sum(C['tok'][g].values()) for g in GROUPS}
    # jieba counts against the weighted rate, for the words jieba counts often: the scale of the estimates.
    ratios = sorted(c / (JT * r) for w, c in J.items() if c >= 2000 and len(w) >= 2
                    for r in [sum(PI[g] * C['tok'][g].get(w, 0) / N[g] for g in GROUPS)] if r > 0)
    scale = ratios[len(ratios) // 2]
    rate1 = Counter()
    for g in GROUPS:
        for w, c in C['tok'][g].items():
            if len(w) == 1: rate1[w] += PI[g] * c / N[g]
    top = {w for w, _ in rate1.most_common(150)}
    common = {w for w, _ in rate1.most_common(TOP_PROPER)}
    rows = []
    words = set()
    for g in GROUPS: words |= set(C['cand'].get(g, {}))
    for w in sorted(words):
        parts = best_split(w, J, JT)
        cl = {g: C['cand'].get(g, {}).get(w, [0, 0, 0]) for g in GROUPS}
        rate = sum(PI[g] * cl[g][1] / N[g] for g in GROUPS)
        pp = [sum(PI[g] * (C['tok'][g].get(p, 0) + cl[g][2]) / N[g] for g in GROUPS) for p in parts]
        pmi = math.log(rate / math.prod(pp)) if rate and all(pp) else float('-inf')
        rows.append({'word': w, 'jieba': J.get(w, 0), 'parts': '|'.join(parts), 'est': JT * rate * scale, 'pmi': pmi,
                     'clean': {g: cl[g][1] for g in GROUPS}, 'join': sum(cl[g][2] for g in GROUPS), 'top': any(p in top for p in parts)})
    pickle.dump({'rows': rows, 'scale': scale, 'N': N}, open(os.path.join(a.work, 'table.pkl'), 'wb'))
    probe_defs(a, [r['word'] for r in rows], 'all-probe.tsv')
    defs = {t[0]: t[5] if len(t) > 5 else '' for t in (l.rstrip('\n').split('\t') for l in open(os.path.join(a.work, 'all-probe.tsv'), encoding='utf8'))}
    short = []
    for r in rows:
        w = r['word']
        clean = sum(r['clean'].values())
        if r['jieba'] or not (2 <= len(w) <= 4) or clean == 0 or r['join'] / clean >= 0.5 or r['est'] < MIN_EST: continue
        if not any(len(p) == 1 for p in r['parts'].split('|')) or r['pmi'] < DELTA or (r['top'] and r['pmi'] < TOP_DELTA): continue
        if w.endswith('儿'): continue
        d = defs.get(w, '')
        senses = [x.split(': ', 1)[-1] for x in d.split(' || ')]
        if all(SLANG.search(s) for s in senses) or SEXUAL.search(d): continue
        proper = all(re.match(r'^[A-Z]', x) for x in d.split(' || ') if x)
        books = r['clean']['novel'] + r['clean']['modern'] + r['clean']['classical']
        if proper and (ADMIN.search(d) or books < 20 or all(p in common for p in r['parts'].split('|'))): continue
        short.append(r)
    with open(os.path.join(a.work, 'short.tsv'), 'w', encoding='utf8') as f:
        for r in sorted(short, key=lambda r: -r['est']):
            f.write('\t'.join(str(x) for x in [r['word'], r['parts'], round(r['est'], 1), round(r['pmi'], 2)] + [r['clean'][g] for g in GROUPS] + [defs.get(r['word'], '')[:150]]) + '\n')
    print('shortlist', len(short), 'scale', round(scale, 3), file=sys.stderr)


def probe_defs(a, words, name):
    J, JT = jieba()
    src = os.path.join(a.work, name + '.in')
    with open(src, 'w', encoding='utf8') as f:
        for w in words: f.write(w + '\t' + '|'.join(best_split(w, J, JT)) + '\n')
    bundle()
    node([['probe', DATA, src, os.path.join(a.work, name)]], 1, None)


def step_probe(a):
    probe_defs(a, [l.split('\t')[0] for l in open(os.path.join(a.work, 'short.tsv'), encoding='utf8')] + new_words(), 'probe.tsv')


def step_near(a):
    bundle()
    words = os.path.join(a.work, 'near-words.txt')
    open(words, 'w', encoding='utf8').write('\n'.join([l.split('\t')[0] for l in open(os.path.join(a.work, 'short.tsv'), encoding='utf8')] + new_words()) + '\n')
    node([['near', words, os.path.join(a.work, 'near-%d.tsv' % k), str(k), str(a.jobs)] + book_specs(a.text) for k in range(a.jobs)], a.jobs, None)


def review_rows():
    for line in open(REVIEW, encoding='utf8'):
        if line.startswith('#') or not line.strip(): continue
        yield line.rstrip('\n').split('\t')


def review():
    return {t[0]: t[1] for t in review_rows()}


def yields():
    """The review's `yield` rows: a word and the dictionary words it gives way to where they overlap (按剑 and 剑柄 in 按剑柄)."""
    return {t[0]: t[2].split(',') for t in review_rows() if t[1] == 'yield' and len(t) > 2}


def longer_words():
    """Dictionary and new words of three characters or more (simplified), for telling a word used inside them."""
    out = set()
    for name in ('cedict.tsv.gz', 'cedict-extra.tsv.gz'):
        with gzip.open(os.path.join(DATA, name), 'rt', encoding='utf8') as f:
            for line in f:
                t = line.split('\t')
                if not line.startswith('#') and len(t) > 3 and len(t[1]) >= 3: out.add(t[1])
    return out | {t[0] for t in new_rows() if len(t[0]) >= 3}


def near_sides(a):
    """Per word, its places in the books and the characters right before and after them (the near step's files)."""
    n, left, right = Counter(), defaultdict(Counter), defaultdict(Counter)
    for k in range(a.jobs):
        for line in open(os.path.join(a.work, 'near-%d.tsv' % k), encoding='utf8'):
            t = line.rstrip('\n').split('\t')
            if len(t) < 5: continue
            n[t[1]] += int(t[2])
            for side, into in ((t[3], left), (t[4], right)):
                for x in side.split(','):
                    if ':' in x:
                        ch, c = x.rsplit(':', 1)
                        if ch != '#': into[t[1]][ch] += int(c)
    return n, left, right


def new_rows():
    if not os.path.exists(NEW): return []
    return [t for t in (l.rstrip('\n').split('\t') for l in open(NEW, encoding='utf8') if l.strip() and not l.startswith('#')) if len(t) >= 4]


def new_words():
    return [t[0] for t in new_rows()]


def step_build(a):
    J, JT = jieba()
    rev = review()
    probe = {t[0]: t for t in (l.rstrip('\n').split('\t') for l in open(os.path.join(a.work, 'probe.tsv'), encoding='utf8'))}
    per_book = defaultdict(dict)
    for k in range(a.jobs):
        for line in open(os.path.join(a.work, 'near-%d.tsv' % k), encoding='utf8'):
            t = line.rstrip('\n').split('\t')
            if len(t) >= 3: per_book[t[1]][t[0]] = int(t[2])

    def capped(w, est, wiki, books):
        """One book's share capped at twice the next book's, so a name or a term of one novel does not make the count."""
        d = per_book.get(w, {})
        tot = sum(d.values())
        if tot < 20 or books <= 0: return est
        v = sorted(d.values(), reverse=True)
        cap = tot - v[0] + min(v[0], 2 * (v[1] if len(v) > 1 else 0))
        share = books / (books + wiki)
        return est * (1 - share) + est * share * cap / tot

    def need(parts):
        x = 1.0
        for p in parts: x *= max(1, J.get(p, 0))
        return x / JT ** (len(parts) - 1)

    rows, dropped, unread = [], 0, []
    for line in open(os.path.join(a.work, 'short.tsv'), encoding='utf8'):
        t = line.rstrip('\n').split('\t')
        w, parts, est = t[0], t[1].split('|'), float(t[2])
        if rev.get(w) == 'drop': dropped += 1; continue
        p = probe.get(w)
        if p:
            x, y = p[1].split(), p[2].split()
            same = len(x) == len(y) and all(u == v or (u.endswith('5') and u[:-1] == v[:-1]) for u, v in zip(x, y))
            if not same and rev.get(w) != 'keep': unread.append(w); continue
        est = capped(w, est, float(t[4]), float(t[5]) + float(t[6]) + float(t[7]))
        rows.append((w, max(1, round(min(est, max(FLOOR_MIN, MARGIN * need(parts)))))))
    # A longer dictionary word the corpus never counted that holds one of these (中常侍 around 常侍, 车骑将军 around 车骑) keeps
    # winning: its count is a margin over the word and the characters around it.
    table = pickle.load(open(os.path.join(a.work, 'table.pkl'), 'rb'))['rows']
    counted = dict(rows)
    supers = {}
    for r in table:
        W = r['word']
        if r['jieba'] or len(W) < 3 or W in counted or rev.get(W) == 'drop' or not sum(r['clean'].values()): continue
        for w, c in rows:
            i = W.find(w)
            if i < 0: continue
            rest = [ch for ch in W[:i] + W[i + len(w):]]
            n = c * need(rest) if rest else c
            n = n / JT if rest else n
            supers[W] = max(supers.get(W, 0), max(FLOOR_MIN, round(MARGIN * n)))
    # An archaic word the books use mostly inside longer words (常侍 in 中常侍, 散骑常侍, 十常侍) is counted only through them: alone
    # it is two words more often than that title (紧跟常侍的丫鬟).
    n_near, left, right = near_sides(a)
    longer = longer_words()
    ends = {L[k:] for L in longer for k in range(len(L) - 2)}
    starts = {L[:k] for L in longer for k in range(3, len(L) + 1)}
    pieces = set()
    for w, c in rows:
        p = probe.get(w, [])
        senses = [x.split(': ', 1)[-1] for x in (p[5] if len(p) > 5 else '').split(' || ') if x]
        if not senses or not all(ARCHAIC.search(s) for s in senses) or n_near[w] < 20: continue
        inside = sum(v for ch, v in left[w].items() if ch + w in ends) + sum(v for ch, v in right[w].items() if w + ch in starts)
        if inside >= PIECE * n_near[w]: pieces.add(w)
    rows = [r for r in rows if r[0] not in pieces] + sorted(supers.items())
    # New words: trad, simp, pinyin, defs and a count read the same way from their free-standing places.
    news = []
    C = load_counts(a)
    N = pickle.load(open(os.path.join(a.work, 'table.pkl'), 'rb'))['N']
    scale = pickle.load(open(os.path.join(a.work, 'table.pkl'), 'rb'))['scale']
    for t in new_rows():
        simp, trad, pinyin, defs = t[0], t[1] or t[0], t[2], t[3]
        cl = {g: max(C['gram'].get(g, {}).get(simp, 0), (C['title'].get(g, {}).get(simp) or [0, 0])[1]) for g in GROUPS}
        est = JT * scale * sum(PI[g] * cl[g] / N[g] for g in GROUPS)
        est = capped(simp, est, cl['wiki'], cl['novel'] + cl['modern'] + cl['classical'])
        parts = best_split(simp, J, JT)
        news.append((trad, simp, pinyin, defs, max(FLOOR_MIN, round(min(max(est, FLOOR_MIN), max(FLOOR_MIN, MARGIN * need(parts)))))))
    # The review's yields: where a word and a dictionary word overlap, the dictionary word wins (按|剑柄 "pressed the hilt", not
    # 按剑|柄). The count stays under what that takes, with a fifth to spare (the dictionary word's count: the file's, jieba's, or
    # else the floor), but never under twice the count at which the word beats its parts.
    counted = dict(rows)
    counted.update((r[1], r[4]) for r in news)
    seg = lambda x: counted.get(x) or J.get(x) or UNSEEN_FLOOR
    one = lambda x: J.get(x, 0) + 1
    gives_way = yields()

    def yielded(w, c):
        for d in gives_way.get(w, []):
            k = next((k for k in range(1, len(w)) if d.startswith(w[k:])), None)
            if k is not None:  # d starts inside w: w[:k] | d against w | the rest of d
                cap = 0.8 * one(w[:k]) * (seg(d) + 1) / one(d[len(w) - k:]) - 1
            else:  # d ends inside w: d | the rest of w against the start of d | w
                k = next(k for k in range(1, len(w)) if d.endswith(w[:k]))
                cap = 0.8 * (seg(d) + 1) * one(w[k:]) / one(d[:len(d) - k]) - 1
            c = max(min(c, int(cap)), math.ceil(2 * need(best_split(w, J, JT))), 1)
            print('yields %s to %s: %d' % (w, d, c), file=sys.stderr)
        return c
    rows = [(w, yielded(w, c)) for w, c in rows]
    news = [r[:4] + (yielded(r[1], r[4]),) for r in news]
    with gzip.open(OUT, 'wt', encoding='utf8', compresslevel=9) as f:
        f.write(HEADER)
        for w, c in sorted(rows): f.write('%s\t%d\n' % (w, c))
        for r in sorted(news, key=lambda r: r[1]): f.write('\t'.join(str(x) for x in r) + '\n')
    print('counts', len(rows), '(%d longer words)' % len(supers), 'new words', len(news), 'dropped by review', dropped,
          'pieces of longer words', ' '.join(sorted(pieces)), 'reading differs, not reviewed', len(unread), ' '.join(unread[:40]),
          file=sys.stderr)


def step_diff(a):
    bundle()
    node([['diff', DATA, OUT, os.path.join(a.work, 'diff-%d.tsv' % k), str(k), str(a.jobs)] + specs(a.text) for k in range(a.jobs)], a.jobs, None)
    words = set()
    for line in gzip.open(OUT, 'rt', encoding='utf8'):
        if line.startswith('#'): continue
        t = line.rstrip('\n').split('\t')
        words.add(t[1] if len(t) >= 5 else t[0])
    pure, cross = Counter(), defaultdict(Counter)
    for k in range(a.jobs):
        for line in open(os.path.join(a.work, 'diff-%d.tsv' % k), encoding='utf8'):
            t = line.rstrip('\n').split('\t')
            if len(t) < 4: continue
            b, af, c = t[1].split('|'), t[2].split('|'), int(t[3])
            key = next((x for x in af if x in words), None) or next((x for x in b if x in words), '?')
            if len(af) == 1 and ''.join(b) == af[0]: pure[key] += c
            else: cross[key][t[1] + ' => ' + t[2]] += c
    print('places joined cleanly', sum(pure.values()), 'places crossing other words', sum(sum(v.values()) for v in cross.values()))
    for w in sorted(set(pure) | set(cross), key=lambda w: -sum(cross[w].values()) / (pure[w] + sum(cross[w].values()))):
        x = sum(cross[w].values())
        if x >= 3 and x / (pure[w] + x) > 0.1:
            print('%s\tclean %d\tcrossing %d\t%s' % (w, pure[w], x, '; '.join('%d %s' % (c, k) for k, c in cross[w].most_common(4))))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--text', required=True)
    ap.add_argument('--work', required=True)
    ap.add_argument('--jobs', type=int, default=8)
    ap.add_argument('--titles', help='simplified Wikipedia titles, one per line, for the new-word statistics (optional)')
    ap.add_argument('--steps', default='count,table,near,probe,build')
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    for s in a.steps.split(','):
        {'count': step_count, 'table': step_table, 'near': step_near, 'probe': step_probe, 'build': step_build, 'diff': step_diff}[s](a)


if __name__ == '__main__':
    main()
