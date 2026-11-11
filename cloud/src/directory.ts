// The directory: who to look at when. One Durable Object (idFromName('directory')) lists every signed-in account by its id and
// time zone, nothing else (no email address, no name). The hourly cron asks it to `run`: every account whose local hour is
// SEND_HOUR and that was not looked at in the last CHECK_GAP_MS is queued and marked, and the directory's alarm works through the
// queue FOLLOWUP_BATCH accounts at a time, asking each account's own Durable Object to do its follow-up (followups.ts).
//
// Why this shape: on the Workers Free plan an invocation has about 10 ms of CPU time and 50 subrequests. One cron invocation
// could not open every account, so it only reads this small table; each alarm invocation then makes FOLLOWUP_BATCH requests
// (under the 50) and arms the next alarm while the queue is not empty; and each account's follow-up runs in its own invocation,
// where the counting, the encryption and the requests to Resend and the push services happen. The table is tiny: an id, a zone
// and a time per account.
//
// An account adds itself when someone signs in (an email code, a passkey made or used) and again on a sync when its time zone
// changes or a day has passed (AccountCore directoryNote), so one the directory lost comes back on its own. Deleting the
// account takes it out; an account found signed out everywhere at its run is taken out too, and comes back when it signs in.
import { SEND_HOUR, localHour, validTimeZone } from './followups';

/** Accounts asked per alarm: each is one subrequest, well under the free plan's 50. */
export const FOLLOWUP_BATCH = 25;
/** An account is looked at once a day: not again within this, so a cron that runs twice in an hour (or DST) sends nothing twice. */
export const CHECK_GAP_MS = 20 * 3_600_000;
const ACCOUNT_ID = /^[0-9a-f]{64}$/;

export interface DirectoryStore {
  /** Adds the account, or moves it to another zone; when it was last looked at stays. */
  put(id: string, tz: string): void;
  /** Forgets the account, and takes it out of the queue. */
  drop(id: string): void;
  /** The time zones anyone is in. */
  zones(): string[];
  /** Queues everyone in `tz` not looked at since `before`, and marks them looked at `now`. Returns how many. */
  queueZone(tz: string, before: number, now: number): number;
  /** The next `n` queued, oldest first. */
  next(n: number): string[];
  /** Takes these out of the queue. */
  done(ids: string[]): void;
  pending(): number;
  /** One account as kept (tests). */
  person(id: string): { tz: string; checked: number } | undefined;
}

export class DirectoryCore {
  constructor(private readonly store: DirectoryStore) {}

  /** An account and its zone; a zone that is not one counts as UTC. */
  put(id: string, tz: string): void {
    if (!ACCOUNT_ID.test(id)) return;
    this.store.put(id, validTimeZone(tz) ? tz : 'UTC');
  }

  drop(id: string): void {
    if (ACCOUNT_ID.test(id)) this.store.drop(id);
  }

  /**
   * The hourly run: queues everyone whose local hour is SEND_HOUR now. A zone is asked once, not each account: there are a few
   * dozen zones at most, and Intl is the slow part.
   */
  run(now: number): number {
    let queued = 0;
    for (const tz of this.store.zones()) {
      if (localHour(tz, now) === SEND_HOUR) queued += this.store.queueZone(tz, now - CHECK_GAP_MS, now);
    }
    return queued;
  }

  next(n = FOLLOWUP_BATCH): string[] { return this.store.next(n); }
  done(ids: string[]): void { this.store.done(ids); }
  pending(): number { return this.store.pending(); }
  person(id: string): { tz: string; checked: number } | undefined { return this.store.person(id); }
}

/** The directory in memory, for tests. */
export function memoryDirectory(): DirectoryStore {
  const people = new Map<string, { tz: string; checked: number }>();
  const queue = new Set<string>();
  return {
    put: (id, tz) => { people.set(id, { tz, checked: people.get(id)?.checked ?? 0 }); },
    drop: (id) => { people.delete(id); queue.delete(id); },
    zones: () => [...new Set([...people.values()].map((p) => p.tz))],
    queueZone: (tz, before, now) => {
      let n = 0;
      for (const [id, p] of people) {
        if (p.tz !== tz || p.checked >= before) continue;
        p.checked = now;
        if (!queue.has(id)) { queue.add(id); n++; }
      }
      return n;
    },
    next: (n) => [...queue].slice(0, n),
    done: (ids) => { for (const id of ids) queue.delete(id); },
    pending: () => queue.size,
    person: (id) => { const p = people.get(id); return p ? { ...p } : undefined; },
  };
}
