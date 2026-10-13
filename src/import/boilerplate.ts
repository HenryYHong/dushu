// Download-site boilerplate in text files: banner lines, "更多精彩" calls, URLs, navigation links, and
// any line that repeats through the whole book (a site name stamped on every page).
// Everything here works on whole lines and errs toward keeping text.
import { countHan } from './han';

const WS = /[\s　]+/g;
const squash = (s: string) => s.replace(WS, ' ').trim();
const cpLen = (s: string): number => {
  let n = 0;
  for (const _ of s) n++;
  return n;
};

const URL_RE = /(?:https?:\/\/|www\.)[^\s　]+|\b[a-z0-9][\w-]*\.(?:com|net|org|cn|cc|info|me|la|tw|xyz|top|co|io|so|tv|us|hk|cx|ws)\b(?:\/[^\s　]*)?/gi;
const SENTENCE_END = /[。！？!?”’」』]$/;

/** Lines that are junk only when they are short and stand alone. */
const SHORT_PATTERNS: RegExp[] = [
  /本[书書]由.{0,40}(?:整理|制作|製作|提供|收集|上传|上傳|分享|校对|校對|扫描|掃描|发布|發布|搜集|编辑|編輯)/,
  /本[书書]来自|本[书書]转自|本[书書]轉自/,
  /更多(?:精彩|好看|好[书書]|小说|小說|txt|TXT|电子书|電子書|章节|章節|内容|內容|完本|资源|資源)/,
  /(?:txt|TXT|ＴＸＴ|epub|EPUB|mobi|MOBI)[\s　]*(?:电子书|電子書|小说|小說|全集|全本|下载|下載|格式|版)/,
  /(?:电子书|電子書|小说|小說|全集|全本|全文|书籍|書籍)[\s　]*(?:txt|TXT)?[\s　]*(?:免费|免費)?下[载載]/,
  /手机(?:阅读|閱讀|访问|訪問|用户|用戶|请访问|請訪問|站|版)|手機(?:閱讀|訪問|用戶)|\bwap\./i,
  /最新章[节節]|最快更新|最新更新|全文(?:免[费費])?[阅閱]读|无弹窗|無彈窗|章[节節]目[录錄]|无广告|無廣告|(?:章[节節])?更新(?:最快|及时|及時)/,
  /(?:请|請)?(?:记住|記住)本站|加入[书書][签簽]|推[荐薦]本[书書]|投[推]?[荐薦]票|求(?:月票|推[荐薦]|收藏|订阅|訂閱)|收藏本站|本站(?:网址|網址|域名)|(?:首发|首發)(?:域名|网址|網址)/,
  /(?:仅供|僅供)(?:试阅|試閱|学习|學習|交流|参考|參考)|(?:24|二十四)[\s　]*小[时時](?:内|內)[\s　]*(?:删除|刪除)|[请請]支持正[版]|购买正版|購買正版|版[权權]归.{0,6}(?:所有|作者)/,
  /(?:笔趣阁|筆趣閣|八一中文|天涯在线书库|大唐中文|顶点小说|頂點小說|[书書]包[网網]|飘天文学|飄天文學|轻之国度|輕之國度|起点中文|起點中文|晋江文学城|晉江文學城|新浪读书|新浪讀書)/,
];

/** A line that is only a "previous / contents / next" bar. A lone "目录" is a real heading, so it needs company. */
const NAV_STRONG = '(?:上一[章页頁节節]|下一[章页頁节節]|返回目[录錄]|回目[录錄]|章[节節]列表|加入[书書]架|加入[书書][签簽]|返回[书書]页|返回頂部|返回顶部)';
const NAV_SEP = '[\\s\\u3000|｜\\-—·、,，/\\[\\]【】()（）<>《》]*';
const NAV_ANY = new RegExp(`^${NAV_SEP}(?:${NAV_STRONG}|目[录錄])(?:${NAV_SEP}(?:${NAV_STRONG}|目[录錄]))*${NAV_SEP}$`);
const NAV_ONE_STRONG = new RegExp(`^${NAV_SEP}${NAV_STRONG}${NAV_SEP}$`);
const isNavBar = (t: string): boolean => NAV_ONE_STRONG.test(t) || (NAV_ANY.test(t) && (t.match(/目[录錄]|上一|下一|返回|回目|列表|加入/g) ?? []).length >= 2);

/** Serial-novel end marks. "全文完" is left alone: it is a real sign-off. */
const END_MARK = /^[\s　\p{P}\p{S}]*(?:未完待[续續]|本章未完|本章完|待[续續])[\s　\p{P}\p{S}]*$/u;

