// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://henryyhong.com/dushu/#/settings" }
// Settings as a visitor to the public site sees it: a Sync section without the owner's Mac setup (folded under "Use your own
// Mac", opened by a link from the Mac), Sync now only when there is something to sync with, the daily goal as one radio group,
// a Learning section that lets go of its listener, and the hints line in plain grammar.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVITY_EVENT } from '../../src/core/activity';
import { getPlan } from '../../src/core/plan';
import { startSync, type Syncer } from '../../src/core/sync';
import { setLangForTests } from '../../src/lang/active';
import { openStore } from '../../src/store';
import { createSettingsStore } from '../../src/store/settings';
import { resetClaudeStatus } from '../../src/translate/claude';
import type { AppContext } from '../../src/types';
import { loadTestDictionary, readDataFile } from '../helpers/data';
import { mount as mountSettings } from '../../src/ui/settings/settings';

let root: HTMLElement;
let ctx: AppContext;
let cleanup: void | (() => void);
let syncer: Syncer | null = null;

beforeEach(async () => {
  localStorage.clear();
  resetClaudeStatus();
  root = document.createElement('div');
  document.body.appendChild(root);
  const dict = await loadTestDictionary();
  ctx = { dict: () => Promise.resolve(dict), dictSync: () => dict, settings: createSettingsStore(), store: await openStore(`set-${Math.random()}`), navigate: () => {}, toast: () => {} };
  vi.stubGlobal('fetch', async (url: string) => {
    if (String(url).endsWith('data/meta.json')) return { ok: true, text: async () => readDataFile('meta.json') };
    throw new TypeError('Failed to fetch');
  });
}, 30000);

afterEach(async () => {
  if (typeof cleanup === 'function') cleanup();
  cleanup = undefined;
  await syncer?.stop();
  syncer = null;
  root.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLangForTests(null);
  localStorage.clear();
});

const section = (id: string) => root.querySelector<HTMLElement>(`#${id}`)!;
const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === label)!;

describe('the Sync section for a visitor', () => {
  it('is called Sync in the list, and keeps the owner’s Mac setup folded', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    const sync = section('set-ipad');
    expect(sync.querySelector('h2')?.textContent).toBe('Sync');
    expect([...root.querySelectorAll('.set-nav-link')].map((b) => b.textContent)).toContain('Sync');
    expect(sync.textContent).not.toMatch(/Signed in, your books/);
    const own = sync.querySelector<HTMLDetailsElement>('details.set-own-mac')!;
    expect(own.querySelector('summary')?.textContent).toBe('Use your own Mac');
    expect(own.open).toBe(false);
    // Tailscale and the Mac's address are only inside it.
    expect(own.querySelector('.set-address')).not.toBeNull();
    const outside = [...sync.querySelectorAll('.set-row')].filter((r) => !own.contains(r)).map((r) => r.textContent).join(' ');
    expect(outside).not.toMatch(/Tailscale|Mac address|private link/i);
    expect(outside).not.toMatch(/that icon/);
  });

  it('opens Use your own Mac for a link from the Mac, so the question to connect is in view', async () => {
    cleanup = await mountSettings(root, { connect: 'https://my-mac.tail1234.ts.net:8443' }, ctx);
    const own = section('set-ipad').querySelector<HTMLDetailsElement>('details.set-own-mac')!;
    expect(own.open).toBe(true);
    expect(own.querySelector<HTMLElement>('.set-pending')!.hidden).toBe(false);
  });

  it('turns Sync now off while there is nothing to sync with, and says to sign in', async () => {
    syncer = startSync(ctx.store, { everyMs: 0 });
    await syncer.run();
    cleanup = await mountSettings(root, {}, ctx);
    expect(button('Sync now').disabled).toBe(true);
    expect(root.querySelector('.set-sync-status')?.textContent).toMatch(/^Sign in above/);
    // The switch is named by its row's title, not "Sync with your Mac".
    const input = root.querySelector<HTMLInputElement>('.set-sync input[role="switch"]')!;
    expect(input.hasAttribute('aria-label')).toBe(false);
    expect(document.getElementById(input.getAttribute('aria-labelledby')!)?.textContent).toBe('Sync');
  });
});

describe('the daily goal', () => {
  it('is one radio group: one tab stop, and the arrow keys move the goal', async () => {
    cleanup = await mountSettings(root, {}, ctx);
    const goal = root.querySelector<HTMLElement>('[role="radiogroup"][aria-label="Daily goal"]')!;
    const radios = [...goal.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    const stops = () => radios.filter((b) => b.tabIndex === 0).map((b) => b.textContent);
    expect(stops()).toEqual(['10 min']);
    expect(radios.find((b) => b.getAttribute('aria-checked') === 'true')?.textContent).toBe('10 min');
    radios[1].focus();
    goal.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(getPlan().goal).toBe(15);
    expect(document.activeElement?.textContent).toBe('15 min');
    expect(stops()).toEqual(['15 min']);
    expect(radios.find((b) => b.getAttribute('aria-checked') === 'true')?.textContent).toBe('15 min');
  });

  it('lets go of its listener when Settings closes', async () => {
    const added = vi.spyOn(window, 'addEventListener');
    const removed = vi.spyOn(window, 'removeEventListener');
    for (let i = 0; i < 3; i++) {
      const done = await mountSettings(root, {}, ctx);
      if (typeof done === 'function') done();
      root.replaceChildren();
    }
    const count = (spy: typeof added) => spy.mock.calls.filter(([type]) => type === ACTIVITY_EVENT).length;
    expect(count(added)).toBe(3);
    expect(count(removed)).toBe(3);
  });
});

describe('the hints line', () => {
  it('says the hints are hidden, in the plural', async () => {
    setLangForTests('es');
    ctx.settings = createSettingsStore(localStorage, 'es');
    ctx.settings.set({ pinyin: 'hsk' });
    cleanup = await mountSettings(root, {}, ctx);
    const known = [...root.querySelectorAll('.set-row')].find((r) => r.querySelector('.set-label')?.textContent === 'Known up to')!;
    expect(known.querySelector('.set-help')?.textContent).toMatch(/^Hints are hidden on words up to this level\./);
  });
});
