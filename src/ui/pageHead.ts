// The bilingual title of a screen: the screen's name in the library's language leads (书架 in the Chinese library, Biblioteca in
// the Spanish one) and the title in the app's language follows (the caller passes it through tt). The name is real text for
// sighted readers, hidden from screen readers so the heading is announced once, by the app's name for it; when it says what
// the title says (the app in Chinese, in the Chinese library) it is shown once. Styled in base.css (.page-title,
// .page-title-zh, .page-title-en).
import { h } from './dom';
import { lang } from '../lang/active';
import type { LangId } from '../lang/types';
import { sharedTarget } from '../store/settings';
import { targetFor } from '../translate/targets';

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
  en: { library: 'Library', vocab: 'Vocabulary', review: 'Review', settings: 'Settings', about: 'About', join: 'Join' },
};

/** The English library read by someone whose translations go into Chinese (its first readers): its screens keep their Chinese names. */
const intoChinese = (): boolean => targetFor(sharedTarget()?.to ?? 'zh', 'en').startsWith('zh');

/** `<h1 class="page-title"><span lang="zh-Hans" aria-hidden="true">书架</span><span>Library</span></h1>` */
export function pageTitle(screen: ScreenName, title: string, tag: 'h1' | 'h2' = 'h1', cls = 'page-title'): HTMLElement {
  const L = lang();
  const zh = L.id === 'zh' || (L.id === 'en' && intoChinese());
  const native = zh ? SCREEN_ZH[screen] : SCREEN_NAMES[L.id as Exclude<LangId, 'zh'>][screen];
  // Said once when the title already says it: Library and Library, About and About Globereader.
  return h(`${tag}.${cls}`, null,
    title.toLowerCase().startsWith(native.toLowerCase()) ? null
      : h(zh || L.id === 'ja' ? 'span.page-title-zh' : 'span.page-title-zh.page-title-native', { lang: zh ? 'zh-Hans' : L.tag, 'aria-hidden': 'true' }, native),
    h('span.page-title-en', null, title));
}
