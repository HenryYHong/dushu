// Text helpers that need no dictionary: Han detection, sentence splitting, script guess.
import type { Script } from '../types';
import { hanBlockName } from './blocks';

/** Any CJK ideograph: URO, Ext A–J, compatibility (+ supplement), Kangxi and CJK radicals, 〇. */
export function isHanCodePoint(cp: number): boolean {
  if (cp >= 0x4e00 && cp <= 0x9fff) return true; // fast path: nearly all real text
  if (cp < 0x2e80) return false;
  return hanBlockName(cp) !== null;
}

export function hasHan(s: string): boolean {
  for (const ch of s) if (isHanCodePoint(ch.codePointAt(0)!)) return true;
  return false;
}

export function countHan(s: string): number {
  let n = 0;
  for (const ch of s) if (isHanCodePoint(ch.codePointAt(0)!)) n++;
  return n;
}

// ------------------------------------------------------------- sentences ---

export interface Span { start: number; end: number; text: string }

const BREAKS = new Set(['\n', '\r', '\u2028', '\u2029', '\u0085']);
const STRONG_END = new Set([...'。！？；!?;‼⁇⁈⁉｡']);
const CLOSERS = new Set([...'”’」』）】》〉〕］｝)]}»›']);
const OPENERS = new Set([...'“‘「『（【《〈〔［｛([{«‹"']);

/**
 * Split a paragraph into sentences. A sentence ends after 。！？；, after an ellipsis that is not followed by more
 * text, or at a line break; closing quotes and brackets stay with the sentence they close. Whitespace between
 * sentences is dropped, so start/end bound the visible text.
 */
export function splitSentences(text: string): Span[] {
  const out: Span[] = [];
  const n = text.length;
  let start = 0;
  // Straight double quotes alternate open/close; an odd count before one means it closes a quote.
  const dq: number[] = [];
  for (let k = text.indexOf('"'); k >= 0; k = text.indexOf('"', k + 1)) dq.push(k);
  const closes = (pos: number) => (text[pos] === '"' ? dq.indexOf(pos) % 2 === 1 : CLOSERS.has(text[pos]));
  const push = (from: number, to: number) => {
    while (from < to && /\s/.test(text[from])) from++;
    while (to > from && /\s/.test(text[to - 1])) to--;
    if (to > from) out.push({ start: from, end: to, text: text.slice(from, to) });
  };
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (BREAKS.has(c)) { push(start, i); start = i + 1; i++; continue; }
    let end = -1;
    if (STRONG_END.has(c)) {
      end = i + 1;
      while (end < n && (STRONG_END.has(text[end]) || text[end] === '…')) end++;
    } else if (c === '…' || c === '⋯' || (c === '.' && text.startsWith('...', i)) || c === '‥') {
      // Ellipsis: a break only when nothing more follows in the sentence (…… alone, or before a closing quote).
      end = i + 1;
      while (end < n && (text[end] === '…' || text[end] === '.' || text[end] === '⋯' || text[end] === '‥')) end++;
      let j = end;
      while (j < n && closes(j)) j++;
      if (j < n && !BREAKS.has(text[j]) && !/\s/.test(text[j]) && !OPENERS.has(text[j])) end = -1;
    } else if (c === '.' && i + 1 < n && /\s/.test(text[i + 1]) && i > 0 && !/[0-9A-Z]/.test(text[i - 1])) {
      end = i + 1;
    } else if (c === '.' && i + 1 === n && i > 0 && !/[0-9]/.test(text[i - 1])) {
      end = i + 1;
    }
    if (end < 0) { i++; continue; }
    while (end < n && closes(end)) end++;
    push(start, end);
    start = end;
    i = end;
  }
  push(start, n);
  return out;
}

