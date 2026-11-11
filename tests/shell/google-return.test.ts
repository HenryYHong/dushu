// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://henryyhong.com/dushu/#/settings" }
// The app opened by Google's answer (https://henryyhong.com/dushu/#state=…&id_token=…): main.ts takes the token out of the
// address before the router reads it, so the screen the person left from (Settings) is what mounts, no history entry keeps
// the token, and the sign-in finishes against the sync server (in process) with the code sign-in's message.
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
/** The hash each screen saw when it mounted. */
const mounted = vi.hoisted(() => [] as string[]);
vi.mock('../../src/ui/library/library', () => ({ mount: (root: HTMLElement) => { mounted.push(`library ${location.hash}`); root.append('library'); return () => {}; } }));
vi.mock('../../src/ui/settings/settings', () => ({ mount: (root: HTMLElement) => { mounted.push(`settings ${location.hash}`); root.append('settings'); return () => {}; } }));

afterEach(() => { vi.unstubAllGlobals(); });

describe('the app opened by Google’s answer', () => {
  it('takes the token out of the address before the router reads it, opens the screen the person left from, and signs in', async () => {
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

    // Left from Settings for Google, and came back with its answer.
    let to = '';
    startGoogleSignIn((url) => { to = url; });
    history.replaceState(null, '', `/dushu/${await google.answer(new URL(to), 'reader@example.com')}`);
    const entries = history.length;
    expect(location.hash).toMatch(/^#state=.*&id_token=/);

    await bootApp();
    expect(mounted).toEqual(['settings #/settings']);
    expect(location.href).toBe('https://henryyhong.com/dushu/#/settings');
    expect(history.length).toBe(entries);
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
