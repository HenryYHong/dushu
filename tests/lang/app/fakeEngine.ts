// A tiny engine for the app's own tests (the real ones are tested in tests/lang/ja and tests/lang/spaced): words split on
// letters, a dozen Spanish words with their forms, a Japanese word with furigana, a Russian word with its stress.
import type { Token } from '../../../src/types';
import type { LangEngine, LangId, WordEntry, WordLookup } from '../../../src/lang/types';

const LEMMAS: Record<string, { head: string; glosses: string[]; level?: number; form?: string; gender?: string }> = {
  casa: { head: 'casa', glosses: ['house', 'home'], level: 1, gender: 'f' },
  ir: { head: 'ir', glosses: ['to go'], level: 1 },
  fue: { head: 'ir', glosses: ['to go'], level: 1, form: 'third-person singular preterite' },
  fuimos: { head: 'ir', glosses: ['to go'], level: 1, form: 'first-person plural preterite' },
  perro: { head: 'perro', glosses: ['dog'], level: 2, gender: 'm' },
  hidalgo: { head: 'hidalgo', glosses: ['nobleman (of the lower nobility)'], level: 6 },
  el: { head: 'el', glosses: ['the'], level: 1 },
  a: { head: 'a', glosses: ['to', 'at'], level: 1 },
  la: { head: 'la', glosses: ['the'], level: 1 },
};

export function fakeEngine(id: LangId = 'es'): LangEngine {
  const fold = (w: string) => w.toLowerCase();
  const entryOf = (w: string): WordEntry | null => {
    const l = LEMMAS[fold(w)];
    return l ? { head: l.head, senses: [{ pos: 'noun', glosses: l.glosses }], level: l.level, gender: l.gender, source: 'test' } : null;
  };
  return {
    id,
    segment(text) {
      const out: Token[] = [];
      const re = /(\p{L}+)|(\s+)|(\d+)|([^\p{L}\s\d])/gu;
      for (const m of text.matchAll(re)) {
        const start = m.index ?? 0;
        const t = m[0];
        if (m[1]) {
          const l = LEMMAS[fold(t)];
          const tok: Token = { text: t, start, end: start + t.length, kind: 'word', inDict: !!l, key: l ? l.head : fold(t), lemma: l?.head ?? t };
          if (t === '食べた') { tok.ruby = [{ text: '食', rt: 'た' }, { text: 'べた' }]; tok.reading = 'たべた'; tok.lemma = '食べる'; tok.key = '食べる'; }
          if (t === 'дома') tok.stress = 3;
          if (/^\p{Lu}/u.test(t) && start > 0 && !l) tok.name = true;
          out.push(tok);
        } else out.push({ text: t, start, end: start + t.length, kind: m[2] ? 'space' : m[3] ? 'num' : 'punct', inDict: false });
      }
      return out;
    },
    lookup(surface, ctx): WordLookup {
      const l = LEMMAS[fold(surface)];
      const e = entryOf(surface);
      return { surface, key: l ? l.head : fold(surface), entries: e ? [e] : [], form: l?.form, name: ctx?.token?.name };
    },
    normalize: (w) => LEMMAS[fold(w)]?.head ?? fold(w),
    level: (k) => LEMMAS[k]?.level,
    levelWords: (max) => Object.values(LEMMAS).filter((l) => (l.level ?? 9) <= max).map((l) => l.head),
    hint: (t) => LEMMAS[fold(t.text)]?.glosses[0],
    meta: { built: '2026-10-29', counts: { lemmas: 8 }, sources: [{ name: 'Test', license: 'CC0', url: 'https://example.com' }] },
  };
}
