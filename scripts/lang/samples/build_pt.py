#!/usr/bin/env python3 -I
"""Portuguese starter library: python3 -I build_pt.py [book ...]  (SAMPLES_CACHE = scratch dir for downloads).
The long novels keep the spelling of the editions they come from (19th-century orthography)."""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

def prose(text):
    return [lib.de_gutenberg_markup(p) for p in lib.drop_footnotes(lib.wrapped_paragraphs(text))]

def ws_story(page, title_upper=None):
    paras = [p for p in lib.wrapped_paragraphs(lib.wikisource('pt', page)) if not p.startswith('## ')]
    return [lib.de_gutenberg_markup(p) for p in paras]

def um_apologo():
    return lib.write_book('pt', 'um-apologo', 'Um apólogo', [(None, ws_story('Um Apólogo'))])

def missa_do_galo():
    return lib.write_book('pt', 'missa-do-galo', 'Missa do galo', [(None, ws_story('Missa do galo'))])

def cartomante():
    return lib.write_book('pt', 'a-cartomante', 'A cartomante', [(None, ws_story('A Cartomante'))])

def roman_split(body, pat=r'\n\n\n+([IVXLC]+)\.?\n\n+'):
    return re.split(pat, '\n\n\n' + body)

def alienista():
    t = lib.gutenberg(57001)
    i = t.index('\nO ALIENISTA\n\n\nI\n')
    j = t.index('\nTHEORIA DO MEDALHÃO\n', i)
    parts = roman_split(t[i + len('\nO ALIENISTA\n'):j])
    secs = []
    for k in range(1, len(parts), 2):
        paras = prose(parts[k + 1])
        title = paras[0].rstrip('.')
        secs.append((f'{parts[k]}. {title[0] + title[1:].lower() if title.isupper() else title}', paras[1:]))
    return lib.write_book('pt', 'o-alienista', 'O alienista', secs)

def iracema():
    t = lib.gutenberg(67740)
    i = t.index('\nIRACEMA\n\n\n\nI\n')
    j = t.index('\nFIM\n', i)
    parts = roman_split(t[i + len('\nIRACEMA\n'):j])
    secs = [(parts[k], prose(parts[k + 1])) for k in range(1, len(parts), 2)]
    return lib.write_book('pt', 'iracema', 'Iracema', secs)

def dom_casmurro():
    t = lib.gutenberg(55752)
    i = t.index('\nI\n\nDo titulo.\n')
    parts = roman_split(t[i + 1:t.index('\nFIM\n', i)])
    secs = []
    for k in range(1, len(parts), 2):
        paras = prose(parts[k + 1])
        secs.append((f'{parts[k]}. {paras[0].rstrip(".")}', paras[1:]))
    return lib.write_book('pt', 'dom-casmurro', 'Dom Casmurro', secs)

def memorias():
    t = lib.gutenberg(54829)
    t = t.replace('CAPIULO CXXIV', 'CAPITULO CXXIV')  # source typo
    i = t.index('\nCAPITULO I\n')
    parts = re.split(r'\n(CAP\S*ULO [IVXLC]+)\n', t[i:t.index('\nFIM\n', i)])
    prefix = prose(t[t.index('AO LEITOR'):i])[1:]
    secs = [('Ao leitor', prefix)]
    for k in range(1, len(parts), 2):
        paras = prose(parts[k + 1])
        num = parts[k].split(' ')[1]
        secs.append((f'{num}. {paras[0].rstrip(".")}', paras[1:]))
    return lib.write_book('pt', 'memorias-postumas', 'Memórias póstumas de Brás Cubas', secs)

def os_maias():
    t = lib.gutenberg(40409)
    i = t.index('\nOS MAIAS\n\n\n\n\nI\n')
    j = t.index('FIM DO SEGUNDO VOLUME')
    body = t[i + len('\nOS MAIAS\n'):j]
    body = body.replace('FIM DO PRIMEIRO VOLUME', '')
    k = body.index('OS MAIAS\n\n\n\n\n\nI\n') if 'OS MAIAS\n\n\n\n\n\nI\n' in body else None
    parts = roman_split(body)
    secs, n = [], 0
    ROMAN = lambda n: ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII'][n]
    for q in range(1, len(parts), 2):
        paras = [p for p in prose(parts[q + 1]) if p not in ('OS MAIAS', 'VOLUME II', 'VOLUME I')]
        n += 1
        secs.append((ROMAN(n), paras))
    assert n == 18, n
    return lib.write_book('pt', 'os-maias', 'Os Maias', secs)

if __name__ == '__main__':
    for name in sys.argv[1:] or ['um_apologo', 'missa_do_galo', 'cartomante', 'alienista', 'iracema', 'dom_casmurro', 'memorias', 'os_maias']:
        print(name, lib.stats(globals()[name]()))
