// The follow-up emails, the push notification and the unsubscribe pages in the reader's language: keyed [locale][English] like
// src/i18n/catalogs/<code>.json (a count string keyed by its English, its value the forms its language has, by Intl plural
// category). The app's side makes this from its catalogs; until it has, it is empty and everything reads in English
// (followups.ts mt and mtn).
export const MAIL_CATALOG: Record<string, Record<string, string | Record<string, string>>> = {};
