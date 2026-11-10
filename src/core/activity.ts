// Time spent reading and reviewing, by day, the daily goal and the streak. One record per device per day, for every language
// at once: one streak counts reading in any language. Kept in localStorage (dushu.activity.v1, under no language's prefix, so
// deleting one library leaves it alone), and sent with whichever library syncs as 'l:act:<day>:<device>' (core/sync.ts), under
// that library's prefix like the rest of it. A hub keeps one copy of each day whichever library sends it, and gives it to every
// library (isReaderKey in syncKeys.ts, syncExchange.ts), so a device that only reads Japanese hears of the Spanish read on
// another. A device from before reads an 'l:' key only when it names a day, so it passes these over. A record only ever grows
// (seconds per language), so two copies merge by taking the larger of each.
import type { LangId } from '../lang/types';
import { ACT_PREFIX } from './syncKeys';

export const ACTIVITY_KEY = 'dushu.activity.v1';
/** Fired on window when the time or the goal changes here (or arrives from another device). */
export const ACTIVITY_EVENT = 'dushu:activity';
/** The goals to choose from, in minutes a day. */
export const GOALS = [5, 10, 15, 20, 30] as const;
export const DEFAULT_GOAL = 10;
/** Days kept on the device (the calendar and the best streak), and days sent with a sync. */
const KEEP_DAYS = 400;
export const SYNC_DAYS = 60;
const DAY_MAX = 86_400;

/** A device's day: seconds per language, the goal in minutes when it was last written, and when that was. */
export interface DayRecord { s: Record<string, number>; g: number; t: number }
interface Activity { device: string; days: Record<string, Record<string, DayRecord>> }

function storage(): Storage | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The day a time falls on, on this device's calendar: 2026-11-07. */
export function dayOf(t: number = Date.now()): string {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
/** The day `n` days after `day` (before, for a negative n). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayOf(new Date(y, m - 1, d + n, 12).getTime());
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEVICE_RE = /^[a-z0-9]{4,24}$/;

/** A record from storage or another device, or null when it is not one. */
export function cleanDay(v: unknown): DayRecord | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as { s?: unknown; g?: unknown; t?: unknown };
  if (!r.s || typeof r.s !== 'object' || Array.isArray(r.s)) return null;
  const s: Record<string, number> = {};
  for (const [lang, sec] of Object.entries(r.s as Record<string, unknown>)) {
    if (/^[a-z]{2}$/.test(lang) && typeof sec === 'number' && Number.isFinite(sec) && sec > 0) s[lang] = Math.min(DAY_MAX, Math.round(sec));
  }
  const g = typeof r.g === 'number' && (GOALS as readonly number[]).includes(r.g) ? r.g : DEFAULT_GOAL;
  const t = typeof r.t === 'number' && Number.isFinite(r.t) && r.t > 0 ? r.t : 0;
  return { s, g, t };
}

function read(store = storage()): Activity {
  let raw: unknown = null;
  try { raw = JSON.parse(store?.getItem(ACTIVITY_KEY) ?? 'null'); } catch { /* not ours: start again */ }
  const a = (raw && typeof raw === 'object' ? raw : {}) as { device?: unknown; days?: unknown };
  const out: Activity = { device: typeof a.device === 'string' && DEVICE_RE.test(a.device) ? a.device : '', days: {} };
  if (a.days && typeof a.days === 'object') {
    for (const [day, devices] of Object.entries(a.days as Record<string, unknown>)) {
      if (!DAY_RE.test(day) || !devices || typeof devices !== 'object') continue;
      for (const [device, rec] of Object.entries(devices as Record<string, unknown>)) {
        const r = DEVICE_RE.test(device) ? cleanDay(rec) : null;
        if (r) (out.days[day] ??= {})[device] = r;
      }
    }
  }
  if (!out.device) {
    out.device = Math.random().toString(36).slice(2, 12).padEnd(10, '0');
    write(out, store, false);
  }
  return out;
}

function write(a: Activity, store = storage(), announce = true): void {
  const oldest = addDays(dayOf(), -KEEP_DAYS);
  for (const day of Object.keys(a.days)) if (day < oldest) delete a.days[day];
  try { store?.setItem(ACTIVITY_KEY, JSON.stringify(a)); } catch { /* private mode or full: kept for this visit only */ }
  if (announce && typeof globalThis.dispatchEvent === 'function' && typeof Event === 'function') globalThis.dispatchEvent(new Event(ACTIVITY_EVENT));
}

/** Seconds spent today in `lang`, counted by the reading clock. Written with the goal in force, so a goal changed later does
 * not undo a day already won. */
export function addSeconds(lang: LangId, seconds: number, goal: number, t: number = Date.now(), store = storage()): void {
  if (!(seconds > 0)) return;
  const a = read(store);
  const day = dayOf(t);
  const mine = ((a.days[day] ??= {})[a.device] ??= { s: {}, g: goal, t });
  mine.s[lang] = Math.min(DAY_MAX, Math.round((mine.s[lang] ?? 0) + seconds));
  mine.g = goal;
  mine.t = Math.max(t, mine.t + 1);
  write(a, store);
}

/**
 * This device judged today by `goal` (the goal card drew it, the reading clock counted): keep a record of that goal for today,
 * even before any time is counted, so tomorrow the day is judged as it was shown (totals). It holds no time, so it is never
 * sent (syncRecords), and writing it fires no event (the card draws itself while it writes it).
 */
