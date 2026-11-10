// Choosing the language to read in. Each language is its own library (lang/active.ts), so switching reloads the app there.
import { h } from './dom';
import { icon } from './icons';
import { LANGS, LANG_IDS } from '../lang/registry';
import { isChinese, langId, switchLang } from '../lang/active';
import type { LangId } from '../lang/types';
import { getPlan } from '../core/plan';
import { langName, tt } from '../i18n';

/** Set once this device has read a language other than Chinese: from then on the bar shows which language is open. */
const USED_KEY = 'dushu.langs-used.v1';

/** Shows the language chip from now on, for someone who skipped the welcome without picking a language: it is how they find one. */
export function markLangChoice(): void {
  try { localStorage.setItem(USED_KEY, '1'); } catch { /* the chip waits for another language */ }
}

function usedOther(): boolean {
  // Learning a language other than Chinese, or more than one (the welcome screen or Settings).
  const learning = getPlan().langs;
  if (learning.length > 1 || learning.some((l) => l !== 'zh')) return true;
  try {
    if (!isChinese()) localStorage.setItem(USED_KEY, '1');
    return localStorage.getItem(USED_KEY) === '1';
  } catch { return !isChinese(); }
}

/** A native select of every language, so a phone shows its own picker. Picking one opens that language's library. */
export function langSelect(cls = ''): HTMLSelectElement {
  const option = (id: LangId) => {
    const L = LANGS[id];
    // Its own name, then its name in the app's language (said once when they are the same: English in English, 中文 in Chinese).
    const name = langName(id, L.name);
    return h('option', { value: id, selected: id === langId() }, L.native.toLowerCase() === name.toLowerCase() ? L.native : `${L.native} · ${name}`);
  };
  // The languages being learned first, in the order chosen, then the rest.
  const learning = getPlan().langs;
  const rest = LANG_IDS.filter((id) => !learning.includes(id));
  const sel = h('select', { class: cls || null, 'aria-label': tt('Language you are reading') },
    ...(learning.length && rest.length
      ? [h('optgroup', { label: tt('Learning') }, learning.map(option)), h('optgroup', { label: tt('More languages') }, rest.map(option))]
      : LANG_IDS.map(option)));
  sel.addEventListener('change', () => { if (sel.value !== langId()) switchLang(sel.value as LangId); });
  return sel;
}

/**
 * The language in the top bar, beside the name. Someone who has only ever read Chinese never sees it (Settings has the
 * same choice); after a first visit to another language it stays, so it is always clear which library is open.
 */
export function langChip(): HTMLElement | null {
  if (!usedOther()) return null;
  const L = LANGS[langId()];
  return h('label.app-lang', { title: tt('Language') },
    h('span.app-lang-name', { lang: L.tag }, L.native), h('span.app-lang-short', { 'aria-hidden': 'true' }, langId().toUpperCase()),
    icon('chevronDown'), langSelect('app-lang-select'));
}