const SITE_WORD = /仅供|僅供|正版|24\s*小[时時]|二十四小[时時]|本站|网址|網址|域名|下[载載]|论坛|論壇|社区|社區|公众号|公眾號|QQ|微信|[网網]站|\.com|\.net|\.cn/i;
const SHORT_MAX = 60;
const URL_LINE_MAX = 120;

/** Is this one line download-site boilerplate? `line` may carry any surrounding whitespace. */
export function isBoilerplateLine(line: string): boolean {
  let t = squash(line);
  if (!t) return false;
  if (/[\uff01-\uff5e]/.test(t)) t = t.normalize('NFKC'); // full-width "ｗｗｗ．ｘｘ．ｃｏｍ" and "ＴＸＴ"
  const n = cpLen(t);
  if (n > URL_LINE_MAX) return false;

  if (isNavBar(t) || END_MARK.test(t)) return true;

  const urls = t.match(URL_RE);
  let urlChars = 0;
  if (urls) for (const u of urls) urlChars += cpLen(u);
  const short = n <= SHORT_MAX;
  const keyword = short && SHORT_PATTERNS.some((re) => re.test(t));
  if (urls) {
    // A URL plus a call to action, or a line that is mostly URL, is a banner.
    if (keyword || urlChars / n >= 0.5) return true;
    if (short && !SENTENCE_END.test(t) && countHan(t) <= 12) return true;
    return false;
  }
  if (!keyword) return false;
  // Without a URL, keep anything that reads like a sentence of the story: it needs a site word, or to be
  // a short unfinished line with no comma.
  return SITE_WORD.test(t) || (!SENTENCE_END.test(t) && !/[，,；;]/.test(t) && n <= 40);
}

/** Remove a trailing "…更多精彩请访问 www.xxx.com" from the end of a real line. */
const TAIL_RE = /[\s　]*[（(【\[]?[\s　]*(?:更多|最新|欢迎|歡迎|本[书書]|手机|手機|txt|TXT|下[载載]|[请請])[^。！？\n]{0,40}?(?:https?:\/\/|www\.)\S*.*$/;
export function stripUrlTail(line: string): string {
  const m = TAIL_RE.exec(line);
  if (!m || m.index < 8) return line;
  return line.slice(0, m.index);
}

export interface BoilerplateOptions {
  /** A line must show up more than this many times to count as stamped boilerplate. */
  repeatMin?: number;
  /** Texts with fewer lines than this are never searched for repeats. */
  minLines?: number;
  /** Recognizes chapter headings, which are never boilerplate however often they repeat. */
  isHeading?: (line: string) => boolean;
}

/**
 * Drop boilerplate lines from raw text lines. Blank lines stay, so paragraph structure is kept.
 * Besides the pattern list, a line that repeats more than `repeatMin` times, spread across the whole
 * text, goes too. Lines that end a sentence must repeat far more often to be dropped.
 */
export function stripBoilerplate(lines: string[], opts: BoilerplateOptions = {}): string[] {
  const repeatMin = opts.repeatMin ?? 9;
  const minLines = opts.minLines ?? 200;
  const isHeading = opts.isHeading ?? (() => false);

  const kept: string[] = [];
  for (const raw of lines) {
    if (isBoilerplateLine(raw)) continue;
    kept.push(/(?:https?:\/\/|www\.)/.test(raw) ? stripUrlTail(raw) : raw);
  }
  if (kept.length < minLines) return kept;

  const first = new Map<string, number>();
  const last = new Map<string, number>();
  const count = new Map<string, number>();
  kept.forEach((raw, i) => {
    const t = squash(raw);
    if (!t) return;
    count.set(t, (count.get(t) ?? 0) + 1);
    if (!first.has(t)) first.set(t, i);
    last.set(t, i);
  });

  const drop = new Set<string>();
  for (const [t, c] of count) {
    if (c <= repeatMin) continue;
    const n = cpLen(t);
    if (n < 4 || n > 80) continue;
    if (cpLen(t.replace(/[\s\u3000\p{P}\p{S}]/gu, '')) < 3) continue;
    if (isHeading(t)) continue;
    const terminal = SENTENCE_END.test(t);
    if (terminal && (c <= repeatMin * 2 || n < 12)) continue;
    // Stamped on pages: spread across the book, not a local refrain.
    const spread = (last.get(t)! - first.get(t)!) / kept.length;
    if (spread < 0.4) continue;
    drop.add(t);
  }
  if (!drop.size) return kept;
  return kept.filter((raw) => !drop.has(squash(raw)));
}
