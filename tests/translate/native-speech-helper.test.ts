// The Mac's renderer when the word-timing helper stalls (scripts/native-speech.ts): its time is bounded by the text, and after
// it is killed for taking too long `say` renders for a while, rather than every sentence waiting out the helper first.
import { writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runs = vi.hoisted(() => ({ calls: [] as { bin: string; timeout?: number }[], helper: 'hangs' as 'hangs' | 'fails' | 'works' }));
vi.mock('node:child_process', () => ({
  execFile: vi.fn((bin: string, args: string[], options: { timeout?: number }, done: (error: unknown, result?: unknown) => void) => {
    runs.calls.push({ bin, timeout: options.timeout });
    if (bin === '/usr/bin/say' && args[1] === '?') { done(null, { stdout: 'Lili (Premium)      zh_CN    # 你好\n', stderr: '' }); return; }
    const output = bin === '/usr/bin/say' ? args[args.indexOf('-o') + 1] : args[1];
    // Timed out: Node kills the process and says so.
    if (bin !== '/usr/bin/say' && runs.helper === 'hangs') { done(Object.assign(new Error('timed out'), { killed: true, signal: 'SIGTERM' })); return; }
    if (bin !== '/usr/bin/say' && runs.helper === 'fails') { done(Object.assign(new Error('exit 1'), { killed: false, code: 1 })); return; }
    void writeFile(output, 'RIFF').then(() => done(null, { stdout: bin === '/usr/bin/say' ? '' : '{"marks":[[0,0]]}', stderr: '' }));
  }),
}));
// The helper counts as built, so nothing is compiled.
vi.mock('node:fs/promises', async (original) => ({ ...await original<typeof import('node:fs/promises')>(), access: vi.fn(async () => {}) }));
vi.mock('../../scripts/private-access', () => ({ bridgeRequest: () => true }));

import { nativeSpeech } from '../../scripts/native-speech';

type Handler = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
let handler: Handler;
beforeEach(() => {
  runs.calls = []; runs.helper = 'hangs';
  const plugin = nativeSpeech() as unknown as { configureServer: (server: { middlewares: { use: (fn: Handler) => void } }) => void };
  plugin.configureServer({ middlewares: { use: (fn) => { handler = fn; } } });
});
afterEach(() => vi.restoreAllMocks());

/** One POST to /api/native-speech; resolves with the status and the marks header. */
function render(text: string, marks: number[]): Promise<{ status: number; marks?: string }> {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify({ text, voice: 'dushu-mac:Lili (Premium)', marks }));
    const req = Object.assign((async function* () { yield body; })(), {
      url: '/api/native-speech', method: 'POST', headers: { 'content-type': 'application/json' },
    }) as unknown as IncomingMessage;
    const headers: Record<string, unknown> = {};
    let status = 200;
    const res = {
      headersSent: false, writableEnded: false,
      setHeader: (k: string, v: unknown) => { headers[k] = v; },
      writeHead(code: number) { status = code; return res; },
      on: () => res,
      end() { res.writableEnded = true; resolve({ status, marks: headers['X-Dushu-Marks'] as string | undefined }); return res; },
    };
    handler(req, res as unknown as ServerResponse, () => resolve({ status: 404 }));
  });
}
const helperRuns = () => runs.calls.filter((c) => c.bin.includes('speech-marks'));

describe.skipIf(process.platform !== 'darwin')('a stalled word-timing helper', () => {
  it('gets a time bounded by the text, then is skipped for a while and `say` renders', async () => {
    const text = '天'.repeat(40) + '。';
    expect(await render(text, [0, 1])).toEqual({ status: 200, marks: undefined });
    expect(helperRuns()).toHaveLength(1);
    expect(helperRuns()[0].timeout).toBe(3000 + 30 * text.length);
    // The next sentences do not wait on it.
    expect(await render('你好。', [0, 1])).toEqual({ status: 200, marks: undefined });
    expect(await render('再见。', [0, 1])).toEqual({ status: 200, marks: undefined });
    expect(helperRuns()).toHaveLength(1);
    expect(runs.calls.filter((c) => c.bin === '/usr/bin/say' && c.timeout === 30000)).toHaveLength(3);
    // A few minutes on it is tried again, and words are timed once it answers.
    runs.helper = 'works';
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 4 * 60_000);
    expect(await render('你好。', [0, 1])).toEqual({ status: 200, marks: '[[0,0]]' });
    expect(helperRuns()).toHaveLength(2);
  });

  it('a helper that fails quickly is not set aside: the next sentence tries it again', async () => {
    runs.helper = 'fails';
    expect(await render('你好。', [0, 1])).toEqual({ status: 200, marks: undefined });
    runs.helper = 'works';
    expect((await render('再见。', [0, 1])).marks).toBe('[[0,0]]');
    expect(helperRuns()).toHaveLength(2);
  });
});
