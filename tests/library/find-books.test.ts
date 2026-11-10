// @vitest-environment jsdom
// Find a book (ui/library/findBooks.ts) as a reader meets it: Gutenberg's titles with their languages and subtitles, its
// recordings, a Chinese search typed in simplified, a page that does not come, and a book being added when the dialog closes.
// Gutenberg and the sync server are played by a stub; nothing goes over the network.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findBooksDialog, parseOpds } from '../../src/ui/library/findBooks';
import { createImporter } from '../../src/ui/library/importer';
import { createSettingsStore } from '../../src/store/settings';
import { setLangForTests } from '../../src/lang/active';
import type { AppContext, BookMeta, Dictionary } from '../../src/types';
import type { LangId } from '../../src/lang/types';

/** Gutenberg's thumbnails in a search page, as it sends them: a recording's speaker and a book. */
const SOUND = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAABGdBTUEAAK/INwWK6QAAAAZiS0dEAP8A/wD/oL2nkwAAAAlwSFlzAAAASAAAAEgARslrPgAABNtJREFUeNq1lUtsXFcZx3/n3HMfc+dhz9gZ221tx00ndjMpad00pkJASUBJhITaRm0WrYooRQJVapUNRSKqWFRiw2vRIIEEEhISDwkFdQGqgkhoQlqJGpOkSWgaT1rnMZ5x/Zj33Ln3nsPCuCBV1Gz6rc7R9z+/xf97HGGM4eMIValUmJub21xpJcAfB+QkuhvSuVHCRGD0h6TDw8Nw/PjxzaHShYmvYk9/7+kDX365sW3/yyuk7/4syPW8bWNNFbESaQAOHz68kflIKgwfRPrje780bR3bWyR15NBwNjn6hZfwPEcVdqDG7hR23+DUyPQXpe1lNl5tErk9kCpMfv3w7l9u7W94tq0YzjnMTO94ADdXcAZGxkbGHzSelfQ8P/f85CefQrn+JuDkNui/d3BssvirR/aOjSTciLGxPFJKPrVryMUbud9Vya0pO3doKLXtnJLOeC63/aGtUwc/AuwMQu6BRDI//pNvvfD4feWFKyhbopRFJpOkMJ5G4e9ibfWvtuUevC09NWpL5xdKqKP96dH/AbZ8yO2WKj30nQPPPPPIyIDHe+9eQwgBgO8nGMr5+InMaLh4I1bSftW3M0/nErdfEkLmbelu/y+wXAe6Q9C/C+nlvrLnyWePNNWgWFszlG/d/EBp24qU75BI+gNhuyYd4Z2VQn0+4+ZDIcQ5KeTnJJa34SVkpyWZuzPYfY/tePQbP+y7o2CfvgD9Cc3qSpPLl+fRWmNZFo6j8D07HYddyzJiRQhpp5zcsEBeAVlUSNfCHXjY3bLt06nxXTMDEzt3Tt6zM5UfHeO1y5DPQdqDQmEH0/dNMTt7lomJCUDgKhxjtFCoQCAajvIHLWEvAZMKHT/4mW//+rdbRiekBWgNrgVvlyHfD5YEAfR6MdlsnkqlCrDutw43xk4DoUDYCLqApUA79477XI+gp0EIMAay6fWzEBAZaDRbzM//x2etNUHQ7AohNEJYgK9N3DbGpIGeIu7dLCarcSscko3e+kLSsSbhWsD6vRWCNoarV0uk0ymMgTCMaTfXVqW041jolDHG70aNsjbhbcAtCZSunDu31Cd79JpdgnqHVrVO1AkI2wG9ZpflhqbRanL+/GlmZmbQWtNstenWl8u2lzIh4e2GeKkevF8zxhQN+k2FIPzj73938qnC/ifeuFhDhzFBq0vmjgEkhjjSvOelcdM+948VcV2HKIqpLq3Sbi6/428Zohd39ke695tadzHt231TWsenFCbm0t9e/f6Pvvlofq0Rx1pHba2jtpW9666BwhN7PJ2Uf1/OUhy9E9m7BkAQBMyX3tWh7vzDGhlNRTos1oOlI7Wgus9T6ZO9uL2swEDcnVucP3Pg33UxgIlW5vxbN08/b2UffuH9C/f0feLobky1tO55s8Obs7PLOPKt2JYP9eLODxZq53u+nT0UxsHR8uLcxkibjZbRH1QM2nQXvxuXf7qvXjv2+uVrq6YbOdTrLZZXa7xx9i9nMLoSRK0TK91b/1zrVvaFuvezhdKfry9ee/3/2cd6lvalfX/6+ddefKu01i6XVzlx4kS7urhwjKAbBfOXgqWLpwjizul65Z3Xrl/4A8ZolJQS13U3o3eiVvWlk6/8+MzCxe3PlUpXX3Ec+xQAjRoohazcaDWrFRzHxrZtxMf1mf4LoBYNvnh+5S0AAAAZdEVYdFNvZnR3YXJlAEFkb2JlIEltYWdlUmVhZHlxyWU8AAAAAElFTkSuQmCC';
const BOOK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABYAAAAWCAYAAADEtGw7AAAABGdBTUEAAK/INwWK6QAAABl0RVh0U29mdHdhcmUAQWRvYmUgSW1hZ2VSZWFkeXHJZTwAAATbSURBVHjaYvz//z8DDDBZzGVg/POP4R8LKwMrEyMDI8M/BmZODgZGRkaG/x+/Mvzj4tBW15YvenNz14dn+5rrGVi4v4A1/vkKNwNmHkAAMTHgAoxA/Pcfw+9ffxl+ffttpGmpPLe8zPHQ3Ik2SY6WCsEMTOLKDGrxDAwcIli1AwQQC3Yz/zP8/vqLhZmH01xLTzol0E871NZIjJuFGeii3wwM8kpqogyKPhEMUuZGDPfXbgZqeYNuBkAAMSIHBaPZHAaG70CdnBy2+paq+YF+mp7W+sJcbEDXf/7OwPDzDwMDOxsDw8N77/5ffv6LcduND38edQfmMny+MQM9KAACCMXFTGysLpqWmgWhflouFvqC7BxAAz8Bg+/DXwaGf0D1QIrh2w+g73l5GD2YnjN8/cHBsphHwRRo8BxQSCObBRBAKAbrOBv0VqTq60mwAw0DGvgRaNLf/xAMjFMIDVT3j4mZ4eXn/wyKYkCF4hpKDM93CAGFXyGbBRBAKJH38/Wrqx8+MzC8/vKf4RswRL4DTfkGxF+B+PtfCAaJf2NgZvjLysmgIsDAwCOvq8bAwCKHHsYAAYRi8OtLBy4+evsPaAAjxBCoYT+gFoANBVkCdP2Xf8wMwix/GGQUZEQZGLgU0Q0GCCAUgz8/u3X59bufv3/8gxgCMhAUl9+ghoMs+Qk1+PlvVmDK+cmgqirFysApr4puMEAAoRj8+6/CvWf37zz79h9i2DeoS78j0yDxX8DgYWYHWsTMoCnFw8AgpKQO1M6JbBZAAKFmkK8Pnz+5fffWB1DS+gc17C/EwO9/US35CYzAp58ZGVRFmBlYpTU0gbpFkY0CCCBUg/8xfXz/9M3NL5//gb0LC+dvSIbCMQMrw6NvbAzSPCwMfHLK0gwMzDLIRgEEEKrBvx8zfHp2+8LPr98YfvxFM+gPwiJQuP8EpvEXwHBmATpAWkFJCORsZKMAAgjFYHbdUIav/8Wvv37x9s2Pv0jB8AfhcpgFP4Hx8PIPC8O7zz8ZdOUEOBi4ZbWRzQMIINR0/Og8w9/7px5+fP7yHYj/Bcm1P35DXApm/4GmDk4uhpdfGRl05YEJWlARFIECMLMAAgg1KF6dAhYnJ149v//w4T+gq76AkhxS6gCxf4KSJdC1z7/+Z3jy6S/DpYc/GLSkuRlYJZWVkMMZIIBQSzcJO2A4//795N6T8+Y//rj+Anr1HyMoToFZmRWYaICp5dPbrwys798xaLB8ZLAS+cpgpczB8PQXKwOXtLL4RyY+UA68BDIKIIBYMFI1MxPD92cPr/76AiwsePkZ3nwClhkffzD8e3CPQZflHYOr0B8GIWFgscrCxXDlIyvDqk0fGW7dvc3w9fa5TwyMP+HmAQQQC0bxDKw5fvxkvHjp0pPf//nfsTI8ecQQf3gag+KzEwybg5sYdn2Q+n/3/osv3x7ffM3w8todhne3bjF8fXCJ4f/XG0ADrsJMAggg1PJY1BlUoAIZjCyMMvozedUM4gRZmBmXXahjkPhwj9nhq/aRxz+/bmD49foBw7+v94BaHgPxB+QiE2YeQACBGTCM6ngObgY+BXc+NuHUM+JMVx/LMvy3ZWCYC0qVDHgAzCyAAGLBXecxf2X48W7nn1+fmCa9Y/j3nJHB4QIDwyFobUgQAAQYACmANJDUx0lSAAAAAElFTkSuQmCC';

