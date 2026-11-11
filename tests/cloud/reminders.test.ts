// Follow-ups through the sync server (cloud/src/followups.ts, directory.ts, push.ts): the hourly cron and the directory pick
// the accounts whose local time is 6 PM; a welcome email a day or two after an account with an email is made; a review reminder
// when enough saved words are due and the person has been away, by push before email; the share of the day's emails the
// follow-ups may use; the unsubscribe link; and what the app tells the account about itself on each sync. The Worker runs in
// process (tests/cloud/helpers.ts), with a fake mail service and a fake push service; nothing is sent anywhere.
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccountCore, memoryStore, wordDueAt } from '../../cloud/src/account';
import { DirectoryCore, memoryDirectory } from '../../cloud/src/directory';
import { EMAIL_GAP_MS, localHour, mailText, reminderEmail, welcomeEmail } from '../../cloud/src/followups';
import { MAIL_CATALOG } from '../../cloud/src/mailCatalog';
import type { Mailer } from '../../cloud/src/mail';
import { b64url } from '../../cloud/src/push';
import { sqlDirectory, sqlStore } from '../../cloud/src/sqlStore';
import { directoryAlarm, type Env } from '../../cloud/src/worker';
import { cleanVocab } from '../../src/store/index';
import { fakeAuthenticator, type CreateOptions } from './authenticator';
import { cloud, hasSqlite, sqliteCli } from './helpers';
import { checkVapid, decryptPush, newReceiver, subscriptionOf, type Receiver } from './pushReceiver';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** 6 PM UTC on a day of November 2026 (after the US and Europe left summer time). */
const sixPm = (day: number) => Date.UTC(2026, 10, day, 18);
const APP = 'https://henryyhong.com/dushu/';

let clock = 0;
beforeEach(() => {
  clock = Date.UTC(2026, 10, 1, 9);
  vi.spyOn(Date, 'now').mockImplementation(() => clock);
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

type Mail = Parameters<Mailer['send']>[0];
interface PushSeen { url: string; headers: Headers; body: Uint8Array }

/** A VAPID_KEYS secret as scripts/make-vapid.mjs makes one. */
async function vapidSecret(): Promise<string> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  return JSON.stringify({ publicKey: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey) as ArrayBuffer)), privateKey: (await crypto.subtle.exportKey('jwk', pair.privateKey)).d });
}

/** The server with a mail service and a push service that only record what they are given (and answer `status(endpoint)`). */
async function server(extra: Partial<Env> = {}, status: (endpoint: string) => number = () => 201) {
  const mail: Mail[] = [];
  const pushes: PushSeen[] = [];
  // Notes the most emails ever being sent at the same moment (Resend takes a couple of requests a second).
  let sending = 0;
  let mostAtOnce = 0;
  const mailer: Mailer = {
    send: async (m) => {
      mostAtOnce = Math.max(mostAtOnce, ++sending);
      mail.push(m);
      await new Promise((done) => setTimeout(done, 0));
      sending--;
    },
  };
  const pushFetch = (async (url: string, init: RequestInit) => {
    pushes.push({ url, headers: new Headers(init.headers), body: init.body as Uint8Array });
    return new Response(null, { status: status(url) });
  }) as unknown as typeof fetch;
  const c = cloud({ MAIL_MODE: undefined, mailer, pushFetch, VAPID_KEYS: await vapidSecret(), ...extra } as Partial<Env>);
  /** The cron at `t`, with the clock there. */
  const cronAt = async (t: number) => { clock = t; await c.cron(t); };
  /** Follow-up emails only (not sign-in codes). */
  const followups = () => mail.filter((m) => !/sign-in code/.test(m.subject));
  return { ...c, mail, pushes, cronAt, followups, mostAtOnce: () => mostAtOnce };
}

/** Signs in with the code from the email the fake mail service was given (helpers' signedIn reads it from the log mode). */
async function signedIn(c: Server, email = 'reader@example.com'): Promise<string> {
  expect((await c.post('/auth/code', { email })).status).toBe(200);
  const code = /^(\d{6}) is your/.exec(c.mail.at(-1)!.subject)![1];
  const res = await c.post('/auth/verify', { email, code });
  expect(res.status).toBe(200);
  return (await res.json() as { token: string }).token;
}
type Server = Awaited<ReturnType<typeof server>>;

const idOf = (token: string) => token.split('.')[0];
const auth = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });
const reminders = async (c: Server, token: string) => (await c.call('/me/reminders', auth(token))).json();

/** A saved word as the app syncs it, due at `due`. */
const word = (id: string, due: number, addedAt = Date.UTC(2026, 9, 1)) => ({ id, simp: id, trad: id, pinyin: '', gloss: 'x', addedAt, srs: { due, interval: 1, ease: 2.5, reps: 1, lapses: 0, last: due - DAY } });
async function save(c: Server, token: string, words: Record<string, unknown>[], lang?: string) {
  const prefix = lang ? `@${lang}:` : '';
  const res = await c.post('/sync', { ...(lang ? { lang } : {}), changes: words.map((w) => ({ key: `${prefix}v:${w.id}`, at: 1, data: w })) }, token);
  expect(res.status).toBe(200);
}
/** The link at the bottom of a follow-up email, as the path and query this test server answers. */
const unsubscribePath = (m: Mail) => {
  const url = new URL(/<(.+)>/.exec(m.headers!['List-Unsubscribe'])![1]);
  return { url, path: `${url.pathname}${url.search}` };
};

