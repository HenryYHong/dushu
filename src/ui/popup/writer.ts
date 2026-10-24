// Stroke-order animation with hanzi-writer. The stroke data comes from jsdelivr on demand and is cached for
// the session; if it cannot be fetched (offline, or a character the data does not cover) the section stays hidden.
import { h } from '../dom';
import { icon } from '../icons';

const DATA_URL = 'https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/';
const cache = new Map<string, Promise<unknown>>();

/** The data holds single BMP characters; code points above U+FFFF and the compatibility blocks are not in it. */
export function strokeDataPossible(ch: string): boolean {
  const cp = ch.codePointAt(0);
  if (cp === undefined || cp > 0xFFFF || ch.length !== 1) return false;
  return !((cp >= 0xF900 && cp <= 0xFAFF) || (cp >= 0x3300 && cp <= 0x33FF) || (cp >= 0xFE30 && cp <= 0xFE4F));
}

export function loadStrokes(ch: string): Promise<unknown> {
  let p = cache.get(ch);
  if (!p) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    p = fetch(`${DATA_URL}${encodeURIComponent(ch)}.json`, { signal: ctl.signal })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .finally(() => clearTimeout(timer));
    // A 404 is remembered for the session; a network failure is retried on the next open.
    p.catch((e: Error) => { if (e.message !== '404') cache.delete(ch); });
    cache.set(ch, p);
  }
  return p;
}

/**
 * Returns a hidden section that fills in and shows itself once the strokes load.
 * `onShown` runs then, so the popup can re-measure.
 */
export function createStrokeOrder(ch: string, onShown: () => void): HTMLElement {
  const box = h('div.pp-stroke-box');
  const section = h('section.pp-stroke', { hidden: true }, h('span.pp-section', null, 'Stroke order'), box);
  if (!strokeDataPossible(ch) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return section;

  void (async () => {
    try {
      const [mod, data] = await Promise.all([import('hanzi-writer'), loadStrokes(ch)]);
      if (!section.isConnected) return;
      const HanziWriter = mod.default;
      const style = getComputedStyle(document.documentElement);
      const color = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
      section.hidden = false;
      const writer = HanziWriter.create(box, ch, {
        width: 128,
        height: 128,
        padding: 6,
        strokeColor: color('--text', '#222'),
        outlineColor: color('--border', '#ddd'),
        radicalColor: color('--accent', '#b8402e'),
        strokeAnimationSpeed: 1.2,
        delayBetweenStrokes: 220,
        charDataLoader: (_c: string, onComplete: (d: never) => void) => onComplete(data as never),
      });
      const replay = h('button.btn.btn-sm.btn-ghost', { onclick: () => { void writer.animateCharacter(); } }, icon('refresh'), 'Replay');
      section.appendChild(replay);
      void writer.animateCharacter();
      onShown();
    } catch {
      section.remove(); // offline or no data for this character: say nothing
    }
  })();
  return section;
}
