#!/usr/bin/env python3
"""Build LinguPengu's own-language dictionaries: a word's meaning explained in its own language, for someone reading a book in
the language they speak, and for English, for anyone.

    python3 -I scripts/lang/native/build.py en             # Simple English Wiktionary, then English Wiktionary
    python3 -I scripts/lang/native/build.py es fr de it pt ru

Standard library only. Writes public/data/<id>/native.tsv.gz (and for English, public/data/en/native-rare/<shard>.tsv.gz for
the rare words the main dictionary leaves out, sharded as data/en/rare is: src/lang/spaced/rareWords.ts rareShard):

    key  pos  hint  sense  sense ...

    key    the word as the language's main dictionary (public/data/<id>/entries.tsv.gz) keys it, so the app finds it by the same
           key the word on the page was looked up under
    pos    its part of speech, named as the main dictionary names it (noun, verb, adjective, proper noun...)
    hint   a simpler word for it, shown over the word in running text: the commonest of its synonyms that is much commoner
           than the word itself (ranks from the main dictionary), else its first meaning when that is three words or fewer;
           empty when there is neither
    sense  one meaning: "{label, label}definition", the labels (informal, old-fashioned...) in braces when there are any

Only words the main dictionary has are written (its keys say which), so the two never disagree about what a word is; senses
that only say a word is a form of another ("plural of", "past tense of") are left out, as the main dictionary already reads
forms.

Sources:
  English   Simple English Wiktionary (CC BY-SA 4.0), whose definitions are written in simple words for learners ("If
            something is abundant, then there is a lot of it."), first; English Wiktionary (CC BY-SA 4.0, via kaikki.org) for
            the words and parts of speech it lacks. Inputs: the Simple English Wiktionary dump, saved at
            .cache/raw/simplewikt/simplewiktionary-pages-articles.xml.bz2 (dumps.wikimedia.org/simplewiktionary/latest/), and
            a slim extract of kaikki.org's English Wiktionary for the words the English dictionary has, at
            .cache/raw/kaikki-en-slim.jsonl.gz (made by --extract-en, below).
  others    that language's own Wiktionary (CC BY-SA 4.0), via kaikki.org's extract of it (kaikki.org/<id>wiktionary/),
            streamed off the network and never saved.

    python3 -I scripts/lang/native/build.py --extract-en   # writes .cache/raw/kaikki-en-slim.jsonl.gz (a 534 MB stream)
"""
import bz2
import collections
import datetime
import glob
import gzip
import json
import os
import re
import sys
import xml.etree.ElementTree as ET

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
sys.path.insert(0, os.path.join(ROOT, 'scripts', 'lang', 'wikt'))
import kaikki  # noqa: E402

DATA = os.path.join(ROOT, 'public', 'data')
RAW = os.path.join(ROOT, '.cache', 'raw')
SIMPLE_DUMP = os.path.join(RAW, 'simplewikt', 'simplewiktionary-pages-articles.xml.bz2')
EN_EXTRACT = os.path.join(RAW, 'kaikki-en-slim.jsonl.gz')

NAMES = {'en': 'English', 'es': 'Spanish', 'fr': 'French', 'de': 'German', 'it': 'Italian', 'pt': 'Portuguese', 'ru': 'Russian',
         'ja': 'Japanese', 'zh': 'Chinese'}
# kaikki's part-of-speech codes, named as the main dictionaries name them.
POS = {'noun': 'noun', 'verb': 'verb', 'adj': 'adjective', 'adv': 'adverb', 'name': 'proper noun', 'intj': 'interjection',
       'prep': 'preposition', 'pron': 'pronoun', 'num': 'numeral', 'conj': 'conjunction', 'det': 'determiner',
       'article': 'article', 'particle': 'particle', 'contraction': 'contraction', 'postp': 'postposition', 'phrase': 'phrase'}
