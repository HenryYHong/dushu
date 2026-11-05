// An invented village story for the name check's tests (core/nameCandidates.ts, ui/reader/nameCheck.ts): names in the shapes the
// detector turns down (七斤, 七大人, 老栓, 小栓, 觉新 觉民 觉慧, 阿噶利马), each acting as a person, among plain sentences.
// Deterministic: the same text every run.

/** The names and how often each acts in the story. */
export const STORY_NAMES: Record<string, number> = { 七斤: 24, 七大人: 14, 老栓: 18, 小栓: 9, 觉新: 7, 觉民: 7, 觉慧: 7, 阿噶利马: 9 };

const ACTS = [
  '说道：“今天天气很好。”', '笑着走进了院子。', '坐在门口抽烟。', '问：“饭做好了没有？”', '从城里回来了。', '低着头不说话。',
  '把碗放在桌上。', '叹了一口气。', '看了看天。', '想起了从前的事情。', '站起来走了出去。', '答应了一声。', '喝了一口茶。',
  '摇了摇头。', '拿起扇子扇了几下。', '慢慢地走过石桥。', '在河边洗衣服。', '睡着了。', '哭了起来。', '骂了一句。',
  '跑到街上去了。', '忽然大声喊起来。', '点了点头。', '没有说什么。', '听见了外面的声音。', '回到家里。', '吃完了晚饭。',
  '在灯下看书。', '买了一些米。', '写了一封信。',
];
const LEADS = ['', '这天，', '后来，', '晚上，', '第二天，', '可是', '于是', '那时', '忽然', '大家都说', '我看见', '只有', '原来', '过了一会儿，'];
const CALLS = ['“{}，你回来了！”', '“{}，快来吃饭！”', '他对{}说：“明天再来。”', '大家都叫{}过去。', '我和{}一起去了。', '母亲问{}：“冷不冷？”'];
const PLAIN = [
  '河水慢慢地流着。', '天渐渐地黑了下来。', '村里的狗叫了几声。', '风吹过稻田。', '远处传来锣鼓的声音。', '太阳照在土场上。',
  '树上的知了不停地叫。', '船从桥下摇了过去。', '屋里点起了灯。', '雨下了一整夜。', '街上的人渐渐多了。', '鸡在院子里找东西吃。',
  '我觉得有些冷。', '桌上放着一盏油灯。', '城里的消息传到了村里。', '水面上起了一层雾。', '茶馆里坐满了客人。', '孩子们在河边玩水。',
];

/** The story as paragraphs: each name acts in its own sentences, a third of the time called by name. */
export function nameStory(names: Record<string, number> = STORY_NAMES): string[] {
  let seed = 7;
  const next = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const lines: string[] = [];
  for (const [name, times] of Object.entries(names)) {
    for (let k = 0; k < times; k++) {
      lines.push(k % 3 === 2 ? CALLS[next(CALLS.length)].replace('{}', name) : LEADS[next(LEADS.length)] + name + ACTS[next(ACTS.length)]);
    }
  }
  for (let k = 0; k < 120; k++) lines.push(PLAIN[next(PLAIN.length)]);
  // Shuffled, then three or four sentences to a paragraph.
  for (let i = lines.length - 1; i > 0; i--) { const j = next(i + 1); [lines[i], lines[j]] = [lines[j], lines[i]]; }
  const out: string[] = [];
  for (let i = 0; i < lines.length;) { const n = 3 + next(2); out.push(lines.slice(i, i + n).join('')); i += n; }
  return out;
}
