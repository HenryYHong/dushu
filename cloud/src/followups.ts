// Follow-ups: a nudge so people come back to review their saved words, sent for free. Who gets what:
//
//   - A welcome email, once, a day or two after an account with an email address is made (WELCOME_AFTER_MS to
//     WELCOME_WITHIN_MS after `created`).
//   - A review reminder when at least REMIND_DUE saved words are due, the person has not used the app for REMIND_IDLE_MS, and
//     no reminder went out in REMIND_EVERY_MS: by Web Push to every device that turned it on (push.ts), else by email.
//
// Both go at the person's 6 PM (SEND_HOUR in their time zone, which the app sends with each sync), picked by the directory
// (directory.ts) on the hourly cron. The decision and the sending run inside the account's own Durable Object (AccountCore
// followupPlan, then runFollowup here), so the parsing, the encryption and the outside requests each run in an invocation of
// their own: the free plan's CPU time and subrequests are per invocation.
//
// Email is the scarce part: Resend's free plan sends 100 a day (and 3,000 a month), shared with the sign-in codes. The Worker
// keeps all email under DAILY_EMAILS (90) a day, which also keeps a month under 3,000; follow-ups may send only while fewer than
// FOLLOWUP_EMAILS (50) went out that day, so at least 40 are always left for sign-in codes. A reminder that finds the day used
// up records nothing and is tried again at the next day's 6 PM. Push has no such limit, so a device with it on never uses one.
//
// Every email says why it came and has a link that turns follow-up emails off (and RFC 8058 one-click headers, so a mail app's
// own button works). Turning them off never stops a sign-in code.
import type { AccountCore } from './account';
import type { Mailer } from './mail';
import { MAIL_CATALOG } from './mailCatalog';
import { sendPush, type PushRandom, type PushRecord, type Vapid } from './push';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** The person's local hour the follow-ups go out at: early evening, after work or school, when there is time to review. */
export const SEND_HOUR = 18;
/** A welcome goes to an account made at least this long ago (the first evening is too soon: they just signed in)… */
export const WELCOME_AFTER_MS = 20 * HOUR;
/** …and no longer than this: an account that missed its window (made before this deploy) never gets one. */
export const WELCOME_WITHIN_MS = 72 * HOUR;
/** Saved words due for a reminder: fewer is not worth an interruption. */
export const REMIND_DUE = 5;
/** Days without the app before a reminder: someone who reviewed yesterday does not need one. */
export const REMIND_IDLE_MS = 3 * DAY;
/** A reminder a week at most, whatever happens: a nudge, not a nag. */
export const REMIND_EVERY_MS = 7 * DAY;
/**
 * How much sooner than REMIND_EVERY_MS the next reminder may still go. The runs are a day apart at the person's 6 PM, but not to
 * the second: the cron and the directory's queue reach an account a few seconds or minutes later some evenings than others, and
 * the evening summer time starts comes an hour sooner. Without this, a reminder sent at 6:00:40 PM would miss 6:00:10 PM a week
 * later by half a minute and wait an eighth day. It is far less than a day, so the evening before is never close enough.
 */
export const REMIND_SLACK_MS = 3 * HOUR;
/** Follow-up emails a day at most, counted with the sign-in codes (DAILY_EMAILS): the rest of the day is the codes'. */
export const FOLLOWUP_EMAILS = 50;
/**
 * The directory waits this long after a follow-up email before asking the next account (worker.ts directoryAlarm). Resend's API
 * takes 2 requests a second by default, for the whole Resend account: follow-ups use at most one of them, so a sign-in code asked
 * for in that second still goes. Fifty follow-ups a day wait under a minute in all.
 */
export const EMAIL_GAP_MS = 1000;

// ---------------------------------------------------------------- language ---

/**
 * The app's languages (src/i18n UI_LANGS) and the tag Intl takes for each: plural rules and numbers. Chinese is zh-CN and
 * zh-TW here, which Intl reads the same as the app's zh-Hans and zh-Hant.
 */
export const MAIL_LOCALES = {
  en: 'en', zh: 'zh-CN', 'zh-Hant': 'zh-TW', ja: 'ja', ko: 'ko', es: 'es', fr: 'fr', de: 'de', it: 'it', pt: 'pt', ru: 'ru',
} as const;
export type MailLocale = keyof typeof MAIL_LOCALES;
export const isMailLocale = (v: unknown): v is MailLocale => typeof v === 'string' && Object.prototype.hasOwnProperty.call(MAIL_LOCALES, v);

/** An IANA time zone Intl knows ('Asia/Tokyo'), at most 64 characters; anything else is not one. */
export function validTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}

/** The hour (0 to 23) it is in `tz` at `now`; UTC's when the zone is not one Intl knows. */
export function localHour(tz: string, now: number): number {
  try {
    const hour = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).find((p) => p.type === 'hour')?.value;
    const n = Number(hour);
    if (Number.isInteger(n) && n >= 0 && n < 24) return n;
  } catch { /* not a zone: UTC */ }
  return new Date(now).getUTCHours();
}

