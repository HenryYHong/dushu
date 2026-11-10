// Review session state: which card is next, what has been graded, and the summary numbers.
// Pure logic; the screen supplies the clock and does the actual store writes.
import type { Grade, VocabItem } from '../../types';
import { tt, uiLocale } from '../../i18n';

/** A card that comes back within this long is shown again in the same session. */
export const REQUEUE_WITHIN_MS = 20 * 60_000;

export interface SessionSummary {
  /** Grading events, including repeats of the same card. */
  reviews: number;
  /** Distinct cards that left the queue. */
  cards: number;
  grades: [number, number, number, number];
  /** Share of grades that were not Again, 0-1. */
  recall: number;
}

export class ReviewSession {
  private queue: VocabItem[];
  readonly total: number;
  private finished = new Set<string>();
  private counts: [number, number, number, number] = [0, 0, 0, 0];

  constructor(items: VocabItem[]) {
    this.queue = items.slice().sort((a, b) => a.srs.due - b.srs.due);
    this.total = this.queue.length;
  }

  get current(): VocabItem | undefined { return this.queue[0]; }
  get remaining(): number { return this.queue.length; }
  get done(): number { return this.finished.size; }
  get isOver(): boolean { return this.queue.length === 0; }

  /** Record a grade. `updated` is the card as the store rescheduled it. */
  answer(grade: Grade, updated: VocabItem, now: number): void {
    const cur = this.queue.shift();
    if (!cur) return;
    this.counts[grade]++;
    if (updated.srs.due - now <= REQUEUE_WITHIN_MS) {
      this.queue.push(updated);
    } else {
      this.finished.add(cur.id);
    }
  }

  /** Drop the current card without grading (it was removed elsewhere). */
  skip(): void {
    const cur = this.queue.shift();
    if (cur) this.finished.add(cur.id);
  }

  summary(): SessionSummary {
    const reviews = this.counts.reduce((a, b) => a + b, 0);
    return {
      reviews,
      cards: this.finished.size,
      grades: [...this.counts] as [number, number, number, number],
      recall: reviews ? (reviews - this.counts[0]) / reviews : 0,
    };
  }
}

/**
 * "now", "in 3 hours": when the next card is due, for "Your next card is due {when}." The counts are Intl's relative times in
 * the app's language ("dans 3 heures", "3 時間後"), which are made to sit inside a sentence.
 */
export function describeNextDue(due: number, now: number): string {
  const ms = due - now;
  if (ms <= 0) return tt('now');
  if (ms < 60_000) return tt('in under a minute');
  const rel = new Intl.RelativeTimeFormat(uiLocale(), { numeric: 'always' });
  const mins = Math.round(ms / 60_000);
  if (mins < 60) return rel.format(mins, 'minute');
  const hours = Math.round(ms / 3_600_000);
  if (hours < 24) return rel.format(hours, 'hour');
  return rel.format(Math.round(ms / 86_400_000), 'day');
}
