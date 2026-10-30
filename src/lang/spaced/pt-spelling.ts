// Portuguese as spelled before the reforms of 1911 and 1943, the way the 1899 Dom Casmurro has it, turned into the spellings
// the dictionary has. The engine tries these only for a word nothing else reads (SpacedLang.respell), and for the verb of a
// hyphened word (encliticStems): "approximou-se" is aproximou + se.

/**
 * The changes every pre-reform word takes, in order: doubled consonants (cabellos, aggregado, metter), ph th rh y (phrase,
 * theatro, rheumatismo, typo), the silent c (acto, acção, anecdota), m before n, t or f (comnosco, comtudo, prompto,
 * emphatico), idéa and platéa for ideia and plateia, veiu for veio, and the endings -aes,
 * -óes, -ue, -oz, -uz, -iz of plurals and verbs (signaes, lençóes, possue, poz, puz, quiz are sinais, lençóis, possui, pôs,
 * pus, quis).
 */
export function oldSpelling(f: string): string {
  return f.replace(/mn/g, 'n').replace(/m(?=pt)/g, 'n').replace(/mt/g, 'nt')
    .replace(/([bcdfglmnptv])\1/g, '$1').replace(/ph/g, 'f').replace(/th/g, 't').replace(/rh/g, 'r').replace(/y/g, 'i')
    .replace(/mf/g, 'nf').replace(/c(?=[tç])/g, '').replace(/cd/g, 'd')
    .replace(/éa/g, 'eia').replace(/eiu$/, 'eio').replace(/ae(s?)$/, 'ai$1').replace(/[óo]es$/, 'óis').replace(/(?<=[^qg])ue$/, 'ui')
    .replace(/[oôò]z$/, 'ôs').replace(/uz$/, 'us').replace(/iz$/, 'is').replace(/'/g, '');
}

const VOWEL = /[aeiouáéíóúâêôãõà]/;
const ACCENT_OFF: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', à: 'a', è: 'e', ì: 'i', ò: 'o', ù: 'u', â: 'a', ê: 'e', ô: 'o' };

/** Each spelling one change of the book's may stand for, at one place: the changes no rule makes everywhere. */
function variants(w: string): string[] {
  const out: string[] = [];
  const at = (i: number, len: number, by: string): void => { out.push(w.slice(0, i) + by + w.slice(i + len)); };
  for (let i = 0; i < w.length; i++) {
    const c = w[i];
    const before = i > 0 && VOWEL.test(w[i - 1]);
    const after = i + 1 < w.length && VOWEL.test(w[i + 1]);
    // visinho is vizinho, quizesse quisesse; outrosim outrossim, resurreição ressurreição: s and z between vowels.
    if ((c === 's' || c === 'z') && before && after) {
      at(i, 1, c === 's' ? 'z' : 's');
      if (c === 's') at(i, 1, 'ss');
    }
    // cançado is cansado, descanço descanso; dansar dançar; ancioso ansioso, socegado sossegado; creancas crianças,
    // funccões funções.
    if (c === 'ç') at(i, 1, 's');
    if (c === 's' && (before || w[i - 1] === 'n') && i + 1 < w.length && /[aou]/.test(w[i + 1])) at(i, 1, 'ç');
    if (c === 'c' && i + 1 < w.length && /[ei]/.test(w[i + 1])) { at(i, 1, 's'); if (before) at(i, 1, 'ss'); }
    if (c === 'c' && i + 1 < w.length && /[aouãõ]/.test(w[i + 1]) && w[i - 1] === 'n') at(i, 1, 'ç');
    // escripto is escrito, inscripção inscrição, esculptor escultor; but acepção keeps its p.
    if (c === 'p' && i > 0 && /[aeiouáéíóúâêôl]/.test(w[i - 1]) && /[tç]/.test(w[i + 1] ?? '')) at(i, 1, '');
    // geito is jeito, lisongeada lisonjeada.
    if (c === 'g' && i + 1 < w.length && /[ei]/.test(w[i + 1])) at(i, 1, 'j');
    // distrahido is distraído, comprehensão compreensão: an h between vowels.
    if (c === 'h' && before && after) at(i, 1, '');
    // poude is pôde.
    if (c === 'o' && w[i + 1] === 'u' && i > 0) at(i, 2, 'o');
    // deante is diante, creança criança, creou criou.
    if (c === 'e' && i > 0 && !before && i + 1 < w.length && /[aoõ]/.test(w[i + 1])) at(i, 1, 'i');
    // receiava is receava, receiei receei.
    if (c === 'e' && w[i + 1] === 'i' && i + 2 < w.length && /[aeo]/.test(w[i + 2])) at(i, 2, 'e');
    // signal is sinal, assignar assinar.
    if (c === 'g' && w[i + 1] === 'n' && before) at(i, 2, 'n');
    // archanjo is arcanjo, chronologia cronologia, parochial paroquial, orchestra orquestra, paschoa páscoa, psychologo
    // psicólogo; but chave, escanchar keep their ch.
    if (c === 'c' && w[i + 1] === 'h' && i + 2 < w.length) {
      if (/[ei]/.test(w[i + 2]) && i > 0) at(i, 2, 'qu');
      else if (!VOWEL.test(w[i + 2]) || (i > 0 && /[rs]/.test(w[i - 1])) || w.startsWith('psi')) at(i, 2, 'c');
    }
    // prégão is pregão, pódem podem, fòra fora: an accent the dictionary does not write.
    if (ACCENT_OFF[c]) at(i, 1, ACCENT_OFF[c]);
  }
  // hia is ia, hontem ontem; egreja igreja, egual igual; scismar cismar, scena cena.
  if (w.startsWith('h') && VOWEL.test(w[1] ?? '')) out.push(w.slice(1));
  if (w.startsWith('eg')) out.push('i' + w.slice(1));
  if (w.startsWith('sc') && /[ei]/.test(w[2] ?? '')) out.push(w.slice(1));
  // excusar is escusar; museo museu.
  if (w.startsWith('exc')) out.push('es' + w.slice(2));
  if (/eo$/.test(w)) out.push(w.slice(0, -1) + 'u');
  // The word a diminutive or a superlative is made of: segredinhos segredos, cunhadinha cunhada, tossesinha tosse,
  // devagarzinho devagar; perfeitissimo perfeito, brevissimas breves.
  // iguaizinhos is iguais + zinhos: a plural diminutive in -zinhos is made on the plural (pãezinhos, florezinhas).
  let m = /^(.{3,}?)(?:[sz]inh|zit)([oa])(s?)$/.exec(w);
  if (m) out.push(m[1], ...(m[3] ? [m[1] + 's'] : []));
  m = /^(.{3,}?)inh([oa])(s?)$/.exec(w);
  if (m) out.push(m[1].replace(/qu$/, 'c').replace(/gu$/, 'g') + m[2] + m[3], m[1] + 'e' + m[3]);
  m = /^(.{3,}?)[ií]ssim([oa])(s?)$/.exec(w);
  if (m) out.push(m[1] + m[2] + m[3], m[1] + 'e' + m[3]);
  return out;
}

/**
 * The word with the accent of a word stressed on its antepenultimate syllable, on that syllable's vowel: palio pálio, vitima
 * vítima, incomodo incómodo. ai, ei, oi, ui, au, eu, ou are one syllable (veio is vei-o, and gets none); any other two vowels
 * are two (pa-li-o).
 */
function antepenult(w: string): string[] {
  if (/[áéíóúâêôãõà]/.test(w)) return [];
  const nuclei: number[] = [];
  for (let i = 0; i < w.length; i++) {
    if (!/[aeiou]/.test(w[i]) || (w[i] === 'u' && /[qg]/.test(w[i - 1] ?? '') && /[ei]/.test(w[i + 1] ?? ''))) continue;
    if (i > 0 && nuclei.length && nuclei[nuclei.length - 1] === i - 1 && /^(?:[aeou]i|[aeo]u)$/.test(w.slice(i - 1, i + 1))) continue;
    nuclei.push(i);
  }
  if (nuclei.length < 3) return [];
  const i = nuclei[nuclei.length - 3];
  return [...(ACCENT_ON[w[i]] ?? '')].map((a) => w.slice(0, i) + a + w.slice(i + 1));
}
const ACCENT_ON: Record<string, string> = { a: 'áâ', e: 'éê', i: 'í', o: 'óô', u: 'ú' };

/** Every spelling Machado's word may stand for: the old spelling made modern, then one or two changes of those that vary. */
export function respellings(f: string): string[] {
  const base = oldSpelling(f);
  const once = [...new Set([base, f])].flatMap(variants);
  // A word stressed on its third syllable from the end writes the accent today, and Machado did not: pallio is pálio (not
  // paliar's palio "I palliate"), victima vítima (not vitimar's vitima), supplicas súplicas. Every spelling is matched and
  // ranked together, so the noun is there to be chosen.
  const out = new Set<string>([base, ...antepenult(base), ...once, ...once.flatMap(variants)]);
  out.delete(f);
  return [...out].slice(0, 160);
}
