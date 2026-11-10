// What the reader is learning: the languages chosen on the welcome screen (ui/welcome.ts) or in Settings, and the daily goal in
// minutes. The reader's, not one library's, so under no language's prefix. Kept on the device.
import { isLangId } from '../lang/registry';
import type { LangId } from '../lang/types';
import { ACTIVITY_EVENT, DEFAULT_GOAL, GOALS, setTodayGoal } from './activity';

export const PLAN_KEY = 'dushu.plan.v1';

export interface Plan {
  /** The languages being learned, in the order chosen. Empty: not said (a device from before the welcome screen). */
  langs: LangId[];
  /** Minutes a day. */
  goal: number;
  /** When the welcome screen was finished (or found unneeded); 0 while it has not been. */
  welcomed: number;
}

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

export function getPlan(store = storage()): Plan {
  let raw: unknown = null;
  try { raw = JSON.parse(store?.getItem(PLAN_KEY) ?? 'null'); } catch { /* start again */ }
  const p = (raw && typeof raw === 'object' ? raw : {}) as { langs?: unknown; goal?: unknown; welcomed?: unknown };
  const langs = Array.isArray(p.langs) ? [...new Set(p.langs.filter(isLangId))] : [];
  const goal = typeof p.goal === 'number' && (GOALS as readonly number[]).includes(p.goal) ? p.goal : DEFAULT_GOAL;
  const welcomed = typeof p.welcomed === 'number' && Number.isFinite(p.welcomed) ? p.welcomed : 0;
  return { langs, goal, welcomed };
}

export function setPlan(patch: Partial<Plan>, store = storage()): Plan {
  const before = getPlan(store);
  const next = { ...before, ...patch };
  try { store?.setItem(PLAN_KEY, JSON.stringify(next)); } catch { /* kept for this visit only */ }
  if (next.goal !== before.goal) setTodayGoal(next.goal, Date.now(), store);
  if (typeof globalThis.dispatchEvent === 'function' && typeof Event === 'function') globalThis.dispatchEvent(new Event(ACTIVITY_EVENT));
  return getPlan(store);
}

/**
 * Whether this device should see the welcome screen: never finished it, and has never been used (no key of the app's at all).
 * A device used before the welcome screen existed is marked as welcomed, so it never interrupts someone already reading.
 * A device that is to be welcomed gets its plan at once, unfinished: boot writes settings keys before the welcome shows, so
 * without it a reload (or a second tab) in the middle of the welcome would take those keys for an old reader's and skip it.
 */
export function needsWelcome(store = storage()): boolean {
  if (!store) return false;
  let saved: string | null;
  try { saved = store.getItem(PLAN_KEY); } catch { return false; }
  if (saved !== null) return !getPlan(store).welcomed;
  let used = false;
  try {
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith('dushu.') && k !== PLAN_KEY) { used = true; break; }
    }
  } catch { return false; }
  if (used) { setPlan({ welcomed: Date.now() }, store); return false; }
  // Written directly: setPlan would tell the (not yet drawn) screens that the plan changed.
  const plan: Plan = { langs: [], goal: DEFAULT_GOAL, welcomed: 0 };
  try { store.setItem(PLAN_KEY, JSON.stringify(plan)); } catch { /* asked again on the next visit */ }
  return true;
}
