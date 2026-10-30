"""Shared helpers for building the per-language starter libraries (public/samples/<lang>/).

Set SAMPLES_CACHE to a scratch directory (downloads are cached there, never in the repo).
Run scripts with `python3 -I` from anywhere; build_<lang>.py import this module via sys.path.
"""
import json, os, re, subprocess, sys, tempfile, unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
CACHE = os.environ.get('SAMPLES_CACHE') or os.path.join(tempfile.gettempdir(), 'dushu-samples')
os.makedirs(CACHE, exist_ok=True)

def _run(*a):
    r = subprocess.run(list(a), capture_output=True)
    if r.returncode: raise RuntimeError(f'{a}: {r.stderr.decode()[:300]}')
    return r.stdout

def gutenberg(ebook):
    """Plain text of a Project Gutenberg ebook, header/footer/license removed."""
    dl, out = os.path.join(CACHE, f'pg{ebook}.dl'), os.path.join(CACHE, f'pg{ebook}.txt')
    if not os.path.exists(out):
        _run(os.path.join(HERE, 'fetch.sh'), 'gutenberg', str(ebook), dl)
        t = open(dl, encoding='utf-8-sig').read().replace('\r\n', '\n').replace('\r', '\n')
        a = re.search(r'\*\*\* ?START OF (?:THE|THIS) PROJECT GUTENBERG EBOOK[^\n]*\*\*\*', t)
        b = re.search(r'\*\*\* ?END OF (?:THE|THIS) PROJECT GUTENBERG EBOOK', t)
        body = t[a.end():b.start() if b else len(t)] if a else t
        body = re.sub(r"\n+End of (?:the )?Project Gutenberg[^\n]*\s*$", '', body)
        open(out, 'w', encoding='utf-8').write(unicodedata.normalize('NFC', body).strip('\n') + '\n')
        os.remove(dl)
    return open(out, encoding='utf-8').read()

def wikisource(lang, title, verse=False):
    """Text of a Wikisource page (rendered, then flattened). Headings come out as '## ' lines."""
    key = re.sub(r'[^\w]+', '_', f'{lang}_{title}')[:90] + ('_v' if verse else '')
    out = os.path.join(CACHE, 'ws_' + key + '.txt')
    if not os.path.exists(out):
        h = os.path.join(CACHE, 'ws_' + key + '.html')
        _run(os.path.join(HERE, 'fetch.sh'), 'wikisource', lang, title, h)
        args = [sys.executable, '-I', os.path.join(HERE, 'wikisource.py'), h, out] + (['--verse'] if verse else [])
        _run(*args)
        os.remove(h)
    return open(out, encoding='utf-8').read()

def wrapped_paragraphs(text):
    """Blank-line separated paragraphs of hard-wrapped text, each joined into one line."""
    out = []
    for block in re.split(r'\n\s*\n', text.strip('\n')):
        s = ' '.join(l.strip() for l in block.split('\n') if l.strip())
        s = re.sub(r'\s+', ' ', s).strip()
        if s: out.append(s)
    return out

def verse_lines(text):
    """Each non-empty line is its own paragraph (used for verse)."""
    return [re.sub(r'\s+', ' ', l).strip() for l in text.split('\n') if l.strip()]

def unshout(p):
    """A paragraph that opens with an ALL-CAPS word (a printer's drop-cap style) gets ordinary capitalisation."""
    m = re.match(r'^([A-ZÁÉÍÓÚÜÑ]{2,})(?=[\s,.;:!?—-])(.*)$', p, re.S)
    if m and not re.match(r'^\s*[A-ZÁÉÍÓÚÜÑ]{2,}\b', m.group(2)):
        return m.group(1).capitalize() + m.group(2)
    return p

def de_gutenberg_markup(s):
    """Underscore italics, [Illustration] and note markers out; '--' to an em dash."""
    s = s.replace('<tb>', '')
    s = re.sub(r'\[(?:Illustration|Ilustración|Illustrazione|Illustratione)[^\]]*\]', '', s)
    s = re.sub(r'\[Nota? ?\d+\]|\[\d+\]|\[Footnote[^\]]*\]', '', s)
    s = s.replace('_', '')
    s = s.replace('--', '—')
    return unshout(re.sub(r'\s+', ' ', s).strip())

MD_RISK = re.compile(r'^(?:[#*\-+>|`=~]|\d+[.)](?:\s|$)|[-*_]{3,}|\[[ xX]?\]:)')
def md_safe(p):
    """Make sure a paragraph is not read as Markdown (headings, lists, quotes, rules); drops ornament lines."""
    p = p.replace('\u00a0', ' ').replace('*', '').strip()
    p = re.sub(r'\s+', ' ', p)
    if re.fullmatch(r'[\s\-_=~\u00b7\u2022.]*', p): return ''
    if MD_RISK.match(p): p = '\\' + p
    return p

