// Fetching a dictionary's data files, for every language: the Chinese dictionary (core/dict.ts) and the other languages'
// engines (main.ts) both load through here. Each file is read as it arrives, so the reader can say how far a slow first
// download has got, and on a first visit it is also handed to the offline copy (sw.js FIRST_VISIT_CACHE). This module is
// small on purpose: it is in the first chunk every language loads, and the Chinese dictionary code is not.

/** Given each data file as downloaded, to keep a copy. */
export type Keep = (url: string, response: Response) => void;
/** Called with a file's size (Content-Length, 0 when unknown), then with each piece as it arrives. */
export type Count = (size: number, read: number) => void;

/** A data file's bytes. Refuses the index.html a dev server sends for a missing file. */
export async function fetchDataBytes(url: string, keep?: Keep, count?: Count): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (keep && /gzip|json/.test(res.headers.get('content-type') ?? '')) keep(url, res.clone());
  const bytes = count && res.body
    ? await readCounting(res.body, Number(res.headers.get('content-length')) || 0, count)
    : new Uint8Array(await res.arrayBuffer());
  if (bytes[0] === 0x3c && /^\s*<(!doctype|html)/i.test(new TextDecoder().decode(bytes.subarray(0, 100)))) throw new Error(`${url}: not a data file`);
  return bytes;
}

/** Fetch one data file as text. Handles servers that gunzip for us and dev servers that answer 404s with index.html. */
export async function fetchDataText(url: string, keep?: Keep, count?: Count): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (keep && /gzip|json/.test(res.headers.get('content-type') ?? '')) keep(url, res.clone());
  const bytes = count && res.body
    ? await readCounting(res.body, Number(res.headers.get('content-length')) || 0, count)
    : new Uint8Array(await res.arrayBuffer());
  const text = bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzipToText(bytes) : new TextDecoder().decode(bytes);
  if (/^\s*<(!doctype|html)/i.test(text.slice(0, 200))) throw new Error(`${url}: not a data file`);
  return text;
}

async function gunzipToText(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream !== 'undefined') {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }
  const { gunzipSync, strFromU8 } = await import('fflate');
  return strFromU8(gunzipSync(bytes));
}

/** The whole body, reporting its size (Content-Length, 0 when unknown) and then each piece as it arrives. */
async function readCounting(body: ReadableStream<Uint8Array>, size: number, count: Count): Promise<Uint8Array> {
  count(size, 0);
  const parts: Uint8Array[] = [];
  let n = 0;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    n += value.length;
    count(0, value.length);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** A dictionary folder's file sizes in bytes, by name in the folder ('entries.tsv.gz', 'kuromoji/base.dat.gz'). */
export type DataSizes = Record<string, number>;

/** The name of the list of sizes the build writes into each dictionary folder (vite.config.ts writeDataSizes). */
export const SIZES_FILE = 'sizes.json';

/** The sizes the build wrote for a dictionary folder, or null without them (the dev server, a copy from before the list). */
export function dataSizes(base: string, keep?: Keep): Promise<DataSizes | null> {
  return fetchDataBytes(base + SIZES_FILE, keep).then((b) => {
    const v = JSON.parse(new TextDecoder().decode(b)) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const out: DataSizes = {};
    for (const [k, n] of Object.entries(v)) if (typeof n === 'number' && n >= 0) out[k] = n;
    return out;
  }).catch(() => null);
}

/**
 * Adds up a dictionary's download for the reader's "Downloading the dictionary: x of y MB". A file counts toward the total
 * from the moment it is asked for, at the size the build wrote down, so the total is whole before the first byte comes even
 * when the browser queues some of the requests. Without that list a file counts at its Content-Length once it starts.
 * `meter(name)` registers a file and returns what its read counts with.
 */
export function byteMeter(onBytes: (loaded: number, total: number) => void, sizes: Promise<DataSizes | null>): (name: string) => Count {
  const files = new Map<string, { size: number; read: number }>();
  let built: DataSizes | null = null;
  let loaded = 0;
  const tell = () => {
    let total = 0;
    // A file never counts for less than what has come of it (a server that unpacks it on the way sends more than its size).
    for (const [name, f] of files) total += Math.max(built?.[name] ?? f.size, f.read);
    onBytes(loaded, Math.max(total, loaded));
  };
  sizes.then((s) => { built = s; if (s && files.size) tell(); }, () => {});
  return (name) => {
    const f = { size: 0, read: 0 };
    files.set(name, f);
    return (size, read) => {
      if (size) f.size = size;
      f.read += read;
      loaded += read;
      tell();
    };
  };
}