# Simple English Wiktionary's section names.
SIMPLE_POS = {'noun': 'noun', 'verb': 'verb', 'adjective': 'adjective', 'adverb': 'adverb', 'proper noun': 'proper noun',
              'pronoun': 'pronoun', 'preposition': 'preposition', 'conjunction': 'conjunction', 'interjection': 'interjection',
              'determiner': 'determiner', 'article': 'article', 'numeral': 'numeral', 'number': 'numeral',
              'contraction': 'contraction', 'cardinal number': 'numeral', 'ordinal number': 'adjective', 'expression': 'phrase',
              'phrase': 'phrase', 'idiom': 'phrase'}
# English labels worth showing on a meaning (kaikki's tags and Simple Wiktionary's templates), in plain words.
EN_LABELS = {'informal': 'informal', 'colloquial': 'informal', 'slang': 'slang', 'formal': 'formal', 'archaic': 'old-fashioned',
             'obsolete': 'old', 'dated': 'old-fashioned', 'old-fashioned': 'old-fashioned', 'rare': 'rare', 'literary': 'literary',
             'poetic': 'poetic', 'British': 'British', 'UK': 'British', 'US': 'American', 'dialectal': 'dialect',
             'offensive': 'offensive', 'vulgar': 'rude', 'derogatory': 'rude', 'humorous': 'humorous', 'figuratively': 'figurative',
             'figurative': 'figurative'}
MAX_SENSES = 6
HINT_MAX_RANK = 6000      # a hint is a common word
HINT_EASIER = 0.5         # ...at most half the rank of the word it explains


def fold(code, s):
    """The main dictionaries' matching key (scripts/lang/wikt/build.py fold; English keys are its words, lower case)."""
    import unicodedata
    s = unicodedata.normalize('NFC', s or '').strip()
    s = re.sub(r"[’ʼ‘`´]", "'", s)
    if code == 'ru':
        s = unicodedata.normalize('NFD', s.lower())
        s = re.sub('[̀́]', '', s)
        return unicodedata.normalize('NFC', s).replace('ё', 'е')
    if code == 'de':
        return s
    return s.lower()


def main_dictionary(code):
    """The main dictionary's keys: rank (lowest of its entries) and parts of speech, by key."""
    rank, poses = {}, collections.defaultdict(set)
    with gzip.open(os.path.join(DATA, code, 'entries.tsv.gz'), 'rt', encoding='utf-8') as f:
        for line in f:
            if line.startswith('#'):
                continue
            c = line.rstrip('\n').split('\t')
            key = c[0]
            poses[key].add(c[3])
            if c[5]:
                r = int(c[5])
                if key not in rank or r < rank[key]:
                    rank[key] = r
            else:
                rank.setdefault(key, None)
    return rank, poses


def phrase_keys(code):
    """The main dictionary's fixed phrases, by a spelling a Wiktionary headword can be matched on: the phrase file keys them
    folded and cut as the engine cuts them ("c' est à dire"); hyphens and apostrophes become spaces on both sides."""
    out = {}
    path = os.path.join(DATA, code, 'phrases.tsv.gz')
    if os.path.exists(path):
        with gzip.open(path, 'rt', encoding='utf-8') as f:
            for line in f:
                if not line.startswith('#'):
                    key = line.split('\t')[0]
                    out.setdefault(phrase_norm(code, key), key)
    return out


def phrase_norm(code, s):
    return ' '.join(re.sub(r"['’\-]", ' ', fold(code, s).lower()).split())


# What is left of a link template in some Wiktionaries (Italian "( approfondimento)", "( tassonomia)"): a parenthesis that opens
# with a space and holds one word.
TEMPLATE_LEFTOVER = re.compile(r'\s*\(\s+[^\s()]+\s*\)')
# A gloss that is only those leftovers ("casa ( approfondimento) f sing") says nothing.
EMPTY_GLOSS = re.compile(r'^\S+( [mf]( sing| pl)?)?$', re.I)


def clean(text):
    text = TEMPLATE_LEFTOVER.sub('', re.sub(r'\s+', ' ', text or '')).strip()
    return text.replace('\t', ' ').replace('|', '/')


# ------------------------------------------------------------------------------------------------ Simple Wiktionary ---

