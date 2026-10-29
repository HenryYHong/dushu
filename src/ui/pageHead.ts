// The bilingual title of a screen: the Chinese name leads (书架, 生词, 复习, 设置, 关于, 加入) and the English title follows.
// The Chinese is real text (lang="zh-Hans") for sighted readers, hidden from screen readers so the heading is announced
// once, by its English name. Styled in base.css (.page-title, .page-title-zh, .page-title-en).
import { h } from './dom';
import { lang } from '../lang/active';
import type { LangId } from '../lang/types';

/** The Chinese names of the screens, one set used everywhere. */
export const SCREEN_ZH = {
  library: '书架',
  vocab: '生词',
  review: '复习',
  settings: '设置',
  about: '关于',
  join: '加入',
} as const;

export type ScreenName = keyof typeof SCREEN_ZH;

/** The same names in each language a library can be in, set in the language's own face beside the English title. */
const SCREEN_NAMES: Record<Exclude<LangId, 'zh'>, Record<ScreenName, string>> = {
  ja: { library: '本棚', vocab: '単語', review: '復習', settings: '設定', about: '概要', join: '参加' },
  es: { library: 'Biblioteca', vocab: 'Vocabulario', review: 'Repaso', settings: 'Ajustes', about: 'Acerca de', join: 'Unirse' },
  fr: { library: 'Bibliothèque', vocab: 'Vocabulaire', review: 'Révision', settings: 'Réglages', about: 'À propos', join: 'Rejoindre' },
  de: { library: 'Bibliothek', vocab: 'Wortschatz', review: 'Wiederholen', settings: 'Einstellungen', about: 'Über', join: 'Beitreten' },
  it: { library: 'Biblioteca', vocab: 'Vocaboli', review: 'Ripasso', settings: 'Impostazioni', about: 'Informazioni', join: 'Unisciti' },
  pt: { library: 'Biblioteca', vocab: 'Vocabulário', review: 'Revisão', settings: 'Ajustes', about: 'Sobre', join: 'Entrar' },
  ru: { library: 'Библиотека', vocab: 'Слова', review: 'Повторение', settings: 'Настройки', about: 'О приложении', join: 'Вход' },
};

/** `<h1 class="page-title"><span lang="zh-Hans" aria-hidden="true">书架</span><span>Library</span></h1>` */
export function pageTitle(screen: ScreenName, english: string, tag: 'h1' | 'h2' = 'h1', cls = 'page-title'): HTMLElement {
  const L = lang();
  const native = L.id === 'zh' ? SCREEN_ZH[screen] : SCREEN_NAMES[L.id][screen];
  return h(`${tag}.${cls}`, null,
    h(L.id === 'zh' || L.id === 'ja' ? 'span.page-title-zh' : 'span.page-title-zh.page-title-native', { lang: L.id === 'zh' ? 'zh-Hans' : L.tag, 'aria-hidden': 'true' }, native),
    h('span.page-title-en', null, english));
}
