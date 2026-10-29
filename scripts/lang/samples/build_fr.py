#!/usr/bin/env python3 -I
"""French starter library: python3 -I build_fr.py [book ...]  (SAMPLES_CACHE = scratch dir for downloads)."""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

def prose(text, sig=None):
    return [lib.de_gutenberg_markup(p) for p in lib.drop_footnotes(lib.wrapped_paragraphs(text), sig)]

def perrault():
    names = ['La Belle au Bois dormant', 'Le petit Chaperon rouge', 'La Barbe-Bleue', 'Le maître Chat ou le Chat botté', 'Les Fées',
             'Cendrillon ou la petite Pantoufle de verre', 'Riquet à la Houppe', 'Le Petit Poucet']
    secs = []
    for n in names:
        paras = lib.wrapped_paragraphs(lib.wikisource('fr', 'Contes de Perrault (éd. 1902)/' + n))
        paras = [p for p in paras if not p.startswith('LES CONTES DE PERRAULT') and not p.startswith('## ') and p != 'CONTE.']
        title = {'Le petit Chaperon rouge': 'Le Petit Chaperon rouge', 'Cendrillon ou la petite Pantoufle de verre': 'Cendrillon, ou la petite pantoufle de verre'}.get(n, n)
        secs.append((title, paras))
    return lib.write_book('fr', 'contes-de-perrault', 'Contes de Perrault', secs)

def parure():
    paras = lib.wrapped_paragraphs(lib.wikisource('fr', 'Contes du jour et de la nuit/La Parure'))
    return lib.write_book('fr', 'la-parure', 'La Parure', [(None, [p for p in paras if not p.startswith('## ')])])

def horla():
    paras = lib.wrapped_paragraphs(lib.wikisource('fr', 'Le Horla (recueil, Ollendorff 1895)/Le Horla'))
    return lib.write_book('fr', 'le-horla', 'Le Horla', [(None, [p for p in paras if not p.startswith('## ')])])

def candide():
    t = lib.gutenberg(4650)
    i = t.index('\nCHAPITRE I.\n')
    j = t.index('FIN DE CANDIDE.')
    parts = re.split(r'\n\n\n+CHAPITRE ([IVXL]+)(?:\[\d+\])?\.?\n([^\n]+(?:\n[^\n]+)*)\n\n', '\n\n\n' + t[i:j])
    secs = []
    for k in range(1, len(parts), 3):
        n, title, txt = parts[k], re.sub(r'\s*\[\d+\]', '', re.sub(r'\s+', ' ', parts[k + 1])).strip(), parts[k + 2]
        secs.append((f'Chapitre {n}. {title}', prose(txt, r' [BK]\.$')))
    return lib.write_book('fr', 'candide', 'Candide, ou l’Optimisme', secs)

LETTRES = [('INSTALLATION', 'Installation'), ('LA DILIGENCE DE BEAUCAIRE', 'La diligence de Beaucaire'), ('LE SECRET DE MAITRE CORNILLE', 'Le secret de maître Cornille'),
           ('LA CHÈVRE DE M. SEGUIN', 'La chèvre de M. Seguin'), ('LES ÉTOILES', 'Les étoiles'), ("L'ARLÉSIENNE", 'L’Arlésienne'), ('LA MULE DU PAPE', 'La mule du pape'),
           ('LE PHARE DES SANGUINAIRES', 'Le phare des Sanguinaires'), ("L'AGONIE DE LA SEMILLANTE", 'L’agonie de la Sémillante'), ('LES DOUANIERS', 'Les douaniers'),
           ('LE CURÉ DE CUCUGNAN.', 'Le curé de Cucugnan'), ('LES VIEUX.', 'Les vieux'), ('LA MORT DU DAUPHIN.', 'La mort du Dauphin'),
           ('LE SOUS-PRÉFET AUX CHAMPS.', 'Le sous-préfet aux champs'), ('LE PORTEFEUILLE DE BIXIOU', 'Le portefeuille de Bixiou'),
           ("LA LÉGENDE DE L'HOMME A LA CERVELLE D'OR.", 'La légende de l’homme à la cervelle d’or'), ('LE POÈTE MISTRAL.', 'Le poète Mistral'),
           ('LES TROIS MESSES BASSES.', 'Les trois messes basses'), ('LES ORANGES.', 'Les oranges'), ('LES DEUX AUBERGES', 'Les deux auberges'), ('A MILIANAH', 'À Milianah'),
           ('LES SAUTERELLES', 'Les sauterelles'), ("L'ÉLIXIR DU REVEREND PÈRE GAUCHER", 'L’élixir du Père Gaucher'),
           ('EN CAMARGUE', 'En Camargue'), ('LE DÉPART.', 'En Camargue : le départ'), ('LA CABANE.', 'En Camargue : la cabane'), ("A L'ESPÈRE! (A L'AFFUT!)", 'En Camargue : à l’espère'),
           ('LE ROUGE ET LE BLANC.', 'En Camargue : le rouge et le blanc'), ('LE VACCARÈS.', 'En Camargue : le Vaccarès'), ('NOSTALGIES DE CASERNE.', 'Nostalgies de caserne')]
