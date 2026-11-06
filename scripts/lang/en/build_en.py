#!/usr/bin/env python3
"""Build Globereader's English dictionary for Chinese speakers learning English: public/data/en/.

    python3 -I scripts/lang/en/build_en.py [--ecdict FILE] [--texts DIR]

Standard library only. The source is ECDICT (github.com/skywind3000/ECDICT, MIT): English headwords with Chinese
definitions, word forms (went is go's past tense), frequency ranks (COCA, BNC) and the Chinese exam word lists. Download
ecdict.csv at the pinned commit into <repo>/.cache/raw/ecdict/ (the sha256 is checked):

    curl -L -o .cache/raw/ecdict/ecdict.csv https://raw.githubusercontent.com/skywind3000/ECDICT/<COMMIT>/ecdict.csv

scripts/lang/en/curated.tsv (written for this app) replaces ECDICT's entries of the same word and part of speech for the
commonest words and the contractions. --texts DIR also takes in every ECDICT word met at least twice in the .txt/.md files
there (the starter books, public/samples/en, by default), however rare.

Writes the files src/lang/spaced/core.ts reads (scripts/lang/wikt/build.py documents the formats): entries.tsv.gz,
forms.tsv.gz, phrases.tsv.gz, meta.json, levels.tsv.gz (key, level: the first Chinese exam list a word is on, 1 中考,
2 高考, 3 CET-4, 4 CET-6, 5 IELTS/TOEFL or 考研, 6 GRE; registry.ts names them) and ipa.tsv.gz (word or form, IPA: what the
word card shows). Glosses are Chinese.
"""
import collections, csv, datetime, gzip, hashlib, json, os, re, sys, unicodedata

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(REPO, 'public', 'data', 'en')
ECDICT_COMMIT = '39cfb9672c0906b63569e0453c2e6abfb9ab182a'
ECDICT_SHA256 = 'd1ecbdf9ee2b920afb6f430ca6b6bb9f559588cf0dff86e04bd255f9390843cc'

POS = {
    'n': 'noun', 'pl': 'noun', 'a': 'adjective', 'adj': 'adjective', 'ad': 'adverb', 'adv': 'adverb', 'v': 'verb', 'vt': 'verb',
    'vi': 'verb', 'aux': 'verb', 'vbl': 'verb', 'prep': 'preposition', 'conj': 'conjunction', 'pron': 'pronoun', 'pers': 'pronoun',
    'int': 'interjection', 'interj': 'interjection', 'num': 'numeral', 'art': 'article', 'abbr': 'noun', 'quant': 'determiner',
}
FORM_DESC = {'p': 'past tense', 'd': 'past participle', 'i': 'present participle', '3': 'third-person singular', 's': 'plural',
             'r': 'comparative', 't': 'superlative'}
