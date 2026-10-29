#!/usr/bin/env python3
"""Build Dushu's dictionary for a spaced language from English Wiktionary (via kaikki.org) and FrequencyWords.

    python3 scripts/lang/wikt/build.py es                 # -> public/data/es/
    python3 scripts/lang/wikt/build.py es fr de it pt ru
    python3 scripts/lang/wikt/build.py es --extract X.jsonl.gz --freq Y.txt   # from a saved slim extract (kaikki.py)

Standard library only. The kaikki dump (60-100 MB gzipped, a gigabyte as JSON) is streamed off the network and never
saved; see kaikki.py.

What it writes to public/data/<id>/ (the engine in src/lang/spaced/ reads it; the two must agree):

  entries.tsv.gz   one line per dictionary entry (one Wiktionary section: a headword with one part of speech):
                   key, head, reading, pos, gender, rank, paradigm, flags, hint, then one column per sense.
                   key     the headword folded for matching (fold() below; foldKey() in the engine)
                   head    the headword as written, when it differs from the key (Haus keeps its capital in the key too;
                           всё has the key все)
                   reading Russian: the headword with its stress marked (сказа́ть); else empty
                   rank    the key's frequency rank among lemmas (1 = commonest), empty when unranked; on every entry of
                           the key
                   paradigm  index into the paradigm lines of forms.tsv.gz, empty when the word has no other forms
                   flags   'w' when every sense is archaic, obsolete, rare or dialectal (it never leads its key)
                   hint    a short gloss for running text ("house", "to go")
                   sense   "{note, note}gloss|gloss": notes in braces, then glosses separated by |
  forms.tsv.gz     the inflected forms of every entry, stored as suffix rules so a regular verb's sixty forms cost
                   one shared line:
                   D <text>                   a form description ("first-person plural preterite indicative")
                   R <removed> <added>        a rule: drop <removed> from the end of the key, add <added>
                   P <token> <token> ...      a paradigm: tokens "rule.desc" (Russian "rule.desc.stress", stress being
                                              the stressed vowel's offset from where the rule cut the word)
                   H <form> <hint>            the hint of one form where its lemma's would mislead (hay "there is")
                   Lines of each kind are numbered from 0 in file order.
  prior.tsv.gz     for words the dictionary reads several ways, how often hand-annotated text means each:
                   form, then "entry:percent" cells (entry = line number in entries.tsv.gz, comments not counted)
  meta.json        build date, counts, sources and licences.

Rules are found on folded strings: the engine folds a word on the page the same way, cuts it at every point, and asks
which rules add what follows the cut; the key is what precedes the cut plus what the rule removed. Nothing needs to
be expanded into a table of a million forms in the browser.
"""
import collections
import datetime
import gzip
import json
import math
import os
import re
import sys
import time
import unicodedata

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kaikki  # noqa: E402
import ud  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
OUT_ROOT = os.path.join(ROOT, 'public', 'data')

LANGS = {
    'es': {'name': 'Spanish', 'freq': 'es'},
    'fr': {'name': 'French', 'freq': 'fr'},
    'de': {'name': 'German', 'freq': 'de', 'keep_case': True},
    'it': {'name': 'Italian', 'freq': 'it'},
    'pt': {'name': 'Portuguese', 'freq': 'pt'},
    'ru': {'name': 'Russian', 'freq': 'ru', 'stress': True},
}

FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/{c}/{c}_full.txt'
EN_FREQ_URL = 'https://raw.githubusercontent.com/hermitdave/FrequencyWords/master/content/2018/en/en_50k.txt'

# ----------------------------------------------------------------------------------------------------- folding ---

ACCENTS = re.compile('[̀́]')
APOSTROPHES = re.compile('[’ʼ‘`´]')


def fold(code, s):
    """The matching key. Must agree with foldKey() in src/lang/spaced/core.ts.

    Romance languages: lower case, accents kept (está is not esta). German keeps case (Essen the meal is not essen
    to eat). Russian: lower case, stress marks dropped, ё read as е (books print both).
    """
    s = unicodedata.normalize('NFC', s or '').strip()
    s = APOSTROPHES.sub("'", s)
    if code == 'ru':
        s = unicodedata.normalize('NFD', s.lower())
        s = ACCENTS.sub('', s)
        return unicodedata.normalize('NFC', s).replace('ё', 'е')
    if LANGS[code].get('keep_case'):
        return s
    return s.lower()


def stress_index(code, written):
    """Russian: the index (in the folded word) of the stressed vowel, -1 when the spelling does not mark it."""
    if code != 'ru':
        return -1
    n = 0
    acute = yo = -1
    for ch in unicodedata.normalize('NFD', written.lower()):
        if ch == '́':
            if n and acute < 0:
                acute = n - 1
        elif ch == '̈':  # ё is е + diaeresis in NFD, and always stressed
            if n and yo < 0:
                yo = n - 1
        elif ch != '̀':
            n += 1
    return acute if acute >= 0 else yo


RU_VOWELS = set('аеёиоуыэюя')


def vowel_count(s):
    return sum(1 for ch in s.lower() if ch in RU_VOWELS)


# ------------------------------------------------------------------------------------------------ descriptions ---

# Tags that say nothing a learner needs about which form this is, or that the description says another way.
DROP_TAGS = {
    'form-of', 'alt-of', 'canonical', 'table-tags', 'inflection-template', 'class', 'romanization', 'multiword-construction',
    'with-tú', 'with-vos', 'with-usted', 'with-ustedes', 'auxiliary', 'strong', 'weak', 'mixed', 'definite', 'indefinite',
    'without-article', 'with-article', 'subordinate-clause', 'perfective', 'imperfective', 'animate', 'inanimate',
    'predicative', 'error-unknown-tag', 'error-unrecognized-form', 'error-lua-exec', 'transitive', 'intransitive',
    'abbreviation', 'common', 'also', 'usually', 'sometimes', 'especially', 'Traditional', 'traditional', 'by-personal-gender',
    'positive', 'combined-form', 'personal', 'pronoun', 'determiner', 'noun', 'adverb', 'adjective', 'verb',
    'second-person-semantically', 'formal-second-person', 'informal',
}
# Tags of rows that are other words (derived nouns, diminutives) or not a single written form at all.
SKIP_ROW_TAGS = {
    'combined-form', 'multiword-construction', 'error-unrecognized-form', 'diminutive', 'augmentative', 'pejorative',
    'endearing', 'relational', 'abstract-noun', 'noun-from-verb', 'adjective', 'adverb', 'demonym', 'possessive',
    'nomen-agentis', 'auxiliary', 'romanization', 'transliteration', 'canonical', 'perfective', 'imperfective', 'noun',
    'collective', 'feminine-counterpart', 'masculine-counterpart', 'verbal-noun', 'agent', 'feminine-noun', 'male',
    'female', 'clipping', 'error-unknown-tag', 'hypercorrect',
}

DIMENSIONS = [
    ('person', ['first-person', 'second-person', 'third-person', 'impersonal']),
    ('case', ['nominative', 'genitive', 'dative', 'accusative', 'instrumental', 'prepositional', 'locative', 'vocative',
              'partitive']),
    ('gender', ['masculine', 'feminine', 'neuter']),
    ('number', ['singular', 'plural']),
    ('degree', ['comparative', 'superlative']),
    ('tense', ['present', 'imperfect', 'preterite', 'historic', 'past', 'pluperfect', 'future', 'conditional']),
    ('mood', ['indicative', 'subjunctive', 'subjunctive-i', 'subjunctive-ii', 'imperfect-se', 'imperative', 'negative']),
    ('voice', ['reflexive', 'active', 'passive', 'adverbial']),
    ('nonfinite', ['infinitive', 'infinitive-zu', 'gerund', 'participle', 'short-form', 'long-form', 'personal-infinitive']),
]
DIM_OF = {t: d for d, ts in DIMENSIONS for t in ts}
# (dimension, place within it): values of one dimension sort in the order DIMENSIONS lists them (first/third-person,
# never third/first), whatever order a set hands them over in, so two builds of the same input write the same bytes.
ORDER = {t: (i, j) for i, (_, ts) in enumerate(DIMENSIONS) for j, t in enumerate(ts)}
WORDS = {
    'historic': 'past historic', 'subjunctive-i': 'subjunctive I', 'subjunctive-ii': 'subjunctive II',
    'imperfect-se': '(-se form)', 'short-form': 'short form', 'long-form': 'long form', 'adverbial': 'adverbial',
    'infinitive-zu': 'zu-infinitive', 'negative': 'negative', 'personal-infinitive': 'personal infinitive',
}
# Register tags kept as a word in parentheses after the description.
QUALIFIER_TAGS = ['archaic', 'obsolete', 'dated', 'rare', 'nonstandard', 'colloquial', 'poetic', 'literary',
                  'proscribed', 'dialectal', 'regional', 'uncommon', 'vos-form', 'formal', 'apocopic', 'alternative',
                  'misspelling', 'pronunciation-spelling', 'Brazil', 'Portugal', 'Spain', 'Latin-America', 'Switzerland',
                  'Austria']


