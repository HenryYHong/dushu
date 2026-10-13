/** Same-origin only: the server separately authenticates the exact private host and owner. */
export function hasMacBridge(): boolean {
  return typeof location !== 'undefined' && (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)
    || (location.protocol === 'https:' && location.hostname.endsWith('.ts.net')));
}
