// @vitest-environment jsdom
// The welcome screen (ui/welcome.ts) as a modal dialog: Skip keeps a language already picked, or leaves a way to one; the
// translation guess follows the languages until one is picked by hand; Esc is Cancel from Settings and nothing on a first
// visit; focus goes back to the button that opened it; the last button says what it does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lang/active', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lang/active')>()),
  switchLang: vi.fn(),
}));

import { switchLang } from '../../src/lang/active';
import { showWelcome } from '../../src/ui/welcome';
import { getPlan, setPlan } from '../../src/core/plan';
import { createSettingsStore } from '../../src/store/settings';
import type { SettingsStore } from '../../src/types';

let settings: SettingsStore;
const dialog = () => document.querySelector<HTMLDialogElement>('dialog.wel');
const button = (text: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent!.trim() === text);
const card = (name: string) => [...dialog()!.querySelectorAll<HTMLButtonElement>('.wel-lang')].find((b) => b.querySelector('.wel-lang-native')!.textContent === name)!;
const primary = () => dialog()!.querySelector<HTMLButtonElement>('.wel-foot .btn-primary')!;
const esc = () => dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  localStorage.clear();
  vi.mocked(switchLang).mockClear();
  settings = createSettingsStore(localStorage, 'zh');
});
afterEach(() => {
  document.querySelectorAll('dialog, button').forEach((e) => e.remove());
  document.body.className = '';
});