TEMPLATE = re.compile(r'\{\{([^{}]*)\}\}')
LINK = re.compile(r'\[\[(?:[^\[\]|]*\|)?([^\[\]|]*)\]\]')
FILE_LINK = re.compile(r'\[\[(?:File|Image|Category):[^\[\]]*(?:\[\[[^\[\]]*\]\][^\[\]]*)*\]\]', re.I)


def simple_line(raw):
    """A Simple Wiktionary definition line: its text, its labels and its synonyms (the {{syn|...}} it carries)."""
    labels, syns = [], []
    s = re.sub(r'<ref[^>]*/>|<ref[^>]*>.*?</ref>|<!--.*?-->', '', raw, flags=re.S)
    s = FILE_LINK.sub('', s)

    def template(m):
        parts = [p.strip() for p in m.group(1).split('|')]
        name = parts[0].lower()
        args = [p for p in parts[1:] if '=' not in p]
        if name in ('syn', 'synonyms'):
            syns.extend(args)
            return ''
        if name in ('ant', 'antonyms', 'antonym'):
            return ''
        if name in ('w', 'l', 'term'):
            return args[-1] if args else ''
        if name == 'r':
            return ''.join(args)
        if name in EN_LABELS:
            labels.append(EN_LABELS[name])
            return ''
        if name in ('label', 'lb', 'context') and args:
            for a in args:
                if a in EN_LABELS:
                    labels.append(EN_LABELS[a])
            return ''
        return ''

    for _ in range(3):
        s = TEMPLATE.sub(template, s)
    s = LINK.sub(lambda m: m.group(1), s)
    s = re.sub(r"'{2,}", '', s)
    s = re.sub(r'<[^>]+>', '', s)
    s = re.sub(r'\(\s*\)', '', s)
    s = re.sub(r'\s+([.,;:!?])', r'\1', clean(s))
    return s, labels, [x for x in syns if x and ' ' not in x.strip()]


def simple_entries():
    """Simple English Wiktionary: by word, the parts of speech in order, each with its definitions and synonyms."""
    out = collections.defaultdict(list)
    with bz2.open(SIMPLE_DUMP, 'rb') as f:
        for _, el in ET.iterparse(f, events=('end',)):
            if not el.tag.endswith('page'):
                continue
            title, nsel, text = el.find('{*}title'), el.find('{*}ns'), el.find('.//{*}text')
            if nsel is None or nsel.text != '0' or title is None or text is None or not text.text:
                el.clear()
                continue
            word = title.text
            pos = None
            in_syn = False
            for line in text.text.split('\n'):
                h = re.match(r'^=+\s*([^=]+?)\s*=+\s*$', line)
                if h:
                    name = h.group(1).strip().lower()
                    in_syn = name == 'synonyms'
                    if in_syn:
                        continue
                    pos = SIMPLE_POS.get(name)
                    if pos:
                        out[word].append({'pos': pos, 'senses': [], 'syn': []})
                    continue
                # "=== Synonyms ===" under a part of speech: its linked words.
                if in_syn and out[word] and line.startswith('*'):
                    out[word][-1]['syn'].extend(w for w in LINK.findall(re.sub(r'\{\{[^{}]*\}\}', '', line)) if w and ' ' not in w)
                    continue
                if pos and re.match(r'^#\s*[^:*#]', line):
                    gloss, labels, syns = simple_line(line.lstrip('#').strip())
                    entry = out[word][-1]
                    entry['syn'].extend(syns)
                    # The synonyms Simple Wiktionary's editors put on the first meaning itself, chosen for learners.
                    if not entry['senses'] and syns:
                        entry['first_syn'] = syns
                    if gloss and len(gloss) > 2 and len(entry['senses']) < MAX_SENSES:
                        entry['senses'].append((gloss, labels))
            el.clear()
    return out


# ------------------------------------------------------------------------------------------------- kaikki extracts ---

def is_form_only(s):
    return bool(s.get('fo') or s.get('ao') or 'form-of' in (s.get('t') or []) or 'alt-of' in (s.get('t') or []))


