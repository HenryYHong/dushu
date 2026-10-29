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
    if (ls[0] === 'past') return 'past tense';
    if (ls[0] === 'polite') return 'polite form';
    return ls[0];
  }
  const segments: string[][] = [[]];
  for (const l of ls) {
    const cur = segments[segments.length - 1];
    const plain = MODIFIERS.has(l) || FINALS.has(l);
    if (!plain && cur.length) segments.push([l]);
    else if (plain && cur.length && !MODIFIERS.has(cur[cur.length - 1]) && !FINALS.has(cur[cur.length - 1])) segments.push([l]);
    else cur.push(l);
  }
  return segments.map((s) => s.join(' ')).join(', ');
}
