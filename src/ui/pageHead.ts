// The bilingual title of a screen: the Chinese name leads (书架, 生词, 复习, 设置, 关于) and the English title follows.
// The Chinese is real text (lang="zh-Hans") for sighted readers, hidden from screen readers so the heading is announced
// once, by its English name. Styled in base.css (.page-title, .page-title-zh, .page-title-en).
import { h } from './dom';

/** The Chinese names of the screens, one set used everywhere. */
export const SCREEN_ZH = {
  library: '书架',
  vocab: '生词',
  review: '复习',
  settings: '设置',
  about: '关于',
} as const;

export type ScreenName = keyof typeof SCREEN_ZH;

/** `<h1 class="page-title"><span lang="zh-Hans" aria-hidden="true">书架</span><span>Library</span></h1>` */
export function pageTitle(screen: ScreenName, english: string, tag: 'h1' | 'h2' = 'h1', cls = 'page-title'): HTMLElement {
  return h(`${tag}.${cls}`, null,
    h('span.page-title-zh', { lang: 'zh-Hans', 'aria-hidden': 'true' }, SCREEN_ZH[screen]),
    h('span.page-title-en', null, english));
}
