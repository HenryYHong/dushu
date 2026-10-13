// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://my-mac.tail1234.ts.net:8443/#/settings" }
// The Settings screen as the private site shows it: the page is served by the Mac, so it makes the one-time link for other devices.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectedMac } from '../../src/core/macBridge';
import { openStore } from '../../src/store';
import { createSettingsStore } from '../../src/store/settings';
import { resetClaudeStatus } from '../../src/translate/claude';
import type { AppContext } from '../../src/types';
import { loadTestDictionary, readDataFile } from '../helpers/data';
import { mount as mountSettings } from '../../src/ui/settings/settings';

const MAC = 'https://my-mac.tail1234.ts.net:8443';
const flush = async (ms = 30) => { await new Promise(r => setTimeout(r, ms)); };
async function until(fn: () => boolean, ms = 3000) {
  const t = Date.now();
  while (!fn()) { if (Date.now() - t > ms) throw new Error('timed out waiting'); await flush(10); }
}
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

let root: HTMLElement;
let ctx: AppContext;
let cleanup: void | (() => void);
let asked: string[];
let privateUrl: string | null;

beforeEach(async () => {
  localStorage.clear();
  resetClaudeStatus();
  asked = [];
  privateUrl = `${MAC}/`;
  root = document.createElement('div');
  document.body.appendChild(root);
  const dict = await loadTestDictionary();
  ctx = { dict: () => Promise.resolve(dict), dictSync: () => dict, settings: createSettingsStore(), store: await openStore(`priv-${Math.random()}`), navigate: () => {}, toast: () => {} };
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(String(url));
    if (String(url).endsWith('data/meta.json')) return { ok: true, text: async () => readDataFile('meta.json') };
    if (url === '/api/private-status') return json({ app: 'dushu', url: privateUrl });
    if (url === '/api/claude/status') return json({ configured: true, limitReached: false, usage: { day: 'd', requests: 1, inputTokens: 2, outputTokens: 3 }, limits: { requests: 3000, inputTokens: 3000000 } });
    if (url === '/api/local-model/api/tags') return json({ models: [{ name: 'qwen3.5:9b-q4_K_M' }] });
    return new Response(null, { status: 404 });
  });
}, 30000);

afterEach(() => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  root.remove();
  vi.unstubAllGlobals();
});

const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.trim() === label)!;

describe('Settings on the private site', () => {
  it('uses its own origin for the Mac, so the Claude status is the page\'s own and nothing is connected', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    await until(() => [...root.querySelectorAll('.set-status dt')].some(dt => dt.textContent === 'Today'));
    expect(asked).toContain('/api/claude/status');
    expect(connectedMac()).toBeNull();
    expect(root.textContent).toContain('You opened Dushu from your Mac, so this device already uses it.');
    const chips = Object.fromEntries([...root.querySelectorAll('.set-prov')].map(r => [r.querySelector('.set-prov-name')?.textContent, r.querySelector('.set-chip')?.textContent]));
    expect(chips['Claude (through your Mac)']).toBe('Ready');
    await until(() => root.querySelector('.set-prov .set-chip')?.textContent !== '…');
  });

  it('shows the one-time link for other devices, built from the Mac\'s private address', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    const input = q<HTMLInputElement>('.set-link');
    await until(() => input.value !== '');
    expect(input.value).toBe(`https://henryyhong.com/dushu/#/settings?connect=${encodeURIComponent(MAC)}`);
    expect(input.closest<HTMLElement>('.set-row')!.hidden).toBe(false);
    expect(input.readOnly).toBe(true);
    expect(button('Copy link').disabled).toBe(false);
  });

  it('copies the link', async () => {
    const written: string[] = [];
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: async (t: string) => { written.push(t); } } });
    cleanup = await mountSettings(root, {}, ctx);
    const input = q<HTMLInputElement>('.set-link');
    await until(() => input.value !== '');
    button('Copy link').click();
    await until(() => written.length === 1);
    expect(written[0]).toBe(input.value);
    expect(q('.set-link-wrap .set-help').textContent).toBe('Copied.');
  });

  it('asks the owner to run npm run ipad first when the Mac has no private address yet', async () => {
    privateUrl = null;
    cleanup = await mountSettings(root, {}, ctx);
    await until(() => /npm run ipad/.test(q('.set-link-wrap .set-help').textContent ?? ''));
    expect(q<HTMLInputElement>('.set-link').value).toBe('');
    expect(button('Copy link').disabled).toBe(true);
  });
});
