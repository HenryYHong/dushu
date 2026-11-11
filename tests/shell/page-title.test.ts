// @vitest-environment jsdom
// A screen's title leads with its name in the library's language. The English library's readers were Chinese speakers: its
// screens keep their Chinese names (书架) for a reader whose translations go into Chinese, and say the English once otherwise.
import { afterEach, describe, expect, it } from 'vitest';
import { pageTitle } from '../../src/ui/pageHead';
import { setLangForTests } from '../../src/lang/active';
import { TARGET_KEY } from '../../src/store/settings';

const kicker = (el: HTMLElement) => el.querySelector<HTMLElement>('.page-title-zh')?.textContent ?? null;

afterEach(() => { setLangForTests(null); localStorage.clear(); });

describe('pageTitle', () => {
  it('the English library: 书架 for a reader who translates into Chinese, nothing else above Library otherwise', () => {
    setLangForTests('en');
    expect(kicker(pageTitle('library', 'Library'))).toBe('书架');
    localStorage.setItem(TARGET_KEY, JSON.stringify({ to: 'zh-Hant', at: 1 }));
    expect(kicker(pageTitle('library', 'Library'))).toBe('书架');
    localStorage.setItem(TARGET_KEY, JSON.stringify({ to: 'es', at: 1 }));
    expect(kicker(pageTitle('library', 'Library'))).toBeNull();
    expect(kicker(pageTitle('about', 'About LinguPengu'))).toBeNull();
    // The app in Spanish: the library's own word leads, as in every other library.
    expect(kicker(pageTitle('library', 'Biblioteca'))).toBe('Library');
  });
  it('other libraries are unchanged: their own word, said once when the title is the same', () => {
    setLangForTests('es');
    expect(kicker(pageTitle('library', 'Library'))).toBe('Biblioteca');
    expect(kicker(pageTitle('library', 'Biblioteca'))).toBeNull();
    setLangForTests('zh');
    expect(kicker(pageTitle('library', 'Library'))).toBe('书架');
  });
});
