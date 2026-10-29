// Deinflection by suffix rules, after Yomichan's: for a word with no context (typed in, or a selection that is not one token),
// peel endings off until a dictionary form is left (食べさせられなかった → 食べる: negative past, causative-passive). Each rule
// says which word type the inflected string must be and which type the result is; a result counts only when a JMdict entry
// with that form has a matching part of speech (the caller checks).

export interface Deinflection {
  term: string;
  /** The type of `term`: 'v1', 'v5k' … 'vk', 'vs', 'adj-i', or '' for the string as given. */
  type: string;
  /** What was peeled off, innermost first ("causative", "negative", "past"). */
  forms: string[];
}

interface Rule { from: string; to: string; inTypes: string[]; outType: string; form: string }

const rules: Rule[] = [];
const add = (from: string, to: string, inTypes: string[], outType: string, form: string) => rules.push({ from, to, inTypes, outType, form });

const ANY = ['']; // the string as given
// Godan rows: dictionary ending, a, i, e, o stems, past, te.
const GODAN: [string, string, string, string, string, string, string, string][] = [
  ['う', 'わ', 'い', 'え', 'お', 'った', 'って', 'v5u'],
  ['く', 'か', 'き', 'け', 'こ', 'いた', 'いて', 'v5k'],
  ['ぐ', 'が', 'ぎ', 'げ', 'ご', 'いだ', 'いで', 'v5g'],
  ['す', 'さ', 'し', 'せ', 'そ', 'した', 'して', 'v5s'],
  ['つ', 'た', 'ち', 'て', 'と', 'った', 'って', 'v5t'],
  ['ぬ', 'な', 'に', 'ね', 'の', 'んだ', 'んで', 'v5n'],
  ['ぶ', 'ば', 'び', 'べ', 'ぼ', 'んだ', 'んで', 'v5b'],
  ['む', 'ま', 'み', 'め', 'も', 'んだ', 'んで', 'v5m'],
  ['る', 'ら', 'り', 'れ', 'ろ', 'った', 'って', 'v5r'],
];

