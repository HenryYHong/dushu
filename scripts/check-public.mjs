// Fails when what would be published (the repository files, or the built site) holds something private.
//
//   node scripts/check-public.mjs [--source] [--build] [--dir dist]
//
// With no flag it checks both. --source reads the files git would commit (tracked, plus new files that are not ignored);
// --build reads the build folder (dist by default). It checks for:
//   - an email address (any, except example and noreply addresses), and the owner's own address from git config or
//     DUSHU_OWNER_EMAIL
//   - a Tailscale hostname (name.tailXXXXXX.ts.net, six hex characters), and the private address in .dushu-local/ipad.json when it exists
//   - an Anthropic API key (sk-ant- followed by 16 or more key characters, unless it spells a placeholder
//     word such as TEST or KEY), and the key in ~/.config/dushu/anthropic-api-key
//   - an EPUB file, or a file named after one of the owner's own books
//   - .dushu-local or .cache content
//   - long runs of text from the owner's own EPUBs in ~/Downloads, when those files are present on this machine
//   - any run of 8 or more Han characters that is in one of the owner's books (the two EPUBs in ~/Downloads and every EPUB,
//     MOBI/AZW3, PDF and TXT in ~/Downloads/Dushu Books) and in no public text (the public-domain samples in public/samples
//     and the third-party dictionaries in public/data), wherever it is: a code comment, a test, a doc or a data row
// It prints file names, line numbers, rule names and counts only, never the text it matched.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, relative, resolve } from 'node:path';
import { gunzipSync, unzipSync } from 'fflate';

const root = resolve(new URL('..', import.meta.url).pathname);
const args = process.argv.slice(2);
const dirFlag = args.indexOf('--dir');
const buildDir = resolve(root, dirFlag >= 0 ? args[dirFlag + 1] : 'dist');
const wantSource = args.includes('--source') || !args.some((a) => a === '--source' || a === '--build');
const wantBuild = args.includes('--build') || !args.some((a) => a === '--source' || a === '--build');

const problems = [];
const notes = [];
const fail = (where, rule, extra = '') => problems.push(`${where}: ${rule}${extra ? ` (${extra})` : ''}`);

// ---------------------------------------------------------------- patterns ---

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.css', '.html', '.json', '.txt', '.tsv', '.md', '.svg', '.webmanifest', '.yml', '.yaml', '.toml', '.command', '.py', '.map', '.d.ts', '.swift', '.sh', '']);
const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g;
// Test fixtures use made-up tailnets with a four-digit id (name.tail1234.ts.net); a real tailnet id has six hex characters.
// resend.dev is the email service's shared sender for the sync server's sign-in codes (cloud/), nobody's own address.
const BENIGN_EMAIL_DOMAIN = /(^|\.)(example\.(com|org|net)|invalid|localhost|test|users\.noreply\.github\.com|noreply\.github\.com|resend\.dev)$|\.tail\d{4}\.ts\.net$/i;
const TAILNET = /[a-z0-9-]+\.tail[0-9a-f]{5,}\.ts\.net/gi;
// A real key is long and random. Test fixtures spell out a placeholder word in theirs.
const API_KEY = /sk-ant-[A-Za-z0-9_-]{16,}/g;
const FAKE_KEY = /test|fake|dummy|example|key|secret|0123456789/i;
const BOOK_FILE = /\.epub$|活着|射雕/i;

