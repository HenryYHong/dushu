// Which kind of generated cover a book gets: a thread-bound 线装书 for a classic, a contemporary cover for everything else.
// Pure: no DOM, no storage (the per-book choice in the card menu is stored by coverStyle.ts).

export type BookEra = 'classic' | 'modern';

/** The bundled classics (public/samples/index.json), by id. A sample not listed here falls back to the rules below. */
const SAMPLE_ERA: Record<string, BookEra> = {
  'tang-poems': 'classic',
  'lunyu-xue-er': 'classic',
  'xiyouji-1': 'classic',
  xiyouji: 'classic',
  hongloumeng: 'classic',
  sanguo: 'classic',
  shuihu: 'classic',
  guxiang: 'modern',
  'kong-yiji': 'modern',
  'kuangren-riji': 'modern',
};

/** The same classics by title and author, for a copy that lost its sample id (both scripts). */
const SAMPLE_TITLES: [title: string, author: string][] = [
  ['唐詩八首', '李白、王維等'], ['唐诗八首', '李白、王维等'],
  ['論語·學而', '孔子弟子'], ['论语·学而', '孔子弟子'],
  ['西遊記 第一回', '吳承恩'], ['西游记 第一回', '吴承恩'],
];

const DYNASTIES = ['先秦', '南北朝', '五代', '秦', '汉', '漢', '魏', '晋', '晉', '隋', '唐', '宋', '辽', '遼', '金', '元', '明', '清'];
const DYNASTY = `(?:[东東西南北前后後]?(?:${DYNASTIES.join('|')})(?:代|朝)?)`;
/** A dynasty in brackets of any width: 〔清〕 [明] (唐) 【宋】 （元） 〈金〉 「晉」. */
const BRACKETED = new RegExp(`[〔［\\[（(【〖〈《「『]\\s*${DYNASTY}\\s*[〕］\\]）)】〗〉》」』]`, 'u');
/** A dynasty before the name with a dot or a space between: 唐·李白, 唐・李白, 清 曹雪芹, 明　吴承恩. */
const PREFIXED = new RegExp(`^\\s*${DYNASTY}\\s*[·・•‧．.]\\s*\\S|^\\s*${DYNASTY}[\\s\\u3000]+\\S`, 'u');

/** Classical authors, simplified and traditional. */
const CLASSICAL_AUTHORS = new Set([
  '曹雪芹', '高鹗', '高鶚', '吴承恩', '吳承恩', '罗贯中', '羅貫中', '施耐庵', '蒲松龄', '蒲松齡', '吴敬梓', '吳敬梓',
  '李汝珍', '刘鹗', '劉鶚', '孔子', '孟子', '庄子', '莊子', '老子', '荀子', '韩非', '韓非', '韩非子', '韓非子',
  '司马迁', '司馬遷', '李白', '杜甫', '王维', '王維', '白居易', '苏轼', '蘇軾', '李清照', '辛弃疾', '辛棄疾',
  '陶渊明', '陶淵明', '屈原',
]);
/** What may follow a name in an author field: 著, 撰, 原著, 等, 弟子. */
const ROLE = /(?:原著|编著|編著|著|撰|编|編|辑|輯|注|譯|译|等|及其?弟子|弟子|门人|門人)$/u;

function authorNames(author: string): string[] {
  return author
    .replace(/[〔［\[（(【〖〈《「『][^〕］\]）)】〗〉》」』]*[〕］\]）)】〗〉》」』]/gu, ' ')
    .split(/[、,，;；/／&＆·・•\s　]+|和|与|與|及/u)
    .map((n) => n.trim().replace(ROLE, ''))
    .filter(Boolean);
}

/** True when the author field marks a dynasty or names a classical author. */
export function isClassicalAuthor(author: string): boolean {
  const a = (author ?? '').normalize('NFKC').trim();
  if (!a) return false;
  // NFKC turns full-width brackets into ASCII ones; test both forms.
  if (BRACKETED.test(author) || BRACKETED.test(a) || PREFIXED.test(author) || PREFIXED.test(a)) return true;
  return authorNames(author).some((n) => CLASSICAL_AUTHORS.has(n));
}

export interface EraInput {
  title: string;
  author: string;
  /** "sample:<id>" for a book added from the classics list (samples.ts). */
  sourceName?: string;
}

/** 'classic' for the bundled classics and for books by a dynasty-marked or classical author; 'modern' for everything else. */
export function bookEra(book: EraInput): BookEra {
  const id = book.sourceName?.startsWith('sample:') ? book.sourceName.slice('sample:'.length) : '';
  if (id && SAMPLE_ERA[id]) return SAMPLE_ERA[id];
  const title = (book.title ?? '').trim();
  const author = (book.author ?? '').trim();
  if (SAMPLE_TITLES.some(([t, a]) => t === title && a === author)) return 'classic';
  return isClassicalAuthor(author) ? 'classic' : 'modern';
}
