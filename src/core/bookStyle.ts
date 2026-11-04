// Spellings of the 1920s that a whole book may use: 底 for the particle 的 (我底书, 人生底意义) and 那 for 哪 in questions
// (那里去呢？, 那一个不肯？). Contract: ARCHITECTURE.md §4.1.
//
// A book shows the usage or it does not, so this is decided once per book: detectOldSpellings counts the places that only the
// old spelling explains, chooseOldSpellings applies the reader's own choice over it, and withOldSpellings hands the switches to
// segment() through the book's lexicon. The reading rules (core/polyphone.ts 底 and 那, core/dict.ts for 那里 那个 …) then read
// 底 as de and 那 as nǎ where the context says so; with a switch off nothing changes.
import type { Lexicon, OldSpellings } from '../types';

/** Bump when detection changes, so a stored report is made again. */
export const OLD_SPELLINGS_VERSION = 1;

/** Evidence for one switch: `hits` places only the old spelling explains, out of `of` comparable places; `sure` turns it on. */
export interface OldSpellingCheck {
  hits: number;
  of: number;
  sure: boolean;
}

export interface OldSpellingReport {
  di: OldSpellingCheck;
  na: OldSpellingCheck;
}

export const NO_OLD_SPELLINGS: OldSpellings = { di: false, na: false };

/** What comes after 底 when it is the noun (他底下, 她底细, 我底线, 们底层): not the particle. */
const DI_NOUN_NEXT = '下细子层部片线气牌座薪盘蕴色板价本稿数限端里';
/** 我底书, 她底眼睛, 他们底事, 自己底命: a person's 底 before what they have. */
const DI_POSSESSIVE = new RegExp(`(?:我|你|他|她|它|您|们|們|咱|自己)底(?![${DI_NOUN_NEXT}])[\\u4e00-\\u9fff]`, 'g');
const DE_POSSESSIVE = /(?:我|你|他|她|它|您|们|們|咱|自己)的/g;

/** 哪 asking which or where (哪里, 哪个, 哪一天, 哪能): a book that writes these does not write 那 for 哪. */
const NA3_ASKING = /哪(?!吒)(?:里|裏|裡|儿|兒|个|個|些|样|樣|一|位|种|種|天|能|有|会|會|知|怕|家|边|邊|方|年)/g;

/** The other words that ask in a clause (谁, 什么, 怎么, 吗 …): with one of them there, 那 is "that" (那位客人是谁？). */
export const OTHER_ASKING = /什么|甚么|甚麼|什麼|甚(人|事|物|处|處|样|樣|时|時|话|話|的)|谁|誰|怎|几|幾|多少|何|吗|嗎|么|麼|否|没有|沒有|不曾|可曾|可是|是不是|有没有|莫非|莫不|莫敢|莫是|敢是|难道|難道/;

/** What 那得 + this is "that takes, it depends on" (nà děi): 那得让他, 那得看运气, 那得要钱, 那得等明天. */
export const DEPENDS = /^(让|讓|要|瞧|看|等|靠|花|费|費|问|問|听|聽)/;

/** Clause-ending punctuation. */
const CLAUSE_END = /^[，,。．.；;：:！!？?、…—]/;

/**
 * Whether the 那 word at `at` asks "which, where" in a book that writes 那 for 哪: its clause ends in a question mark with no
 * other word that asks (你们往那里跑？, 那一个好？, 那个便宜？), or it opens what can only be a rhetorical question (那里还会有…,
 * 那有这样的事！, 那一位不送帖子). `toks` are the paragraph's tokens in simplified characters; `isVerb` says whether a word is a verb
 * (是那闹天宫的…: that one who did it).
 */