FORM_POS = {'p': 'verb', 'd': 'verb', 'i': 'verb', '3': 'verb', 's': 'noun', 'r': 'adjective', 't': 'adjective'}
# The first exam list a word is on -> level (registry.ts: 中考 高考 CET-4 CET-6 IELTS/TOEFL GRE). 考研 has few words of its own
# (306 not on an earlier list) and sits with IELTS and TOEFL.
LEVEL = {'zk': 1, 'gk': 2, 'cet4': 3, 'cet6': 4, 'ky': 5, 'ielts': 5, 'toefl': 5, 'gre': 6}
FORM_ONLY = re.compile(r'^(?:[a-z.]+\s*)?[A-Za-z\'-]+\s*的(?:过去式|过去分词|现在分词|现在时|复数|第三人称单数|比较级|最高级|过去式和过去分词)')
# The forms of be, have and do, which ECDICT lists as words of their own ("are: be的现在时复数", and a noun 公亩).
AUX_FORMS = {
    'be': {'am': 'first-person singular present', 'are': 'present', 'is': 'third-person singular', 'was': 'past tense',
           'were': 'past tense', 'been': 'past participle', 'being': 'present participle', "'re": 'present', "'m": 'first-person singular present'},
    'have': {'has': 'third-person singular', 'had': 'past tense and past participle', 'having': 'present participle', "'ve": 'present'},
    'do': {'does': 'third-person singular', 'did': 'past tense', 'done': 'past participle', 'doing': 'present participle'},
}
AUX_ONLY = {'am', 'are', 'is', 'was', 'were', 'been', 'has', 'had', 'does', 'did'}
# Past forms older and British books use that ECDICT's forms leave out (learnt, quitted, lighted: Jane Eyre, Frankenstein).
OLD_PAST = {
    'learn': ['learnt'], 'lean': ['leant'], 'spoil': ['spoilt'], 'dream': ['dreamt'], 'burn': ['burnt'], 'spell': ['spelt'],
    'smell': ['smelt'], 'kneel': ['knelt'], 'leap': ['leapt', 'leaped'], 'quit': ['quitted'], 'light': ['lighted'],
    'get': ['gotten'], 'wake': ['waked'], 'blend': ['blent'], 'spill': ['spilt'], 'dwell': ['dwelt'], 'bite': ['bitten'],
    'shine': ['shined'], 'strive': ['strived'], 'thrive': ['thrived'], 'weave': ['weaved'], 'bethink': ['bethought'],
}
# Phrases of these verbs are not phrasal verbs ("be in" is no 到达 in "must be in want of").
NOT_PHRASAL = {'be', 'have', 'do'}
PARTICLES = {'up', 'down', 'out', 'off', 'in', 'on', 'away', 'back', 'over', 'about', 'around', 'round', 'through', 'along',
             'after', 'for', 'into', 'at', 'with', 'by', 'forward', 'together', 'apart', 'across', 'aside', 'ahead', 'behind'}
# Fixed expressions taken from ECDICT whatever their rank (phrasal verbs are found by rule, below).
EXPRESSIONS = '''a few|a little|a lot|a lot of|according to|after all|ahead of|all right|along with|as if|as long as|as soon as|
as though|as well|as well as|at all|at first|at last|at least|at once|at times|because of|by the way|close to|due to|each other|
even if|even though|ever since|except for|far from|for ever|for example|for instance|for the first time|from time to time|
in addition|in case|in fact|in front of|in order to|in spite of|in the end|in time|instead of|kind of|little by little|
more or less|next to|no longer|no one|not only|now and then|of course|on time|once again|once more|one another|out of|
rather than|so as to|so that|sort of|such as|thanks to|up to|what if|whether or not|all at once|by no means|on the other hand|
in the morning|at night|as a matter of fact|in a hurry|on purpose|by chance|in vain|at any rate|on the whole|so far|
as far as|at the same time|all the same|in any case|in general|in particular|on foot|by heart|in turn|now that|once upon a time|
all of a sudden|as usual|at home|by and by|every now and then|in love|in want of|no doubt|to and fro|any more'''
EXPRESSIONS = [e.strip() for e in EXPRESSIONS.replace('\n', '').split('|') if e.strip()]


# ECDICT's phonetics mix the older British notation Chinese textbooks long used ('kʌlә, liv, bәu: a Cyrillic ә, ' and : for
# stress and length) with the current one (ˈkʌlə, lɪv, bəʊ), and often print the old ɔ as ɒ, and some rows were typed in a font that put ^ for ɡ, \ for ɜ and
# j for ʊ. All of it comes out in the current notation (Oxford's and today's Chinese textbooks': ɪ ʊ ɒ ɜː eə əʊ).
IPA_OK = re.compile(r"[a-zæðŋɑɒɔəɚɛɜɝɡɪʃʊʌʒθˈˌː()]+")
NEW_MARKS = set('ɪʊːɜ')
VOWELS = set('aeiouæɑɒɔəɛɜɪʊʌ')


