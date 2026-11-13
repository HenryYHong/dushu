#!/usr/bin/env python3
"""Build LinguPengu's own-language dictionaries: a word's meaning explained in its own language, for someone reading a book in
the language they speak, and for English, for anyone.

    python3 -I scripts/lang/native/build.py en             # Simple English Wiktionary, then English Wiktionary
    python3 -I scripts/lang/native/build.py es fr de it pt ru
    python3 -I scripts/lang/native/build.py ja zh

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
            streamed off the network and never saved; for Chinese and Japanese the fields used are kept the first time at
            .cache/raw/kaikki-<id>-slim.jsonl.gz (a few MB), so a rebuild takes seconds (delete it to fetch anew).

Markup kaikki could not expand is taken out of every meaning (clean, residue): magic words, templates, links missing a
bracket, footnote marks, and meanings that are only a request for one. A Chinese variant whose page only points at another
character (㕑: "請見「廚」") gets a note of what it is to it (「廚」的異體字) and that character's meanings. So does a form whose
entry only says what it is a form of (Spanish "hija": "Forma del femenino singular de hijo.", then hijo's meanings), and an
adjective's meanings that are also a noun's ("se usa también como sustantivo") are the noun's too. A part of speech a
Wiktionary names otherwise than the main dictionary (Spanish "su": adjective there, determiner here) is named as the main
dictionary names it (SAME_POS).

Where Wiktionary leaves a word with a level (the 20,000 commonest, the HSK and JLPT words) without a meaning, one written for
the app fills it: scripts/lang/native/written/<id>.tsv (below). tests/lang/own-coverage.test.ts holds every such word to
having one.

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
       'article': 'article', 'particle': 'particle', 'contraction': 'contraction', 'postp': 'postposition', 'phrase': 'phrase',
       'abbrev': 'abbreviation'}
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


# Wiki markup a few glosses keep where kaikki could not expand it: magic words (__NOTITLECONVERT__), the dagger Chinese
# Wiktionary sets before a meaning only old dictionaries give, footnote marks, templates, and links missing a bracket.
MAGIC_WORD = re.compile(r'__[A-Z]+__')
OLD_MARK = re.compile(r'^(?:(?:\^?[‡⁜†]+|\^\(\[\d+\]\))\s*)+')
LABEL_TEMPLATE = re.compile(r'\{\{(?:lexique|Term|term)/([^/{}]+)/[^{}]*\}\}?\s*')
TEMPLATE_REST = re.compile(r'\{\{[^{}]*\}\}?')
DOUBLE_LINK = re.compile(r'\[\[([^\[\]]*)\]\]')
# "[[活动]（如诉讼": a link that lost a closing bracket (not chemistry's "3-[[(3-methylphenyl)amino]carbonyl]").
HALF_CLOSED = re.compile(r'\[\[([^\[\]\d()]+)\](?!\])')
HALF_LINK = re.compile(r'(?<!\[)\[([^\[\]]*/[^\[\]]*)\]\]')
# A meaning that is only a request for one ("本詞語需要翻譯為漢語。請協助添加"), says it is not known, or is a table's markup.
NO_MEANING = re.compile(r'需要翻譯為漢語|請協助添加|\{\{rfdef|rfdef\}\}|此詞的含意不確定|^\*?\s*\[[ST]:|class=[\'"]|wikitable|style=[\'"]|displaystyle')


def last_part(text):
    """A link's shown text: what follows its last slash (the pipe is a slash by then), or all of it."""
    parts = [x for x in text.split('/') if x.strip()]
    return parts[-1].strip() if parts else ''


