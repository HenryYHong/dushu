import { newSrs } from '../../src/core/srs';
import type { VocabItem } from '../../src/types';

export const T0 = Date.UTC(2026, 9, 1, 12, 0, 0);

export function item(simp: string, pinyin: string, gloss: string, over: Partial<VocabItem> = {}): VocabItem {
  return { id: simp, simp, trad: simp, pinyin, gloss, addedAt: T0, srs: newSrs(T0), ...over };
}

export const SAMPLE: VocabItem[] = [
  item('你好', 'ni3 hao3', 'hello; hi', { addedAt: T0 - 3000, context: { sentence: '他说：“你好！”', bookTitle: '活着' } }),
  item('学习', 'xue2 xi2', 'to learn; to study', { addedAt: T0 - 2000 }),
  item('绿色', 'lü4 se4', 'green', { addedAt: T0 - 1000, trad: '綠色', srs: { due: T0 + 86400000 * 3, interval: 3, ease: 2.5, reps: 2, lapses: 0, last: T0 } }),
  item('爱', 'ai4', 'to love', { addedAt: T0, trad: '愛' }),
];
