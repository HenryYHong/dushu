// The English dictionary's rare words (scripts/lang/en/build_rare.py): the ECDICT words the main dictionary leaves out, in
// small files by their first two letters (data/en/rare/ca.tsv.gz). The word card fetches one only when the dictionary has no
// entry for a word (cavillers), and the service worker keeps each file it has fetched.
import { fetchDataText } from '../../core/dataFetch';

export interface RareWord {
  /** The form found (caviller for cavillers). */
  key: string;
  /** ECDICT's Chinese translation, its lines joined by " | ". */
  gloss: string;
}

/** The file a key is in: its first two letters, '_' for anything else. Mirrors build_rare.py shard(). */
export const rareShard = (key: string): string => [...`${key}_`.slice(0, 2)].map((c) => (c >= 'a' && c <= 'z' ? c : '_')).join('');

const files = new Map<string, Promise<Map<string, string> | null>>();

function load(base: string, name: string): Promise<Map<string, string> | null> {
  const url = `${base}rare/${name}.tsv.gz`;
  let p = files.get(url);
  if (!p) {
    p = fetchDataText(url).then((text) => {
      const m = new Map<string, string>();
      for (const line of text.split('\n')) {
        const t = line.indexOf('\t');
        if (t > 0) m.set(line.slice(0, t), line.slice(t + 1));
      }
      return m;
    }).catch(() => { files.delete(url); return null; }); // offline: asked again next time
    files.set(url, p);
  }
  return p;
}

/** What a word on the page may be, the word itself first: cavillers → caviller, cavilled → cavil, parodies → parody. */
export function rareCandidates(word: string): string[] {
  const w = word.toLowerCase().replace(/’/g, "'").replace(/'s$/, '');
  const out = [w];
  const add = (s: string) => { if (s.length >= 2 && !out.includes(s)) out.push(s); };
  if (w.endsWith('ies')) add(`${w.slice(0, -3)}y`);
  if (w.endsWith('es')) add(w.slice(0, -2));
  if (w.endsWith('s') && !w.endsWith('ss')) add(w.slice(0, -1));
  if (w.endsWith('ied')) add(`${w.slice(0, -3)}y`);
  for (const end of ['ed', 'ing']) {
    if (!w.endsWith(end)) continue;
    const stem = w.slice(0, -end.length);
    add(stem);
    add(`${stem}e`);
    if (/([b-df-hj-np-tv-z])\1$/.test(stem)) add(stem.slice(0, -1)); // cavilled → cavil
  }
  return out;
}

/** The rare word `word` is, or a form of one, from the English data at `base` (…/data/en/); null when none is there. */
export async function rareLookup(base: string, word: string): Promise<RareWord | null> {
  for (const key of rareCandidates(word)) {
    if (!/^[a-z][a-z'-]*$/.test(key)) continue;
    const gloss = (await load(base, rareShard(key)))?.get(key);
    if (gloss) return { key, gloss };
  }
  return null;
}
