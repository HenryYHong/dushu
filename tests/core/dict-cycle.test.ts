// Simplified/traditional counterparts that name each other and have no reading must not recurse forever.
import { describe, expect, it } from 'vitest';
import { miniDict } from '../helpers/mini';
import { loadTestDictionary } from '../helpers/data';

describe('reading-less counterpart cycles', () => {
  it('a two-character cycle with no reading answers "" and does not overflow the stack', async () => {
    const d = await miniDict({
      chars: [
        ['甲', '', '', '5', '1.4', '乙', '', '', ''],
        ['乙', '', '', '5', '1.4', '', '甲', '', ''],
      ],
    });
    expect(d.pinyinFor('甲')).toEqual(['']);
    expect(d.pinyinFor('乙')).toEqual(['']);
    expect(d.pinyinFor('甲乙')).toEqual(['', '']);
  });

  it('a loop does not poison the cache: a reading reachable by another route still wins', async () => {
    // 甲 -> 乙 -> 甲 (loop) but 乙 also has 丙, which has a reading. Asking for 乙 first must not cache 乙 = "".
    const d = await miniDict({
      chars: [
        ['甲', '', '', '5', '1.4', '乙', '', '', ''],
        ['乙', '', '', '5', '1.4', '甲丙', '', '', ''],
        ['丙', 'bǐng', '', '5', '1.4', '', '', '', ''],
      ],
    });
    expect(d.pinyinFor('乙')).toEqual(['bing3']);
    expect(d.pinyinFor('甲')).toEqual(['bing3']);
    // And the other order, on a fresh dictionary.
    const e = await miniDict({
      chars: [
        ['甲', '', '', '5', '1.4', '乙', '', '', ''],
        ['乙', '', '', '5', '1.4', '甲丙', '', '', ''],
        ['丙', 'bǐng', '', '5', '1.4', '', '', '', ''],
      ],
    });
    expect(e.pinyinFor('甲')).toEqual(['bing3']);
    expect(e.pinyinFor('乙')).toEqual(['bing3']);
  });

  it('the real pair 𩣔 / 𬳹 can be looked up', async () => {
    const d = await loadTestDictionary();
    expect(() => d.pinyinFor('𩣔')).not.toThrow();
    expect(() => d.pinyinFor('𬳹')).not.toThrow();
    expect(d.pinyinFor('𩣔𬳹')).toHaveLength(2);
    expect(d.char('𩣔')).toBeTruthy();
  });

  it('every character of the real data answers without throwing', async () => {
    const d = await loadTestDictionary();
    // A sample across the astral planes where the reading-less pairs live (Ext B to G).
    for (let cp = 0x20000; cp < 0x32000; cp += 7) {
      const ch = String.fromCodePoint(cp);
      expect(() => d.pinyinFor(ch)).not.toThrow();
    }
  });
});
