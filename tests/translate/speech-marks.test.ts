// Word times for the Mac's Premium voices (scripts/native-speech.ts, scripts/speech-marks.swift). The helper runs only on a Mac
// with Xcode's command line tools and the Lili (Premium) voice; elsewhere only the parsing is checked.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markHelper, parseMarks } from '../../scripts/native-speech';

describe('parseMarks', () => {
  it('takes [offset, ms] pairs inside the text and nothing else', () => {
    expect(parseMarks('{"marks":[[0,0],[2,410]]}', 4)).toEqual([[0, 0], [2, 410]]);
    expect(parseMarks('{"marks":[]}', 4)).toEqual([]);
    for (const bad of ['', 'nope', '{}', '{"marks":[[4,0]]}', '{"marks":[[0,-1]]}', '{"marks":[[0.5,1]]}', '{"marks":[[0]]}']) {
      expect(parseMarks(bad, 4)).toBeNull();
    }
  });
});

const lili = process.platform === 'darwin' && (() => {
  try {
    execFileSync('/usr/bin/xcode-select', ['-p'], { stdio: 'ignore' });
    return /^Lili \(Premium\)\s+zh_CN/m.test(execFileSync('/usr/bin/say', ['-v', '?'], { encoding: 'utf8' }));
  } catch { return false; }
})();

/** Seconds of audio in a WAV: its data chunk over the format's bytes per second (`say` adds chunks of its own). */
function seconds(wav: Buffer): number {
  let byteRate = 0;
  for (let at = 12; at + 8 <= wav.length;) {
    const id = wav.toString('ascii', at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === 'fmt ') byteRate = wav.readUInt32LE(at + 16);
    if (id === 'data') return size / byteRate;
    at += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

describe.skipIf(!lili)('the word-timing helper', () => {
  it('plays the plain reading and times every word in it, in order', async () => {
    const bin = await markHelper();
    expect(bin).toBeTruthy();
    // 論語, cut as the reader cuts it; one-character words are what slow a marked reading most.
    const words = ['子', '曰', '：', '學', '而', '時', '習', '之', '，', '不', '亦', '說', '乎', '？', '有', '朋', '自', '遠方', '來', '，', '不亦樂乎', '？'];
    const text = words.join('');
    const starts: number[] = [];
    let at = 0;
    for (const w of words) { if (/\p{Script=Han}/u.test(w)) starts.push(at); at += w.length; }
    const dir = mkdtempSync(join(tmpdir(), 'dushu-marks-test-'));
    try {
      writeFileSync(join(dir, 'request.json'), JSON.stringify({ voice: 'Lili (Premium)', lang: 'zh-CN', text, marks: starts }));
      const out = execFileSync(bin!, [join(dir, 'request.json'), join(dir, 'marked.wav')], { encoding: 'utf8', timeout: 60000 });
      const marks = parseMarks(out, text.length)!;
      expect(marks.map((m) => m[0])).toEqual(starts);
      const ms = marks.map((m) => m[1]);
      expect(ms[0]).toBe(0);
      for (let i = 1; i < ms.length; i++) expect(ms[i]).toBeGreaterThan(ms[i - 1]);
      const helperAudio = seconds(readFileSync(join(dir, 'marked.wav')));
      expect(ms[ms.length - 1]).toBeLessThan(helperAudio * 1000);
      // The audio is the plain reading: as long as `say`'s, not the slower reading with a bookmark before every word.
      writeFileSync(join(dir, 'input.txt'), text);
      execFileSync('/usr/bin/say', ['-v', 'Lili (Premium)', '-f', join(dir, 'input.txt'), '-o', join(dir, 'say.wav'), '--file-format=WAVE', '--data-format=LEI16@24000'], { timeout: 60000 });
      expect(Math.abs(helperAudio - seconds(readFileSync(join(dir, 'say.wav'))))).toBeLessThan(0.05);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 300000);
});