describe('the directory', () => {
  const id = (n: number) => n.toString(16).padStart(64, '0');
  const check = (d: DirectoryCore) => {
    d.put(id(1), 'Asia/Tokyo');
    d.put(id(2), 'America/New_York');
    d.put(id(3), 'Mars/Olympus_Mons');
    d.put(id(4), 'UTC');
    d.put('not an account', 'UTC');
    expect(d.person(id(3))?.tz).toBe('UTC');
    expect(d.person('not an account')).toBeUndefined();
    // 9 AM UTC is 6 PM in Tokyo: only Tokyo, and only once however often the cron runs that hour.
    expect(d.run(Date.UTC(2026, 10, 11, 9))).toBe(1);
    expect(d.run(Date.UTC(2026, 10, 11, 9, 30))).toBe(0);
    expect(d.next(25)).toEqual([id(1)]);
    expect(d.run(Date.UTC(2026, 10, 11, 17))).toBe(0);
    // 6 PM UTC: the UTC account and the one whose zone is not a zone.
    expect(d.run(Date.UTC(2026, 10, 11, 18))).toBe(2);
    // 11 PM UTC is 6 PM in New York in November.
    expect(d.run(Date.UTC(2026, 10, 11, 23))).toBe(1);
    expect(d.pending()).toBe(4);
    expect(new Set(d.next(25))).toEqual(new Set([id(1), id(2), id(3), id(4)]));
    d.done([id(1), id(3)]);
    expect(d.next(25).sort()).toEqual([id(2), id(4)]);
    // Moving zones keeps the day's mark: nothing twice in one day.
    d.put(id(1), 'UTC');
    expect(d.run(Date.UTC(2026, 10, 11, 18))).toBe(0);
    // The next day, Tokyo's (now UTC's) 6 PM again.
    d.done([id(2), id(4)]);
    expect(d.run(Date.UTC(2026, 10, 12, 18))).toBe(3);
    d.drop(id(4));
    expect(d.next(25).sort()).toEqual([id(1), id(3)]);
    expect(d.person(id(4))).toBeUndefined();
  };

  it('queues each account once a day, when it is 6 PM where it is', () => {
    check(new DirectoryCore(memoryDirectory()));
    expect(localHour('Asia/Kolkata', Date.UTC(2026, 10, 11, 13))).toBe(18);
    expect(localHour('Not/AZone', Date.UTC(2026, 10, 11, 13))).toBe(13);
  });

  it.skipIf(!hasSqlite)('does the same in its SQLite database', () => {
    check(new DirectoryCore(sqlDirectory(sqliteCli(join(mkdtempSync(join(tmpdir(), 'dushu-dir-')), 'directory.sqlite')))));
  });

  it('works through a long queue a batch per alarm, every account once', async () => {
    const c = await server();
    const tokens: string[] = [];
    for (let i = 0; i < 30; i++) tokens.push(await signedIn(c, `reader${i}@example.com`));
    for (const t of tokens) expect(c.directory.person(idOf(t))?.tz).toBe('UTC');
    // Two days later every account is in its welcome window: 30 welcomes, more than one batch of 25.
    await c.cronAt(sixPm(2));
    expect(c.followups().map((m) => m.to).sort()).toEqual(tokens.map((_, i) => `reader${i}@example.com`).sort());
    expect(c.directory.pending()).toBe(0);
    // One email at a time, and a pause after each: Resend refuses more than a couple of requests a second.
    expect(c.mostAtOnce()).toBe(1);
    expect(c.pauses).toEqual(Array(30).fill(EMAIL_GAP_MS));
    expect(EMAIL_GAP_MS).toBeGreaterThanOrEqual(500);
  });

  it('takes a batch off the queue before asking its accounts, so an alarm cut off and run again asks none of them twice', async () => {
    const d = new DirectoryCore(memoryDirectory());
    const ids = Array.from({ length: 30 }, (_, i) => (i + 1).toString(16).padStart(64, '0'));
    for (const id of ids) d.put(id, 'UTC');
    expect(d.run(sixPm(11))).toBe(30);
    // Accounts that never answer: the alarm is cut off while it waits (a deploy, or too long), and Cloudflare runs it again.
    const asked: string[] = [];
    const env = {
      ACCOUNTS: {
        idFromName: () => { throw new Error('unused'); },
        idFromString: (id: string) => ({ toString: () => id }),
        get: (id: { toString(): string }) => ({ fetch: () => { asked.push(id.toString()); return new Promise<Response>(() => {}); } }),
      },
    } as unknown as Env;
    void directoryAlarm(d, env, () => {});
    void directoryAlarm(d, env, () => {});
    await Promise.resolve();
    // Each run asks the first account of its own batch and waits on it; the second never starts on the first one's batch again.
    expect(asked).toEqual([ids[0], ids[25]]);
    expect(d.pending()).toBe(0);
  });
});

