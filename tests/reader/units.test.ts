// @vitest-environment jsdom
// Smaller pieces of the reader that the screen tests do not reach: long blocks, lazy pinyin, the chapter list window,
// the menus, name capitalization and the stylesheet rules that carry the typography.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Chapter, LexiconEntry } from '../../src/types';
import { createChapterView, MAX_BLOCK_CHARS, splitLongText } from '../../src/ui/reader/chapter';
import { buildDisplayMenu, buildPinyinMenu, closePopover, openPopover, slider } from '../../src/ui/reader/menus';
import { renderParagraph } from '../../src/ui/reader/render';
import { capitalizePinyin, createToc } from '../../src/ui/reader/toc';
import { loadTestDictionary } from '../helpers/data';
import { makeCtx, stubBrowser, tick } from './helpers';

beforeAll(() => stubBrowser());
afterEach(() => { closePopover(); document.body.innerHTML = ''; });

const css = (file: string) => readFileSync(resolve(process.cwd(), 'src/styles', file), 'utf8');

describe('very long paragraphs', () => {
  const sentence = '他慢慢地走了过来，对我说了很多话。';
  const giant = sentence.repeat(Math.ceil(7000 / sentence.length));

  it('are cut into pieces of about 3,000 characters, after sentence ends, and join back to the original', () => {
    const parts = splitLongText(giant);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    expect(parts.join('')).toBe(giant);
    for (const p of parts) expect(p.length).toBeLessThanOrEqual(MAX_BLOCK_CHARS + 8);
    for (const p of parts.slice(0, -1)) expect(/[。！？；”」]$/.test(p)).toBe(true);
  });
  it('never split a surrogate pair, and keep short text whole', () => {
    expect(splitLongText('短文。')).toEqual(['短文。']);
    const rare = '𠀀'.repeat(2500);
    const parts = splitLongText(rare);
    expect(parts.join('')).toBe(rare);
    for (const p of parts) expect([...p].join('')).toBe(p);
  });
  it('become several blocks in the view, and a place in them is stored as the stored block and offset', async () => {
    const { ctx } = await makeCtx({ pinyin: 'all' });
    const dict = await loadTestDictionary();
    const chapter: Chapter = { title: '长', blocks: [{ t: 'p', text: '第一段。' }, { t: 'p', text: giant }, { t: 'p', text: '末段。' }] };
    const view = createChapterView({ ctx, dict, bookId: 'b', chapter, chapterIndex: 0 });
    expect(view.synthetic).toBe(1);
    const pieces = view.blocks.filter((b) => b.pieceStart > 0 || b.block.t === 'p');
    expect(view.blocks.length).toBeGreaterThan(5);
    // The pieces after the first start without an indent and the spacing between pieces is closed up.
    const second = view.blocks.find((b) => b.pieceStart > 0)!;
    expect(second.el.classList.contains('rd-noindent')).toBe(true);
    expect(view.blocks[second.index - 1].el.classList.contains('rd-more')).toBe(true);
    // Round trip: every (stored block, offset) maps to a view place and back.
    for (const [stored, offset] of [[0, 0], [1, 0], [1, 100], [1, 3500], [1, 6900], [2, 0]]) {
      const at = view.fromStored(stored, offset);
      expect(view.toStored(at.block, at.offset)).toEqual({ block: stored, offset });
    }
    expect(view.toStored(0, 5)).toEqual({ block: 0, offset: 0 }); // the chapter title is not a stored block
    expect(pieces.length).toBeGreaterThan(3);
  });
});

