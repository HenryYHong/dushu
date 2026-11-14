import { ttx, uiLang } from '../i18n';

/**
 * A word form's note as Wiktionary words it, in English grammar terms ("first/third-person singular imperfect indicative"), in
 * the interface's language, term by term in the same order ("primera/tercera persona singular imperfecto indicativo"). The
 * catalogs key each term '<term> [grammar]'. A note with a term this list lacks (a place, a topic, Wiktionary's cut-off
 * "spelli") stays in English whole: half a translation reads worse than none.
 */
const TERMS: Record<string, () => string> = {
  'first-person': () => ttx('first-person', 'grammar'),
  'second-person': () => ttx('second-person', 'grammar'),
  'third-person': () => ttx('third-person', 'grammar'),
  'first': () => ttx('first', 'grammar'),
  'second': () => ttx('second', 'grammar'),
  'third': () => ttx('third', 'grammar'),
  'singular': () => ttx('singular', 'grammar'),
  'plural': () => ttx('plural', 'grammar'),
  'masculine': () => ttx('masculine', 'grammar'),
  'feminine': () => ttx('feminine', 'grammar'),
  'neuter': () => ttx('neuter', 'grammar'),
  'gender-neutral': () => ttx('gender-neutral', 'grammar'),
  'nominative': () => ttx('nominative', 'grammar'),
  'genitive': () => ttx('genitive', 'grammar'),
  'dative': () => ttx('dative', 'grammar'),
  'accusative': () => ttx('accusative', 'grammar'),
  'instrumental': () => ttx('instrumental', 'grammar'),
  'prepositional': () => ttx('prepositional', 'grammar'),
  'locative': () => ttx('locative', 'grammar'),
  'vocative': () => ttx('vocative', 'grammar'),
  'partitive': () => ttx('partitive', 'grammar'),
  'present': () => ttx('present', 'grammar'),
  'past': () => ttx('past', 'grammar'),
  'imperfect': () => ttx('imperfect', 'grammar'),
  'preterite': () => ttx('preterite', 'grammar'),
  'future': () => ttx('future', 'grammar'),
  'conditional': () => ttx('conditional', 'grammar'),
  'pluperfect': () => ttx('pluperfect', 'grammar'),
  'perfect': () => ttx('perfect', 'grammar'),
  'indicative': () => ttx('indicative', 'grammar'),
  'subjunctive': () => ttx('subjunctive', 'grammar'),
  'imperative': () => ttx('imperative', 'grammar'),
  'infinitive': () => ttx('infinitive', 'grammar'),
  'participle': () => ttx('participle', 'grammar'),
  'gerund': () => ttx('gerund', 'grammar'),
  'past participle': () => ttx('past participle', 'grammar'),
  'present participle': () => ttx('present participle', 'grammar'),
  'adverbial participle': () => ttx('adverbial participle', 'grammar'),
  'verbal noun': () => ttx('verbal noun', 'grammar'),
  'zu-infinitive': () => ttx('zu-infinitive', 'grammar'),
  'past tense': () => ttx('past tense', 'grammar'),
  'active': () => ttx('active', 'grammar'),
  'passive': () => ttx('passive', 'grammar'),
  'perfective': () => ttx('perfective', 'grammar'),
  'imperfective': () => ttx('imperfective', 'grammar'),
  'comparative': () => ttx('comparative', 'grammar'),
  'superlative': () => ttx('superlative', 'grammar'),
  'short form': () => ttx('short form', 'grammar'),
  'long form': () => ttx('long form', 'grammar'),
  'short': () => ttx('short', 'grammar'),
  'form': () => ttx('form', 'grammar'),
  'inflected form': () => ttx('inflected form', 'grammar'),
  'inflected': () => ttx('inflected', 'grammar'),
  'declined': () => ttx('declined', 'grammar'),
  'strong': () => ttx('strong', 'grammar'),
  'weak': () => ttx('weak', 'grammar'),
  'mixed': () => ttx('mixed', 'grammar'),
  'alternative form': () => ttx('alternative form', 'grammar'),
  'alternative spelling': () => ttx('alternative spelling', 'grammar'),
  'spelling': () => ttx('spelling', 'grammar'),
  'misspelling': () => ttx('misspelling', 'grammar'),
  'alternative': () => ttx('alternative', 'grammar'),
  'obsolete': () => ttx('obsolete', 'grammar'),
  'archaic': () => ttx('archaic', 'grammar'),
  'dated': () => ttx('dated', 'grammar'),
  'rare': () => ttx('rare', 'grammar'),
  'uncommon': () => ttx('uncommon', 'grammar'),
  'old': () => ttx('old', 'grammar'),
  'colloquial': () => ttx('colloquial', 'grammar'),
  'informal': () => ttx('informal', 'grammar'),
  'formal': () => ttx('formal', 'grammar'),
  'nonstandard': () => ttx('nonstandard', 'grammar'),
  'proscribed': () => ttx('proscribed', 'grammar'),
  'slang': () => ttx('slang', 'grammar'),
  'vulgar': () => ttx('vulgar', 'grammar'),
  'literary': () => ttx('literary', 'grammar'),
  'poetic': () => ttx('poetic', 'grammar'),
  'regional': () => ttx('regional', 'grammar'),
  'dialectal': () => ttx('dialectal', 'grammar'),
  'historical': () => ttx('historical', 'grammar'),
  'eye dialect': () => ttx('eye dialect', 'grammar'),
  'synonym': () => ttx('synonym', 'grammar'),
  'diminutive': () => ttx('diminutive', 'grammar'),
  'augmentative': () => ttx('augmentative', 'grammar'),
  'endearing': () => ttx('endearing', 'grammar'),
  'reflexive': () => ttx('reflexive', 'grammar'),
  'pronominal': () => ttx('pronominal', 'grammar'),
  'impersonal': () => ttx('impersonal', 'grammar'),
  'negative': () => ttx('negative', 'grammar'),
  'apocopic': () => ttx('apocopic', 'grammar'),
  'contraction': () => ttx('contraction', 'grammar'),
  'abbreviation': () => ttx('abbreviation', 'grammar'),
  'clipping': () => ttx('clipping', 'grammar'),
  'initialism': () => ttx('initialism', 'grammar'),
  'possessive': () => ttx('possessive', 'grammar'),
  'and': () => ttx('and', 'grammar'),
  'or': () => ttx('or', 'grammar'),
  // Phrases whose words go in another order or agree in other languages (Spanish "grafía obsoleta", "participio pasado pasivo").
  'obsolete spelling': () => ttx('obsolete spelling', 'grammar'),
  'old spelling': () => ttx('old spelling', 'grammar'),
  'archaic spelling': () => ttx('archaic spelling', 'grammar'),
  'nonstandard spelling': () => ttx('nonstandard spelling', 'grammar'),
  'rare spelling': () => ttx('rare spelling', 'grammar'),
  'dated spelling': () => ttx('dated spelling', 'grammar'),
  'informal spelling': () => ttx('informal spelling', 'grammar'),
  'obsolete form': () => ttx('obsolete form', 'grammar'),
  'archaic form': () => ttx('archaic form', 'grammar'),
  'nonstandard form': () => ttx('nonstandard form', 'grammar'),
  'dated form': () => ttx('dated form', 'grammar'),
  'rare form': () => ttx('rare form', 'grammar'),
  'informal form': () => ttx('informal form', 'grammar'),
  'apocopic form': () => ttx('apocopic form', 'grammar'),
  'poetic form': () => ttx('poetic form', 'grammar'),
  'colloquial form': () => ttx('colloquial form', 'grammar'),
  'uncommon form': () => ttx('uncommon form', 'grammar'),
  'endearing form': () => ttx('endearing form', 'grammar'),
  'passive participle': () => ttx('passive participle', 'grammar'),
  'active participle': () => ttx('active participle', 'grammar'),
  'past passive participle': () => ttx('past passive participle', 'grammar'),
  'past active participle': () => ttx('past active participle', 'grammar'),
  'present passive participle': () => ttx('present passive participle', 'grammar'),
  'present active participle': () => ttx('present active participle', 'grammar'),
  'past adverbial participle': () => ttx('past adverbial participle', 'grammar'),
  'present adverbial participle': () => ttx('present adverbial participle', 'grammar'),
};
/** Kept as they are: German "subjunctive II", Spanish "vos" and the "-se" imperfect subjunctive. */
const AS_IS = new Set(['I', 'II', 'vos', '-se']);
const SEPARATOR = /^(?:\s+|\/|,\s*|;\s*|\(|\))$/;

export function formLabel(note: string): string {
  if (uiLang() === 'en') return note;
  const parts = note.split(/(\s+|\/|,\s*|;\s*|\(|\))/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < parts.length;) {
    // The longest term first: "past participle" is one term ("participio pasado"), not "past" then "participle".
    let span = 5;
    for (; span >= 1; span -= 2) {
      const run = parts.slice(i, i + span);
      if (run.length < span || run.some((p, k) => k % 2 === 1 && !/^\s+$/.test(p))) continue;
      const term = TERMS[run.join('')];
      if (Object.hasOwn(TERMS, run.join('')) && term) { out.push(term()); break; }
    }
    if (span >= 1) { i += span; continue; }
    if (SEPARATOR.test(parts[i]) || AS_IS.has(parts[i])) { out.push(parts[i]); i++; continue; }
    return note;
  }
  return out.join('');
}
