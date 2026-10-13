// Book covers: the real image when the book has one, otherwise a generated tinted cover with the title.
import type { BookMeta, Store } from '../../types';
import { h } from '../dom';
import { coverHue, titleSize } from './format';

/** Generated cover. Pure DOM, no network; the tint comes from a hash of the title. */
export function generatedCover(title: string, author: string, size: 'md' | 'sm' = 'md'): HTMLElement {
  return h(`div.lib-cover.lib-cover-${size}`, { style: `--lib-hue:${coverHue(title, author)};--lib-fs:${titleSize(title)}cqw`, 'aria-hidden': 'true' },
    h('div.lib-cover-frame', null,
      h('div.lib-cover-title.zh', null, title),
      author ? h('div.lib-cover-author', null, author) : null));
}

/** Generated cover now; swapped for the book's own image once the store hands over its URL. */
export function bookCover(book: BookMeta, store: Store, size: 'md' | 'sm' = 'md'): HTMLElement {
  const wrap = h(`div.lib-cover-wrap.lib-cover-wrap-${size}`, null, generatedCover(book.title, book.author, size));
  if (book.cover) {
    store.books.assetUrl(book.id, book.cover).then((url) => {
      if (!url || !wrap.isConnected) return;
      const img = h('img.lib-cover-img', { alt: '', decoding: 'async' }) as HTMLImageElement;
      img.addEventListener('load', () => { wrap.replaceChildren(img); }, { once: true });
      // Not lazy: it is not in the page until it has loaded. On error the generated cover simply stays.
      img.src = url;
    }).catch(() => { /* keep the generated cover */ });
  }
  return wrap;
}