def extract_en():
    """Streams kaikki.org's English Wiktionary and keeps, for every word the English dictionary has (main and rare), each
    entry's part of speech, glosses, tags, form-of marks and synonyms: EN_EXTRACT."""
    keys = set()
    with gzip.open(os.path.join(DATA, 'en', 'entries.tsv.gz'), 'rt', encoding='utf-8') as g:
        for line in g:
            if not line.startswith('#'):
                c = line.split('\t')
                keys.add(c[0].lower())
                keys.add((c[1] or c[0]).lower())
    for p in glob.glob(os.path.join(DATA, 'en', 'rare', '*.tsv.gz')):
        with gzip.open(p, 'rt', encoding='utf-8') as g:
            for line in g:
                if not line.startswith('#'):
                    keys.add(line.split('\t')[0].lower())
    n = kept = 0
    with gzip.open(EN_EXTRACT, 'wt', encoding='utf-8', compresslevel=6) as out:
        for e in kaikki.stream_entries('English'):
            n += 1
            w = e.get('word') or ''
            if w.lower() not in keys:
                continue
            rec = slim_sense_entry(e)
            if rec:
                out.write(json.dumps(rec, ensure_ascii=False, separators=(',', ':')) + '\n')
                kept += 1
    print(f'English Wiktionary: read {n}, kept {kept}')


def slim_sense_entry(e):
    senses = []
    for s in e.get('senses') or []:
        o = {}
        if s.get('glosses'):
            o['g'] = s['glosses']
        if s.get('tags'):
            o['t'] = s['tags']
        if s.get('raw_tags'):
            o['rt'] = s['raw_tags']
        if s.get('form_of'):
            o['fo'] = [x.get('word') for x in s['form_of'] if x.get('word')]
        if s.get('alt_of'):
            o['ao'] = [x.get('word') for x in s['alt_of'] if x.get('word')]
        syn = [x.get('word') for x in (s.get('synonyms') or []) if x.get('word')]
        if syn:
            o['sy'] = syn
        if o:
            senses.append(o)
    if not senses:
        return None
    rec = {'w': e.get('word') or '', 'p': e.get('pos') or '', 's': senses}
    syn = [x.get('word') for x in (e.get('synonyms') or []) if x.get('word')]
    if syn:
        rec['sy'] = syn
    return rec


def kaikki_entry(rec, labels_of):
    """One kaikki entry as {'pos', 'senses', 'syn'}: its meanings (form-of senses left out) with their labels."""
    pos = POS.get(rec.get('p'))
    if not pos:
        return None
    senses, syns = [], list(rec.get('sy') or [])
    for s in rec['s']:
        syns.extend(s.get('sy') or [])
        if is_form_only(s) or not s.get('g'):
            continue
        raw = s['g'][-1]
        gloss = clean(raw)
        # Only template leftovers ("casa ( approfondimento) f sing"): nothing to say.
        empty = TEMPLATE_LEFTOVER.search(raw) and EMPTY_GLOSS.search(gloss) or 'definizione mancante' in gloss
        if not gloss or empty or len(senses) >= MAX_SENSES or any(gloss == g for g, _ in senses):
            continue
        senses.append((gloss, labels_of(s)))
    return {'pos': pos, 'senses': senses, 'syn': [x for x in syns if x and ' ' not in x.strip()]} if senses else None


def en_labels(s):
    out = []
    for t in s.get('t') or []:
        lab = EN_LABELS.get(t)
        if lab and lab not in out:
            out.append(lab)
    return out[:2]


def edition_labels(s):
    """In another language's Wiktionary, its own labels (raw_tags: "coloquial", "anticuado"), short ones only."""
    return [clean(t) for t in (s.get('rt') or []) if 0 < len(t) <= 24][:2]


# ------------------------------------------------------------------------------------------------------- writing ---

WORD = re.compile(r"[^\W\d_]+(?:['’-][^\W\d_]+)*")