export function asksWithNa(toks: readonly string[], at: number, isVerb?: (w: string) => boolean): boolean {
  const word = toks[at] ?? '';
  const rest = word.slice(1);
  const next = toks[at + 1] ?? '';
  // 那么 那末 (then, so), 那时 那天 那边 那年 (that time, that side), 那是 那就 那你 (then): never "which".
  if (rest && !/^(里|裏|裡|儿|兒|个|個|些|位|种|種|一)$/.test(rest)) return false;
  if (!rest && /^(么|麼|末|时|時|天|年|边|邊|是|就|也|还|還|便|又|我|你|他|她|它|您|咱|们|們|样|樣|日|会|會|儿|兒)/.test(next)) return false;
  if (!rest && !/^[\u4e00-\u9fff]/.test(next)) return false;
  // The clause around it.
  let a = at;
  while (a > 0 && !CLAUSE_END.test(toks[a - 1]) && at - a < 12) a--;
  let b = at + 1;
  while (b < toks.length && !CLAUSE_END.test(toks[b]) && b - at < 16) b++;
  const end = toks[b] ?? '';
  const before = toks.slice(a, at).join('');
  const after = toks.slice(at + 1, b).join('');
  // 我那里, 他那里 (someone's place), 这那 (this and that), 兀那松树背后…在那里 (兀那 points: that, there).
  // So does 你不看见…那里…？ (don't you see … over there?).
  if (/[我你他她它们們家这這]$/.test(before) || /兀那|(不|没|沒)(看见|看見|见|見|瞧见|瞧見|听见|聽見)/.test(before)) return false;
  const place = /^(里|裏|裡|儿|兒)$/.test(rest);
  // 将那匹大马…吃了？, 把那个莲台… (what is taken or done to, with more of the clause after it): that.
  if (/^(把|将|將)$/.test(toks[at - 1] ?? '') && b - at > 2) return false;
  // 这一个…，那一个…, 这个…，那个… (this one … that one: an earlier clause of the sentence opens the same way with 这): that.
  const same = (rest || next).slice(0, 1);
  if (same) {
    let from = a;
    while (from > 0 && !/^[。！!？?\n]/.test(toks[from - 1]) && a - from < 24) from--;
    for (let p = from; p < a; p++) {
      const opensThis = toks[p] + (toks[p + 1] ?? '');
      if ((p === from || CLAUSE_END.test(toks[p - 1])) && (opensThis.startsWith(`这${same}`) || opensThis.startsWith(`這${same}`))) return false;
    }
  }
  // 那 + a noun before another 那 word that asks (那秃驴在那里？, 那员外如今在那里？): this one is "that". So is 那些 那个 after a name
  // (蒋玉菡那些人哪？) or in a yes-no question (你可认得那些和尚？).
  if (!place && /那(?!么|麼|末)/.test(before + after)) return false;
  if (!place && (/[一-鿿]{2}$/.test(toks[at - 1] ?? '') && !/(是|在|从|從|到|往|问|問|知|晓得|曉得|认得|認得|看|听|聽|记得|記得|寻|尋|找)$/.test(toks[at - 1]) || /可/.test(before))) return false;
  // 把那个莲台, 寻那个苦恼去, 得见那老师父 (a verb and what it takes): "that". Only 是那… (是那寺里和尚？) or a number or a
  // measure after it (差那两个去？, 记得那本书上…？, 那三位…？) asks which.
  const prevTok = toks[at - 1] ?? '';
  const counted = /^(一|二|两|兩|三|四|五|六|七|八|九|十|几|幾|百|千|万|萬|个|個|位|本|种|種|家|处|處|方|朝|回|次|件|句|条|條|所|座|间|間|门|門|行|头|頭|只|隻|匹|张|張|把|些|部|样|樣)/;
  const opener = /^(还会|還會|还有|還有|有|还能|還能|能|会|會|肯|敢|知|晓得|曉得|认得|認得|得|容|用得着|用得著|管|在乎|比得上|顾得|顧得|见|見)/;
  // 那管营相公, 那知府 (that official: 管营 知府 are titles, not 哪管 哪知), and 那得 before a verb of depending on something (那得让他！,
  // 那得瞧运气: that takes, děi). Any other 那得 asks how there could be (那得齐全。, 那得回与你。, 那得有此事).
  const opens = (w: string) => opener.test(w) && !/^(管(营|營|总|總|家|事|带|帶|理|库|庫|仓|倉|门|門|账|賬|教|领|領)|知(府|县|縣|州|事|客|音|己))/.test(after)
    && !(/^得/.test(w) && DEPENDS.test(after.slice(1)));
  if (!rest && !counted.test(next) && !opens(next) && (!/^(是|在)$/.test(prevTok) || /^(敢|莫非|想|必|怕|许|許|定|准|準|多半|大约|大約|只怕|恐怕)$/.test(toks[at - 2] ?? ''))) return false;
  // 你是那闹天宫的孙悟空？ (that one who …): 是那 + a deed + 的 before who it is. (你是那寺里的和尚？, 你是那世修来的缘法？ ask which.)
  if (!rest && prevTok === '是' && !counted.test(next) && !opens(next) && !!isVerb?.(next) && /的/.test(after)) return false;
  if (/^(个|個|些|位|种|種)$/.test(rest) && /^[一-鿿]/.test(prevTok) && !/^(是|在|知|问|問)$/.test(prevTok)
    && /^[一-鿿]/.test(next) && !/^(是|敢|肯|能|会|會|要|去|来|來|不|没|沒|也|都|还|還|又|就|便|有|在)/.test(next)) return false;
  // 在三姑娘那里, 从好友那里 (someone's place, after 在 从 到 往 and the someone).
  if (place && toks.slice(a, at - 1).some((t) => /^(在|从|從|到|往|向|跟|于|於)$/.test(t))) return false;
  // A yes-no question (…没有？, …不是？, …吗？, 那不是…？): 那 is "that, there".
  // 那里不有人来了？, 那里不是孙行者来了？ (isn't someone coming over there?) too; 那里不是方便？ (isn't anywhere fine?) asks.
  if (/没有|沒有|吗|嗎|否|不是$|不成$|是不是|有没有|有沒有/.test(after) || ((!rest || (place && /了$/.test(after))) && /^不/.test(next))) return false;
  // 那里想是…？ (over there, could it be …?).
  if (place && /^(想是|想必|想来|想來)/.test(after)) return false;
  // 那里还会, 那有, 那一位不…, 那得, 那肯 (how could, who does not) opening a clause: rhetorical whatever ends it. The 不 of 那一位不…
  // comes within a word or two (那一样也不比别人新, 那一样是配不上你们的: none of them; 那一座大的园子人家是不敢买的, 那一处亦不久也: that
  // one).
  const neg = toks.slice(at + 1, b).findIndex((t) => /不|没|沒/.test(t) && !/^不(久|过|過|料|但|仅|僅|少|同|论|論|管|如|觉|覺|住|免|禁|时|時|日)/.test(t));
  const soonNeg = neg >= 0 && neg <= 3 && !toks.slice(at + 1, at + 1 + neg).some((t) => /^(的|之)$/.test(t));
  // (那里有只渡船儿来了。: a statement of what is there.)
  const told = /了$/.test(after) && /^[。！!]/.test(end);
  const rhetorical = !told && (opens(after) || (/^一/.test(rest || next) && soonNeg));
  if (rhetorical && /^[？?！!。]/.test(end) && /^(又|还|還|却|卻|倒|便|就|如今|也|都|更|可)?$/.test(before)) return true;
  if (!/^[？?]/.test(end)) return false;
  if (OTHER_ASKING.test(before + after)) return false;
  // 那里去呢？ (where): a 呢 question asks which only with a verb of going or finding; 那个人呢？ is "and that one?".
  if (/呢/.test(after)) return place && /(去|来|來|走|跑|找|放|藏|住|在)/.test(after);
  return true;
}

