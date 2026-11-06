#!/usr/bin/env python3 -I
"""English starter library: python3 -I build_en.py [book ...]  (SAMPLES_CACHE = scratch dir for downloads).
All twelve texts are Project Gutenberg ebooks first published in 1930 or earlier."""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

SMALL = {'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'of', 'on', 'or', 'the', 'to', 'with', 'is'}

def title_case(s):
    """Headline capitalisation for an ALL-CAPS title (small words stay lower case except at the start)."""
    s = re.sub(r'\s+', ' ', s).strip().lower()
    parts = re.split(r'(\s+|—|-)', s)
    out, first = [], True
    for w in parts:
        m = re.search(r'[a-z]', w)
        if not m or re.fullmatch(r'\s+|—|-', w): out.append(w); continue
        if first or w.strip('“‘"\'.,!?') not in SMALL:
            w = w[:m.start()] + w[m.start()].upper() + w[m.start() + 1:]
        first = False
        out.append(w)
    return ''.join(out)

ILLUS = re.compile(r'\[\s*Illustration[^\[\]]*(?:\[[^\]]*\][^\[\]]*)*\]', re.I)

def clean_illustrations(t):
    return ILLUS.sub('', t)

def paras(text):
    """Paragraphs of hard-wrapped Gutenberg prose. A block whose lines are all indented and short is verse:
    one paragraph per line. Markup (underscore italics, notes, '--') is cleaned per paragraph."""
    out = []
    for block in re.split(r'\n\s*\n', clean_illustrations(text).strip('\n')):
        lines = [l for l in block.split('\n') if l.strip()]
        if not lines: continue
        short = max(len(l.strip()) for l in lines)
        indented = len(lines) >= 2 and all(re.match(r'^\s{2,}\S', l) for l in lines) and short <= 55
        stanza = len(lines) >= 3 and short <= 50 and all(re.match(r'^[A-Z“‘"\'(]', l.strip()) for l in lines)
        verse = indented or stanza
        chunks = lines if verse else [' '.join(l.strip() for l in lines)]
        for c in chunks:
            c = lib.de_gutenberg_markup(c)
            if c and not re.fullmatch(r'(?:THE )?END\.?|[*\s]+', c): out.append(c)
    return out

def split_headings(text, pat, start=0, end=None):
    """[(match, body_text)] for every heading match of pat between start and end."""
    text = text[:end] if end is not None else text
    ms = list(re.finditer(pat, text[start:], re.M))
    out = []
    for i, m in enumerate(ms):
        a = start + m.end()
        b = start + ms[i + 1].start() if i + 1 < len(ms) else len(text)
        out.append((m, text[a:b]))
    return out

# ---------------------------------------------------------------- Beginner

TALES = [  # (Gutenberg id, title, first words of the story, text where it stops or None)
    (14838, 'The Tale of Peter Rabbit', 'Once upon a time there were four little Rabbits', None),
    (14872, 'The Tale of Squirrel Nutkin', 'This is a Tale about a tail', None),
    (14407, 'The Tale of Benjamin Bunny', 'One morning a little rabbit sat on a bank.', None),
    (45264, 'The Tale of Two Bad Mice', 'ONCE upon a time there was a very beautiful', 'THE END.'),
    (14814, 'The Tale of Jemima Puddle-Duck', 'What a funny sight it is', None),
    (14837, 'The Tale of Tom Kitten', 'Once upon a time there were three little kittens', None),
    (15077, 'The Tale of Mr. Jeremy Fisher', 'Once upon a time there was a frog', None),
    (15137, 'The Tale of Mrs. Tiggy-Winkle', 'Once upon a time there was a little girl called Lucie', None),
    (14220, 'The Tale of the Flopsy Bunnies', 'It is said that the effect of eating too much lettuce', 'THE TALE OF THE FLOPSY BUNNIES'),
]

def curly(p):
    """Straight single quotes used as quotation marks (Peter Rabbit, Two Bad Mice) become curly double quotes."""
    p = re.sub(r"(?<=[^\W\d_])'(?=[^\W\d_])", '’', p)
    p = re.sub(r"(?<![\w’])'(?=[\w“‘\"…—])", '“', p)
    return p.replace("'", '”')

def potter():
    secs = []
    for gid, title, first, stop in TALES:
        t = lib.gutenberg(gid)
        i = t.index(first)
        j = t.index(stop, i) if stop else len(t)
        secs.append((title, [curly(re.sub(r'^(TOM THUMB|HUNCA MUNCA)', lambda m: m.group(1).title(), p)) for p in paras(t[i:j])]))
    return lib.write_book('en', 'beatrix-potter-tales', 'Nine Tales by Beatrix Potter', secs)

def velveteen():
    t = lib.gutenberg(11757)
    i = t.index('HERE was once a velveteen rabbit')
    captions = {'Christmas Morning', 'The Skin Horse Tells His Story', 'Spring Time', 'Summer Days', 'Anxious Times', 'The Fairy Flower', 'At Last! At Last!'}
    ps = [p for p in paras(t[i:]) if p not in captions]  # the list of pictures, repeated as captions in the text
    assert ps[0].startswith('Here was once')
    ps[0] = 'T' + ps[0][0].lower() + ps[0][1:]  # the printer's drop cap T is missing from the source
    return lib.write_book('en', 'velveteen-rabbit', 'The Velveteen Rabbit', [(None, ps)])

def pooh():
    t = lib.gutenberg(67098)
    end = t.rindex('Printed in Canada')
    intro = t.index('INTRODUCTION\n') + len('INTRODUCTION\n')
    contents = t.index('\n                                CONTENTS')
    first = t.index('\n                               CHAPTER I\n')
    secs = [('Introduction', paras(t[intro:contents]))]
    hs = split_headings(t, r'^ +CHAPTER ([IVXL]+)\n\n((?: +[A-Z][^\n]*\n)+)', start=first, end=end)
    for m, body in hs:
        secs.append((f'Chapter {m.group(1)}. {title_case(m.group(2))}', paras(body)))
    return lib.write_book('en', 'winnie-the-pooh', 'Winnie-the-Pooh', secs)

def aesop():
    t = lib.gutenberg(19994)
    a = t.index('A LIST OF THE FABLES'); b = t.index('[Illustration: THE WOLF AND THE KID]')
    names = [n.strip() for n in re.findall(r'^  (\S.*?)\s{2,}\d+$', t[a:b], re.M)][:51]
    pos, spots = b + 50, []
    for n in names:  # the fables come in the order of the list; each title is an ALL-CAPS line of its own
        m = re.compile(r'^' + re.escape(re.sub(r'\s+', ' ', n.upper())) + r'[ \t]*$', re.M).search(t, pos)
        spots.append((n, m.start(), m.end())); pos = m.end()
    secs = [(n, paras(t[e:spots[k + 1][1]])) for k, (n, s, e) in enumerate(spots[:50])]
    return lib.write_book('en', 'aesop-fables', 'Aesop’s Fables for Children (selection)', secs)

# ---------------------------------------------------------------- Intermediate

def alice():
    t = lib.gutenberg(11)
    hs = split_headings(t, r'^CHAPTER ([IVXL]+)\.\s*\n(.+)$', end=t.rindex('\nTHE END'))
    secs = [(f'Chapter {m.group(1)}. {m.group(2).strip()}', [p for p in paras(body) if not p.startswith('[later editions')]) for m, body in hs]
    return lib.write_book('en', 'alice-in-wonderland', 'Alice’s Adventures in Wonderland', secs)

def oz():
    t = lib.gutenberg(55)
    hs = split_headings(t, r'^Chapter ([IVXL]+)\n(.+)$')
    secs = [(f'Chapter {m.group(1)}. {m.group(2).strip()}', paras(body)) for m, body in hs]
    return lib.write_book('en', 'wizard-of-oz', 'The Wonderful Wizard of Oz', secs)

def secret_garden():
    t = lib.gutenberg(113)
    hs = split_headings(t, r'^CHAPTER ([IVXL]+)\.?\n([^\n]+)$')
    secs = [(f'Chapter {m.group(1)}. {title_case(m.group(2))}', paras(body)) for m, body in hs]
    return lib.write_book('en', 'secret-garden', 'The Secret Garden', secs)

HOLMES = {'I', 'II', 'III', 'VII', 'VIII'}
def holmes():
    t = lib.gutenberg(1661)
    hs = split_headings(t, r'^([IVX]+)\. ([A-Z][A-Z’\- ]+)$', start=t.index('\nI. A SCANDAL IN BOHEMIA\n'))
    secs = []
    for m, body in hs:
        if m.group(1) not in HOLMES: continue
        ps = [p for p in paras(body) if not re.fullmatch(r'[IVX]+\.', p)]
        secs.append((title_case(m.group(2)), ps))
    return lib.write_book('en', 'sherlock-holmes', 'Sherlock Holmes: Five Adventures', secs)

# ---------------------------------------------------------------- Advanced

def pride():
    t = lib.gutenberg(1342)
    i = t.index('It is a truth universally acknowledged')
    t = 'CHAPTER I.\n\n' + clean_illustrations(t[i:t.rindex('CHISWICK PRESS')])
    hs = split_headings(t, r'^(?:CHAPTER|Chapter) ([IVXL]+)\.?[ \t]*$')
    secs = [(f'Chapter {m.group(1)}', paras(body)) for m, body in hs]
    assert len(secs) == 61, len(secs)
    return lib.write_book('en', 'pride-and-prejudice', 'Pride and Prejudice', secs)

def jane_eyre():
    t = lib.gutenberg(1260)
    hs = split_headings(t, r'^CHAPTER ([IVXL]+)(?:—([A-Z]+))?\s*$', start=t.index('\nCHAPTER I\n'))
    secs = [(f'Chapter {m.group(1)}' + (f'. {title_case(m.group(2))}' if m.group(2) else ''), paras(body)) for m, body in hs]
    assert len(secs) == 38, len(secs)
    return lib.write_book('en', 'jane-eyre', 'Jane Eyre', secs)

def gatsby():
    t = lib.gutenberg(64317)
    hs = split_headings(t, r'^ {10,}([IVX]+)\s*$', start=t.index('Thomas Parke d’Invilliers'))
    secs = [(f'Chapter {m.group(1)}', paras(body)) for m, body in hs]
    assert len(secs) == 9, len(secs)
    return lib.write_book('en', 'great-gatsby', 'The Great Gatsby', secs)

def frankenstein():
    t = lib.gutenberg(84)
    hs = split_headings(t, r'^(Letter|Chapter) (\d+)\s*$', start=t.index('\nLetter 1\n\n_To Mrs'))
    NOTES = re.compile(r'\[(?:Coleridge|Wordsworth)[^\]]*\]')  # the editor's source notes
    secs = [(f'{m.group(1)} {m.group(2)}', [q for q in (p.replace(' [The moon]', '') for p in paras(body) if not NOTES.fullmatch(p)) if q]) for m, body in hs]
    assert len(secs) == 28, len(secs)
    return lib.write_book('en', 'frankenstein', 'Frankenstein', secs)

BOOKS = ['potter', 'velveteen', 'pooh', 'aesop', 'alice', 'oz', 'secret_garden', 'holmes', 'pride', 'jane_eyre', 'gatsby', 'frankenstein']

if __name__ == '__main__':
    for name in sys.argv[1:] or BOOKS:
        txt = globals()[name]()
        print(name, lib.stats(txt))