for (const [d, a, i, e, o, ta, te, t] of GODAN) {
  add(ta, d, ANY, t, 'past');
  add(te, d, ['', 'te'], t, 'te-form');
  add(ta + 'ら', d, ANY, t, 'conditional (tara)');
  add(ta + 'り', d, ANY, t, 'tari');
  add(a + 'ない', d, ['', 'adj-i'], t, 'negative');
  add(a + 'ず', d, ANY, t, 'negative');
  add(a + 'ぬ', d, ANY, t, 'negative');
  add(i + 'ます', d, ['', 'masu'], t, 'polite');
  add(i + 'たい', d, ['', 'adj-i'], t, 'want to (tai)');
  add(i + 'そう', d, ANY, t, 'looks like (sou)');
  add(i + 'すぎる', d, ['', 'v1'], t, 'too much (sugiru)');
  add(i + 'ながら', d, ANY, t, 'while (nagara)');
  add(i + 'なさい', d, ANY, t, 'polite command (nasai)');
  add(i + 'やすい', d, ['', 'adj-i'], t, 'easy to (yasui)');
  add(i + 'にくい', d, ['', 'adj-i'], t, 'hard to (nikui)');
  add(i, d, ANY, t, 'stem (continuative)');
  add(e + 'ば', d, ANY, t, 'conditional (ba)');
  add(e, d, ANY, t, 'imperative');
  add(e + 'る', d, ['', 'v1'], t, 'potential');
  add(o + 'う', d, ANY, t, 'volitional');
  add(a + 'れる', d, ['', 'v1'], t, 'passive');
  add(a + 'せる', d, ['', 'v1'], t, 'causative');
  add(a + 'せられる', d, ['', 'v1'], t, 'causative-passive');
  if (d !== 'す') add(a + 'される', d, ['', 'v1'], t, 'causative-passive');
}
// 行く: 行った, 行って.
add('った', 'く', ANY, 'v5k-s', 'past');
add('って', 'く', ['', 'te'], 'v5k-s', 'te-form');
add('ったら', 'く', ANY, 'v5k-s', 'conditional (tara)');
// Ichidan verbs.
for (const [from, form, inTypes] of [
  ['た', 'past', ANY], ['て', 'te-form', ['', 'te']], ['たら', 'conditional (tara)', ANY], ['たり', 'tari', ANY],
  ['ない', 'negative', ['', 'adj-i']], ['ず', 'negative', ANY], ['ぬ', 'negative', ANY], ['ます', 'polite', ['', 'masu']],
  ['たい', 'want to (tai)', ['', 'adj-i']], ['そう', 'looks like (sou)', ANY], ['すぎる', 'too much (sugiru)', ['', 'v1']],
  ['ながら', 'while (nagara)', ANY], ['なさい', 'polite command (nasai)', ANY], ['やすい', 'easy to (yasui)', ['', 'adj-i']],
  ['にくい', 'hard to (nikui)', ['', 'adj-i']], ['れば', 'conditional (ba)', ANY], ['ろ', 'imperative', ANY], ['よ', 'imperative', ANY],
  ['よう', 'volitional', ANY], ['られる', 'passive or potential', ['', 'v1']], ['れる', 'potential', ['', 'v1']],
  ['させる', 'causative', ['', 'v1']], ['させられる', 'causative-passive', ['', 'v1']],
  ['', 'stem (continuative)', ANY],
] as [string, string, string[]][]) add(from, 'る', inTypes, 'v1', form);
// する and 来る.
for (const [from, form, inTypes] of [
  ['した', 'past', ANY], ['して', 'te-form', ['', 'te']], ['したら', 'conditional (tara)', ANY], ['しない', 'negative', ['', 'adj-i']],
  ['せず', 'negative', ANY], ['します', 'polite', ['', 'masu']], ['したい', 'want to (tai)', ['', 'adj-i']], ['しよう', 'volitional', ANY],
  ['すれば', 'conditional (ba)', ANY], ['しろ', 'imperative', ANY], ['せよ', 'imperative', ANY], ['される', 'passive', ['', 'v1']],
  ['させる', 'causative', ['', 'v1']], ['させられる', 'causative-passive', ['', 'v1']], ['できる', 'potential', ['', 'v1']],
  ['しそう', 'looks like (sou)', ANY], ['しながら', 'while (nagara)', ANY], ['しすぎる', 'too much (sugiru)', ['', 'v1']],
] as [string, string, string[]][]) add(from, 'する', inTypes, 'vs', form);
for (const k of ['き', '来']) {
  for (const [from, form, inTypes] of [
    ['た', 'past', ANY], ['て', 'te-form', ['', 'te']], ['たら', 'conditional (tara)', ANY], ['ます', 'polite', ['', 'masu']],
    ['たい', 'want to (tai)', ['', 'adj-i']], ['そう', 'looks like (sou)', ANY], ['ながら', 'while (nagara)', ANY],
  ] as [string, string, string[]][]) add(k + from, k === 'き' ? 'くる' : '来る', inTypes, 'vk', form);
}
for (const k of ['こ', '来']) {
  for (const [from, form, inTypes] of [
    ['ない', 'negative', ['', 'adj-i']], ['よう', 'volitional', ANY], ['い', 'imperative', ANY], ['られる', 'passive or potential', ['', 'v1']],
    ['させる', 'causative', ['', 'v1']], ['ず', 'negative', ANY],
  ] as [string, string, string[]][]) add(k + from, k === 'こ' ? 'くる' : '来る', inTypes, 'vk', form);
}
add('くれば', 'くる', ANY, 'vk', 'conditional (ba)');
add('来れば', '来る', ANY, 'vk', 'conditional (ba)');
// The する-noun under its する: 勉強する → 勉強.
add('する', '', ['vs'], 'vs-noun', '');
// i-adjectives.
for (const [from, form, inTypes] of [
  ['かった', 'past', ANY], ['くない', 'negative', ['', 'adj-i']], ['くて', 'te-form', ANY], ['く', 'adverbial (ku)', ANY],
  ['ければ', 'conditional (ba)', ANY], ['かったら', 'conditional (tara)', ANY], ['さ', 'noun (-sa)', ANY], ['そう', 'looks like (sou)', ANY],
  ['すぎる', 'too much (sugiru)', ['', 'v1']], ['かろう', 'volitional', ANY], ['くありません', 'polite negative', ANY],
  ['かったです', 'polite past', ANY], ['がる', 'shows signs of (garu)', ['', 'v5']],
] as [string, string, string[]][]) add(from, 'い', inTypes, 'adj-i', form);
// ます and its own endings, to the masu type the polite rules above take.
for (const [from, form] of [['ました', 'past'], ['ません', 'negative'], ['ませんでした', 'negative+past'], ['ましょう', 'volitional'], ['まして', 'te-form']]) add(from, 'ます', ANY, 'masu', form);
// Te-form constructions, to a te-form string.
for (const [from, to, form, inTypes] of [
  ['ている', 'て', 'progressive (te iru)', ['', 'v1']], ['でいる', 'で', 'progressive (te iru)', ['', 'v1']],
  ['てる', 'て', 'progressive (te iru)', ['', 'v1']], ['でる', 'で', 'progressive (te iru)', ['', 'v1']],
  ['てある', 'て', 'resultative (te aru)', ['', 'v5']], ['である', 'で', 'resultative (te aru)', ['', 'v5']],
  ['ておく', 'て', 'in advance (te oku)', ['', 'v5']], ['でおく', 'で', 'in advance (te oku)', ['', 'v5']],
  ['とく', 'て', 'in advance (te oku)', ['', 'v5']], ['どく', 'で', 'in advance (te oku)', ['', 'v5']],
  ['てしまう', 'て', 'completed (te shimau)', ['', 'v5']], ['でしまう', 'で', 'completed (te shimau)', ['', 'v5']],
  ['ちゃう', 'て', 'completed (te shimau)', ['', 'v5']], ['じゃう', 'で', 'completed (te shimau)', ['', 'v5']],
] as [string, string, string, string[]][]) add(from, to, inTypes, 'te', form);

