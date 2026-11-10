// The sync server's address, on its own: the build (scripts/bridge-csp.ts) and the Mac's server (scripts/account-books.ts)
// read it here without loading cloud.ts, whose messages go through src/i18n, which only Vite can load.

/** The sync server. Empty: this build has none, and Settings does not offer to sign in. */
export const CLOUD_URL = 'https://dushu-sync.henryhong.workers.dev';
