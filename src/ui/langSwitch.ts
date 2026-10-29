// Choosing the language to read in. Each language is its own library (lang/active.ts), so switching reloads the app there.
import { h } from './dom';
import { icon } from './icons';
import { LANGS, LANG_IDS } from '../lang/registry';
import { isChinese, langId, switchLang } from '../lang/active';
import type { LangId } from '../lang/types';

/** Set once this device has read a language other than Chinese: from then on the bar shows which language is open. */
const USED_KEY = 'dushu.langs-used.v1';

function usedOther(): boolean {
  try {
    if (!isChinese()) localStorage.setItem(USED_KEY, '1');
    return localStorage.getItem(USED_KEY) === '1';
  } catch { return !isChinese(); }
}

/** A native select of every language, so a phone shows its own picker. Picking one opens that language's library. */
export function langSelect(cls = ''): HTMLSelectElement {
  const sel = h('select', { class: cls || null, 'aria-label': 'Language you are reading' },
    ...LANG_IDS.map((id) => h('option', { value: id, selected: id === langId() }, `${LANGS[id].native} · ${LANGS[id].name}`)));
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
  return h('label.app-lang', { title: 'Language' },
    h('span.app-lang-name', { lang: L.tag }, L.native), icon('chevronDown'), langSelect('app-lang-select'));
}
