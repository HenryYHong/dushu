// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://henryyhong.com/dushu/#/" }
// Offline and signed in: Qwen through the account cannot reach the server, so it is not available, Settings says "Offline"
// instead of "Used up for today", and Automatic goes to a ready Chrome model (never to one that still has to be downloaded,
// which cannot happen offline) or the gloss. The public copy of the app, so no Mac is in play.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../src/store/settings';
import { createAccountTranslator, resetAccountTranslator } from '../../src/translate/account';
import { resetChromeTranslator } from '../../src/translate/chrome';
import { resetClaudeStatus } from '../../src/translate/claude';
import { pickTranslator } from '../../src/translate';
import { autoPick, statusText } from '../../src/ui/settings/translation';

const g = globalThis as { Translator?: unknown };
let online = true;
beforeEach(() => {
  online = true;
  vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => online);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
  localStorage.setItem('dushu.cloud.v1', JSON.stringify({ token: 't0ken', email: 'reader@example.com' }));
  resetAccountTranslator();
  resetClaudeStatus();
  resetChromeTranslator();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete g.Translator;
  localStorage.clear();
});
const chrome = (state: string) => { g.Translator = { availability: async () => state, create: async () => ({}) }; };

describe('offline, signed in', () => {
  it('Qwen through the account is not available, and Settings says Offline, not used up', async () => {
    const account = createAccountTranslator(DEFAULT_SETTINGS);
    expect(await account.availability()).toBe('yes');
    online = false;
    expect(await account.availability()).toBe('no');
    expect(statusText('account', 'no')).toEqual({ text: 'Offline', kind: 'off' });
    expect(statusText('mymemory', 'no')).toEqual({ text: 'Offline', kind: 'off' });
    // Local only still says Local only.
    expect(statusText('account', 'no', null, true).text).toBe('Local only is on');
    online = true;
    expect(statusText('account', 'no')).toEqual({ text: 'Used up for today', kind: 'warn' });
  });

  it('Automatic picks a ready Chrome model over the account', async () => {
    chrome('available');
    expect((await pickTranslator(DEFAULT_SETTINGS, null)).id).toBe('account');
    online = false;
    expect((await pickTranslator(DEFAULT_SETTINGS, null)).id).toBe('chrome');
  });

  it('Automatic passes over a Chrome model that still has to be downloaded, and the gloss is used', async () => {
    chrome('downloadable');
    online = false;
    expect((await pickTranslator(DEFAULT_SETTINGS, null)).id).toBe('gloss');
    online = true;
    localStorage.clear();
    expect((await pickTranslator(DEFAULT_SETTINGS, null)).id).toBe('chrome');
    const none = { local: 'no', chrome: 'download', claude: 'no', account: 'no', mymemory: 'no', gloss: 'yes' } as const;
    expect(autoPick({ ...none }, false, false, true)).toBe('gloss');
    expect(autoPick({ ...none }, false, false, false)).toBe('chrome');
  });
});
