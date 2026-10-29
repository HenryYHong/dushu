"""How often each written word is each lemma and part of speech, from Universal Dependencies treebanks.

Wiktionary says what a word can be (fue is a form of ser and of ir; padre is a noun and a slang adjective); hand-annotated
text says what it usually is. build.py uses these counts to share the subtitle counts among the lemmas a form can be,
to order the sections of a headword, and to write the prior the engine uses when nothing in the sentence decides.

Only treebanks under an open licence that allows a public website (no NC) are read. Files are streamed, never saved.
"""
import collections
import gzip
import json
import os

import kaikki

RAW = 'https://raw.githubusercontent.com/UniversalDependencies/{tb}/master/{f}'
SITE = 'https://github.com/UniversalDependencies/{tb}'

# code -> [(treebank, licence, [files])]
TREEBANKS = {
    'es': [('UD_Spanish-AnCora', 'CC BY 4.0', ['es_ancora-ud-train.conllu', 'es_ancora-ud-dev.conllu', 'es_ancora-ud-test.conllu']),
           ('UD_Spanish-GSD', 'CC BY-SA 4.0', ['es_gsd-ud-train.conllu', 'es_gsd-ud-dev.conllu', 'es_gsd-ud-test.conllu'])],
    'fr': [('UD_French-GSD', 'CC BY-SA 4.0', ['fr_gsd-ud-train.conllu', 'fr_gsd-ud-dev.conllu', 'fr_gsd-ud-test.conllu'])],
    'de': [('UD_German-GSD', 'CC BY-SA 4.0', ['de_gsd-ud-train.conllu', 'de_gsd-ud-dev.conllu', 'de_gsd-ud-test.conllu']),
           ('UD_German-HDT', 'CC BY-SA 4.0', ['de_hdt-ud-train-a-1.conllu', 'de_hdt-ud-dev.conllu'])],
    'it': [('UD_Italian-Old', 'CC BY-SA 4.0', ['it_old-ud-train.conllu', 'it_old-ud-dev.conllu', 'it_old-ud-test.conllu']),
           ('UD_Italian-MarkIT', 'CC BY 4.0', ['it_markit-ud-train.conllu', 'it_markit-ud-dev.conllu', 'it_markit-ud-test.conllu']),
           ('UD_Italian-ParlaMint', 'CC BY-SA 4.0', ['it_parlamint-ud-train.conllu', 'it_parlamint-ud-test.conllu']),
           ('UD_Italian-PUD', 'CC BY-SA 3.0', ['it_pud-ud-test.conllu']),
           ('UD_Italian-Valico', 'CC BY-SA 4.0', ['it_valico-ud-test.conllu'])],
    'pt': [('UD_Portuguese-Bosque', 'CC BY-SA 4.0', ['pt_bosque-ud-train.conllu', 'pt_bosque-ud-dev.conllu', 'pt_bosque-ud-test.conllu']),
           ('UD_Portuguese-Porttinari', 'CC BY 4.0', ['pt_porttinari-ud-train.conllu', 'pt_porttinari-ud-dev.conllu', 'pt_porttinari-ud-test.conllu'])],
    'ru': [('UD_Russian-GSD', 'CC BY-SA 4.0', ['ru_gsd-ud-train.conllu', 'ru_gsd-ud-dev.conllu', 'ru_gsd-ud-test.conllu']),
           ('UD_Russian-Taiga', 'CC BY-SA 4.0', ['ru_taiga-ud-train-a.conllu', 'ru_taiga-ud-train-b.conllu', 'ru_taiga-ud-dev.conllu', 'ru_taiga-ud-test.conllu'])],
}


def sources(code):
    return [{'name': f'Universal Dependencies {tb} treebank (which lemma and part of speech a word usually is)',
             'license': lic, 'url': SITE.format(tb=tb)} for tb, lic, _ in TREEBANKS.get(code, [])]


def stream_counts(code):
    """{form: {"UPOS lemma": count}} over the language's treebanks. A multiword token (del = de + el, dámelo) counts as
    one word of part of speech MWT, its parts not at all: the word on the page is the contraction."""
    counts = collections.defaultdict(collections.Counter)
    for tb, _, files in TREEBANKS.get(code, []):
        for f in files:
            skip_until = 0
            with kaikki.open_url(RAW.format(tb=tb, f=f)) as res:
                for raw in res:
                    line = raw.decode('utf-8', 'replace').rstrip('\n')
                    if not line or line.startswith('#'):
                        continue
                    cols = line.split('\t')
                    if len(cols) < 4:
                        continue
                    tid = cols[0]
                    if '-' in tid:
                        a, b = tid.split('-', 1)
                        try:
                            skip_until = int(b)
                        except ValueError:
                            skip_until = 0
                        # A contraction (du = de + le, zum, della) counts as one word of its own.
                        if cols[1]:
                            counts[cols[1]]['MWT ' + cols[1].lower()] += 1
                        continue
                    if '.' in tid:
                        continue
                    try:
                        n = int(tid)
                    except ValueError:
                        continue
                    if n <= skip_until:
                        continue
                    form, lemma, upos = cols[1], cols[2], cols[3]
                    if upos in ('PUNCT', 'SYM', 'X') or not form:
                        continue
                    counts[form][upos + ' ' + lemma] += 1
    return counts


def load_counts(code, cache=None):
    """The counts, from `cache` (a .json.gz written by an earlier run) when it exists, else streamed (and cached)."""
    if cache and os.path.exists(cache):
        with gzip.open(cache, 'rt', encoding='utf-8') as f:
            return {k: collections.Counter(v) for k, v in json.load(f).items()}
    counts = stream_counts(code)
    if cache:
        with gzip.open(cache, 'wt', encoding='utf-8') as f:
            json.dump(counts, f, ensure_ascii=False)
    return counts


# Universal POS -> the parts of speech build.py writes (POS_NAMES values), best match first: a treebank's DET is the
# dictionary's article or determiner, and only failing those its pronoun or adjective.
UPOS = {
    'NOUN': [{'noun'}, {'proper noun', 'adjective'}], 'PROPN': [{'proper noun'}, {'noun'}], 'VERB': [{'verb'}, {'adjective'}],
    'AUX': [{'verb'}], 'ADJ': [{'adjective'}, {'verb', 'determiner', 'numeral'}], 'ADV': [{'adverb'}, {'adjective', 'conjunction'}],
    'DET': [{'determiner', 'article'}, {'pronoun', 'adjective', 'numeral'}], 'PRON': [{'pronoun'}, {'determiner', 'article'}],
    'ADP': [{'preposition', 'contraction', 'postposition'}, {'adverb'}], 'CCONJ': [{'conjunction'}, {'adverb'}],
    'SCONJ': [{'conjunction'}, {'pronoun', 'adverb', 'preposition'}], 'NUM': [{'numeral'}, {'noun', 'adjective', 'determiner'}],
    'INTJ': [{'interjection'}], 'PART': [{'particle'}, {'adverb', 'conjunction'}],
    'MWT': [{'contraction'}, {'preposition', 'article', 'determiner', 'pronoun'}],
}
