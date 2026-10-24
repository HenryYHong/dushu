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
// It prints file names, rule names and counts only, never the text it matched.
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

const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.css', '.html', '.json', '.txt', '.tsv', '.md', '.svg', '.webmanifest', '.yml', '.yaml', '.toml', '.command', '.py', '.map', '.d.ts', '']);
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

// ---------------------------------------------------- the owner's own books ---

const HAN = /\p{Script=Han}/u;
const WINDOW = 10;
const OWNER_BOOKS = ['活着.epub', '射雕英雄传.epub'].map((n) => join(homedir(), 'Downloads', n)).filter((p) => existsSync(p));
/** Hashes of every 10-character window inside a run of Han characters (punctuation ends a run). */
const bookWindows = new Set();
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function* windowsOf(text) {
  let run = '';
  const flush = function* () { for (let i = 0; i + WINDOW <= run.length; i++) yield run.slice(i, i + WINDOW); run = ''; };
  for (const ch of text) { if (HAN.test(ch)) run += ch; else yield* flush(); }
  yield* flush();
}
for (const path of OWNER_BOOKS) {
  const files = unzipSync(new Uint8Array(readFileSync(path)), { filter: (f) => /\.(x?html?)$/i.test(f.name) });
  for (const data of Object.values(files)) {
    const text = new TextDecoder().decode(data).replace(/<[^>]*>/g, ' ');
    for (const w of windowsOf(text)) bookWindows.add(hash(w));
  }
}
if (!OWNER_BOOKS.length) notes.push('the owner EPUBs are not on this machine, so the text-overlap check was skipped');

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

function lineOf(text, index) { return text.slice(0, index).split('\n').length; }

function scanText(where, text) {
  let count = 0;
  for (const m of text.matchAll(EMAIL)) if (!BENIGN_EMAIL_DOMAIN.test(m[1])) { count++; fail(`${where}:${lineOf(text, m.index)}`, 'an email address'); if (count > 3) break; }
  for (const m of text.matchAll(TAILNET)) fail(`${where}:${lineOf(text, m.index)}`, 'a Tailscale hostname');
  for (const m of text.matchAll(API_KEY)) if (!FAKE_KEY.test(m[0])) fail(`${where}:${lineOf(text, m.index)}`, 'an Anthropic API key');
  for (const s of secrets) {
    const at = text.indexOf(s.value);
    if (at >= 0) fail(`${where}:${lineOf(text, at)}`, s.label);
  }
  if (bookWindows.size) {
    let hits = 0;
    for (const w of windowsOf(text)) if (bookWindows.has(hash(w))) hits++;
    if (hits >= 30) fail(where, 'text from one of the owner books', `${hits} matching passages of ${WINDOW} characters`);
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
