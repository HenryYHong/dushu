// Readings in a modern story's everyday scenes that the rules for older books got wrong: 骑 after a number that is no count
// of horsemen (骑一骑, a name's 四), 将 for 把 after 用牙 and before a word of its own (将校门, not 将校 officers), 藏 hidden
// after 地 西 道 that end other words (悄悄地藏到, 东西藏在, 知道藏在), 卡 stuck, 差 short by a count, and 不了 declining.
// Invented sentences, each run through segment() and the sandhi pass, exactly what the reader shows.
import { describe, expect, it } from 'vitest';
import { applySandhi, numberedToMarked } from '../../src/core/pinyin';
import { segment } from '../../src/core/segment';
import { loadTestDictionary } from '../helpers/data';

const dictP = loadTestDictionary();

/** The marked pinyin of the first occurrence of `part` in `text`, one string per code point, joined by spaces. */
async function py(text: string, part: string): Promise<string> {
  const d = await dictP;
  const at = text.indexOf(part);
  if (at < 0) throw new Error(`"${part}" is not in "${text}"`);
  const toks = segment(text, d);
  applySandhi(toks);
  const out: string[] = [];
  for (const t of toks) {
    if (t.kind !== 'han') continue;
    let off = t.start;
    [...t.text].forEach((ch, i) => {
      if (off >= at && off < at + part.length) out.push(numberedToMarked(t.pinyin![i]));
      off += ch.length;
    });
  }
  return out.join(' ');
}

describe('骑', () => {
  it('is the verb when said twice, or after a name’s number', async () => {
    expect(await py('我也想骑一骑它。', '骑一骑')).toBe('qí yi qí');
    expect(await py('阿五骑在墙头上。', '骑')).toBe('qí');
  });
  it('still counts horsemen', async () => {
    expect(await py('一骑红尘妃子笑。', '骑')).toBe('jì');
    expect(await py('城外来了数骑。', '骑')).toBe('jì');
  });
});

describe('将', () => {
  it('is 把 after 用 and a tool, and before a word of its own', async () => {
    expect(await py('他用牙将绳子咬断了。', '将')).toBe('jiāng');
    expect(await py('我们先将校门关上。', '将')).toBe('jiāng');
  });
  it('still names officers and generals', async () => {
    expect(await py('众将校一齐上前。', '将')).toBe('jiàng');
    expect(await py('城中守将出马。', '将')).toBe('jiàng');
  });
});

describe('藏', () => {
  it('hides, after a word that ends in 地 西 道', async () => {
    expect(await py('他悄悄地藏到门后。', '藏')).toBe('cáng');
    expect(await py('把东西藏在柜子里。', '藏')).toBe('cáng');
    expect(await py('谁也不知道藏在哪里。', '藏')).toBe('cáng');
  });
  it('is still Tibet and the bodhisattva', async () => {
    expect(await py('他去过西藏。', '藏')).toBe('zàng');
    expect(await py('庙里供着地藏王菩萨。', '藏')).toBe('zàng');
    expect(await py('他读过一部大道藏。', '藏')).toBe('zàng');
  });
});

describe('卡 and 差', () => {
  it('卡 stuck is qiǎ, a card kǎ', async () => {
    expect(await py('车轮被卡在石缝里。', '卡')).toBe('qiǎ');
    expect(await py('我的卡在包里。', '卡')).toBe('kǎ');
  });
  it('差 short by a count is chà', async () => {
    expect(await py('鸡也差三只。', '差')).toBe('chà');
  });
});

describe('不了', () => {
  it('declines on its own, and is a complement after a verb', async () => {
    expect(await py('“不了，我还有事。”', '不了')).toBe('bù le');
    expect(await py('今天我去不了。', '不了')).toBe('bu liǎo');
  });
});
