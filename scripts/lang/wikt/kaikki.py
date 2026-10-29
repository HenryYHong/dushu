"""Streaming access to kaikki.org's Wiktionary extracts, cut down to what Dushu's builder reads.

The dumps run to a gigabyte uncompressed and the machine has little disk, so they are never saved: the gzip stream is read
straight off the network and each entry is cut down to `slim()` as it passes. `--save-extract` keeps only that slim
projection (a tenth of the size) for rebuilding without a download while the builder itself is being worked on.
"""
import contextlib
import gzip
import json
import shutil
import subprocess
import urllib.parse
import urllib.request

UA = 'Dushu-data-builder/0.1 (personal reading app)'

# Form tags that mark metadata rows rather than inflected forms.
META_FORM_TAGS = {'table-tags', 'inflection-template', 'class', 'romanization', 'transliteration'}
SENSE_KEYS = ('glosses', 'raw_glosses', 'tags', 'raw_tags', 'topics', 'qualifier')


def kaikki_url(name):
    slug = name.replace(' ', '').replace('-', '')
    return f'https://kaikki.org/dictionary/{urllib.parse.quote(name)}/kaikki.org-dictionary-{urllib.parse.quote(slug)}.jsonl.gz'


@contextlib.contextmanager
def open_url(url, timeout=90):
    """A binary stream of the response body. curl when there is one: python.org's Python on macOS ships without a
    certificate store, and curl drops a connection that stalls for a minute instead of waiting on it forever."""
    if shutil.which('curl'):
        p = subprocess.Popen(['curl', '-sfL', '-A', UA, '--speed-limit', '2000', '--speed-time', '60', url],
                             stdout=subprocess.PIPE)
        try:
            yield p.stdout
        finally:
            p.stdout.close()
            p.kill()
        if p.wait() not in (0, -9):
            raise SystemExit(f'download failed: {url}')
        return
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        yield res


def stream_entries(name):
    """Every entry of the language's dump, parsed, read off the network through gzip. Nothing is written to disk."""
    with open_url(kaikki_url(name)) as res, gzip.open(res, 'rt', encoding='utf-8') as f:
        for line in f:
            if line.startswith('{'):
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue


def slim(e):
    """The fields the builder uses. Translations, etymologies, examples and sounds (most of a dump) are dropped."""
    out = {'w': e.get('word') or '', 'p': e.get('pos') or ''}
    if e.get('etymology_number'):
        out['n'] = e['etymology_number']
    heads = []
    for h in e.get('head_templates') or []:
        heads.append({'n': h.get('name') or '', 'a': h.get('args') or {}, 'x': h.get('expansion') or ''})
    if heads:
        out['h'] = heads
    forms = []
    for f in e.get('forms') or []:
        tags = f.get('tags') or []
        if any(t in META_FORM_TAGS for t in tags):
            continue
        form = f.get('form') or ''
        if not form or form == '-':
            continue
        row = [form, tags]
        if f.get('source'):
            row.append(f['source'])
        forms.append(row)
    if forms:
        out['f'] = forms
    senses = []
    for s in e.get('senses') or []:
        o = {k: s[k] for k in SENSE_KEYS if s.get(k)}
        fo = [x.get('word') for x in (s.get('form_of') or []) if x.get('word')]
        ao = [x.get('word') for x in (s.get('alt_of') or []) if x.get('word')]
        if fo:
            o['form_of'] = fo
        if ao:
            o['alt_of'] = ao
        senses.append(o)
    out['s'] = senses
    return out


def entries(name, extract_in=None, extract_out=None):
    """Slim entries for one Wiktionary language: from a saved extract when given one, else streamed (and optionally saved)."""
    if extract_in:
        with gzip.open(extract_in, 'rt', encoding='utf-8') as f:
            for line in f:
                yield json.loads(line)
        return
    sink = gzip.open(extract_out, 'wt', encoding='utf-8', compresslevel=6) if extract_out else None
    try:
        for e in stream_entries(name):
            s = slim(e)
            if sink:
                sink.write(json.dumps(s, ensure_ascii=False, separators=(',', ':')) + '\n')
            yield s
    finally:
        if sink:
            sink.close()


if __name__ == '__main__':
    # python3 kaikki.py Spanish out.jsonl.gz: save the slim projection only.
    import sys
    n = 0
    for _ in entries(sys.argv[1], extract_out=sys.argv[2]):
        n += 1
    print(sys.argv[1], n, 'entries')