describe('the welcome email', () => {
  it('goes once, at the first 6 PM at least 20 hours after the account was made, in the app’s words', async () => {
    const c = await server();
    clock = Date.UTC(2026, 10, 10, 12);
    const token = await signedIn(c, 'reader@example.com');
    await c.cronAt(Date.UTC(2026, 10, 10, 17));
    await c.cronAt(sixPm(10));
    expect(c.followups()).toEqual([]);
    await c.cronAt(sixPm(11));
    const [welcome] = c.followups();
    expect(welcome.to).toBe('reader@example.com');
    expect(welcome.subject).toBe('Welcome to LinguPengu');
    const { url } = unsubscribePath(welcome);
    expect(url.origin + url.pathname).toBe('https://dushu-sync.henryhong.workers.dev/unsubscribe');
    expect(url.searchParams.get('a')).toBe(idOf(token));
    expect(welcome.headers).toEqual({ 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(welcome.text).toBe([
      'Thanks for trying LinguPengu!',
      '',
      'A few things that help:',
      '• Tap any word in a book to see what it means, and tap the star to save it.',
      '• Review your saved words for a few minutes a day. Each one comes back right before you would forget it.',
      '• Your books and words are saved to your account, so you can pick up on any device.',
      '',
      `Open LinguPengu: ${APP}`,
      '',
      'Happy reading,',
      'Pengu',
      '',
      '--',
      'You get this email because you signed in to LinguPengu with this address.',
      `Turn off these emails: ${url}`,
    ].join('\n'));
    await c.cronAt(sixPm(12));
    await c.cronAt(sixPm(13));
    expect(c.followups()).toHaveLength(1);
  });

  it('is never sent past three days, nor to an account with emails off or no email at all', async () => {
    const c = await server({ OWNER_EMAILS: 'owner@example.com' });
    clock = Date.UTC(2026, 10, 10, 17);
    await signedIn(c, 'late@example.com');
    const owner = await signedIn(c, 'owner@example.com');
    const amy = await joinWithPasskey(c, owner);
    expect(await reminders(c, amy)).toEqual({ email: false, canEmail: false, devices: 0 });
    expect(await (await c.post('/me/reminders', { email: true }, amy)).json()).toEqual({ email: false, canEmail: false, devices: 0 });
    clock = Date.UTC(2026, 10, 10, 18);
    await signedIn(c, 'ontime@example.com');
    const off = await signedIn(c, 'off@example.com');
    expect(await (await c.post('/me/reminders', { email: false }, off)).json()).toEqual({ email: false, canEmail: true, devices: 0 });
    // The first 6 PM the directory runs is 73 hours after the first accounts were made (too late), and 72 after the others.
    await c.cronAt(Date.UTC(2026, 10, 13, 18));
    expect(c.followups().map((m) => m.to)).toEqual(['ontime@example.com']);
  });
});

/** An account made with a passkey on the owner's invite (no email): its token. */
async function joinWithPasskey(c: Server, owner: string, name = 'Amy'): Promise<string> {
  const invite = (await (await c.post('/invites', { label: 'Class', max: 5 }, owner)).json() as { invite: { token: string } }).invite.token;
  const options = await (await c.post('/auth/passkey/join-options', { invite, name })).json() as CreateOptions & { challenge: string };
  const response = await fakeAuthenticator().create(options, 'https://henryyhong.com');
  return (await (await c.post('/auth/passkey/join', { challenge: options.challenge, response })).json() as { token: string }).token;
}

describe('the review reminder', () => {
  /** An account made on November 1 (its welcome window long past by the 5th) with `due` words due on the 2nd. */
  async function reader(c: Server, email = 'reader@example.com', due = 5) {
    clock = Date.UTC(2026, 10, 1, 9);
    const token = await signedIn(c, email);
    await save(c, token, Array.from({ length: due }, (_, i) => word(`w${i}`, Date.UTC(2026, 10, 2))));
    return token;
  }

  it('waits for five words due, three days away, and a week since the last one', async () => {
    const c = await server();
    const token = await reader(c, 'reader@example.com', 3);
    // A Japanese word counts with the Chinese ones; one due later, one deleted, and a known word do not.
    await save(c, token, [word('食べる', Date.UTC(2026, 10, 2))], 'ja');
    await save(c, token, [word('later', Date.UTC(2026, 11, 30))]);
    expect((await c.post('/sync', { changes: [{ key: 'v:gone', at: 2, data: null }, { key: 'k:known', at: 2, data: {} }] }, token)).status).toBe(200);
    await c.cronAt(sixPm(5));
    expect(c.followups()).toEqual([]);
    // The fifth word, saved on the 6th: the app was used, so the three days start again.
    clock = Date.UTC(2026, 10, 6, 10);
    await save(c, token, [word('fifth', Date.UTC(2026, 10, 6))]);
    await c.cronAt(sixPm(6));
    await c.cronAt(sixPm(8));
    expect(c.followups()).toEqual([]);
    await c.cronAt(sixPm(9));
    const [mail] = c.followups();
    expect(mail.subject).toBe('5 words are ready to review');
    const { url } = unsubscribePath(mail);
    expect(mail.text).toBe([
      'You have 5 saved words ready to review. A few minutes now keeps them fresh.',
      '',
      `Review now: ${APP}#/review`,
      '',
      'Happy reading,',
      'Pengu',
      '',
      '--',
      'You get this email because you signed in to LinguPengu with this address.',
      `Turn off these emails: ${url}`,
    ].join('\n'));
    // Not again within the week, then again once it has passed.
    for (const day of [10, 12, 15]) await c.cronAt(sixPm(day));
    expect(c.followups()).toHaveLength(1);
    await c.cronAt(sixPm(16));
    expect(c.followups()).toHaveLength(2);
  });

  it('comes a week later even when that evening’s run reaches the account sooner, or summer time has started', async () => {
    const c = await server();
    await reader(c);
    // The queue reaches this account a minute and a half after the cron.
    clock = sixPm(5) + 90_000;
    await c.cron(sixPm(5));
    expect(c.followups()).toHaveLength(1);
    // A week later it is first in line: 90 seconds short of seven days, still the week's reminder (not the eighth day's).
    for (const day of [6, 7, 8, 9, 10, 11]) await c.cronAt(sixPm(day));
    expect(c.followups()).toHaveLength(1);
    await c.cronAt(sixPm(12));
    expect(c.followups()).toHaveLength(2);

    // New York's 6 PM on March 7, 2027 (EST) and a week later on the 14th (EDT, from that morning): 23 hours apart in UTC, short of
    // a whole week by one.
    const ny = await server();
    clock = Date.UTC(2027, 2, 1, 15);
    const token = await signedIn(ny);
    expect((await ny.post('/sync', { about: { tz: 'America/New_York', locale: 'en' }, changes: Array.from({ length: 5 }, (_, i) => ({ key: `v:w${i}`, at: 1, data: word(`w${i}`, Date.UTC(2027, 2, 2)) })) }, token)).status).toBe(200);
    await ny.cronAt(Date.UTC(2027, 2, 7, 23));
    expect(ny.followups()).toHaveLength(1);
    for (let day = 8; day <= 13; day++) await ny.cronAt(Date.UTC(2027, 2, day, 23));
    expect(ny.followups()).toHaveLength(1);
    expect(localHour('America/New_York', Date.UTC(2027, 2, 14, 22))).toBe(18);
    await ny.cronAt(Date.UTC(2027, 2, 14, 22));
    expect(ny.followups()).toHaveLength(2);
  });

  it('goes by push to every device that turned it on, before email, and forgets a device its push service says is gone', async () => {
    let gone = 'https://updates.push.services.mozilla.com/wpush/v2/laptop';
    const c = await server({}, (endpoint) => (endpoint === gone ? 410 : 201));
    const token = await reader(c, 'reader@example.com', 6);
    const phone = await newReceiver();
    const laptop = await newReceiver();
    const devices: Record<string, Receiver> = { 'https://fcm.googleapis.com/fcm/send/phone': phone, [gone]: laptop };
    for (const [endpoint, r] of Object.entries(devices)) {
      expect(await (await c.post('/me/push', { subscription: subscriptionOf(r, endpoint) }, token)).json()).toMatchObject({ ok: true });
    }
    expect(await reminders(c, token)).toEqual({ email: true, canEmail: true, devices: 2 });
    await c.cronAt(sixPm(5));
    expect(c.followups()).toEqual([]);
    expect(c.pushes.map((p) => p.url).sort()).toEqual(Object.keys(devices).sort());
    const delivered = c.pushes.find((p) => p.url.includes('phone'))!;
    expect(JSON.parse(await decryptPush(delivered.body, phone))).toEqual({ title: 'LinguPengu', body: '6 words are ready to review.', url: `${APP}#/review`, tag: 'review' });
    expect([delivered.headers.get('TTL'), delivered.headers.get('Urgency'), delivered.headers.get('Content-Encoding')]).toEqual(['86400', 'normal', 'aes128gcm']);
    const { claims } = await checkVapid(delivered.headers.get('Authorization')!);
    expect(claims).toMatchObject({ aud: 'https://fcm.googleapis.com', sub: 'https://henryyhong.com/dushu/' });
    expect(claims.exp * 1000 - sixPm(5)).toBeLessThanOrEqual(DAY);
    expect(await reminders(c, token)).toEqual({ email: true, canEmail: true, devices: 1 });
    // Push is not Resend: the directory goes straight on to the next account.
    expect(c.pauses).toEqual([]);

    // A week later the phone is gone too: nobody took it, so it goes by email.
    gone = 'https://fcm.googleapis.com/fcm/send/phone';
    await c.cronAt(sixPm(12));
    expect(c.followups().map((m) => m.subject)).toEqual(['6 words are ready to review']);
    expect(c.pauses).toEqual([EMAIL_GAP_MS]);
    expect(await reminders(c, token)).toEqual({ email: true, canEmail: true, devices: 0 });
  });

  it('goes to an account with no email by push only', async () => {
    const c = await server({ OWNER_EMAILS: 'owner@example.com' });
    clock = Date.UTC(2026, 10, 1, 9);
    const owner = await signedIn(c, 'owner@example.com');
    const amy = await joinWithPasskey(c, owner);
    expect(c.directory.person(idOf(amy))?.tz).toBe('UTC');
    await save(c, amy, Array.from({ length: 5 }, (_, i) => word(`a${i}`, Date.UTC(2026, 10, 2))));
    await c.cronAt(sixPm(5));
    expect(c.pushes).toEqual([]);
    expect(c.followups()).toEqual([]);
    // Turning push on is using the app: three days from then.
    const r = await newReceiver();
    await c.post('/me/push', { subscription: subscriptionOf(r, 'https://web.push.apple.com/amy') }, amy);
    await c.cronAt(sixPm(7));
    expect(c.pushes).toEqual([]);
    await c.cronAt(sixPm(8));
    expect(c.pushes).toHaveLength(1);
    expect(JSON.parse(await decryptPush(c.pushes[0].body, r)).body).toBe('5 words are ready to review.');
    // Without the server's push keys there is nothing to send it with, and still no email.
    const bare = await server({ OWNER_EMAILS: 'owner@example.com', VAPID_KEYS: undefined });
    clock = Date.UTC(2026, 10, 1, 9);
    const amy2 = await joinWithPasskey(bare, await signedIn(bare, 'owner@example.com'));
    await save(bare, amy2, Array.from({ length: 5 }, (_, i) => word(`a${i}`, Date.UTC(2026, 10, 2))));
    await bare.post('/me/push', { subscription: subscriptionOf(r, 'https://web.push.apple.com/amy') }, amy2);
    await bare.cronAt(sixPm(6));
    expect([bare.pushes, bare.followups()]).toEqual([[], []]);
  });

  it('is not sent to an account signed out everywhere, which leaves the directory until it signs in again', async () => {
    const c = await server();
    const token = await reader(c);
    expect((await c.post('/auth/signout', {}, token)).status).toBe(200);
    await c.cronAt(sixPm(5));
    expect(c.followups()).toEqual([]);
    expect(c.directory.person(idOf(token))).toBeUndefined();
    clock = Date.UTC(2026, 10, 6, 9);
    const again = await signedIn(c);
    expect(idOf(again)).toBe(idOf(token));
    expect(c.directory.person(idOf(token))?.tz).toBe('UTC');
  });
});

describe('an account made before accounts kept their making time (2026-10-25)', () => {
  it('joins the directory and gets reminders, never a welcome, without its making time being filled in', () => {
    const store = memoryStore();
    const core = new AccountCore(store);
    const t = Date.UTC(2026, 10, 1, 9);
    core.storeCode('old@example.com', 'h', t);
    core.verify('h', 's', t);
    // As such an account is: an email and a signed-in device, no `created` (the app keys its marks by it).
    store.setMeta('created', null);
    expect(core.directoryNote(t, true)).not.toBeNull();
    for (let i = 0; i < 6; i++) store.data.set(`v:w${i}`, { at: 1, data: { id: `w${i}`, srs: { due: t } }, rev: i + 1 });
    // Away four days: a reminder by email (emails are on), not the welcome it never had.
    const plan = core.followupPlan(t + 4 * DAY);
    expect(plan.kind).toBe('remind');
    expect(plan.kind === 'remind' && plan.created).toBe('legacy');
    core.followupSent('remind', 'legacy', t + 4 * DAY);
    expect(core.followupPlan(t + 5 * DAY).kind).toBe('none');
    expect(store.getMeta('created') ?? null).toBeNull();
  });
});

describe('the day’s emails', () => {
  it('lets follow-ups use only their share, so sign-in codes always have the rest, and tries a reminder left out the next day', async () => {
    const c = await server({ DAILY_EMAILS: '6', FOLLOWUP_EMAILS: '2' });
    clock = Date.UTC(2026, 10, 1, 9);
    const emails = ['a@example.com', 'b@example.com', 'c@example.com'];
    for (const email of emails) {
      const token = await signedIn(c, email);
      await save(c, token, Array.from({ length: 5 }, (_, i) => word(`w${i}`, Date.UTC(2026, 10, 2))));
    }
    await c.cronAt(sixPm(5));
    const first = c.followups().map((m) => m.to);
    expect(first).toHaveLength(2);
    // The day's other four emails are the sign-in codes'.
    for (let i = 0; i < 4; i++) expect((await c.post('/auth/code', { email: `new${i}@example.com` })).status).toBe(200);
    expect((await c.post('/auth/code', { email: 'one-too-many@example.com' })).status).toBe(429);
    // The one left out goes the next day; the other two wait their week.
    await c.cronAt(sixPm(6));
    expect(c.followups().map((m) => m.to).slice(2)).toEqual(emails.filter((e) => !first.includes(e)));
  });

  it('sends no follow-up once sign-in codes have used the share', async () => {
    const c = await server({ DAILY_EMAILS: '6', FOLLOWUP_EMAILS: '1' });
    clock = Date.UTC(2026, 10, 1, 9);
    const token = await signedIn(c);
    await save(c, token, Array.from({ length: 5 }, (_, i) => word(`w${i}`, Date.UTC(2026, 10, 2))));
    clock = Date.UTC(2026, 10, 5, 8);
    expect((await c.post('/auth/code', { email: 'friend@example.com' })).status).toBe(200);
    await c.cronAt(sixPm(5));
    expect(c.followups()).toEqual([]);
    await c.cronAt(sixPm(6));
    expect(c.followups()).toHaveLength(1);
  });
});

describe('unsubscribing', () => {
  async function withReminder() {
    const c = await server();
    clock = Date.UTC(2026, 10, 1, 9);
    const token = await signedIn(c);
    await save(c, token, Array.from({ length: 5 }, (_, i) => word(`w${i}`, Date.UTC(2026, 10, 2))));
    await c.cronAt(sixPm(5));
    const [mail] = c.followups();
    return { c, token, mail, ...unsubscribePath(mail) };
  }

  it('asks first (a link opened by a mail scanner turns nothing off), then turns follow-up emails off, never sign-in codes', async () => {
    const { c, token, mail, path, url } = await withReminder();
    expect(mail.text).toContain(`Turn off these emails: ${url}`);
    const page = await c.call(path);
    expect(page.status).toBe(200);
    expect(page.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(page.headers.get('Content-Security-Policy')).toContain("default-src 'none'");
    expect(page.headers.get('Referrer-Policy')).toBe('no-referrer');
    const html = await page.text();
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Turn off LinguPengu emails?');
    expect(html).toContain('You will still get sign-in codes when you ask for one.');
    expect(html).toMatch(/<form method="post">[\s\S]*Turn off emails<\/button>/);
    expect(html).not.toMatch(/<script|https?:\/\/|src=/);
    expect(await reminders(c, token)).toMatchObject({ email: true });

    const done = await c.call(path, { method: 'POST', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(done.status).toBe(200);
    expect(await done.text()).toContain('Done. You will not get these emails anymore. You can turn them back on in LinguPengu’s Settings.');
    expect(await reminders(c, token)).toEqual({ email: false, canEmail: true, devices: 0 });
    await c.cronAt(sixPm(12));
    expect(c.followups()).toHaveLength(1);
    clock = sixPm(12) + HOUR;
    expect((await c.post('/auth/code', { email: 'reader@example.com' })).status).toBe(200);
    expect(c.mail.at(-1)!.subject).toMatch(/sign-in code/);

    // On again in Settings, and the next week's reminder comes; the same link still works for the form's button.
    expect(await (await c.post('/me/reminders', { email: true }, token)).json()).toEqual({ email: true, canEmail: true, devices: 0 });
    await c.cronAt(sixPm(19));
    expect(c.followups()).toHaveLength(2);
    expect((await c.call(path, { method: 'POST', body: 'List-Unsubscribe=One-Click' })).status).toBe(200);
    expect(await reminders(c, token)).toMatchObject({ email: false });
  });

  it('refuses a link with the wrong secret, for another account, or for one deleted since', async () => {
    const { c, token, url } = await withReminder();
    const a = url.searchParams.get('a')!;
    const t = url.searchParams.get('t')!;
    const wrongT = `${t.slice(0, -1)}${t.endsWith('A') ? 'B' : 'A'}`;
    for (const q of [`a=${a}&t=${wrongT}`, `a=${'0'.repeat(64)}&t=${t}`, `a=${a}`, `a=nope&t=${t}`, `a=${a}&t=${t}<script>`, '']) {
      for (const method of ['GET', 'POST']) {
        const res = await c.call(`/unsubscribe?${q}`, { method, ...(method === 'POST' ? { body: 'List-Unsubscribe=One-Click' } : {}) });
        expect(res.status).toBe(400);
        expect(await res.text()).toContain('This link is not valid anymore.');
      }
    }
    expect(await reminders(c, token)).toMatchObject({ email: true });
    expect((await c.call(`/unsubscribe?a=${a}&t=${t}`, { method: 'PUT' })).status).toBe(405);
    expect((await c.post('/me/delete', {}, token)).status).toBe(200);
    expect((await c.call(`/unsubscribe?a=${a}&t=${t}`)).status).toBe(400);
  });

  it('answers in the account’s language, with each language’s plural forms', async () => {
    const before = { ...MAIL_CATALOG };
    try {
      MAIL_CATALOG.fr = {
        'Turn off LinguPengu emails?': 'Désactiver les e-mails de LinguPengu ?',
        '{n} words are ready to review': { one: '{n} mot à revoir', other: '{n} mots à revoir' },
      };
      // Keyed by the plural English (as src/i18n's catalogs are) or by the singular, either is read.
      MAIL_CATALOG.ru = {
        '{n} word is ready to review.': { one: '{n} слово ждёт повторения.', few: '{n} слова ждут повторения.', many: '{n} слов ждут повторения.', other: '{n} слова ждут повторения.' },
      };
      const ru = mailText('ru');
      expect([1, 2, 5, 21].map((n) => ru.mtn(n, '{n} word is ready to review.', '{n} words are ready to review.'))).toEqual([
        '1 слово ждёт повторения.', '2 слова ждут повторения.', '5 слов ждут повторения.', '21 слово ждёт повторения.',
      ]);
      expect(mailText('zh-Hant').lang).toBe('zh-TW');
      expect(mailText('xx').mt('Welcome to LinguPengu')).toBe('Welcome to LinguPengu');
      expect(reminderEmail('fr', 1, APP, 'u').subject).toBe('1 mot à revoir');
      expect(welcomeEmail('fr', APP, 'u').subject).toBe('Welcome to LinguPengu');

      const { c, token, path } = await withReminder();
      expect((await c.post('/sync', { about: { tz: 'Europe/Paris', locale: 'fr' } }, token)).status).toBe(200);
      const html = await (await c.call(path)).text();
      expect(html).toContain('<html lang="fr">');
      expect(html).toContain('Désactiver les e-mails de LinguPengu ?');
      expect(html).toContain('You will still get sign-in codes when you ask for one.');
    } finally {
      for (const k of Object.keys(MAIL_CATALOG)) delete MAIL_CATALOG[k];
      Object.assign(MAIL_CATALOG, before);
    }
  });
});

describe('what the app tells the account', () => {
  it('keeps the time zone and language a sync sends, and tells the directory when the zone changes or once a day', async () => {
    const c = await server();
    const real = c.env.DIRECTORY!;
    const puts: string[] = [];
    c.env.DIRECTORY = { ...real, get: (id) => ({ fetch: (url, init) => { if (url.endsWith('/put')) puts.push(JSON.parse(String(init?.body)).tz); return real.get(id).fetch(url, init); } }) };
    const token = await signedIn(c);
    expect(puts).toEqual(['UTC']);
    // An app from before sends no `about`: the sync is answered as ever, and the account stays in UTC, in English.
    const old = await c.post('/sync', { changes: [{ key: 'k:好', at: 5, data: {} }] }, token);
    expect(await old.json()).toMatchObject({ counts: { known: 1 } });
    expect(puts).toEqual(['UTC']);
    expect(c.directory.person(idOf(token))?.tz).toBe('UTC');

    expect((await c.post('/sync', { about: { tz: 'Asia/Tokyo', locale: 'ja' } }, token)).status).toBe(200);
    expect(c.directory.person(idOf(token))?.tz).toBe('Asia/Tokyo');
    // Not a zone, too long, not one of the app's languages: kept as it was.
    for (const about of [{ tz: 'Mars/Base' }, { tz: `Asia/${'x'.repeat(70)}` }, { tz: 12, locale: 'xx' }, 'nope', null]) {
      expect((await c.post('/sync', { about }, token)).status).toBe(200);
    }
    expect(c.directory.person(idOf(token))?.tz).toBe('Asia/Tokyo');
    expect(puts).toEqual(['UTC', 'Asia/Tokyo']);
    // A sign-in always tells it (another device, the same day); a sync a day later tells it again.
    clock += 60_000;
    await signedIn(c);
    expect(puts).toEqual(['UTC', 'Asia/Tokyo', 'Asia/Tokyo']);
    clock += DAY + HOUR;
    await c.post('/sync', {}, token);
    expect(puts).toEqual(['UTC', 'Asia/Tokyo', 'Asia/Tokyo', 'Asia/Tokyo']);
    // Its 6 PM is Tokyo's now.
    await c.post('/sync', { changes: Array.from({ length: 5 }, (_, i) => ({ key: `v:w${i}`, at: 1, data: word(`w${i}`, clock) })) }, token);
    const tokyo = (day: number) => Date.UTC(2026, 10, day, 9);
    await c.cronAt(tokyo(8));
    // In the language the app said, Japanese.
    expect(c.followups().map((m) => m.subject)).toEqual([reminderEmail('ja', 5, APP, 'x').subject]);
    expect(c.followups()[0].subject).not.toBe('5 words are ready to review');
  });

  it('takes a deleted account out of the directory', async () => {
    const c = await server();
    const token = await signedIn(c);
    expect(c.directory.person(idOf(token))).toBeDefined();
    expect((await c.post('/me/delete', {}, token)).status).toBe(200);
    expect(c.directory.person(idOf(token))).toBeUndefined();
  });
});

describe('push subscriptions', () => {
  it('gives the app the server’s public key, or says push is not set up', async () => {
    const c = await server();
    const { key } = await (await c.call('/push/key')).json() as { key: string };
    expect(key).toBe(JSON.parse(c.env.VAPID_KEYS!).publicKey);
    const bare = cloud();
    const res = await bare.call('/push/key');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it('keeps ten devices at most, one per endpoint, forgets one turned off, and the one a device that signs out gave', async () => {
    const c = await server();
    const token = await signedIn(c);
    const r = await newReceiver();
    const sub = (i: number) => subscriptionOf(r, `https://fcm.googleapis.com/fcm/send/${i}`);
    expect((await c.post('/me/push', { subscription: sub(1) })).status).toBe(401);
    expect(await (await c.post('/me/push', { subscription: { ...sub(1), endpoint: 'http://fcm.googleapis.com/x' } }, token)).json()).toMatchObject({ code: 'bad_subscription' });
    expect((await c.post('/me/push', { subscription: { ...sub(1), keys: { p256dh: 'AAAA', auth: 'AAAA' } } }, token)).status).toBe(400);
    for (let i = 0; i < 12; i++) expect(await (await c.post('/me/push', { subscription: sub(i) }, token)).json()).toEqual({ ok: true, devices: Math.min(i + 1, 10) });
    // The same endpoint again replaces its copy.
    expect(await (await c.post('/me/push', { subscription: sub(5) }, token)).json()).toEqual({ ok: true, devices: 10 });
    const kept = () => c.stores.get(idOf(token))!.getMeta('push');
    expect(JSON.parse(kept()!).map((p: { endpoint: string }) => p.endpoint.split('/').pop())).toEqual(['2', '3', '4', '6', '7', '8', '9', '10', '11', '5']);
    expect(await (await c.post('/me/push/remove', { endpoint: sub(3).endpoint }, token)).json()).toEqual({ ok: true, devices: 9 });
    expect(await (await c.post('/me/push/remove', { endpoint: 'https://nowhere.example.com/x' }, token)).json()).toEqual({ ok: true, devices: 9 });

    // Another device gives its own; signing that device out stops its reminders, and leaves this one's.
    clock += 60_000;
    const other = await signedIn(c);
    await c.post('/me/push', { subscription: subscriptionOf(r, 'https://web.push.apple.com/other') }, other);
    expect(await reminders(c, token)).toMatchObject({ devices: 10 });
    await c.post('/auth/signout', {}, other);
    expect(await reminders(c, token)).toMatchObject({ devices: 9 });
    expect((await c.post('/me/reminders', { email: 'yes' }, token)).status).toBe(400);
  });
});

describe('the words due (what Review counts)', () => {
  const now = Math.floor(Date.UTC(2030, 0, 1) / 1000) * 1000;
  // Saved words as a hub may hold them, the odd ones included: every rule of the app's own cleanVocab is in here somewhere.
  const records: [string, unknown][] = [
    ['v:a', { id: 'a', srs: { due: now - 1 } }],
    ['v:b', { id: 'b', srs: { due: now + 1 } }],
    ['v:c', { id: 'c', srs: { due: now } }],
    ['v:d', { id: 'd', addedAt: now - 5 }],
    ['v:e', { id: 'e', addedAt: now + DAY }],
    ['v:f', { id: 'other', srs: { due: 0 } }],
    ['v:g', { simp: 'g', srs: { due: 0 } }],
    ['v:h', { id: '', simp: 'h', srs: { due: 0 } }],
    ['v:i', null],
    ['v:j', { id: 'j', srs: 'broken', addedAt: now - 1 }],
    ['v:k', { id: 'k', srs: { due: 'soon' }, addedAt: now + 5 }],
    ['v:l', { id: 'l', srs: { due: 9e15, last: -5 }, addedAt: -4e12 }],
    [`v:${'m'.repeat(101)}`, { id: 'm'.repeat(101), srs: { due: 0 } }],
    ['v:n', { id: 'n', srs: { due: now + 0.4 } }],
    ['v:o', { id: 'o', srs: { due: now + 0.6 } }],
    ['v:p', []],
    ['v:q', { id: 'q', srs: { due: now - 1 }, addedAt: 'x' }],
    ['v:r', { id: 'r', srs: [], addedAt: now - 1 }],
    ['v:s', { id: 's' }],
    ['v:t', { id: 't', simp: 'x'.repeat(101), srs: { due: 0 } }],
    ['v:u', { id: 'u', srs: { due: -50 } }],
    ['@ja:v:食べる', { id: '食べる', srs: { due: now - 1 } }],
    ['@es:v:x', { id: 'x', srs: { due: now + 1e9 } }],
    ['@fr:v:y', { id: 'y', srs: { due: now - DAY, last: now - 2 * DAY }, addedAt: now - 3 * DAY }],
    ['k:a', { id: 'a', srs: { due: 0 } }],
    ['l:2029-12-31:a', { id: 'a', srs: { due: 0 } }],
  ];
  /** What the app does with each: its cleanVocab, the id the key names, and Review's `srs.due <= now`. */
  const appDue = records.filter(([key, data]) => {
    const kid = /^(?:@[a-z]+:)?v:(.*)$/s.exec(key)?.[1];
    const item = kid === undefined ? null : cleanVocab(data);
    return !!item && item.id === kid && item.srs.due <= now;
  }).map(([key]) => key);

  it('are the ones the app’s Review would show, in the memory store', () => {
    expect(appDue.length).toBeGreaterThan(8);
    expect(appDue.length).toBeLessThan(records.length - 8);
    expect(records.filter(([key, data]) => { const at = wordDueAt(key, data, now); return at !== null && at <= now; }).map(([key]) => key)).toEqual(appDue);
    const store = memoryStore();
    for (const [key, data] of records) store.data.set(key, { at: 1, data, rev: 1 });
    expect(store.dueWords(now)).toBe(appDue.length);
  });

  it.skipIf(!hasSqlite)('and in SQLite, counted by its JSON functions', () => {
    const store = sqlStore(sqliteCli(join(mkdtempSync(join(tmpdir(), 'dushu-due-')), 'account.sqlite')));
    const table = store.records('e', 0);
    records.forEach(([key, data], i) => table.put(key, { at: 1, data, rev: i + 1 }));
    expect(store.dueWords(now)).toBe(appDue.length);
    expect(store.dueWords(now - 2)).toBe(records.filter(([key]) => appDue.includes(key)).filter(([key, data]) => (wordDueAt(key, data, now - 2) ?? Infinity) <= now - 2).length);
  });
});
