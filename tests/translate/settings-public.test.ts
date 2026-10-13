// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://henryyhong.com/dushu/#/settings" }
// The Settings screen as the public copy of the app shows it: no Mac yet, then connected.
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
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

let root: HTMLElement;
let ctx: AppContext;
let cleanup: void | (() => void);
let asked: { url: string; init?: RequestInit }[];
let mac: { status?: object; refuse?: boolean; down?: boolean };

beforeEach(async () => {
  localStorage.clear();
  resetClaudeStatus();
  asked = [];
  mac = {};
  root = document.createElement('div');
  document.body.appendChild(root);
  const dict = await loadTestDictionary();
  ctx = { dict: () => Promise.resolve(dict), dictSync: () => dict, settings: createSettingsStore(), store: await openStore(`pub-${Math.random()}`), navigate: () => {}, toast: () => {} };
  vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
    asked.push({ url: String(url), init });
    const u = String(url);
    if (u.endsWith('data/meta.json')) return { ok: true, text: async () => readDataFile('meta.json') };
    if (!u.startsWith(MAC)) return { ok: false, status: 404, text: async () => '' };
    if (mac.down) throw new TypeError('Failed to fetch');
    if (mac.refuse) return new Response(null, { status: 403 });
    if (u.endsWith('/api/private-status')) return json({ app: 'dushu', url: `${MAC}/` });
    if (u.endsWith('/api/claude/status')) return json(mac.status ?? { configured: true, limitReached: false, usage: { day: 'd', requests: 12, inputTokens: 3400, outputTokens: 560 }, limits: { requests: 3000, inputTokens: 3000000 } });
    if (u.endsWith('/api/local-model/api/tags')) return json({ models: [] });
    if (u.endsWith('/api/claude/translate')) return new Response(JSON.stringify({ type: 'text', text: 'Hello, world.' }) + '\n' + JSON.stringify({ type: 'done', stop: 'end_turn' }) + '\n');
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
const statusLines = () => Object.fromEntries([...root.querySelectorAll('.set-status dt')].map(dt => [dt.textContent, dt.nextElementSibling?.textContent]));

describe('Settings on the public site', () => {
  it('holds no key field, and offers Sonnet and Haiku', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    expect(root.querySelector('input[type=password]')).toBeNull();
    expect(root.querySelector('.set-key')).toBeNull();
    expect(root.textContent).not.toMatch(/sk-ant|Anthropic API key|API keys/i);
    const models = [...root.querySelectorAll<HTMLOptionElement>('select[aria-label="Claude model"] option')].map(o => [o.value, o.textContent]);
    expect(models).toEqual([['claude-sonnet-5-5', 'Claude Sonnet 5.5 (default)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (cheaper)']]);
    expect(q<HTMLSelectElement>('select[aria-label="Claude model"]').value).toBe('claude-sonnet-5-5');
    q<HTMLSelectElement>('select[aria-label="Claude model"]').value = 'claude-haiku-5-5';
    q<HTMLSelectElement>('select[aria-label="Claude model"]').dispatchEvent(new Event('change'));
    expect(ctx.settings.get().claudeModel).toBe('claude-haiku-5-5');
  });

  it('asks nothing of any Mac until one is connected, and says so', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    await until(() => [...root.querySelectorAll('.set-prov .set-chip')].every(c => c.textContent !== '…'));
    expect(asked.filter(a => a.url.includes('/api/'))).toEqual([]);
    expect(statusLines().Mac).toMatch(/not connected to a Mac/);
    const claude = [...root.querySelectorAll('.set-prov')].find(r => r.querySelector('.set-prov-name')?.textContent?.startsWith('Claude'))!;
    expect(claude.querySelector('.set-chip')?.textContent).toBe('Connect your Mac');
    expect(root.textContent).toMatch(/Not connected\. Without a Mac/);
    expect(q('.set-link').closest<HTMLElement>('.set-row')!.hidden).toBe(true);
    expect(button('Disconnect').hidden).toBe(true);
  });

  it('connects once from the address field, checks the Mac without credentials, and shows its status', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    q<HTMLInputElement>('.set-address').value = 'my-mac.tail1234.ts.net:8443';
    button('Connect').click();
    await until(() => connectedMac() === MAC);
    const probe = asked.find(a => a.url === `${MAC}/api/private-status`)!;
    expect(probe.init?.credentials).toBe('omit');
    await until(() => statusLines().Mac === 'Reachable');
    expect(statusLines()['Claude key']).toBe('Set up on the Mac');
    expect(statusLines().Today).toMatch(/12 requests, 3,400 input and 560 output tokens of 3,000 requests and 3,000,000 input tokens/);
    const claude = [...root.querySelectorAll('.set-prov')].find(r => r.querySelector('.set-prov-name')?.textContent?.startsWith('Claude'))!;
    await until(() => claude.querySelector('.set-chip')?.textContent === 'Ready');
    expect(root.textContent).toMatch(/Connected to my-mac\.tail1234\.ts\.net:8443/);
    expect(button('Disconnect').hidden).toBe(false);
    // The settings and any backup never hold the address.
    expect(localStorage.getItem('dushu.settings.v1') ?? '').not.toContain('ts.net');
    button('Disconnect').click();
    expect(connectedMac()).toBeNull();
  });

  it('refuses an address that is not a Tailscale name, without any request', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    q<HTMLInputElement>('.set-address').value = 'https://evil.example';
    button('Connect').click();
    await flush();
    expect(root.querySelector('.set-mac-result.set-bad')?.textContent).toMatch(/Tailscale address/);
    expect(connectedMac()).toBeNull();
    expect(asked.filter(a => a.url.includes('evil'))).toEqual([]);
  });

  it('says what is wrong when the Mac is off or refuses this device', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    q<HTMLInputElement>('.set-address').value = MAC;
    mac.down = true;
    button('Connect').click();
    await until(() => !!root.querySelector('.set-mac-result.set-bad'));
    expect(root.querySelector('.set-mac-result.set-bad')?.textContent).toMatch(/Could not reach your Mac.*Tailscale/);
    expect(connectedMac()).toBeNull();
    mac.down = false;
    mac.refuse = true;
    button('Connect').click();
    await until(() => /did not accept this device/.test(root.querySelector('.set-mac-result')?.textContent ?? ''));
    expect(connectedMac()).toBeNull();
  });

  it('shows a Mac that is unreachable, has no key, or reached its daily limit', async () => {
    localStorage.setItem('dushu.mac-bridge.v1', MAC);
    mac.down = true;
    cleanup = await mountSettings(root, {}, ctx);
    await until(() => /Not reachable/.test(statusLines().Mac ?? ''));
    mac.down = false;
    mac.status = { configured: false, problem: 'No Claude key is set up on your Mac. Save it in ~/.config/dushu/anthropic-api-key.' };
    button('Check again').click();
    await until(() => !!statusLines()['Claude key']?.startsWith('No Claude key'));
    const chip = () => [...root.querySelectorAll('.set-prov')].find(r => r.querySelector('.set-prov-name')?.textContent?.startsWith('Claude'))!.querySelector('.set-chip')?.textContent;
    expect(chip()).toBe('No key on the Mac');
    mac.status = { configured: true, limitReached: true, limitMessage: 'Today\'s Claude limit on your Mac (3,000 requests) is used up. It resets at midnight. Local only still works.',
      usage: { day: 'd', requests: 3000, inputTokens: 1, outputTokens: 1 } };
    button('Check again').click();
    await until(() => !!statusLines().Limit);
    expect(chip()).toBe('Daily limit used');
  });

  it('turns Local only on and off, marks Claude and MyMemory, and stops the Claude test', async () => {
    localStorage.setItem('dushu.mac-bridge.v1', MAC);
    cleanup = await mountSettings(root, {}, ctx);
    const chips = () => Object.fromEntries([...root.querySelectorAll('.set-prov')].map(r => [r.querySelector('.set-prov-name')?.textContent, r.querySelector('.set-chip')?.textContent]));
    await until(() => chips()['Claude (through your Mac)'] === 'Ready');
    const toggle = q<HTMLInputElement>('input[aria-label^="Local only"]');
    expect(toggle.checked).toBe(false);
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    expect(ctx.settings.get().localOnly).toBe(true);
    await until(() => chips()['Claude (through your Mac)'] === 'Local only is on');
    expect(chips().MyMemory).toBe('Local only is on');
    expect(button('Test Claude').disabled).toBe(true);
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await until(() => chips()['Claude (through your Mac)'] === 'Ready');
    expect(button('Test Claude').disabled).toBe(false);
  });

  it('tests Claude through the Mac with one short sentence', async () => {
    localStorage.setItem('dushu.mac-bridge.v1', MAC);
    cleanup = await mountSettings(root, {}, ctx);
    await until(() => statusLines().Mac === 'Reachable');
    button('Test Claude').click();
    await until(() => !!root.querySelector('.set-test-out.set-good'));
    expect(root.querySelector('.set-test-out.set-good')?.textContent).toContain('Hello, world.');
    const call = asked.find(a => a.url === `${MAC}/api/claude/translate`)!;
    expect(call.init?.credentials).toBe('omit');
    expect(String(call.init?.body)).toContain('你好，世界。');
  });

  it('asks before trusting an address that came in a link, then removes it from the address bar', async () => {
    cleanup = await mountSettings(root, { connect: MAC }, ctx);
    expect(location.hash).toBe('#/settings');
    expect(location.href).not.toContain('ts.net');
    const card = q('.set-pending');
    expect(card.hidden).toBe(false);
    expect(card.textContent).toContain('Connect this device to my-mac.tail1234.ts.net:8443?');
    expect(connectedMac()).toBeNull();
    expect(asked.some(a => a.url.startsWith(MAC))).toBe(false);
    [...card.querySelectorAll('button')].find(b => b.textContent === 'Connect')!.click();
    await until(() => connectedMac() === MAC);
    await until(() => card.hidden);
    expect(root.querySelector('.set-mac-result.set-good')?.textContent).toMatch(/Connected/);
  });

  it('lets the person decline a link, and rejects a link that is not a Mac address', async () => {
    cleanup = await mountSettings(root, { connect: MAC }, ctx);
    [...q('.set-pending').querySelectorAll('button')].find(b => b.textContent === 'Not now')!.click();
    expect(q('.set-pending').hidden).toBe(true);
    expect(connectedMac()).toBeNull();
    if (typeof cleanup === 'function') cleanup();
    root.replaceChildren();
    cleanup = await mountSettings(root, { connect: 'https://evil.example' }, ctx);
    expect(q('.set-pending').hidden).toBe(true);
    expect(root.querySelector('.set-mac-result.set-bad')?.textContent).toMatch(/valid Mac address/);
    expect(connectedMac()).toBeNull();
  });
});
