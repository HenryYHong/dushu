// Start Dushu when you log in to this Mac, and start it again if it stopped (checked every 15 minutes), so the iPad, sync
// and the books from your Mac are there without double-clicking Dushu.command. A per-user LaunchAgent; nothing system-wide.
//   npm run autostart            install (or update) and start now
//   npm run autostart -- status  is it installed, and did its last run work
//   npm run autostart -- remove  stop starting at login (a running Dushu keeps running)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const label = 'com.dushu.reader';
const plist = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
const logDir = join(homedir(), 'Library', 'Logs', 'Dushu');
const domain = `gui/${process.getuid()}`;
const action = process.argv[2] ?? 'install';

const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const launchctl = (...args) => {
  try { return { ok: true, out: execFileSync('/bin/launchctl', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) }; }
  catch (e) { return { ok: false, out: String(e.stderr || e.message) }; }
};

if (process.platform !== 'darwin') {
  console.error('Starting at login is set up for macOS only.');
  process.exit(1);
}

if (action === 'install') {
  if (!existsSync(join(root, 'dist', 'index.html'))) {
    console.error('Build Dushu first (double-click Dushu.command once, or run npm run build).');
    process.exit(1);
  }
  mkdirSync(dirname(plist), { recursive: true });
  mkdirSync(logDir, { recursive: true });
  // The PATH launchd gives a job is minimal; the launcher needs node (this one) and ollama.
  const path = [...new Set([dirname(process.execPath), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'])].join(':');
  writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(join(root, 'scripts', 'start-local.mjs'))}</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(path)}</string></dict>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>900</integer>
  <key>AbandonProcessGroup</key><true/>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${xml(join(logDir, 'autostart.log'))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logDir, 'autostart.log'))}</string>
</dict>
</plist>
`);
  // Load it fresh (an older copy is replaced), which also runs it once now.
  launchctl('bootout', `${domain}/${label}`);
  const loaded = launchctl('bootstrap', domain, plist);
  if (!loaded.ok) { console.error(`Could not load the login item: ${loaded.out.trim()}`); process.exit(1); }
  console.log(`Dushu now starts when you log in, and again within 15 minutes if it stops. Log: ${join(logDir, 'autostart.log')}`);
  console.log('To turn this off: npm run autostart -- remove');
} else if (action === 'remove') {
  launchctl('bootout', `${domain}/${label}`);
  rmSync(plist, { force: true });
  console.log('Dushu no longer starts at login. If it is running now, it keeps running until you restart the Mac.');
} else if (action === 'status') {
  if (!existsSync(plist)) { console.log('Not set up: Dushu does not start at login.'); process.exit(0); }
  const info = launchctl('print', `${domain}/${label}`);
  const exit = /last exit code = (.+)/.exec(info.out)?.[1] ?? 'not run yet';
  console.log(`Set up: Dushu starts at login (${plist}). Last run: ${info.ok ? exit : 'not loaded'}.`);
  try {
    const tail = readFileSync(join(logDir, 'autostart.log'), 'utf8').trim().split('\n').slice(-3).join('\n');
    if (tail) console.log(tail);
  } catch { /* no log yet */ }
} else {
  console.error('Use: npm run autostart [-- status | -- remove]');
  process.exit(1);
}