def pick_hint(code, key, entries, rank, poses):
    """A simpler word for `key` in its commonest part of speech, only when two sources agree on it: a synonym of the same part
    of speech that its own definitions also use, or a definition that is itself a word or two, all of them common. Either
    way much commoner than `key`. Empty otherwise (most words: a wrong hint over the text is worse than none)."""
    own = rank.get(key) or 10 ** 6
    if own <= 1500 or not entries:
        return ''
    e = entries[0]
    stem = key[:max(3, len(key) - 3)]
    # Easy enough, a word of three letters or more, and not the same word in another form (closer, close).
    easy = lambda k: (rank.get(k) is not None and rank[k] <= HINT_MAX_RANK and rank[k] <= own * HINT_EASIER and len(k) >= 3
                      and not k.startswith(stem) and not key.startswith(k[:max(3, len(k) - 2)]))
    defs = ' '.join(g for g, _ in e['senses'][:3])
    used = {fold(code, w) for w in WORD.findall(defs)}
    best = None
    for s in e['syn']:
        k = fold(code, s)
        if k != key and k in used and easy(k) and e['pos'] in poses.get(k, ()):
            if best is None or rank[k] < best[0]:
                best = (rank[k], s.strip())
    if best:
        return best[1]
    # Simple English Wiktionary's own synonyms for the first meaning, chosen for learners: the commonest that is easy enough.
    for s in e.get('first_syn') or []:
        k = fold(code, s)
        if k != key and easy(k) and e['pos'] in poses.get(k, ()):
            if best is None or rank[k] < best[0]:
                best = (rank[k], s.strip())
    if best:
        return best[1]
    if e['senses']:
        g = re.sub(r'\s*\(.*?\)', '', e['senses'][0][0]).rstrip('.').split(';')[0].split(',')[0].strip()
        words = [fold(code, w) for w in WORD.findall(g)]
        if 0 < len(words) <= 2 and g[:1].islower() and all(easy(w) for w in words):
            return g
    return ''


def row(key, entry, hint):
    senses = [('{' + ', '.join(labels) + '}' if labels else '') + gloss for gloss, labels in entry['senses']]
    return '\t'.join([key, entry['pos'], hint] + senses)


def header(code, sources):
    when = datetime.date.today().isoformat()
    return [f'# LinguPengu {NAMES[code]} dictionary in {NAMES[code]}. From {sources}. Built {when}.',
            '# key\tpos\thint\tsenses...']


def write_lines(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, 'wt', encoding='utf-8', compresslevel=9) as f:
        f.write('\n'.join(lines) + '\n')


def order_entries(found, poses):
    """The main dictionary's parts of speech first, in its order of commonness, each once (two of a part merged)."""
    merged = collections.OrderedDict()
    for e in found:
        m = merged.get(e['pos'])
        if m is None:
            merged[e['pos']] = {'pos': e['pos'], 'senses': list(e['senses']), 'syn': list(e['syn']), 'first_syn': list(e.get('first_syn') or [])}
        else:
            m['senses'].extend(x for x in e['senses'] if len(m['senses']) < MAX_SENSES and x not in m['senses'])
            m['syn'].extend(e['syn'])
    have = [e for e in merged.values() if e['pos'] in poses]
    return have or list(merged.values())