def describe(tags):
    """A description in Wiktionary's own word order: person, case, gender, number, tense, mood ("first-person plural
    preterite indicative", "genitive singular", "feminine singular past")."""
    tags = set(tags)
    formal = 'second-person-semantically' in tags or ('formal' in tags and 'imperative' in tags)
    if 'second-person-semantically' in tags:
        tags.discard('third-person')
        tags.add('second-person')
    if 'historic' in tags:
        tags.discard('past')
    if 'imperfect-se' in tags:
        tags.discard('imperfect')
    if 'masculine' in tags and 'feminine' in tags:
        # Every gender is no gender: сказали is "plural past", not "masculine/feminine/neuter plural past".
        tags -= {'masculine', 'feminine', 'neuter'}
    # Tags that say one thing twice: kaikki tags a French present participle (dormant) gerund + participle + present, a
    # German Konjunktiv I subjunctive + subjunctive-i, a zu-infinitive infinitive + infinitive-zu.
    if 'participle' in tags:
        tags.discard('gerund')
    if 'subjunctive-i' in tags or 'subjunctive-ii' in tags:
        tags.discard('subjunctive')
    if 'infinitive-zu' in tags:
        tags.discard('infinitive')
    if 'gerund' in tags and 'neuter' in tags:
        return 'verbal noun'                 # German das Sehen, das Bitten: kaikki's "neuter gerund"
    words = []
    core = sorted((t for t in tags if t in ORDER), key=lambda t: ORDER[t])
    # Two values of one dimension in one cell ("first/third-person singular", "nominative/accusative plural",
    # "masculine/neuter genitive").
    by_dim = collections.OrderedDict()
    for t in core:
        if t == 'imperfect-se':
            continue
        by_dim.setdefault(DIM_OF[t] if DIM_OF[t] in ('person', 'case', 'gender', 'number') else t, []).append(t)
    for dim, ts in by_dim.items():
        if dim == 'person' and len(ts) > 1:
            words.append('/'.join(t.replace('-person', '') for t in ts) + '-person')
        else:
            words.append('/'.join(WORDS.get(t, t) for t in ts))
    if 'imperfect-se' in tags:
        words.insert(words.index('subjunctive') if 'subjunctive' in words else len(words), 'imperfect')
        words.append('(-se form)')
    if 'negative' in tags and 'imperative' in tags:
        words = [w for w in words if w != 'negative']
        words.insert(words.index('imperative'), 'negative')
    text = ' '.join(words)
    if formal:
        text = 'formal ' + text
    quals = [q.replace('-', ' ') for q in QUALIFIER_TAGS if q in tags and q not in ('formal', 'alternative', 'apocopic')]
    if 'apocopic' in tags:
        text = (text + ' apocopic form').strip()
    if not text:
        text = 'alternative form' if 'alternative' in tags or quals else ''
    if quals:
        text = (text + ' (' + ', '.join(quals) + ')').strip()
    return text.strip()


def merge_descriptions(tagsets):
    """One description for a form that fills several cells of a table: "first/third-person singular imperfect
    indicative", "nominative/accusative plural". Cells that differ in more than one way collapse to what they share."""
    sets = []
    for ts in tagsets:
        s = set(t for t in ts if t not in DROP_TAGS or t in ('second-person-semantically',))
        if 'masculine' in s and 'feminine' in s:
            s -= {'masculine', 'feminine'}
        s = frozenset(s)
        if s not in sets:
            sets.append(s)
    # A head-line row ("first-person singular preterite") and its table cell (the same, "indicative") are one cell; the
    # shorter says it with fewer words ("past participle" over "masculine singular past participle").
    sets = [s for s in sets if not any(o < s for o in sets)]
    if not sets:
        return ''
    if len(sets) == 1:
        return describe(sets[0])
    common = frozenset.intersection(*sets)
    rest = [s - common for s in sets]
    dims = {DIM_OF.get(t, t) for r in rest for t in r}
    if len(dims) == 1 and all(len(r) == 1 for r in rest):
        dim = next(iter(dims))
        vals = sorted({next(iter(r)) for r in rest}, key=lambda t: ORDER.get(t, (99,)))
        if dim == 'gender' and {'masculine', 'feminine'} <= set(vals):
            return describe(common) or 'inflected form'
        if dim in ('person', 'case', 'gender', 'number'):
            joined = '/'.join(v.replace('-person', '') for v in vals) + ('-person' if dim == 'person' else '')
            base = describe(common | {vals[0]})
            first = WORDS.get(vals[0], vals[0])
            return base.replace(first, joined, 1)
    # French accepte, Spanish ame fill five cells: cells that differ only in person merge, then those that differ only
    # in indicative/subjunctive ("first/third-person singular present indicative/subjunctive; second-person singular
    # imperative"), rather than collapse to "singular inflected form".
    grouped = merge_cells(sets)
    if 1 <= len(grouped) <= 3 and sum(len(d) for d in grouped) < 140:
        return '; '.join(grouped)
    shared = describe(common)
    return shared if shared and shared not in ('singular', 'plural') else (shared + ' inflected form').strip()


def merge_cells(sets):
    """Descriptions for a form's cells, cells that differ only in person merged, then cells that differ only in being
    indicative or subjunctive."""
    persons = collections.OrderedDict()            # the cell without its person -> {person}
    for s in sets:
        rest = frozenset(t for t in s if DIM_OF.get(t) != 'person')
        persons.setdefault(rest, set()).update(t for t in s if DIM_OF.get(t) == 'person')
    moods = collections.OrderedDict()              # (cell without its mood, persons) -> [mood]
    for rest, ps in persons.items():
        mood = rest & {'indicative', 'subjunctive'}
        if len(mood) == 1 and not rest & {'subjunctive-i', 'subjunctive-ii', 'imperfect-se', 'imperative'}:
            moods.setdefault((rest - mood, frozenset(ps)), []).append(next(iter(mood)))
        else:
            moods.setdefault((rest, frozenset(ps)), []).append(None)
    out = []
    for (rest, ps), ms in moods.items():
        ms = [m for m in ms if m]
        if not ms:
            d = describe(rest | ps)
        else:
            d = describe(rest | ps | {ms[0]})
            if len(set(ms)) > 1:
                d = d.replace('indicative', 'indicative/subjunctive', 1)
        if d and d not in out:
            out.append(d)
    return out


# ------------------------------------------------------------------------------------------------------ senses ---

SKIP_POS = {'prefix', 'suffix', 'infix', 'circumfix', 'interfix', 'affix', 'character', 'symbol', 'punct',
            'romanization', 'syllable', 'combining_form', 'letter', 'prep_phrase', 'proverb', 'phrase'}
POS_NAMES = {
    'noun': 'noun', 'verb': 'verb', 'adj': 'adjective', 'adv': 'adverb', 'pron': 'pronoun', 'prep': 'preposition',
    'postp': 'postposition', 'conj': 'conjunction', 'det': 'determiner', 'article': 'article', 'particle': 'particle',
    'intj': 'interjection', 'num': 'numeral', 'name': 'proper noun', 'contraction': 'contraction', 'adnominal': 'adnominal',
}
# Labels in front of a gloss that are grammar a reader of a novel does not need in the popup.
DROP_LABELS = {
    'transitive', 'intransitive', 'ambitransitive', 'ditransitive', 'transitive or intransitive', 'relational', 'countable',
    'uncountable', 'usually uncountable', 'not comparable', 'comparable', 'strong', 'weak', 'copulative', 'animate',
    'inanimate', 'etc.', 'also', 'mixed', 'with a', 'invariable', 'no plural', 'plural only', 'indeclinable',
    'transitive with dative', 'transitive with accusative', 'intransitive with dative',
}
LABEL_FIX = {'figuratively': 'figurative', 'Internet slang': 'Internet slang', 'low colloquial': 'low colloquial'}
WEAK_LABELS = {'archaic', 'obsolete', 'dated', 'rare', 'historical', 'dialectal', 'regional', 'poetic', 'nonstandard',
               'uncommon', 'proscribed', 'obsolete spelling', 'archaic spelling'}