const typeMatches = (have: string, want: string[]) => want.some((w) => w === have || (w === 'v5' && have.startsWith('v5')));

/** Every way to read `word` as an inflected form, the word itself first. */
export function deinflect(word: string): Deinflection[] {
  const out: Deinflection[] = [{ term: word, type: '', forms: [] }];
  const seen = new Set<string>([word + '\u0000']);
  for (let k = 0; k < out.length && out.length < 200; k++) {
    const cur = out[k];
    if (cur.forms.length > 6) continue;
    for (const r of rules) {
      if (!cur.term.endsWith(r.from) || !typeMatches(cur.type, r.inTypes)) continue;
      const term = cur.term.slice(0, cur.term.length - r.from.length) + r.to;
      if (!term) continue;
      const key = term + '\u0000' + r.outType;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ term, type: r.outType, forms: r.form ? [...r.form.split('+'), ...cur.forms] : cur.forms });
    }
  }
  return out;
}

/** Whether a JMdict part-of-speech set fits a deinflected type. */
export function posFits(type: string, pos: ReadonlySet<string>): boolean {
  if (!type) return true;
  if (type === 'v1') return pos.has('v1') || pos.has('v1-s') || pos.has('vz');
  if (type === 'vs') return pos.has('vs-i') || pos.has('vs-s') || pos.has('vs');
  if (type === 'vs-noun') return pos.has('vs');
  if (type === 'vk') return pos.has('vk');
  if (type === 'adj-i') return pos.has('adj-i') || pos.has('adj-ix');
  if (type === 'v5k-s') return pos.has('v5k-s');
  if (type.startsWith('v5')) return pos.has(type) || (type === 'v5r' && (pos.has('v5r-i') || pos.has('v5aru'))) || (type === 'v5u' && pos.has('v5u-s')) || (type === 'v5k' && pos.has('v5k-s'));
  return false;
}
