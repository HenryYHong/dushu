// The hash router's parser, apart from main.ts so tests can import it without booting the app.

export interface ParsedRoute { route: string; params: Record<string, string> }

/** "#/read/abc?x=1" gives { route: 'read', params: { x: '1', bookId: 'abc' } }. Unknown routes fall back to the library ('') . */
export function parseRoute(hash: string, isRoute: (route: string) => boolean): ParsedRoute {
  const raw = hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  // A hand-typed or truncated link can hold a lone "%"; keep that segment as written instead of throwing.
  const decode = (part: string) => { try { return decodeURIComponent(part); } catch { return part; } };
  const parts = path.split('/').filter(Boolean).map(decode);
  const params: Record<string, string> = Object.fromEntries(new URLSearchParams(query));
  const route = parts[0] ?? '';
  if (route === 'read' && parts[1]) params.bookId = parts[1];
  return { route: isRoute(route) ? route : '', params };
}
