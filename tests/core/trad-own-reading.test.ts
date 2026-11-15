// A paragraph written in traditional characters reads a character that simplified text also uses for another one as its own
// word (斗 dǒu, since dòu is 鬥; 划 huá, since huà is 劃), where no rule's case decides; a simplified paragraph keeps the usual
// reading. Not the characters digitized traditional books often write for the other one (万 for 萬).
import { beforeAll, expect, it } from 'vitest';
import type { Dictionary } from '../../src/types';
import { loadTestDictionary } from '../helpers/data';

let dict: Dictionary;
beforeAll(async () => { dict = await loadTestDictionary(); }, 60000);
const read = (ch: string, prev: string, next: string, script: string) => dict.pinyinFor(ch, { prev, next, script: () => script })[0];

it('reads 斗 and 划 as the traditional book writes them', () => {
  expect(read('斗', '缦', '（', 'traditional')).toBe('dou3');
  expect(read('划', '，', '去', 'traditional')).toBe('hua2');
});

it('keeps a rule’s case and the simplified paragraph’s reading', () => {
  expect(read('斗', '掩映', '媚', 'traditional')).toBe('dou4');
  expect(read('斗', '缦', '（', 'simplified')).toBe(read('斗', '缦', '（', 'unknown'));
  expect(read('万', '一', '人', 'traditional')).toBe('wan4');
});