BAD = re.compile(r'Project Gutenberg|Gutenberg|�|\[(?:Illustration|Ilustración)|&[a-z]+;|<[a-z/][^>]*>|â€|Ã[\xa0-\xbf]|\[\s*\d+\s*\]')
FIXES = {}  # book id -> [(old, new)] literal corrections of source slips, applied by write_book (each must match)

def write_book(lang, bid, title, sections, outdir=None):
    """sections: list of (heading or None, [paragraphs]). Writes public/samples/<lang>/<bid>.md; returns its text."""
    outdir = outdir or os.path.join(REPO, 'public', 'samples', lang)
    os.makedirs(outdir, exist_ok=True)
    parts = ['# ' + title.strip()]
    nchap = 0
    for head, paras in sections:
        if head:
            parts.append('## ' + re.sub(r'\s+', ' ', head).strip()); nchap += 1
        for p in paras:
            p = md_safe(p)
            if p: parts.append(p)
    text = unicodedata.normalize('NFC', '\n\n'.join(parts)) + '\n'
    text = re.sub('[\u00ad\u200b\u200c\u200d\u2060\ufeff]', '', text)
    text = re.sub(r"(?<=[^\W\d_])'(?=[^\W\d_])", '\u2019', text)  # typographic apostrophe between letters, everywhere
    for old, new in FIXES.get(bid, []):
        if old not in text: raise ValueError(f'{bid}: fix target not found: {old!r}')
        text = text.replace(old, new)
    m = BAD.search(text)
    if m: raise ValueError(f'{bid}: suspicious text {m.group(0)!r} near {text[max(0,m.start()-60):m.start()+60]!r}')
    open(os.path.join(outdir, bid + '.md'), 'w', encoding='utf-8').write(text)
    return text

def stats(text):
    return {'chars': len(text), 'chapters': len(re.findall(r'^## ', text, re.M)), 'bytes': len(text.encode('utf-8'))}

def sections_by_heading(paras, is_heading):
    """Split a flat paragraph list into [(heading, paras)] where is_heading(p) is truthy for chapter lines.
    Paragraphs before the first heading go into a (None, ...) section."""
    out, cur = [], (None, [])
    for p in paras:
        h = is_heading(p)
        if h:
            if cur[0] or cur[1]: out.append(cur)
            cur = (h if isinstance(h, str) else p, [])
        else:
            cur[1].append(p)
    if cur[0] or cur[1]: out.append(cur)
    return out

def smart_case(title, body):
    """Sentence case for an ALL-CAPS title; a word keeps its capital when the body mostly writes it capitalised
    in mid-sentence (names, places). A title that is not all caps is returned unchanged."""
    letters = re.sub(r'[^A-Za-zÀ-ÿ]', '', title)
    if not letters or letters != letters.upper(): return title
    out = []
    for i, w in enumerate(title.split(' ')):
        core = re.sub(r"^[^\wÀ-ÿ]+|[^\wÀ-ÿ]+$", '', w)
        low = core.lower()
        if not core: out.append(w); continue
        cap = low[:1].upper() + low[1:]
        ncap = len(re.findall(r"(?<=[a-zà-ÿ,;] )" + re.escape(cap) + r"\b", body))
        nlow = len(re.findall(r"(?<![\w])" + re.escape(low) + r"\b", body))
        use = cap if (i == 0 or (ncap > 0 and ncap >= nlow)) else low
        out.append(w.replace(core, use, 1))
    return ' '.join(out)

def drop_footnotes(paras, sig=None):
    """Remove editor's footnote blocks: a paragraph opening with [1] / [a] / [Note ...] starts one, and it runs on
    while the last dropped paragraph ends mid-sentence (':' or no closing punctuation) or the next is a short « quote »;
    unmarked paragraphs that end in an editor's initial (' B.') are dropped too."""
    out, dropping, last = [], False, ''
    for p in paras:
        if re.match(r'^\[(?:\d+|[a-z]|Note[^\]]*)\]\s', p):
            dropping, last = True, p; continue
        if dropping:
            if last.rstrip().endswith((':', ',', ';')) or (p.startswith('«') and len(p) < 120) or not re.search(r'[.!?»)\]]$', last.rstrip()):
                last = p; continue
            dropping = False
        if sig and len(p) < 500 and re.search(sig, p): continue
        out.append(p)
    return out
