#!/usr/bin/env python3 -I
"""Spanish starter library: python3 -I build_es.py  (SAMPLES_CACHE = scratch dir for downloads)."""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

def modern_a(s):
    """Old spelling 'á' (the preposition 'a') to 'a', the one change made to these 19th-century texts."""
    s = re.sub(r'(?<![\wáéíóúñ])á(?![\wáéíóúñ])', 'a', s)
    return re.sub(r'(?<![\wÁÉÍÓÚÑáéíóúñ])Á(?![\wÁÉÍÓÚÑáéíóúñ])', 'A', s)

def prose(text):
    return [modern_a(lib.de_gutenberg_markup(re.sub(r'</?i>', '', p))) for p in lib.wrapped_paragraphs(text)]

def cuentos():
    stories = ['La tortuga gigante', 'Las medias de los flamencos', 'El loro pelado', 'La guerra de los yacarés', 'La gama ciega',
               'Historia de dos cachorros de coatí y de dos cachorros de hombre', 'El paso del Yabebirí', 'La abeja haragana']
    secs = []
    for t in stories:
        paras = lib.wrapped_paragraphs(lib.wikisource('es', t))
        assert paras[0].isupper(), paras[0]
        secs.append((t, [lib.de_gutenberg_markup(p) for p in paras[1:]]))
    return lib.write_book('es', 'cuentos-de-la-selva', 'Cuentos de la selva', secs)

def platero():
    t = lib.gutenberg(39209)
    t = t[t.index('\nI\n\nPLATERO\n'):]
    idx = t.index('\nFIN\n')
    body, index = t[:idx], t[idx:]
    titles = dict(re.findall(r'^([IVXLC]+)\.--(.+)$', index, re.M))
    assert len(titles) == 63, len(titles)
    # split on roman numeral + uppercase title
    parts = re.split(r'\n([IVXLC]+)\n\n\n?([^\n]+)\n\n', '\n' + body)
    secs = []
    for i in range(1, len(parts), 3):
        num, up, txt = parts[i], parts[i + 1], parts[i + 2]
        title = re.sub(r'</?i>', '', titles[num]).strip()
        paras = prose(txt)
        secs.append((f'{num}. {title}', paras))
    return lib.write_book('es', 'platero-y-yo', 'Platero y yo', secs)

def leyendas():
    t = lib.gutenberg(53552)
    secs = []
    for title, name in [('LOS OJOS VERDES', 'Los ojos verdes'), ('EL MONTE DE LAS ÁNIMAS', 'El monte de las ánimas'), ('EL RAYO DE LUNA', 'El rayo de luna')]:
        i = t.index('\n' + title + '\n') + len(title) + 2
        j = t.find('\n\n[Ilustración]\n\n\n\n', i)
        chunk = t[i:j if j > 0 else i + 40000]
        paras = [modern_a(p) for p in prose(chunk) if not re.fullmatch(r'[IVX]+\.?', p)]
        secs.append((name, paras))
    return lib.write_book('es', 'leyendas-becquer', 'Leyendas (selección)', secs)

def quiroga():
    t = lib.gutenberg(13507)
    titles = ['A LA DERIVA', 'EL ALMOHADÓN DE PLUMA', 'LA GALLINA DEGOLLADA', 'LA INSOLACIÓN']
    heads = {m.group(1): m.start() for m in re.finditer(r'^#([^#\n]+)#$', t, re.M) if m.group(1).isupper()}
    order = sorted(heads.items(), key=lambda kv: kv[1])
    secs = []
    for want in titles:
        key = [k for k in heads if k.replace('Ó', 'O').replace('Ñ', 'N') == want.replace('Ó', 'O')][0]
        i = heads[key]
        nxt = [pos for k, pos in order if pos > i]
        chunk = t[i:nxt[0] if nxt else len(t)]
        chunk = re.sub(r'^#[^#\n]+#$', '', chunk, count=1, flags=re.M)
        secs.append((want.capitalize().replace('Ó', 'ó'), prose(chunk)))
    return lib.write_book('es', 'quiroga-cuentos', 'Cuentos de amor, de locura y de muerte (selección)', secs)

def lazarillo():
    t = lib.gutenberg(320)
    t = t[t.index('\nPrólogo\n'):]
    t = t.replace('{', '').replace('}', '')
    parts = re.split(r'\n(Prólogo|Tratado [A-Za-zéú]+)\n\n?', '\n' + t)
    secs = []
    for i in range(1, len(parts), 2):
        head, txt = parts[i], parts[i + 1]
        paras = lib.wrapped_paragraphs(txt)
        if head != 'Prólogo':
            head = head + '. ' + paras[0].rstrip('.'); paras = paras[1:]
        secs.append((head, [lib.de_gutenberg_markup(p) for p in paras]))
    return lib.write_book('es', 'lazarillo-de-tormes', 'La vida de Lazarillo de Tormes', secs)

def rinconete():
    paras = lib.wrapped_paragraphs(lib.wikisource('es', 'Rinconete y Cortadillo (1919)'))
    return paras

def sombrero():
    t = lib.gutenberg(29506)
    i = t.index('\nEL SOMBRERO DE TRES PICOS\n\n\n\n\nI\n')
    j = t.index('\nFIN.\n', i)
    body = t[i:j]
    parts = re.split(r'\n\n([IVXL]+)\.?\n\n([^\n]+(?:\n[^\n]+)*)\n\n\n', body)
    secs = []
    for k in range(1, len(parts), 3):
        secs.append((parts[k], re.sub(r'\s+', ' ', parts[k + 1]).strip(), prose(parts[k + 2])))
    return secs

def marianela():
    t = lib.gutenberg(17340)
    i = t.index('\n-I-\n')
    j = t.index('\nFIN DE «MARIANELA»')
    parts = re.split(r'\n-([IVXL]+)-\n\n+([^\n]+)\n\n', t[i:j] + '\n')
    secs = []
    for k in range(1, len(parts), 3):
        secs.append((parts[k], parts[k + 1].strip(), prose(parts[k + 2])))
    return secs

NAMES = {'pamplona': 'Pamplona', 'garduña': 'Garduña', 'lucas': 'Lucas', 'monterilla': 'Monterilla', 'diana': 'Diana', 'maría': 'María',
         'purísima': 'Purísima', 'corregidora': 'Corregidora', 'corregidor': 'Corregidor', 'ave': 'Ave'}
def sentence_case(t):
    if not t.isupper(): return t
    out = []
    for w in t.lower().split(' '):
        core = re.sub(r'^\W+|\W+$', '', w)
        out.append(w.replace(core, NAMES.get(core, core), 1) if core else w)
    s = ' '.join(out)
    return re.sub(r'^(\W*)(\w)', lambda m: m.group(1) + m.group(2).upper(), s)

def sombrero_book():
    fix = {'XXVIII': '¡Ave María Purísima! ¡Las doce y media y sereno!'}
    secs = [(f'{n}. {fix.get(n) or sentence_case(t)}', ps) for n, t, ps in sombrero()]
    return lib.write_book('es', 'sombrero-de-tres-picos', 'El sombrero de tres picos', secs)

def marianela_book():
    secs = [(f'{n}. {t}', ps) for n, t, ps in marianela()]
    return lib.write_book('es', 'marianela', 'Marianela', secs)

if __name__ == '__main__':
    for name in sys.argv[1:] or ['cuentos', 'platero', 'quiroga', 'leyendas', 'lazarillo', 'sombrero_book', 'marianela_book']:
        txt = globals()[name]()
        print(name, lib.stats(txt))