type Vars = Record<string, string | number>;
const fill = (s: string, vars?: Vars) => (vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : s);

/**
 * The mail strings in `locale` (an app language code; anything else is English), as the app's tt and ttn give its own:
 * mt('English') and mtn(n, 'one', 'other'), each read from MAIL_CATALOG and English when it has nothing. The strings are
 * written out where they are used, as literals, so the app's string list finds them the way it finds tt's.
 */
export function mailText(locale: string) {
  const code: MailLocale = isMailLocale(locale) ? locale : 'en';
  const catalog = MAIL_CATALOG[code] ?? {};
  const rules = new Intl.PluralRules(MAIL_LOCALES[code]);
  const numbers = new Intl.NumberFormat(MAIL_LOCALES[code]);
  const mt = (src: string, vars?: Vars): string => {
    const e = catalog[src];
    return fill(typeof e === 'string' && e ? e : src, vars);
  };
  const mtn = (n: number, one: string, other: string, vars?: Vars): string => {
    // The app's catalogs key a count by its English plural; one keyed by the singular is read as well.
    const e = catalog[other] ?? catalog[one];
    let s: string;
    if (e && typeof e === 'object') s = e[rules.select(n)] ?? e.other ?? (n === 1 ? one : other);
    else if (typeof e === 'string' && e) s = e;
    else s = n === 1 ? one : other;
    return fill(s, { n: numbers.format(n), ...vars });
  };
  return { mt, mtn, lang: MAIL_LOCALES[code] };
}

// ---------------------------------------------------------------- messages ---

export interface MailMessage { subject: string; text: string }

/** The two lines under every follow-up: why it came, and the link that stops them. */
function footer(mt: ReturnType<typeof mailText>['mt'], unsubscribe: string): string {
  return `--\n${mt('You get this email because you signed in to LinguPengu with this address.')}\n${mt('Turn off these emails: {link}', { link: unsubscribe })}`;
}

/** The welcome: what to try first, a link to the app, and the footer. */
export function welcomeEmail(locale: string, appUrl: string, unsubscribe: string): MailMessage {
  const { mt } = mailText(locale);
  const text = [
    mt('Thanks for trying LinguPengu!'),
    [
      mt('A few things that help:'),
      mt('• Tap any word in a book to see what it means, and tap the star to save it.'),
      mt('• Review your saved words for a few minutes a day. Each one comes back right before you would forget it.'),
      mt('• Your books and words are saved to your account, so you can pick up on any device.'),
    ].join('\n'),
    mt('Open LinguPengu: {link}', { link: appUrl }),
    `${mt('Happy reading,')}\nPengu`,
    footer(mt, unsubscribe),
  ].join('\n\n');
  return { subject: mt('Welcome to LinguPengu'), text };
}

/** The review reminder by email: how many words wait, a link straight to Review, and the footer. */
export function reminderEmail(locale: string, due: number, appUrl: string, unsubscribe: string): MailMessage {
  const { mt, mtn } = mailText(locale);
  const text = [
    mtn(due, 'You have {n} saved word ready to review. A few minutes now keeps it fresh.', 'You have {n} saved words ready to review. A few minutes now keeps them fresh.'),
    mt('Review now: {link}', { link: `${appUrl}#/review` }),
    `${mt('Happy reading,')}\nPengu`,
    footer(mt, unsubscribe),
  ].join('\n\n');
  return { subject: mtn(due, '{n} word is ready to review', '{n} words are ready to review'), text };
}

/** The review reminder by push: what the app's service worker shows, and where a tap opens. */
export function reminderPush(locale: string, due: number, appUrl: string): { title: string; body: string; url: string; tag: string } {
  const { mtn } = mailText(locale);
  return { title: 'LinguPengu', body: mtn(due, '{n} word is ready to review.', '{n} words are ready to review.'), url: `${appUrl}#/review`, tag: 'review' };
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The unsubscribe link's pages: 'ask' (GET, a button that posts back to the same address, so a mail scanner opening the link
 * turns nothing off), 'done' (after the POST) and 'bad' (a link that is not one, or an account deleted since). Tiny and on their
 * own: no script, no outside file, every string escaped.
 */
