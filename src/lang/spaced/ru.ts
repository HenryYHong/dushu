// Russian. Every word gets its stressed vowel where the dictionary knows it (сказа́ла); ё and е are one letter for
// matching; particles hyphened to a word stay with it (скажи-ка, кто-то). The words whose reading depends on their
// neighbors (его "him" or "his", все, да, что, как …) are read by the rules in ru-context.ts.
import type { LangEngine } from '../types';
import { loadSpacedEngine, type LoadOpts, type SpacedLang } from './core';
import { russianContext } from './ru-context';

export const RUSSIAN: SpacedLang = {
  id: 'ru',
  script: 'cyrillic',
  stress: true,
  hyphenClitics: ['то', 'ка', 'нибудь', 'либо', 'таки', 'де', 'с'],
  // «Кто хлебал в моей чашке!» (Tolstoy) starts a sentence; „ opens inner quotes, and — stands between subject and
  // predicate (Москва — столица), so it starts nothing.
  sentenceOpeners: '«„',
  // A capital letter and its period after one is an initial: "князя Б."; a capitalized word after г. (господин) a name: "по
  // приказанию г. Ермолова" (Герой нашего времени).
  titles: ['князь', 'княгиня', 'княжна', 'граф', 'графиня', 'барон', 'баронесса', 'господин', 'госпожа', 'генерал', 'полковник',
    'капитан', 'майор', 'поручик', 'доктор', 'г.'],
  context: russianContext,
  respell(f) {
    const out: string[] = [];
    // The nineteenth century wrote и where we write ь before the ending, and the other way: White Nights has счастие,
    // счастия, жизнию, покорностию (счастье, счастья, жизнью, покорностью) and воспоминанья, волненье, рыданьями
    // (воспоминания, волнение, рыданиями). Its prepositional "в счастии" is today's "в счастье".
    const m = /^(.*[бвгджзйклмнпрстфхцчшщ])([иь])(е|я|ю|ем|ей|ям|ями|ях|и)$/.exec(f);
    if (m) out.push(...(m[3] === 'и' && m[2] === 'и' ? [m[1] + 'ье', m[1] + 'ьи'] : [m[1] + (m[2] === 'и' ? 'ь' : 'и') + m[3]]));
    return [...out, ...participleOrDiminutive(f)];
  },
};

const ADJ_ENDING = '(?:ый|ий|ой|ая|яя|ое|ее|ые|ие|ого|его|ому|ему|ым|им|ом|ем|ой|ей|ую|юю|ою|ею|ых|их|ыми|ими)';

/**
 * Forms Wiktionary's tables leave out, read as the form it has (its tables give a verb's participles once, in the
 * masculine, and no diminutives): a declined participle as its masculine ("все дарованные ей силы" is дарованный, of
 * даровать; "озябшую" озябший, "завёрнутую" завёрнутый), a short passive participle in -ан, -ян as its long form ("сказано", "записан",
 * "сделано" are сказанный, записанный, сделанный: the stress stays where the long form has it), and a diminutive as its noun
 * or adjective (Kashtanka's матрасик is матрас, Tolstoy's синенькая чашечка синий). Not the short forms in -ена, -ено, -ены
 * (отворена́ has its stress on the ending, отворённый on the ё), nor comparatives (тепле́е, but тёплый).
 */
function participleOrDiminutive(f: string): string[] {
  const out: string[] = [];
  const long = new RegExp(`^(.+(?:нн|ш|щ|ут|ят|ит|ыт))${ADJ_ENDING}(ся|сь)?$`).exec(f);
  if (long) out.push(long[1] + (/[шщ]$/.test(long[1]) ? 'ий' : 'ый') + (long[2] ? 'ся' : ''));
  const short = /^(.+[ая]н)(?:|а|о|ы)$/.exec(f);
  if (short && short[1].length > 3) out.push(short[1] + 'ный');
  if (/^.{3,}ен$/.test(f)) out.push(f + 'ный');
  const nounDim = /^(.{3,})(?:ик|ок|ец)(?:|а|у|ом|е|и|ов|ам|ами|ах)$/.exec(f);
  if (nounDim) out.push(nounDim[1]);
  const neuterDim = /^(.{3,})(?:це|ца|цу|цем)$/.exec(f);
  if (neuterDim) out.push(neuterDim[1] + 'о', neuterDim[1] + 'е');
  const adjDim = new RegExp(`^(.{2,})[ео]ньк${ADJ_ENDING}$`).exec(f);
  if (adjDim) out.push(adjDim[1] + 'ий', adjDim[1] + 'ый', adjDim[1] + 'кий', adjDim[1] + 'ой');
  return out;
}

export function loadEngine(baseUrl: string, opts?: LoadOpts): Promise<LangEngine> {
  return loadSpacedEngine(RUSSIAN, baseUrl, opts);
}
