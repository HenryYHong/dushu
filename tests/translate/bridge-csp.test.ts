import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BRIDGE_CONNECT, withBridgeConnectSrc } from '../../scripts/bridge-csp';

const sample = '<head><meta http-equiv="Content-Security-Policy" content="default-src \'self\'; connect-src \'self\' https://api.anthropic.com https://api.mymemory.translated.net https://cdn.jsdelivr.net; object-src \'none\'" /></head>';
const connect = (html: string) => /connect-src ([^;"]*)/.exec(html)![1].split(' ');

describe('the page policy lets the public copy reach the Mac, and nothing else new', () => {
  it('adds the Tailscale wildcard (with any port), drops the Anthropic host and keeps the rest', () => {
    const out = withBridgeConnectSrc(sample);
    expect(connect(out)).toEqual(["'self'", BRIDGE_CONNECT, 'https://api.mymemory.translated.net', 'https://cdn.jsdelivr.net']);
    expect(BRIDGE_CONNECT).toBe('https://*.ts.net:*');
    expect(out).toContain("default-src 'self'");
    expect(out).toContain("object-src 'none'");
  });
  it('is idempotent and leaves a page with no policy alone', () => {
    const once = withBridgeConnectSrc(sample);
    expect(withBridgeConnectSrc(once)).toBe(once);
    expect(withBridgeConnectSrc('<head></head>')).toBe('<head></head>');
  });
  it('turns the real index.html policy into one with no wildcard beyond Tailscale names and no plain http', () => {
    const out = withBridgeConnectSrc(readFileSync('index.html', 'utf8'));
    const sources = connect(out);
    expect(sources).toContain(BRIDGE_CONNECT);
    expect(sources).not.toContain('https://api.anthropic.com');
    expect(sources.filter(s => s.includes('*'))).toEqual([BRIDGE_CONNECT]);
    expect(sources.some(s => s.startsWith('http:'))).toBe(false);
    expect(out).toMatch(/script-src 'self';/);
  });
});