/** Values that must never appear, read from this machine's private files when they exist. Held in memory only. */
const secrets = [];
function addSecret(label, value) {
  if (typeof value === 'string' && value.trim().length >= 6) secrets.push({ label, value: value.trim() });
}
function gitConfig(key) {
  try { return execFileSync('git', ['config', '--get', key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
}
const ownerEmail = process.env.DUSHU_OWNER_EMAIL || gitConfig('user.email');
if (ownerEmail.includes('@') && !BENIGN_EMAIL_DOMAIN.test(ownerEmail.split('@')[1])) addSecret('the owner email', ownerEmail);
try {
  const local = JSON.parse(readFileSync(join(root, '.dushu-local', 'ipad.json'), 'utf8'));
  addSecret('the private address', typeof local.host === 'string' ? local.host.replace(/:\d+$/, '') : '');
  addSecret('the owner identity', local.owner);
  addSecret('the private address', local.url);
} catch { /* no private setup on this machine (CI) */ }
try { addSecret('the Claude API key', readFileSync(join(homedir(), '.config', 'dushu', 'anthropic-api-key'), 'utf8')); } catch { /* none */ }
try { addSecret('the Mac key', readFileSync(join(homedir(), '.config', 'dushu', 'mac-key'), 'utf8')); } catch { /* none */ }

// ---------------------------------------------------- the owner's own books ---

const WINDOW = 10;
/** A run of this many Han characters found in an owner book and in no public text fails on its own, wherever it is. */
const SHORT = 8;
// The two owner EPUBs, and every book in the drop folder the Mac shares (scripts/local-books.ts).
const DROP = join(homedir(), 'Downloads', 'Dushu Books');
const OWNER_FORMATS = /\.(epub|mobi|azw3?|pdf|txt)$/i;
const OWNER_BOOKS = [
  ...['活着.epub', '射雕英雄传.epub'].map((n) => join(homedir(), 'Downloads', n)),
  ...(existsSync(DROP) ? readdirSync(DROP).filter((n) => OWNER_FORMATS.test(n)).map((n) => join(DROP, n)) : []),
].filter((p) => existsSync(p));
/** Hashes of every 10-character window inside a run of Han characters (punctuation ends a run). */
const bookWindows = new Set();
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
/** A 53-bit hash (two independent 32-bit mixes), so a single match among millions of windows is not a collision. */
const hash53 = (s) => {
  let a = 2166136261, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 0x5bd1e995); b ^= b >>> 15;
  }
  return (a >>> 0) * 0x200000 + ((b >>> 0) >>> 11);
};
const HAN_RUN = /\p{Script=Han}+/gu;
/** Every `size`-character window inside a run of Han characters, with the index where it starts. */
function* windowsAt(text, size) {
  for (const m of text.matchAll(HAN_RUN)) {
    const run = m[0];
    for (let i = 0; i + size <= run.length; i++) yield [run.slice(i, i + size), m.index + i];
  }
}
function* windowsOf(text, size = WINDOW) { for (const [w] of windowsAt(text, size)) yield w; }

// Kindle books (scripts/local-books.ts takes them): the PalmDOC or uncompressed text records, as src/import/mobiText.ts reads them.
function palmdoc(data) {
  const out = [];
  for (let i = 0; i < data.length;) {
    const c = data[i++];
    if (c === 0 || (c >= 9 && c <= 0x7f)) out.push(c);
    else if (c <= 8) { for (let k = 0; k < c && i < data.length; k++) out.push(data[i++]); }
    else if (c >= 0xc0) out.push(0x20, c ^ 0x80);
    else {
      if (i >= data.length) break;
      const m = ((c << 8) | data[i++]) & 0x3fff;
      const dist = m >> 3;
      if (dist < 1 || dist > out.length) break;
      for (let k = 0; k < (m & 7) + 3; k++) out.push(out[out.length - dist]);
    }
  }
  return Uint8Array.from(out);
}
function trailingSize(rec, flags) {
  const entry = (end) => {
    let result = 0, shift = 0, p = end;
    for (;;) {
      if (p <= 0) return -1;
      const v = rec[--p];
      result |= (v & 0x7f) << shift;
      shift += 7;
      if ((v & 0x80) !== 0 || shift >= 28) return result;
    }
  };
  let total = 0;
  for (let f = flags >> 1; f; f >>= 1) {
    if (f & 1) {
      const n = entry(rec.length - total);
      if (n < 0 || total + n > rec.length) return 0;
      total += n;
    }
  }
  if (flags & 1) { const at = rec.length - total - 1; if (at >= 0) total += (rec[at] & 3) + 1; }
  return Math.min(total, rec.length);
}
/** The text of a MOBI or AZW3 file, or null when it is compressed some other way (HUFF/CDIC) or damaged. */
function mobiText(b) {
  const u16 = (x, o) => (x[o] << 8) | x[o + 1];
  const u32 = (x, o) => x[o] * 0x1000000 + ((x[o + 1] << 16) | (x[o + 2] << 8) | x[o + 3]);
  if (b.length < 86) return null;
  const n = u16(b, 76);
  const offsets = Array.from({ length: n }, (_, i) => u32(b, 78 + i * 8));
  const rec = (i) => b.subarray(offsets[i], i + 1 < n ? offsets[i + 1] : b.length);
  const r0 = rec(0);
  if (r0.length < 16) return null;
  const compression = u16(r0, 0);
  if (compression !== 1 && compression !== 2) return null;
  const isMobi = r0.length >= 32 && String.fromCharCode(...r0.subarray(16, 20)) === 'MOBI';
  const headerLength = isMobi ? u32(r0, 20) : 0;
  const extra = isMobi && headerLength >= 0xe4 && headerLength <= 500 && r0.length >= 0xf4 ? u16(r0, 0xf2) : 0;
  const parts = [];
  for (let i = 1; i <= u16(r0, 8) && i < n; i++) {
    const r = rec(i);
    const body = r.subarray(0, r.length - trailingSize(r, extra));
    parts.push(compression === 2 ? palmdoc(body) : body);
  }
  const all = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return new TextDecoder(isMobi && u32(r0, 28) === 1252 ? 'windows-1252' : 'utf-8').decode(all);
}
async function pdfText(bytes) {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await getDocument({ data: bytes, isEvalSupported: false, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    pages.push((await page.getTextContent()).items.map((item) => item.str ?? '').join(''));
    page.cleanup();
  }
  await doc.destroy();
  return pages.join('\n');
}
/** The text of an owner book (markup stripped), or null when its format cannot be read here. */
async function ownerBookText(path) {
  const bytes = new Uint8Array(readFileSync(path));
  const ext = extname(path).toLowerCase();
  if (ext === '.epub') {
    const files = unzipSync(bytes, { filter: (f) => /\.(x?html?)$/i.test(f.name) });
    return Object.values(files).map((data) => new TextDecoder().decode(data).replace(/<[^>]*>/g, ' ')).join('\n');
  }
  if (ext === '.pdf') return pdfText(bytes);
  if (ext === '.txt') {
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return new TextDecoder('gb18030').decode(bytes); }
  }
  return mobiText(bytes)?.replace(/<[^>]*>/g, ' ') ?? null;
}

/** 8-character windows of the owner books that are in no public text. */
const ownerShort = new Set();
if (OWNER_BOOKS.length) {
  // Public text: the public-domain samples, and the third-party dictionaries the app ships (CC-CEDICT, Wiktionary, the
  // segmentation vocabulary, OpenCC, JMdict), whose set phrases any book may use.
  const publicShort = new Set();
  const addPublic = (text) => { for (const w of windowsOf(text, SHORT)) publicShort.add(hash53(w)); };
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  for (const p of walk(join(root, 'public', 'samples')).filter((p) => p.endsWith('.txt'))) addPublic(readFileSync(p, 'utf8'));
  for (const name of ['cedict.tsv.gz', 'cedict-extra.tsv.gz', 'words.tsv.gz', 's2t.tsv.gz', 't2s.tsv.gz', 'ja/jmdict.tsv.gz']) {
    const p = join(root, 'public', 'data', name);
    if (existsSync(p)) addPublic(new TextDecoder().decode(gunzipSync(new Uint8Array(readFileSync(p)))));
  }
  for (const path of OWNER_BOOKS) {
    const text = await ownerBookText(path);
    if (text === null) { notes.push(`one owner book could not be read (${extname(path)}), so its text was not checked`); continue; }
    for (const w of windowsOf(text)) bookWindows.add(hash(w));
    for (const w of windowsOf(text, SHORT)) { const h = hash53(w); if (!publicShort.has(h)) ownerShort.add(h); }
  }
}
if (!OWNER_BOOKS.length) notes.push('the owner books are not on this machine, so the text-overlap checks were skipped');

// ------------------------------------------------------------------- files ---

function sourceFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 });
  return out.split('\0').filter(Boolean).filter((p) => existsSync(join(root, p)));
}
function buildFiles() {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full); else out.push(relative(buildDir, full));
    }
  };
  if (existsSync(buildDir)) walk(buildDir);
  return out;
}

