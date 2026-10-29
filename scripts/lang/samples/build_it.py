#!/usr/bin/env python3 -I
"""Italian starter library: python3 -I build_it.py [book ...]  (SAMPLES_CACHE = scratch dir for downloads)."""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

def prose(text):
    return [lib.de_gutenberg_markup(p) for p in lib.drop_footnotes(lib.wrapped_paragraphs(text))]

def ws_paras(page):
    """Wikisource paragraphs; a lone drop-cap letter paragraph is joined to the next one."""
    paras = lib.wrapped_paragraphs(lib.wikisource('it', page))
    out, i = [], 0
    while i < len(paras):
        if len(paras[i]) == 1 and paras[i].isalpha() and i + 1 < len(paras):
            out.append(paras[i] + paras[i + 1]); i += 2
        else:
            out.append(paras[i]); i += 1
    return out

def pinocchio():
    t = lib.gutenberg(52484)
    i = t.index('\nI.\n\nCome andò')
    j = t.index('\nINDICE\n')
    parts = re.split(r'\n\n+([IVXL]+)\.\n\n([^\n]+(?:\n[^\n]+)*)\n\n', '\n\n' + t[i + 1:j])
    secs = []
    for k in range(1, len(parts), 3):
        secs.append((f'{parts[k]}. ' + re.sub(r'\s+', ' ', parts[k + 1]).strip(), prose(parts[k + 2])))
    return lib.write_book('it', 'pinocchio', 'Le avventure di Pinocchio', secs)

def rosso_malpelo():
    paras = ws_paras('Rosso Malpelo')
    paras = [p for p in paras if p.upper() != p]
    return lib.write_book('it', 'rosso-malpelo', 'Rosso Malpelo', [(None, paras)])

def treno():
    paras = ws_paras('Il treno ha fischiato')
    paras = [p for p in paras if p.upper() != p]
    return lib.write_book('it', 'il-treno-ha-fischiato', 'Il treno ha fischiato', [(None, paras)])

ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII', 'XXIV', 'XXV', 'XXVI']
def principe():
    secs = []
    paras = ws_paras('Il Principe/Dedica')
    paras = [p for p in paras if not p.startswith('## ')]
    secs.append(('Dedica', paras))
    for r in ROMAN:
        paras = ws_paras('Il Principe/Capitolo ' + r)
        paras = [p for p in paras if not p.startswith('## ')]
        # drop the running head (IL PRINCIPE / di / NICC. MACHIAVELLI / ____ / CAPITOLO I.) and keep the chapter's own title as the heading
        k = [n for n, p in enumerate(paras) if re.match(r'^CAPITOLO [IVXL]+\.?$', p)][0]
        title = paras[k + 1]
        secs.append((f'Capitolo {r}. {title}', paras[k + 2:]))
    return lib.write_book('it', 'il-principe', 'Il Principe', secs)

def mattia_pascal():
    secs = []
    for n in range(1, 19):
        paras = ws_paras(f'Il fu Mattia Pascal/{n}')
        m = re.match(r'^§ (\d+)\. — (.+?)\.?$', paras[0])
        assert m, paras[0]
        title = m.group(2)
        secs.append((f'{n}. {title}', paras[1:]))
    return lib.write_book('it', 'il-fu-mattia-pascal', 'Il fu Mattia Pascal', secs)

def inferno():
    t = lib.gutenberg(997)
    i = t.index('\nInferno\nCanto I\n')
    body = t[i:]
    parts = re.split(r'\n+Inferno\n+Canto ([IVXL]+)\n+|\n\n+Canto ([IVXL]+)\n+', body)
    secs = []
    k = 1
    while k < len(parts):
        n = parts[k] or parts[k + 1]
        txt = parts[k + 2]
        lines = [re.sub(r'\s+', ' ', l).strip() for l in txt.split('\n') if l.strip()]
        secs.append((f'Canto {n}', lines))
        k += 3
    return lib.write_book('it', 'inferno', 'La Divina Commedia: Inferno', secs)

def promessi_sposi():
    t = lib.gutenberg(45334)
    i = t.index('\n                             INTRODUZIONE\n')
    j = t.index('\n                                 FINE.\n')
    body = t[i:j]
    parts = re.split(r'\n\s+(INTRODUZIONE|CAPITOLO [A-ZIVXL]+)\.?\n', body)
    secs = []
    for k in range(1, len(parts), 2):
        h = parts[k]
        txt = parts[k + 1]
        if h == 'INTRODUZIONE': title = 'Introduzione'
        elif h == 'CAPITOLO PRIMO': title = 'Capitolo I'
        else: title = 'Capitolo ' + h.split(' ')[1]
        paras = [p for p in prose(txt) if p != 'I PROMESSI SPOSI']
        secs.append((title, paras))
    return lib.write_book('it', 'i-promessi-sposi', 'I promessi sposi', secs)

if __name__ == '__main__':
    for name in sys.argv[1:] or ['pinocchio', 'rosso_malpelo', 'treno', 'principe', 'mattia_pascal', 'inferno', 'promessi_sposi']:
        print(name, lib.stats(globals()[name]()))
