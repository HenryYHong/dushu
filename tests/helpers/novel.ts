// A small deterministic "novel" for lexicon tests: ordinary sentences with made-up names, places and techniques.
export function novel(seed = 7, sentences = 900): string {
  let x = seed >>> 0;
  const rnd = (n: number) => { // mulberry32
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % n);
  };
  const pick = <T,>(a: T[]) => a[rnd(a.length)];
  const names = ['莫远峰', '单雨晴', '欧阳无忌'];
  const places = ['紫霞岛', '落星庄'];
  const arts = ['玄冥神掌', '青云剑法'];
  const filler = ['今天天气很好', '我们都知道这件事', '他慢慢地走了过来', '大家一起去吃饭', '没有人看见那个孩子', '桌子上放着一本书', '师父点了点头', '外面下着大雨', '这里的人都很友好', '母亲在门口等着他'];
  const lines: string[] = [];
  for (let i = 0; i < sentences; i++) {
    const a = pick(names);
    const b = pick(names);
    switch (rnd(18)) {
      case 0: lines.push(`${a}说道：“${pick(filler)}。”`); break;
      case 1: lines.push(`${pick(filler)}，${a}笑着对${b}说，${pick(filler)}。`); break;
      case 2: lines.push(`${a}回到了${pick(places)}，${pick(filler)}。`); break;
      case 3: lines.push(`${pick(filler)}，那天${a}使出${pick(arts)}，${pick(filler)}。`); break;
      case 4: lines.push(`${b}问：“${pick(filler)}？”${a}叹道：“${pick(filler)}。”`); break;
      case 5: lines.push(`${pick(places)}的人都认识${a}，${pick(filler)}。`); break;
      case 6: lines.push(`${a}看了看${b}，${pick(filler)}。`); break;
      case 7: lines.push(`${pick(filler)}。${b}喊道：“${pick(filler)}！”`); break;
      case 8: lines.push(`从${pick(places)}出发，${pick(filler)}，一路上${a}没有说话。`); break;
      case 9: lines.push(`${pick(filler)}，据说${pick(places)}里住着${b}。`); break;
      case 10: lines.push(`${a}练了三年${pick(arts)}，${pick(filler)}。`); break;
      case 11: lines.push(`${pick(arts)}威力极大，${pick(filler)}，${b}点头。`); break;
      case 12: lines.push(`没有人会${pick(arts)}，${pick(filler)}。`); break;
      case 13: lines.push(`${pick(filler)}，他们在${pick(places)}外面等了很久。`); break;
      case 14: lines.push(`${pick(arts)}和${pick(arts)}都很厉害，${pick(filler)}。`); break;
      case 15: lines.push(`${a}的${pick(arts)}已经练成了，${pick(filler)}。`); break;
      case 16: lines.push(`大家都想学${pick(arts)}与${pick(arts)}，${pick(filler)}。`); break;
      default: lines.push(`到了${pick(places)}，${pick(filler)}，${a}又想起了${pick(arts)}。`);
    }
  }
  return lines.join('\n');
}