describe('pinyin drawn only near the eye', () => {
  const chapter: Chapter = { title: '章', blocks: [{ t: 'p', text: '我们在银行门口见面。' }, { t: 'p', text: '他慢慢地走了过来。' }] };

  it('leaves out the rt nodes until ensurePinyin, then draws them with the pinyin of the moment', async () => {
    const { ctx } = await makeCtx({ pinyin: 'all' });
    const dict = await loadTestDictionary();
    const view = createChapterView({ ctx, dict, bookId: 'b', chapter, chapterIndex: 0, lazyPinyin: true });
    document.body.appendChild(view.el);
    view.renderTo(view.blocks.length - 1);
    expect(view.el.querySelectorAll('rt')).toHaveLength(0);
    expect(view.el.querySelectorAll('ruby.rd-c').length).toBeGreaterThan(10);
    ctx.settings.set({ pinyinStyle: 'numbers' });
    view.refreshPinyin(); // blocks that have no rt only learn the new style
    expect(view.el.querySelectorAll('rt')).toHaveLength(0);
    view.ensurePinyin(1);
    const rts = [...view.blocks[1].el.querySelectorAll('rt')];
    expect(rts.length).toBeGreaterThan(5);
    expect(rts.every((r) => /\d$/.test(r.textContent ?? '') && r.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(view.blocks[2].el.querySelectorAll('rt')).toHaveLength(0);
  });
  it('is off by default: the Scroll layout draws everything at once', async () => {
    const { ctx } = await makeCtx({ pinyin: 'all' });
    const dict = await loadTestDictionary();
    const view = createChapterView({ ctx, dict, bookId: 'b', chapter, chapterIndex: 0 });
    view.renderTo(view.blocks.length - 1);
    expect(view.el.querySelectorAll('rt').length).toBeGreaterThan(10);
  });
  it('gives every word a role and a spoken name (the word and its pinyin), and hides the ruby text from screen readers', async () => {
    const { ctx } = await makeCtx({ pinyin: 'all' });
    const dict = await loadTestDictionary();
    const view = createChapterView({ ctx, dict, bookId: 'b', chapter, chapterIndex: 0 });
    view.renderTo(view.blocks.length - 1);
    const word = [...view.el.querySelectorAll('.rd-w')].find((w) => [...w.querySelectorAll('ruby')].map((r) => (r.firstChild as Text).data).join('') === '银行')!;
    expect(word.getAttribute('role')).toBe('button');
    expect(word.getAttribute('aria-label')).toBe('银行, yín háng');
    expect([...view.el.querySelectorAll('rt')].every((r) => r.getAttribute('aria-hidden') === 'true')).toBe(true);
  });
  it('a paragraph that cannot be segmented is shown as plain text instead of taking the chapter down', async () => {
    const { ctx } = await makeCtx({ pinyin: 'all' });
    const dict = await loadTestDictionary();
    const boom = { ...dict, wordsAt: () => { throw new RangeError('Maximum call stack size exceeded'); } } as typeof dict;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = createChapterView({ ctx, dict: boom, bookId: 'b', chapter, chapterIndex: 0 });
    view.renderTo(view.blocks.length - 1);
    expect(view.failedBlocks()).toBeGreaterThan(0);
    expect(view.blocks[1].el.textContent).toBe('我们在银行门口见面。');
    spy.mockRestore();
  });
});

describe('the rendered text', () => {
  it('marks characters from fallback fonts (Ext B and later) so their weight can be evened out', async () => {
    const dict = await loadTestDictionary();
    const p = renderParagraph('你𠀀好', dict, { style: 'marks', toneColors: true, sandhi: false });
    const rubies = [...p.el.querySelectorAll('ruby')];
    expect(rubies.map((r) => r.classList.contains('rd-rare'))).toEqual([false, true, false]);
  });
  it('gives only the long syllables a width, which the stylesheet squeezes to fit the cell', async () => {
    const dict = await loadTestDictionary();
    const p = renderParagraph('庄你', dict, { style: 'marks', toneColors: false, sandhi: false });
    const labels = [...p.el.querySelectorAll<HTMLElement>('.rd-rtx')];
    expect(labels).toHaveLength(2);
    expect(labels[0].style.getPropertyValue('--rd-w')).not.toBe(''); // zhuāng
    expect(labels[1].style.getPropertyValue('--rd-w')).toBe(''); // nǐ
  });
});

const reader = css('reader.css');

describe('the stylesheets', () => {
  const settings = css('settings.css');

  it('colors the pinyin by tone in the reader and in the settings preview, with a selector that beats the grey', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      expect(reader).toMatch(new RegExp(`\\.rd-article rt\\.tone-${n}\\s*\\{[^}]*var\\(--tone-${n}\\)`));
      expect(settings).toMatch(new RegExp(`\\.set-ruby rt\\.tone-${n}\\s*\\{[^}]*var\\(--tone-${n}\\)`));
    }
    // (0,2,1) against the grey rule's (0,1,1): a class on the rt must win.
    expect(reader).toMatch(/\.rd-article rt \{[^}]*color: var\(--text-2\)/);
    expect(reader).not.toMatch(/\.rd-article rt:not\(/);
  });
  it('indents a paragraph by the measured two cells with the grid on, and 2em with it off', () => {
    expect(reader).toMatch(/\.rd-p \{ margin: 0 0 0\.55em; text-indent: 2em; \}/);
    expect(reader).toMatch(/\.rd-grid \.rd-p \{ text-indent: var\(--rd-indent\); \}/);
    expect(reader).toMatch(/--rd-indent: 2\.5em/); // 2 x the 1.25 default cell
  });
  it('halves the full-width marks in the grid and keeps the first line of a chapter level with its facing page', () => {
    expect(reader).toMatch(/\.rd-grid \.rd-article \.rd-pu-c \{ letter-spacing: -0\.5em;/);
    expect(reader).toMatch(/\.rd-grid \.rd-article \.rd-pu-o \{ margin-left: -0\.5em;/);
    expect(reader).toMatch(/> \.rd-b:first-child \{ margin-top: 0; \}/);
  });
  it('sizes a curly quote from its measured advance instead of trimming it like a full-width mark', () => {
    expect(reader).toMatch(/\.rd-pq-ldq \{ --rd-qw: var\(--rd-q-ldq, 1\); \}/);
    expect(reader).toMatch(/\.rd-grid \.rd-article \.rd-pu-qo \{ margin-left: calc\(\(0\.5 - var\(--rd-qw\)\) \* 1em\);/);
    expect(reader).toMatch(/\.rd-grid \.rd-article \.rd-pu-qc \{[^}]*margin-right: calc\(\(0\.5 - var\(--rd-qw\)\) \* 1em\);/);
    expect(settings).toMatch(/\.set-grid \.set-pu-qo \{ margin-left: calc\(\(0\.5 - var\(--set-qw\)\) \* 1em\);/);
  });
  it('does not use pretty wrapping with the grid or in Safari, where it ends every line a cell early', () => {
    expect(reader).toMatch(/\.rd-grid \.rd-p, \.rd-grid \.rd-quote \{ text-wrap: wrap; \}/);
    expect(reader).toMatch(/@supports \(hanging-punctuation: first\) \{ \.rd-p, \.rd-quote \{ text-wrap: wrap; \} \}/);
  });
  it('makes the way on at the end of a chapter 44 px high under a finger, and the page bar in Pages solid', () => {
    expect(reader).toMatch(/@media \(pointer: coarse\) \{ \.rd-endbtn \{ min-height: 44px; border-radius: 22px; \} \}/);
    expect(reader).toMatch(/\.rd-paged \.rd-bar \{ background: var\(--bg\);/);
  });
  it('keeps zhuyin tone marks inside their row and takes the room between squeezed syllables from one variable', () => {
    expect(reader).toMatch(/\.rd-zy \.rd-article \.rd-rtx \{ bottom: calc\(100% - 0\.28em - 0\.13em\); \}/);
    expect(reader).toMatch(/var\(--rd-cell\) - var\(--rd-sq, 0\.12\)/);
    expect(settings).toMatch(/var\(--set-cell\) - var\(--set-sq, 0\.12\)/);
  });
  it('closes the half-cell holes between full-width marks without the grid where the browser does not, and moves ！ over', () => {
    expect(reader).toMatch(/@supports not \(text-spacing-trim: normal\) \{[^}]*\.rd-pu-c:has\(\+ \.rd-pu\) \{ letter-spacing: -0\.5em; \}/);
    expect(reader).toMatch(/\.rd-grid \.rd-article \.rd-pu-b \{ position: relative; left: -0\.3em; \}/);
  });
  it('scrolls a settings section to below the sticky preview, with no focus ring on the heading', () => {
    expect(settings).toMatch(/\.set-group \{ scroll-margin-top: calc\(var\(--nav-h\) \+ 16px \+ var\(--set-stick, 0px\)\); \}/);
    expect(settings).toMatch(/\.set-group-title\[tabindex='-1'\]:focus-visible \{ outline: none; \}/);
  });
  it('defines the fold and the shading per theme inside the reader stylesheet', () => {
    expect(reader).toMatch(/:root\[data-theme='dark'\] \.rd-root \{[^}]*--rd-spine-core: rgba\(0, 0, 0, 0\.62\)/);
    expect(reader).toMatch(/\.rd-spine \{[^}]*var\(--rd-spine-core\)/);
    expect(reader).not.toMatch(/\.rd-spine \{[^}]*color-mix\(in srgb, var\(--text\)/);
  });
  it('keeps the top bar nearly opaque and the pinyin pill one width', () => {
    expect(reader).toMatch(/background: color-mix\(in srgb, var\(--bg\) 9[5-9]%, transparent\)/);
    expect(reader).toMatch(/\.rd-pinyin-btn \{ min-width: 110px;/);
  });
});

describe('names written as names', () => {
  it('capitalizes each syllable of a person, joins a place and sets its kind apart, and leaves a term alone', () => {
    expect(capitalizePinyin('guang1 rui3', 'name')).toBe('Guāng Ruǐ');
    expect(capitalizePinyin('tao2 hua1 dao3', 'place')).toBe('Táohuā Dǎo');
    expect(capitalizePinyin('jia1 xing1', 'place')).toBe('Jiāxīng');
    expect(capitalizePinyin('xiang2 long2 shi2 ba1 zhang3', 'term')).toBe('xiáng lóng shí bā zhǎng');
    expect(capitalizePinyin('guo1 jing4', 'name', 'numbers')).toBe('Guo1 Jing4');
    expect(capitalizePinyin('guo1 jing4', 'name', 'zhuyin')).not.toMatch(/[A-Z]/);
  });
});

describe('the chapter list', () => {
  const entry = (word: string): LexiconEntry => ({ word, pinyin: 'guo1 jing4', gloss: '', kind: 'name', enabled: true, origin: 'auto' });

  async function drawer(count: number, opts: { text?: (s: string) => string } = {}) {
    const { ctx } = await makeCtx();
    const titles = Array.from({ length: count }, (_, i) => `第${i + 1}章 标题`);
    const book = { id: 'x', title: '书', author: '', format: 'paste' as const, script: 'simplified' as const, addedAt: 0, chapterCount: count, charCount: 1, chapterOffsets: [], chapterTitles: titles };
    const picked: number[] = [];
    const toc = createToc(ctx, book, (i) => picked.push(i), { load: async () => [entry('郭靖')], onWord: () => {}, onToggle: async () => {} }, opts);
    return { toc, picked };
  }

  it('draws only the rows near the window, so 2,000 chapters are as light as 20', async () => {
    const { toc } = await drawer(2000);
    toc.open(1500);
    const rows = document.querySelectorAll('.rd-toc-list:not(.rd-names) .rd-toc-row').length;
    expect(rows).toBeGreaterThan(5);
    expect(rows).toBeLessThan(60);
    expect(parseFloat((document.querySelector('.rd-toc-list .rd-toc-sizer') as HTMLElement).style.height)).toBeGreaterThanOrEqual(2000 * 44);
    // The row of the current chapter exists and is marked, and carries no number column.
    const current = document.querySelector('.rd-toc-item[aria-current="true"]')!;
    expect(current.textContent).toBe('第1501章 标题');
    expect(document.querySelector('.rd-toc-n')).toBeNull();
    toc.dispose();
  });
  it('is a modal dialog: focus goes in on open, stays in on Tab, and returns to the opener on close', async () => {
    const { toc } = await drawer(30);
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    toc.open(3);
    const panel = document.querySelector('.rd-toc')!;
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-modal')).toBe('true');
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute('aria-current')).toBe('true');
    for (let i = 0; i < 12; i++) {
      document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
      // jsdom does not move focus on Tab; the trap does it only at the ends, so walk the ends.
    }
    const last = [...panel.querySelectorAll<HTMLElement>('button, input')].filter((x) => !x.closest('[hidden]') && x.getAttribute('tabindex') !== '-1').pop()!;
    last.focus();
    last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(panel.contains(document.activeElement)).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(toc.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
    toc.dispose();
  });
  it('moves through the rows with the arrow keys, one tab stop for the whole list', async () => {
    const { toc, picked } = await drawer(300);
    toc.open(0);
    const tabStops = () => [...document.querySelectorAll<HTMLElement>('.rd-toc-list:not(.rd-names) .rd-toc-item')].filter((b) => b.tabIndex === 0).length;
    expect(tabStops()).toBe(1);
    const first = document.activeElement as HTMLElement;
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement?.textContent).toBe('第2章 标题');
    document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    expect(document.activeElement?.textContent).toBe('第300章 标题');
    (document.activeElement as HTMLElement).click();
    expect(picked).toEqual([299]);
    toc.dispose();
  });
  it('shows chapter titles and names in the script the reader is set to', async () => {
    const { toc } = await drawer(20, { text: (s) => s.replace('标题', '標題').replace('郭靖', '郭靖') });
    toc.open(0);
    expect(document.querySelector('.rd-toc-item')!.textContent).toBe('第1章 標題');
    toc.dispose();
  });
});

describe('the menus', () => {
  it('open as labeled dialogs, take focus, hold Tab, and give focus back to their button on Escape', async () => {
    const { ctx } = await makeCtx();
    const btn = document.createElement('button');
    document.body.appendChild(btn);
    btn.focus();
    const m = buildDisplayMenu(ctx);
    openPopover(btn, m.el, undefined, { label: 'Display settings' });
    const pop = document.querySelector('.rd-pop')!;
    expect(pop.getAttribute('role')).toBe('dialog');
    expect(pop.getAttribute('aria-label')).toBe('Display settings');
    expect(document.activeElement).toBe(pop);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(document.querySelector('.rd-pop')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
  it('hide the rows that do not apply: Pages rows in Scroll, the page width in Pages', async () => {
    const { ctx } = await makeCtx({ layout: 'scroll' });
    const m = buildDisplayMenu(ctx);
    document.body.appendChild(m.el);
    const row = (label: string) => [...m.el.querySelectorAll<HTMLElement>('.rd-row')].find((r) => r.querySelector('.rd-row-label')?.textContent?.startsWith(label))!;
    expect(row('Page turn').hidden).toBe(true);
    expect(row('Pages shown').hidden).toBe(true);
    expect(row('Page width').hidden).toBe(false);
    ctx.settings.set({ layout: 'pages' });
    m.sync();
    expect(row('Page turn').hidden).toBe(false);
    expect(row('Page width').hidden).toBe(true);
  });
  it('keep how the pinyin looks in the pinyin menu, with the mode', async () => {
    const { ctx } = await makeCtx();
    const display = buildDisplayMenu(ctx);
    const pinyin = buildPinyinMenu(ctx);
    const labels = (el: HTMLElement) => [...el.querySelectorAll('.rd-row-label')].map((x) => x.firstChild?.textContent);
    expect(labels(display.el)).not.toContain('Tone colors');
    expect(labels(pinyin.el)).toEqual(expect.arrayContaining(['Style', 'Tone colors', 'Tone changes']));
  });
  it('a slider shows its value as it moves but changes the setting once, after the pause or on release', async () => {
    vi.useFakeTimers();
    let value = 2;
    const set = vi.fn((v: number) => { value = v; });
    const s = slider(1, 3, 0.1, () => value, set, (v) => v.toFixed(1), 250);
    const input = s.el.querySelector('input')!;
    for (const v of ['2.1', '2.2', '2.3', '2.4']) { input.value = v; input.dispatchEvent(new Event('input')); }
    expect(s.el.querySelector('.rd-slider-out')!.textContent).toBe('2.4');
    expect(set).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenLastCalledWith(2.4);
    input.value = '2.9';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('change')); // release
    expect(set).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
    await tick();
  });
});

describe('tone colors on small pinyin', () => {
  // The pinyin is 10.5 px: each tone color, mixed toward the text color as the stylesheet does, must read at 4.5:1 on the page in every theme.
  const tokens = css('tokens.css');
  const block = (name: string) => {
    const re = name === 'light' ? /:root \{([\s\S]*?)\n\}/ : new RegExp(`:root\\[data-theme='${name}'\\] \\{([\\s\\S]*?)\\n\\}`);
    return tokens.match(re)![1];
  };
  const hex = (b: string, v: string, fallback = '') => (b.match(new RegExp(`--${v}:\\s*(#[0-9a-fA-F]{6})`))?.[1] ?? fallback);
  const lum = (h: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const mix = (a: string, b: string, share: number) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(a.slice(i, i + 2), 16) * share + parseInt(b.slice(i, i + 2), 16) * (1 - share)).toString(16).padStart(2, '0')).join('');

  it('are at least 4.5:1 in light, sepia and dark', () => {
    const base = block('light');
    for (const theme of ['light', 'sepia', 'dark']) {
      const b = block(theme);
      const bg = hex(b, 'bg', hex(base, 'bg'));
      const text = hex(b, 'text', hex(base, 'text'));
      for (let n = 1; n <= 5; n++) {
        const share = Number(reader.match(new RegExp(`rt\\.tone-${n} \\{ color: color-mix\\(in srgb, var\\(--tone-${n}\\) (\\d+)%`))![1]) / 100;
        const tone = hex(b, `tone-${n}`, hex(base, `tone-${n}`));
        expect(ratio(mix(tone, text, share), bg), `${theme} tone ${n}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it('really are different colors, so the setting is visible', () => {
    const base = block('light');
    const text = hex(base, 'text');
    const colors = [1, 2, 3, 4, 5].map((n) => mix(hex(base, `tone-${n}`), text, 0.74));
    expect(new Set(colors).size).toBe(5);
  });
});
