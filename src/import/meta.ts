// Title and author cleanup: site junk in EPUB metadata, file names, "作者：" lines.

const JUNK_WORD = /epubw|z-?lib|1lib|calibre|anna.?s archive|libgen|www\.|\.com\b|\.net\b|\.org\b|\.cn\b|\.cc\b/i;
const EMPTY_AUTHOR = /^(?:unknown|undefined|n\/a|none|null|anonymous|未知|不详|不詳|无|無|佚名\(?\)?)$/i;

function squash(s: string): string {
  return s.replace(/[\s\u3000]+/g, ' ').trim();
}

/** Strip bracketed site tags and 《》 around a whole title. */
export function cleanTitle(raw: string): string {
  let t = squash(raw);
  t = t.replace(/[\(\[（【][^\)\]）】]*(?:epubw|z-?lib|1lib|anna|libgen|\.com|\.net|\.org|\.cn)[^\)\]）】]*[\)\]）】]/gi, '');
  t = t.replace(/^《(.+)》$/, '$1');
  return squash(t);
}

const ROLE_PREFIX = /^(?:原著者?|原作者?|作\s*者|著\s*者|著|撰文|撰|编著|編著|续写|續寫|续作|續作|续|續|作|Author|By)\s*[:：]\s*/i;
const OTHER_ROLE = /^(?:译者|譯者|翻译|翻譯|译|譯|绘者|绘|繪|插画|插圖|插图|校对|校對|整理|制作|製作|出品|编辑|編輯|责编|責編|改编|改編|Translator|Translated by|Illustrator|Editor)\s*[:：]/i;
const DYNASTY = /^(?:先秦|秦|汉|漢|三国|三國|魏|晋|晉|南北朝|隋|唐|五代|宋|元|明|清|近代|现代|現代|当代|當代|民国|民國)\s*[·・.．]\s*/;
const COUNTRY_TAG = /^[\[［【(（〔][^\]］】)）〕]{1,4}[\]］】)）〕]\s*/;

/**
 * One author name with the labels sites put around it removed: "原著：金庸", "著：金庸", "作者：金庸",
 * "[清]曹雪芹", "（明）施耐庵", "清·曹雪芹", "金庸 著". Returns '' for a part that names someone
 * else's role (a translator, an illustrator) or is only a placeholder.
 */
export function cleanAuthorName(raw: string): string {
  let p = squash(raw).replace(/^(?:文|作者|著|原著)\s*[/／]\s*/, '');
  if (OTHER_ROLE.test(p)) return '';
  for (let i = 0; i < 3; i++) {
    const before = p;
    p = p.replace(ROLE_PREFIX, '').replace(COUNTRY_TAG, '').replace(DYNASTY, '');
    if (p === before) break;
  }
  return p.replace(/\s*[著编編译譯撰续續]$/, '').trim();
}

/** Authors from dc:creator-style strings: split lists, drop site names and placeholders and role suffixes. */
export function cleanAuthors(list: string[]): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    const whole = squash(item).replace(/^(?:文|作者|著|原著)\s*[/／]\s*/, '');
    for (const part of whole.split(/\s*[,，;；、&＆|\/]\s*|\s+and\s+|\s+with\s+/i)) {
      const p = cleanAuthorName(part);
      if (!p || JUNK_WORD.test(p) || EMPTY_AUTHOR.test(p)) continue;
      if (!seen.has(p)) {
        seen.add(p);
        out.push(p);
      }
    }
  }
  return out.join(', ');
}

const TAG_WORDS = '精校|校对|校對|完结|完結|全本|全集|txt|epub|最新|版|整理|下载|下載|作者|修订|修訂|无删减|無刪減|新修|插图|插圖|附';

/** Title (and sometimes author) from a file name like "活着 作者：余华 (精校版).txt". */
export function parseFilename(name: string): { title: string; author: string } {
  let s = name.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z0-9]{1,5}$/, '');
  s = s.replace(new RegExp(`[\\[【(（][^\\]】)）]*(?:${TAG_WORDS})[^\\]】)）]*[\\]】)）]`, 'gi'), ' ');
  let author = '';
  const m = /作者\s*[:：_\-—]?\s*([^\s_\-—()（）【】\[\]《》,，、]+)/.exec(s);
  if (m) {
    author = cleanAuthorName(m[1]);
    s = s.replace(m[0], ' ');
  }
  s = squash(s.replace(/[_\s]*(?:txt|epub)$/i, '')).replace(/^[\s_\-—.]+|[\s_\-—.]+$/g, '');
  s = cleanTitle(s);
  return { title: s, author };
}

/** "作者：余华" or "作\u3000者：余华" on a line, returns the name. */
export function authorFromLine(line: string): string {
  const m = /^[\s\u3000]*(?:作[\s\u3000]*者|著[\s\u3000]*者|原著|原作|著|Author|By)[\s\u3000]*[:：]\s*(.{1,40})$/i.exec(line);
  return m ? cleanAuthorName(m[1]) : '';
}

/** A bare placeholder file name such as "新建文本文档" or "untitled 2". */
export function isGenericName(title: string): boolean {
  return !title || /^(?:新建|未命名|untitled|document|text|file|new|download|book|ebook|文档|文檔)/i.test(title) || /^[\d\s._-]+$/.test(title);
}
