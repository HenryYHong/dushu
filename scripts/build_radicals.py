# Writes the data part of src/import/radicals.ts: every radical's equivalent ideograph (Unicode's EquivalentUnifiedIdeograph.txt,
# Unicode License v3), and, for the radicals a common Mac font draws with the glyph of another character, the common two-character
# words of both candidates (jieba counts in public/data/words.tsv.gz, MIT).
# Run: python3 scripts/build_radicals.py <EquivalentUnifiedIdeograph.txt>
# (download https://www.unicode.org/Public/UCD/latest/ucd/EquivalentUnifiedIdeograph.txt)
import gzip, os, re, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
# Found by reading the cmaps of the Mac's Chinese fonts: the radical's glyph is another character's (Songti SC: ⼜ is 口;
# Heiti SC: ⼲ is 广, ⾶ is 飘, ⺴ is 网, ⻯ is 龍, ⺽ is 臼; Libian and Baoli: ⾇ is 舜).
OTHER = {0x2F1C: '口', 0x2F32: '广', 0x2FB6: '飘', 0x2EB4: '网', 0x2EEF: '龍', 0x2EBD: '臼', 0x2F87: '舜'}

eui = {}
for line in open(sys.argv[1], encoding='utf-8'):
    line = line.split('#')[0].strip()
    if not line:
        continue
    a, b = [x.strip() for x in line.split(';')]
    lo, hi = (a.split('..') + [a])[:2]
    for cp in range(int(lo, 16), int(hi, 16) + 1):
        if 0x2E80 <= cp <= 0x2FDF:
            eui[cp] = int(b, 16)
counts = {}
with gzip.open(os.path.join(ROOT, 'public', 'data', 'words.tsv.gz'), 'rt', encoding='utf-8') as f:
    for line in f:
        parts = line.rstrip('\n').split('\t')
        if line.startswith('#') or len(parts) < 2 or len(parts[0]) != 2:
            continue
        try:
            counts[parts[0]] = int(parts[1])
        except ValueError:
            pass
pairs = ''.join(chr(c) + chr(t) for c, t in sorted(eui.items()))
chunks = [pairs[i:i + 120] for i in range(0, len(pairs), 120)]
words = {}
for r, other in OTHER.items():
    for c in (chr(eui[r]), other):
        if c not in words:
            words[c] = ' '.join(sorted((w for w in counts if c in w and counts[w] >= 100), key=lambda w: -counts[w])[:80])
data = 'const RADICALS =\n' + ' +\n'.join(f"  '{c}'" for c in chunks) + ';\n'
data += '\n/** Radical to the other character a common Mac font draws with its glyph. */\n'
data += 'const OTHER: Record<string, string> = { ' + ', '.join(f"'{chr(k)}': '{v}'" for k, v in OTHER.items()) + ' };\n'
data += '\n/** Common two-character words of each candidate, for choosing between them by their neighbours. */\n'
data += 'const WORDS: Record<string, string> = {\n' + ''.join(f"  '{k}': '{v}',\n" for k, v in words.items() if v) + '};\n'
path = os.path.join(ROOT, 'src', 'import', 'radicals.ts')
src = open(path, encoding='utf-8').read()
begin = '// --- made by scripts/build_radicals.py; do not edit by hand ---\n'
end = '// --- end of the made part ---\n'
i, j = src.index(begin) + len(begin), src.index(end)
open(path, 'w', encoding='utf-8').write(src[:i] + data + src[j:])
print(len(eui), 'radicals,', len(words), 'word lists')
