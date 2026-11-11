// The daily goal and the streak (core/activity.ts, core/plan.ts): time adds up by day across languages and devices, a goal
// raised later does not undo a day already won, copies from two devices merge, and only a device never used is welcomed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_KEY, actKey, addDays, addSeconds, cleanDay, dayOf, deviceId, mergeRecord, parseActKey, setTodayGoal, stampToday, streak, syncRecords } from '../../src/core/activity';
import { getPlan, needsWelcome, setPlan } from '../../src/core/plan';

function memoryStorage(init: Record<string, string> = {}): Storage {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => { m.set(k, String(v)); },
    removeItem: (k: string) => { m.delete(k); },
    clear: () => m.clear(),
  };
}
const at = (day: string, hour = 12) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, hour).getTime(); };
const TODAY = '2026-11-07';

describe('the streak', () => {
  // The records are written for days in November 2026, and kept for 400 days before the clock: pinned, so the test does not
  // start failing in December 2027.
  beforeEach(() => { vi.setSystemTime(at(TODAY)); });
  afterEach(() => { vi.useRealTimers(); });

  it('adds up the day across languages, and counts days in a row', () => {
    const s = memoryStorage();
    for (const day of ['2026-11-03', '2026-11-04', '2026-11-05']) addSeconds('es', 700, 10, at(day), s);
    addSeconds('zh', 300, 10, at('2026-11-06'), s);
    addSeconds('es', 300, 10, at('2026-11-06'), s);
    let st = streak(10, at(TODAY), s);
    // Today is still open: the streak runs to yesterday.
    expect(st).toMatchObject({ today: 0, met: false, current: 4, best: 4 });
    addSeconds('ja', 599, 10, at(TODAY), s);
    expect(streak(10, at(TODAY), s).met).toBe(false);
    addSeconds('ja', 1, 10, at(TODAY), s);
    st = streak(10, at(TODAY), s);
    expect(st).toMatchObject({ today: 600, met: true, current: 5, best: 5 });
    expect(st.week.map((d) => d.met)).toEqual([false, false, true, true, true, true, true]);
  });

  it('keeps a day won under an easier goal, and a gap ends the streak', () => {
    const s = memoryStorage();
    addSeconds('fr', 320, 5, at('2026-11-04'), s);
    addSeconds('fr', 320, 5, at('2026-11-06'), s);
    // Raised to 20 minutes since: those days were won under 5.
    const st = streak(20, at(TODAY), s);
    expect(st.current).toBe(1);
    expect(st.best).toBe(1);
  });

  it('merges two copies of a day by the larger time of each language', () => {
    const s = memoryStorage();
    addSeconds('ru', 100, 10, at(TODAY), s);
    const me = deviceId(s);
    const merged = mergeRecord(TODAY, me, { s: { ru: 60, de: 50 }, g: 15, t: 1 }, s);
    expect(merged.s).toEqual({ ru: 100, de: 50 });
    expect(merged.g).toBe(10);
    mergeRecord(TODAY, 'otherdevice1', { s: { ru: 500 }, g: 10, t: at(TODAY) }, s);
    expect(streak(10, at(TODAY), s)).toMatchObject({ today: 650, met: true });
    const recs = syncRecords(at(TODAY), s);
    expect(recs.map((r) => r.device).sort()).toEqual([me, 'otherdevice1'].sort());
    // Older than the window: kept here, not sent.
    addSeconds('ru', 100, 10, at(addDays(TODAY, -90)), s);
    expect(syncRecords(at(TODAY), s)).toHaveLength(2);
  });

  it('names records by day and device, and refuses what is not one', () => {
    expect(parseActKey(actKey(TODAY, 'abc123def0'))).toEqual({ day: TODAY, device: 'abc123def0' });
    expect(parseActKey('l:2026-11-07:word')).toBeNull();
    expect(parseActKey('l:act:2026-11-07:Bad Device')).toBeNull();
    expect(cleanDay({ s: { es: -5, fr: 'x', de: 1e9 }, g: 7.5 })).toEqual({ s: { de: 86400 }, g: 10, t: 0 });
    // Any whole number of minutes up to four hours is a goal (Custom).
    expect(cleanDay({ s: { de: 60 }, g: 7 })?.g).toBe(7);
    expect(cleanDay({ s: { de: 60 }, g: 241 })?.g).toBe(10);
    expect(cleanDay('nope')).toBeNull();
    expect(dayOf(at('2026-01-02', 0))).toBe('2026-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('survives storage that is not its own', () => {
    const s = memoryStorage({ [ACTIVITY_KEY]: '{not json' });
    addSeconds('it', 30, 10, at(TODAY), s);
    expect(streak(10, at(TODAY), s).today).toBe(30);
  });
});

describe('two devices with different goals', () => {
  beforeEach(() => { vi.setSystemTime(at(TODAY)); });
  afterEach(() => { vi.useRealTimers(); });

  const DAY = '2026-11-09';
  const NIGHT = at(DAY, 21);
  const MORNING = at(addDays(DAY, 1), 9);
  /** Every record one device would send, taken in by the other (core/sync.ts). */
  const sync = (from: Storage, to: Storage, t: number) => { for (const r of syncRecords(t, from)) mergeRecord(r.day, r.device, r.rec, to); };
  /** What a device shows of `DAY` at time `t`: the goal card stamps its goal for today, then draws the streak. */
  const shows = (goal: number, t: number, store: Storage) => {
    vi.setSystemTime(t);
    stampToday(goal, t, store);
    const st = streak(goal, t, store);
    return { met: st.week.find((d) => d.day === DAY)!.met, current: st.current, best: st.best };
  };

  it('A: a day read on the device with the harder goal stays won on the other the next morning', () => {
    const phone = memoryStorage();
    const laptop = memoryStorage();
    addSeconds('es', 720, 20, at(DAY, 15), laptop);
    sync(laptop, phone, at(DAY, 15));
    const night = shows(10, NIGHT, phone);
    expect(night).toEqual({ met: true, current: 1, best: 1 });
    expect(shows(10, MORNING, phone)).toEqual(night);
    // The laptop, at 20 minutes, never called it won.
    expect(shows(20, NIGHT, laptop).met).toBe(false);
    expect(shows(20, MORNING, laptop).met).toBe(false);
  });

  it('A2: a run of days on the phone keeps the day read on the laptop', () => {
    const phone = memoryStorage();
    const laptop = memoryStorage();
    for (let i = 3; i >= 1; i--) addSeconds('es', 600, 10, at(addDays(DAY, -i), 18), phone);
    addSeconds('es', 720, 20, at(DAY, 15), laptop);
    sync(laptop, phone, at(DAY, 15));
    const night = shows(10, NIGHT, phone);
    expect(night).toEqual({ met: true, current: 4, best: 4 });
    expect(shows(10, MORNING, phone)).toEqual(night);
  });

  it('B: a day each device read toward its own goal is judged the same before and after midnight on both', () => {
    const phone = memoryStorage();
    const laptop = memoryStorage();
    addSeconds('es', 300, 20, at(DAY, 10), phone);
    addSeconds('es', 480, 10, at(DAY, 12), laptop);
    sync(phone, laptop, at(DAY, 13));
    sync(laptop, phone, at(DAY, 13));
    const phoneNight = shows(20, NIGHT, phone);
    const laptopNight = shows(10, NIGHT, laptop);
    expect(phoneNight.met).toBe(false);
    expect(laptopNight.met).toBe(true);
    expect(shows(20, MORNING, phone)).toEqual(phoneNight);
    expect(shows(10, MORNING, laptop)).toEqual(laptopNight);
  });

  it('keeps the stamp on this device only, and moves it with the goal today', () => {
    const s = memoryStorage();
    stampToday(15, NIGHT, s);
    expect(syncRecords(NIGHT, s)).toEqual([]);
    expect(streak(15, NIGHT, s).week.at(-1)).toMatchObject({ day: DAY, seconds: 0, goal: 15, met: false });
    setTodayGoal(5, NIGHT + 1000, s);
    expect(streak(30, MORNING, s).week.find((d) => d.day === DAY)!.goal).toBe(5);
    // A second stamp does not change the goal the day was shown with.
    stampToday(30, NIGHT + 2000, s);
    expect(streak(30, MORNING, s).week.find((d) => d.day === DAY)!.goal).toBe(5);
  });

  it('gives the days with no reading the goal set now, not ten minutes', () => {
    const st = streak(20, at(TODAY), memoryStorage());
    expect(st.week.map((d) => d.goal)).toEqual([20, 20, 20, 20, 20, 20, 20]);
  });
});

describe('the welcome screen', () => {
  it('greets a device never used, once, and never one already reading', () => {
    const fresh = memoryStorage();
    expect(needsWelcome(fresh)).toBe(true);
    setPlan({ langs: ['es', 'zh'], goal: 15, welcomed: 1 }, fresh);
    expect(needsWelcome(fresh)).toBe(false);
    expect(getPlan(fresh)).toMatchObject({ langs: ['es', 'zh'], goal: 15, welcomed: 1 });
    expect(getPlan(fresh).goalAt).toBeGreaterThan(0);
    const reader = memoryStorage({ 'dushu.settings.v1': '{}' });
    expect(needsWelcome(reader)).toBe(false);
    expect(getPlan(reader).welcomed).toBeGreaterThan(0);
    expect(getPlan(memoryStorage({ 'dushu.plan.v1': '{"langs":["xx","fr"],"goal":0}' }))).toEqual({ langs: ['fr'], goal: 10, goalAt: 0, welcomed: 0 });
  });
});
