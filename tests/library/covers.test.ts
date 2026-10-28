// @vitest-environment jsdom
// Generated covers: which family a book gets (era.ts), the reader's own pick (coverStyle.ts), and how each family sets
// its title (format.ts, cover.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { bookEra, isClassicalAuthor } from '../../src/ui/library/era';
import { coverChoice, coverStyleFor, withCoverChoice } from '../../src/ui/library/coverStyle';
import { MAX_COVER_PICKS, cleanCovers, parseCovers } from '../../src/core/covers';
import { classicLayout, coverDye, hasLatin, modernSize, titleUnits } from '../../src/ui/library/format';
import { generatedCover } from '../../src/ui/library/cover';

afterEach(() => localStorage.clear());

describe('book era', () => {
  it('follows the bundled classics by their sample id', () => {
    for (const id of ['tang-poems', 'lunyu-xue-er', 'xiyouji-1', 'xiyouji', 'hongloumeng', 'sanguo', 'shuihu']) {
      expect(bookEra({ title: 'x', author: '', sourceName: `sample:${id}` }), id).toBe('classic');
    }
    for (const id of ['guxiang', 'kong-yiji', 'kuangren-riji']) {
      // Lu Xun is modern even though his title or a future author field might look old.
      expect(bookEra({ title: 'x', author: '〔清〕某', sourceName: `sample:${id}` }), id).toBe('modern');
    }
  });

  it('matches a classic that lost its sample id by title and author', () => {
    expect(bookEra({ title: '論語·學而', author: '孔子弟子' })).toBe('classic');
    expect(bookEra({ title: '唐詩八首', author: '李白、王維等' })).toBe('classic');
    expect(bookEra({ title: '故乡', author: '鲁迅' })).toBe('modern');
  });

  it('reads a dynasty marker in brackets of any width, or before the name with a dot or a space', () => {
    for (const a of ['〔清〕曹某', '[明] 某人', '(唐)某', '（宋）某人', '【元】某', '〈晉〉某', '唐·李某', '唐・某', '清 某某', '明　某某', '南宋·某', '東漢 某', '先秦·佚名', '五代 某']) {
      expect(isClassicalAuthor(a), a).toBe(true);
    }
  });

  it('knows the classical authors in either script, with a role after the name', () => {
    for (const a of ['曹雪芹', '曹雪芹、高鶚', '吳承恩', '吴承恩 著', '羅貫中', '施耐庵', '蒲松齡', '吴敬梓', '李汝珍', '劉鶚', '孔子', '莊子', '韓非子', '司馬遷', '杜甫', '王維等', '蘇軾', '辛弃疾', '陶淵明', '屈原', '孔子弟子']) {
      expect(isClassicalAuthor(a), a).toBe(true);
    }
  });

  it('calls everything else modern, including novels with 第N回 chapters', () => {
    expect(bookEra({ title: '活着', author: '余华' })).toBe('modern');
    expect(bookEra({ title: '射雕英雄传', author: '金庸' })).toBe('modern');
    expect(bookEra({ title: '第一回 风雪惊变', author: '金庸' })).toBe('modern');
    for (const a of ['', '鲁迅', '(美) 海明威', '[英] 狄更斯', '【金庸】', '李白云', 'Anonymous']) expect(isClassicalAuthor(a), a).toBe(false);
  });
});

