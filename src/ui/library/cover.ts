// Book covers: the real image when the book has one, otherwise a generated cover drawn in CSS (library.css):
//   classic: a thread-bound book (线装书), a dyed board, a paper title slip (题签) and four-hole stitching on the spine;
//   modern: a contemporary cloth cover, the title set across, a hairline rule, the author on its own line.
// A classic's painting (samples.ts) is not shown bare: it becomes the board of its drawn cover (setCoverArt), so it reads as
// a book's cover, title and all.
import type { BookMeta, Store } from '../../types';
import { h } from '../dom';
import type { BookEra } from './era';
import { coverChoice, coverStyleFor } from './coverStyle';
import { classicLayout, coverDye, coverHue, modernSize } from './format';
import { hasSamplePainting } from './samples';

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

/** Puts a painting under a drawn cover, as its board; the slip, stitching or title stay on top. A picture that fails is
 * dropped, and the dyed board shows. */
export function setCoverArt(cover: HTMLElement, url: string): void {
  const img = h('img.lib-cover-art-img', { alt: '', decoding: 'async' }) as HTMLImageElement;
  const shade = cover.classList.contains('lib-cover-modern') ? h('span.lib-cover-shade') : null;
  img.addEventListener('error', () => { img.remove(); shade?.remove(); cover.classList.remove('lib-cover-art'); }, { once: true });
  img.src = url;
  cover.classList.add('lib-cover-art');
  cover.prepend(...(shade ? [img, shade] : [img]));
}

/** Generated cover now; swapped for the book's own image once the store hands over its URL. */
export function bookCover(book: BookMeta, store: Store, size: 'md' | 'sm' = 'md', covers = ''): HTMLElement {
  const drawn = generatedCover(book.title, book.author, size, coverStyleFor(covers, book));
  const wrap = h(`div.lib-cover-wrap.lib-cover-wrap-${size}`, null, drawn);
  if (hasSamplePainting(book)) {
    store.books.assetUrl(book.id, book.cover!).then((url) => { if (url) setCoverArt(drawn, url); }).catch(() => {});
    return wrap;
  }
  // The book's own picture, unless the reader picked a drawn cover for it in the card's menu (some books come with ugly ones).
  if (book.cover && coverChoice(covers, book) === 'auto') {
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
