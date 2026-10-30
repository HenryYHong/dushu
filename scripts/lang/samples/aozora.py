#!/usr/bin/env python3 -I
"""Fetch an Aozora Bunko work (ruby ZIP, Shift_JIS) and convert it to the Dushu sample Markdown.

  python3 -I aozora.py <card-url> <id> <outdir> [--levels 大,中,小]

Writes <outdir>/<id>.md (and prints the 底本 footer, so the first-publication year can be checked).
Cleaning: header and 底本 footer removed, ［＃…］ annotations removed (heading annotations become
"## " lines), gaiji (※［＃…、U+xxxx］) replaced by the code point. The publisher's ruby stays as Aozora writes it,
漢字《かんじ》 and ｜一人《ひとり》 (｜ only where Aozora has it): the app takes it out of the text on import
(src/import/aozora.ts) and shows it as the book's own furigana.
"""
import io, re, sys, unicodedata, urllib.request, urllib.parse, zipfile, os
UA = {'User-Agent': 'Dushu-sample-fetcher/0.1 (personal reading app)'}

def get(url):
    # curl, because this Python has no CA bundle
    import subprocess
    return subprocess.run(['curl', '-sfL', '-m', '90', '-A', UA['User-Agent'], url], check=True, capture_output=True).stdout

def convert(text, levels):
    t = text.replace('\r\n', '\n').replace('\r', '\n')
    parts = re.split(r'-{20,}\n', t)
    title_block = parts[0].strip().split('\n') if len(parts) >= 3 else []
    body = parts[2] if len(parts) >= 3 else t
    if len(parts) > 3: body = '-------------------------------------------------------\n'.join(parts[2:])
    ms = list(re.finditer(r'\n+底本：', body))
    m = ms[-1] if ms else None
    footer = ''
    if m: footer, body = body[m.start():], body[:m.start()]
    # gaiji
    body = re.sub(r'※［＃[^］]*?U\+([0-9A-Fa-f]{4,5})[^］]*］', lambda m: chr(int(m.group(1), 16)), body)
    # gaiji given as JIS X 0213 plane-row-cell, e.g. ※［＃「特のへん＋廴＋聿」、第3水準1-87-71］
    def jis(m):
        pl, ku, te = int(m.group(1)), int(m.group(2)), int(m.group(3))
        b = bytes([0xA0 + ku, 0xA0 + te]) if pl == 1 else bytes([0x8F, 0xA0 + ku, 0xA0 + te])
        return b.decode('euc_jis_2004')
    body = re.sub(r'※［＃[^］]*?(\d)-(\d{1,2})-(\d{1,2})］', jis, body)
    out = []
    for line in body.split('\n'):
        h = re.search(r'［＃「(.+?)」は(大|中|小)見出し］', line)
        if h and h.group(2) in levels:
            out.append('\n## ' + h.group(1) + '\n'); continue
        out.append(line)
    body = '\n'.join(out)
    body = re.sub(r'［＃[^］]*］', '', body)
    body = unicodedata.normalize('NFC', body)
    paras = [l.strip() for l in body.split('\n') if l.strip()]
    res = '\n\n'.join(paras)
    return title_block, res, footer


def main():
    args = sys.argv[1:]
    levels = '大中小'
    if '--levels' in args:
        i = args.index('--levels'); levels = args[i + 1]; del args[i:i + 2]
    url, bid, outdir = args
    page = get(url).decode('utf-8', 'replace')
    z = re.search(r'href="(\./files/[^"]*ruby[^"]*\.zip)"', page).group(1)
    zurl = urllib.parse.urljoin(url, z)
    zf = zipfile.ZipFile(io.BytesIO(get(zurl)))
    name = [n for n in zf.namelist() if n.endswith('.txt')][0]
    text = zf.read(name).decode('cp932')
    head, body, footer = convert(text, levels)
    os.makedirs(outdir, exist_ok=True)
    title = head[0].strip() if head else bid
    open(os.path.join(outdir, bid + '.md'), 'w', encoding='utf-8').write('# ' + title + '\n\n' + body + '\n')
    print(zurl); print('HEAD', head[:3]); print('FOOTER', footer[:700])

main()
