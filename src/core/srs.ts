// Spaced repetition: deterministic SM-2 with learning steps. Contract: ARCHITECTURE.md §4.6.
//
// A card with interval 0 is in learning (new, or relearning after a lapse). Learning steps are
// 1 minute then 10 minutes; the step is recovered from the gap between `last` and `due`, so
// SrsState needs no extra field. Graduating gives 1 day (Good) or 4 days (Easy).
import type { Grade, SrsState } from '../types';

export const MINUTE = 60_000;
export const DAY = 86_400_000;
const STEP_1 = 1 * MINUTE;
const STEP_2 = 10 * MINUTE;
const HARD_FIRST_STEP = 6 * MINUTE; // halfway between the two steps, rounded like Anki
const GRADUATE_GOOD_DAYS = 1;
const GRADUATE_EASY_DAYS = 4;
const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 36_500;

export function newSrs(now: number): SrsState {
  return { due: now, interval: 0, ease: 2.5, reps: 0, lapses: 0 };
}

/** True while the card is new or relearning (still on minute steps). */
export function isLearning(s: SrsState): boolean { return s.interval <= 0; }

/** 0 = first learning step (1 min), 1 = second (10 min). */
function learningStep(s: SrsState): 0 | 1 {
  return s.last !== undefined && s.due - s.last >= STEP_2 ? 1 : 0;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const clampEase = (n: number) => Math.max(MIN_EASE, round2(n));

function graduate(s: SrsState, days: number, now: number): SrsState {
  return { ...s, interval: days, due: now + days * DAY, reps: s.reps + 1, last: now };
}

function stay(s: SrsState, delay: number, now: number): SrsState {
  return { ...s, interval: 0, due: now + delay, last: now };
}

export function schedule(s: SrsState, grade: Grade, now: number): SrsState {
  if (isLearning(s)) {
    const step = learningStep(s);
    switch (grade) {
      case 0: return stay(s, STEP_1, now);
      case 1: return stay(s, step === 0 ? HARD_FIRST_STEP : STEP_2, now);
      case 2: return step === 0 ? stay(s, STEP_2, now) : graduate(s, GRADUATE_GOOD_DAYS, now);
      default: return graduate(s, GRADUATE_EASY_DAYS, now);
    }
  }
  const iv = s.interval;
  const hard = Math.max(iv + 1, Math.round(iv * 1.2));
  const good = Math.max(hard + 1, Math.round(iv * s.ease));
  const easy = Math.max(good + 1, Math.round(iv * s.ease * 1.3));
  const review = (days: number, ease: number): SrsState => ({
    ...s,
    interval: Math.min(days, MAX_INTERVAL_DAYS),
    ease,
    due: now + Math.min(days, MAX_INTERVAL_DAYS) * DAY,
    reps: s.reps + 1,
    last: now,
  });
  switch (grade) {
    case 0: return { ...stay(s, STEP_1, now), ease: clampEase(s.ease - 0.2), lapses: s.lapses + 1 };
    case 1: return review(hard, clampEase(s.ease - 0.15));
    case 2: return review(good, s.ease);
    default: return review(easy, clampEase(s.ease + 0.15));
  }
}

/** "10m", "3h", "4d", "1.5mo", "2y": a short label for a delay in ms. */
export function formatInterval(ms: number): string {
  if (ms < MINUTE) return '<1m';
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(ms / (60 * MINUTE));
  if (hours < 24) return `${hours}h`;
  const days = Math.round(ms / DAY);
  if (days < 31) return `${days}d`;
  const months = Math.round((ms / DAY / 30.4) * 10) / 10;
  if (months < 12) return `${months}mo`;
  return `${Math.round((ms / DAY / 365) * 10) / 10}y`;
}

/** What each grade button would schedule, for the review UI: { again:'1m', hard:'6m', good:'10m', easy:'4d' }. */
export function nextIntervals(s: SrsState, now: number): Record<'again' | 'hard' | 'good' | 'easy', string> {
  const label = (g: Grade) => formatInterval(schedule(s, g, now).due - now);
  return { again: label(0), hard: label(1), good: label(2), easy: label(3) };
}
