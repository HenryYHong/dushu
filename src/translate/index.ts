// Translator registry. Contract: ARCHITECTURE.md §4.7.
import type { Dictionary, Settings, Translator, TranslatorId } from '../types';
import { createChromeTranslator } from './chrome';
import { createClaudeTranslator } from './claude';
import { createAccountTranslator } from './account';
import { createGlossTranslator } from './gloss';
import { createMyMemoryTranslator } from './mymemory';
import { createLocalTranslator, qualityLocalAvailable } from './localMeaning';
import { isChinese, langId } from '../lang/active';
import { targetFor } from './targets';

export type { ChromeTranslator } from './chrome';
export { chromeSupported } from './chrome';

// Chrome's on-device models are cached in chrome.ts for the whole page, one per language pair, so a translator made for each
// call shares them.
const mymemory = createMyMemoryTranslator();
const local = createLocalTranslator();

/**
 * The language this library's sentences go into: the reader's choice, or English when they chose none or chose the book's own
 * language (a Spanish reader's Spanish books still translate into English).
 */
export function translateTarget(settings: Pick<Settings, 'translateTo'>): string {
  return targetFor(settings.translateTo, langId());
}

export const TRANSLATOR_IDS: TranslatorId[] = ['local', 'chrome', 'claude', 'account', 'mymemory', 'gloss'];

export function getTranslator(id: TranslatorId, settings: Settings, dict: Dictionary | null): Translator {
  switch (id) {
    case 'local': return local;
    case 'chrome': return createChromeTranslator(translateTarget(settings));
    case 'claude': return createClaudeTranslator(settings);
    case 'account': return createAccountTranslator(settings);
    case 'mymemory': return settings.localOnly ? withoutThirdParty(mymemory) : mymemory;
    case 'gloss': return createGlossTranslator(dict, undefined, translateTarget(settings));
  }
}

/** With Local only on, a service that sends text to a third party is unavailable and refuses to run. */
function withoutThirdParty(translator: Translator): Translator {
  return {
    id: translator.id,
    label: translator.label,
    availability: async () => 'no',
    translate: async () => { throw new Error('Local only is on, so this sentence stays on your Mac. Turn it off in Settings to use this service.'); },
  };
}

/**
 * An explicit choice is honored as is. 'auto' prefers Claude (the owner's, unless Local only is on), then the evaluated
 * Qwen3.5 9B local model on the Mac, then Qwen through the account (anyone signed in, unless Local only is on), ready Chrome,
 * smaller local models, downloadable Chrome, and the dictionary gloss. It never picks MyMemory because that sends text to a
 * third party; the user has to choose it.
 */
export async function pickTranslator(settings: Settings, dict: Dictionary | null): Promise<Translator> {
  if (settings.translator !== 'auto') return getTranslator(settings.translator, settings, dict);
  if (!settings.localOnly) {
    const claude = getTranslator('claude', settings, dict);
    if (await claude.availability() === 'yes') return claude;
  }
  // The Mac's local model was measured on Chinese books only; another language goes to it only when chosen.
  if (isChinese() && await qualityLocalAvailable()) return local;
  const account = getTranslator('account', settings, dict);
  if (await account.availability() === 'yes') return account;
  const chrome = getTranslator('chrome', settings, dict);
  const chromeState = await chrome.availability();
  if (chromeState === 'yes') return chrome;
  if (isChinese() && await local.availability() === 'yes') return local;
  if (chromeState === 'download') return chrome;
  return getTranslator('gloss', settings, dict);
}

/** All translators with their current availability, for the Settings screen. */
export async function listTranslators(
  settings: Settings,
  dict: Dictionary | null,
): Promise<{ translator: Translator; availability: 'yes' | 'download' | 'no' }[]> {
  return Promise.all(TRANSLATOR_IDS.map(async id => {
    const translator = getTranslator(id, settings, dict);
    return { translator, availability: await translator.availability() };
  }));
}