/** A home folder (/Users/name/, /home/name/) or a temporary folder of this machine (/private/tmp/…, /var/folders/…). */
const LOCAL_PATH = /\/(?:Users|home)\/[A-Za-z0-9._-]+\/|\/private\/(?:tmp|var)\/[A-Za-z0-9._-]+|\/var\/folders\/[A-Za-z0-9_]+/g;

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

function scanText(where, text) {
  let count = 0;
  for (const m of text.matchAll(EMAIL)) if (!BENIGN_EMAIL_DOMAIN.test(m[1])) { count++; fail(`${where}:${lineOf(text, m.index)}`, 'an email address'); if (count > 3) break; }
  for (const m of text.matchAll(TAILNET)) fail(`${where}:${lineOf(text, m.index)}`, 'a Tailscale hostname');
  for (const m of text.matchAll(API_KEY)) if (!FAKE_KEY.test(m[0])) fail(`${where}:${lineOf(text, m.index)}`, 'an Anthropic API key');
  // A path on the machine it was built on: it names the account, and a scratch folder names the tool that made it.
  for (const m of text.matchAll(LOCAL_PATH)) fail(`${where}:${lineOf(text, m.index)}`, 'a path on this machine', m[0]);
  for (const s of secrets) {
    const at = text.indexOf(s.value);
    if (at >= 0) fail(`${where}:${lineOf(text, at)}`, s.label);
  }
  if (bookWindows.size) {
    let hits = 0;
    for (const w of windowsOf(text)) if (bookWindows.has(hash(w))) hits++;
    if (hits >= 30) fail(where, 'text from one of the owner books', `${hits} matching passages of ${WINDOW} characters`);
  }
  if (ownerShort.size) {
    // Each line once, a few lines per file at most; never the text.
    const lines = new Map();
    for (const [w, at] of windowsAt(text, SHORT)) {
      if (!ownerShort.has(hash53(w))) continue;
      const line = lineOf(text, at);
      lines.set(line, (lines.get(line) ?? 0) + 1);
    }
    let shown = 0;
    for (const [line, n] of lines) {
      if (shown++ === 5) { fail(where, `${SHORT}+ characters from one of the owner books`, `${lines.size - 5} more lines`); break; }
      fail(`${where}:${line}`, `${SHORT}+ characters from one of the owner books`, `${n} window${n === 1 ? '' : 's'} of ${SHORT}`);
    }
  }
}

