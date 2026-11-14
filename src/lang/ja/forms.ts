import { ttx, uiLang } from '../../i18n';

/**
 * A form's label in the interface's language: the catalogs key each '<label> [ja form]' (Japanese school grammar for a
 * Japanese interface, 使役 受身; the construction in kana elsewhere, "progressive (ている)"). English keeps the label.
 */
const NAMES: Record<string, () => string> = {
  'about to (kakaru)': () => ttx('about to (kakaru)', 'ja form'),
  'adverbial (ku)': () => ttx('adverbial (ku)', 'ja form'),
  'again (naosu)': () => ttx('again (naosu)', 'ja form'),
  'causative': () => ttx('causative', 'ja form'),
  'causative-passive': () => ttx('causative-passive', 'ja form'),
  'completed (te shimau)': () => ttx('completed (te shimau)', 'ja form'),
  'completely (kiru)': () => ttx('completely (kiru)', 'ja form'),
  'conditional': () => ttx('conditional', 'ja form'),
  'conditional (ba)': () => ttx('conditional (ba)', 'ja form'),
  'conditional (tara)': () => ttx('conditional (tara)', 'ja form'),
  'conditional stem': () => ttx('conditional stem', 'ja form'),
  'easy to (yasui)': () => ttx('easy to (yasui)', 'ja form'),
  'hard to (gatai)': () => ttx('hard to (gatai)', 'ja form'),
  'hard to (nikui)': () => ttx('hard to (nikui)', 'ja form'),
  'hard to (zurai)': () => ttx('hard to (zurai)', 'ja form'),
  'honorific (nasaru)': () => ttx('honorific (nasaru)', 'ja form'),
  'imperative': () => ttx('imperative', 'ja form'),
  'in advance (te oku)': () => ttx('in advance (te oku)', 'ja form'),
  'looks like (sou)': () => ttx('looks like (sou)', 'ja form'),
  'must (nai to ikenai)': () => ttx('must (nai to ikenai)', 'ja form'),
  'must (nakereba naranai)': () => ttx('must (nakereba naranai)', 'ja form'),
  'must not (te wa ikenai)': () => ttx('must not (te wa ikenai)', 'ja form'),
  'negative': () => ttx('negative', 'ja form'),
  'negative stem': () => ttx('negative stem', 'ja form'),
  'negative volitional': () => ttx('negative volitional', 'ja form'),
  'negative+past': () => ttx('negative+past', 'ja form'),
  'passive': () => ttx('passive', 'ja form'),
  'passive or potential': () => ttx('passive or potential', 'ja form'),
  'past': () => ttx('past', 'ja form'),
  'past tense': () => ttx('past tense', 'ja form'),
  'polite': () => ttx('polite', 'ja form'),
  'polite command (nasai)': () => ttx('polite command (nasai)', 'ja form'),
  'polite form': () => ttx('polite form', 'ja form'),
  'polite negative': () => ttx('polite negative', 'ja form'),
  'polite past': () => ttx('polite past', 'ja form'),
  'potential': () => ttx('potential', 'ja form'),
  'progressive (te iru)': () => ttx('progressive (te iru)', 'ja form'),
  'progressive (te oru)': () => ttx('progressive (te oru)', 'ja form'),
  'resultative (te aru)': () => ttx('resultative (te aru)', 'ja form'),
  'should (beki)': () => ttx('should (beki)', 'ja form'),
  'shows signs of (garu)': () => ttx('shows signs of (garu)', 'ja form'),
  'start to (dasu)': () => ttx('start to (dasu)', 'ja form'),
  'stem': () => ttx('stem', 'ja form'),
  'stem (continuative)': () => ttx('stem (continuative)', 'ja form'),
  'tari': () => ttx('tari', 'ja form'),
  'te wa (cha)': () => ttx('te wa (cha)', 'ja form'),
  'te-form': () => ttx('te-form', 'ja form'),
  'too much (sugiru)': () => ttx('too much (sugiru)', 'ja form'),
  'volitional': () => ttx('volitional', 'ja form'),
  'want someone to (te hoshii)': () => ttx('want someone to (te hoshii)', 'ja form'),
  'want to (tai)': () => ttx('want to (tai)', 'ja form'),
  'while (nagara)': () => ttx('while (nagara)', 'ja form'),
  'noun (-sa)': () => ttx('noun (-sa)', 'ja form'),
  'verb with する': () => ttx('verb with する', 'ja form'),
};
const name = (label: string): string => (Object.hasOwn(NAMES, label) ? NAMES[label]() : label);

// The form labels words.ts and deinflect.ts collect, said as one English phrase: ["causative", "passive", "negative", "past"]
// → "causative-passive negative past"; ["progressive (te iru)", "past"] → "progressive (te iru), past".

/** Labels that change the verb's voice or politeness or polarity: they read as adjectives before the final form. */
const MODIFIERS = new Set(['causative', 'passive', 'causative-passive', 'passive or potential', 'potential', 'polite', 'negative']);
/** Labels that end the word (tense, mood, a conjunctive ending). */
const FINALS = new Set(['past', 'te-form', 'conditional (ba)', 'conditional (tara)', 'volitional', 'negative volitional', 'imperative', 'tari', 'adverbial (ku)', 'te wa (cha)']);

export function describeForms(labels: readonly string[]): string | undefined {
  const ls: string[] = [];
  for (let i = 0; i < labels.length; i++) {
    const l = labels[i];
    // The te of a construction is part of it: 読んでいる is the progressive, not "te-form, progressive".
    if (l === 'te-form' && i + 1 < labels.length && !MODIFIERS.has(labels[i + 1]) && !FINALS.has(labels[i + 1])) continue;
    if (l === 'passive' && ls[ls.length - 1] === 'causative') { ls[ls.length - 1] = 'causative-passive'; continue; }
    if (ls.length && ls[ls.length - 1] === l) continue;
    ls.push(l);
  }
  if (!ls.length) return undefined;
  if (ls.length === 1) {
    if (ls[0] === 'past') return name('past tense');
    if (ls[0] === 'polite') return name('polite form');
    return name(ls[0]);
  }
  const segments: string[][] = [[]];
  for (const l of ls) {
    const cur = segments[segments.length - 1];
    const plain = MODIFIERS.has(l) || FINALS.has(l);
    if (!plain && cur.length) segments.push([l]);
    else if (plain && cur.length && !MODIFIERS.has(cur[cur.length - 1]) && !FINALS.has(cur[cur.length - 1])) segments.push([l]);
    else cur.push(l);
  }
  // Japanese and Chinese list with 、 (「〜ている」（進行）、過去).
  return segments.map((s) => s.map(name).join(' ')).join(['ja', 'zh', 'zh-Hant'].includes(uiLang()) ? '、' : ', ');
}
