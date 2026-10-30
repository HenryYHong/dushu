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
                                              the stressed vowel's offset from where the rule cut the word), sorted by
                                              rule. Russian: one spelling can be two tokens of one rule with two
                                              stresses (глаза: глаза́ nominative/accusative plural, гла́за genitive
                                              singular), the reading likelier in running text first; the engine keeps
                                              the first unless context says otherwise (лесу́ after в/на is the second
                                              of лес's лесу).
                   H <form> <hint>            the hint of one form where its lemma's would mislead (hay "there is";
                                              меня "me", ihm "him": a personal pronoun's oblique forms)
                   A <entry> <aspect> <partners>  Russian: a verb's aspect (pf, impf or both) and its aspect partners,
                                              comma-separated with their stress (сказать: "A <id> pf говори́ть");
                                              entry = line number in entries.tsv.gz. Not shown yet.
                   Lines of each kind are numbered from 0 in file order.
  prior.tsv.gz     for words the dictionary reads several ways, how often each entry is meant: form, then
                   "entry:percent" cells (entry = line number in entries.tsv.gz, comments not counted), then how far to
                   trust the line (the treebank count plus the subtitle estimate's, see the prior writer). Percents need
                   not sum to 100: each section of a key gets the key's share, and a proper noun the line's highest.
  phrases.tsv.gz   fixed phrases: words folded lower-case and cut as the engine cuts them ("c' est à dire"), the hint,
                   then senses as in entries.tsv.gz (write_phrases).
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
        elif not unicodedata.combining(ch):
            # й is и + breve in NFD: one letter of the folded word, as пойду́ (stress 4, not 5) is read on the page.
            n += 1
    return acute if acute >= 0 else yo


RU_VOWELS = set('аеёиоуыэюя')
# Russian verb aspect as the head template writes it (сказа́ть "pf", говори́ть "impf", жени́ть "both") -> forms.tsv.gz.
ASPECTS = {'pf': 'pf', 'impf': 'impf', 'both': 'both', 'pf-impf': 'both', 'impf-pf': 'both'}


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
    # An archaic cell beside a current one is not what the form is: Italian era is essere's "third-person singular
    # imperfect indicative", whatever its old first person.
    current = [s for s in sets if not s & {'archaic', 'obsolete', 'dated', 'rare'}]
    if current:
        sets = current
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
    # garnis is four cells of garnir ("masculine plural past participle; first/second-person singular present indicative;
    # ...") and reads as such, not "inflected form".
    if 1 <= len(grouped) <= 4 and sum(len(d) for d in grouped) < 200:
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
# A neologism too: es les "the" (a gender-neutral article) must not lead les "to them".
WEAK_LABELS = {'archaic', 'obsolete', 'dated', 'rare', 'historical', 'dialectal', 'regional', 'poetic', 'nonstandard',
               'uncommon', 'proscribed', 'obsolete spelling', 'archaic spelling', 'neologism'}
# A sense that only points somewhere else (and would be junk shown as a meaning).
POINTER = re.compile(
    r'^(?:(?:obsolete|archaic|dated|rare|nonstandard|alternative|informal|colloquial|eye[- ]dialect|pronunciation|'
    r'apocopic|apocopated|elided|contracted|superseded|deprecated|standard|uncommon|regional|dialectal|prevocalic|'
    r'obsolete typographic|misspelt|common|less common|euphemistic|clipped|ellipsis|abbreviated|pre-reform|post-reform|'
    r'european portuguese|brazilian portuguese|european|brazilian)\s*,?\s*)*'
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


def weak_notes(notes):
    """A sense a reader of today rarely means: archaic, obsolete, rare... also as "dated or high-style" (помнить "to
    think", whose stress помни́ть left the common по́мнить unmarked) or "chiefly archaic"."""
    # Not "dated in Brazil" (pt rapariga "girl", current in Portugal).
    return any(n in WEAK_LABELS or re.fullmatch(r'(?:chiefly |mostly |now )?(?:archaic|obsolete|dated|rare|historical)'
                                                r'(?: or [\w -]+)?', n) for n in notes)


def grammar_pointer(g):
    """A gloss that is nothing but a description of which form of another word this is."""
    g = re.sub(r'\s*\([^()]*\)', '', g or '')     # "pre-reform spelling (used until 1990) of ótimo"
    m = re.match(r'^(.{3,90}?)\s+of\s+[^\s,;:()]+\s*\.?$', g)
    if not m:
        return False
    head = m.group(1).lower()
    words = [w for w in re.split(r'[\s/,]+', head) if w and w not in ('and', 'or')]
    gram = [w for w in words if w in GRAMMAR_WORDS or re.fullmatch(r'(?:first|second|third)-person', w)]
    # German Armen "strong genitive/accusative singular and dative plural of Armer"; Hühner "nominative/accusative/genitive
    # plural chicken of Huhn", where kaikki let the link text in: grammar with one stray word is still a pointer.
    return bool(words) and len(words) - len(gram) <= (1 if len(gram) >= 3 else 0) \
        and any(w not in ('first', 'second', 'third', 'i', 'ii') for w in gram)


def is_pointer(g):
    # "pre-reform spelling (used until 1943 in Brazil and 1911 in Portugal) of à: feminine singular of ao" (Dom Casmurro's
    # á) points at à, whatever its parenthesis and its tail say.
    return bool(POINTER.match(g or '') or POINTER.match(re.sub(r'\s*\([^()]*\)', '', g or '')) or grammar_pointer(g))
NO_GLOSS = re.compile(r'^\s*$')
# A pronunciation line kaikki filed as a sense: dès "Audio (France (Vosges)): (file)", Léticie "IPA⁽ᵏᵉʸ⁾: /le.ti.si/".
JUNK_GLOSS = re.compile(r'^(?:Audio\b.*\(file\)\s*$|IPA\S*:\s*/)')

# British spellings in English glosses, as an American reads them (viajero "traveller" -> "traveler", gris "grey / gray"
# -> "gray"). Whole words only: greyhound, tour and promise stay as they are.
AMERICAN = {
    'grey': 'gray', 'greys': 'grays', 'greyed': 'grayed', 'greying': 'graying', 'greyish': 'grayish', 'greyness': 'grayness',
    'centre': 'center', 'centres': 'centers', 'centred': 'centered', 'theatre': 'theater', 'theatres': 'theaters',
    'theatrical': 'theatrical', 'metre': 'meter', 'metres': 'meters', 'kilometre': 'kilometer', 'kilometres': 'kilometers',
    'centimetre': 'centimeter', 'centimetres': 'centimeters', 'millimetre': 'millimeter', 'millimetres': 'millimeters',
    'litre': 'liter', 'litres': 'liters', 'decilitre': 'deciliter', 'millilitre': 'milliliter', 'fibre': 'fiber',
    'fibres': 'fibers', 'sombre': 'somber', 'spectre': 'specter', 'lustre': 'luster', 'calibre': 'caliber', 'sabre': 'saber',
    'sabres': 'sabers', 'sceptre': 'scepter', 'mitre': 'miter', 'meagre': 'meager', 'ochre': 'ocher', 'goitre': 'goiter',
    'manoeuvre': 'maneuver', 'manoeuvres': 'maneuvers', 'manoeuvring': 'maneuvering', 'defence': 'defense',
    'defences': 'defenses', 'offence': 'offense', 'offences': 'offenses', 'pretence': 'pretense', 'licence': 'license',
    'licences': 'licenses', 'practise': 'practice', 'practised': 'practiced', 'practising': 'practicing',
    'analyse': 'analyze', 'analysed': 'analyzed', 'analysing': 'analyzing', 'paralyse': 'paralyze', 'paralysed': 'paralyzed',
    'jewellery': 'jewelry', 'jeweller': 'jeweler', 'jewellers': 'jewelers', 'woollen': 'woolen', 'woollens': 'woolens',
    'skilful': 'skillful', 'skilfully': 'skillfully', 'wilful': 'willful', 'fulfil': 'fulfill', 'fulfilment': 'fulfillment',
    'enrol': 'enroll', 'enrolment': 'enrollment', 'instalment': 'installment', 'distil': 'distill', 'cheque': 'check',
    'cheques': 'checks', 'kerb': 'curb', 'tyre': 'tire', 'tyres': 'tires', 'plough': 'plow', 'ploughs': 'plows',
    'ploughed': 'plowed', 'ploughing': 'plowing', 'ploughman': 'plowman', 'ploughshare': 'plowshare', 'mould': 'mold',
    'moulds': 'molds', 'mouldy': 'moldy', 'moulded': 'molded', 'moult': 'molt', 'smoulder': 'smolder',
    'smouldering': 'smoldering', 'moustache': 'mustache', 'moustaches': 'mustaches', 'pyjamas': 'pajamas',
    'programme': 'program', 'programmes': 'programs', 'catalogue': 'catalog', 'aeroplane': 'airplane',
    'aeroplanes': 'airplanes', 'aluminium': 'aluminum', 'sceptic': 'skeptic', 'sceptical': 'skeptical',
    'scepticism': 'skepticism', 'storey': 'story', 'storeys': 'stories', 'waggon': 'wagon', 'draught': 'draft',
    'draughty': 'drafty', 'cosy': 'cozy', 'ageing': 'aging', 'judgement': 'judgment', 'acknowledgement': 'acknowledgment',
    'foetus': 'fetus', 'oesophagus': 'esophagus', 'encyclopaedia': 'encyclopedia', 'anaemia': 'anemia',
    'anaemic': 'anemic', 'anaesthetic': 'anesthetic', 'haemorrhage': 'hemorrhage', 'haemorrhoids': 'hemorrhoids',
    'diarrhoea': 'diarrhea', 'gynaecology': 'gynecology', 'oestrogen': 'estrogen', 'leukaemia': 'leukemia',
    'paediatric': 'pediatric', 'paediatrician': 'pediatrician', 'orthopaedic': 'orthopedic', 'mum': 'mom', 'mums': 'moms',
    'mummy': 'mommy', 'arse': 'ass', 'arsehole': 'asshole', 'whilst': 'while', 'amongst': 'among', 'towards': 'toward',
    'marvellous': 'marvelous', 'marvellously': 'marvelously', 'counsellor': 'counselor', 'councillor': 'councilor',
}
# Words whose -our is -or in American: colour, honour, favourite, neighbouring, labourer.
OUR_STEMS = ('col|hon|fav|behavi|lab|harb|hum|rum|vap|od|flav|arm|val|vig|rig|clam|ard|cand|endeav|sav|splend|neighb|'
             'parl|savi|tum|demean|ferv|ranc|succ|arb|disfav|dishon|misbehavi|disc?ol')
OUR_WORD = re.compile(r'\b(' + OUR_STEMS + r')our(s|ed|ing|ite|ites|able|ably|ful|fully|less|hood|hoods|ly|y|er|ers|'
                      r'ist|ists|ism|ous|ation|ations|ing)?\b', re.I)
# Verbs whose -ise is -ize in American (realise, organised, civilisation); advise, surprise, exercise keep their -ise.
IZE_STEMS = set('''real recogn organ apolog critic emphas memor sympath civil bapt character summar util special author
    priorit minim maxim final legal ideal harmon colon energ familiar general hospital immortal mobil modern neutral normal
    penal personal polar popular public scrutin standard stabil steril symbol terror theor tranquill victim visual vocal agon
    antagon capital categor central crystall demoral dramat econom equal fertil formal global glamor hypnot italic jeopard
    legitim liberal local magnet material monopol moral natural national ostrac patron pasteur plagiar privat pulver ration
    revolution romantic satir scandal sensit social solemn tantal trivial union urban vandal vapor western woman catech
    evangel fratern galvan human immun item lion mesmer metabol militar oxid philosoph proselyt random sanit subsid synchron
    synthes tyrann american europe christian modern canon chastis fantas idol imm emphas sermon sodom templat
    agon amortis anglic atom author'''.split())
IZE_WORD = re.compile(r'\b([a-z]+)is(e|es|ed|ing|ation|ations|er|ers)\b')
DOUBLE_L = re.compile(r'\b(travel|cancel|label|model|quarrel|marvel|signal|dial|fuel|level|revel|rival|shovel|snivel|swivel|'
                      r'tunnel|channel|chisel|enamel|equal|total|unravel|grovel|initial|pencil|funnel|libel|panel|pummel|'
                      r'yodel|duel|spiral|jewel|counsel|bevel|cudgel|dishevel|gambol|gravel|kennel|pedal|refuel|stencil|'
                      r'towel|victual|tassel|chanel|shrivel|drivel|ravel)l(ed|ing|er|ers|or|ors)\b', re.I)


def americanize(g):
    """British spellings in an English gloss made American; a "X / Y" or "X, Y" pair that then repeats a word keeps one."""
    if not g or not re.search(r'our|is[eia]|ys|re\b|ll|ae|oe|grey|ence|ogue|mme|ough|ould|ult|um\b|ilst|ngst|ards|tyre|kerb|'
                              r'cheque|cosy|ageing|ment|arse|storey|aggon|aught|ustache|yjama|minium|cept|ful|fil|rol\b|'
                              r'stil\b|ellous|sellor|cillor', g):
        return g

    def word(m):
        # A capital is a name's: Tyre the city, the French region Centre.
        w = m.group(0)
        a = AMERICAN.get(w) if w[:1].islower() else None
        return w if a is None else a
    g = re.sub(r"[A-Za-z]+", word, g)
    g = OUR_WORD.sub(lambda m: m.group(1) + 'or' + (m.group(2) or ''), g)
    g = IZE_WORD.sub(lambda m: m.group(1) + 'iz' + m.group(2) if m.group(1).lower() in IZE_STEMS else m.group(0), g)
    g = DOUBLE_L.sub(lambda m: m.group(1) + m.group(2), g)
    # "color / color", "gray, gray": the two spellings were one word.
    g = re.sub(r'\b([\w\'-]+)(\s*/\s*|,\s+)\1\b', r'\1', g)
    return g


def clean_gloss(g):
    g = re.sub(r'\s+', ' ', g or '').strip()
    g = g.replace('|', '/').replace('{', '(').replace('}', ')').replace('\t', ' ')
    g = re.sub(r'\s+,', ',', g)
    g = re.sub(r',\s*,', ',', g)
    g = re.sub(r'\(\s*\)', '', g).strip()
    return americanize(g)


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
        gl = [g for g in gl if g and not JUNK_GLOSS.match(g)]
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
    return [r for r in rows if not weak_notes(r[0])] + [r for r in rows if weak_notes(r[0])]


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
                       # German dürr "dried up, desiccated, especially thin", zwar "Signals a following contrary clause",
                       # Maler "agent noun of malen": riders and descriptions, not meanings.
                       r'especially\s|signals |agent noun|nominali[sz]ation of|separated form|elongated form|'
                       r'gender-neutral|expressing |indicating |in answering|'
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
    # One word is a meaning even when it names grammar: Artikel is "article", Pronomen "pronoun".
    return bool((GRAMMAR_ONLY.match(p) and ' ' in p.strip(' .')) or (GRAMMAR_HEAD.search(p) and len(p.split()) >= 3))


def descriptive(g):
    return bool(HINT_SKIP.match(g) or is_pointer(g) or (GRAMMAR_ONLY.match(g) and ',' not in g and ' ' in g.strip(' .')))


# Verbs that mean little without what follows them: a gloss is never cut right after one ("to fall in love", not "to
# fall"; "to come to one's senses", not "to come"), and the idioms they make keep their preposition ("to take care of").
LIGHT_VERBS = set('''be become begin bring carry come cope deal do fall get give go have keep let look make pay put run set
    start take try turn'''.split())
IDIOM_ENDS = {'care', 'rid', 'use', 'fun', 'used', 'advantage', 'part', 'attention', 'eye', 'forward', 'along', 'hold', 'sight',
              'track', 'charge', 'aware', 'afraid', 'fond', 'ashamed', 'proud', 'tired', 'sure'}
RIDERS = {'especially', 'etc', 'usually', 'often', 'chiefly', 'mainly', 'mostly', 'also', 'sometimes', 'e.g', 'i.e',
          'typically', 'generally', 'particularly', 'specifically', 'in particular'}
MODALS = {'can', 'could', 'must', 'may', 'might', 'shall', 'should', 'will', 'would', 'ought'}
# What a cut can leave that says nothing: "someone" (santo "someone who has been canonized"), "showing" (digno "showing or
# deserving dignity").
PLACEHOLDERS = {'someone', 'somebody', 'something', 'one', 'a person', 'person', 'thing', 'showing', 'that', 'which',
                'who', 'having', 'being', 'related', 'pertaining', 'said', 'relating', 'characterized'}

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
            # закричать "to begin to shout", захотеть "to begin to want": the verb is the meaning (the prefix's "begin"
            # is the aspect).
            if pos == 'verb':
                g = re.sub(r'^to (?:begin|start|commence) to (?=[a-z])', 'to ', g)
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
                # someone, sometimes online" is not "to sometimes online"; ingresar "to join a group, institution" is not
                # "to institution".
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
            # A loanword English uses every day is the meaning all the same when Wiktionary gives it first (general,
            # terrible, Job, Plan); a rare one (hidalgo), or one after another gloss (fr caution "bail, caution"), is not.
            parts = [p for j, p in enumerate(parts) if not HINT_SKIP.match(p) and not (
                pos in ('noun', 'adj', 'name') and len(parts) > 1 and re.sub(r'^(?:a|an|the) ', '', p.lower()) == head.lower()
                and (j or EN_RANK.get(head.lower(), 10 ** 6) > 10000))] \
                or [p for p in parts if not HINT_SKIP.match(p)]
            # "goblet or its content": a reference to the gloss before, not a meaning; dürr "dried up, desiccated,
            # especially": a rider (but особенно is "especially").
            parts = [p for j, p in enumerate(parts) if not re.match(r'(?:its|their) ', p) and
                     (j == 0 or p.lower().strip('.') not in RIDERS)] or parts
            short = [p for p in parts if len(p.split()) <= 3]
            if short:
                best = short[0]
                if EN_RANK and content and plainness(best) > 10000:
                    # The first synonym unless it is a rare English word and another is much plainer ("to chew" over
                    # "to masticate"); a learner's first meaning is otherwise the dictionary's.
                    for p in short[1:3]:
                        if plainness(p) * 4 < plainness(best):
                            best = p
                # "to " as the gloss has it, but not before a modal (уметь "can", not "to can") or a dummy subject
                # (esserci "there be").
                if pos == 'verb' and g.startswith('to ') and not best.startswith('to ') and \
                        best.split(' ')[0].lower() not in MODALS | {'there', 'it'}:
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
                low = [w.lower().strip(',;:') for w in ws]
                br = next((i for i, w in enumerate(low) if i >= 1 and not (i == 1 and ws[0] == 'to') and w in stops
                           # never right after a light verb: "to fall in love", "to put to sleep", "to come to a stop"
                           and not (ws[0] == 'to' and i == 2 and low[1] in LIGHT_VERBS)), None)
                if br and br <= 5:
                    idiom = ws[0] == 'to' and low[br - 1] in IDIOM_ENDS
                    # "to take care of", "to get rid of", "to get used to": the idiom keeps its preposition.
                    cut_ = clip(' '.join(ws[:br + 1]), 44) if idiom else clip(' '.join(ws[:br]), cut=True)
                    if cut_.lower() not in PLACEHOLDERS:
                        return cut_
                    continue
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
    """The hint of the first reflexive or pronominal sense (acordar -> "to remember" as acordarse), '' when none. A
    regional, slang or specialist one is no reading of a book's se: poder's {reflexive, El Salvador} "to be familiar",
    colocar's {slang} "to take drugs"."""
    for notes, gl in senses[:8]:
        if set(notes) & REFLEXIVE_NOTES and not marked_notes(notes):
            return hint_of([gl], head, 'verb')
    return ''


# ---------------------------------------------------------------------------------------------------- pointers ---

# What a pointer sense says the word is, besides an inflection ("plural of casa"):
#   synonym    cuarto "synonym of dinero" (Andalusia): another word with a like meaning
#   derived    Schneider "agent noun of schneiden", muchacha "female equivalent of muchacho": a word made from another
#   variant    ay "obsolete spelling of hay", fué "superseded spelling of fue", aquella "alternative spelling of aquélla"
DERIVED_GLOSS = re.compile(r'^(?:(?:female|feminine|male|masculine)(?: equivalent| form)? of|agent noun of)\b', re.I)
VARIANT_DESC = re.compile(r'^(?:(?:obsolete|archaic|dated|rare|nonstandard|alternative|superseded|deprecated|pre-reform|'
                          r'post-reform|uncommon|less common|informal|colloquial|eye[- ]dialect|pronunciation|standard|'
                          r'common|old|older|european portuguese|brazilian portuguese|european|brazilian|aphetic|apocopic|'
                          r'apocopated)\s*,?\s*)*(?:spelling|form|variant|misspelling|typography|clipping)s?\b', re.I)
ELISION_DESC = re.compile(r'elided|elision|apocop|contract|prevocalic|preconsonantal|truncat|syncop|aphetic|clipp', re.I)
FEMALE_OF = re.compile(r'^(?:female|feminine)(?: equivalent)? of ([^\s,;:()]+?)(?:\s*\(“([^”]{1,40})”\)|(?:,| *:) +(?:a |an )?'
                       r'([^;:()“”]{2,40}))?\.?$', re.I)
# The gloss of a female noun that says only what it is the female of, filled in when the entries are written.
FEMALE_MARK = '\x00female '
SUPERSCRIPT = re.compile(r'\s*[¹²³⁴⁵⁶⁷⁸⁹⁰]+$')          # него́ ² in the Russian pronoun table
OBLIQUE = {'genitive', 'dative', 'accusative', 'instrumental', 'prepositional'}
# Parts of speech a pointer may step between (an article's form is a determiner's), and those it may not (a noun's
# plural is never a verb's form).
POS_FAMILY = {'det': 'pron', 'article': 'pron', 'num': 'adj'}
GENDER_NUMBER_ONLY = re.compile(r'^(?:masculine|feminine|neuter|singular|plural)(?:[/ ]+(?:masculine|feminine|neuter|'
                                r'singular|plural))*(?: \([^()]*\))?$')
# Spanish haberlo, tenerla: an infinitive with its pronouns, which the engine splits (haber + lo).
CLITIC_FORM = {'es': re.compile(r'(.+(?:ar|er|ir|ír))((?:me|te|se|nos|os|lo|la|los|las|le|les)+)')}


def italian_spelling(form):
    """An Italian table form as books print it: Wiktionary marks the stress inside a word (essere's participle stàto,
    which "è stata una nottata d'inferno" in Pinocchio must reach), Italian spelling only on a final vowel (città)."""
    d = unicodedata.normalize('NFD', form)
    if not re.search('[\u0300\u0301]', d[:-1]):
        return form
    last = len(d) - 1 if d[-1] in '\u0300\u0301' else len(d)
    return unicodedata.normalize('NFC', ''.join(ch for i, ch in enumerate(d) if i >= last or ch not in '\u0300\u0301'))


REFLEXIVE_ENTRY_RANK = 15000      # how common a pronominal verb's own entry must be to give its base verb a hint


def reflexive_key(code, key):
    """The key of a verb's pronominal infinitive where Wiktionary may give it an entry of its own: it addormentare ->
    addormentarsi, porre -> porsi; es acordar -> acordarse; pt deitar -> deitar-se. '' where there is none."""
    if code == 'it' and key.endswith('re'):
        return key[:-2] + 'si' if key.endswith('rre') else key[:-1] + 'si'
    if code == 'es' and re.search(r'[aeií]r$', key):
        return key + 'se'
    if code == 'pt' and re.search(r'[aeiô]r$', key):
        return key + '-se'
    return ''


# The female word for a man's word: gorda is a "fat woman", not a "female fat man".
FEMALE_WORDS = {'man': 'woman', 'men': 'women', 'boy': 'girl', 'boys': 'girls', 'husband': 'wife', 'father': 'mother',
                'son': 'daughter', 'brother': 'sister', 'king': 'queen', 'lord': 'lady', 'gentleman': 'lady',
                'sir': 'madam', 'prince': 'princess', 'uncle': 'aunt', 'nephew': 'niece', 'grandfather': 'grandmother',
                'monk': 'nun', 'waiter': 'waitress', 'actor': 'actress', 'emperor': 'empress', 'duke': 'duchess',
                'count': 'countess', 'baron': 'baroness', 'god': 'goddess', 'hero': 'heroine', 'widower': 'widow',
                'bridegroom': 'bride', 'groom': 'bride', 'fiancé': 'fiancée', 'stepfather': 'stepmother', 'male': 'female',
                'person': 'woman'}


def female_gloss(hint):
    """The gloss of a word known only as the female of another, from that word's hint: profesor "teacher" -> "female
    teacher", gordo "fat man" -> "fat woman", indio "a native of India" -> "female native of India"."""
    h = re.sub(r'^(?:a|an|the) ', '', (hint or '').split('|')[0].split(';')[0].strip())
    swapped = re.sub(r'\b(' + '|'.join(FEMALE_WORDS) + r')\b', lambda m: FEMALE_WORDS[m.group(1)], h)
    return swapped if swapped != h else 'female ' + h


def clitic_verb(pattern, fk, by_key, entries):
    m = pattern.fullmatch(fk)
    return bool(m) and any(entries[i].pos == 'verb' for i in by_key.get(m.group(1), ()))


def variant_word(desc):
    """How a spelling variant's description names it after the form it spells: fué -> "(old spelling)", pt tive by way
    of tar, the clipped estar of Portugal -> "(colloquial)"."""
    d = desc.lower()
    if re.search(r'obsolete|archaic', d):
        return 'obsolete spelling'
    if re.search(r'superseded|deprecated|pre-reform|dated|\bold', d):
        return 'old spelling'
    if 'misspell' in d:
        return 'misspelling'
    if re.search(r'eye[- ]dialect|pronunciation', d):
        return 'eye dialect'
    if re.search(r'clipping|aphetic|apocop|colloquial|informal', d):
        return 'colloquial'
    return 'alternative spelling'


# Votes the treebanks' readings of a spelling count as against the subtitle estimate: sé seen 14 times moves it by 14/34.
UD_WEIGHT = 20
# An imperative or a subjunctive (rare_form) never takes more than half a spelling from a noun written exactly so.
RARE_FLOOR = 0.5
# The prior (prior.tsv.gz): spellings the subtitles saw at least this often get a line from them, and the subtitle
# estimate counts as at most this many treebank tokens.
PRIOR_MIN_SUBTITLES = 20
SUBTITLE_TRUST = 200
CONFIDENT_SHARE = 0.85            # a reading this much of a spelling is a confident estimate
# Labels that are not a place, though capitalized: a sense with only these is no dialect's.
NOT_PLACES = {'Internet', 'Internet slang', 'Roman Catholicism', 'Catholicism', 'Christianity', 'Judaism', 'Islam',
              'Buddhism', 'Hinduism', 'Greek mythology', 'Roman mythology', 'Norse mythology', 'Freemasonry', 'Marxism',
              'Bible', 'Biblical', 'Classical', 'Ancient Greece', 'Ancient Rome', 'Christmas', 'Easter', 'Lent'}


def regional(notes):
    """A sense labeled with a place (La Rioja, Mexico, Andalusia) or as dialect."""
    return any((n[:1].isupper() and n not in NOT_PLACES and not n.startswith('Internet')) or
               re.search(r'\b(?:dialect|dialectal|regional)\b', n) for n in notes)


# Labels of a sense a reader of a book rarely means where the word stands alone: slang, a specialist's, a place's.
SLANG_LABELS = {'slang', 'vulgar', 'Internet', 'Internet slang', 'computing', 'derogatory', 'offensive', 'neologism',
                'criminal slang', 'youth slang', 'prison slang', 'Multicultural London English', 'text messaging'}


# Trades whose word for a thing is not what a book means by it: fr ferme {carpentry} "roof truss" before "farm". Not
# anatomy or zoology, which label the plain sense (ojo {anatomy} "eye").
TRADES = set('''carpentry knitting assaying sewing weaving masonry heraldry bookbinding glassmaking falconry printing
    typography juggling billiards dominoes archery fencing mining metallurgy bullfighting'''.split())
# Regions too wide to make a sense unusual (coche {Spain} "car", a reflexive {Latin America} "to get up").
BROAD_REGIONS = set('''Spain Mexico Argentina Brazil Portugal France Belgium Switzerland Austria Germany Russia Italy
    Canada Quebec US UK'''.split()) | {'Latin America', 'Latin-America', 'Central America', 'South America', 'Americas',
                                         'Rioplatense', 'Caribbean', 'Andes', 'North America', 'Brazilian Portuguese',
                                         'European Portuguese', 'Southern Germany', 'Northern Germany'}


def marked_notes(notes):
    """A sense of slang, a specialist's or a narrow region's (poder {reflexive, El Salvador} "to be familiar", colocar
    {slang} "to take drugs"): never a reflexive verb's hint."""
    return bool(set(notes) & (TOPICAL | SLANG_LABELS)) or regional([n for n in notes if n not in BROAD_REGIONS])


def dialect_only(en):
    """Every sense of the entry is a place's or a dialect's (rica "fenugreek" in La Rioja)."""
    return bool(en.senses) and all(regional(notes) or weak_notes(notes) for notes, _ in en.senses)


# ---------------------------------------------------------------------------------------------------- pronouns ---

PERSONS = {'first-person', 'second-person', 'third-person'}
GENDERS = {'masculine', 'feminine', 'neuter'}
DEIXIS = {'proximal', 'medial', 'distal'}


def shared_table(code, key, pos, forms):
    """Wiktionary gives every personal pronoun the whole table of them (Russian я lists ты, мы, вами; German ich lists
    ihm and uns) and every Spanish demonstrative the whole table of demonstratives (éste lists eso and aquello). The rows
    that are not this headword's own column: (rows to drop, {row: identity}), or None for any other table.

    A row's identity is (person, number, gender, distance, reflexive). Russian tags мы's rows like я's (first-person,
    no number): in each case the first run of first-person rows is the singular, the next the plural."""
    if pos not in ('pron', 'det'):
        return None
    rows = [(i, f) for i, f in enumerate(forms) if len(f) > 2 and f[2] in ('declension', 'inflection')]
    if not rows or not any(set(f[1]) & (PERSONS | DEIXIS) for _, f in rows):
        return None
    ident = {}
    case, prev, runs = None, None, collections.Counter()
    for i, f in rows:
        tags = set(f[1])
        c = next((t for t in tags if DIM_OF.get(t) == 'case'), None)
        if c != case:
            case, prev, runs = c, None, collections.Counter()
        ts = frozenset(tags)
        person = frozenset(tags & PERSONS)
        number = frozenset(tags & {'singular', 'plural'})
        if ts != prev and len(person) == 1:
            runs[person] += 1
        prev = ts
        if len(person) == 1 and not number:
            number = frozenset(['singular' if runs[person] == 1 else 'plural'])
        ident[i] = (person, number, frozenset(tags & GENDERS), frozenset(tags & DEIXIS), 'reflexive' in tags)
    mine = [(i, f) for i, f in rows if fold(code, SUPERSCRIPT.sub('', f[0])) == key]
    own = [ident[i] for i, f in mine if 'nominative' in f[1]] or [ident[i] for i, _ in mine]
    if not own:
        return None

    def fits(r, h):
        if h[3]:                       # a demonstrative: its distance (éste, ésta, esto, éstos; not eso)
            return r[3] == h[3]
        if r[0] != h[0] or r[1] != h[1] or r[4] != h[4]:
            return False
        return not h[2] or not r[2] or bool(r[2] & h[2])
    return {i for i, _ in rows if not any(fits(ident[i], h) for h in own)}, ident


def object_pronoun(ident):
    """The English object pronoun of a personal pronoun's row: меня "me", ему "him", нам "us", ihnen "them"."""
    person, number, gender, deixis, refl = ident
    if deixis or refl:
        return ''
    if not person:
        return 'you'                   # German du, ihr, Sie: kaikki tags their rows without a person
    p = next(iter(person))
    if p == 'first-person':
        return 'us' if 'plural' in number else 'me'
    if p == 'second-person':
        return 'you'
    if 'plural' in number:
        return 'them'
    return 'him' if 'masculine' in gender else 'her' if 'feminine' in gender else 'it'


# ------------------------------------------------------------------------------------------------- Russian stress ---

# How often a Russian noun's singular or plural stands in each case in running text (rough shares from the treebanks):
# what decides which stress a spelling shared by two cells gets first.
CASE_SHARE = {'nominative': .30, 'accusative': .25, 'genitive': .22, 'locative': .10, 'prepositional': .08,
              'instrumental': .08, 'dative': .05, 'partitive': .02, 'vocative': .01}


def plural_share(cells, surface_count):
    """How much of a Russian noun's use is plural, from its dative, instrumental and prepositional forms in the subtitles
    (глаза́ми against гла́зом: eyes are mostly plural, a face, лицо́м against ли́цами, singular)."""
    n = {'singular': 0, 'plural': 0}
    for fk, cell in cells.items():
        nums = {t for ts, _ in cell for t in ts if t in n}
        if len(nums) == 1 and any(ts & {'dative', 'instrumental', 'prepositional'} for ts, _ in cell):
            n[next(iter(nums))] += surface_count.get(fk, 0)
    return (n['plural'] + 0.3) / (n['plural'] + n['singular'] + 1)


def stress_groups(cell, p_plural):
    """A Russian spelling's cells grouped by where the stress falls (глаза: гла́за genitive singular, глаза́ nominative
    and accusative plural), as [(tag sets, written spelling)], the reading likelier in running text first: for a noun by
    its plural share and the case shares, else in the table's order. A cell whose spelling marks no stress joins the
    first group."""
    groups = collections.OrderedDict()       # stress index -> [tag sets, written, first place]
    loose = []
    for place, (ts, wr) in enumerate(cell):
        si = stress_index('ru', wr) if wr else -1
        if si < 0:
            loose.append(ts)
            continue
        g = groups.setdefault(si, [[], wr, place])
        if ts not in g[0]:
            g[0].append(ts)
    if not groups:
        return [(loose, cell[0][1] if cell else None)]
    order = list(groups.values())
    if p_plural is not None and len(order) > 1:
        def share(ts):
            num = p_plural if 'plural' in ts else 1 - p_plural
            return num * max((CASE_SHARE.get(t, 0) for t in ts), default=0.05)
        order.sort(key=lambda g: (-sum(share(ts) for ts in g[0]), g[2]))
    first = order[0][0]
    first.extend(ts for ts in loose if ts not in first)
    return [(g[0], g[1]) for g in order]


# ------------------------------------------------------------------------------------------------------ build ---

Entry = collections.namedtuple('Entry', 'key head reading pos gender senses weak seq')

# Labels of a specialist's sense. Among sections of one headword and part of speech that the treebanks cannot tell apart,
# one that opens with such a sense goes after one that does not: mate the drink before mate in chess.
TOPICAL = set('''chess basketball sports sport soccer football tennis baseball golf cricket poker cards computing mathematics
    geometry arithmetic physics chemistry law music nautical military medicine pathology biology botany zoology anatomy
    grammar linguistics finance economics heraldry architecture printing typography electronics engineering geology
    astronomy philosophy theology mythology politics statistics logic bullfighting fencing hunting fishing agriculture
    aviation firearms programming genetics psychology carpentry knitting assaying sewing weaving masonry glassmaking
    bookbinding'''.split()) | {'card games', 'rail transport', 'Roman Catholicism'}


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
    "there is" though haber is "to have"); "+phrase" -> a fixed phrase of common words alone that phrases.tsv.gz may
    list (write_phrases), with its hint or "" for Wiktionary's."""
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
    pointers = []                        # (form, target word, pos, description, written spelling or None, kind)
    phrase_entries = []                  # multiword entries (sin embargo, parce que), for phrases.tsv.gz
    n_read = 0

    def intern(x):
        return interned.setdefault(x, x)

    token_pref = {}                               # (entry, token) -> place among the tokens of its rule (Russian)
    own_forms = set()                             # folded forms some entry's own table lists (not a pointer)
    pronoun_hints = collections.defaultdict(set)  # folded oblique pronoun -> its English (меня "me", ihm "him")
    other_gender = []                             # (entry, [(folded form, tags)]): muchacho's muchacha, decided later
    bare_female = set()                           # entries that are only "female equivalent of X" (profesora)
    closed_forms = set()                          # folded forms a pronoun, determiner, article or adjective lists
    form_owner = collections.defaultdict(list)    # folded form of a contraction, determiner... -> [(entry, desc)]
    degree_forms = {}                             # (entry, folded form) -> [(tags, written)]: comparatives, decided later
    aspects = {}                                  # Russian verb entry -> (aspect, [partners])
    # Russian: how often each spelling occurs in the subtitles, to put the likelier stress of a spelling first.
    surface_count = {}
    yo_count = {}                                 # a spelling with ё, and the same with е, as the subtitles wrote them
    if cfg.get('stress'):
        for word, count in iter_freq(code, freq_path):
            if count < 3:
                break
            surface_count[fold(code, word)] = surface_count.get(fold(code, word), 0) + count
            if 'ё' in word:
                yo_count[word] = yo_count.get(word, 0) + count
        plain_ = {w_.replace('ё', 'е') for w_ in yo_count}
        for word, count in iter_freq(code, freq_path):
            if count < 3:
                break
            if word in plain_:
                yo_count[word] = yo_count.get(word, 0) + count

    def add_token(idx, fk, desc, written, pref=0):
        """A form of entry idx: the rule that makes it, its description and (Russian) its stress. `pref` orders the tokens
        of one rule (0 first): the engine keeps the first of an entry's equally likely readings of a spelling."""
        k = entries[idx].key
        c = lcp(k, fk)
        tok = (rules.setdefault((k[c:], fk[c:]), len(rules)), descs.setdefault(desc.strip(), len(descs)))
        if code == 'ru' and written:
            si = stress_index(code, written)
            if si >= 0 and vowel_count(fk) > 1:
                tok = tok + (si - c,)
        entry_tokens[idx].add(tok)
        if pref:
            token_pref[(idx, tok)] = pref
        covered.add(hash((idx, fk)))

    for e in kaikki.entries(cfg['name'], extract_in=extract):
        n_read += 1
        w = (e.get('w') or '').strip()
        pos = e.get('p') or ''
        if not w or pos in SKIP_POS or ' ' in w or len(w) > 40:
            if w and ' ' in w and pos not in ('proverb', 'name', 'symbol', 'character', 'romanization'):
                phrase_entries.append(e)
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
            # The gloss that points: the last one ("inflection of ver:" heads "second-person singular imperative"; medio's
            # "middle (the part …)" heads "synonym of médium", whose description is "synonym", not "middle (the part").
            pg = gl[-1] if gl else ''
            heading = len(gl) > 1 and gl[0].endswith(':')
            if not desc and pg:
                m = re.match(r'^(.*?)\s+of\s+', pg)
                desc = (m.group(1) if m else (pg if heading else '')).strip()
                desc = re.sub(r'^(?:inflection|form)$', '', re.sub(r'\s*\([^()]*\)', '', desc).strip())
            kind = ('synonym' if re.match(r'^synonym\b', pg, re.I) else
                    'derived' if DERIVED_GLOSS.match(pg) or set(stags) & {'agent', 'nomen-agentis', 'female'} else
                    'variant' if VARIANT_DESC.match(desc) or (s.get('alt_of') and not any(t in ORDER for t in stags)) else
                    'inflection')
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
                    pointers.append((w, intern(tw), intern(pos), intern(desc[:80]), written if written != w else None,
                                     kind))
        # A section Wiktionary heads as a form ("verb form": había, est, сказала) is the lemma's: an explanation it
        # adds ("makes pluperfect to verbs") must not make había a word of its own.
        if rows and any(re.search(r'\bforms?$', (h.get('a') or {}).get('2', '')) for h in e.get('h') or [] if h.get('n') == 'head') \
                and any(s.get('form_of') or s.get('alt_of') for s in senses):
            rows = []
        female_only = adjectival = False
        if pos == 'noun':
            # profesora is only "female equivalent of profesor": a word of its own all the same, "female teacher" (filled
            # in from profesor's hint when the entries are written), not a form of profesor. loba is first "female
            # equivalent of lobo, a she-wolf", then slang "fox": the she-wolf stays its first sense.
            for j, s in enumerate(senses):
                m = FEMALE_OF.match(clean_gloss((s.get('glosses') or [''])[-1]))
                if m and not set(s.get('tags') or []) & {'slang', 'colloquial', 'vulgar', 'dated', 'obsolete', 'archaic'}:
                    # "… of primo (“female cousin”)", "… of muchacho: girl, young lady": the meaning Wiktionary gives;
                    # else "female" and profesor's hint. Beside senses of its own (china "china", carolina "cockatiel")
                    # only a first sense that says what it means (loba "a she-wolf") leads them.
                    q = m.group(2) or m.group(3)
                    if rows and (j or not q):
                        break
                    female_only = not rows
                    # German die Arme "female pauper", die Reisende: a feminine adjective used as a noun, spelled like
                    # the plural of Arm and of der Reisende, which a book means far more often.
                    adjectival = 'adjectival' in (s.get('tags') or [])
                    rows = [(['feminine of ' + m.group(1)], [q or FEMALE_MARK + m.group(1)])] + rows
                    break
        if not rows:
            continue
        real = [s for s in senses if not (s.get('form_of') or s.get('alt_of'))]
        weak = all(weak_notes(notes) for notes, _ in rows) or adjectival
        # Hühner is first the plural of Huhn; what is left of it, slang "a loud group of women", never leads.
        if not weak and len(rows) < len(senses) and all(marked_notes(notes) for notes, _ in rows) and any(
                s.get('form_of') or s.get('alt_of') or is_pointer((s.get('glosses') or [''])[-1]) for s in senses):
            weak = True
        idx = len(entries)
        # Russian: the stressed spelling, and a head with ё (её, ещё) too, whose ё a book prints as е (ее, еще).
        reading = written if written != w or (cfg.get('stress') and 'ё' in w.lower() and vowel_count(w) > 1) else ''
        entries.append(Entry(key, w, reading, pos, gender_of(e, real), rows[:8], weak, len(by_key[key])))
        by_key[key].append(idx)
        if female_only and rows[0][1][0].startswith(FEMALE_MARK):
            bare_female.add(idx)
        if code == 'ru' and pos == 'verb':
            for h in e.get('h') or []:
                a = h.get('a') or {}
                if h.get('n') == 'ru-verb' and a.get('2') in ASPECTS:
                    partners = [re.sub(r'<[^<>]*>', '', x).strip() for x in
                                re.split(r',', a.get('impf') or a.get('pf') or '') if x.strip()]
                    aspects[idx] = (ASPECTS[a['2']], [x for x in partners if x and ' ' not in x][:3])
                    break
        sense_tags = {t for x in real for t in (x.get('tags') or [])}
        feminine_head = 'feminine' in sense_tags and 'masculine' not in sense_tags
        own_gender = entries[idx].gender
        forms = e.get('f') or []
        table = shared_table(code, key, pos, forms)
        cells = collections.OrderedDict()         # folded form -> [(tag set, written spelling)]
        others = []
        for i, f in enumerate(forms):
            form, tags = SUPERSCRIPT.sub('', f[0]), f[1] or []
            if code == 'it':
                form = italian_spelling(form)
            if table and i in table[0]:
                continue
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
            # muchacho lists muchacha as its feminine, but muchacha is a noun of its own ("girl", not "boy"); parrain's
            # marraine, Reisender's Reisende the same. Decided once every entry is read.
            if pos == 'noun' and own_gender == 'm' and 'feminine' in tags and 'masculine' not in tags:
                others.append((fk, frozenset(tags), form))
                continue
            ts = frozenset(tags)
            if pos == 'adj' and ts & {'comparative', 'superlative'}:
                # bien lists meilleur as its comparative, but meilleur is an adjective of its own ("better"): decided
                # once every entry is read.
                cell = degree_forms.setdefault((idx, fk), [])
                if (ts, form) not in cell:
                    cell.append((ts, form))
                continue
            cell = cells.setdefault(fk, [])
            if (ts, form) not in cell:
                cell.append((ts, form))
            if table and len(f) > 2 and set(tags) & OBLIQUE:
                # A personal pronoun's object form is glossed as one: меня "me", ihm "him", not я "I", er "he". German
                # genitives (meiner, deiner) are spelled like the possessives, and capitals are the polite Sie's.
                eng = object_pronoun(table[1][i])
                if eng and not (code == 'de' and (form[:1].isupper() or 'genitive' in tags)):
                    pronoun_hints[fk.lower()].add(eng)
            # French tables give the past participle once; it agrees like an adjective (terminée, délivrés).
            if code == 'fr' and pos == 'verb' and set(tags) == {'participle', 'past'}:
                for end, extra in (('e', ('feminine', 'singular')), ('s', ('masculine', 'plural')), ('es', ('feminine', 'plural'))):
                    if end == 's' and fk.endswith('s'):
                        continue
                    agreed = fk + end if not (fk.endswith('s') and end == 'es') else fk + 'es'
                    cells.setdefault(agreed, []).append((frozenset(('participle', 'past') + extra), ''))
            # Italian tables too: "è stata una nottata d'inferno" (Pinocchio) is essere's stata, not stato "state".
            if code == 'it' and pos == 'verb' and set(tags) == {'participle', 'past'} and fk.endswith('o'):
                for end, extra in (('a', ('feminine', 'singular')), ('i', ('masculine', 'plural')), ('e', ('feminine', 'plural'))):
                    cells.setdefault(fk[:-1] + end, []).append((frozenset(('participle', 'past') + extra), ''))
        if others:
            other_gender.append((idx, others))
        if code == 'ru':
            p_plural = plural_share(cells, surface_count) if pos == 'noun' else None
        for fk, cell in cells.items():
            own_forms.add(fk)
            if pos in ('pron', 'det', 'article', 'adj'):
                closed_forms.add(fk)
            if code != 'ru':
                add_token(idx, fk, merge_descriptions([ts for ts, _ in cell]), None)
                if pos in ('contraction', 'det', 'pron', 'article'):
                    form_owner[fk].append((idx, merge_descriptions([ts for ts, _ in cell])))
                continue
            for pref, (tagsets, wr) in enumerate(stress_groups(cell, p_plural)):
                add_token(idx, fk, merge_descriptions(tagsets), wr, pref)

    adj_keys = {k for k, ids in by_key.items() if any(entries[i].pos == 'adj' for i in ids)}
    for (idx, fk), cell in degree_forms.items():
        if fk not in adj_keys:
            own_forms.add(fk)
            for pref, (tagsets, wr) in enumerate(stress_groups(cell, None) if code == 'ru' else [([t for t, _ in cell], None)]):
                add_token(idx, fk, merge_descriptions(tagsets), wr, pref)
    del degree_forms, adj_keys

    # carrera is a race before it is the "female equivalent of carrero", and una an article before the "feminine of uno":
    # a bare female equivalent is a word of its own only where its spelling is nothing else (profesora, muchacha).
    # Nor where it is a pronoun's or an adjective's form (pt minha is meu's, not a "female mine"; fr meilleure is meilleur's,
    # not a "female best"), or an abbreviation (Sra.).
    for idx in sorted(bare_female):
        en = entries[idx]
        if any(i != idx and i not in bare_female and entries[i].pos != 'name' for i in by_key[en.key]) or \
                en.key in closed_forms or '.' in en.key:
            by_key[en.key].remove(idx)
    del bare_female

    # muchacho's muchacha, parrain's marraine: a form of the masculine only when it is no noun of its own.
    noun_keys = {en.key for k, ids in by_key.items() for en in (entries[i] for i in ids) if en.pos == 'noun'}
    for idx, others in other_gender:
        if any(fk in noun_keys for fk, _, _ in others):
            continue
        cells = collections.OrderedDict()
        for fk, ts, form in others:
            cells.setdefault(fk, []).append((ts, form))
        for fk, cell in cells.items():
            own_forms.add(fk)
            for pref, (tagsets, wr) in enumerate(stress_groups(cell, None) if code == 'ru' else [([t for t, _ in cell], None)]):
                add_token(idx, fk, merge_descriptions(tagsets), wr, pref)
    del other_gender

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

    # A pointer at a word that is itself only a pointer (Italian un' -> una -> uno, fué -> fue -> ser) follows it, up to
    # two steps.
    pointed = collections.defaultdict(list)
    for form, tw, pos, desc, written, kind in pointers:
        pointed[fold(code, form)].append((tw, pos, desc, kind))

    def resolve(tw, pos, depth=0):
        """The entries a pointer reaches: (entry, the description the next step gives (fue: "third-person singular
        preterite indicative" of ser), None when it points at a headword; the description of a spelling variant on the
        way (pt tive is "first-person singular preterite indicative of tar", and tar a "clipping of estar"), or None)."""
        ids = target_entries(tw, pos)
        # Dom Casmurro's á is the "pre-reform spelling of à", and à is ao's feminine, not à the preposition "in": a
        # pointer at a contraction's or a determiner's form reaches the word whose form it is.
        owners = [(i, d) for i, d in form_owner.get(fold(code, tw), ()) if entries[i].pos == pos]
        if owners and not any(entries[i].pos == pos for i in ids):
            return [(i, d or None, None) for i, d in owners]
        if ids or depth >= 2:
            return [(i, None, None) for i in ids]
        out = {}
        for tw2, pos2, desc2, kind2 in pointed.get(fold(code, tw), ()):
            # ves is "plural of ve", the letter v; ve is also "go!" (ir). A step that changes the part of speech is
            # another word spelled alike, and ves must not become a "feminine plural" of ir.
            if POS_FAMILY.get(pos2, pos2) != POS_FAMILY.get(pos, pos):
                continue
            for i, d, via in resolve(tw2, pos2 if pos2 in ('verb', 'noun', 'adj') else pos, depth + 1):
                out.setdefault(i, (d or (desc2 if kind2 == 'inflection' else None), via or (desc2 if kind2 == 'variant' else None)))
        return [(i, d, via) for i, (d, via) in out.items()]

    # Words with an entry of their own, and the few spellings a pointer must not take over.
    # Not one that is only archaic (pt á "wing", which a pre-reform á "to the" must not become).
    word_keys = {k for k, ids in by_key.items() if any(entries[i].pos != 'name' and not entries[i].weak for i in ids)}
    clitic_form = CLITIC_FORM.get(code)
    n_pointer_pairs = 0
    n_dropped = collections.Counter()
    for form, tw, pos, desc, written, kind in pointers:
        fk = fold(code, form)
        # cuarto is "synonym of dinero" in Andalusia, ay "obsolete spelling of hay", Schneider "agent noun of
        # schneiden", muchacha "female equivalent of muchacho": a word with an entry of its own is that word, and
        # the pointer would only put another word's meaning first (¡Ay! read as haber "to have"). An elision is
        # grammar, not spelling: l' "the" is still le the pronoun's l' in "je l'ai vu".
        if kind in ('synonym', 'variant', 'derived') and (fk in word_keys if kind != 'derived' else fk in noun_keys) \
                and not ELISION_DESC.search(desc):
            n_dropped[kind] += 1
            continue
        # aquella is aquel's feminine before it is the accentless aquélla; haberlo is haber + lo before it is an archaic
        # spelling of habérselas.
        if kind == 'variant' and (fk in own_forms or (clitic_form and clitic_verb(clitic_form, fk, by_key, entries))):
            n_dropped[kind] += 1
            continue
        for idx, inner, via in resolve(tw, pos):
            d = desc
            if inner and kind == 'variant':
                # fué is the "superseded spelling of fue": fue's own description (ser and ir's preterite), as old spelling.
                d = inner + ' (' + variant_word(desc) + ')'
            elif via and kind != 'variant' and not d.endswith(')'):
                # tive by way of the clipped tar is estar's only in Portugal's speech; ter's tive is the plain one.
                d = (d + ' (' + variant_word(via) + ')').strip()
            # A verb's forms are persons, tenses and participles; "feminine plural" of ir is a mistaken chain.
            if entries[idx].pos == 'verb' and GENDER_NUMBER_ONLY.match(d):
                n_dropped['verb gender'] += 1
                continue
            if fk == entries[idx].key or hash((idx, fk)) in covered:
                continue
            n_pointer_pairs += 1
            add_token(idx, fk, d, written or form)
    del pointers, covered

    # ---- paradigms, and matching a written word through them (as the engine does)
    paradigms = {}
    entry_paradigm = {}
    n_pairs = sum(len(t) for t in entry_tokens.values())
    for idx, toks in entry_tokens.items():
        # Sorted by rule (the engine binary-searches them), and within a rule in the order add_token was given: Russian
        # глаза's nominative-plural глаза́ before its genitive-singular гла́за.
        order_ = sorted(toks, key=lambda t: (t[0], token_pref.get((idx, t), 0), t))
        entry_paradigm[idx] = paradigms.setdefault(tuple(order_), len(paradigms))
    del entry_tokens, token_pref
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

    def yo_rank(i):
        """Russian: 0 for a section spelled the way the subtitles nearly always write its key, 1 otherwise. небо "sky"
        is written so 4,075 times to нёбо "palate" 51 times, and leads; все (722,378) and всё (373,088) stay as the
        treebanks order them, for subtitles often write всё as все."""
        if not yo_count:
            return 0
        head = unicodedata.normalize('NFC', ACCENTS.sub('', unicodedata.normalize('NFD', entries[i].head.lower())))
        plain = head.replace('ё', 'е')
        others = {unicodedata.normalize('NFC', ACCENTS.sub('', unicodedata.normalize('NFD', entries[j].head.lower())))
                  for j in by_key[entries[i].key]} - {head}
        if not others:
            return 0
        if 'ё' in head:
            return 1 if yo_count.get(plain, 0) >= 10 * max(yo_count.get(head, 0), 1) and plain in others else 0
        return 0 if any(yo_count.get(plain, 0) >= 10 * max(yo_count.get(o, 0), 1) for o in others if 'ё' in o) else 0

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
            # A name is no evidence about the word it is spelled like once folded: Costa Rica's Rica (19 times in AnCora)
            # made rica "fenugreek" (La Rioja) the reading of "una carne muy rica" (Quiroga), and Pierre the reading of
            # pierre. The engine tells names by their capital; the prior is for the common words.
            if upos == 'PROPN' and not cfg.get('keep_case'):
                continue
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
            tiers = ud.UPOS.get(upos, [])
            if upos not in CLOSED_UPOS:
                # An open-class reading belongs to an entry the treebank names or that is spelled like the word, in
                # whichever tier has one; never to any verb at all. Russian treebanks call жаль "it's a pity" a VERB with
                # the lemma жаль, and the first tier's only verb was жалить "to sting", whose imperative is spelled
                # жаль: "Вам жаль меня" (Dostoevsky) read "to sting", and жалить ranked 312.
                own = [t for t in tiers if any(POS_NAMES.get(entries[i].pos, entries[i].pos) in t and
                                               (i in exact or entries[i].key == lemma) for i in cands)]
                tiers = own[:1]
            for tier in tiers:
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
                    pick = same or named or spelled
                # One section per headword and part of speech takes it: the first the page gives, a specialist's (chess) after.
                firsts = {}
                for i in sorted(pick, key=lambda i: (yo_rank(i), topical(entries[i]), entries[i].seq)):
                    firsts.setdefault((entries[i].key, entries[i].pos), i)
                pick = list(firsts.values())
                for i in pick:
                    mass[i] += n / len(pick)
                break
        return mass or None

    # ---- how often each word is used: the subtitle counts of its spellings, shared among the words a spelling can be
    paradigm_descs = [None] * len(paradigms)      # paradigm -> {rule: (descriptions, …)}
    for p, i in paradigms.items():
        rd = collections.defaultdict(list)
        for t in p:
            if t[1] not in rd[t[0]]:
                rd[t[0]].append(t[1])
        paradigm_descs[i] = {r: tuple(ds) for r, ds in rd.items()}

    def match_cells(fk):
        """[(entry, description)] a folded written word can be, -1 for the headword itself."""
        out = [(i, -1) for i in by_key.get(fk, ())]
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
                        out.extend((i, d) for d in paradigm_descs[p][r])
        return out

    def surface_cells(word):
        fk = fold(code, word)
        cells = match_cells(fk)
        if cfg.get('keep_case') and fk:
            cells += match_cells(fk[:1].upper() + fk[1:])
        return [(i, d) for i, d in cells if entries[i].pos != 'name']

    # A spelling counts fully toward the one word it can be. Where it can be several, it is shared by how common each
    # word is and how often a word of that part of speech stands in that form ("cell"): sé is far likelier saber's "I
    # know" than ser's imperative "be!", though ser is the commoner verb, because imperatives are rare; montes is monte's
    # plural, not montar's "that you ride". How common a word is comes from its unambiguous spellings first, then from the
    # shares themselves (three rounds). The word spelled exactly like the form starts with a floor, so como "like" is not
    # swallowed by comer before it has a count of its own; a word that is all archaic, dialect (rica "fenugreek" in La
    # Rioja) or a female noun formed from an adjective (die Arme, die Reisende, beside Arme "arms") gets none.
    base = collections.Counter()
    unambiguous = []                              # (key, part of speech, description, count): spellings of one reading
    ambiguous = []
    counts = {}       # the subtitle counts the pronominal test below needs (infinitives and their clitic forms)
    keep_count = re.compile(r'(?:r|re|rse|rme|rte|rnos|ros|rsi|rmi|rti|rci|rvi)$')
    known_ = lambda w_: bool(match(w_))                                      # noqa: E731
    phrase_words = {w_ for e_ in phrase_entries for w_ in phrase_words_of(code, e_['w'], known_)}
    phrase_words |= {w_ for k_ in curated if k_.startswith('+') for w_ in phrase_words_of(code, k_[1:], known_)}
    word_count = {}                               # the subtitle counts of the words of fixed phrases
    top_words = set()                             # the commonest words, which a phrase of them alone must be listed
    for word, count in iter_freq(code, freq_path):
        if count < 3:
            break
        if len(top_words) < PHRASE_TOP_WORDS:
            top_words.add(fold(code, word).lower())
        if keep_count.search(word):
            counts.setdefault(word, count)
        if word in phrase_words:
            word_count[word] = word_count.get(word, 0) + count
        cells = surface_cells(word)
        ks = {entries[i].key for i, _ in cells}
        if not ks:
            continue
        if len(ks) == 1:
            base[next(iter(ks))] += count
            pos_set = {POS_NAMES.get(entries[i].pos, entries[i].pos) for i, _ in cells}
            if len(pos_set) == 1 and len({d for _, d in cells}) == 1:
                unambiguous.append((next(iter(ks)), pos_set.pop(), cells[0][1], count))
        else:
            ambiguous.append((tuple(cells), count, fold(code, word)))

    def floor_ok(k):
        for i in by_key.get(k, ()):
            en = entries[i]
            # Nor an interjection, which is mostly a verb's imperative itself (it vattene "go away!" is andarsene's).
            if en.pos in ('name', 'intj') or en.weak or dialect_only(en):
                continue
            if en.gender == 'f' and en.senses and en.senses[0][1][0].startswith('female '):
                continue
            return True
        return False
    floor = {k: floor_ok(k) for k in {fk for _, _, fk in ambiguous} | {fk[:1].upper() + fk[1:] for _, _, fk in ambiguous}
             if k in by_key}

    # How often a word of a part of speech stands in each form, from the spellings that can be only one reading.
    cell_n = collections.Counter()                # (part of speech, description) -> count
    pos_n = collections.Counter()                 # part of speech -> count
    for k, pos, d, count in unambiguous:
        cell_n[(pos, d)] += count
        pos_n[pos] += count
    del unambiguous

    descs_text = {v: k for k, v in descs.items()}

    def rare_form(d):
        """An imperative or a subjunctive and nothing else: forms a reader meets far less than the cells counted from
        unambiguous spellings suggest (which undercount the first person, whose -o is so often a noun's too)."""
        t = descs_text.get(d, '') if d != -1 else ''
        return bool(re.search(r'imperative|subjunctive', t)) and not re.search(r'indicative|participle|infinitive|gerund', t)

    def p_cell(e, d):
        pos = POS_NAMES.get(entries[e].pos, entries[e].pos)
        return (cell_n.get((pos, d), 0) + 0.5) / (pos_n.get(pos, 0) + 50)

    def ud_share(fk, ks):
        mass = ud_mass(fk) if not cfg.get('keep_case') else (ud_mass(fk) or ud_mass(fk[:1].upper() + fk[1:]))
        by = collections.Counter()
        for i, m in (mass or {}).items():
            if entries[i].key in ks:
                by[entries[i].key] += m
        return by, sum(by.values())

    shares = {}                                   # folded form -> ({key: share}, {entry: weight}, treebank count)
    n_rare_floor = []
    lemma_w = {k: base[k] + 1 for k in base}
    for rnd in range(3):
        total = collections.Counter(base)
        for cells, count, fk in ambiguous:
            w_entry = collections.Counter()
            # An interjection spelled like another word's form is mostly that form itself (it vattene "go away!" is
            # andarsene's imperative, es venga "come on!" venir's), and takes none of the spelling from it.
            other_key = {entries[i].key for i, _ in cells if entries[i].pos != 'intj'}
            if rnd == 0:
                # The floor stands where the treebanks do not read the spelling as another word: they have "so" as
                # sapere's "I know" every time, never so "under" (Non lo so, Pinocchio).
                ud_by, ud_n = ud_share(fk, {entries[i].key for i, _ in cells})
            for i, d in cells:
                k = entries[i].key
                if entries[i].pos == 'intj' and other_key - {k}:
                    continue
                lw = lemma_w.get(k, 1)
                if rnd == 0 and d == -1 and floor.get(k) and (k == fk or (cfg.get('keep_case') and k.lower() == fk.lower())) \
                        and not (ud_n >= 3 and ud_by[k] < 0.5 * ud_n):
                    lw += max(count * 0.5, 1)
                w_entry[i] += lw * p_cell(i, d)
            w_key = collections.Counter()
            for i, wv in w_entry.items():
                w_key[entries[i].key] += wv
            tw = sum(w_key.values()) or 1
            ks = sorted(w_key)
            share = {k: w_key[k] / tw for k in ks}
            # A word written exactly so is at least as likely as a rare form of another (an imperative, a vosotros form):
            # "de tanta sed" is thirst, though ser is ten thousand times commoner than sed and has an imperative sed.
            # Not an interjection, which is mostly the imperative itself (vattene "go away!" is andarsene's).
            own = next((k for k in ks if floor.get(k) and (k == fk or (cfg.get('keep_case') and k.lower() == fk.lower()))
                        and any(entries[i].pos in ('noun', 'adj') for i in by_key.get(k, ()))), None)
            # Not against a participle, which a book has after every auxiliary (it infilata is infilare's in "infilata
            # la porta di casa", not infilata "string").
            if own and share[own] < RARE_FLOOR and all(entries[i].key == own or rare_form(d) for i, d in cells):
                rest = (1 - share[own]) or 1
                share = {k: RARE_FLOOR if k == own else share[k] * (1 - RARE_FLOOR) / rest for k in ks}
                if rnd == 2:
                    n_rare_floor.append(fk)
            if rnd == 2:
                shares[fk] = (share, w_entry, count, cells)
            # Where the treebanks saw the form, their readings count as many votes as they saw it: a handful (sé 14
            # times) moves the subtitle estimate a little, thousands (una, the article) decide it.
            by, n = ud_share(fk, set(ks))
            if n:
                alpha = n / (n + UD_WEIGHT)
                share = {k: alpha * by[k] / n + (1 - alpha) * share[k] for k in ks}
            # Sorted: a key first met here enters `total` in a fixed place, so equal totals rank the same in every build
            # (a frozenset of strings iterates in a different order each run).
            for k in ks:
                total[k] += count * share[k]
        lemma_w = {k: v + 1 for k, v in total.items()}
    if stats:
        print(' pointers left out (a word of its own, a clitic verb, a verb\'s gender):', dict(n_dropped))
        print(f' rare-form floor on {len(n_rare_floor)} spellings:', ' '.join(sorted(n_rare_floor, key=lambda f: -base.get(f, 0))[:80]))
    ranked = sorted((k for k in total if total[k] > 0), key=lambda k: -total[k])
    rank_of = {k: i + 1 for i, k in enumerate(ranked)}
    for w_ in os.environ.get('DUSHU_DEBUG_WORDS', '').split():
        f_ = fold(code, w_)
        if f_ in shares:
            sh, we, c_, _ = shares[f_]
            print('DEBUG', w_, c_, 'ud', ud_share(f_, set(sh))[1], {k: round(v, 3) for k, v in sh.items()},
                  [(entries[i].key, entries[i].pos, round(v), round(lemma_w.get(entries[i].key, 0))) for i, v in we.most_common(5)])

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
        order.extend(sorted(ids, key=lambda i: (entries[i].weak, entries[i].pos == 'name', yo_rank(i), -section_weight(i),
                                                 topical(entries[i]), entries[i].seq)))
    new_id = {old: new for new, old in enumerate(order)}

    def hint_for(en):
        """The hint column: a curated hint as written (a verb's "main|reflexive", or the main one alone, which clears the
        reflexive hint), else the hint of the senses and, for a verb, of its first reflexive sense."""
        cur = curated.get(en.head + '|' + POS_NAMES.get(en.pos, en.pos), curated.get(en.head))
        if isinstance(cur, dict):
            cur = cur.get('hint') or hint_of([cur['gloss'].split('; ')], en.head, en.pos)
        if cur:
            return cur
        senses = en.senses
        # A first sense of a trade is not what a book means when another, unlabeled one follows: fr ferme {carpentry}
        # "roof truss" before "farm".
        if senses and senses[0][0] and set(senses[0][0]) <= TRADES and any(not notes for notes, _ in senses[1:4]):
            senses = [x for x in senses if not set(x[0]) & TRADES] + [x for x in senses if set(x[0]) & TRADES]
        hint = hint_of([g for _, g in senses], en.head, en.pos)
        rhint = reflexive_hint(en.senses, en.head) if en.pos == 'verb' else ''
        if en.pos == 'verb' and not rhint:
            # Italian files the pronominal verb apart (addormentarsi "to fall asleep" beside addormentare "to put to
            # sleep"), but its forms are the base verb's: "si addormentò" (Pinocchio) reads addormentare's.
            # Only one a reader meets (alzarsi, chiamarsi); a rare one's first sense is an idiom (scommettersi "to shatter").
            rk = reflexive_key(code, en.key)
            for i in (by_key.get(rk, ()) if rank_of.get(rk, 10 ** 9) <= REFLEXIVE_ENTRY_RANK else ()):
                if entries[i].pos == 'verb' and entries[i].senses:
                    rh = hint_of([g for _, g in entries[i].senses], entries[i].head, 'verb')
                    # Not "compound of the infinitive andare" (andarsi), nor the verb itself again (vedersi "to see or
                    # look", costruirsi "to build or construct"), nor a cut one.
                    verb_of = lambda h: next((w for w in re.findall(r'[a-z]+', h.lower()) if w not in EN_STOP), '')  # noqa: E731
                    if rh and not re.match(r'(?i)(?:compound|see)\b', rh) and en.head not in rh and \
                            not re.search(r'…|\betc\b', rh) and verb_of(rh) != verb_of(hint):
                        rhint = rh
                    break
        return hint + '|' + rhint if rhint and rhint != hint else hint

    # A female noun known only as the female of another (profesora) reads as "female" + that noun's hint.
    noun_hint = {}
    for idx in order:
        en = entries[idx]
        if en.pos == 'noun' and en.key not in noun_hint and not en.senses[0][1][0].startswith(FEMALE_MARK):
            noun_hint[en.key] = hint_for(en)
    for idx, en in enumerate(entries):
        if en.senses and en.senses[0][1][0].startswith(FEMALE_MARK):
            male = en.senses[0][1][0][len(FEMALE_MARK):]
            entries[idx] = en._replace(senses=[(en.senses[0][0], [female_gloss(noun_hint.get(fold(code, male)) or male)])]
                                       + en.senses[1:])

    lines = []
    for idx in order:
        en = entries[idx]
        hint = hint_for(en)
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

    # The prior: for a written word the dictionary reads several ways, how often each entry is meant. Two sources, as
    # for the ranks: the subtitle estimate (`shares`: sé is saber's "I know" 93 times in 100, not ser's "be!"; montes is
    # monte's plural 78 in 100) and the treebanks' readings, the treebanks trusted as far as they saw the word (UD_WEIGHT
    # votes against the estimate), so six treebank tokens of noirs as a noun do not outvote the subtitles.
    #   The subtitles tell keys apart, not the sections of one key (noir the noun and noir the adjective share every
    # count): each section of a key gets the key's whole share, and only the treebanks rank sections among themselves.
    #   The count column is how far the engine trusts the line: the treebank count, plus the subtitle count up to
    # SUBTITLE_TRUST (an estimate, however many subtitles it read, is not an observation).
    #   A proper noun is listed at the line's highest share: the subtitles are lower-cased and cannot tell a name from
    # the word it is spelled like, and the engine tells them by the capital.
    plines = []

    def confident(sub):
        """Whether the subtitle estimate says something: one reading takes most of the spelling (sé: saber 89 in 100),
        or every other reading is a rare form (montes: montar's "that you ride"). vino, the wine or venir's "came", is
        two common forms, whose split is the model's guess: the treebanks and the sentence decide it ("y vino con su
        padre")."""
        top = max(sub[0], key=sub[0].get)
        # A noun or adjective spelled exactly so is left to the sentence when the subtitles prefer another reading: pt
        # testa is a forehead in "com a testa um pouco franzida" (Missa do galo), though subtitles test things.
        if any(d == -1 and entries[i].key != top and entries[i].pos in ('noun', 'adj') for i, d in sub[3]):
            return False
        # Nor when the word spelled exactly so leads: its share stands on the floor it was given, not on counts (it so
        # "under" over sapere's "I know", as a guess; "Non lo so" is sapere).
        if any(d == -1 and entries[i].key == top for i, d in sub[3]):
            return False
        return sub[0][top] >= CONFIDENT_SHARE or all(entries[i].key == top or rare_form(d) for i, d in sub[3])

    forms_ = {fk for fk, (_, _, c, _) in shares.items() if c >= PRIOR_MIN_SUBTITLES}
    forms_ |= {fk for fk, an in ud_surface.items() if sum(an.values()) >= 3}
    for fk in sorted(forms_):
        cands = match(fk) | (match(fk[:1].upper() + fk[1:]) if cfg.get('keep_case') else set())
        cands = {i for i in cands if i in new_id}
        if len(cands) < 2:
            continue
        mass = ud_mass(fk) if not cfg.get('keep_case') else (ud_mass(fk) or ud_mass(fk[:1].upper() + fk[1:]))
        n_ud = sum(mass.values()) if mass else 0
        sub = shares.get(fk)
        if sub and (sub[2] < PRIOR_MIN_SUBTITLES or not confident(sub)):
            sub = None
        if not sub and not n_ud:
            continue
        alpha = n_ud / (n_ud + UD_WEIGHT) if sub else 1.0
        p = {}
        for i in cands:
            if entries[i].pos == 'name':
                continue
            ud_p = mass.get(i, 0) / n_ud if n_ud else 0
            p[i] = alpha * ud_p + (1 - alpha) * (sub[0].get(entries[i].key, 0) if sub else 0)
        top = max(p.values(), default=0)
        if top <= 0:
            continue
        for i in cands:
            if entries[i].pos == 'name':
                p[i] = top
        cells = sorted(((new_id[i], round(100 * v)) for i, v in p.items()), key=lambda x: (-x[1], x[0]))
        cells = [c for c in cells if c[1] >= 1]
        # A line that only repeats what every reading already is (all at the same share) says nothing.
        if len(cells) < 2 and len(cands) < 2 or len({c[1] for c in cells}) == 1 and len(cells) == len(cands):
            continue
        trust = n_ud + (min(sub[2], SUBTITLE_TRUST) if sub else 0)
        plines.append(fk + '\t' + ' '.join(f'{i}:{v}' for i, v in cells) + '\t' + str(round(trust)))
    write_gz(os.path.join(out_dir, 'prior.tsv.gz'), '# form\tentry:percent ...\ttrust (treebank count + subtitle estimate)\n' + '\n'.join(plines) + '\n')

    flines = ['# Dushu ' + cfg['name'] + ' forms: D description, R removed added, P paradigm tokens (rule.desc[.stress]).']
    for d, _ in sorted(descs.items(), key=lambda x: x[1]):
        flines.append('D\t' + d)
    for (rem, add), _ in sorted(rules.items(), key=lambda x: x[1]):
        flines.append('R\t' + rem + '\t' + add)
    for p, _ in sorted(paradigms.items(), key=lambda x: x[1]):
        flines.append('P\t' + ' '.join('.'.join(str(x) for x in t) for t in p))
    form_hints = {}
    for fk, engs in sorted(pronoun_hints.items()):
        if 'him' in engs:
            engs = engs - {'it'}      # ihm: er's "him" and es's "it"; the person reads better
        form_hints[fk] = ', '.join(sorted(engs, key=['me', 'us', 'you', 'him', 'her', 'it', 'them'].index))
    for ck, cv in curated.items():
        if ck.startswith('=') and isinstance(cv, str):
            form_hints[fold(code, ck[1:]).lower()] = cv
    for fk, h in form_hints.items():
        flines.append('H\t' + fk + '\t' + h)
    for idx, (asp, partners) in sorted(aspects.items(), key=lambda x: new_id.get(x[0], -1)):
        if idx in new_id:
            flines.append('A\t' + str(new_id[idx]) + '\t' + asp + '\t' + ','.join(partners))
    write_gz(os.path.join(out_dir, 'forms.tsv.gz'), '\n'.join(flines) + '\n')

    n_phrases = write_phrases(code, phrase_entries, word_count, top_words, known_, entries, curated, out_dir)

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
    sizes = {n: os.path.getsize(os.path.join(out_dir, n)) for n in ('entries.tsv.gz', 'forms.tsv.gz', 'prior.tsv.gz',
                                                                     'phrases.tsv.gz')}
    print(f'{code}: {n_read} read, {len(entries)} entries, {len(by_key)} keys, {n_pairs} form pairs '
          f'({n_pointer_pairs} from pointers), {len(rules)} rules, {len(paradigms)} paradigms, {len(descs)} descriptions, '
          f'{len(ranked)} ranked, {len(plines)} priors, {n_phrases} phrases; entries {sizes["entries.tsv.gz"] / 1e6:.2f} MB, '
          f'forms {sizes["forms.tsv.gz"] / 1e6:.2f} MB, prior {sizes["prior.tsv.gz"] / 1e6:.2f} MB, phrases '
          f'{sizes["phrases.tsv.gz"] / 1e6:.2f} MB; {time.time() - t0:.0f}s')
    if stats:
        print(' top ranked:', ranked[:60])
    return out_dir


# ------------------------------------------------------------------------------------------------------ phrases ---

# Fixed phrases a book has word for word (sin embargo "however", потому что "because", zum Beispiel "for example"):
# Wiktionary's entries of two to four words, every word common, the commonest PHRASE_MAX of them.
PHRASE_MAX = 4000
PHRASE_MIN_COUNT = 200            # subtitle count every word of a phrase reaches
PHRASE_GZ_MAX = 150_000
# A phrase made only of the commonest words is most often those words one by one ("y eso" is "and that", not "what's up";
# "para eso" is "for that", not "might as well"): it is written only when curated.json lists it ("+por eso").
PHRASE_TOP_WORDS = 150
PHRASE_POS = {'adv', 'conj', 'prep', 'intj', 'phrase', 'adj', 'pron', 'det', 'particle', 'noun', 'verb', 'num',
              'contraction', 'postp'}
CLOSED_POS = {'article', 'det', 'pron', 'prep', 'conj', 'contraction', 'particle', 'postp'}
# A definite article and a noun are most often just that ("dijo la verdad" is the truth, not la verdad "honestly").
DEFINITE = {'es': {'el', 'la', 'los', 'las', 'lo'}, 'fr': {'le', 'la', 'les', "l'"},
            'it': {'il', 'lo', 'la', 'i', 'gli', 'le', "l'"}, 'pt': {'o', 'os', 'as'},
            'de': {'der', 'die', 'das', 'den', 'dem', 'des'}, 'ru': set()}


def phrase_words_of(code, phrase, known):
    """A phrase's words as the engine cuts them: at spaces, after an elision's apostrophe (tout à l'heure -> l' heure)
    and at hyphens (c'est-à-dire -> c' est à dire), unless the piece is a word or form of the dictionary (d'ailleurs,
    peut-être, во-первых, c'era); folded and in lower case. `known(folded)` says whether the dictionary reads a piece."""
    out = []
    for w in fold(code, phrase).split():
        if known(w) or known(w.lower()):
            out.append(w.lower())
            continue
        # The pieces of a hyphened run are cut at their elisions too: c'est-à-dire is c' est à dire, though c'est alone
        # is a word.
        pieces = w.split('-')
        for piece in pieces:
            m = re.match(r"^([^']+')(.+)$", piece)
            out.extend([m.group(1).lower(), m.group(2).lower()] if m and (len(pieces) > 1 or not known(piece))
                       else [piece.lower()])
    return [w for w in out if w]


def phrase_key(code, phrase, known):
    return ' '.join(phrase_words_of(code, phrase, known))


def write_phrases(code, phrase_entries, word_count, top_words, known, entries, curated, out_dir):
    """phrases.tsv.gz: `<words folded lower-case, space-separated>\t<hint>\t<sense>\t<sense>...` (senses as in
    entries.tsv.gz), commonest first; the engine's findPhrases reads it. Returns how many were written.

    curated.json lists the phrases of common words alone that are fixed all the same: "+por eso": "therefore" (a hint, or
    "" for Wiktionary's), and it makes the phrase when Wiktionary has none."""
    listed = {phrase_key(code, k[1:], known): (k[1:], v) for k, v in curated.items() if k.startswith('+')}
    best = {}
    for e in phrase_entries:
        if e.get('p') not in PHRASE_POS:
            continue
        words = phrase_words_of(code, e['w'], known)
        if not 2 <= len(words) <= 4 or any(not re.search(r'\w', w) for w in words):
            continue
        key = ' '.join(words)
        full = [w for w in words if not w.endswith("'")]
        counts_ = [word_count.get(w, 0) for w in full]
        if not counts_ or min(counts_) < PHRASE_MIN_COUNT:
            continue
        if key not in listed:
            if all(w in top_words or w.endswith("'") for w in words):
                continue
            # la verdad "honestly" is the truth where a book has it.
            if len(words) == 2 and words[0] in DEFINITE.get(code, ()):
                continue
        rows_all = sense_rows(code, e.get('s') or [])
        # Wiktionary says so itself: es que, y eso are "used other than figuratively or idiomatically" too.
        if any(re.match(r'(?i)used other than', r[1][0]) for r in rows_all) and key not in listed:
            continue
        rows = [r for r in rows_all if not re.match(r'(?i)used other than', r[1][0])]
        # tal que {colloquial} "for example" is "such that" in a book; en estado (adjective) "pregnant" is "en estado grave".
        if not rows or (key not in listed and (set(rows[0][0]) & (WEAK_LABELS | {'literary', 'colloquial', 'informal'})
                                                or marked_notes(rows[0][0]) or regional(rows[0][0])
                                                or (e['p'] == 'adj' and len(words) == 2))):
            continue
        cur = curated.get(e['w'] + '|' + POS_NAMES.get(e['p'], e['p']), curated.get(e['w']))
        hint = (cur.get('hint') if isinstance(cur, dict) else cur) or (listed.get(key, ('', ''))[1]) or \
            hint_of([g for _, g in rows], e['w'], e['p'])
        if not hint:
            continue
        score = min(counts_)
        cols = [('{' + ', '.join(dict.fromkeys(n)) + '}' if n else '') + '|'.join(g) for n, g in rows[:4]]
        if key in best:
            # Two sections of one phrase (por favor the adverb and the interjection): the first's hint, both's senses.
            prev = best[key]
            prev[2].extend(c for c in cols if c not in prev[2])
            del prev[2][6:]
            continue
        best[key] = [score, hint.split('|')[0], cols]
    for key, (phrase, hint) in listed.items():
        if key not in best and hint and 2 <= len(key.split()) <= 4:
            best[key] = [10 ** 9, hint, [hint]]
    ranked = sorted(best.items(), key=lambda x: (-x[1][0], x[0]))[:PHRASE_MAX]
    header = (f'# Dushu {LANGS[code]["name"]} fixed phrases, from English Wiktionary (CC BY-SA 4.0) via kaikki.org: words '
              'folded lower-case, hint, senses. Commonest first.\n')
    while True:
        text = header + '\n'.join('\t'.join([k, h, *cols]) for k, (_, h, cols) in ranked) + '\n'
        path = os.path.join(out_dir, 'phrases.tsv.gz')
        write_gz(path, text)
        if os.path.getsize(path) <= PHRASE_GZ_MAX or len(ranked) < 100:
            return len(ranked)
        ranked = ranked[:int(len(ranked) * 0.9)]


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
