// Counts the time spent reading or reviewing toward the day (core/activity.ts). Time counts while the page is in front and the
// reader did something in the last three minutes (a page turned, a word tapped, a scroll, a key) or the book is being read
// aloud; a book left open on the table does not run up the day.
import type { LangId } from '../lang/types';
import { addSeconds, streak } from './activity';
import { getPlan } from './plan';

const TICK_MS = 5_000;
const IDLE_MS = 180_000;
const INPUTS = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;

/** Starts counting for `lang`; `onGoal` hears when today's goal is reached. Returns the stop function. */
export function startReadingClock(lang: LangId, onGoal?: (days: number, goal: number) => void): () => void {
  let lastInput = Date.now();
  let lastTick = Date.now();
  let pending = 0;
  const onInput = () => { lastInput = Date.now(); };
  for (const type of INPUTS) document.addEventListener(type, onInput, { capture: true, passive: true });
  const speaking = () => { try { return !!globalThis.speechSynthesis?.speaking; } catch { return false; } };
  const flush = () => {
    if (pending < 1) return;
    const goal = getPlan().goal;
    const before = streak(goal).met;
    addSeconds(lang, pending, goal);
    pending = 0;
    if (!before) {
      const after = streak(goal);
      if (after.met) onGoal?.(after.current, goal);
    }
  };
  const tick = () => {
    const now = Date.now();
    const since = Math.min(now - lastTick, TICK_MS * 2);
    lastTick = now;
    if (document.visibilityState === 'visible' && (now - lastInput <= IDLE_MS || speaking())) pending += since / 1000;
    if (pending >= 5) flush();
  };
  const timer = window.setInterval(tick, TICK_MS);
  const onVisible = () => {
    if (document.visibilityState === 'hidden') { tick(); flush(); } else { lastTick = Date.now(); lastInput = Date.now(); }
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    tick();
    flush();
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    for (const type of INPUTS) document.removeEventListener(type, onInput, { capture: true });
  };
}
