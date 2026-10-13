import { describe, expect, it } from 'vitest';
import { dictionaryContextMeaning } from '../../src/translate/contextSense';

const senses = ['wine shop', 'pub (public house)', 'hotel', 'restaurant'];
describe('older dictionary senses in context', () => {
  it('recognizes the tavern described in Kong Yiji from direct wine-selling evidence', () => {
    expect(dictionaryContextMeaning('酒店', '柜里面预备着热水，可以随时温酒。做工的人花四文铜钱，买一碗酒。', senses)?.meaning)
      .toBe('wine shop or tavern');
    expect(dictionaryContextMeaning('酒店', '櫃裡預備著熱水，可以溫酒。做工的人買一碗酒。', senses)?.meaning)
      .toBe('wine shop or tavern');
  });
  it('does not override a lodging context or infer a sense from the word alone', () => {
    expect(dictionaryContextMeaning('酒店', '我们入住酒店的客房，下楼温酒，买一碗酒。', senses)).toBeNull();
    expect(dictionaryContextMeaning('酒店', '鲁镇的酒店的格局，是和别处不同的。', senses)).toBeNull();
    expect(dictionaryContextMeaning('酒店', '客人买一碗酒。', senses)).toBeNull();
    expect(dictionaryContextMeaning('饭店', '温酒，买一碗酒。', senses)).toBeNull();
  });
  it('does not mistake an explicit lack of accommodation for hotel evidence', () => {
    expect(dictionaryContextMeaning('酒店', '镇上的酒店不供住宿。他买了一碗温酒。', senses)?.meaning).toBe('wine shop or tavern');
    expect(dictionaryContextMeaning('酒店', '酒店不供住宿，但隔壁有客房。他买了一碗温酒。', senses)).toBeNull();
  });
});
