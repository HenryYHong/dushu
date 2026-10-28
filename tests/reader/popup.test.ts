// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closePopup, openPhrasePopup, openWordPopup } from '../../src/ui/popup/popup';
import { anchorRect, makeCtx, stubBrowser, tick } from './helpers';
import { buildLexicon } from '../../src/core/lexicon';

// Whether the Mac says Claude is ready; the real answer comes from a network call these tests do not make.
let claudeReady = false;
vi.mock('../../src/translate/claude', async (original) => ({ ...(await original<typeof import('../../src/translate/claude')>()), claudeReadySync: () => claudeReady }));

beforeAll(() => stubBrowser());
afterEach(() => { closePopup(); document.body.innerHTML = ''; });

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const text = (sel: string) => q(sel)?.textContent ?? '';
const press = (key: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));

describe('word popup', () => {
  it('shows headword, pinyin, HSK level, definitions, measure words and a breakdown', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    expect(text('.pp-word')).toBe('银行');
    expect(text('.pp-trad')).toBe('銀行');
    expect(text('.pp-pyline .pp-py')).toBe('yín háng');
    expect(q('.pp-pyline .chip')?.textContent).toBe('HSK 2');
    expect(text('.pp-defs')).toContain('bank');
    expect(text('.pp-cl')).toContain('Measure word');
    expect(text('.pp-cl')).toContain('jiā');
    expect(document.querySelectorAll('.pp-card')).toHaveLength(2);
    expect(q('.pp-pyline .pp-syl')?.className).toContain('tone-2');
  });

  it('follows the pinyin style setting', async () => {
    const { ctx } = await makeCtx({ pinyinStyle: 'numbers', toneColors: false });
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    expect(text('.pp-pyline .pp-py')).toBe('yin2 hang2');
    expect(q('.pp-pyline .pp-syl')?.className).toBe('pp-syl');
  });

  it('lists every reading of a polyphone and flags the one used in the sentence', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '了', prev: '看', next: '。', anchor: anchorRect(), context: { sentence: '他看了。' } });
    const heads = [...document.querySelectorAll('.pp-reading-head .pp-py')].map((e) => e.textContent);
    expect(heads).toEqual(['le', 'liǎo', 'liào']);
    expect(q('.pp-reading-head .chip-accent')?.textContent).toBe('reading in this sentence');
    expect(text('.pp-body .pp-note')).toContain('not just the one used here');
  });

  it('uses the reading from the selected book token instead of guessing it again', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '了', reading: ['liao3'], prev: '看', next: '。', anchor: anchorRect(), context: { sentence: '他看了。' } });
    expect(text('.pp-pyline .pp-py')).toBe('liǎo');
    expect(text('.pp-reading-head .pp-py')).toBe('liǎo');
    expect(q('.pp-reading-head .chip-accent')?.textContent).toBe('reading in this sentence');
  });

  it('cross-references re-open the popup on that word, and Back returns', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '了', anchor: anchorRect() });
    const refs = [...document.querySelectorAll<HTMLElement>('.pp-xref')];
    const toLiao = refs.find((r) => r.textContent === '了 liǎo');
    expect(toLiao).toBeTruthy();
    expect(q('.pp-back')).toBeNull();
    toLiao!.click();
    expect(q('.pp-back')).not.toBeNull();
    expect(text('.pp-reading-head .pp-py')).toBe('liǎo'); // that reading comes first
    q('.pp-back')!.click();
    expect(q('.pp-back')).toBeNull();
    expect(text('.pp-reading-head .pp-py')).toBe('le');
  });

  it('drills into a character and back', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    document.querySelectorAll<HTMLElement>('.pp-card')[1].click();
    expect(text('.pp-word')).toBe('行');
    expect(q('.pp-facts')).not.toBeNull();
    expect(text('.pp-facts')).toContain('Radical');
    q('.pp-back')!.click();
    expect(text('.pp-word')).toBe('银行');
  });

  it('Save writes a vocab item with the context sentence, and toggles off', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({
      ctx, word: '银行', anchor: anchorRect(),
      context: { sentence: '我们在银行门口见面。', bookId: 'b1', bookTitle: '测试', chapter: 2 },
    });
    q('.pp-save')!.click();
    await vi.waitFor(async () => expect(await ctx.store.vocab.get('银行')).toBeTruthy());
    const item = (await ctx.store.vocab.get('银行'))!;
    expect(item).toMatchObject({ simp: '银行', trad: '銀行', pinyin: 'yin2 hang2' });
    expect(item.gloss).toContain('bank');
    expect(item.context).toEqual({ sentence: '我们在银行门口见面。', bookId: 'b1', bookTitle: '测试', chapter: 2 });
    expect(item.srs.reps).toBe(0);
    await vi.waitFor(() => expect(q('.pp-save')!.getAttribute('aria-pressed')).toBe('true'));
    q('.pp-save')!.click();
    await vi.waitFor(async () => expect(await ctx.store.vocab.get('银行')).toBeUndefined());
    await vi.waitFor(() => expect(q('.pp-save')!.getAttribute('aria-pressed')).toBe('false'));
  });

  it('Known toggles the known set; the keyboard shortcuts do the same', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '銀行', anchor: anchorRect() }); // traditional input
    press('k');
    await vi.waitFor(() => expect(ctx.store.known.has('银行')).toBe(true));
    expect(ctx.store.known.has('銀行')).toBe(true);
    press('K');
    await vi.waitFor(() => expect(ctx.store.known.has('银行')).toBe(false));
    press('s');
    await vi.waitFor(() => expect(ctx.store.vocab.has('银行')).toBe(true));
  });

  it('works for rare characters: astral, Kangxi radical, compatibility ideograph', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '𠀀', anchor: anchorRect() });
    expect(text('.pp-word')).toBe('𠀀');
    expect(text('.pp-facts')).toContain('U+20000');
    expect(text('.pp-facts')).toContain('Extension B');
    expect(text('.pp-note')).toContain('Unihan');
    expect([...document.querySelectorAll('.pp-links a')].map((a) => a.getAttribute('href'))[0]).toContain(encodeURIComponent('𠀀'));

    openWordPopup({ ctx, word: '⼈', anchor: anchorRect() });
    expect(text('.pp-facts')).toContain('Kangxi Radicals');
    expect(text('.pp-facts')).toContain('Compatibility form of');

    openWordPopup({ ctx, word: '豈', anchor: anchorRect() });
    expect(text('.pp-pyline')).toContain('qǐ');
    expect(text('.pp-pyline')).toContain('Simplified');
    expect(text('.pp-facts')).toContain('U+8C48');
  });

  it('says so when a character has no data at all', async () => {
    const { ctx, dict } = await makeCtx();
    const empty = [...'\u{2A700}\u{30000}\u{31350}\u{323AF}'].find((c) => {
      const i = dict.char(c);
      return i && i.source === 'none' && !dict.lookup(c).length;
    });
    expect(empty).toBeTruthy();
    openWordPopup({ ctx, word: empty!, anchor: anchorRect() });
    expect(text('.pp-word')).toBe(empty);
    expect(text('.pp-note')).toMatch(/no reading or meaning/);
    expect(text('.pp-facts')).toContain('U+');
  });

  it('explains a multi-character combination the dictionary does not have', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '龘龘面', anchor: anchorRect() });
    expect(document.querySelectorAll('.pp-card')).toHaveLength(3);
    expect(text('.pp-note')).toMatch(/not in the dictionary/);
  });

  it('shows stepping controls only when the reader provides them, and wires the keys', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    expect(q('.pp-tools')).toBeNull();
    expect(q('.pp-foot')).toBeNull();
    closePopup();

    const onStep = vi.fn();
    const onResize = vi.fn();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), onStep, onResize, context: { sentence: '我去银行。' } });
    expect(q('.pp-tools')).not.toBeNull();
    press('ArrowRight');
    press('ArrowLeft');
    press('ArrowRight', { shiftKey: true });
    press('ArrowLeft', { shiftKey: true });
    expect(onStep.mock.calls).toEqual([[1], [-1]]);
    expect(onResize.mock.calls).toEqual([[1], [-1]]);
  });

  it('is one popup at a time and closes on Esc, outside press, and hash change', async () => {
    const { ctx } = await makeCtx();
    const onClose = vi.fn();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), onClose });
    openWordPopup({ ctx, word: '学习', anchor: anchorRect() });
    expect(document.querySelectorAll('.pp-pop')).toHaveLength(1);
    expect(onClose).toHaveBeenCalledTimes(1); // the first one closed when the second opened
    press('Escape');
    expect(q('.pp-pop')).toBeNull();

    const onClose2 = vi.fn();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), onClose: onClose2 });
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(q('.pp-pop')).toBeNull();
    expect(onClose2).toHaveBeenCalledTimes(1);

    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    window.dispatchEvent(new Event('hashchange'));
    expect(q('.pp-pop')).toBeNull();
  });

  it('waits for the dictionary when it is not loaded yet', async () => {
    const { ctx } = await makeCtx({}, { dictReady: false });
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    expect(q('.pp-loading')).not.toBeNull();
    await vi.waitFor(() => expect(text('.pp-word')).toBe('银行'));
  });
});