/** The sentence containing text[index] (split on 。！？；… and line breaks, keeping closing quotes). */
export function sentenceAround(text: string, index: number): Span {
  const all = splitSentences(text);
  if (!all.length) return { start: 0, end: text.length, text };
  const at = Math.max(0, Math.min(index, text.length - 1));
  // Binary search for the last sentence starting at or before `at`.
  let lo = 0;
  let hi = all.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (all[mid].start <= at) lo = mid;
    else hi = mid - 1;
  }
  return all[lo];
}

// ---------------------------------------------------------------- script ---

/** ~300 very common characters that exist only in simplified text, and their traditional-only counterparts. */
const SIMPLIFIED_ONLY = new Set([...'为这说对来与还个将从时过并会给却见没让内听号两当无们长门问话则较国达头该开约军属带进应县处区点张间总请连吗经马据书难东钱气杀学强写发杨边鱼设声儿红爱报类虽别讲远乡队电条剑动师仅变图热岁转场众风黄镇数亲传脸买办尽车刚级离体满飞罢龙宽随须汉战项铁现桥惊药冲双乱获顶断调吴线辖卖画轻权记论伤归实网选关骂机装驻产领块谈诸觉团岛旧挂敌诗举帮换脚宫错饭状楼层届职营员银刘单吨亚抢质铜词厂凭紧题读义陈礼树岗墙颇枪运响势贴坛贼妈专计页烧节绝闻广孙绣坏组轮决压弹显语业庙扑赶宝贵闹齐骑盐摆负击细观华渐横兴纵练盖吓厅叹诏虚汤够讯环户挥岂亿围圣献烟苏盘争圆顾尔鸡脱结罗软纸试梦辽绿证舰钟劝灭侧寻异粮韩灯阳阵帐编载灵养']);
const TRADITIONAL_ONLY = new Set([...'並亂亞併來個們側傳傷僅億儘兒內兩別則剛劉劍動勢勸區卻吳員問單嗎嘆噸噹嚇囌國圍圓圖團報場塊墰墻壇壓壜壞夠夢媽孫學宮實寫寬寶將專尋對屆層屬島崗嵗師帳帶幫幷廟廠廣廳張強彆彈從愛憑應戰戶掛換揮搶撲擊據擺敵數斷時書會東條楊業槍樓樹橋機橫權歎歲歸殺氣決沒沖湯滅滿漢漸為無煙熱燈燒營爭爲爾牆狀獲獻現環產産畫異畵當發盡盤眾禮穫箇節糧糰約紅紙級細組結絕給絶綉經綠綫網緊緑線編練縣縱總繡罈罎罵罷羅義聖聞聲職聽脫腳臉與興舉舊艦華菸葯蓋藥蘇處虛號衆衝裝襬見親覺觀計訊記設証詔詞試詩話該語說説調談請論諸講證讀變讓豈負貴買貼賊賣質趕車軍軟較載輕輪轄轉辦這連進運過達遠選遼還邊鄉鈡銀銅錢錯鍾鎭鎮鐘鐵長門開間關陣陳陽隊隨雖雙雞離難電靈韓響頁頂項須頗領頭題類顧顯風飛飯養馬駐駡騎驚體髮鬚鬧魚鷄鹽黃點齊龍']);

/**
 * Rough simplified/traditional guess from characters that differ between the scripts. Works without the
 * dictionary. 'unknown' when the text has no distinguishing character; 'mixed' when the minority script
 * accounts for at least 8% of the distinguishing characters.
 */
export function detectScript(text: string): Script {
  let simp = 0;
  let trad = 0;
  for (const ch of text) {
    if (SIMPLIFIED_ONLY.has(ch)) simp++;
    else if (TRADITIONAL_ONLY.has(ch)) trad++;
  }
  const total = simp + trad;
  if (total === 0) return 'unknown';
  const minority = Math.min(simp, trad);
  if (minority / total >= 0.08 && minority >= 2) return 'mixed';
  return simp >= trad ? 'simplified' : 'traditional';
}

/** Exposed for tests: the characters detectScript keys on. */
export const SCRIPT_MARKERS = { simplified: SIMPLIFIED_ONLY, traditional: TRADITIONAL_ONLY };
