// @vitest-environment jsdom
// Which word a finger meant: the one under it, or else the nearest within a finger's width, measured from the finger to the
// word's own boxes (not the first one a probe happened to reach).
import { afterEach, describe, expect, it } from 'vitest';
import { NEAR_PX, wordNear } from '../../src/ui/reader/wordNear';

type Box = { left: number; top: number; right: number; bottom: number };
function page(words: Record<string, Box>) {
  document.body.innerHTML = '';
  const els = new Map<string, HTMLElement>();
  for (const [name, b] of Object.entries(words)) {
    const el = document.createElement('span');
    el.className = 'rd-w';
    el.textContent = name;
    el.getClientRects = () => [{ ...b, width: b.right - b.left, height: b.bottom - b.top, x: b.left, y: b.top }] as unknown as DOMRectList;
    document.body.appendChild(el);
    els.set(name, el);
  }
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: (x: number, y: number) => [...els.values()].find((el) => {
      const r = el.getClientRects()[0];
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }) ?? document.body,
  });
  return els;
}
afterEach(() => { delete (document as { elementFromPoint?: unknown }).elementFromPoint; });

describe('the word a finger meant', () => {
  it('is the one under it', () => {
    const w = page({ 云: { left: 100, top: 100, right: 128, bottom: 140 } });
    expect(wordNear(110, 120)).toBe(w.get('云'));
  });

  it('is the nearer of two, not the one up or left that a probe reaches first', () => {
    // A colon between 云 (ends at 128) and 因 (starts at 137): a tap at 135 is 2 px from 因 and 7 px from 云.
    const w = page({ 云: { left: 100, top: 100, right: 128, bottom: 140 }, 因: { left: 137, top: 100, right: 165, bottom: 140 } });
    expect(wordNear(135, 120)).toBe(w.get('因'));
    // Between two lines: 2 px above the lower word, 5 px below the upper one.
    const v = page({ 甄士隐: { left: 100, top: 100, right: 180, bottom: 140 }, 风尘: { left: 100, top: 147, right: 160, bottom: 187 } });
    expect(wordNear(120, 145)).toBe(v.get('风尘'));
  });

  it('reaches into the margin beside a line, but not past a finger’s width', () => {
    const w = page({ 根: { left: 60, top: 280, right: 88, bottom: 320 } });
    expect(wordNear(54, 300)).toBe(w.get('根'));
    expect(wordNear(60 - NEAR_PX - 2, 300)).toBeNull();
  });
});