def residue(text):
    if NO_MEANING.search(text):
        return ''
    text = MAGIC_WORD.sub('', text).strip()
    text = OLD_MARK.sub('', text)
    # A mark in the text: a reference to other senses ("von ^([1]) abgeleitet": sense 1) or a note (^([來源請求]), citation needed).
    text = re.sub(r'\^\((\[[^()]*)\)', lambda m: f"({', '.join(re.findall(r'\d+', m.group(1)))})" if re.search(r'\d', m.group(1)) else '', text)
    text = LABEL_TEMPLATE.sub(lambda m: f'({m.group(1)}) ', text)
    text = TEMPLATE_REST.sub('', text)
    text = DOUBLE_LINK.sub(lambda m: last_part(m.group(1)), text)
    text = HALF_LINK.sub(lambda m: last_part(m.group(1)), text)
    text = HALF_CLOSED.sub(lambda m: last_part(m.group(1)), text)
    text = re.sub(r'\{\[?(?:ant|syn)/[^{}]*\}\}?', '', text).strip()  # "{[ant|parent}}": an antonym template
    label = re.match(r'^[\[{]*([^\s{}/\[\]]+)(?:/[a-z]{2,3})?\}\}\s*', text)  # "[[fleurs|fr}} Fleur", "biology}} Eczema": a label
    # "Modo di dire}Quando…", "chiefly / Uttarakhand} A member…": a label that lost its opening brace.
    label = label or re.match(r"^\{?([^\W\d_][\w .,'’/()-]{0,60}?)\}(?!\})\s*(?=[^\s_^{}])", text)
    if label:
        text = f'({label.group(1).strip()}) {text[label.end():]}'
    else:
        text = re.sub(r'^\[\[[^\s/\[\]]+/(?=\S)', '', text)  # "[[armature|Armature en forme…": an unclosed link's target
    text = re.sub(r'\[\[(?!\()', '', text)  # an unclosed link (not chemistry's "[[(")
    if re.fullmatch(r'[\W_]*[a-z]{0,3}:[\W_]*', text):
        return ''
    text = re.sub(r'^(?:[\]};,:]\s*)+', '', text)
    return re.sub(r'\s+', ' ', text).strip()


def clean(text):
    text = TEMPLATE_LEFTOVER.sub('', re.sub(r'\s+', ' ', text or '')).strip()
    return residue(text.replace('\t', ' ').replace('|', '/'))


# ------------------------------------------------------------------------------------------------ Simple Wiktionary ---

TEMPLATE = re.compile(r'\{\{([^{}]*)\}\}')
LINK = re.compile(r'\[\[(?:[^\[\]|]*\|)?([^\[\]|]*)\]\]')
FILE_LINK = re.compile(r'\[\[(?:File|Image|Category):[^\[\]]*(?:\[\[[^\[\]]*\]\][^\[\]]*)*\]\]', re.I)


def simple_line(raw):
    """A Simple Wiktionary definition line: its text, its labels and its synonyms (the {{syn|...}} it carries)."""
    labels, syns = [], []
    s = re.sub(r'<ref[^>]*/>|<ref[^>]*>.*?</ref>|<!--.*?-->', '', raw, flags=re.S)
    s = FILE_LINK.sub('', s)
    s = re.sub(r'(?<!\{)\{([A-Za-z][A-Za-z ]*)\}\}', r'{{\1}}', s)  # "{transitive}}": a template missing a brace

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
        # Only a definition that is itself a word or two (not the start of a longer one: "связанный, соотносящийся с ..." is
        # "related to", no hint).
        g = re.sub(r'\s*\(.*?\)', '', e['senses'][0][0]).strip().rstrip('.').strip()
        words = [fold(code, w) for w in WORD.findall(g)]
        if 0 < len(words) <= 2 and not re.search(r'[,;:]', g) and g[:1].islower() and all(easy(w) for w in words):
            return g
    return ''


def row(key, entry, hint):
    # Braces mark the labels in this file ({veraltet}gloss), so a label or a gloss never carries one where it would be read so.
    def sense(gloss, labels):
        labels = [x.strip('{} ') for x in labels if x.strip('{} ')]
        gloss = re.sub(r'^[{}\s]+', '', gloss)
        return ('{' + ', '.join(labels) + '}' if labels else '') + gloss
    senses = [sense(gloss, labels) for gloss, labels in entry['senses']]
    return '\t'.join([key, entry['pos'], hint] + senses)


