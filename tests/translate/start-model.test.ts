import { describe, expect, it, vi } from 'vitest';
import { ensureModelService } from '../../scripts/start-model.mjs';
const ready = () => Promise.resolve(new Response(JSON.stringify({ models: [] })));
describe('one-click private AI startup', () => {
  it('does not launch a second copy when Ollama is already running', async () => {
    const launch = vi.fn();
    expect(await ensureModelService({ fetcher: ready, launch, report: vi.fn() })).toBe(true);
    expect(launch).not.toHaveBeenCalled();
  });
  it('leaves an unrelated service on the same port untouched', async () => {
    const launch = vi.fn();
    expect(await ensureModelService({ fetcher: async () => new Response('not Ollama'), launch, report: vi.fn() })).toBe(false);
    expect(launch).not.toHaveBeenCalled();
  });
  it('launches the installed service after a connection failure and waits for readiness', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockImplementation(ready);
    const launch = vi.fn(async () => true);
    expect(await ensureModelService({ fetcher, launch, wait: async () => {}, report: vi.fn() })).toBe(true);
    expect(launch).toHaveBeenCalledOnce();
  });
  it('reports startup failure without blocking dictionary reading', async () => {
    const report = vi.fn();
    expect(await ensureModelService({ fetcher: async () => { throw new Error('offline'); }, launch: async () => false, report })).toBe(false);
    expect(report).toHaveBeenCalledWith(expect.stringContaining('dictionary reading still works'));
  });
});