export function unsubscribePage(locale: string, page: 'ask' | 'done' | 'bad'): string {
  const { mt, lang } = mailText(locale);
  const body = page === 'ask'
    ? `<h1>${escapeHtml(mt('Turn off LinguPengu emails?'))}</h1>
<p>${escapeHtml(mt('You will still get sign-in codes when you ask for one.'))}</p>
<form method="post"><input type="hidden" name="List-Unsubscribe" value="One-Click"><button type="submit">${escapeHtml(mt('Turn off emails'))}</button></form>`
    : `<p>${escapeHtml(page === 'done' ? mt('Done. You will not get these emails anymore. You can turn them back on in LinguPengu’s Settings.') : mt('This link is not valid anymore.'))}</p>`;
  return `<!doctype html>
<html lang="${escapeHtml(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>LinguPengu</title>
<style>body{font:17px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 16px;color:#1d2433;background:#fff}h1{font-size:1.4rem}button{font:inherit;padding:.6rem 1.2rem;border:0;border-radius:8px;background:#243554;color:#fff;cursor:pointer}@media (prefers-color-scheme:dark){body{color:#e8eaf0;background:#14181f}button{background:#4a6596}}</style>
</head><body>
${body}
</body></html>`;
}

// ----------------------------------------------------------------- sending ---

/** What the account decided (AccountCore followupPlan): nothing, forget it, or a message to send. */
export type FollowupPlan =
  | { kind: 'drop' }
  | { kind: 'none' }
  | { kind: 'welcome'; email: string; locale: string; token: string; created: string }
  | { kind: 'remind'; due: number; locale: string; pushes: PushRecord[]; email: string | null; token: string; created: string };

/** What a follow-up run did: `drop` tells the directory to forget the account (signed out everywhere, or deleted). */
export interface FollowupResult { drop?: true; sent: 'welcome' | 'push' | 'email' | null; removed?: number }

/** What the account needs from the Worker to send: built from its settings in worker.ts, made up in tests. */
export interface FollowupDeps {
  /** This account's Durable Object id, for its unsubscribe link. */
  self: string;
  appUrl: string;
  syncUrl: string;
  /** Counts one follow-up email against today's (false when the day is used up). */
  takeEmail(): Promise<boolean>;
  /** The mail service; throws when none is set up. */
  mailer(): Mailer;
  /** The server's VAPID keys, or null when push is not set up. */
  vapid(): Promise<Vapid | null>;
  fetch?: typeof fetch;
  random?: PushRandom;
}

/** Sends one follow-up email within today's share; false when it did not go (no mail service, the day used up, a failure). */
async function sendEmail(deps: FollowupDeps, to: string, message: MailMessage, unsubscribe: string): Promise<boolean> {
  let mailer: Mailer;
  try { mailer = deps.mailer(); } catch { return false; }
  if (!await deps.takeEmail()) return false;
  try {
    await mailer.send({ to, ...message, headers: { 'List-Unsubscribe': `<${unsubscribe}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } });
    return true;
  } catch (e) {
    console.error('LinguPengu follow-up: the email was not sent', e instanceof Error ? e.message : e);
    return false;
  }
}

/**
 * One account's follow-up at its 6 PM. The account decides what is due (a synchronous step, so it reads its records in one
 * transaction), the messages go out, and the account notes what went: only then, so a day with no email left, or a push service
 * that is down, leaves the reminder to be tried at the next day's run.
 */
export async function runFollowup(core: AccountCore, deps: FollowupDeps, now: number): Promise<FollowupResult> {
  const plan = core.followupPlan(now);
  if (plan.kind === 'drop') return { drop: true, sent: null };
  if (plan.kind === 'none') return { sent: null };
  const unsubscribe = `${deps.syncUrl}/unsubscribe?a=${deps.self}&t=${plan.token}`;
  if (plan.kind === 'welcome') {
    if (!await sendEmail(deps, plan.email, welcomeEmail(plan.locale, deps.appUrl, unsubscribe), unsubscribe)) return { sent: null };
    core.followupSent('welcome', plan.created, now);
    return { sent: 'welcome' };
  }
  let removed = 0;
  if (plan.pushes.length) {
    const vapid = await deps.vapid();
    if (vapid) {
      const message = reminderPush(plan.locale, plan.due, deps.appUrl);
      const results = await Promise.all(plan.pushes.map((p) => sendPush(p, message, vapid, { fetch: deps.fetch, now, random: deps.random }).catch((e) => {
        console.error('LinguPengu push', e instanceof Error ? e.message : e);
        return 'failed' as const;
      })));
      const gone = plan.pushes.filter((_, i) => results[i] === 'gone').map((p) => p.endpoint);
      removed = gone.length;
      if (gone.length) core.dropPushes(gone);
      // One device that took it is enough: the person sees it there.
      if (results.includes('sent')) {
        core.followupSent('remind', plan.created, now);
        return { sent: 'push', ...(removed ? { removed } : {}) };
      }
    }
  }
  // No device took it (none turned push on, or every one is gone): email, when there is an address and emails are on.
  if (plan.email && await sendEmail(deps, plan.email, reminderEmail(plan.locale, plan.due, deps.appUrl, unsubscribe), unsubscribe)) {
    core.followupSent('remind', plan.created, now);
    return { sent: 'email', ...(removed ? { removed } : {}) };
  }
  return { sent: null, ...(removed ? { removed } : {}) };
}
