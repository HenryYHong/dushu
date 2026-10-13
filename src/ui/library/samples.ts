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
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const posInt = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);

/** Keeps the rows that have what we need to show and import them; drops everything else. */
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

/** Marks a stored book as coming from a sample, so the list can show "In your library". */
export const sampleSourceName = (id: string): string => `sample:${id}`;

/** Downloads one sample and turns it into a book (format 'sample', title and author from the index). */
export async function loadSampleBook(
  s: Sample,
  importText: (text: string, title?: string, author?: string) => ImportedBook,
  fetchFn: Fetch = (u) => fetch(u),
): Promise<ImportedBook> {
  const res = await fetchFn(baseUrl() + encodeURIComponent(s.file));
  if (!res.ok) throw new Error(`Could not download “${s.title}”. Check your connection and try again.`);
  const text = await res.text();
  if (/^\s*<(?:!doctype|html)/i.test(text)) throw new Error(`“${s.title}” is not available right now.`);
  const book = importText(text, s.title, s.author);
  return {
    ...book,
    title: s.title,
    author: s.author || book.author,
    format: 'sample',
    script: s.script !== 'unknown' ? s.script : book.script,
    sourceName: sampleSourceName(s.id),
    note: [s.note, s.source && `Source: ${s.source}`].filter(Boolean).join(' '),
  };
}
