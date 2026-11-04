// Writes src/import/hkscs.ts: for each Big5 byte pair that Node's TextDecoder('big5') gives as a private-use code point (the
// old Big5 user-defined area, where Hong Kong's characters sit), the character the WHATWG Encoding Standard's Big5 index
// gives the same pair. Run: node scripts/build-hkscs.mjs <index-big5.txt>
// (download https://encoding.spec.whatwg.org/index-big5.txt; the Encoding Standard is CC BY 4.0).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const index = new Map();
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const m = /^\s*(\d+)\t0x([0-9A-F]+)/.exec(line);
  if (m && !index.has(Number(m[1]))) index.set(Number(m[1]), parseInt(m[2], 16));
}
const dec = new TextDecoder('big5');
const map = new Map();
for (let lead = 0x81; lead <= 0xfe; lead++) {
  for (let trail = 0x40; trail <= 0xfe; trail++) {
    if (trail > 0x7e && trail < 0xa1) continue;
    const cps = [...dec.decode(new Uint8Array([lead, trail]))].map((c) => c.codePointAt(0));
    if (cps.length !== 1 || cps[0] < 0xe000 || cps[0] > 0xf8ff) continue;
    const u = index.get((lead - 0x81) * 157 + (trail - (trail < 0x7f ? 0x40 : 0x62)));
    if (u !== undefined) map.set(cps[0], u);
  }
}
const runs = [];
for (const k of [...map.keys()].sort((a, b) => a - b)) {
  const last = runs[runs.length - 1];
  if (last && last[0] + [...last[1]].length === k) last[1] += String.fromCodePoint(map.get(k));
  else runs.push([k, String.fromCodePoint(map.get(k))]);
}
const body = runs.map(([start, chars]) => {
  const cps = [...chars];
  const pieces = [];
  for (let i = 0; i < cps.length; i += 100) pieces.push(`'${cps.slice(i, i + 100).join('')}'`);
  return `  [0x${start.toString(16)},\n    ${pieces.join(' +\n    ')}],`;
}).join('\n');

const out = `// Big5-HKSCS characters a Big5 decoder gave as private-use code points (U+E000–U+F8FF). Browsers that follow the WHATWG
// Encoding Standard decode Hong Kong's characters (麽 旣 着 裏 …) to real ones; a decoder that keeps the old Big5 user-defined
// area (Node's, some others) gives them in the private-use area instead. Loaded only when a Big5 text holds such code points.
//
// Data: each private-use code point that decoder gives for a Big5 byte pair, mapped to the character the WHATWG Encoding
// Standard's index-big5 (https://encoding.spec.whatwg.org/index-big5.txt) gives the same pair. The Encoding Standard is
// Copyright © WHATWG (Apple, Google, Mozilla, Microsoft), licensed under CC BY 4.0
// (https://creativecommons.org/licenses/by/4.0/). Made by scripts/build-hkscs.mjs.

/** Runs of consecutive private-use code points: the first one, and the characters they stand for in order. */
const RUNS: [number, string][] = [
${body}
];

let table: Map<number, string> | null = null;

/** The private-use code points of a Big5 text replaced by the Hong Kong characters they stand for. */
export function mapHkscsPrivateUse(text: string): string {
  if (!table) {
    table = new Map();
    for (const [start, chars] of RUNS) {
      let cp = start;
      for (const ch of chars) table.set(cp++, ch);
    }
  }
  const t = table;
  return text.replace(/[\\ue000-\\uf8ff]/g, (c) => t.get(c.charCodeAt(0)) ?? c);
}
`;
writeFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'import', 'hkscs.ts'), out);
console.log(`${map.size} characters in ${runs.length} runs`);
