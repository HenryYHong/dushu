import { describe, expect, it } from 'vitest';
import { compactCount, coverHue, hashString, plural, progressFraction, progressLabel, titleSize } from '../../src/ui/library/format';

describe('cover helpers', () => {
  it('hashes deterministically and spreads titles across hues', () => {
    expect(hashString('活着')).toBe(hashString('活着'));
    expect(coverHue('活着', '余华')).toBe(coverHue('活着', '余华'));
    const hues = new Set(['活着', '孔乙己', '故乡', '狂人日记', '紅樓夢', '水滸傳', '三國演義', '西遊記'].map((t) => coverHue(t)));
    expect(hues.size).toBeGreaterThanOrEqual(6);
    for (const h of hues) expect(h).toBeGreaterThanOrEqual(0), expect(h).toBeLessThan(360);
  });

  it('separates the same title by different authors', () => {
    expect(coverHue('日记', 'A')).not.toBe(coverHue('日记', 'B'));
  });

  it('shrinks the title as it gets longer and counts code points', () => {
    expect(titleSize('活着')).toBeGreaterThan(titleSize('孔乙己'));
    expect(titleSize('孔乙己')).toBeGreaterThan(titleSize('西遊記 第一回'));
    expect(titleSize('A Very Long Title About Many Things In The World')).toBeLessThan(titleSize('三國演義'));
    expect(titleSize('𠀀𠀁')).toBe(titleSize('活着')); // astral characters count once
  });
});

describe('progress labels', () => {
  it('names the three states and never rounds to a false 0% or 100%', () => {
    expect(progressLabel(undefined)).toBe('Not started');
    expect(progressLabel({ percent: 0.001 })).toBe('Not started');
    expect(progressLabel({ percent: 0.006 })).toBe('1%');
    expect(progressLabel({ percent: 0.374 })).toBe('37%');
    expect(progressLabel({ percent: 0.994 })).toBe('99%');
    expect(progressLabel({ percent: 0.996 })).toBe('Finished');
  });

  it('says 1%, not Not started, once a long book is read past its start', () => {
    // A few screens into a 900,000-character novel is about 0.2%.
    expect(progressLabel({ percent: 0.002, chapter: 0, block: 14 })).toBe('1%');
    expect(progressLabel({ percent: 0, chapter: 2, block: 0 })).toBe('1%');
    expect(progressLabel({ percent: 0.001, chapter: 0, block: 0, offset: 120 })).toBe('1%');
    // Opened but still at the very start.
    expect(progressLabel({ percent: 0, chapter: 0, block: 0 })).toBe('Not started');
    expect(progressLabel({ percent: 0, chapter: 0, block: 0, offset: 0 })).toBe('Not started');
  });

  it('clamps and survives bad numbers', () => {
    expect(progressFraction({ percent: 3 })).toBe(1);
    expect(progressFraction({ percent: -1 })).toBe(0);
    expect(progressFraction({ percent: NaN })).toBe(0);
    expect(progressFraction(undefined)).toBe(0);
  });
});

describe('counts', () => {
  it('compacts', () => {
    expect(compactCount(212)).toBe('212');
    expect(compactCount(2200)).toBe('2.2k');
    expect(compactCount(20858)).toBe('21k');
    expect(compactCount(589256)).toBe('589k');
    expect(plural(1, 'chapter')).toBe('1 chapter');
    expect(plural(1200, 'chapter')).toBe('1,200 chapters');
  });
});
