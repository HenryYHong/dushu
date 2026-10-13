import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { trustedRequest } from '../../scripts/private-access';
import { generationBody } from '../../scripts/local-model';

const config = { host: 'my-mac.private.ts.net:8443', owner: 'owner@example.com' };
function request(host = 'localhost:4317', headers: Record<string, string> = {}, remote = '127.0.0.1') {
  return { socket: { remoteAddress: remote }, headers: { host, ...headers } } as IncomingMessage;
}
describe('owner-only private Mac gateway', () => {
  it('allows local and exact owner proxy requests', () => {
    expect(trustedRequest(request(), config)).toBe(true);
    expect(trustedRequest(request(config.host, { 'tailscale-user-login': config.owner, origin: `https://${config.host}` }), config)).toBe(true);
  });
  it.each([
    request(config.host), request(config.host, { 'tailscale-user-login': 'other@example.com' }),
    request('evil.ts.net:8443', { 'tailscale-user-login': config.owner }),
    request(config.host, { 'tailscale-user-login': config.owner }, '192.168.1.2'),
    request('localhost:4317', { origin: 'https://evil.example' }),
    request('localhost:4317', { origin: 'not a URL' }),
    request('localhost:4317', { 'sec-fetch-site': 'cross-site' }),
    request(config.host, { 'tailscale-user-login': config.owner, origin: `http://${config.host}` }),
  ])('rejects untrusted host, network source, user and cross-site request', req => {
    expect(trustedRequest(req, config)).toBe(false);
  });
  it('fails closed when private configuration is absent', () => {
    expect(trustedRequest(request(config.host, { 'tailscale-user-login': config.owner }), null)).toBe(false);
  });
});
describe('restricted AI proxy', () => {
  const good = { model: 'qwen3.5:9b-q4_K_M', prompt: '你好', stream: true };
  it('replaces caller options and drops arbitrary upstream parameters', () => {
    expect(generationBody({ ...good, think: true, options: { num_ctx: 999999 }, keep_alive: -1, url: 'https://evil.example' }))
      .toEqual({ ...good, system: undefined, format: undefined, think: false, options: { temperature: 0, num_ctx: 4096, num_predict: 1400 } });
  });
  it.each([null, {}, { ...good, model: 'arbitrary' }, { ...good, prompt: '' }, { ...good, prompt: 'x'.repeat(10001) },
    { ...good, stream: 'yes' }, { ...good, format: {} }, { ...good, system: 'x'.repeat(4001) }])('rejects invalid or oversized requests', value => {
    expect(generationBody(value)).toBeNull();
  });
});
