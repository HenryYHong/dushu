// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://henryyhong.com/dushu/#/settings" }
// Google's answer arriving in a page that is already open but still starting: the address became '#state=…&id_token=…'
// after main.ts looked at it on load and before the router listened for changes (an iPhone Home Screen app's window can get
// the answer as a change of its fragment; a fragment pasted into a tab that is still opening is the same). main.ts takes it
// out before the first screen is drawn, so the token does not stay in the address bar and Settings, not the library, opens.
import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../cloud/src/worker';
import { cloudSession } from '../../src/core/cloud';
import { GOOGLE_CLIENT_ID } from '../../src/core/cloudUrl';
import { startGoogleSignIn } from '../../src/core/google';
import { fakeGoogle } from '../cloud/googleFake';
import { cloud } from '../cloud/helpers';
import { bootApp } from './bootApp';

vi.mock('../../src/core/dict', async (orig) => {
  const real = await orig<typeof import('../../src/core/dict')>();
  const files: Record<string, string> = {
    'cedict.tsv.gz': '山\t山\tshan1\tmountain', 'chars.tsv.gz': '山\tshan1', 'words.tsv.gz': '山\t100', 'hsk.tsv.gz': '山\t山\t1\t1\t5',
    't2s.tsv.gz': '', 's2t.tsv.gz': '', 'radicals.tsv.gz': '1\t⼀\t一', 'meta.json': '{}',
  };
  const fetchText = async (name: string) => { if (files[name] === undefined) throw new Error(`${name}: missing`); return files[name]; };
  return { ...real, loadDictionary: () => real.loadDictionary('/', { fetchText }) };
});
vi.mock('../../src/core/sync', async (orig) => ({ ...(await orig<typeof import('../../src/core/sync')>()), startSync: () => undefined }));
vi.mock('../../src/fonts', () => ({}));
/** Set by the test: Google's answer, put in the address while the app starts (no hashchange, as before the router listens). */
const late = vi.hoisted(() => ({ fragment: '' }));
vi.mock('../../src/ui/library/incoming', () => ({ listenForOpenedFiles: () => { if (late.fragment) history.replaceState(null, '', `/dushu/${late.fragment}`); } }));
/** The hash each screen saw when it mounted. */
const mounted = vi.hoisted(() => [] as string[]);
vi.mock('../../src/ui/library/library', () => ({ mount: (root: HTMLElement) => { mounted.push(`library ${location.hash}`); root.append('library'); return () => {}; } }));
vi.mock('../../src/ui/settings/settings', () => ({ mount: (root: HTMLElement) => { mounted.push(`settings ${location.hash}`); root.append('settings'); return () => {}; } }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('Google’s answer arriving while the app starts', () => {
  it('is taken out before the first screen is drawn: the screen the person left from opens, signed in, with no token kept', async () => {
    const google = await fakeGoogle();
    const c = cloud({ GOOGLE_CLIENT_ID, googleFetch: google.fetch });
    const paths: string[] = [];
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = new Request(input, init);
      const url = new URL(req.url);
      if (url.origin !== 'https://sync.test') throw new TypeError('Failed to fetch');
      paths.push(url.pathname);
      const body = req.method === 'GET' || req.method === 'DELETE' ? undefined : await req.arrayBuffer();
      return worker.fetch(new Request(req.url, { method: req.method, headers: req.headers, body }), c.env);
    });
    localStorage.setItem('dushu.cloud.url.v1', 'https://sync.test');
    vi.spyOn(console, 'log').mockImplementation(() => {});

    // Left from Settings for Google; the page loads at Settings, and the answer lands in it while it starts.
    let to = '';
    startGoogleSignIn((url) => { to = url; });
    late.fragment = await google.answer(new URL(to), 'reader@example.com');
    expect(location.hash).toBe('#/settings');

    await bootApp();
    expect(mounted).toEqual(['settings #/settings']);
    expect(location.href).toBe('https://henryyhong.com/dushu/#/settings');
    await vi.waitFor(() => { if (!cloudSession()) throw new Error('not signed in yet'); });
    expect(cloudSession()).toMatchObject({ email: 'reader@example.com' });
    expect(paths[0]).toBe('/auth/google');
    await vi.waitFor(() => {
      const toasts = [...document.querySelectorAll('.app-toast-text')].map((t) => t.textContent);
      if (!toasts.includes('Signed in. Your books’ places, words and bookmarks are on their way.')) throw new Error(`toasts: ${toasts.join(' | ')}`);
    });
    expect(document.body.innerHTML).not.toContain('id_token');
  });
});