/**
 * Counts the places in a book's chapters that show each old spelling. `di` is sure when 我底 你底 他们底 + a word (not 他底下)
 * comes at least 5 times and is at least a fifth as common as 我的 你的 …; `na` is sure when at least 5 questions ask with a
 * 那 word and the book writes 哪 for the same at most a third as often. Pure and cheap (one pass of regular expressions).
 */
export function detectOldSpellings(chapterTexts: readonly string[]): OldSpellingReport {
  let diHits = 0, deCount = 0, naHits = 0, na3 = 0;
  for (const text of chapterTexts) {
    diHits += (text.match(DI_POSSESSIVE) ?? []).length;
    deCount += (text.match(DE_POSSESSIVE) ?? []).length;
    na3 += (text.match(NA3_ASKING) ?? []).length;
    // Questions that ask with a 那 word and nothing else: 那里去？ 那一个好？ (counted on the clause's raw text).
    for (const clause of text.match(/[^，,。；;：:！!？?、…「」『』“”‘’（）\n]*[？?]/g) ?? []) {
      const m = /那(里|裏|裡|儿|兒|个|個|些|位|种|種|一)/.exec(clause);
      if (!m || OTHER_ASKING.test(clause.replace(/那么|那麼|那末/g, '')) || /[我你他她它们們家这這]那/.test(clause)) continue;
      if (/呢/.test(clause) && !/那(里|裏|裡|儿|兒).*(去|来|來|走|跑|找|放|藏|住|在)/.test(clause)) continue;
      naHits++;
    }
  }
  return {
    di: { hits: diHits, of: diHits + deCount, sure: diHits >= 5 && diHits * 5 >= diHits + deCount },
    na: { hits: naHits, of: naHits + na3, sure: naHits >= 5 && na3 * 3 <= naHits },
  };
}

/** The switches the reader applies: the reader's own choice where there is one, else what detection is sure of. */
export function chooseOldSpellings(report: OldSpellingReport | undefined, choice?: Partial<OldSpellings>): OldSpellings {
  return {
    di: choice?.di ?? report?.di.sure ?? false,
    na: choice?.na ?? report?.na.sure ?? false,
    // "No" to 那 for 哪: read 那 as written everywhere (the old novels' rules would still read some 那里 nǎ).
    ...(choice?.na === false ? { naAsWritten: true } : {}),
  };
}

/**
 * `lexicon` carrying the switches, for segment() and the reading rules: the same object spread (whatever else it carries, such as the
 * reader's fixes, goes along), with `spellings` set when a switch is on and left out when none is.
 */
export function withOldSpellings(lexicon: Lexicon | undefined, s: OldSpellings): Lexicon {
  const base: Lexicon = lexicon ?? { has: () => false, get: () => undefined, entries: () => [], maxLen: 0 };
  const { spellings: _old, ...rest } = base;
  void _old;
  return s.di || s.na || s.naAsWritten ? { ...rest, spellings: { di: s.di, na: s.na, ...(s.naAsWritten ? { naAsWritten: true } : {}) } } : rest;
}