def header(code, sources):
    when = datetime.date.today().isoformat()
    return [f'# LinguPengu {NAMES[code]} dictionary in {NAMES[code]}. From {sources}. Built {when}.',
            '# key\tpos\thint\tsenses...']


def write_lines(path, lines):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with gzip.open(path, 'wt', encoding='utf-8', compresslevel=9) as f:
        f.write('\n'.join(lines) + '\n')


# A part of speech the main dictionary names one way and a Wiktionary another: Spanish "su" is a determiner there and an
# adjective here, Russian "первый" an adjective and a numeral, German "nicht" an adverb and a particle. Only these: a proper
# noun is never the noun (Spanish "novia" is also a surname), nor a noun the pronoun (Russian "я" is also the letter).
SAME_POS = {
    'determiner': ('adjective', 'pronoun', 'article', 'numeral'),
    'pronoun': ('determiner', 'adjective'),
    'adjective': ('determiner', 'pronoun', 'numeral', 'verb'),
    'numeral': ('adjective', 'noun', 'determiner'),
    'adverb': ('particle', 'conjunction', 'pronoun', 'numeral'),
    'particle': ('adverb', 'interjection', 'conjunction'),
    'conjunction': ('adverb', 'particle'),
    'interjection': ('particle', 'phrase'),
    'preposition': ('contraction', 'particle', 'adverb', 'conjunction'),
    'contraction': ('preposition', 'abbreviation', 'article'),
    'article': ('determiner',),
}


def as_main_pos(found, poses):
    """`found` with a copy of an entry under the main dictionary's name for its part of speech (SAME_POS), for each part of
    speech the main dictionary has and the Wiktionary names otherwise."""
    have = {e['pos'] for e in found}
    extra = []
    for p in sorted(poses):
        if p in have:
            continue
        for alt in SAME_POS.get(p, ()):
            e = next((x for x in found if x['pos'] == alt and alt not in poses), None)
            if e:
                extra.append(dict(e, pos=p))
                break
    return found + extra


def order_entries(found, poses):
    """The main dictionary's parts of speech first, in its order of commonness, each once (two of a part merged)."""
    merged = collections.OrderedDict()
    found = as_main_pos(found, poses)
    for e in found:
        m = merged.get(e['pos'])
        if m is None:
            merged[e['pos']] = {'pos': e['pos'], 'senses': list(e['senses']), 'syn': list(e['syn']),
                                'first_syn': list(e.get('first_syn') or []), 'written': e.get('written')}
        else:
            m['senses'].extend(x for x in e['senses'] if len(m['senses']) < MAX_SENSES and x not in m['senses'])
            m['syn'].extend(e['syn'])
    # A meaning written for the app is for the part of speech the card's entry has, which the main dictionary's rows may not
    # name (German "lieben" as an adjective is its participle's).
    have = [e for e in merged.values() if e['pos'] in poses or e.get('written')]
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

    written = written_entries('en')
    lines = []
    phrases = phrase_keys('en')
    for norm, key in phrases.items():
        found = [e for w in (key, norm) for e in simple.get(w, []) if e['senses']]
        if found:
            lines.extend(row(key, dict(e, pos='phrase'), '') for e in order_entries(found, set())[:1])
    for key in rank:
        found = entries_for(key) or written.get(key)
        if not found:
            continue
        ordered = order_entries(found, poses[key])
        hint = pick_hint('en', key, ordered, rank, poses)
        lines.extend(row(key, e, hint) for e in ordered)
    write_lines(os.path.join(DATA, 'en', 'native.tsv.gz'),
                header('en', 'Simple English Wiktionary and English Wiktionary (CC BY-SA 4.0, English Wiktionary via kaikki.org)'
                       + (WRITTEN_NOTE if written else '')) + lines)
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
    ] + ([WRITTEN_SOURCE] if written else []))


