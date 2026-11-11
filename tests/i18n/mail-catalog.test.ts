// The sync server's emails and notifications (cloud/) in every language the app has: src/i18n/mailStrings.ts lists their English,
// the catalogs translate them like the app's own strings, and scripts/i18n/mail-catalog.mjs copies the translations into
// cloud/src/mailCatalog.ts, which the Worker reads.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error a build script, plain JavaScript
import { OUT, mailCatalog, mailCatalogSource, mailStrings } from '../../scripts/i18n/mail-catalog.mjs';
import { MAIL_CATALOG } from '../../cloud/src/mailCatalog';

const DIR = join(__dirname, '../../src/i18n/catalogs');
const locales = readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', '')).sort();
const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
type Entry = { text: string; one?: string };
const strings = mailStrings() as Entry[];

/** The English the Worker writes, word for word: it looks each one up by it. */
const PLAIN = [
  'Welcome to LinguPengu',
  'Thanks for trying LinguPengu!',
  'A few things that help:',
  '• Tap any word in a book to see what it means, and tap the star to save it.',
  '• Review your saved words for a few minutes a day. Each one comes back right before you would forget it.',
  '• Your books and words are saved to your account, so you can pick up on any device.',
  'Open LinguPengu: {link}',
  'Review now: {link}',
  'Happy reading,',
  'You get this email because you signed in to LinguPengu with this address.',
  'Turn off these emails: {link}',
  'Turn off LinguPengu emails?',
  'You will still get sign-in codes when you ask for one.',
  'Turn off emails',
  'Done. You will not get these emails anymore. You can turn them back on in LinguPengu’s Settings.',
  'This link is not valid anymore.',
];
const COUNTS = [
  ['{n} word is ready to review', '{n} words are ready to review'],
  ['You have {n} saved word ready to review. A few minutes now keeps it fresh.', 'You have {n} saved words ready to review. A few minutes now keeps them fresh.'],
  ['{n} word is ready to review.', '{n} words are ready to review.'],
];

describe('the mail strings', () => {
  it('are the English the Worker writes, each count with its singular', () => {
    expect(strings.filter((s) => s.one === undefined).map((s) => s.text).sort()).toEqual([...PLAIN].sort());
    expect(strings.filter((s) => s.one !== undefined).map((s) => [s.one, s.text]).sort()).toEqual([...COUNTS].sort());
  });

  it('cloud/src/mailCatalog.ts is up to date (node scripts/i18n/mail-catalog.mjs)', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(mailCatalogSource());
    expect(MAIL_CATALOG).toEqual(mailCatalog());
    expect(Object.keys(MAIL_CATALOG).sort()).toEqual(locales);
  });
});

describe.each(locales)('%s', (locale) => {
  const catalog = JSON.parse(readFileSync(join(DIR, `${locale}.json`), 'utf8')) as Record<string, string | Record<string, string>>;
  const rules = new Intl.PluralRules(locale === 'pt' ? 'pt-BR' : locale === 'zh' ? 'zh-Hans' : locale);

  it('translates every mail string, keeping its {values} and bullets', () => {
    const bad: string[] = [];
    for (const { text, one } of strings) {
      const tr = catalog[text];
      if (tr === undefined || tr === '') { bad.push(`missing: ${text}`); continue; }
      if (one !== undefined) {
        if (typeof tr === 'string') { bad.push(`a count needs its plural forms: ${text}`); continue; }
        // Every form the language's numbers take, so no count falls back to English.
        for (const cat of rules.resolvedOptions().pluralCategories) if (!tr[cat]) bad.push(`no '${cat}' form: ${text}`);
      }
      const forms = typeof tr === 'string' ? [tr] : Object.values(tr);
      for (const f of forms) {
        if (JSON.stringify(holes(f)) !== JSON.stringify(holes(text))) bad.push(`{values} differ: ${text} → ${f}`);
        if (text.startsWith('• ') !== f.startsWith('• ')) bad.push(`bullet lost: ${text} → ${f}`);
        if (text.includes('LinguPengu') && !f.includes('LinguPengu')) bad.push(`the name is translated: ${text} → ${f}`);
        if (/—/.test(f)) bad.push(`an em dash: ${f}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('a count is found by its singular, as the Worker asks, and by its plural, as the app does', () => {
    for (const [one, other] of COUNTS) {
      expect(MAIL_CATALOG[locale][one]).toEqual(catalog[other]);
      expect(MAIL_CATALOG[locale][other]).toEqual(catalog[other]);
    }
  });
});
