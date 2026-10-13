// @vitest-environment jsdom
// The popup shell: it scrolls without snapping back, takes and returns focus, and the footer stays reachable.
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { closePopup, openPhrasePopup, openWordPopup } from '../../src/ui/popup/popup';
import { createHost } from '../../src/ui/popup/host';
import { anchorRect, makeCtx, stubBrowser, tick } from '../reader/helpers';

beforeAll(() => stubBrowser());
afterEach(() => { closePopup(); document.body.innerHTML = ''; });

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

describe('scrolling', () => {
  it('a scroll inside the popup does not re-place it, so scrollTop sticks', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '過', anchor: anchorRect(), onStep: () => {}, onResize: () => {} });
    const scroller = q('.pp-scroll')!;
    const card = q('.pp-pop')!;
    const before = card.style.maxHeight;
    expect(before).toMatch(/px$/);
    scroller.scrollTop = 120;
    scroller.dispatchEvent(new Event('scroll'));
    await frame();
    await frame();
    expect(scroller.scrollTop).toBe(120);
    expect(card.style.maxHeight).toBe(before); // placing used to set it to "none" and clamp scrollTop to 0
  });

  it('the page scrolling still moves the popup with its anchor', async () => {
    const calls: number[] = [];
    let top = 200;
    const host = createHost({
      kind: 'word', label: 'test', anchor: anchorRect(),
      getAnchor: () => { calls.push(top); return new DOMRect(300, top, 40, 30); },
    });
    host.content.textContent = 'x';
    host.placeNow();
    const n = calls.length;
    top = 260;
    document.body.dispatchEvent(new Event('scroll', { bubbles: false })); // some other element scrolling
    window.dispatchEvent(new Event('scroll'));
    await frame();
    expect(calls.length).toBeGreaterThan(n);
    host.close();
  });

  it('the card does not clip, the scroll box inside it does, and the footer is the last thing in it', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), onStep: () => {}, onResize: () => {} });
    const card = q('.pp-pop')!;
    const scroller = q('.pp-scroll')!;
    expect(scroller.parentElement).toBe(card);
    const foot = q('.pp-foot')!;
    expect(scroller.contains(foot)).toBe(true);
    expect([...q('.pp-seg')!.querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual(['Prev', 'Next', 'Shorter', 'Longer']);
  });
});

describe('short sheets', () => {
  it('marks a sheet under 420 px as short, so the stepping bar can scroll with the content', async () => {
    const { ctx } = await makeCtx();
    const inner = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), onStep: () => {}, onResize: () => {} });
    expect(q('.pp-pop')!.classList.contains('pp-sheet')).toBe(true);
    expect(q('.pp-pop')!.classList.contains('pp-short')).toBe(true); // 45% of 844 is 380
    closePopup();
    Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 768, configurable: true });
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    expect(q('.pp-pop')!.classList.contains('pp-short')).toBe(false);
    if (inner) Object.defineProperty(window, 'innerHeight', inner);
  });
});

describe('focus', () => {
  it('moves focus into the dialog when it opens and labels it', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    const card = q('.pp-pop')!;
    expect(card.getAttribute('role')).toBe('dialog');
    expect(card.getAttribute('aria-label')).toBe('Word: 银行');
    expect(card.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(card);
  });

  it('gives focus back to the word that opened it on Escape and on close', async () => {
    const { ctx } = await makeCtx();
    const word = document.createElement('span');
    word.className = 'rd-w';
    word.tabIndex = 0;
    word.textContent = '银行';
    document.body.append(word);
    word.focus();
    expect(document.activeElement).toBe(word);
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    expect(document.activeElement).toBe(q('.pp-pop'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(q('.pp-pop')).toBeNull();
    expect(document.activeElement).toBe(word);
  });

  it('uses restoreFocus when the reader supplies the element', async () => {
    const { ctx } = await makeCtx();
    const other = document.createElement('button');
    document.body.append(other);
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), restoreFocus: () => other });
    closePopup();
    expect(document.activeElement).toBe(other);
  });

  it('keeps focus in the dialog when a view replaces the control that had it (drilling in)', async () => {
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    q('.pp-card')!.focus();
    q('.pp-card')!.click();
    expect(q('.pp-pop')!.contains(document.activeElement)).toBe(true);
  });

  it('does not steal focus back when the user already moved it somewhere else', async () => {
    const { ctx } = await makeCtx();
    const opener = document.createElement('button');
    const elsewhere = document.createElement('input');
    document.body.append(opener, elsewhere);
    opener.focus();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect() });
    elsewhere.focus();
    closePopup();
    expect(document.activeElement).toBe(elsewhere);
  });
});

describe('room below a scrolling page', () => {
  it('a phone sheet adds room under the page, so the last line can scroll above it, and removes it on close', async () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), keepAnchorVisible: true });
    const room = q('.pp-sheet-room');
    expect(room).not.toBeNull();
    expect(Number.parseFloat(room!.style.height)).toBeGreaterThan(0);
    closePopup();
    expect(q('.pp-sheet-room')).toBeNull();
    // A page that lifts itself (Pages) needs no room.
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), keepAnchorVisible: true, onSheetTop: () => {} });
    expect(q('.pp-sheet-room')).toBeNull();
    closePopup();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  });
});

describe('sheet top', () => {
  it('reports the sheet top after a placement and null when it closes', async () => {
    const tops: (number | null)[] = [];
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });
    const { ctx } = await makeCtx();
    openWordPopup({ ctx, word: '银行', anchor: anchorRect(), onSheetTop: (t) => tops.push(t) });
    expect(typeof tops[0]).toBe('number');
    closePopup();
    await tick(5);
    expect(tops[tops.length - 1]).toBeNull();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 });
  });

  it('a phrase popup is a dialog too', async () => {
    const { ctx } = await makeCtx();
    openPhrasePopup({ ctx, text: '我们在银行门口见面。', anchor: anchorRect() });
    expect(q('.pp-pop')!.getAttribute('aria-label')).toBe('Phrase');
    expect(document.activeElement).toBe(q('.pp-pop'));
  });
});