# A meaning that only names the verb a participle is of ("Participio de unir.", "participio passato di unire").
PARTICIPLE = re.compile(r"^(?:participio(?: passato| presente)?|particípio(?: passado| presente)?|participe (?:passé|présent))"
                        r"(?: (?:masculin|singulier|masculino|singular|maschile|singolare))* (?:de|di|du|d['’]) ?([^\W\d_]+)\.?$", re.I)


def pointer_of(rec):
    """(note, word) when every meaning of a kaikki entry only says it is a form of one word ("Forma del femenino singular de
    hijo.", "femminile di figlio", "Participio de unir."): the note, cleaned, and that word."""
    note, target = None, None
    for s in rec['s']:
        g = clean(s['g'][-1]) if s.get('g') else ''
        words = s.get('fo') or s.get('ao') or []
        m = PARTICIPLE.match(g) if not words else None
        words = words or ([m.group(1)] if m else [])
        if not words or not g:
            return None
        if target is None:
            note, target = g, words[0]
        elif words[0] != target:
            return None
    return (note, target) if target else None


def pointed(note, base, pos):
    """A form's entry: the note of what it is, then its word's first meanings in the same part of speech (else its first)."""
    same = [b for b in base if b['pos'] == pos] or base
    meant = [x for x in (same[0]['senses'] if same else []) if x[0] != note][:POINTED_SENSES]
    return {'pos': pos, 'senses': [(note, [])] + meant, 'syn': []} if meant else None


POINTED_SENSES = 3
USED_AS_NOUN = re.compile(r'(?:sustantiv|substantiv|sostantiv)', re.I)


def build_edition(code):
    rank, poses = main_dictionary(code)
    phrases = phrase_keys(code)
    found = collections.defaultdict(list)
    # Every entry by its word, for the word a form points at (hija: hijo), and the forms that only point (hija, unido).
    by_word = collections.defaultdict(list)
    pointers = collections.defaultdict(list)
    n = kept = 0
    for e in cjk_entries(code):
            n += 1
            word = fold(code, e.get('word'))
            rec = slim_sense_entry(e)
            ptr = rec and POS.get(rec.get('p')) and pointer_of(rec)
            entry = None if ptr else rec and kaikki_entry(rec, edition_labels)
            if entry:
                by_word[word].append(entry)
            # An adjective's meanings that are also a noun's (Spanish "enemigo", "vecino": "se usa también como sustantivo").
            noun = rec and rec.get('p') == 'adj' and [x for x in rec['s'] if 'noun' in (x.get('t') or [])
                                                       or any(USED_AS_NOUN.search(t) for t in x.get('rt') or [])]
            noun = noun and kaikki_entry(dict(rec, p='noun', s=noun), edition_labels)
            if noun:
                by_word[word].append(noun)
            key = word
            if key not in rank:
                key = phrases.get(phrase_norm(code, e.get('word') or ''))
                if not key or ' ' not in key:
                    continue
            if entry:
                found[key].append(entry)
                kept += 1
                if noun:
                    found[key].append(noun)
            elif ptr and key in rank:
                pointers[key].append((POS[rec['p']], *ptr))
    # Meanings written for the app, for the common words Wiktionary leaves without one (and for the words forms point at).
    written = written_entries(code)
    for key, entries in written.items():
        by_word[key].extend(entries)
        have = {e['pos'] for e in as_main_pos(found.get(key, []), poses.get(key, set()))}
        found[key].extend(e for e in entries if e['pos'] not in have)
    n_pointed = 0
    for key, ptrs in pointers.items():
        have = {e['pos'] for e in as_main_pos(found.get(key, []), poses[key])}
        for pos, note, target in ptrs:
            if pos in have:
                continue
            e = pointed(note, by_word.get(fold(code, target), []), pos)
            if e:
                found[key].append(e)
                have.add(pos)
                n_pointed += 1
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
    sources = f'{NAMES[code]} Wiktionary (CC BY-SA 4.0, via kaikki.org)' + (WRITTEN_NOTE if written else '')
    write_lines(os.path.join(DATA, code, 'native.tsv.gz'), header(code, sources) + lines)
    print(f'{code}: read {n} entries, kept {kept}, {n_pointed} forms pointed at their word, {len(written)} written; wrote '
          f'public/data/{code}/native.tsv.gz: {len(lines)} entries for {len(found)} of {len(rank)} words')
    update_meta(code, len(lines), [{'name': f'{NAMES[code]} Wiktionary (via kaikki.org)', 'license': 'CC BY-SA 4.0',
                                    'url': f'https://kaikki.org/{code}wiktionary/'}] + ([WRITTEN_SOURCE] if written else []))


