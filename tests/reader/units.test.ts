// @vitest-environment jsdom
// Smaller pieces of the reader that the screen tests do not reach: long blocks, lazy pinyin, the chapter list window,
// the menus, name capitalization and the stylesheet rules that carry the typography.
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Chapter, LexiconEntry, PinyinStyle } from '../../src/types';
import { createChapterView, MAX_BLOCK_CHARS, splitLongText } from '../../src/ui/reader/chapter';
import { MIN_CELL_EM } from '../../src/ui/reader/grid';
import { buildDisplayMenu, buildPinyinMenu, closePopover, openPopover, showShortcuts, slider } from '../../src/ui/reader/menus';
import { renderParagraph } from '../../src/ui/reader/render';
import { createToc } from '../../src/ui/reader/toc';
import { capitalizePinyin } from '../../src/core/names';
import { formatSyllable } from '../../src/core/pinyin';
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
    expect(reader).toMatch(/@media \(pointer: coarse\) \{ \.rd-endbtn \{ min-height: 44px; \} \}/);
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
  it('keeps the top bar opaque paper with no blur (text ghosted through the translucent one) and the pinyin pill one width', () => {
    const bar = reader.match(/\n\.rd-bar \{([^}]*)\}/)![1];
    expect(bar).toMatch(/background: var\(--bg\);/);
    expect(bar).toMatch(/(^|\s)backdrop-filter: none;/);
    expect(bar).toMatch(/-webkit-backdrop-filter: none;/);
    expect(reader).toMatch(/\.rd-pinyin-btn \{ min-width: \d+px;/);
  });
  it('draws the 拼 seal solid while pinyin shows and as an outline when it is off, and no HSK badge on the old eye', () => {
    expect(reader).toMatch(/\.rd-seal \{[^}]*background: var\(--accent-fill\);[^}]*color: var\(--accent-fill-text\);/);
    expect(reader).toMatch(/\.rd-pinyin-btn\[data-mode='off'\] \.rd-seal \{ background: transparent; color: var\(--accent\); box-shadow: inset 0 0 0 [\d.]+px var\(--accent\);/);
    expect(reader).not.toMatch(/content: attr\(data-level\)/);
  });
  it('marks a saved word with one stroke under the whole word, never in the chapter title, and moves no text', () => {
    expect(reader).not.toMatch(/\.rd-saved \.rd-c \{ box-shadow/);
    const stroke = reader.match(/\.rd-saved \.rd-c::before \{([^}]*)\}/)![1];
    expect(stroke).toMatch(/position: absolute;/);
    expect(stroke).toMatch(/left: 0; right: 0;/);
    expect(reader).toMatch(/\.rd-h1 \.rd-saved \.rd-c::before \{ display: none; \}/);
    // The chapter rule is drawn in the margin, out of the flow.
    expect(reader).toMatch(/\.rd-article \.rd-h1::after \{[^}]*position: absolute;/);
  });
  it('balances headings only, never a short prose paragraph', () => {
    expect(reader).toMatch(/\n\.rd-h \{ text-wrap: balance; \}/);
    expect(reader).not.toMatch(/\n[^\n{]*\.rd-short[^\n{]*\{[^}]*text-wrap: balance/);
  });
  it('keeps a 回目 half on one line in Safari only where the column holds the longest half of the classics', () => {
    // Safari has no fallback break inside a run held together with nowrap, so below this width it breaks between words.
    expect(reader).toMatch(/\.rd-h \{ word-break: keep-all; container: rd-h \/ inline-size; \}/);
    expect(reader).toMatch(/\.rd-h \.rd-w, \.rd-h \.rd-c \{ white-space: nowrap; \}/);
    const narrow = Number(reader.match(/@container rd-h \(max-width: ([\d.]+)em\) \{[^}]*word-break: normal;/)?.[1]);
    let longest = 0;
    for (const file of readdirSync(resolve(process.cwd(), 'public/samples')).filter((f) => f.endsWith('.txt'))) {
      for (const line of readFileSync(resolve(process.cwd(), 'public/samples', file), 'utf8').split('\n')) {
        if (!/^第[〇零一二三四五六七八九十百千0-9]+回[\u3000 ]/.test(line) || line.length > 40) continue;
        for (const half of line.trim().split(/[\u3000 ]+/).slice(1)) longest = Math.max(longest, [...half].length);
      }
    }
    expect(longest).toBeGreaterThanOrEqual(7);
    expect(longest * MIN_CELL_EM).toBeLessThanOrEqual(narrow);
    // A word of five characters or more breaks there; render.ts marks it with a class (see the next test for why not :has).
    expect(reader).toMatch(/@container rd-h \(max-width: [\d.]+em\) \{\n[^@]*?\.rd-h \.rd-w-long, \.rd-h \.rd-w-long > \.rd-c \{ white-space: normal; \}/);
  });
  it('never puts a position-counting selector inside :has(), which makes Chrome restyle the whole chapter on every DOM change', () => {
    // .rd-w:has(> .rd-c:nth-child(5)) restyled about 50,000 elements per frame while a long chapter scrolled (67 ms frames).
    for (const file of readdirSync(resolve(process.cwd(), 'src/styles')).filter((f) => f.endsWith('.css'))) {
      const text = readFileSync(resolve(process.cwd(), 'src/styles', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(text, file).not.toMatch(/:has\([^)]*:(nth-|first-child|last-child|only-child|first-of-type|last-of-type)/);
    }
  });
  it('frames the page on focus only when Tab brought it there, not when a closed word card hands focus back', () => {
    expect(reader).toMatch(/\.rd-stage:focus, \.rd-stage:focus-visible \{ outline: none; \}/);
    expect(reader).toMatch(/\.rd-stage\[data-tabbed\]:focus-visible \{ box-shadow: inset 0 0 0 2px var\(--focus\); \}/);
    expect(reader).toMatch(/\.rd-article:focus, \.rd-article:focus-visible \{ outline: none; \}/);
    expect(reader).toMatch(/\.rd-article\[data-tabbed\]:focus-visible \{ outline: 2px solid var\(--focus\)/);
  });
});

describe('names written as names', () => {
  it('capitalizes a person as surname and given name, joins a place and sets its kind apart, and leaves a term alone', () => {
    const py = (numbered: string, kind: LexiconEntry['kind'], word: string, style: PinyinStyle = 'marks') =>
      capitalizePinyin(numbered.split(' ').map((s) => formatSyllable(s, style)), kind, word);
    expect(py('huang2 rong2', 'name', '黄蓉')).toBe('Huáng Róng');
    expect(py('tao2 hua1 dao3', 'place', '桃花岛')).toBe('Táohuā Dǎo');
    expect(py('jia1 xing1', 'place', '嘉兴')).toBe('Jiāxīng');
    expect(py('xiang2 long2 shi2 ba1 zhang3', 'term', '降龙十八掌')).toBe('xiáng lóng shí bā zhǎng');
    expect(py('guo1 jing4', 'name', '郭靖', 'numbers')).toBe('Guo1 Jing4');
    expect(py('guo1 jing4', 'name', '郭靖', 'zhuyin')).not.toMatch(/[A-Z]/);
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
  it('in the Unknown and HSK modes, offer learning from reading and say how much of the chapter has pinyin', async () => {
    const { ctx } = await makeCtx({ pinyin: 'all' });
    let shown = 40;
    const m = buildPinyinMenu(ctx, () => ({ words: 200, shown }));
    const learn = [...m.el.querySelectorAll<HTMLElement>('.rd-row')].find((r) => r.textContent?.startsWith('Learn known words as I read'))!;
    const share = m.el.querySelector<HTMLElement>('.rd-share')!;
    expect(learn.hidden).toBe(true);
    expect(share.hidden).toBe(true);
    for (const mode of ['unknown', 'hsk'] as const) {
      ctx.settings.set({ pinyin: mode });
      m.sync();
      expect(learn.hidden).toBe(false);
      expect(share.hidden).toBe(false);
      expect(share.textContent).toBe("Pinyin on 20% of this chapter's words");
    }
    shown = 9;
    ctx.settings.set({ hskThreshold: 6 });
    m.sync();
    expect(share.textContent).toBe("Pinyin on 5% of this chapter's words");
    // No chapter on screen: no line.
    const bare = buildPinyinMenu(ctx, () => null);
    expect(bare.el.querySelector<HTMLElement>('.rd-share')!.hidden).toBe(true);
  });
  it('call the settings what Settings calls them', async () => {
    const { ctx } = await makeCtx({ ttsRate: 0.9 });
    const m = buildDisplayMenu(ctx);
    const row = (label: string) => [...m.el.querySelectorAll<HTMLElement>('.rd-row')].find((r) => r.querySelector('.rd-row-label')?.firstChild?.textContent === label);
    const options = (label: string) => [...row(label)!.querySelectorAll('.rd-seg-btn')].map((b) => b.textContent);
    expect(options('Theme')).toEqual(['Auto', 'Light', 'Sepia', 'Dark']);
    expect(options('Characters')).toEqual(['As written', 'Simplified', 'Traditional']);
    expect(row('Read-aloud speed')!.querySelector('.rd-slider-out')!.textContent).toBe('0.9×');
    expect(row('Reading speed')).toBeUndefined();
  });
  it('leave out Translate paragraphs on a touch screen, where the switch has nothing to show', async () => {
    const { ctx } = await makeCtx();
    const labels = (el: HTMLElement) => [...el.querySelectorAll('.rd-row-label')].map((x) => x.firstChild?.textContent);
    expect(labels(buildDisplayMenu(ctx).el)).toContain('Translate paragraphs');
    const real = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q === '(hover: none)', media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    try {
      expect(labels(buildDisplayMenu(ctx).el)).not.toContain('Translate paragraphs');
    } finally { window.matchMedia = real; }
  });
  it('the ? sheet titles its groups, so P reads once per group, and gives focus back on close', () => {
    // jsdom has no showModal or close on <dialog>.
    const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
    proto.showModal ??= function (this: HTMLDialogElement) { this.setAttribute('open', ''); };
    proto.close ??= function (this: HTMLDialogElement) { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
    const page = document.createElement('div');
    page.tabIndex = 0;
    document.body.appendChild(page);
    page.focus();
    showShortcuts();
    const dlg = document.querySelector<HTMLDialogElement>('dialog.rd-keys')!;
    expect([...dlg.querySelectorAll('.sc-group-title')].map((e) => e.textContent)).toEqual(['Reading', 'In a word card']);
    for (const g of dlg.querySelectorAll('.sc-group')) {
      const ps = [...g.querySelectorAll('dt')].filter((dt) => dt.textContent === 'P');
      expect(ps.length).toBeLessThanOrEqual(1);
    }
    // Key caps, not "Shift + ← or →" in one box.
    const chord = [...dlg.querySelectorAll('dt')].find((dt) => dt.textContent?.includes('Shift'))!;
    expect(chord.querySelectorAll('kbd').length).toBe(3);
    dlg.close();
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(page);
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
  it('at night are pulled toward the quiet gray, and still read at 4.5:1', () => {
    const base = block('light');
    const b = block('dark');
    for (let n = 1; n <= 5; n++) {
      const m = reader.match(new RegExp(`:root\\[data-theme='dark'\\] \\.rd-article rt\\.tone-${n} \\{ color: color-mix\\(in srgb, var\\(--tone-${n}\\) (\\d+)%, var\\(--text-3\\)\\)`));
      expect(m, `dark tone ${n} rule`).not.toBeNull();
      const c = mix(hex(b, `tone-${n}`, hex(base, `tone-${n}`)), hex(b, 'text-3'), Number(m![1]) / 100);
      expect(ratio(c, hex(b, 'bg')), `dark tone ${n}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('on word cards, Vocabulary and Review (base.css .tone-N) read at 4.5:1 on every surface they sit on, in every theme', () => {
    const baseCss = css('base.css');
    const base = block('light');
    for (const theme of ['light', 'sepia', 'dark']) {
      const b = block(theme);
      const text = hex(b, 'text', hex(base, 'text'));
      for (let n = 1; n <= 5; n++) {
        const m = baseCss.match(new RegExp(`\\n\\.tone-${n} \\{ color: color-mix\\(in srgb, var\\(--tone-${n}\\) (\\d+)%, var\\(--text\\)\\)`));
        expect(m, `.tone-${n} is mixed toward the text`).not.toBeNull();
        const c = mix(hex(b, `tone-${n}`, hex(base, `tone-${n}`)), text, Number(m![1]) / 100);
        for (const surface of ['bg', 'surface', 'surface-2', 'elev']) {
          expect(ratio(c, hex(b, surface, hex(base, surface))), `${theme} tone ${n} on --${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
  it('keeps chosen menu options, filled red controls and red text readable in every theme', () => {
    const base = block('light');
    for (const theme of ['light', 'sepia', 'dark']) {
      const b = block(theme);
      const v = (k: string) => hex(b, k, hex(base, k));
      // A chosen option is ink on the ink wash (--wash-2: 9% of the text, 12% at night) over the menu sheet; its hint
      // steps up to --text-2 there. A chosen segment is ink on the raised thumb; the others are --text-2 on the track.
      const wash = mix(v('text'), v('elev'), theme === 'dark' ? 0.12 : 0.09);
      expect(reader).toMatch(/\.rd-opt\[aria-checked='true'\] \.rd-opt-hint \{ color: var\(--text-2\); \}/);
      expect(ratio(v('text'), wash), `${theme} chosen option`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v('text-2'), wash), `${theme} chosen option hint`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v('text'), v('thumb')), `${theme} chosen segment`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v('text-2'), wash), `${theme} segment track`).toBeGreaterThanOrEqual(4.5);
      // The seal, the primary button and the badges: silk on lacquer; thin red marks and red text on the page.
      expect(ratio(v('accent-fill-text'), v('accent-fill')), `${theme} filled red`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(v('accent'), v('bg')), `${theme} red text`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('really are different colors, so the setting is visible', () => {
    const base = block('light');
    const text = hex(base, 'text');
    const colors = [1, 2, 3, 4, 5].map((n) => mix(hex(base, `tone-${n}`), text, 0.74));
    expect(new Set(colors).size).toBe(5);
  });
});