type Entry = { id: number; title: string; author?: string; sound?: boolean };
const feed = (entries: Entry[], next?: number) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
${next ? `<link rel="next" href="/ebooks/search.opds/?query=x&amp;start_index=${next}"/>` : ''}
${entries.map((e) => `<entry><id>https://www.gutenberg.org/ebooks/${e.id}.opds</id><title>${e.title}</title><content type="text">${e.author ?? '100 downloads'}</content>
<link type="application/atom+xml;profile=opds-catalog" rel="subsection" href="/ebooks/${e.id}.opds"/>
<link type="image/png" rel="http://opds-spec.org/image/thumbnail" href="${e.sound ? SOUND : BOOK}"/></entry>`).join('\n')}
</feed>`;

const titlesOf = (xml: string, language: string) => parseOpds(xml, language).books.map((b) => [b.title, b.also]);

describe('Gutenberg titles', () => {
  it('take off the languages a title ends with, and nothing else in parentheses', () => {
    const xml = feed([
      { id: 49836, title: 'Niebla (Nivola) (Spanish)' },
      { id: 44358, title: 'La Tía Tula (Novela) (Spanish)' },
      { id: 47584, title: 'Fiebre de amor (Dominique) (Spanish)' },
      { id: 20738, title: 'Diccionario Ingles-Español-Tagalog (Spanish) (Tagalog)' },
      { id: 2000, title: 'Don Quijote (Spanish)' },
      { id: 1, title: 'Gramática (Latin) (Spanish)' },
      // A run of languages without the one being read is not this book's languages: the title stays whole.
      { id: 2, title: 'Odas (Latin)' },
    ]);
    expect(titlesOf(xml, 'Spanish')).toEqual([
      ['Niebla (Nivola)', []],
      ['La Tía Tula (Novela)', []],
      ['Fiebre de amor (Dominique)', []],
      ['Diccionario Ingles-Español-Tagalog', ['Tagalog']],
      ['Don Quijote', []],
      ['Gramática', ['Latin']],
      ['Odas (Latin)', []],
    ]);
  });

  it('mark the books Gutenberg lists as recordings, by its sound icon', () => {
    const { books } = parseOpds(feed([{ id: 19681, title: 'Детство (Russian)', sound: true }, { id: 16527, title: '1001 задача (Russian)' }]), 'Russian');
    expect(books.map((b) => [b.key, !!b.audio])).toEqual([['19681', true], ['16527', false]]);
  });
});

// ---- the dialog

interface Stub { gutenberg: (url: URL) => Response | Promise<Response>; worker: (path: string) => Response | Promise<Response> }
let asked: string[] = [];
function stub(s: Partial<Stub>) {
  asked = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    asked.push(url.host === 'www.gutenberg.org' ? `gutenberg ${url.searchParams.get('query')}${url.searchParams.get('start_index') ? ` @${url.searchParams.get('start_index')}` : ''}` : `worker ${url.pathname}${url.search}`);
    if (url.host === 'www.gutenberg.org') return s.gutenberg ? s.gutenberg(url) : new Response(feed([]));
    return s.worker ? s.worker(url.pathname + url.search) : new Response('{"error":"Not found."}', { status: 404 });
  }));
}

let toasts: string[] = [];
function open(id: LangId, opts: { dict?: Partial<Dictionary>; books?: BookMeta[] } = {}) {
  setLangForTests(id);
  toasts = [];
  let dict: Dictionary | null = null;
  const ctx = {
    dict: async () => { dict = (opts.dict ?? {}) as Dictionary; return dict; },
    dictSync: () => dict,
    settings: createSettingsStore(undefined, id),
    store: { books: { list: async () => opts.books ?? [], add: async () => { throw new Error('not here'); } } },
    navigate: () => {},
    toast: (m: string) => { toasts.push(m); },
  } as unknown as AppContext;
  const done = findBooksDialog(ctx, createImporter(ctx, () => {}));
  const q = <T extends Element = HTMLElement>(sel: string) => document.querySelector(sel) as T | null;
  const rows = () => [...document.querySelectorAll('.lib-find-row')].map((r) => r.querySelector('.lib-find-title')?.textContent);
  const heading = () => q('.lib-find-heading')?.textContent;
  const more = () => q<HTMLButtonElement>('.lib-find-more')!;
  const search = (text: string) => {
    const input = q<HTMLInputElement>('.lib-find-input')!;
    input.value = text;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  };
  const tab = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('.lib-find-tab')].find((b) => b.textContent === name)!.click();
  const close = () => [...document.querySelectorAll<HTMLButtonElement>('dialog button')].find((b) => b.textContent === 'Done')!.click();
  return { done, rows, heading, more, search, tab, close, q };
}
const settle = async (ms = 30) => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, ms / 6)); };
const until = async (ok: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error('timed out'); await new Promise((r) => setTimeout(r, 10)); }
};

afterEach(() => { vi.unstubAllGlobals(); setLangForTests('zh'); document.body.replaceChildren(); });

describe('a Chinese search typed in simplified characters', () => {
  const toTraditional = (t: string) => t.replace(/鲁/g, '魯').replace(/红/g, '紅').replace(/楼/g, '樓').replace(/梦/g, '夢');
  const toSimplified = (t: string) => t.replace(/吶/g, '呐').replace(/魯/g, '鲁').replace(/紅/g, '红').replace(/樓/g, '楼').replace(/夢/g, '梦');

  it('looks for the traditional form Gutenberg has, and shows the books and the query as the reader writes them', async () => {
    stub({ gutenberg: (url) => new Response(url.searchParams.get('query') === '魯迅 l.zh'
      ? feed([{ id: 27166, title: '吶喊 (Chinese)', author: 'Lu, Xun' }, { id: 25142, title: '朝花夕拾 (Chinese)', author: 'Lu, Xun' }], 26)
      : feed([])) });
    const d = open('zh', { dict: { toTraditional, toSimplified } });
    d.tab('Project Gutenberg');
    await settle();
    d.search('鲁迅');
    await until(() => d.rows().length === 2);
    expect(asked.filter((a) => a.startsWith('gutenberg'))).toEqual(['gutenberg l.zh', 'gutenberg 魯迅 l.zh']);
    expect(d.heading()).toBe('Books in Chinese matching “鲁迅”');
    expect(d.rows()).toEqual(['呐喊', '朝花夕拾']);
    // The next page is asked in the form that found books.
    d.more().click();
    await settle();
    expect(asked.at(-1)).toBe('gutenberg 魯迅 l.zh @26');
  });

  it('tries the typed form when the traditional one finds nothing, and says what helps when neither does', async () => {
    stub({ gutenberg: (url) => new Response(url.searchParams.get('query') === '红楼梦 l.zh' ? feed([{ id: 1, title: '红楼梦 (Chinese)' }]) : feed([])) });
    const d = open('zh', { dict: { toTraditional, toSimplified } });
    d.tab('Project Gutenberg');
    await settle();
    d.search('红楼梦');
    await until(() => d.rows().length === 1);
    expect(asked.filter((a) => a.startsWith('gutenberg')).slice(1)).toEqual(['gutenberg 紅樓夢 l.zh', 'gutenberg 红楼梦 l.zh']);
    d.search('鲁');
    await until(() => (d.heading() ?? '').startsWith('No books'));
    expect(d.heading()).toBe('No books in Chinese match “鲁”. Try fewer characters, or the author’s name in pinyin.');
  });
});

describe('a page that does not come', () => {
  const first = feed(Array.from({ length: 3 }, (_, i) => ({ id: 100 + i, title: `Libro ${i} (Spanish)` })), 26);
  const second = feed([{ id: 200, title: 'Otro libro (Spanish)' }]);

  it('keeps the books listed and the line over them, says so beside More, and More tries again', async () => {
    let down = true;
    stub({ gutenberg: (url) => {
      if (!url.searchParams.get('start_index')) return new Response(first);
      if (down) throw new TypeError('Failed to fetch');
      return new Response(second);
    } });
    const d = open('es');
    await until(() => d.rows().length === 3);
    expect(d.heading()).toBe('The most read books in Spanish');
    d.more().click();
    expect(d.more().textContent).toBe('Loading…');
    await settle();
    expect(d.rows()).toHaveLength(3);
    expect(d.heading()).toBe('The most read books in Spanish');
    const error = d.q('.lib-find-more + .lib-find-error')!;
    expect([error.hidden, error.getAttribute('role'), error.textContent]).toEqual([false, 'alert', 'Could not load more books. Try again.']);
    expect([d.more().hidden, d.more().textContent]).toEqual([false, 'More books']);
    down = false;
    d.more().click();
    await until(() => d.rows().length === 4);
    expect(error.hidden).toBe(true);
    expect(d.more().hidden).toBe(true);
  });

  it('a first page that does not come can be asked for again', async () => {
    let down = true;
    stub({ gutenberg: () => { if (down) throw new TypeError('Failed to fetch'); return new Response(first); } });
    const d = open('es');
    await until(() => (d.heading() ?? '').includes('did not answer'));
    expect(d.heading()).toBe('Project Gutenberg did not answer. Try again in a moment.');
    expect([d.more().hidden, d.more().textContent]).toEqual([false, 'Try again']);
    down = false;
    d.more().click();
    await until(() => d.rows().length === 3);
    expect(d.more().textContent).toBe('More books');
  });
});

describe('Gutenberg’s recordings', () => {
  it('are offered only when the sync server says they have a text (or cannot say)', async () => {
    stub({
      gutenberg: () => new Response(feed([
        { id: 19681, title: 'Детство (Russian)', sound: true },
        { id: 21183, title: 'Белые ночи (Russian)', sound: true },
        { id: 16527, title: '1001 задача (Russian)' },
        { id: 21186, title: 'Записки из подполья (Russian)', sound: true },
      ])),
      worker: (path) => path === '/gutenberg/19681?check' ? Response.json({ epub: true })
        : path === '/gutenberg/21183?check' ? Response.json({ epub: false })
        // A server from before it asked: no answer, so the book stays.
        : new Response('{"error":"Not found."}', { status: 404 }),
    });
    const d = open('ru');
    await until(() => d.rows().length === 3);
    await settle();
    expect(d.rows()).toEqual(['Детство', '1001 задача', 'Записки из подполья']);
    // Only the recordings were asked about.
    expect(asked.filter((a) => a.startsWith('worker')).sort()).toEqual(['worker /gutenberg/19681?check', 'worker /gutenberg/21183?check', 'worker /gutenberg/21186?check']);
  });

  it('one with no text after all says why, and cannot be added again', async () => {
    stub({
      gutenberg: () => new Response(feed([{ id: 21144, title: 'Las Fábulas de Esopo, Vol. 03 (Spanish)', sound: true }])),
      worker: (path) => path.endsWith('?check') ? new Response('{}', { status: 404 })
        : Response.json({ error: 'Project Gutenberg has no text of this book to read. It is probably an audiobook.', code: 'no-epub' }, { status: 404 }),
    });
    const d = open('es');
    await until(() => d.rows().length === 1);
    const add = d.q<HTMLButtonElement>('.lib-find-add')!;
    add.click();
    await until(() => add.disabled);
    expect(d.q('.lib-find-error')?.textContent).toBe('Project Gutenberg has no text of this book to read. It is probably an audiobook.');
    expect(add.textContent).toBe('No text');
  });
});

describe('a book being added when the dialog closes', () => {
  it('says how it went in a toast, never the browser’s own words', async () => {
    let fail!: () => void;
    stub({
      gutenberg: () => new Response(feed([{ id: 2000, title: 'Don Quijote (Spanish)', author: 'Miguel de Cervantes Saavedra' }])),
      worker: () => new Promise<Response>((_, reject) => { fail = () => reject(new TypeError('Failed to fetch')); }),
    });
    const d = open('es');
    await until(() => d.rows().length === 1);
    d.q<HTMLButtonElement>('.lib-find-add')!.click();
    await until(() => !!fail);
    d.close();
    expect(await d.done).toBeUndefined();
    fail();
    await until(() => toasts.length > 0);
    expect(toasts).toEqual(['“Don Quijote” could not be added. Could not download the book. Check your connection and try again.']);
  });

  it('shows as being added in a dialog opened again, and that row says how it ends', async () => {
    let answer!: () => void;
    stub({
      gutenberg: () => new Response(feed([{ id: 21144, title: 'Las Fábulas de Esopo, Vol. 03 (Spanish)' }])),
      worker: () => new Promise<Response>((resolve) => {
        answer = () => resolve(Response.json({ error: 'Project Gutenberg has no text of this book to read. It is probably an audiobook.', code: 'no-epub' }, { status: 404 }));
      }),
    });
    const d = open('es');
    await until(() => d.rows().length === 1);
    d.q<HTMLButtonElement>('.lib-find-add')!.click();
    await until(() => !!answer);
    d.close();
    const again = open('es');
    await until(() => again.rows().length === 1);
    const add = again.q<HTMLButtonElement>('.lib-find-add')!;
    expect(add.textContent).toBe('Adding…');
    add.click();
    // One download, not two.
    expect(asked.filter((a) => a === 'worker /gutenberg/21144')).toHaveLength(1);
    answer();
    await until(() => add.disabled);
    expect(again.q('.lib-find-error')?.textContent).toBe('Project Gutenberg has no text of this book to read. It is probably an audiobook.');
    expect(toasts).toEqual([]);
  });
});