# A sense that only points somewhere else (and would be junk shown as a meaning).
POINTER = re.compile(
    r'^(?:(?:obsolete|archaic|dated|rare|nonstandard|alternative|informal|colloquial|eye[- ]dialect|pronunciation|'
    r'apocopic|apocopated|elided|contracted|superseded|deprecated|standard|uncommon|regional|dialectal|prevocalic|'
    r'obsolete typographic|misspelt|common|less common|euphemistic|clipped|ellipsis|abbreviated)\s*,?\s*)*'
    r'(?:form|spelling|variant|misspelling|abbreviation|initialism|acronym|clipping|contraction|ellipsis|'
    r'synonym|diminutive|augmentative|plural|feminine|masculine|inflection|letter-case form|typography)s? of\b', re.I)
COMPOUND_OF = re.compile(r'^compound of\b', re.I)
# Words a gloss is made of when it only says which form of another word this is: "first-person plural present
# indicative/present subjunctive of potere", "genitive masculine/neuter singular of der", "Old Italian form of quegli",
# "preconsonantal masculine singular form of bello", "truncation of nei", "accented form of cuan".
GRAMMAR_WORDS = set('''
    singular plural dual masculine feminine neuter common nominative genitive dative accusative instrumental prepositional
    locative vocative partitive present past future preterite imperfect perfect pluperfect conditional indicative
    subjunctive imperative infinitive gerund participle supine active passive adverbial reflexive short long strong weak
    mixed comparative superlative positive definite indefinite inflected inflection form forms spelling variant
    alternative archaic obsolete dated rare nonstandard literary poetic old italian middle accented unaccented apocopic
    apocopated preconsonantal prevocalic elided truncated truncation contracted contraction diminutive augmentative
    clipping abbreviation historic i ii first second third pre-reform post-reform superseded pronunciation eye-dialect
    dialectal regional informal colloquial uncommon less standard euphemistic'''.split())


def grammar_pointer(g):
    """A gloss that is nothing but a description of which form of another word this is."""
    g = re.sub(r'\s*\([^()]*\)', '', g or '')     # "pre-reform spelling (used until 1990) of ótimo"
    m = re.match(r'^(.{3,90}?)\s+of\s+[^\s,;:()]+\s*\.?$', g)
    if not m:
        return False
    head = m.group(1).lower()
    words = [w for w in re.split(r'[\s/,]+', head) if w]
    return bool(words) and all(w in GRAMMAR_WORDS or re.fullmatch(r'(?:first|second|third)-person', w) for w in words) \
        and any(w not in ('first', 'second', 'third', 'i', 'ii') for w in words)


def is_pointer(g):
    return bool(POINTER.match(g or '') or grammar_pointer(g))
NO_GLOSS = re.compile(r'^\s*$')


def clean_gloss(g):
    g = re.sub(r'\s+', ' ', g or '').strip()
    g = g.replace('|', '/').replace('{', '(').replace('}', ')').replace('\t', ' ')
    g = re.sub(r'\s+,', ',', g)
    g = re.sub(r',\s*,', ',', g)
    g = re.sub(r'\(\s*\)', '', g).strip()
    return g


def labels_of(raw, gloss):
    """The usage labels Wiktionary wrote in front of a gloss: "(colloquial, Mexico) to go" -> ['colloquial', 'Mexico']."""
    out = []
    if not raw or not raw.startswith('('):
        return out
    depth = 0
    end = -1
    for i, ch in enumerate(raw):
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                end = i
                break
    if end < 0:
        return out
    rest = raw[end + 1:].strip()
    if gloss and not rest.startswith(gloss[:20]):
        return out
    for lab in re.split(r',\s*', raw[1:end]):
        lab = lab.strip()
        if not lab or lab in DROP_LABELS or len(lab) > 40:
            continue
        if re.match(r'^(class \d|\+|with |\[)', lab):
            continue
        out.append(LABEL_FIX.get(lab, lab))
    return list(dict.fromkeys(out))


HEADING = re.compile(r'^(?:[A-Z][a-z]+ )?(?:senses?|uses?|meanings?)\b[^.]{0,60}\.?$|^[^.]{0,40}\bsenses\.$', re.I)
TRANSLATED_AS = re.compile(r'(?:^|\.\s+)translated as ["“]([^"”]+)["”]', re.I)
MORE_QUOTED = re.compile(r'\s*(?:,\s*)?(?:or|and|/)\s*["“]([^"”]{1,30})["”]')
LETTER_NAME = re.compile(r'^(?:the )?(?:name of the )?(?:Latin|Cyrillic)[- ]script letter\b|^The (?:name of the )?letter\b', re.I)
# "accusative of ella ...; her, it, you (formal)", "apocopic form of le, la: the": a pointer with the meaning after it.
POINTER_TAIL = re.compile(r'^[^;:]*\bof\b[^;:]*[;:]\s*(.+)$')


def pointer_tail(gloss):
    """The meaning a pointer gloss gives after its pointer, when it gives one."""
    m = POINTER_TAIL.match(gloss or '')
    if not m:
        return ''
    tail = m.group(1).strip()
    if is_pointer(tail) or len(tail) < 2:
        return ''
    return tail


CONTRACTION = re.compile(r'^contraction of ([^;:,(“\'"]+?)\s*(?:[;:,]\s*(?:literally\s*)?(.*)|\((.*)\)|“(.*)”)?\s*\.?$', re.I)


def contraction_sense(gloss):
    """"contraction of a + el, literally “at the, to the”" -> (['contraction of a + el'], ['at the, to the'])."""
    m = CONTRACTION.match(gloss or '')
    if not m:
        return None
    pieces = m.group(1).strip()
    meaning = (m.group(2) or m.group(3) or m.group(4) or '').strip()
    meaning = re.sub(r'^[“"\']|[”"\']$', '', meaning)
    meaning = meaning.replace("' or '", ', ').replace('” or “', ', ')
    meaning = re.sub(r'[“”]', '', meaning).strip(' .')
    if not meaning or is_pointer(meaning):
        return None
    return ['contraction of ' + pieces.replace(' + ', ' + ')], [meaning]


def construction_note(raw):
    """"to have to [with que (+ infinitive)]" -> "with que + infinitive"."""
    m = re.search(r'\[([^\[\]]{2,60})\]\s*$', raw or '')
    if not m:
        return ''
    t = m.group(1).replace('(', '').replace(')', '').strip()
    t = re.sub(r'\s+', ' ', t)
    return t if re.match(r'^(?:with|\+|in|of|followed|after|before|usually|chiefly|often)\b', t) else ''