# ------------------------------------------------------------------------------------------- meanings written here ---
#
# scripts/lang/native/written/<id>.tsv: meanings written for LinguPengu, in plain words, for the words a reader meets most
# (every word with a level: the 20,000 commonest, the HSK and JLPT lists) that Wiktionary leaves without one. One line per
# word and part of speech, as native.tsv.gz has them without the hint: key, part of speech (empty for Chinese and Japanese,
# which are keyed by traditional spelling and by JMdict spelling), then the meanings ("{label}meaning"). Wiktionary's meanings
# win wherever it has the word: these only fill what it leaves, except a Chinese or Japanese line whose part of speech is "!",
# which takes the place of Wiktionary's entry for the word.

WRITTEN = os.path.join(ROOT, 'scripts', 'lang', 'native', 'written')
WRITTEN_NOTE = ' and meanings written for LinguPengu'
WRITTEN_SOURCE = {'name': 'Meanings written for LinguPengu where Wiktionary has none', 'license': 'CC BY-SA 4.0',
                  'url': 'https://github.com/HenryYHong/dushu/tree/main/scripts/lang/native/written'}


def written_entries(code):
    """written/<code>.tsv by key: [{'pos', 'senses', 'syn'}]."""
    out = collections.defaultdict(list)
    path = os.path.join(WRITTEN, f'{code}.tsv')
    if not os.path.exists(path):
        return out
    with open(path, encoding='utf-8') as f:
        for line in f:
            line = line.rstrip('\n')
            if not line.strip() or line.startswith('#'):
                continue
            c = line.split('\t')
            senses = []
            for cell in c[2:]:
                m = re.match(r'^\{([^}]*)\}', cell)
                gloss = (cell[m.end():] if m else cell).strip()
                if gloss and len(senses) < MAX_SENSES:
                    senses.append((gloss, [x.strip() for x in m.group(1).split(',') if x.strip()] if m else []))
            if senses:
                out[c[0]].append({'pos': c[1], 'senses': senses, 'syn': [], 'written': True})
    return out


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
#        spelling at it ("たべるの漢字表記"); an entry is keyed by its word and the kanji forms it lists (受（け）取る: both
#        受け取る and 受取る). Under its kana word, a line's part-of-speech column names those kanji ("=息" and "=粋" are two
#        lines under いき), so the app takes a word in kanji by its reading only from the entries that are that word
#        (ownDictionary.ts japaneseOwn: 行き is neither). A reading note that opens a meaning ("（ねこ、ネコ）") is dropped.
#        Writes public/data/ja/native.tsv.gz.
#   zh   CC-CEDICT's traditional and simplified words (cedict.tsv.gz). Chinese Wiktionary files words under their traditional
#        spelling with definitions in traditional characters; the app shows them in the reader's script. Writes
#        public/data/native.tsv.gz (the Chinese library's data is data/ itself).