export function stampToday(goal: number, t: number = Date.now(), store = storage()): void {
  const a = read(store);
  const day = dayOf(t);
  if (a.days[day]?.[a.device]) return;
  (a.days[day] ??= {})[a.device] = { s: {}, g: goal, t };
  write(a, store, false);
}

/** The goal of today's record here changes with the goal, so today is judged by the new one. */
export function setTodayGoal(goal: number, t: number = Date.now(), store = storage()): void {
  const a = read(store);
  const mine = a.days[dayOf(t)]?.[a.device];
  if (!mine || mine.g === goal) return;
  mine.g = goal;
  mine.t = Math.max(t, mine.t + 1);
  write(a, store);
}

/** This device's id in the records it sends. */
export const deviceId = (store = storage()): string => read(store).device;

/** Every record from the last SYNC_DAYS days, this device's and the ones that came from others, for a sync. */
export function syncRecords(now: number = Date.now(), store = storage()): { day: string; device: string; rec: DayRecord }[] {
  if (!store) return [];
  const a = read(store);
  const from = addDays(dayOf(now), -SYNC_DAYS);
  const out: { day: string; device: string; rec: DayRecord }[] = [];
  for (const [day, devices] of Object.entries(a.days)) {
    if (day < from) continue;
    for (const [device, rec] of Object.entries(devices)) if (Object.keys(rec.s).length) out.push({ day, device, rec });
  }
  return out;
}

/** Takes in a record from another device (or this one's, echoed): the larger time of each language, the later goal. Returns
 * the record as it is kept here now. */
export function mergeRecord(day: string, device: string, theirs: DayRecord, store = storage()): DayRecord {
  if (!DAY_RE.test(day) || !DEVICE_RE.test(device)) return theirs;
  const a = read(store);
  const mine = a.days[day]?.[device];
  if (!mine) {
    (a.days[day] ??= {})[device] = { s: { ...theirs.s }, g: theirs.g, t: theirs.t };
    write(a, store);
    return theirs;
  }
  const merged = mergeDays(mine, theirs);
  if (JSON.stringify(merged) !== JSON.stringify(mine)) {
    a.days[day][device] = merged;
    write(a, store);
  }
  return merged;
}

export function mergeDays(a: DayRecord, b: DayRecord): DayRecord {
  const s: Record<string, number> = { ...a.s };
  for (const [lang, sec] of Object.entries(b.s)) s[lang] = Math.max(s[lang] ?? 0, sec);
  const later = b.t > a.t ? b : a;
  return { s, g: later.g, t: later.t };
}

export { ACT_PREFIX };
export const actKey = (day: string, device: string): string => `${ACT_PREFIX}${day}:${device}`;
export const isActKey = (key: string): boolean => key.startsWith(ACT_PREFIX);
export function parseActKey(key: string): { day: string; device: string } | null {
  const m = /^l:act:(\d{4}-\d{2}-\d{2}):([a-z0-9]{4,24})$/.exec(key);
  return m ? { day: m[1], device: m[2] } : null;
}

// ---------------------------------------------------------------- the streak ---

export interface DayTotal { day: string; seconds: number; goal: number; met: boolean }

function totals(a: Activity, goalNow: number, today: string): Map<string, DayTotal> {
  const out = new Map<string, DayTotal>();
  for (const [day, devices] of Object.entries(a.days)) {
    let seconds = 0;
    let others = 0;
    for (const [device, rec] of Object.entries(devices)) {
      for (const sec of Object.values(rec.s)) seconds += sec;
      if (device !== a.device) others = others ? Math.min(others, rec.g) : rec.g;
    }
    // Today by the goal set here now. A past day by the goal this device had that day (its own record, or the stamp the card
    // left), so a day shown as won at night is still won in the morning when another device had a harder goal; a day this
    // device never saw, by the easiest goal of the devices that read that day. (The goal syncs, core/plan.ts, so devices differ only
    // until the next sync, or when a day was judged before a change reached them.)
    const goal = day === today ? goalNow : devices[a.device]?.g ?? others;
    out.set(day, { day, seconds, goal, met: seconds >= goal * 60 });
  }
  return out;
}

export interface Streak {
  /** Seconds today, in every language on every device heard from. */
  today: number;
  goal: number;
  met: boolean;
  /** Days in a row the goal was met, up to today (or up to yesterday, while today is still open). */
  current: number;
  best: number;
  /** The last seven days, today last. */
  week: DayTotal[];
}

export function streak(goal: number, now: number = Date.now(), store = storage()): Streak {
  const a = read(store);
  const today = dayOf(now);
  const byDay = totals(a, goal, today);
  const met = (day: string) => !!byDay.get(day)?.met;
  let current = 0;
  for (let d = met(today) ? today : addDays(today, -1); met(d); d = addDays(d, -1)) current++;
  let best = current;
  let run = 0;
  let prev = '';
  for (const day of [...byDay.keys()].sort()) {
    if (!met(day)) { run = 0; prev = day; continue; }
    run = prev && addDays(prev, 1) === day && met(prev) ? run + 1 : 1;
    best = Math.max(best, run);
    prev = day;
  }
  const week: DayTotal[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = addDays(today, -i);
    // A day with no reading anywhere: out of the goal set now, like today.
    week.push(byDay.get(day) ?? { day, seconds: 0, goal, met: false });
  }
  const t = byDay.get(today);
  return { today: t?.seconds ?? 0, goal, met: met(today), current, best, week };
}