def sense_rows(code, senses):
    """The entry's real senses as (notes, glosses) pairs, nested subsenses grouped under the gloss they refine."""
    out = []
    for s in senses:
        tags = s.get('tags') or []
        gl = [clean_gloss(g) for g in (s.get('glosses') or [])]
        gl = [g for g in gl if g]
        if not gl:
            continue
        raw = s.get('raw_glosses') or []
        con = contraction_sense(gl[-1])
        if con:
            out.append([con[0] + labels_of(raw[-1] if raw else '', gl[-1]), con[1], None])
            continue
        if s.get('form_of') or s.get('alt_of') or 'form-of' in tags or 'alt-of' in tags or 'compound-of' in tags:
            tail = pointer_tail(gl[-1])
            if not tail or 'compound-of' in tags:
                continue
            out.append([labels_of(raw[-1] if raw else '', gl[-1]), [tail], None])
            continue
        if is_pointer(gl[-1]) or COMPOUND_OF.match(gl[-1]) or LETTER_NAME.match(gl[-1]):
            continue
        notes = labels_of(raw[-1] if raw else '', gl[-1])
        if s.get('qualifier') and s['qualifier'] not in notes and len(s['qualifier']) < 40:
            q = s['qualifier']
            if q not in DROP_LABELS:
                notes.append(q)
        cn = construction_note(raw[-1] if raw else '')
        if cn and cn not in notes:
            notes.append(cn)
        parent = gl[0] if len(gl) > 1 else None
        child = gl[-1]
        # Russian and German prepositions head their senses by case: "[with instrumental]" then "with". The heading is a
        # note on each sense under it, not a gloss (с would otherwise have no hint at all).
        bracket = re.match(r'^\[([^\[\]]{2,40})\]$', parent or '')
        if bracket:
            note = bracket.group(1).strip()
            if out and out[-1][2] == parent:
                if child not in out[-1][1]:
                    out[-1][1].append(child)
            else:
                out.append([notes + ([note] if note not in notes else []), [child], parent])
            continue
        # A parent that only points elsewhere ("apocopic form of suyo") or only heads a group ("Figurative senses.")
        # is not a meaning: the subsense stands alone.
        if parent and (is_pointer(parent) or HEADING.match(parent)):
            parent = None
        if parent and out and (out[-1][2] == parent or out[-1][1][0] == parent):
            # A subsense joins the sense it refines: "structure for public use" then its four kinds.
            prev = out[-1]
            extra = [n for n in dict.fromkeys(notes) if n not in prev[0]]
            text = '(' + ', '.join(extra) + ') ' + child if extra else child
            if text not in prev[1]:
                prev[1].append(text)
            continue
        if parent:
            # A parent that is only a heading ("used to form compound tenses...:") reads as one gloss with its child.
            if parent.endswith(':'):
                out.append([notes, [parent + ' ' + child], parent])
            else:
                out.append([notes, [parent, child], parent])
            continue
        out.append([notes, [child], None])
    rows = [(n, g) for n, g, _ in out]
    # Senses a reader of today rarely means (archaic, obsolete, rare) go after the rest, in their own order: partir is
    # "to leave" before the old "to share".
    return [r for r in rows if not set(r[0]) & WEAK_LABELS] + [r for r in rows if set(r[0]) & WEAK_LABELS]


# ------------------------------------------------------------------------------------------------------ gender ---

GENDER_RE = re.compile(r'^\S+(?: •\s*\([^)]*\))?\s+((?:m|f|n|mf|c)(?:\s+(?:or|and)\s+(?:m|f|n))?(?:\s+(?:inan|anim|pers))?'
                       r'(?:\s+(?:pl|sg))?)\b')


def gender_of(e, senses):
    """'m', 'f', 'n', 'm/f' or 'pl' for nouns, from the head line ("casa f (plural casas)") or the sense tags."""
    if e['p'] not in ('noun', 'name'):
        return ''
    for h in e.get('h') or []:
        x = h.get('x') or ''
        m = GENDER_RE.match(x)
        if m:
            g = m.group(1)
            parts = g.split()
            if 'pl' in parts and not any(p in ('m', 'f', 'n', 'mf') for p in parts[:1]):
                return 'pl'
            gs = [p for p in parts if p in ('m', 'f', 'n')]
            if 'mf' in parts:
                gs = ['m', 'f']
            if 'pl' in parts and len(gs) <= 1:
                return 'pl' if not gs else gs[0]
            if gs:
                return '/'.join(dict.fromkeys(gs))
    tags = collections.Counter()
    for s in senses:
        for t in s.get('tags') or []:
            if t in ('masculine', 'feminine', 'neuter', 'by-personal-gender', 'plural-only'):
                tags[t] += 1
    if tags.get('plural-only') and len(tags) == 1:
        return 'pl'
    if tags.get('by-personal-gender') or (tags.get('masculine') and tags.get('feminine')):
        return 'm/f'
    for t, g in (('masculine', 'm'), ('feminine', 'f'), ('neuter', 'n')):
        if tags.get(t):
            return g
    return ''


# -------------------------------------------------------------------------------------------------------- hints ---

HINT_SKIP = re.compile(r'^(?:used |indicates|expresses|denotes|marks |forms |an? (?:[a-z]+ )?particle|refers |generic |'
                       r'optional(?:ly)? |emphasi[sz]es|intensifies|the name of|the letter\b|introduces|serves|placed |'
                       r'only (?:used|in)\b|[\w\']+ \+ [\w\']+|'
                       r'[a-z ]+ (?:of|for) the [a-z]+ case)', re.I)