CJK_SENSES = 8
# A meaning that only says the word is a form of another (「ふるう」の連用形): the main dictionary reads forms itself.
FORM_NOTE = re.compile(r'^「[^」]+」の(?:連用形|未然形|連体形|終止形|仮定形|命令形|已然形|語幹)')


def optional_kana(form):
    """A kanji spelling with the kana Japanese Wiktionary marks optional, both ways: 受（け）取る is 受け取る and 受取る."""
    m = re.search(r'[（(]([^（）()]*)[）)]', form)
    if not m:
        return {form}
    return optional_kana(form[:m.start()] + m.group(1) + form[m.end():]) | optional_kana(form[:m.start()] + form[m.end():])


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
# Chinese Wiktionary's page for a variant only points at the character it is a variant of: "關於「㕑」的發音和釋義，請見「廚」。
# （此字是「廚」的異體字。）". The variant gets that character's meanings, after a note of what it is to it (「廚」的異體字).
POINTER = re.compile(r'關於「[^」]+」的發音和釋義，請見「([^」（]+)(?:（.*?）)?」。\s*(?:（此[字詞]是(.+?)。）)?')


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


def merge_senses(entries):
    """Each entry's first meaning, then each one's second, and so on: a character's entries are its etymologies (了 to finish,
    了 the particle), and the first one alone would fill the list."""
    merged = []
    for i in range(max((len(e['senses']) for e in entries), default=0)):
        for e in entries:
            if i < len(e['senses']) and e['senses'][i] not in merged:
                merged.append(e['senses'][i])
    return merged


def cjk_entries(code):
    """The language's own entries in its Wiktionary, from kaikki.org's extract (a stream of every language's entries there,
    gigabytes). The first run keeps the fields used here at .cache/raw/kaikki-<code>-slim.jsonl.gz; later runs read that."""
    slim = os.path.join(ROOT, '.cache', 'raw', f'kaikki-{code}-slim.jsonl.gz')
    if os.path.exists(slim):
        with gzip.open(slim, 'rt', encoding='utf-8') as f:
            for line in f:
                yield json.loads(line)
        return
    keep_sense = ('glosses', 'tags', 'raw_tags', 'form_of', 'alt_of')
    tmp = slim + '.part'
    os.makedirs(os.path.dirname(slim), exist_ok=True)
    url = f'https://kaikki.org/{code}wiktionary/raw-wiktextract-data.jsonl.gz'
    with kaikki.open_url(url) as res, gzip.open(res, 'rt', encoding='utf-8') as f, gzip.open(tmp, 'wt', encoding='utf-8') as out:
        for line in f:
            if not line.startswith('{'):
                continue
            try:
                e = json.loads(line)
            except json.JSONDecodeError:
                continue
            if e.get('lang_code') != code:
                continue
            e = {'word': e.get('word'), 'lang_code': code, 'pos': e.get('pos'),
                 'forms': [{'form': fm.get('form'), 'tags': fm.get('tags')} for fm in e.get('forms') or [] if 'kanji' in (fm.get('tags') or [])],
                 'senses': [{k: sn[k] for k in keep_sense if sn.get(k)} for sn in e.get('senses') or []]}
            out.write(json.dumps(e, ensure_ascii=False) + '\n')
            yield e
    os.replace(tmp, slim)