def build_en():
    rank, poses = main_dictionary('en')
    simple = simple_entries()
    print(f'Simple English Wiktionary: {len(simple)} words')
    wikt = collections.defaultdict(list)
    with gzip.open(EN_EXTRACT, 'rt', encoding='utf-8') as f:
        for line in f:
            rec = json.loads(line)
            e = kaikki_entry(rec, en_labels)
            if e:
                wikt[rec['w']].append(e)
    print(f'English Wiktionary: {len(wikt)} words')

    def entries_for(key, written=None):
        words = [w for w in dict.fromkeys([written or key, key, key.capitalize()]) if w]
        found = [e for w in words for e in simple.get(w, []) if e['senses']]
        have_pos = {e['pos'] for e in found}
        # English Wiktionary for the parts of speech Simple Wiktionary lacks (and the words it lacks altogether).
        found += [e for w in words for e in wikt.get(w, []) if e['pos'] not in have_pos]
        return found

    lines = []
    phrases = phrase_keys('en')
    for norm, key in phrases.items():
        found = [e for w in (key, norm) for e in simple.get(w, []) if e['senses']]
        if found:
            lines.extend(row(key, dict(e, pos='phrase'), '') for e in order_entries(found, set())[:1])
    for key in rank:
        found = entries_for(key)
        if not found:
            continue
        ordered = order_entries(found, poses[key])
        hint = pick_hint('en', key, ordered, rank, poses)
        lines.extend(row(key, e, hint) for e in ordered)
    write_lines(os.path.join(DATA, 'en', 'native.tsv.gz'),
                header('en', 'Simple English Wiktionary and English Wiktionary (CC BY-SA 4.0, English Wiktionary via kaikki.org)') + lines)
    print(f'wrote public/data/en/native.tsv.gz: {len(lines)} entries of {len(rank)} words')

    # The rare words, by shard, as data/en/rare has them.
    shards = collections.defaultdict(list)
    rare_keys = []
    for p in sorted(glob.glob(os.path.join(DATA, 'en', 'rare', '*.tsv.gz'))):
        with gzip.open(p, 'rt', encoding='utf-8') as g:
            for line in g:
                if not line.startswith('#'):
                    rare_keys.append(line.split('\t')[0])
    for key in rare_keys:
        found = entries_for(key)
        if not found:
            continue
        ordered = order_entries(found, set())
        hint = pick_hint('en', key, ordered, rank, poses)
        shard = ''.join(c if 'a' <= c <= 'z' else '_' for c in (key + '_')[:2])
        for e in ordered:
            shards[shard].append(row(key, e, hint))
    out_dir = os.path.join(DATA, 'en', 'native-rare')
    for old in glob.glob(os.path.join(out_dir, '*.tsv.gz')):
        os.remove(old)
    for shard, rows in shards.items():
        write_lines(os.path.join(out_dir, f'{shard}.tsv.gz'), rows)
    print(f'wrote public/data/en/native-rare/: {sum(len(r) for r in shards.values())} entries in {len(shards)} files')
    update_meta('en', len(lines), [
        {'name': 'Simple English Wiktionary', 'license': 'CC BY-SA 4.0', 'url': 'https://simple.wiktionary.org/'},
        {'name': 'English Wiktionary (via kaikki.org)', 'license': 'CC BY-SA 4.0', 'url': 'https://kaikki.org/'},
    ])


def build_edition(code):
    rank, poses = main_dictionary(code)
    phrases = phrase_keys(code)
    found = collections.defaultdict(list)
    n = kept = 0
    url = f'https://kaikki.org/{code}wiktionary/raw-wiktextract-data.jsonl.gz'
    with kaikki.open_url(url) as res, gzip.open(res, 'rt', encoding='utf-8') as f:
        for line in f:
            if not line.startswith('{'):
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            n += 1
            if e.get('lang_code') != code:
                continue
            key = fold(code, e.get('word'))
            if key not in rank:
                key = phrases.get(phrase_norm(code, e.get('word') or ''))
                if not key or ' ' not in key:
                    continue
            rec = slim_sense_entry(e)
            entry = rec and kaikki_entry(rec, edition_labels)
            if entry:
                found[key].append(entry)
                kept += 1
    lines = []
    for key in phrases.values():
        if key in found and key not in rank:
            lines.extend(row(key, dict(e, pos='phrase'), '') for e in order_entries(found[key], set())[:1])
    for key in rank:
        if key not in found:
            continue
        ordered = order_entries(found[key], poses[key])
        hint = pick_hint(code, key, ordered, rank, poses)
        lines.extend(row(key, e, hint) for e in ordered)
    write_lines(os.path.join(DATA, code, 'native.tsv.gz'),
                header(code, f'{NAMES[code]} Wiktionary (CC BY-SA 4.0, via kaikki.org)') + lines)
    print(f'{code}: read {n} entries, kept {kept}; wrote public/data/{code}/native.tsv.gz: {len(lines)} entries for '
          f'{len(found)} of {len(rank)} words')
    update_meta(code, len(lines), [{'name': f'{NAMES[code]} Wiktionary (via kaikki.org)', 'license': 'CC BY-SA 4.0',
                                    'url': f'https://kaikki.org/{code}wiktionary/'}])


