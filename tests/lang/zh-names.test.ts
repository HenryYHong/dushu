// A name's card for a reader of Chinese says what it is in Chinese (src/lang/ownDictionary.ts chineseNameMeanings), from
// CC-CEDICT's English: 宋江 《水滸傳》中的人物, 曹操 a historical figure, 宋 a surname and a dynasty. Not for anyone else.
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { chineseNameMeanings, loadOwnDictionary, resetOwnDictionary, setReaderLanguage } from '../../src/lang/ownDictionary';

const e = (pinyin: string, ...defs: string[]) => ({ pinyin, defs });
beforeAll(async () => {
  resetOwnDictionary();
  setReaderLanguage('zh');
  await loadOwnDictionary('zh', '/data/', async () => gunzipSync(readFileSync(join(__dirname, '..', '..', 'public', 'data', 'native.tsv.gz'))).toString('utf8'));
});
afterAll(() => { resetOwnDictionary(); setReaderLanguage(undefined); });

it('says what a name is, in Chinese', () => {
  expect(chineseNameMeanings([e('Song4 Jiang1', 'Song Jiang, a principal hero of the novel Water Margin 水滸傳|水浒传')])).toEqual(['《水滸傳》中的人物。']);
  expect(chineseNameMeanings([e('Lin2 Dai4 yu4', 'Lin Daiyu, female character in The Dream of Red Mansions')])).toEqual(['《紅樓夢》中的人物。']);
  expect(chineseNameMeanings([e('Cao2 Cao1', 'Cao Cao (155-220), famous statesman and general at the end of Han')])).toEqual(['歷史人物。']);
  expect(chineseNameMeanings([e('Zhao4 Yun2', 'Zhao Yun (-229), general of Shu in Romance of the Three Kingdoms')])).toEqual(['三國時期的人物。']);
  expect(chineseNameMeanings([e('Song4', 'surname Song', 'the Song dynasty (960–1279)')])).toEqual(['姓氏。', '朝代名。']);
  expect(chineseNameMeanings([e('Jiang1 zhou1', 'Jiangzhou, a district of Chongzuo City')])).toEqual(['地名。']);
});

it('leaves a word that is not only a name, or English it cannot read, to the card', () => {
  expect(chineseNameMeanings([e('Song4', 'surname Song'), e('song4', 'to deliver')])).toBeNull();
  expect(chineseNameMeanings([e('Sha1 Seng1', 'Sha Wujing')])).toBeNull();
});

it('is only for a reader of Chinese', () => {
  setReaderLanguage('en');
  expect(chineseNameMeanings([e('Song4 Jiang1', 'Song Jiang, a principal hero of the novel Water Margin')])).toBeNull();
  setReaderLanguage('zh');
});