def build_cjk(code):
    keys = cjk_keys(code)
    found = collections.defaultdict(list)
    # Japanese: entries by their kana word (with their part of speech and kanji spellings), and the kanji pages that only point
    # at a kana word (古い: "ふるいの漢字表記"), to key each kanji spelling under the right one of its reading's words.
    by_kana = collections.defaultdict(list)
    points = collections.defaultdict(set)
    variant_of = collections.defaultdict(list)
    n = kept = 0
    for e in cjk_entries(code):
            n += 1
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
                if code == 'zh' and POINTER.search(sn['glosses'][-1]):
                    for m in POINTER.finditer(sn['glosses'][-1]):
                        note = m.group(2) or f'見「{m.group(1)}」'
                        if (m.group(1), note) not in variant_of[e.get('word') or '']:
                            variant_of[e.get('word') or ''].append((m.group(1), note))
                    continue
                gloss = clean(READING_NOTE.sub('', sn['glosses'][-1]))
                if FORM_NOTE.match(gloss):
                    continue
                if gloss and len(gloss) > 1 and gloss not in [g for g, _ in senses] and len(senses) < MAX_SENSES:
                    senses.append((gloss, edition_labels({'rt': sn.get('raw_tags') or []})))
            if not senses:
                continue
            word = e.get('word') or ''
            kanji = sorted({k for fm in e.get('forms') or [] if 'kanji' in (fm.get('tags') or []) and fm.get('form')
                            for k in optional_kana(fm['form'])})
            if code == 'ja':
                by_kana[word].append({'pos': e.get('pos') or '', 'kanji': set(kanji), 'senses': senses})
            spellings = [word] + kanji
            for w in dict.fromkeys(spellings):
                if w in keys:
                    # Under its kana word, the kanji it is written with: the app takes a word's meanings by its reading only from
                    # the entries that are that word (いき 息 and 粋 are not 行き).
                    found[w].append({'pos': '', 'senses': senses, 'syn': [], 'kanji': kanji if w == word and code == 'ja' else []})
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
    # Meanings written for the app (keyed by traditional spelling, and by JMdict spelling), where Wiktionary has none: before the
    # variants, so a simplified spelling that points at its traditional one (国: 國) gets them too.
    written = written_entries(code)
    for key, entries in written.items():
        if key not in found or any(e['pos'] == '!' for e in entries):
            found[key] = [{'pos': '', 'senses': e['senses'], 'syn': []} for e in entries]
    # A Chinese variant: after any meanings of its own, for each character it points at a note of what it is to it, then that
    # character's first meanings (as many as fit: 〇 points at 零, 空 and 星).
    variants = {}
    for word, targets in variant_of.items():
        if word not in keys:
            continue
        each = max(1, (CJK_SENSES - len(targets)) // len(targets))
        block = []
        for target, note in targets:
            meant = merge_senses(found.get(target, []))
            block += [(clean(note), [])] + meant[:each]
        # A note alone (国 points at 國, which has no meanings here) says nothing of the meaning: the app's own dictionary does.
        if len(block) > len(targets) or found.get(word):
            variants[word] = block
        kept += 1
    lines = []
    for key in sorted(set(found) | set(variants)):
        # Japanese: one line for each set of kanji a kana word's entries name ("=息" and "=粋" under いき), in the part-of-speech
        # column, which Japanese does not use otherwise.
        groups = collections.OrderedDict()
        for e in found.get(key, []):
            groups.setdefault(tuple(e.get('kanji') or ()), []).append(e)
        for kanji, entries in (groups.items() or [((), [])]):
            merged = merge_senses(entries)
            if not kanji:
                merged += [x for x in variants.get(key, []) if x not in merged]
            if merged:
                lines.append(row(key, {'pos': '=' + ','.join(kanji) if kanji else '', 'senses': merged[:CJK_SENSES]}, ''))
    out = os.path.join(DATA, 'native.tsv.gz') if code == 'zh' else os.path.join(DATA, code, 'native.tsv.gz')
    write_lines(out, header(code, f'{NAMES[code]} Wiktionary (CC BY-SA 4.0, via kaikki.org)' + (WRITTEN_NOTE if written else '')) + lines)
    print(f'{code}: read {n} entries, kept {kept}, {len(written)} written; wrote {os.path.relpath(out, ROOT)}: {len(lines)} words of {len(keys)}')
    update_meta(code, len(lines), [{'name': f'{NAMES[code]} Wiktionary (via kaikki.org)', 'license': 'CC BY-SA 4.0',
                                    'url': f'https://kaikki.org/{code}wiktionary/'}] + ([WRITTEN_SOURCE] if written else []))


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