def ipa(raw):
    """ECDICT's phonetic field -> up to two pronunciations in the current notation, [] when it is not clean."""
    s = unicodedata.normalize('NFC', raw).replace('\xa0', ' ').strip().strip('[]/')
    if not s:
        return []
    new = any(c in NEW_MARKS for c in s)
    if '^' in s or '\\' in s:  # the misprinted rows
        s = re.sub(r'\\+', 'ɜ', s.replace('^', 'ɡ'))
        s = re.sub(r'([әəa])j', lambda m: m.group(1) + 'ʊ', s)
    out = []
    for v in re.split(r'\s*[.;；]\s*|,\s+|\s+', s):
        if not v or v.startswith('-') or v.endswith('-'):
            continue
        v = (v.replace("'", 'ˈ').replace('ˊ', 'ˈ').replace(',', 'ˌ').replace(':', 'ː').replace('ә', 'ə').replace('g', 'ɡ')
             .replace('ε', 'e').replace('є', 'e').replace('ɛ', 'e'))
        if not new:
            v = v.replace('əː', 'ɜː').replace('aː', 'ɑː').replace('ou', 'əu')
            b = []
            for i, c in enumerate(v):
                nxt = v[i + 1] if i + 1 < len(v) else ''
                prev = v[i - 1] if i else ''
                if c == 'i' and nxt != 'ː':
                    # happy's final i stays i; a diphthong's (my, day, boy) is ɪ.
                    c = 'i' if not nxt and prev not in VOWELS else 'ɪ'
                elif c == 'u' and nxt != 'ː':
                    c = 'ʊ'
                elif c in 'ɔɒ':
                    # The old notation's ɔ (ECDICT often prints it ɒ) is ɔ long or in boy, else ɒ.
                    c = 'ɔ' if nxt in ('ː', 'i') else 'ɒ'
                b.append(c)
            v = ''.join(b)
        if not IPA_OK.fullmatch(v) or not re.search('[aeiouæɑɒɔəɚɛɜɝɪʊʌ]', v) and v not in ('m', 'n'):
            continue
        if v not in out:
            out.append(v)
    return out[:2]


