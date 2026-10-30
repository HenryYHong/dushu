// German words the dictionary has in another shape than the book: the spelling before 1996, a capital the sentence gave, an
// adjective's or participle's ending, a separable verb's zu-infinitive. The engine tries these only for a word nothing else
// reads (SpacedLang.respell).

/**
 * Particles that come off a German verb and close its clause (fängt … an is anfangen), and that stand in front of it written as
 * one word (anzufangen, angefangen). de.ts joins the separated pieces with them.
 */
export const SEPARABLE_PARTICLES = ['ab', 'an', 'auf', 'aus', 'bei', 'beiseite', 'bereit', 'dabei', 'dahin', 'dar', 'davon',
  'dazu', 'durch', 'ein', 'empor', 'entgegen', 'entlang', 'fest', 'fort', 'frei', 'heim', 'her', 'herab', 'heran', 'herauf',
  'heraus', 'herbei', 'herein', 'herüber', 'herum', 'herunter', 'hervor', 'hin', 'hinab', 'hinauf', 'hinaus', 'hindurch',
  'hinein', 'hinterher', 'hinüber', 'hinunter', 'hinweg', 'hinzu', 'hoch', 'kennen', 'los', 'mit', 'nach', 'nieder', 'preis',
  'statt', 'teil', 'über', 'um', 'umher', 'unter', 'vor', 'voran', 'voraus', 'vorbei', 'vorüber', 'wahr', 'weg', 'weiter',
  'wieder', 'zu', 'zurecht', 'zurück', 'zusammen'];

/** The particles longest first, so hinaus is tried before hin. */
const PARTICLES = [...SEPARABLE_PARTICLES].sort((a, b) => b.length - a.length);

/**
 * Spellings to try, in order, for a German word nothing else reads:
 *
 * - lower case, for a capital that only starts the sentence or a line of verse: "Angewurzelt stand sie da" (Immensee) is
 *   anwurzeln's participle;
 * - ss for ß, the spelling before 1996 after a short vowel: "»Laßt mich doch zu Gregor" (Die Verwandlung), "Wußte Schneider
 *   Böck zu machen" (Max und Moritz), "Vergiß es nicht!" (Immensee);
 * - without the ending of an adjective or participle in front of its noun, which the dictionary lists bare: "um die
 *   zappelnden Beine nicht sehen zu müssen" is zappelnd, zappeln's present participle; "einem ungeheueren Ungeziefer"
 *   ungeheuer; "mit ausgebreiteten Armen" ausgebreitet;
 * - a separable verb's zu-infinitive without its zu: "um in sein Zimmer zurückzuwandern" (Die Verwandlung) is zurückwandern.
 */
export function germanRespell(f: string): string[] {
  const out: string[] = [];
  const add = (s: string): void => { if (s && s !== f && !out.includes(s)) out.push(s); };
  const lower = f[0].toLowerCase() + f.slice(1);
  const bases = [...new Set([f, lower, f.replace(/ß/g, 'ss'), lower.replace(/ß/g, 'ss')])];
  for (const b of bases) add(b);
  for (const b of bases) {
    const bare = /^(.{4,}?)(?:e|en|er|es|em)$/.exec(b)?.[1];
    for (const s of bare ? [b, bare] : [b]) {
      const p = PARTICLES.find((x) => s.startsWith(x + 'zu') && s.length > x.length + 4);
      if (p) add(p + s.slice(p.length + 2));
      if (s !== b) add(s);
    }
  }
  return out;
}
