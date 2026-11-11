// The sync server's address, on its own: the build (scripts/bridge-csp.ts) and the Mac's server (scripts/account-books.ts)
// read it here without loading cloud.ts, whose messages go through src/i18n, which only Vite can load.

/** The sync server. Empty: this build has none, and Settings does not offer to sign in. */
export const CLOUD_URL = 'https://dushu-sync.henryhong.workers.dev';

/**
 * The Google OAuth web client the app signs in with (Google Cloud project "lingupengu", scopes openid and email). Public: it
 * is in the address every sign-in goes to. The Worker checks tokens against the same id (cloud/wrangler.toml GOOGLE_CLIENT_ID).
 */
export const GOOGLE_CLIENT_ID = '171830368940-ois90tk41035hftjtf1tk4n357jqhnk4.apps.googleusercontent.com';
/**
 * The one address Google may send a sign-in back to (the client's only authorized redirect URI). The app offers Google only on
 * this page, so a copy elsewhere (localhost, the owner's Mac) never sends someone off on a trip that cannot come back. To move
 * the app, add the new address to the client in Google Cloud first, then change this.
 */
export const GOOGLE_REDIRECT_URI = 'https://henryyhong.com/dushu/';