def fold(s):
    """The matching key; must agree with foldKey() in src/lang/spaced/core.ts for a language that does not keep case."""
    s = unicodedata.normalize('NFC', s or '').strip()
    s = re.sub(r'[’ʼ‘`´]', "'", s)
    return s.lower()


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def num(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return 0


def gloss_lines(translation):
    """ECDICT's translation as [(pos or '', [glosses])], domain lines ([医], [计], [网络] …) last and marked."""
    plain, domain = [], []
    for line in translation.replace('\r', '').replace('\\n', '\n').split('\n'):
        line = line.strip()
        if not line:
            continue
        m = re.match(r'^\[([^\]]+)\]\s*(.*)$', line)
        if m:
            domain.append(('', split_glosses(m.group(2))))
            continue
        m = re.match(r'^([a-z]+)\.\s*(.*)$', line)
        if m and m.group(1) in POS:
            plain.append((POS[m.group(1)], split_glosses(m.group(2)), m.group(1)))
        elif m and len(m.group(1)) <= 6 and m.group(1) in ('na', 'phr', 'pref', 'suff', 'comb', 'r', 's'):
            plain.append(('', split_glosses(m.group(2)), m.group(1)))
        else:
            plain.append(('', split_glosses(line), ''))
    return plain, domain


def split_glosses(text):
    out = []
    depth = 0
    cur = ''
    for ch in text:
        if ch in '（(':
            depth += 1
        elif ch in '）)':
            depth = max(0, depth - 1)
        if depth == 0 and ch in ',，;；':
            if cur.strip():
                out.append(cur.strip())
            cur = ''
            continue
        cur += ch
    if cur.strip():
        out.append(cur.strip())
    seen, glosses = set(), []
    for g in out:
        g = g.replace('|', '/').strip()
        # "run的过去式和过去分词" on run's own noun line: a form, not a meaning.
        if FORM_ONLY.match(g):
            continue
        if g and g not in seen and len(g) <= 40:
            seen.add(g)
            glosses.append(g)
    return glosses[:8]


def hint_of(glosses):
    """A short gloss for running text: the first gloss without its notes, at most about six characters."""
    for g in glosses:
        h = re.sub(r'[（(][^）)]*[）)]', '', g).strip(' .…')
        h = re.sub(r'^(?:使|把|被|对|将)?…+', '', h)
        if h and len(h) <= 8 and not re.search(r'[A-Za-z]{3,}', h):
            return h
    return ''


def regular(key, kind):
    """Regular forms of a word ECDICT gives none for: a noun's plural, a verb's -s, -ed and -ing."""
    if kind in ('s', '3'):
        if re.search(r'(?:s|x|z|ch|sh)$', key):
            return key + 'es'
        if re.search(r'[^aeiou]y$', key):
            return key[:-1] + 'ies'
        return key + 's'
    if kind in ('p', 'd'):
        if key.endswith('e'):
            return key + 'd'
        if re.search(r'[^aeiou]y$', key):
            return key[:-1] + 'ied'
        return key + 'ed'
    if kind == 'i':
        if key.endswith('ie'):
            return key[:-2] + 'ying'
        if key.endswith('e') and not key.endswith(('ee', 'ye', 'oe')) and len(key) > 2:
            return key[:-1] + 'ing'
        return key + 'ing'
    return ''


def lcp(a, b):
    n = 0
    while n < len(a) and n < len(b) and a[n] == b[n]:
        n += 1
    return n


def write_gz(path, text):
    with open(path, 'wb') as f:
        with gzip.GzipFile(filename='', mode='wb', fileobj=f, compresslevel=9, mtime=0) as gz:
            gz.write(text.encode('utf-8'))


def text_words(folder):
    counts = collections.Counter()
    if not folder or not os.path.isdir(folder):
        return counts
    for name in sorted(os.listdir(folder)):
        if name.endswith(('.txt', '.md')):
            with open(os.path.join(folder, name), encoding='utf-8') as f:
                text = f.read()
                for w in re.findall(r"[A-Za-z]+(?:['’][A-Za-z]+)*", text):
                    counts[fold(w)] += 1
                # sand-bank, to-morrow: the word the pieces make (the engine reads them joined, en.ts joinHyphens).
                for w in re.findall(r"[A-Za-z]+(?:-[A-Za-z]+)+", text):
                    counts[fold(w.replace('-', ''))] += 1
    return counts


def load_curated(path):
    out = collections.OrderedDict()
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line or line.startswith('#'):
                continue
            c = line.split('\t')
            out.setdefault((c[0], c[1]), []).append((c[2], c[3:]))
    return out


def main(argv):
    opt = lambda name, default=None: argv[argv.index(name) + 1] if name in argv else default
    src = opt('--ecdict', os.path.join(REPO, '.cache', 'raw', 'ecdict', 'ecdict.csv'))
    if sha256(src) != ECDICT_SHA256:
        sys.exit(f'{src}: not the pinned ECDICT ({ECDICT_COMMIT}); download it again')
    met = text_words(opt('--texts', os.path.join(REPO, 'public', 'samples', 'en')))
    curated = load_curated(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'curated.tsv'))
    curated_keys = {fold(w) for w, _ in curated}
    curated_pos_all = {(fold(w), p) for w, p in curated}

    rows, phonetic = {}, {}
    with open(src, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            w = r['word']
            # How each word is said, the lower-case row's first (polish before Polish).
            if r['phonetic'].strip() and ' ' not in w and (fold(w) not in phonetic or w == w.lower()):
                said = ipa(r['phonetic'])
                if said:
                    phonetic[fold(w)] = said
            if ' ' in w or not re.fullmatch(r"[A-Za-z][A-Za-z'\-]*\.?", w) or len(w) > 30 or w in AUX_ONLY:
                continue
            useful = num(r['frq']) or num(r['bnc']) or r['collins'] or r['oxford'] or r['tag'] or met.get(fold(w), 0) >= 2
            if useful and r['translation'].strip():
                rows[w] = r
    phrase_rows = {}
    with open(src, encoding='utf-8') as f:
        for r in csv.DictReader(f):
            w = r['word']
            if ' ' in w and re.fullmatch(r"[a-z][a-z' ]*", w) and 2 <= len(w.split()) <= 4 and r['translation'].strip():
                phrase_rows[w] = r

    # A row that is only a form of another word ("went: go的过去式") is not an entry: the lemma's forms cover it.
    def form_only(r):
        ex = dict(p.split(':', 1) for p in r['exchange'].split('/') if ':' in p)
        lemma = ex.get('0')
        if not lemma or lemma == r['word'] or lemma not in rows:
            return False
        plain, _ = gloss_lines(r['translation'])
        return all(FORM_ONLY.match(' '.join(g)) or not g for _, g, _ in plain) if plain else True

    Entry = collections.namedtuple('Entry', 'key head pos senses hint')
    entries, rank_of, level_of, forms_of = [], {}, {}, collections.defaultdict(dict)
    for w, r in rows.items():
        key = fold(w)
        rank = num(r['frq']) or num(r['bnc'])
        if rank and (key not in rank_of or rank < rank_of[key]):
            rank_of[key] = rank
        lv = min((LEVEL[t] for t in r['tag'].split() if t in LEVEL), default=0)
        if lv and (key not in level_of or lv < level_of[key]):
            level_of[key] = lv
        if form_only(r):
            continue
        for part in r['exchange'].split('/'):
            if ':' in part:
                kind, val = part.split(':', 1)
                if kind in FORM_DESC:
                    for form in val.split(','):
                        form = fold(form)
                        if form and form != key and re.fullmatch(r"[a-z'\-]+", form):
                            forms_of[(key, w)].setdefault(kind, form)
        if key in curated_keys and any(fold(cw) == key for cw, _ in curated):
            pass  # replaced below, part of speech by part of speech
        plain, domain = gloss_lines(r['translation'])
        lines = [(p, g) for p, g, _ in plain if g] or [(p, g) for p, g in domain if g]
        if not lines:
            continue
        # Parts of speech in ECDICT's own order of use when it gives one ("n:46/v:54"), else as listed.
        share = {POS.get(k, k): num(v) for k, v in (p.split(':') for p in r['pos'].split('/') if ':' in p)}
        by_pos = collections.OrderedDict()
        for p, g in lines:
            p = p or (max(share, key=share.get) if share else 'noun')
            by_pos.setdefault(p, []).append(g)
        order = sorted(by_pos, key=lambda p: -share.get(p, 0)) if share else list(by_pos)
        capital = w[0].isupper() and w != 'I' and not w.isupper()
        for p in order:
            pos = 'proper noun' if capital and p == 'noun' else p
            senses = by_pos[p]
            entries.append(Entry(key, w, pos, senses, hint_of([g for s in senses for g in s])))

    # The curated words: their part of speech replaces ECDICT's; other parts stay, except that a function word keeps only
    # ECDICT's verbs and adverbs ("in" is no noun 执政者, "a" no noun 第一个字母) and a contraction nothing of ECDICT's.
    FUNCTION = {'article', 'preposition', 'conjunction', 'pronoun', 'determiner'}
    first_pos = {}
    for (w, pos) in curated:
        first_pos.setdefault(fold(w), pos)
    for (w, pos), lines in curated.items():
        key = fold(w)
        fp = first_pos[key]
        def dropped(e):
            if e.key != key or e.head.startswith(tuple('ABCDEFGHIJKLMNOPQRSTUVWXYZ')) and e.head != w:
                return False
            if fp == 'contraction' or e.pos == pos:
                return True
            return fp in FUNCTION and e.pos not in ('verb', 'adverb') and (key, e.pos) not in curated_pos_all
        entries = [e for e in entries if not dropped(e)]
        for hint, senses in lines:
            entries.append(Entry(key, w, pos, [s.split('|') for s in senses], hint))
        if pos == 'contraction':
            level_of.setdefault(key, 1)
    # Order: by key's rank, commonest first, then the curated part of speech before ECDICT's for the same key.
    curated_pos = {(fold(w), p) for w, p in curated}
    first = {}
    for i, e in enumerate(entries):
        first.setdefault(e.key, i)
    entries.sort(key=lambda e: (rank_of.get(e.key, 10 ** 7), first[e.key], 0 if (e.key, e.pos) in curated_pos else 1))

    # Forms: ECDICT's exchange, else the regular ones; a noun's possessive. Each entry of the key gets the forms of its own
    # part of speech.
    descs, rules, paradigms = {}, {}, {}
    entry_paradigm = {}
    plurals = {}
    by_key_forms = collections.defaultdict(dict)
    for (key, w), f in forms_of.items():
        for kind, form in f.items():
            by_key_forms[key].setdefault(kind, form)
    n_forms = 0
    form_words = set()
    for idx, e in enumerate(entries):
        if e.pos in ('contraction', 'article', 'preposition', 'conjunction', 'interjection', 'numeral', 'determiner'):
            continue
        have = by_key_forms.get(e.key, {})
        toks = collections.defaultdict(list)  # form -> descriptions
        if e.pos == 'verb' and e.key in AUX_FORMS:
            for form, d in AUX_FORMS[e.key].items():
                toks[form].append(d)
            have = {}
        kinds = [] if e.pos == 'verb' and e.key in AUX_FORMS else [k for k in FORM_DESC if FORM_POS[k] == ('adjective' if e.pos == 'adverb' else 'noun' if e.pos == 'proper noun' else e.pos)]
        for kind in kinds:
            form = have.get(kind)
            if not form and e.pos in ('noun', 'verb') and re.fullmatch(r'[a-z]+', e.key) and len(e.key) > 2 and e.pos != 'proper noun':
                form = regular(e.key, kind)
            if form:
                toks[form].append(FORM_DESC[kind])
        if e.pos == 'verb':
            for form in OLD_PAST.get(e.key, []):
                if form not in toks:
                    toks[form].append('past tense and past participle')
        if e.pos in ('noun', 'proper noun'):
            toks[e.key + "'s"].append('possessive')
            pl = have.get('s') or (regular(e.key, 's') if e.pos == 'noun' and re.fullmatch(r'[a-z]+', e.key) else '')
            if pl:
                toks[pl + "'" if pl.endswith('s') else pl + "'s"].append('plural possessive')
        tok_list = []
        for form, ds in toks.items():
            form_words.add(form)
            d = ' and '.join(dict.fromkeys(ds))
            c = lcp(e.key, form)
            rule = rules.setdefault((e.key[c:], form[c:]), len(rules))
            tok_list.append((rule, descs.setdefault(d, len(descs))))
            n_forms += 1
        if tok_list:
            p = tuple(sorted(set(tok_list)))
            entry_paradigm[idx] = paradigms.setdefault(p, len(paradigms))

    os.makedirs(OUT, exist_ok=True)
    lines = []
    for idx, e in enumerate(entries):
        sense_cols = ['|'.join(g for g in s if g) for s in e.senses if any(s)]
        if not sense_cols:
            continue
        lines.append('\t'.join([e.key, e.head if e.head != e.key else '', '', e.pos, '', str(rank_of.get(e.key, '')),
                                str(entry_paradigm.get(idx, '')), '', e.hint, *sense_cols]))
    header = (f'# Globereader English dictionary for Chinese speakers. From ECDICT (MIT, github.com/skywind3000/ECDICT, '
              f'{ECDICT_COMMIT[:7]}) and scripts/lang/en/curated.tsv. Built {datetime.date.today().isoformat()}.\n'
              '# key\thead\treading\tpos\tgender\trank\tparadigm\tflags\thint\tsenses...\n')
    write_gz(os.path.join(OUT, 'entries.tsv.gz'), header + '\n'.join(lines) + '\n')

    flines = ['D\t' + d for d, _ in sorted(descs.items(), key=lambda x: x[1])]
    flines += ['R\t' + rem + '\t' + add for (rem, add), _ in sorted(rules.items(), key=lambda x: x[1])]
    flines += ['P\t' + ' '.join(f'{r}.{d}' for r, d in p) for p, _ in sorted(paradigms.items(), key=lambda x: x[1])]
    write_gz(os.path.join(OUT, 'forms.tsv.gz'), '\n'.join(flines) + '\n')

    known = {e.key for e in entries}
    plines = []
    for w, r in phrase_rows.items():
        words = w.split()
        if not all(x in known for x in words):
            continue
        phrasal = len(words) <= 3 and words[0] in known and words[0] not in NOT_PHRASAL and rank_of.get(words[0], 10 ** 7) <= 4000 and all(x in PARTICLES for x in words[1:]) \
            and any(e.key == words[0] and e.pos == 'verb' for e in entries[:20000])
        if not (w in EXPRESSIONS or phrasal):
            continue
        plain, _ = gloss_lines(r['translation'])
        senses = ['|'.join(g) for _, g, _ in plain if g]
        if not senses:
            continue
        plines.append((0 if w in EXPRESSIONS else 1, rank_of.get(words[0], 10 ** 7), w, hint_of([g for _, g, _ in plain for g in g]), senses))
    plines.sort()
    write_gz(os.path.join(OUT, 'phrases.tsv.gz'), '# Globereader English fixed phrases, from ECDICT (MIT): words folded lower-case, hint, senses.\n'
             + '\n'.join('\t'.join([w, h, *s]) for _, _, w, h, s in plines) + '\n')

    # How the words and their forms are said (the card shows it): `word\tIPA`, two pronunciations split by |.
    said = {w: phonetic[w] for w in known | form_words if w in phonetic}
    write_gz(os.path.join(OUT, 'ipa.tsv.gz'), '# word\tIPA (| between two pronunciations), from ECDICT\'s phonetics in the current British notation\n'
             + '\n'.join(f'{w}\t{"|".join(v)}' for w, v in sorted(said.items())) + '\n')
    write_gz(os.path.join(OUT, 'levels.tsv.gz'), '# key\tlevel (1 中考, 2 高考, 3 CET-4, 4 CET-6, 5 IELTS/TOEFL/考研, 6 GRE), from ECDICT\'s exam tags\n'
             + '\n'.join(f'{k}\t{v}' for k, v in sorted(level_of.items()) if k in known) + '\n')
    meta = {
        'lang': 'en', 'built': datetime.date.today().isoformat(),
        'counts': {'entries': len(lines), 'keys': len(known), 'forms': n_forms, 'rules': len(rules), 'paradigms': len(paradigms),
                   'descriptions': len(descs), 'ranked': len(rank_of), 'levels': sum(1 for k in level_of if k in known),
                   'phrases': len(plines), 'pronunciations': len(said)},
        'sources': [{'name': 'ECDICT (English-Chinese dictionary), Linwei (skywind3000)', 'license': 'MIT',
                     'url': 'https://github.com/skywind3000/ECDICT'}],
    }
    with open(os.path.join(OUT, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
        f.write('\n')
    sizes = {n: os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT)}
    print(json.dumps(meta['counts']), sizes)


if __name__ == '__main__':
    main(sys.argv[1:])
