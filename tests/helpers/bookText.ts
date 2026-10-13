// Plain text of a book for tests. The public-domain classics ship in public/samples. The owner's own EPUBs
// (活着, 射雕英雄传) are read from ~/Downloads when present and are never copied: tests that use them only assert
// on counts and short words, never print passages.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

export function sampleText(name: 'xiyouji' | 'hongloumeng'): string {
  return readFileSync(join(__dirname, '..', '..', 'public', 'samples', `${name}.txt`), 'utf8');
}

/** Text of an EPUB in ~/Downloads, or null when it is not there. */
export function downloadsEpubText(file: string): string | null {
  const path = join(homedir(), 'Downloads', file);
  if (!existsSync(path)) return null;
  const zip = unzipSync(new Uint8Array(readFileSync(path)));
  const parts: string[] = [];
  for (const name of Object.keys(zip).filter((n) => /\.x?html?$/i.test(n)).sort()) {
    parts.push(strFromU8(zip[name])
      .replace(/<(script|style|rt|rp)[\s\S]*?<\/\1>/gi, '')
      .replace(/<\/(p|div|h\d|li)>|<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&'));
  }
  return parts.join('\n');
}
