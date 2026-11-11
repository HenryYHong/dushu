// The sync server's own words: the welcome email, the review reminder (email and notification) and the unsubscribe page
// (cloud/). The Worker can't load the app's catalogs, so scripts/i18n/mail-catalog.mjs copies these strings' translations out
// of them into cloud/src/mailCatalog.ts. They are listed here, written the way the app writes its own (tt, and ttn for a count),
// only so scripts/i18n/extract.mjs puts them in strings.json and the catalogs translate them like every other string.
//
// The app never calls this function. The English must stay exactly what the Worker writes: it is the key the Worker looks up.
// 'LinguPengu' and the signature 'Pengu' stay as they are in every language.
import { tt, ttn } from './index';

export function mailStrings(n: number): string[] {
  return [
    // The welcome email.
    tt('Welcome to LinguPengu'),
    tt('Thanks for trying LinguPengu!'),
    tt('A few things that help:'),
    tt('• Tap any word in a book to see what it means, and tap the star to save it.'),
    tt('• Review your saved words for a few minutes a day. Each one comes back right before you would forget it.'),
    tt('• Your books and words are saved to your account, so you can pick up on any device.'),
    tt('Open LinguPengu: {link}'),
    // The review reminder: the email's subject and body, then the notification's line.
    ttn(n, '{n} word is ready to review', '{n} words are ready to review'),
    ttn(n, 'You have {n} saved word ready to review. A few minutes now keeps it fresh.', 'You have {n} saved words ready to review. A few minutes now keeps them fresh.'),
    tt('Review now: {link}'),
    ttn(n, '{n} word is ready to review.', '{n} words are ready to review.'),
    // Every email's end.
    tt('Happy reading,'),
    tt('You get this email because you signed in to LinguPengu with this address.'),
    tt('Turn off these emails: {link}'),
    // The unsubscribe page.
    tt('Turn off LinguPengu emails?'),
    tt('You will still get sign-in codes when you ask for one.'),
    tt('Turn off emails'),
    tt('Done. You will not get these emails anymore. You can turn them back on in LinguPengu’s Settings.'),
    tt('This link is not valid anymore.'),
  ];
}