describe('phrase popup', () => {
  it('uses the book glossary instead of unrelated dictionary senses in phrase rows', async () => {
    const { ctx } = await makeCtx();
    const lexicon = buildLexicon([{ word: '银行', pinyin: 'yin2 hang2', gloss: 'The bank in this story', kind: 'user', enabled: true, origin: 'user' }]);
    openPhrasePopup({ ctx, text: '我们在银行门口见面。', anchor: anchorRect(), lexicon });
    const row = [...document.querySelectorAll('.pp-wbw')].find(e => e.querySelector('.pp-wbw-word')?.textContent === '银行');
    expect(row?.textContent).toContain('The bank in this story');
  });
  it('shows the text with pinyin, a translation, and word-by-word rows', async () => {
    const { ctx } = await makeCtx();
    openPhrasePopup({ ctx, text: '我们在银行门口见面。', anchor: anchorRect(), context: '我们在银行门口见面。' });
    expect(text('.pp-kind').toLowerCase()).toBe('phrase');
    expect(document.querySelectorAll('.pp-phrase-text ruby rt').length).toBe(9);
    // The pinyin never leaks into what a user can select inside the popup.
    expect(getComputedStyle(q('.pp-phrase-text rt')!).userSelect).toBeDefined();
    expect([...document.querySelectorAll('.pp-wbw-word')].map((e) => e.textContent)).toEqual(['我们', '在', '银行', '门口', '见面']);
    // With no real translator the word list is the content: one quiet line, not the same glosses printed twice.
    await vi.waitFor(() => expect(text('.pp-tr-body')).toContain('set to word by word')); // makeCtx sets translator: gloss
    expect(q('.pp-tr-text')).toBeNull();
    expect(q('.pp-tr')!.classList.contains('pp-tr-quiet')).toBe(true);
    expect(q('.pp-tr-body a')!.getAttribute('href')).toBe('#/settings');
    expect(q('.pp-tr-body')!.getAttribute('aria-live')).toBe('polite');
  });

  it('puts the translation directly under the header, before the repeated pinyin and the Read button', async () => {
    const { ctx } = await makeCtx();
    openPhrasePopup({ ctx, text: '我们在银行门口见面。', anchor: anchorRect(), onReadFromHere: () => {} });
    const order = [...q('.pp-body')!.children].map((e) => e.className.split(' ')[0]);
    expect(order[0]).toBe('pp-tr');
    expect(order.indexOf('pp-tr')).toBeLessThan(order.indexOf('pp-phrase-text'));
    expect(order.indexOf('pp-phrase-text')).toBeLessThan(order.indexOf('pp-wbw-sec'));
  });

  it('a row opens the word popup with a Back that returns to the phrase', async () => {
    const { ctx } = await makeCtx();
    openPhrasePopup({ ctx, text: '我们在银行门口见面。', anchor: anchorRect() });
    document.querySelectorAll<HTMLElement>('.pp-wbw')[2].click();
    expect(document.querySelectorAll('.pp-pop')).toHaveLength(1);
    expect(text('.pp-word')).toBe('银行');
    q('.pp-back')!.click();
    expect(q('.pp-phrase-text')).not.toBeNull();
  });

  it('multi-line selections become one paragraph per line', async () => {
    const { ctx } = await makeCtx();
    openPhrasePopup({ ctx, text: '第一句。\n第二句。', anchor: anchorRect() });
    expect(document.querySelectorAll('.pp-phrase-text .pp-line')).toHaveLength(2);
  });

  it('lets the user try another provider and shows an error when it is unusable', async () => {
    const { ctx } = await makeCtx();
    openPhrasePopup({ ctx, text: '你好。', anchor: anchorRect() });
    await vi.waitFor(() => expect(q('.pp-tr-actions button')).not.toBeNull());
    const more = [...document.querySelectorAll<HTMLElement>('.pp-tr-actions button')].find((b) => /another provider/.test(b.textContent ?? ''))!;
    more.click();
    await vi.waitFor(() => expect(document.querySelectorAll('.pp-menu-item').length).toBe(5));
    const claude = [...document.querySelectorAll<HTMLButtonElement>('.pp-menu-item')].find((b) => /Claude/.test(b.textContent ?? ''))!;
    expect(claude.disabled).toBe(true); // no Mac connected
    expect(claude.textContent).toMatch(/Mac/);
  });

  it('offers Explain only when the Mac says Claude is ready', async () => {
    const { ctx } = await makeCtx();
    openPhrasePopup({ ctx, text: '你好。', anchor: anchorRect() });
    await vi.waitFor(() => expect(q('.pp-tr-actions button')).not.toBeNull());
    expect([...document.querySelectorAll('.pp-tr-actions button')].some((b) => /Explain/.test(b.textContent ?? ''))).toBe(false);
    closePopup();
    claudeReady = true;
    openPhrasePopup({ ctx, text: '你好。', anchor: anchorRect() });
    await vi.waitFor(() => expect(q('.pp-tr-actions button')).not.toBeNull());
    expect([...document.querySelectorAll('.pp-tr-actions button')].some((b) => /Explain/.test(b.textContent ?? ''))).toBe(true);
    claudeReady = false;
  });

  it('Copy puts the selected text on the clipboard', async () => {
    const { ctx, toasts } = await makeCtx();
    const written: string[] = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t: string) => { written.push(t); } } });
    openPhrasePopup({ ctx, text: '你好。', anchor: anchorRect() });
    q('.pp-copy')!.click();
    await tick(10);
    expect(written).toEqual(['你好。']);
    expect(toasts).toContain('Copied');
  });
});