describe('the cover menu pick', () => {
  const book = { id: 'b1', title: '活着', author: '余华', note: `mac-book:${'ab'.repeat(32)}`, importVersion: 2, chapterCount: 1, charCount: 10 };
  it('is automatic until chosen, is kept by the book\'s sync key, and forgets itself on Automatic', () => {
    expect(coverChoice('', book)).toBe('auto');
    expect(coverStyleFor('', book)).toBe('modern');
    const picked = withCoverChoice('', book, 'classic');
    expect(picked).toBe(`m${'ab'.repeat(16)}.2:classic`);
    expect(coverChoice(picked, book)).toBe('classic');
    expect(coverStyleFor(picked, book)).toBe('classic');
    expect(withCoverChoice(picked, book, 'auto')).toBe('');
    // The same book on another device (another local id) has the same pick.
    const elsewhere: typeof book = { ...book, id: 'other' };
    expect(coverChoice(picked, elsewhere)).toBe('classic');
  });
  it('ignores damaged entries, keeps the latest pick per book, and stays small', () => {
    expect(cleanCovers('x:glossy,,bad entry,k1:modern,k1:classic')).toBe('k1:classic');
    expect(cleanCovers(3)).toBeUndefined();
    const many = Array.from({ length: MAX_COVER_PICKS + 5 }, (_, i) => `k${i}:modern`).join(',');
    const kept = parseCovers(many);
    expect(kept.size).toBe(MAX_COVER_PICKS);
    expect(kept.has('k0')).toBe(false);
    expect(kept.has(`k${MAX_COVER_PICKS + 4}`)).toBe(true);
  });
});

describe('cover layouts', () => {
  it('dyes covers from a short list of book cloths, the same every time', () => {
    expect(coverDye('紅樓夢', '曹雪芹')).toBe(coverDye('紅樓夢', '曹雪芹'));
    const bands = [262, 332, 50, 166, 222, 22, 292];
    for (const t of ['活着', '孔乙己', '故乡', '狂人日记', '紅樓夢', '水滸傳', '三國演義', '西遊記', 'A Tale']) {
      const d = coverDye(t);
      expect(bands.some((b) => Math.abs(d - b) <= 6), `${t} ${d}`).toBe(true);
    }
  });

  it('sets up to eight CJK characters down a vertical slip, and long or Latin titles across', () => {
    expect(classicLayout('紅樓夢', '曹雪芹').slip).toBe('v');
    expect(classicLayout('西遊記 第一回', '吳承恩').slip).toBe('v');
    expect(classicLayout('歷代名人年譜總目錄全編', '').slip).toBe('h');
    expect(classicLayout('The Story of the Stone', 'Cao Xueqin').slip).toBe('h');
    expect(classicLayout('1984', '').slip).toBe('h');
    expect(hasLatin('三体2')).toBe(false);
    // Shorter titles are set larger; the author stays on the slip only when it fits under the title.
    expect(classicLayout('詩經').size).toBeGreaterThan(classicLayout('西遊記 第一回').size);
    expect(classicLayout('西遊記', '吳承恩').author).toBe(true);
    expect(classicLayout('西遊記 第一回', '曹雪芹、高鶚、程偉元').author).toBe(false);
  });

  it('shrinks a horizontal title with its length, down to a floor that still fits the cover', () => {
    expect(modernSize('活着')).toBeGreaterThan(modernSize('射雕英雄传'));
    expect(modernSize('射雕英雄传')).toBeGreaterThan(modernSize('A Very Long Title About Many Things In The World'));
    expect(modernSize('x'.repeat(400))).toBeGreaterThanOrEqual(5);
    expect(titleUnits('ab')).toBeLessThan(titleUnits('活着'));
  });

  it('draws the two families with their own parts', () => {
    const classic = generatedCover('紅樓夢', '曹雪芹', 'md', 'classic');
    expect(classic.classList.contains('lib-cover-classic')).toBe(true);
    expect(classic.classList.contains('lib-slip-v')).toBe(true);
    expect(classic.getAttribute('aria-hidden')).toBe('true');
    const latin = generatedCover('The Story of the Stone', 'Cao Xueqin', 'md', 'classic');
    expect(latin.classList.contains('lib-slip-h')).toBe(true);
    const modern = generatedCover('活着', '余华', 'md', 'modern');
    expect(modern.classList.contains('lib-cover-modern')).toBe(true);
    expect(modern.querySelector('.lib-cover-rule')).not.toBeNull();
    expect(modern.querySelector('.lib-cover-author')?.textContent).toBe('余华');
    expect(modern.style.getPropertyValue('--lib-dye')).not.toBe('');
  });
});