# A gloss that names the word's grammar instead of its meaning: "Third-person singular possessive determiner.",
# "first-person singular prepositional pronoun".
GRAMMAR_ONLY = re.compile(r'^[^:;]*\b(?:pronoun|determiner|particle|article|conjunction|preposition|suffix|prefix)\.?$', re.I)
DANGLING = {'of', 'the', 'a', 'an', 'and', 'or', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from'}


def clip(h, n=40, cut=False):
    """A hint at most n characters long, cut between words (never in one), without stray brackets and quotes; a hint
    that was cut (`cut`, or here for length) loses a dangling "of the"."""
    h = re.sub(r'\s+', ' ', h or '').strip(' .;:,')
    if len(h) > n:
        head = h[:n + 1]
        h = head[:head.rfind(' ')] if ' ' in head else ''
        cut = True
    words = h.split(' ')
    while cut and len(words) > 1 and words[-1].lower().strip(',;:') in DANGLING:
        words.pop()
    h = ' '.join(words).strip(' .;:,')
    for a, b in (('(', ')'), ('“', '”'), ('[', ']')):
        if h.count(a) != h.count(b):
            h = h.replace(a, '').replace(b, '')
    if h.count('"') % 2:
        h = h.replace('"', '')
    return h.strip(' .;:,')


def grammar_piece(p):
    return bool(GRAMMAR_ONLY.match(p) or (GRAMMAR_HEAD.search(p) and len(p.split()) >= 3))


def descriptive(g):
    return bool(HINT_SKIP.match(g) or is_pointer(g) or (GRAMMAR_ONLY.match(g) and ',' not in g))


# A long gloss is cut before these words rather than after the fourth ("to agree with each other" -> "to agree").
BREAKERS = {'with', 'for', 'on', 'in', 'at', 'by', 'to', 'that', 'which', 'who', 'as', 'about', 'from', 'into',
            'when', 'where', 'because', 'so', 'such', 'through'}
REFLEXIVE_NOTES = {'reflexive', 'pronominal', 'reflexive pronoun'}
GRAMMAR_HEAD = re.compile(r'\b(?:(?:first|second|third)-person|singular|plural|nominative|genitive|dative|accusative|'
                          r'pronoun|determiner|masculine|feminine|neuter|case)\b', re.I)
EN_RANK = {}          # English word -> rank (FrequencyWords en_50k), to choose the plainest synonym as a hint
EN_STOP = {'to', 'a', 'an', 'the', 'of', 'be', 'one', 'oneself', 'someone', 'something', 'sth', 'sb', 'or', 'and', 'in',
           'on', 'up', 'out', 'off', 'with', 'for', 'at', 'by', 'from', 'into'}


def strip_parens(g):
    while True:
        g2 = re.sub(r'\([^()]*\)', '', g)
        if g2 == g:
            break
        g = g2
    g = g.split('(')[0]
    g = re.sub(r'\[[^\]]*\]', '', g)
    g = re.sub(r'“[^”]*”', '', g)
    return re.sub(r'\s+', ' ', g).strip(' .;:,')


def plainness(part):
    """How plain an English gloss is: the rarest content word's rank (lower is plainer), long phrases worse."""
    words = [w for w in re.findall(r"[a-z']+", part.lower()) if w not in EN_STOP] or re.findall(r"[a-z']+", part.lower())
    if not words:
        return 10 ** 6
    worst = max(EN_RANK.get(w, 60000) for w in words)
    return worst * (1 + 0.6 * (len(part.split()) - 1))


def hint_of(glosses_list, head='', pos=''):
    """One short gloss for running text ("house", "to go"): from the first sense that has a plain one, the plainest of
    its synonyms ("to desire, to want" -> "to want"), parentheses and explanations dropped."""
    first_long = ''
    content = pos in ('verb', 'noun', 'adj', 'adv')
    for si, gl in enumerate(glosses_list[:4]):
        # The sense's first gloss, or the next when the first only describes the word ("Generic demonstrative pronoun.").
        for g in gl[:2]:
            m = TRANSLATED_AS.search(g)
            if m:
                # 'Translated as "this" or "that"' -> "this, that"; 'translated as "to like", analyzable as "to please"'
                # -> "to like" (only the quotes the clause joins with or/and).
                quoted = [m.group(1)]
                at = m.end()
                while (q := MORE_QUOTED.match(g, at)):
                    quoted.append(q.group(1))
                    at = q.end()
                return clip(', '.join(dict.fromkeys(quoted[:3])))
            g = strip_parens(g)
            # "second-person singular, nominative case: you, thou", "Emphasises identity: very, same": the grammar or a
            # description before the colon, the meaning after it; "in her: feminine singular" the other way round.
            head_, colon, tail = g.partition(':')
            tail = tail.strip(' .')
            if colon and tail and head_:
                head_grammar = bool(GRAMMAR_HEAD.search(head_) or descriptive(head_) or head_[:1].isupper())
                tail_grammar = bool(GRAMMAR_HEAD.search(tail) or descriptive(tail))
                if head_grammar and not tail_grammar:
                    g = tail
                elif tail_grammar and not head_grammar:
                    g = head_.strip(' .')
            if g and descriptive(g) and ';' in g:
                # "Used to call someone; hey": the description goes, the meaning after it stays.
                g = '; '.join(p.strip() for p in g.split(';') if p.strip() and not descriptive(p.strip()))
            if not g or descriptive(g):
                continue
            parts = []
            for seg in g.split(';'):
                pieces = [p.strip(' .') for p in re.split(r',\s+(?![^()]*\))', seg)]
                pieces = [p for p in pieces if p]
                # The grammar of the word is not its meaning: der "nominative masculine singular definite article, the",
                # yo "first-person singular pronoun in the nominative case; I".
                pieces = [p for p in pieces if not grammar_piece(p)] or pieces
                # After a long first gloss, a short piece is a rider, not a synonym: "to talk or speak regularly with
                # someone, sometimes online" is not "to sometimes online".
                if pieces and len(pieces[0].split()) > 3:
                    pieces = pieces[:1]
                for p in pieces:
                    # "minor noble or nobleman" is two glosses; "the act of going through a place or event" is one.
                    ors = [q.strip() for q in re.split(r'\s+or\s+', p)]
                    # Two words at most a side: "to have a good or satisfactory relationship" is one gloss.
                    parts.extend(ors if len(ors) > 1 and all(0 < len(q.split()) <= 2 for q in ors) else [p])
            parts = [p for p in parts if not grammar_piece(p)] or parts
            # "minor noble or nobleman, a hidalgo": the loanword itself says nothing (but me is "me").
            # German Dad "dad; Dad": when every synonym is the loanword, it is the meaning.
            parts = [p for p in parts if not HINT_SKIP.match(p) and not (
                pos in ('noun', 'adj', 'name') and len(parts) > 1 and re.sub(r'^(?:a|an|the) ', '', p.lower()) == head.lower())] \
                or [p for p in parts if not HINT_SKIP.match(p)]
            short = [p for p in parts if len(p.split()) <= 3]
            if short:
                best = short[0]
                if EN_RANK and content and plainness(best) > 10000:
                    # The first synonym unless it is a rare English word and another is much plainer ("to chew" over
                    # "to masticate"); a learner's first meaning is otherwise the dictionary's.
                    for p in short[1:3]:
                        if plainness(p) * 4 < plainness(best):
                            best = p
                if pos == 'verb' and g.startswith('to ') and not best.startswith('to '):
                    best = 'to ' + best
                if best.lower().startswith(('a ', 'an ', 'the ')) and len(best.split()) > 1 and pos in ('noun', ''):
                    best = best.split(' ', 1)[1]
                return clip(best)
            if parts and not first_long:
                # A little long, but the first meaning: better than a later sense. Cut before a word that starts an
                # explanation ("to fly through the air" -> "to fly", "word as an isolated unit" -> "word").
                ws = parts[0].split()
                # "of" too after a verb ("to die of natural causes"), not after a noun ("the act of going").
                stops = BREAKERS | {'of'} if ws[0] == 'to' else BREAKERS
                br = next((i for i, w in enumerate(ws) if i >= 1 and not (i == 1 and ws[0] == 'to')
                           and w.lower().strip(',;:') in stops), None)
                if br and br <= 5:
                    return clip(' '.join(ws[:br]), cut=True)
                if len(ws) <= 5 and len(parts[0]) <= 40:
                    return clip(parts[0])
                # Nothing to cut at: the first four words, marked as cut ("to have a good…").
                first_long = clip(' '.join(ws[:4]), cut=True)
                first_long = first_long and first_long + '…'
            break
        if si >= 2 and first_long:
            break
    return first_long


def reflexive_hint(senses, head=''):
    """The hint of the first reflexive or pronominal sense (acordar -> "to remember" as acordarse), '' when none."""
    for notes, gl in senses[:8]:
        if set(notes) & REFLEXIVE_NOTES:
            return hint_of([gl], head, 'verb')
    return ''


# ------------------------------------------------------------------------------------------------------ build ---

Entry = collections.namedtuple('Entry', 'key head reading pos gender senses weak seq')

# Labels of a specialist's sense. Among sections of one headword and part of speech that the treebanks cannot tell apart,
# one that opens with such a sense goes after one that does not: mate the drink before mate in chess.
TOPICAL = set('''chess basketball sports sport soccer football tennis baseball golf cricket poker cards computing mathematics
    geometry arithmetic physics chemistry law music nautical military medicine pathology biology botany zoology anatomy
    grammar linguistics finance economics heraldry architecture printing typography electronics engineering geology
    astronomy philosophy theology mythology politics statistics logic bullfighting fencing hunting fishing agriculture
    aviation firearms programming genetics psychology'''.split()) | {'card games', 'rail transport', 'Roman Catholicism'}


def topical(en):
    return bool(en.senses and set(en.senses[0][0]) & TOPICAL)


def lcp(a, b):
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def keep_form(form):
    if not form or ' ' in form or len(form) > 40:
        return False
    if form.startswith(('-', "'")) and len(form) > 1 and not form.endswith("'"):
        return False
    if re.search(r'[\[\]()/*^0-9=]', form):
        return False
    return True


CURATED = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'curated.json')


def load_curated(code):
    """Hand-written facts for the commonest words, where Wiktionary glosses grammar ("masculine singular definite
    article") instead of a meaning a reader can glance at ("the"), or has a word only as a pointer (mi "apocopic form of
    mío"). curated.json, per language: "key" or "key|part of speech" -> a hint, or {"hint", "gloss", "notes"} (a gloss
    becomes the entry's first sense, and makes the entry if Wiktionary has none); "=form" -> the hint of one form (hay
    "there is" though haber is "to have")."""
    try:
        with open(CURATED, encoding='utf-8') as f:
            data = json.load(f).get(code, {})
    except FileNotFoundError:
        return {}
    return {k: v for k, v in data.items() if not k.startswith('//')}


def load_english(path=None):
    """FrequencyWords' English list, to choose the plainest synonym for a hint."""
    if EN_RANK:
        return
    for i, (w, _) in enumerate(iter_freq('en', path, EN_FREQ_URL)):
        if i >= 50000:
            break
        EN_RANK.setdefault(w, i + 1)


def iter_freq(code, path=None, url=None):
    """FrequencyWords' list for the language, (word, count) in its own order (commonest first), streamed."""
    if path:
        f = gzip.open(path, 'rt', encoding='utf-8') if path.endswith('.gz') else open(path, encoding='utf-8')
        with f:
            for line in f:
                parts = line.rstrip('\n').split(' ')
                if len(parts) == 2 and parts[1].isdigit():
                    yield parts[0], int(parts[1])
        return
    import io
    with kaikki.open_url(url or FREQ_URL.format(c=LANGS[code]['freq'])) as res:
        for line in io.TextIOWrapper(res, encoding='utf-8'):
            parts = line.rstrip('\n').split(' ')
            if len(parts) == 2 and parts[1].isdigit():
                yield parts[0], int(parts[1])


