#!/usr/bin/env python3 -I
"""German starter library: python3 -I build_de.py [book ...]  (SAMPLES_CACHE = scratch dir for downloads).
The texts keep their original spelling (daß, muß ...), as printed."""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

def prose(text):
    return [lib.de_gutenberg_markup(p) for p in lib.drop_footnotes(lib.wrapped_paragraphs(text))]

def verse(text):
    """One paragraph per verse line; illustrations and the printer's '--' joiners dropped."""
    text = re.sub(r'\[Illustration[^\]]*\]', '', text, flags=re.S)
    out = []
    for l in text.split('\n'):
        l = re.sub(r'^\s*--\s*|\s*--\s*$', '', l.replace('_', '')).strip()
        if l: out.append(l)
    return out

def max_und_moritz():
    t = lib.gutenberg(17161)
    i = t.index('_VORWORT._')
    names = ['VORWORT', 'Erster Streich', 'Zweiter Streich', 'Dritter Streich', 'Vierter Streich', 'Fünfter Streich', 'Sechster Streich', 'Letzter Streich']
    parts = re.split(r'\n_([^_\n]+)\._\n', '\n' + t[i:])
    secs = []
    for k in range(1, len(parts), 2):
        head = parts[k].capitalize() if parts[k].isupper() else parts[k]
        body = parts[k + 1]
        if k + 2 >= len(parts):  # the last section runs on to "Schluß"
            pass
        secs.append((head, verse(body)))
    return lib.write_book('de', 'max-und-moritz', 'Max und Moritz', secs)

def struwwelpeter():
    t = lib.gutenberg(24571)
    i = t.index('Wenn die Kinder artig sind')
    j = t.index('Die andern Bilderbücher')
    body = t[i:j]
    body = body.replace('Literarische Anstalt. Frankfurt a. M.', '')
    parts = re.split(r'\n\n\n+(Die (?:gar traurige )?Geschichte (?:vom|von den|mit dem)[^\n]+)\n', '\n\n\n' + body)
    secs = [('Der Struwwelpeter', verse(parts[0]))]
    for k in range(1, len(parts), 2):
        secs.append((parts[k].strip(), verse(parts[k + 1])))
    return lib.write_book('de', 'struwwelpeter', 'Der Struwwelpeter', secs)

def immensee():
    t = lib.gutenberg(6651)
    i = t.index('\n\n\nDER ALTE\n\n\nAn einem')
    body = t[i:]
    heads = ['DER ALTE', 'DIE KINDER', 'IM WALDE', 'DA STAND DAS KIND AM WEGE', 'DAHEIM', 'EIN BRIEF', 'IMMENSEE', 'MEINE MUTTER HAT’S GEWOLLT', 'ELISABETH', 'DER ALTE']
    pos, cur = [], 0
    for h in heads:
        m = re.compile(r'\n\n\n' + re.escape(h) + r'\n\n').search(body, cur)
        pos.append((m.start(), m.end(), h)); cur = m.end()
    secs = []
    for k, (a, b, h) in enumerate(pos):
        chunk = body[b:(pos[k + 1][0] if k + 1 < len(pos) else len(body))]
        secs.append((h.capitalize().replace('Hat’s', 'hat’s') if h != 'DER ALTE' else 'Der Alte', prose(chunk)))
    # capitalisation of titles
    fix = {'Die kinder': 'Die Kinder', 'Im walde': 'Im Walde', 'Da stand das kind am wege': 'Da stand das Kind am Wege', 'Daheim': 'Daheim',
           'Ein brief': 'Ein Brief', 'Immensee': 'Immensee', 'Meine mutter hat’s gewollt': 'Meine Mutter hat’s gewollt', 'Elisabeth': 'Elisabeth'}
    secs = [(fix.get(h, h), p) for h, p in secs]
    return lib.write_book('de', 'immensee', 'Immensee', secs)

def verwandlung():
    t = lib.gutenberg(22367)
    i = t.index('\nI.\n\n\nAls Gregor')
    parts = re.split(r'\n\n\n+(I|II|III)\.\n\n\n', '\n\n\n' + t[i + 1:])
    secs = [(parts[k], prose(parts[k + 1])) for k in range(1, len(parts), 2)]
    return lib.write_book('de', 'die-verwandlung', 'Die Verwandlung', secs)

def siddhartha():
    t = lib.gutenberg(2499)
    i = t.index('\nDER SOHN DES BRAHMANEN\n')
    heads = ['DER SOHN DES BRAHMANEN', 'BEI DEN SAMANAS', 'GOTAMA', 'ERWACHEN', 'KAMALA', 'BEI DEN KINDERMENSCHEN', 'SANSARA', 'AM FLUSSE', 'DER FÄHRMANN', 'DER SOHN', 'OM', 'GOVINDA']
    pos, cur = [], i
    for h in heads:
        m = re.compile(r'\n' + re.escape(h) + r'\n').search(t, cur)
        assert m, h
        pos.append((m.start(), m.end(), h)); cur = m.end()
    names = {'DER SOHN DES BRAHMANEN': 'Der Sohn des Brahmanen', 'BEI DEN SAMANAS': 'Bei den Samanas', 'GOTAMA': 'Gotama', 'ERWACHEN': 'Erwachen', 'KAMALA': 'Kamala',
             'BEI DEN KINDERMENSCHEN': 'Bei den Kindermenschen', 'SANSARA': 'Sansara', 'AM FLUSSE': 'Am Flusse', 'DER FÄHRMANN': 'Der Fährmann', 'DER SOHN': 'Der Sohn', 'OM': 'Om', 'GOVINDA': 'Govinda'}
    secs = []
    for k, (a, b, h) in enumerate(pos):
        chunk = t[b:(pos[k + 1][0] if k + 1 < len(pos) else len(t))]
        paras = prose(chunk)
        paras = [p for p in paras if p not in ('ZWEITER TEIL', 'ERSTER TEIL')]
        secs.append((names[h], paras))
    return lib.write_book('de', 'siddhartha', 'Siddhartha', secs)

def werther():
    secs = []
    for ebook, head in [(2407, 'Erstes Buch'), (2408, 'Zweites Buch')]:
        t = lib.gutenberg(ebook)
        i = t.index(head + '\n') + len(head)
        j = t.index('Ende dieses Projekt Gutenberg')
        secs.append((head, prose(t[i:j])))
    return lib.write_book('de', 'werther', 'Die Leiden des jungen Werther', secs)

def effi():
    t = lib.gutenberg(5323)
    parts = re.split(r'\n\n+((?:[A-ZÄÖÜ][a-zäöüß]+) Kapitel)\n\n', '\n\n' + t[t.index('Erstes Kapitel'):])
    secs = [(parts[k].replace('Einunddreißgstes', 'Einunddreißigstes'), prose(parts[k + 1])) for k in range(1, len(parts), 2)]
    return lib.write_book('de', 'effi-briest', 'Effi Briest', secs)

if __name__ == '__main__':
    for name in sys.argv[1:] or ['max_und_moritz', 'struwwelpeter', 'immensee', 'verwandlung', 'siddhartha', 'werther', 'effi']:
        print(name, lib.stats(globals()[name]()))