function scanFile(where, bytes, pathForType) {
  let ext = extname(pathForType).toLowerCase();
  let data = bytes;
  if (ext === '.gz') { try { data = gunzipSync(bytes); } catch { return; } ext = extname(pathForType.slice(0, -3)).toLowerCase(); }
  if (ext === '.epub' || ext === '.zip') return; // refused by name
  if (!TEXT_EXT.has(ext)) return; // fonts, images
  scanText(where, new TextDecoder().decode(data));
}

function checkNames(label, files) {
  for (const f of files) {
    const norm = f.replace(/\\/g, '/');
    if (/(^|\/)(\.dushu-local|\.cache)(\/|$)/.test(norm)) fail(`${label}:${norm}`, 'private or cache content');
    if (BOOK_FILE.test(norm.split('/').pop() ?? '')) fail(`${label}:${norm}`, 'an EPUB or a file named after one of the owner books');
    if (/(^|\/)\.env(\.|$)/.test(norm) || /\.pem$/.test(norm)) fail(`${label}:${norm}`, 'a secrets file');
  }
}

if (wantSource) {
  const files = sourceFiles();
  checkNames('source', files);
  for (const f of files) {
    if (f === 'scripts/check-public.mjs') continue; // this file names the patterns it looks for
    scanFile(`source:${f}`, readFileSync(join(root, f)), f);
  }
  console.log(`source: checked ${files.length} files`);
}
if (wantBuild) {
  if (!existsSync(buildDir)) { fail('build', `no build folder at ${relative(root, buildDir) || buildDir}; run npm run build first`); }
  else {
    const files = buildFiles();
    checkNames('build', files);
    for (const f of files) scanFile(`build:${f}`, readFileSync(join(buildDir, f)), f);
    console.log(`build: checked ${files.length} files in ${relative(root, buildDir) || buildDir}`);
  }
}

for (const n of notes) console.log(`note: ${n}`);
if (problems.length) {
  console.log(`\nFAIL: ${problems.length} problem${problems.length === 1 ? '' : 's'}`);
  for (const p of problems.slice(0, 60)) console.log(`  ${p}`);
  process.exit(1);
}
console.log(`PASS: nothing private found${secrets.length ? ` (also checked ${secrets.length} private value${secrets.length === 1 ? '' : 's'} from this machine)` : ''}${bookWindows.size ? ' and the owner book text' : ''}`);
