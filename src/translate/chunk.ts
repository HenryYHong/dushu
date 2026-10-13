// Sentence-boundary chunking shared by the network translators.

const SENTENCE_END = /[^。！？!?；;\n]*(?:[。！？!?；;]+["'”’」』）)]*|\n+|$)/g;
const SOFT_BREAK = /[^，、,：:]*(?:[，、,：:]|$)/g;

function pieces(text: string, re: RegExp): string[] {
  return (text.match(re) ?? []).filter(s => s.length > 0);
}

/** Cut at max without splitting a surrogate pair. */
function hardSplit(s: string, max: number): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    let end = Math.min(i + max, s.length);
    const last = s.charCodeAt(end - 1);
    if (end < s.length && last >= 0xd800 && last <= 0xdbff) end--;
    out.push(s.slice(i, end));
    i = end;
  }
  return out;
}

/** Split text into chunks of at most `max` UTF-16 units, preferring sentence, then comma, boundaries. */
export function chunkText(text: string, max = 500): string[] {
  const out: string[] = [];
  let cur = '';
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };
  const add = (piece: string) => {
    if (cur.length + piece.length > max) flush();
    cur += piece;
  };
  for (const sentence of pieces(text, SENTENCE_END)) {
    if (sentence.length <= max) { add(sentence); continue; }
    for (const part of pieces(sentence, SOFT_BREAK)) {
      if (part.length <= max) add(part);
      else for (const h of hardSplit(part, max)) { flush(); add(h); }
    }
  }
  flush();
  return out;
}