def lettres():
    t = lib.gutenberg(11770)
    end = t.index('\nFIN.\n')
    pos = []
    cur = t.index('\nAVANT-PROPOS\n')
    start_av = cur
    for key, disp in LETTRES:
        m = re.compile(r'^' + re.escape(key) + r'$', re.M).search(t, cur + 1)
        assert m, key
        pos.append((m.start(), m.end(), disp)); cur = m.end()
    secs = []
    av = t[start_av + len('\nAVANT-PROPOS\n'):t.index('\nLETTRES\nDE\nMON MOULIN\n')]
    secs.append(('Avant-propos', prose(av)))
    for k, (a, b, disp) in enumerate(pos):
        chunk = t[b:(pos[k + 1][0] if k + 1 < len(pos) else end)]
        paras = prose(chunk)
        # a caps subtitle (e.g. RÉCIT D'UN BERGER PROVENÇAL.) right after the title is dropped
        while paras and paras[0].upper() == paras[0] and len(paras[0]) < 70 and not paras[0].startswith('A LA DAME'): paras = paras[1:]
        paras = [p for p in paras if p not in ('III', 'II', 'I', 'IV')]
        secs.append((disp, paras))
    return lib.write_book('fr', 'lettres-de-mon-moulin', 'Lettres de mon moulin', secs)

TOUR_FIX = {'II': 'Où Passepartout est convaincu qu’il a enfin trouvé son idéal', 'III': 'Où s’engage une conversation qui pourra coûter cher à Phileas Fogg',
            'IV': 'Dans lequel Phileas Fogg stupéfie Passepartout, son domestique', 'VI': 'Dans lequel l’agent Fix montre une impatience bien légitime',
            'IX': 'Où la mer Rouge et la mer des Indes se montrent propices aux desseins de Phileas Fogg', 'XVII': 'Où il est question de choses et d’autres pendant la traversée de Singapore à Hong-Kong',
            'XII': 'Où Phileas Fogg et ses compagnons s’aventurent à travers les forêts de l’Inde et ce qui s’ensuit', 'XXI': 'Où le patron de la Tankadère risque fort de perdre une prime de deux cents livres', 'XXIX': 'Où il sera fait le récit d’incidents divers qui ne se rencontrent que sur les rail-roads de l’Union'}
def tour():
    t = lib.gutenberg(800)
    i = t.index('\n\n\n\nI\n\nDANS LEQUEL')
    j = t.index('\nFIN\n', i)
    parts = re.split(r'\n\n+([IVXL]+)\n\n((?:[^a-z\n]|_[^_\n]+_)+(?:\n(?:[^a-z\n]|_[^_\n]+_)+)*)\n\n+', '\n' + t[i:j] + '\n')
    secs = []
    for k in range(1, len(parts), 3):
        n, title, txt = parts[k], re.sub(r'\s+', ' ', parts[k + 1]).strip(), parts[k + 2]
        title = TOUR_FIX.get(n) or lib.smart_case(title, t[i:j])
        secs.append((f'{n}. {title}', prose(txt)))
    return lib.write_book('fr', 'le-tour-du-monde', 'Le Tour du monde en quatre-vingts jours', secs)

def bovary():
    t = lib.gutenberg(14155)
    i = t.index('\nPREMIÈRE PARTIE\n\nI\n')
    body = '\n\n\n' + t[i:] + '\n\n\n'
    marks = list(re.finditer(r'\n\n\n+(?:(PREMIÈRE PARTIE|DEUXIÈME PARTIE|TROISIÈME PARTIE)\n\n)?([IVXL]+)\n\n\n', body))
    secs, part = [], ''
    for k, m in enumerate(marks):
        if m.group(1): part = m.group(1).capitalize()
        end = marks[k + 1].start() if k + 1 < len(marks) else len(body)
        secs.append((f'{part}, {m.group(2)}', prose(body[m.end():end])))
    return lib.write_book('fr', 'madame-bovary', 'Madame Bovary', secs)

if __name__ == '__main__':
    for name in sys.argv[1:] or ['perrault', 'parure', 'horla', 'candide', 'lettres', 'tour', 'bovary']:
        print(name, lib.stats(globals()[name]()))