describe('the welcome dialog', () => {
  it('opens as a modal dialog with focus inside, and says which step it is on', () => {
    void showWelcome(settings, { current: 'zh' });
    const d = dialog()!;
    expect(d.open).toBe(true);
    expect(d.getAttribute('aria-label')).toBe('Welcome to LinguPengu');
    expect(d.contains(document.activeElement)).toBe(true);
    expect(d.querySelector('.wel-sr')!.textContent).toBe('Step 1 of 3');
    expect(document.body.classList.contains('wel-open')).toBe(true);
    // Skip is a quiet button in either theme.
    expect(button('Skip')!.classList.contains('btn-ghost')).toBe(true);
  });

  it('Skip after picking Spanish opens the Spanish library', async () => {
    void showWelcome(settings, { current: 'zh' });
    card('Español').click();
    button('Skip')!.click();
    expect(switchLang).toHaveBeenCalledWith('es');
    expect(getPlan()).toMatchObject({ langs: ['es'] });
    expect(getPlan().welcomed).toBeGreaterThan(0);
  });

  it('Skip with nothing picked stays here and shows the language chip from then on', async () => {
    let done = false;
    void showWelcome(settings, { current: 'zh' }).then(() => { done = true; });
    button('Skip')!.click();
    await flush();
    expect(done).toBe(true);
    expect(switchLang).not.toHaveBeenCalled();
    expect(localStorage.getItem('dushu.langs-used.v1')).toBe('1');
    expect(getPlan().welcomed).toBeGreaterThan(0);
    expect(dialog()).toBeNull();
    expect(document.body.classList.contains('wel-open')).toBe(false);
  });

  it('keeps languages as they are picked, so a reload in the middle comes back to them', () => {
    void showWelcome(settings, { current: 'zh' });
    card('Español').click();
    card('日本語').click();
    expect(getPlan()).toMatchObject({ langs: ['es', 'ja'], welcomed: 0 });
    dialog()!.remove();
    void showWelcome(settings, { current: 'zh' });
    expect(card('Español').getAttribute('aria-pressed')).toBe('true');
    expect(card('日本語').getAttribute('aria-pressed')).toBe('true');
  });

  it('guesses the translation language again after Back, unless one was picked by hand', () => {
    void showWelcome(settings, { current: 'zh' }); // jsdom's browser speaks English
    card('English').click();
    primary().click();
    const select = () => dialog()!.querySelector<HTMLSelectElement>('select.wel-select')!;
    expect(select().value).toBe('en'); // an English browser learning English: their own language, meanings in simple English
    button('Back')!.click();
    card('English').click();
    card('Español').click();
    primary().click();
    expect(select().value).toBe('en');
    // Picked by hand: kept through Back and another language.
    select().value = 'fr';
    select().dispatchEvent(new Event('change'));
    button('Back')!.click();
    card('Deutsch').click();
    primary().click();
    expect(select().value).toBe('fr');
  });

  it('says the own-language fallback the way the translator does it', () => {
    void showWelcome(settings, { current: 'zh' });
    card('Español').click();
    card('English').click();
    primary().click();
    const select = dialog()!.querySelector<HTMLSelectElement>('select.wel-select')!;
    select.value = 'es';
    select.dispatchEvent(new Event('change'));
    expect(dialog()!.querySelector('.wel-warn')!.textContent).toBe('Spanish books will be translated into English instead.');
    select.value = 'en';
    select.dispatchEvent(new Event('change'));
    expect(dialog()!.querySelector('.wel-warn')!.textContent).toBe('English books will be translated into Simplified Chinese instead.');
  });

  it('Esc does nothing on a first visit, and never counts as Skip', async () => {
    let done = false;
    void showWelcome(settings, { current: 'zh' }).then(() => { done = true; });
    esc();
    dialog()!.dispatchEvent(new Event('cancel', { cancelable: true }));
    await flush();
    expect(done).toBe(false);
    expect(dialog()!.open).toBe(true);
    expect(getPlan().welcomed).toBe(0);
  });

  it('from Settings, Esc is Cancel: nothing changes and focus goes back to Show it again', async () => {
    setPlan({ langs: ['es'], goal: 15, welcomed: 5 });
    const opener = document.body.appendChild(document.createElement('button'));
    opener.textContent = 'Show it again';
    opener.focus();
    let done = false;
    void showWelcome(settings, { current: 'es', again: true }).then(() => { done = true; });
    expect(dialog()!.contains(document.activeElement)).toBe(true);
    expect(button('Cancel')).toBeTruthy();
    card('Français').click();
    esc();
    await flush();
    expect(done).toBe(true);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(getPlan()).toMatchObject({ langs: ['es'], goal: 15, welcomed: 5 });
  });

  it('names the last button for what it does: Go to my library first, Done from Settings', () => {
    void showWelcome(settings, { current: 'zh' });
    card('Español').click();
    primary().click();
    primary().click();
    expect(primary().textContent).toBe('Go to my library');
    dialog()!.remove();
    setPlan({ langs: ['ja', 'es'], welcomed: 5 });
    void showWelcome(settings, { current: 'es', again: true });
    primary().click();
    primary().click();
    expect(primary().textContent).toBe('Done');
    // The open library is still one being learned: Done stays in it.
    primary().click();
    expect(switchLang).not.toHaveBeenCalled();
    expect(dialog()).toBeNull();
  });

  it('from Settings, Done moves only when the open library was dropped', () => {
    setPlan({ langs: ['ja', 'es'], welcomed: 5 });
    void showWelcome(settings, { current: 'es', again: true });
    card('Español').click();
    primary().click();
    primary().click();
    primary().click();
    expect(switchLang).toHaveBeenCalledWith('ja');
    expect(getPlan().langs).toEqual(['ja']);
  });

  it('makes the daily goals one radio group the arrows move through', () => {
    void showWelcome(settings, { current: 'zh' });
    card('Español').click();
    primary().click();
    primary().click();
    const group = dialog()!.querySelector('[role=radiogroup]')!;
    expect(group.getAttribute('aria-label')).toBe('Daily goal');
    const radios = [...group.querySelectorAll<HTMLButtonElement>('[role=radio]')];
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false', 'false', 'false', 'false']);
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, 0, -1, -1, -1, -1]);
    radios[1].focus();
    radios[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(radios[2]);
    expect(radios[2].getAttribute('aria-checked')).toBe('true');
    radios[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    // The last is Custom: its field shows, for any number of minutes.
    expect(radios[5].getAttribute('aria-checked')).toBe('true');
    expect(radios.map((r) => r.tabIndex)).toEqual([-1, -1, -1, -1, -1, 0]);
    const own = dialog()!.querySelector<HTMLInputElement>('.goal-input')!;
    expect(own.closest<HTMLElement>('.goal-own')!.hidden).toBe(false);
    own.value = '45';
    own.dispatchEvent(new Event('change'));
    primary().click();
    expect(getPlan().goal).toBe(45);
  });

  it('says English once on the English card', () => {
    void showWelcome(settings, { current: 'zh' });
    const en = card('English');
    expect(en.querySelector('.wel-lang-name')).toBeNull();
    expect(card('Español').querySelector('.wel-lang-name')!.textContent).toBe('Spanish');
  });
});
