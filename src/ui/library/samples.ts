// The "Start with a classic" list: public/samples/index.json plus the text files next to it.
// Everything here tolerates the files being absent (or a dev server answering with index.html).
import type { ImportedBook, Script } from '../../types';

export interface Sample {
  id: string;
  title: string;
  author: string;
  script: Script;
  file: string;
  level: string;
  blurb: string;
  source?: string;
  note?: string;
  chapters?: number;
  chars?: number;
  group?: string;
  /** Its cover, a public-domain painting or photograph, relative to samples/ (covers/<id>.jpg), and where it is from. */
  cover?: string;
  coverCredit?: string;
  /** The title and author in each script, so the list shows them in the reading script before the dictionary is in. */
  simplified?: { title: string; author: string };
  traditional?: { title: string; author: string };
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const posInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);

/** Keeps the rows that have what we need to show and import them; drops everything else. */
function scripts(r: Record<string, unknown>): Pick<Sample, 'simplified' | 'traditional'> {
  const out: Pick<Sample, 'simplified' | 'traditional'> = {};
  for (const k of ['simplified', 'traditional'] as const) {
    const v = r[k] as Record<string, unknown> | undefined;
    if (v && typeof v === 'object' && str(v.title)) out[k] = { title: str(v.title), author: str(v.author) };
  }
  return out;
}

export function parseSampleIndex(raw: unknown): Sample[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Sample[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = str(r.id);
    const title = str(r.title);
    const file = str(r.file);
    if (!id || !title || !file || seen.has(id) || /[\\/]|\.\./.test(file)) continue;
    seen.add(id);
    const script = r.script === 'simplified' || r.script === 'traditional' || r.script === 'mixed' ? r.script : 'unknown';
    out.push({
      id, title, file, script,
      author: str(r.author),
      level: str(r.level),
      blurb: str(r.blurb),
      source: str(r.source) || undefined,
      note: str(r.note) || undefined,
      chapters: posInt(r.chapters),
      chars: posInt(r.chars),
      group: str(r.group) || undefined,
      cover: /^covers\/[a-z0-9-]+\.jpg$/.test(str(r.cover)) ? str(r.cover) : undefined,
      coverCredit: str(r.coverCredit) || undefined,
      ...scripts(r),
    });
  }
  return out;
}

type Fetch = (url: string) => Promise<Pick<Response, 'ok' | 'text'>>;

function baseUrl(): string {
  return new URL('samples/', document.baseURI).href;
}

/** The sample list, or [] when the index is missing or unreadable. */
export async function fetchSamples(fetchFn: Fetch = (u) => fetch(u)): Promise<Sample[]> {
  try {
    const res = await fetchFn(baseUrl() + 'index.json');
    if (!res.ok) return [];
    return parseSampleIndex(JSON.parse(await res.text()));
  } catch {
    return [];
  }
}

/** The asset name a classic's cover is stored under. */
const COVER_ASSET = 'sample-cover.jpg';

/** Whether a book's picture is a classic's painting (added with it, or given it later): drawn as the cloth of its cover. */
export function hasSamplePainting(b: { cover?: string; coverFrom?: string }): boolean {
  return !!b.cover && (b.cover === COVER_ASSET || !!b.coverFrom?.startsWith('sample:'));
}

/** A classic's cover image, or null when it cannot be had. */
export async function sampleCover(s: Pick<Sample, 'cover'>): Promise<Blob | null> {
  if (!s.cover) return null;
  try {
    const res = await fetch(baseUrl() + s.cover);
    const blob = res.ok ? await res.blob() : null;
    return blob && /^image\//.test(blob.type || 'image/jpeg') ? blob : null;
  } catch { return null; }
}

/** Marks a stored book as coming from a sample, so the list can show "In your library". */
export const sampleSourceName = (id: string): string => `sample:${id}`;

/** Downloads one sample and turns it into a book (format 'sample', title and author from the index). */
export async function loadSampleBook(
  s: Sample,
  importText: (text: string, title?: string, author?: string) => ImportedBook,
  fetchFn: Fetch = (u) => fetch(u),
  /** The title as the library shows it (the reading script), for the messages. */
  shownTitle = s.title,
): Promise<ImportedBook> {
  let res: Awaited<ReturnType<Fetch>>;
  try {
    res = await fetchFn(baseUrl() + encodeURIComponent(s.file));
  } catch {
    // The request never got an answer: offline, and this classic was not stored by an earlier visit.
    throw new Error(typeof navigator !== 'undefined' && navigator.onLine === false
      ? 'You are offline. Connect once to add this classic.'
      : `Could not download “${shownTitle}”. Check your connection and try again.`);
  }
  if (!res.ok) throw new Error(`Could not download “${shownTitle}”. Check your connection and try again.`);
  const text = await res.text();
  if (/^\s*<(?:!doctype|html)/i.test(text)) throw new Error(`“${shownTitle}” is not available right now.`);
  const book = importText(text, s.title, s.author);
  // The classic's painting comes along as its cover. Without it (offline, not stored yet) the book still adds, drawn.
  const cover = s.cover ? await sampleCover(s) : null;
  return {
    ...book,
    ...(cover ? { assets: new Map([...book.assets, [COVER_ASSET, cover]]), cover: COVER_ASSET } : {}),
    title: s.title,
    author: s.author || book.author,
    format: 'sample',
    script: s.script !== 'unknown' ? s.script : book.script,
    sourceName: sampleSourceName(s.id),
    note: [s.note, s.source && `Source: ${s.source}`].filter(Boolean).join(' '),
  };
}