def update_meta(code, count, sources):
    path = os.path.join(DATA, 'meta.json') if code == 'zh' else os.path.join(DATA, code, 'meta.json')
    with open(path, encoding='utf-8') as f:
        text = f.read()
    meta = json.loads(text)
    # The file's own indent, kept.
    m = re.search(r'\n( +)"', text)
    meta['native'] = {'built': datetime.date.today().isoformat(), 'entries': count, 'sources': sources}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=len(m.group(1)) if m else 1)
        f.write('\n')


# --------------------------------------------------------------------------------------------- Japanese and Chinese ---
#
# Japanese and Chinese have no ranks or parts of speech to match on (JMdict's and CC-CEDICT's are not Wiktionary's), so their
# rows carry no part of speech or hint, and a word's entries are all its meanings, keyed by every spelling:
#
#   ja   jmdict.tsv.gz's kanji and kana forms. Japanese Wiktionary files most words under kana (たべる) and points the kanji
#        spelling at it ("たべるの漢字表記"); an entry is keyed by its word and the kanji forms it lists. A reading note that
#        opens a meaning ("（ねこ、ネコ）") is dropped. Writes public/data/ja/native.tsv.gz.
#   zh   CC-CEDICT's traditional and simplified words (cedict.tsv.gz). Chinese Wiktionary files words under their traditional
#        spelling with definitions in traditional characters; the app shows them in the reader's script. Writes
#        public/data/native.tsv.gz (the Chinese library's data is data/ itself).

CJK_SENSES = 8
# A meaning that only says the word is a form of another (「ふるう」の連用形): the main dictionary reads forms itself.
FORM_NOTE = re.compile(r'^「[^」]+」の(?:連用形|未然形|連体形|終止形|仮定形|命令形|已然形|語幹)')


def ja_class(tag):
    """A JMdict part of speech as the class Japanese Wiktionary names it, or None."""
    if tag in ('adj-i', 'adj-ix'):
        return 'adj'
    if tag == 'adj-na':
        return 'adj_noun'
    if tag in ('adv', 'adv-to'):
        return 'adv'
    if tag == 'n':
        return 'noun'
    if tag.startswith('v') and tag not in ('vi', 'vt'):
        return 'verb'
    return None


def ja_classes():
    """JMdict: each kanji spelling's part-of-speech classes, from every sense: what a kanji page that points at a kana word must be."""
    out = collections.defaultdict(set)
    with gzip.open(os.path.join(DATA, 'ja', 'jmdict.tsv.gz'), 'rt', encoding='utf-8') as f:
        for line in f:
            if line.startswith('#'):
                continue
            c = line.rstrip('\n').split('\t')
            classes = {k for sense in c[3:] for t in sense.split('\x1f')[0].split(',') for k in [ja_class(t)] if k}
            for form in c[0].split(';'):
                form = form.split('#')[0]
                if form:
                    out[form] |= classes
    return out


READING_NOTE = re.compile(r'^（[\u3040-\u30ff・、ー\s]+）')


def cjk_keys(code):
    keys = set()
    if code == 'ja':
        with gzip.open(os.path.join(DATA, 'ja', 'jmdict.tsv.gz'), 'rt', encoding='utf-8') as f:
            for line in f:
                if line.startswith('#'):
                    continue
                c = line.split('\t')
                for col in c[:2]:
                    for form in col.split(';'):
                        form = form.split('#')[0].split('@')[0]
                        if form:
                            keys.add(form)
    else:
        for name in ('cedict.tsv.gz', 'cedict-extra.tsv.gz'):
            path = os.path.join(DATA, name)
            if not os.path.exists(path):
                continue
            with gzip.open(path, 'rt', encoding='utf-8') as f:
                for line in f:
                    if not line.startswith('#'):
                        c = line.split('\t')
                        keys.update(x for x in c[:2] if x)
    return keys


