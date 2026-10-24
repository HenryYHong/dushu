// Book covers: the real image when the book has one, otherwise a generated cover drawn in CSS (library.css):
//   classic: a thread-bound book (线装书), a dyed board, a paper title slip (题签) and four-hole stitching on the spine;
//   modern: a contemporary cloth cover, the title set across, a hairline rule, the author on its own line.
import type { BookMeta, Store } from '../../types';
import { h } from '../dom';
import type { BookEra } from './era';
import { coverStyleFor } from './coverStyle';
import { classicLayout, coverDye, coverHue, modernSize } from './format';

/** Generated cover. Pure DOM, no network; the dye comes from a hash of the title and author. */
export function generatedCover(title: string, author: string, size: 'md' | 'sm' = 'md', style: BookEra = 'modern'): HTMLElement {
  const vars = `--lib-hue:${coverHue(title, author)};--lib-dye:${coverDye(title, author)}`;
  if (style === 'classic') {
    const l = classicLayout(title, author);
    return h(`div.lib-cover.lib-cover-${size}.lib-cover-classic.lib-slip-${l.slip}`, { style: `${vars};--lib-fs:${l.size}cqw`, 'aria-hidden': 'true', 'data-cover': 'classic' },
      h('div.lib-cover-frame', null,
        h('div.lib-cover-title.zh', null, title),
        author && l.author ? h('div.lib-cover-author.zh', null, author) : null));
  }
  return h(`div.lib-cover.lib-cover-${size}.lib-cover-modern`, { style: `${vars};--lib-fs:${modernSize(title)}cqw`, 'aria-hidden': 'true', 'data-cover': 'modern' },
    h('div.lib-cover-frame', null,
      h('div.lib-cover-title.zh', null, title),
      h('span.lib-cover-rule'),
      author ? h('div.lib-cover-author.zh', null, author) : null));
}

/** Generated cover now; swapped for the book's own image once the store hands over its URL. */
export function bookCover(book: BookMeta, store: Store, size: 'md' | 'sm' = 'md'): HTMLElement {
  const wrap = h(`div.lib-cover-wrap.lib-cover-wrap-${size}`, null, generatedCover(book.title, book.author, size, coverStyleFor(book)));
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
