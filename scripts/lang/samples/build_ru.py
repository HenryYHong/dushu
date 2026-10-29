#!/usr/bin/env python3 -I
"""Russian starter library: python3 -I build_ru.py [book ...]  (SAMPLES_CACHE = scratch dir for downloads).
Texts come from ru.wikisource (modern spelling); editorial notes after the text are cut."""
import re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib

def ws(page, verse=False):
    return lib.wrapped_paragraphs(lib.wikisource('ru', page, verse))

def until_notes(paras):
    for i, p in enumerate(paras):
        if re.match(r'^## (Примечания|ПРИМЕЧАНИЯ)\.?$|^## ----', p): return paras[:i]
    return paras

def clean(paras):
    return [lib.de_gutenberg_markup(re.sub(r'\[\d+\]', '', p)) for p in paras]

def split_headed(paras, fix=lambda h: h):
    """[(heading, paragraphs)] from paragraphs where '## ' lines open sections."""
    secs, cur = [], [None, []]
    for p in paras:
        if p.startswith('## '):
            if cur[0] or cur[1]: secs.append(tuple(cur))
            cur = [fix(p[3:].strip()), []]
        else: cur[1].append(p)
    if cur[0] or cur[1]: secs.append(tuple(cur))
    return secs

def tolstoy():
    secs = []
    for page, title in [('Три медведя (Толстой)', 'Три медведя'), ('Филипок (Толстой)', 'Филипок'), ('Лев и собачка (Толстой)', 'Лев и собачка'), ('Прыжок (Толстой)', 'Прыжок')]:
        secs.append((title, clean(until_notes(ws(page)))))
    return lib.write_book('ru', 'tolstoy-rasskazy', 'Рассказы для детей', secs)

def kashtanka():
    secs = split_headed(until_notes(ws('Каштанка (Чехов)')))
    return lib.write_book('ru', 'kashtanka', 'Каштанка', [(h, clean(p)) for h, p in secs])

def mumu():
    return lib.write_book('ru', 'mumu', 'Муму', [(None, clean(until_notes(ws('Муму'))))])

def shinel():
    return lib.write_book('ru', 'shinel', 'Шинель', [(None, clean(until_notes(ws('Шинель (Гоголь)/ПСС 1938 (СО)'))))])

def belye_nochi():
    paras = until_notes(ws('Белые ночи (Достоевский)'))
    secs = split_headed(paras)
    assert secs[0][0] is None
    # the opening (title page leftovers and the Turgenev epigraph) is kept as the first section
    return lib.write_book('ru', 'belye-nochi', 'Белые ночи', [(h, clean(p)) for h, p in secs])

def kapitanskaya_dochka():
    paras = until_notes(ws('Капитанская дочка (Пушкин)/1978 (СО)'))
    def fix(h):
        m = re.match(r'^Глава ([IVXL]+)\.\s*(.+)$', h, re.I)
        t = m.group(2).strip()
        return f'Глава {m.group(1).upper()}. ' + (t[0].upper() + t[1:].lower() if t.isupper() else t)
    secs = split_headed(paras, fix)
    return lib.write_book('ru', 'kapitanskaya-dochka', 'Капитанская дочка', [(h, clean(p)) for h, p in secs])

def geroi():
    pages = [('Предисловие автора', 'Предисловие'), ('Бэла', 'Бэла'), ('Максим Максимыч', 'Максим Максимыч'), ('Журнал Печорина: предисловие', 'Журнал Печорина'),
             ('Тамань', 'Тамань'), ('Княжна Мери', 'Княжна Мери'), ('Фаталист', 'Фаталист')]
    secs = []
    for head, page in pages:
        paras = until_notes(ws('Герой нашего времени (Лермонтов)/СО/' + page))
        paras = [p for p in paras if not p.startswith('## ') and p != 'Конец первой части.']
        secs.append((head, clean(paras)))
    return lib.write_book('ru', 'geroi-nashego-vremeni', 'Герой нашего времени', secs)

if __name__ == '__main__':
    for name in sys.argv[1:] or ['tolstoy', 'kashtanka', 'mumu', 'shinel', 'belye_nochi', 'kapitanskaya_dochka', 'geroi']:
        print(name, lib.stats(globals()[name]()))