def build(code, extract=None, freq_path=None, out_root=OUT_ROOT, stats=False, en_path=None, ud_cache=None):
    cfg = LANGS[code]
    t0 = time.time()
    load_english(en_path)
    entries = []                         # Entry
    by_key = collections.defaultdict(list)  # key -> [entry index]
    # Forms become paradigm tokens as each entry is read, so no table of the 1.6 million rows a Spanish dump has is
    # ever held: descriptions and rules are numbered as they appear.
    descs = {'': 0}
    rules = {}
    entry_tokens = collections.defaultdict(set)   # entry -> {(rule, desc[, stress])}
    covered = set()                               # hash((entry, folded form)) of every pair with a token
    interned = {}
    pointers = []                        # (form, target word, pos, description, notes, written spelling or None)
    n_read = 0

    def intern(x):
        return interned.setdefault(x, x)

    def add_token(idx, fk, desc, written):
        k = entries[idx].key
        c = lcp(k, fk)
        tok = (rules.setdefault((k[c:], fk[c:]), len(rules)), descs.setdefault(desc.strip(), len(descs)))
        if code == 'ru' and written:
            si = stress_index(code, written)
            if si >= 0 and vowel_count(fk) > 1:
                tok = tok + (si - c,)
        entry_tokens[idx].add(tok)
        covered.add(hash((idx, fk)))

    for e in kaikki.entries(cfg['name'], extract_in=extract):
        n_read += 1
        w = (e.get('w') or '').strip()
        pos = e.get('p') or ''
        if not w or pos in SKIP_POS or ' ' in w or len(w) > 40:
            continue
        if w.startswith('-') or (w.endswith('-') and len(w) > 1):
            continue
        key = fold(code, w)
        senses = e.get('s') or []
        # The written head with its stress (Russian): the canonical row, else the head template's own spelling.
        written = w
        for f in e.get('f') or []:
            if 'canonical' in (f[1] or []) and fold(code, f[0]) == key:
                written = f[0]
                break
        else:
            for h in e.get('h') or []:
                hd = (h.get('a') or {}).get('head') or ''
                if hd and fold(code, hd) == key:
                    written = hd
                    break
        rows = sense_rows(code, senses)
        # Pointers: "plural of casa", "third-person singular preterite of ir", "apocopic form of le, la". A contraction
        # that says what it means (al "to the", au, zum) is a word of its own, not a form of its preposition.
        own_contraction = pos == 'contraction' and bool(rows)
        for s in senses:
            if own_contraction:
                break
            stags = s.get('tags') or []
            targets = (s.get('form_of') or []) + (s.get('alt_of') or [])
            if not targets:
                # "Prevocalic form of ne.": a pointer Wiktionary wrote without linking it.
                g0 = clean_gloss((s.get('glosses') or [''])[-1])
                m = is_pointer(g0) and re.search(r'\bof ([^\s,;:.()]+)', g0)
                if m:
                    targets = [m.group(1)]
            if not targets or 'combined-form' in stags or 'compound-of' in stags or \
                    any(t.startswith('object-') for t in stags):
                continue
            gl = [clean_gloss(g) for g in (s.get('glosses') or []) if g]
            if any(re.search(r'\bcombined with\b', g) for g in gl):
                continue
            if gl and pointer_tail(gl[-1]) and s.get('form_of') and not any(t in ORDER for t in stags if t != 'accusative'):
                continue
            if not keep_form(w):
                continue
            desc = ''
            if s.get('form_of') and any(t in ORDER for t in stags):
                desc = describe([t for t in stags if t not in DROP_TAGS or t == 'second-person-semantically'])
            if not desc and gl:
                g = gl[-1] if len(gl) > 1 and gl[0].endswith(':') else gl[0]
                m = re.match(r'^(.*?)\s+of\s+', g)
                desc = (m.group(1) if m else '').strip()
                if len(gl) > 1 and gl[0].endswith(':') and not m:
                    desc = gl[-1]
                desc = re.sub(r'^(?:inflection|form)$', '', desc)
            notes = labels_of((s.get('raw_glosses') or [''])[0], gl[0] if gl else '')
            if s.get('qualifier') and len(s['qualifier']) < 40 and s['qualifier'] not in notes:
                notes.append(s['qualifier'])
            if notes and desc and not desc.endswith(')'):
                desc = desc + ' (' + ', '.join(notes[:2]) + ')'
            for tw in targets:
                tw = re.sub(r'\s*\(.*$', '', tw).strip()
                # kaikki sometimes links the rest of the gloss too: ho -> "avere and", gran -> "grande m or f by sense".
                tw = re.sub(r'^(\S+)\s+(?:and|or|m|f|n|by)\b.*$', r'\1', tw)
                if tw and ' ' not in tw and fold(code, tw) != key:
                    pointers.append((w, intern(tw), intern(pos), intern(desc[:80]), written if written != w else None))
        # A section Wiktionary heads as a form ("verb form": había, est, сказала) is the lemma's: an explanation it
        # adds ("makes pluperfect to verbs") must not make había a word of its own.
        if rows and any(re.search(r'\bforms?$', (h.get('a') or {}).get('2', '')) for h in e.get('h') or [] if h.get('n') == 'head') \
                and any(s.get('form_of') or s.get('alt_of') for s in senses):
            rows = []
        if not rows:
            continue
        real = [s for s in senses if not (s.get('form_of') or s.get('alt_of'))]
        weak = all(set(n for n in notes) & WEAK_LABELS for notes, _ in rows)
        idx = len(entries)
        entries.append(Entry(key, w, written if written != w else '', pos, gender_of(e, real), rows[:8], weak,
                             len(by_key[key])))
        by_key[key].append(idx)
        sense_tags = {t for x in real for t in (x.get('tags') or [])}
        feminine_head = 'feminine' in sense_tags and 'masculine' not in sense_tags
        cells = collections.defaultdict(list)     # folded form -> [tag set]
        spelled = {}                              # folded form -> written spelling (Russian stress)
        for f in e.get('f') or []:
            form, tags = f[0], f[1] or []
            # la lists el and los as its masculine: those are the other word, not forms of la.
            if feminine_head and 'masculine' in tags and 'feminine' not in tags:
                continue
            # The reflexive table: sentarse, sentándose are the verb with its pronoun.
            if code in ('es', 'it', 'pt') and ('infinitive' in tags or 'gerund' in tags) and fold(code, form) != key \
                    and re.search(r'(?:se|si)$', form) and len(tags) == 1:
                tags = tags + ['reflexive']
            if any(t in SKIP_ROW_TAGS or t.startswith('object-') for t in tags):
                continue
            if not keep_form(form):
                continue
            if code in ('es', 'it') and ('infinitive' in tags or 'gerund' in tags) and \
                    any(t in ('first-person', 'second-person', 'third-person') for t in tags):
                continue
            fk = fold(code, form)
            if fk == key:
                continue
            ts = frozenset(tags)
            if ts not in cells[fk]:
                cells[fk].append(ts)
            # French tables give the past participle once; it agrees like an adjective (terminée, délivrés).
            if code == 'fr' and pos == 'verb' and set(tags) == {'participle', 'past'}:
                for end, extra in (('e', ('feminine', 'singular')), ('s', ('masculine', 'plural')), ('es', ('feminine', 'plural'))):
                    if end == 's' and fk.endswith('s'):
                        continue
                    agreed = fk + end if not (fk.endswith('s') and end == 'es') else fk + 'es'
                    cells[agreed].append(frozenset(('participle', 'past') + extra))
            if code == 'ru':
                prev = spelled.get(fk)
                if prev is None or (stress_index(code, prev) < 0 <= stress_index(code, form)):
                    spelled[fk] = form
        for fk, tagsets in cells.items():
            add_token(idx, fk, merge_descriptions(tagsets), spelled.get(fk))

    # ---- hand-written senses for the commonest words
    curated = load_curated(code)
    pos_code = {v: k for k, v in POS_NAMES.items()}
    for ck, cv in curated.items():
        if not isinstance(cv, dict) or 'gloss' not in cv or ck.startswith('='):
            continue
        word, _, pos_name = ck.partition('|')
        k = fold(code, word)
        ids = [i for i in by_key.get(k, []) if not pos_name or POS_NAMES.get(entries[i].pos, entries[i].pos) == pos_name]
        sense = (list(cv.get('notes', [])), [cv['gloss']])
        if ids:
            for i in ids:
                rest = [x for x in entries[i].senses if x[1] != sense[1]]
                entries[i] = entries[i]._replace(senses=([sense] + rest)[:8], weak=False)
        else:
            idx = len(entries)
            entries.append(Entry(k, word, '', pos_code.get(pos_name, pos_name or 'noun'), cv.get('gender', ''), [sense],
                                 False, len(by_key[k])))
            by_key[k].append(idx)

    # ---- pointers -> forms of lemma entries
    def target_entries(word, pos):
        k = fold(code, word)
        ids = by_key.get(k) or []
        same = [i for i in ids if entries[i].pos == pos]
        if same:
            return same
        # A participle filed as an adjective points at the verb; an elided article at the article.
        loose = {'adj': ('verb',), 'verb': ('adj',), 'noun': ('name',), 'det': ('pron', 'article', 'adj'),
                 'pron': ('det', 'article'), 'article': ('det', 'pron'), 'contraction': ('prep', 'article', 'det', 'pron'),
                 'num': ('adj', 'noun'), 'adv': ('adj', 'prep', 'conj')}.get(pos, ())
        near = [i for i in ids if entries[i].pos in loose]
        return near or ids

    # A pointer at a word that is itself only a pointer (Italian un' -> una -> uno) follows it, up to two steps.
    pointed = collections.defaultdict(list)
    for form, tw, pos, desc, written in pointers:
        pointed[fold(code, form)].append((tw, pos))

    def resolve(tw, pos, depth=0):
        ids = target_entries(tw, pos)
        if ids or depth >= 2:
            return ids
        out = []
        for tw2, pos2 in pointed.get(fold(code, tw), ()):
            out.extend(i for i in resolve(tw2, pos2 if pos2 in ('verb', 'noun', 'adj') else pos, depth + 1) if i not in out)
        return out

    n_pointer_pairs = 0
    for form, tw, pos, desc, written in pointers:
        fk = fold(code, form)
        for idx in resolve(tw, pos):
            if fk == entries[idx].key or hash((idx, fk)) in covered:
                continue
            n_pointer_pairs += 1
            add_token(idx, fk, desc, written or form)
    del pointers, covered

    # ---- paradigms, and matching a written word through them (as the engine does)
    paradigms = {}
    entry_paradigm = {}
    n_pairs = sum(len(t) for t in entry_tokens.values())
    for idx, toks in entry_tokens.items():
        entry_paradigm[idx] = paradigms.setdefault(tuple(sorted(toks)), len(paradigms))
    del entry_tokens
    paradigm_rules = [None] * len(paradigms)
    for p, i in paradigms.items():
        paradigm_rules[i] = frozenset(t[0] for t in p)
    rule_list = [None] * len(rules)
    by_added = collections.defaultdict(list)
    for (rem, add), r in rules.items():
        rule_list[r] = rem
        by_added[add].append(r)
    max_added = max((len(a) for a in by_added), default=0)

    def match(fk):
        """Entries a folded written word can be: its key, or a form by a rule of the entry's paradigm."""
        out = set(by_key.get(fk, ()))
        n = len(fk)
        for c in range(max(0, n - max_added), n + 1):
            rs = by_added.get(fk[c:])
            if not rs:
                continue
            stem = fk[:c]
            for r in rs:
                for i in by_key.get(stem + rule_list[r], ()):
                    p = entry_paradigm.get(i)
                    if p is not None and r in paradigm_rules[p]:
                        out.add(i)
        return out

    def forms_match(fk):
        return match(fk) - set(by_key.get(fk, ()))

    # ---- frequency: surface counts -> lemma keys
    def candidates(word):
        """Lemma keys a surface word (lower case, as the subtitle lists have it) can be, names left out."""
        fk = fold(code, word)
        found = match(fk)
        if cfg.get('keep_case') and fk:
            found |= match(fk[:1].upper() + fk[1:])
        return {entries[i].key for i in found if entries[i].pos != 'name'}

    # ---- what the treebanks say each written word usually is
    # Words that do not inflect keep their own entry whatever lemma a treebank gives them (muy, not mucho).
    CLOSED_UPOS = {'DET', 'PRON', 'ADP', 'CCONJ', 'SCONJ', 'PART', 'AUX', 'ADV'}
    ud_counts = ud.load_counts(code, ud_cache)
    ud_surface = collections.defaultdict(collections.Counter)   # folded form -> {(UPOS, folded lemma): n}
    ud_lemma_pos = collections.defaultdict(collections.Counter)  # folded lemma -> {UPOS: n}
    for form, c in ud_counts.items():
        for an, n in c.items():
            upos, lemma = an.split(' ', 1)
            f = form
            if cfg.get('keep_case') and f[:1].isupper() and not lemma[:1].isupper():
                f = f[:1].lower() + f[1:]          # Das at the start of a sentence is das
            ud_surface[fold(code, f)][(upos, fold(code, lemma))] += n
            ud_lemma_pos[fold(code, lemma)][upos] += n

    def ud_mass(fk):
        """How the treebanks' readings of a folded form fall on the dictionary's entries: {entry: count}. A reading goes
        to an entry of a matching part of speech: spelled like the form and named by the lemma, else spelled like the
        form, else named by the lemma (fue -> ser), else shared."""
        an = ud_surface.get(fk)
        if not an:
            return None
        exact = set(by_key.get(fk, ()))
        cands = list(exact) + [i for i in forms_match(fk) if i not in exact]
        mass = collections.Counter()
        for (upos, lemma), n in an.items():
            for tier in ud.UPOS.get(upos, []):
                compat = [i for i in cands if POS_NAMES.get(entries[i].pos, entries[i].pos) in tier]
                if not compat:
                    continue
                same = [i for i in compat if i in exact and entries[i].key == lemma]
                spelled = [i for i in compat if i in exact]
                named = [i for i in compat if entries[i].key == lemma]
                # A closed-class word is its own entry whatever the treebank's lemma (la the article, though its lemma
                # is el); an open-class one is the lemma's (prima "cousin" is primo's, not prima "bonus").
                if upos in CLOSED_UPOS:
                    pick = same or spelled or named or compat
                else:
                    pick = same or named or spelled or compat
                # One section per headword and part of speech takes it: the first the page gives, a specialist's (chess) after.
                firsts = {}
                for i in sorted(pick, key=lambda i: (topical(entries[i]), entries[i].seq)):
                    firsts.setdefault((entries[i].key, entries[i].pos), i)
                pick = list(firsts.values())
                for i in pick:
                    mass[i] += n / len(pick)
                break
        return mass or None

    base = collections.Counter()
    ambiguous = []
    counts = {}       # the subtitle counts the pronominal test below needs (infinitives and their clitic forms)
    keep_count = re.compile(r'(?:r|re|rse|rme|rte|rnos|ros|rsi|rmi|rti|rci|rvi)$')
    for word, count in iter_freq(code, freq_path):
        if count < 3:
            break
        if keep_count.search(word):
            counts.setdefault(word, count)
        ks = candidates(word)
        if not ks:
            continue
        if len(ks) == 1:
            base[next(iter(ks))] += count
        else:
            ambiguous.append((frozenset(ks), count, fold(code, word)))
    total = collections.Counter(base)
    for ks, count, fk in ambiguous:
        # Share a form among the words it can be by how common each is from its unambiguous forms; the word spelled
        # exactly like the form gets a floor so como (like) is not swallowed by comer. Where the treebanks saw the
        # form, their readings decide most of it (una is the article, not unir).
        weights = {k: base[k] + 1 for k in ks}
        for k in ks:
            if k == fk or (cfg.get('keep_case') and k.lower() == fk.lower()):
                weights[k] += max(count * 0.5, 1)
        tw = sum(weights.values())
        share = {k: weights[k] / tw for k in ks}
        mass = ud_mass(fk) if not cfg.get('keep_case') else (ud_mass(fk) or ud_mass(fk[:1].upper() + fk[1:]))
        if mass:
            by = collections.Counter()
            for i, m in mass.items():
                if entries[i].key in ks:
                    by[entries[i].key] += m
            n = sum(by.values())
            if n:
                alpha = n / (n + 4)
                share = {k: alpha * by[k] / n + (1 - alpha) * share[k] for k in ks}
        # Sorted: a key first met here enters `total` in a fixed place, so equal totals rank the same in every build
        # (a frozenset of strings iterates in a different order each run).
        for k in sorted(ks):
            total[k] += count * share[k]
    ranked = sorted((k for k in total if total[k] > 0), key=lambda k: -total[k])
    rank_of = {k: i + 1 for i, k in enumerate(ranked)}

    # Verbs used mostly with a reflexive pronoun (acordarse "to remember" over acordar "to agree"): the subtitles have
    # the reflexive infinitive more often than the plain one.
    pronominal = set()
    if code in ('es', 'it'):
        clitics = ('me', 'te', 'se', 'nos', 'os') if code == 'es' else ('mi', 'ti', 'si', 'ci', 'vi')
        for idx, en in enumerate(entries):
            if en.pos != 'verb' or not re.search(r'[aeiíó]r[e]?$', en.key):
                continue
            stem = en.key if code == 'es' else re.sub(r'e$', '', en.key)
            refl = sum(counts.get(stem + c, 0) for c in clitics)
            third = counts.get(stem + clitics[2], 0)
            # acordarme, acordarte, acordarse together outnumber acordar (2,100 to 1,800 in the subtitles); decirme (tell
            # me) and darte (give you) are common too, but stay below the verb (decir 5 to 1, dar 4 to 3).
            plain = counts.get(en.key, 0)
            if refl >= 30 and (refl >= plain or (refl >= 0.8 * plain and third >= 0.25 * plain)):
                pronominal.add(idx)


    # ---- write
    out_dir = os.path.join(out_root, code)
    os.makedirs(out_dir, exist_ok=True)
    # The sections of a headword in the order a reader most likely means them (padre the noun before padre "cool"),
    # by the treebanks; the page's own order where they say nothing. Line numbers are the entry ids the engine uses.
    def section_weight(idx):
        en = entries[idx]
        pos_name = POS_NAMES.get(en.pos, en.pos)
        w = 0.0
        for upos, n in ud_lemma_pos.get(en.key, {}).items():
            tiers = ud.UPOS.get(upos, [])
            if tiers and pos_name in tiers[0]:
                w += n
        m = ud_mass(en.key)
        if m:
            w += m.get(idx, 0)
        return w

    order = []
    for key, ids in by_key.items():
        order.extend(sorted(ids, key=lambda i: (entries[i].weak, entries[i].pos == 'name', -section_weight(i),
                                                 topical(entries[i]), entries[i].seq)))
    new_id = {old: new for new, old in enumerate(order)}

    lines = []
    for idx in order:
        en = entries[idx]
        cur = curated.get(en.head + '|' + POS_NAMES.get(en.pos, en.pos), curated.get(en.head))
        if isinstance(cur, dict):
            cur = cur.get('hint') or hint_of([cur['gloss'].split('; ')], en.head, en.pos)
        hint = cur or hint_of([g for _, g in en.senses], en.head, en.pos)
        rhint = reflexive_hint(en.senses, en.head) if en.pos == 'verb' else ''
        if rhint and rhint != hint:
            hint += '|' + rhint
        sense_cols = []
        for notes, gl in en.senses:
            col = ('{' + ', '.join(dict.fromkeys(notes)) + '}' if notes else '') + '|'.join(gl)
            sense_cols.append(col)
        flags = ('w' if en.weak else '') + ('p' if idx in pronominal else '')
        lines.append('\t'.join([
            en.key, en.head if en.head != en.key else '', en.reading, POS_NAMES.get(en.pos, en.pos), en.gender,
            str(rank_of.get(en.key, '')), str(entry_paradigm.get(idx, '')), flags, hint, *sense_cols,
        ]))
    header = (f'# Dushu {cfg["name"]} dictionary. From English Wiktionary (CC BY-SA 4.0) via kaikki.org; ranks from '
              f'hermitdave/FrequencyWords (CC BY-SA 4.0). Built {datetime.date.today().isoformat()}.\n'
              '# key\thead\treading\tpos\tgender\trank\tparadigm\tflags\thint\tsenses...\n')
    write_gz(os.path.join(out_dir, 'entries.tsv.gz'), header + '\n'.join(lines) + '\n')

    # The prior: for a written word the dictionary reads several ways, how often the treebanks meant each (percent).
    plines = []
    for fk, an in sorted(ud_surface.items()):
        if sum(an.values()) < 3:
            continue
        cands = match(fk)
        if len(cands) < 2:
            continue
        mass = ud_mass(fk)
        if not mass:
            continue
        tot = sum(mass.values())
        cells = sorted(((new_id[i], round(100 * m / tot)) for i, m in mass.items() if i in new_id), key=lambda x: -x[1])
        cells = [c for c in cells if c[1] >= 1]
        if cells:
            plines.append(fk + '\t' + ' '.join(f'{i}:{p}' for i, p in cells) + '\t' + str(sum(an.values())))
    write_gz(os.path.join(out_dir, 'prior.tsv.gz'), '# form\tentry:percent ...\ttreebank count\n' + '\n'.join(plines) + '\n')

    flines = ['# Dushu ' + cfg['name'] + ' forms: D description, R removed added, P paradigm tokens (rule.desc[.stress]).']
    for d, _ in sorted(descs.items(), key=lambda x: x[1]):
        flines.append('D\t' + d)
    for (rem, add), _ in sorted(rules.items(), key=lambda x: x[1]):
        flines.append('R\t' + rem + '\t' + add)
    for p, _ in sorted(paradigms.items(), key=lambda x: x[1]):
        flines.append('P\t' + ' '.join('.'.join(str(x) for x in t) for t in p))
    for ck, cv in curated.items():
        if ck.startswith('=') and isinstance(cv, str):
            flines.append('H\t' + fold(code, ck[1:]) + '\t' + cv)
    write_gz(os.path.join(out_dir, 'forms.tsv.gz'), '\n'.join(flines) + '\n')

    counts = {
        'entries': len(entries), 'keys': len(by_key), 'forms': n_pairs, 'rules': len(rules),
        'paradigms': len(paradigms), 'descriptions': len(descs), 'ranked': len(ranked),
        'senses': sum(len(e.senses) for e in entries), 'priors': len(plines),
    }
    meta = {
        'lang': code,
        'built': datetime.date.today().isoformat(),
        'counts': counts,
        'sources': [
            {'name': f'English Wiktionary ({cfg["name"]} entries), extracted by kaikki.org (wiktextract)',
             'license': 'CC BY-SA 4.0 (and GFDL)', 'url': kaikki.kaikki_url(cfg['name'])},
            {'name': 'FrequencyWords (OpenSubtitles 2018 full list), Hermit Dave',
             'license': 'CC BY-SA 4.0', 'url': FREQ_URL.format(c=cfg['freq'])},
            {'name': 'FrequencyWords English list (to choose the plainest English hint), Hermit Dave',
             'license': 'CC BY-SA 4.0',
             'url': EN_FREQ_URL},
            *ud.sources(code),
        ],
    }
    with open(os.path.join(out_dir, 'meta.json'), 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
        f.write('\n')
    sizes = {n: os.path.getsize(os.path.join(out_dir, n)) for n in ('entries.tsv.gz', 'forms.tsv.gz', 'prior.tsv.gz')}
    print(f'{code}: {n_read} read, {len(entries)} entries, {len(by_key)} keys, {n_pairs} form pairs '
          f'({n_pointer_pairs} from pointers), {len(rules)} rules, {len(paradigms)} paradigms, {len(descs)} descriptions, '
          f'{len(ranked)} ranked, {len(plines)} priors; entries {sizes["entries.tsv.gz"] / 1e6:.2f} MB, forms '
          f'{sizes["forms.tsv.gz"] / 1e6:.2f} MB, prior {sizes["prior.tsv.gz"] / 1e6:.2f} MB; '
          f'{time.time() - t0:.0f}s')
    if stats:
        print(' top ranked:', ranked[:60])
    return out_dir


def write_gz(path, text):
    # mtime 0 keeps the bytes the same for the same input, so a rebuild with no change does not churn the cache.
    with open(path, 'wb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, compresslevel=9, mtime=0) as f:
            f.write(text.encode('utf-8'))


if __name__ == '__main__':
    args = sys.argv[1:]
    opts = {}
    codes = []
    i = 0
    while i < len(args):
        a = args[i]
        if a in ('--extract', '--freq', '--out', '--en', '--ud'):
            opts[a[2:]] = args[i + 1]
            i += 2
            continue
        if a == '--stats':
            opts['stats'] = True
        elif a in LANGS:
            codes.append(a)
        else:
            print('usage: build.py <code>... [--extract slim.jsonl.gz] [--freq list.txt] [--out dir]   codes:',
                  ' '.join(LANGS), file=sys.stderr)
            sys.exit(2)
        i += 1
    if not codes:
        print('usage: build.py <code>...', file=sys.stderr)
        sys.exit(2)
    if len(codes) > 1 and ('extract' in opts or 'freq' in opts):
        print('--extract and --freq name one language\'s files: build one language at a time', file=sys.stderr)
        sys.exit(2)
    for c in codes:
        build(c, extract=opts.get('extract'), freq_path=opts.get('freq'), out_root=opts.get('out', OUT_ROOT),
              stats=opts.get('stats', False), en_path=opts.get('en'), ud_cache=opts.get('ud'))