def build_cjk(code):
    keys = cjk_keys(code)
    found = collections.defaultdict(list)
    # Japanese: entries by their kana word (with their part of speech and kanji spellings), and the kanji pages that only point
    # at a kana word (古い: "ふるいの漢字表記"), to key each kanji spelling under the right one of its reading's words.
    by_kana = collections.defaultdict(list)
    points = collections.defaultdict(set)
    n = kept = 0
    url = f'https://kaikki.org/{code}wiktionary/raw-wiktextract-data.jsonl.gz'
    with kaikki.open_url(url) as res, gzip.open(res, 'rt', encoding='utf-8') as f:
        for line in f:
            if not line.startswith('{'):
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            n += 1
            if e.get('lang_code') != code:
                continue
            if code == 'ja' and e.get('pos') == 'character':
                for sn in e.get('senses') or []:
                    for fo in sn.get('form_of') or []:
                        if fo.get('word') and e.get('word'):
                            points[e['word']].add(fo['word'])
                continue
            if e.get('pos') in ('character', 'soft-redirect', 'romanization', 'symbol'):
                continue
            senses = []
            for sn in e.get('senses') or []:
                if sn.get('form_of') or sn.get('alt_of') or 'form-of' in (sn.get('tags') or []) or not sn.get('glosses'):
                    continue
                gloss = clean(READING_NOTE.sub('', sn['glosses'][-1]))
                if FORM_NOTE.match(gloss):
                    continue
                if gloss and len(gloss) > 1 and gloss not in [g for g, _ in senses] and len(senses) < MAX_SENSES:
                    senses.append((gloss, edition_labels({'rt': sn.get('raw_tags') or []})))
            if not senses:
                continue
            word = e.get('word') or ''
            kanji = [fm.get('form') for fm in e.get('forms') or [] if 'kanji' in (fm.get('tags') or []) and fm.get('form')]
            if code == 'ja':
                by_kana[word].append({'pos': e.get('pos') or '', 'kanji': set(kanji), 'senses': senses})
            spellings = [word] + kanji
            for w in dict.fromkeys(spellings):
                if w in keys:
                    found[w].append({'pos': '', 'senses': senses, 'syn': []})
                    kept += 1
    if code == 'ja':
        # A kanji spelling that only points at its reading (古い → ふるい): the reading's entries that can be it, those that
        # list no other kanji and are the part of speech JMdict gives the spelling (ふるい the adjective, not 篩 the sieve).
        classes = ja_classes()
        for kanji, kanas in points.items():
            if kanji not in keys or kanji in found:
                continue
            want = classes.get(kanji, set())
            for kana in kanas:
                for e in by_kana.get(kana, []):
                    if e['kanji'] and kanji not in e['kanji']:
                        continue
                    if want and e['pos'] not in want and not (e['pos'] == 'adj_noun' and 'noun' in want):
                        continue
                    found[kanji].append({'pos': '', 'senses': e['senses'], 'syn': []})
    lines = []
    for key in sorted(found):
        # Each entry's first meaning, then each one's second, and so on: a character's entries are its etymologies (了 to
        # finish, 了 the particle), and the first one alone would fill the list.
        merged = []
        entries = found[key]
        for i in range(max(len(e['senses']) for e in entries)):
            for e in entries:
                if i < len(e['senses']) and e['senses'][i] not in merged:
                    merged.append(e['senses'][i])
        lines.append(row(key, {'pos': '', 'senses': merged[:CJK_SENSES]}, ''))
    out = os.path.join(DATA, 'native.tsv.gz') if code == 'zh' else os.path.join(DATA, code, 'native.tsv.gz')
    write_lines(out, header(code, f'{NAMES[code]} Wiktionary (CC BY-SA 4.0, via kaikki.org)') + lines)
    print(f'{code}: read {n} entries, kept {kept}; wrote {os.path.relpath(out, ROOT)}: {len(lines)} words of {len(keys)}')
    update_meta(code, len(lines), [{'name': f'{NAMES[code]} Wiktionary (via kaikki.org)', 'license': 'CC BY-SA 4.0',
                                    'url': f'https://kaikki.org/{code}wiktionary/'}])


if __name__ == '__main__':
    args = sys.argv[1:]
    if args == ['--extract-en']:
        extract_en()
        sys.exit()
    for code in args:
        if code == 'en':
            build_en()
        elif code in ('ja', 'zh'):
            build_cjk(code)
        elif code in NAMES:
            build_edition(code)
        else:
            raise SystemExit(f'unknown language {code}')
