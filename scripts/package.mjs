#!/usr/bin/env node
/**
 * Installationspaket bauen: fertige Oberfläche und nur die Laufzeit-Abhängigkeiten des Servers – auf dem
 * Zielserver sind weder Build noch Paketdownload nötig. Ein Paket gilt für ein Betriebssystem und eine
 * Prozessorarchitektur (ein optionales natives Modul für die PDF-Vorschau ist plattformabhängig).
 *
 *   npm run build && node scripts/package.mjs              → release/knowstead-<version>-<plattform>-x64.zip|tar.gz
 *   node scripts/package.mjs --target linux-x64            Paket für ein anderes System, z. B. unter Windows für Linux
 *   node scripts/package.mjs --out D:\Pakete --offline     npm nur aus dem lokalen Zwischenspeicher
 *
 * Genutzt vom GitHub-Workflow „Release“ (.github/workflows/release.yml).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
};
const offline = args.includes('--offline');

const fail = (message) => {
  console.error(`  [!] ${message}`);
  process.exit(1);
};

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
/** Namen im Paketnamen → Node.js-Plattform */
const PLATFORMS = { windows: 'win32', linux: 'linux', macos: 'darwin' };
const hostName = Object.keys(PLATFORMS).find((key) => PLATFORMS[key] === process.platform) ?? process.platform;
const target = option('target') ?? `${hostName}-${process.arch}`;
const [targetName, targetArch] = target.split('-');
const targetPlatform = PLATFORMS[targetName];
if (!targetPlatform || !['x64', 'arm64'].includes(targetArch)) fail(`Unbekanntes Ziel „${target}“ – möglich sind z. B. linux-x64, linux-arm64, windows-x64.`);
const cross = targetPlatform !== process.platform || targetArch !== process.arch;
const name = `knowstead-${version}-${targetName}-${targetArch}`;
const outDir = path.resolve(option('out') ?? path.join(root, 'release'));
const stage = path.join(outDir, name);

if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) fail('Die Oberfläche ist nicht gebaut – zuerst „npm run build“ ausführen.');

/** Was ins Paket gehört (Pfade relativ zum Programmordner) */
const INCLUDE = [
  'package.json',
  'package-lock.json',
  '.env.example',
  '.env.example.en',
  'README.md',
  'README.de.md',
  'LICENSE',
  'CHANGELOG.md',
  'SECURITY.md',
  'start.cmd',
  'start.sh',
  'install.sh',
  'update.sh',
  'Knowstead-Installation.cmd',
  'Knowstead-Dienst.cmd',
  'docs',
  'plugins',
  'scripts/lang.mjs',
  'scripts/prepare.mjs',
  'scripts/install.mjs',
  'scripts/loadtest.mjs',
  'scripts/install',
  'server/package.json',
  'server/tsconfig.json',
  'server/src',
  'web/package.json',
  'web/dist',
];

function run(command, commandArgs, cwd) {
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', command, ...commandArgs], { cwd, stdio: 'inherit' })
      : spawnSync(command, commandArgs, { cwd, stdio: 'inherit' });
  if (result.status !== 0) fail(`${command} ${commandArgs.join(' ')} ist fehlgeschlagen.`);
}

function hashFiles(base, files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const full = path.join(base, file);
    if (!fs.existsSync(full)) continue;
    hash.update(file.replace(/\\/g, '/'));
    hash.update(fs.readFileSync(full));
  }
  return hash.digest('hex');
}

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, base);
    return entry.isFile() ? [path.relative(base, full)] : [];
  });
}

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/** Einträge für tar.gz: Verzeichnisse vor ihrem Inhalt, feste Rechte, Links mit relativem Ziel im Paket */
function* tarEntries(dir, prefix) {
  yield { name: prefix, type: 'directory', mtime: fs.statSync(dir).mtime };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort(byName)) {
    const full = path.join(dir, entry.name);
    const name = `${prefix}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      // Windows legt Arbeitsbereiche als Verzeichnisverknüpfung mit absolutem Ziel an
      const linkTarget = path.resolve(path.dirname(full), fs.readlinkSync(full).replace(/^\\\\\?\\/, ''));
      const rel = path.relative(stage, linkTarget);
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        yield { name, type: 'symlink', target: path.relative(path.dirname(full), linkTarget).replace(/\\/g, '/') };
      } else {
        console.log(`    Verknüpfung außerhalb des Pakets ausgelassen: ${name}`);
      }
    } else if (entry.isDirectory()) {
      yield* tarEntries(full, name);
    } else if (entry.isFile()) {
      const executable = entry.name.endsWith('.sh') || (process.platform !== 'win32' && (fs.statSync(full).mode & 0o111) !== 0);
      yield { name, type: 'file', file: full, mode: executable ? 0o755 : 0o644 };
    }
  }
}

/** Passt ein Paket mit `os`/`cpu`-Angabe (auch mit „!win32“) zum Ziel? */
function allowed(list, value) {
  if (!list?.length) return true;
  if (list.includes(`!${value}`)) return false;
  const positive = list.filter((item) => !item.startsWith('!'));
  return positive.length === 0 || positive.includes(value);
}

/** Plattformabhängige Pakete prüfen: alle passenden da, keine für ein anderes System */
function checkPlatformPackages() {
  const lock = JSON.parse(fs.readFileSync(path.join(stage, 'package-lock.json'), 'utf8'));
  const present = (key) => fs.existsSync(path.join(stage, key));
  const fits = (meta) => allowed(meta.os, targetPlatform) && allowed(meta.cpu, targetArch);
  const installed = [];
  const foreign = [];
  const missing = [];
  for (const [key, meta] of Object.entries(lock.packages)) {
    if (!key.startsWith('node_modules/') || !present(key)) continue;
    if (meta.os || meta.cpu) (fits(meta) ? installed : foreign).push(key.slice('node_modules/'.length));
    for (const dep of Object.keys(meta.optionalDependencies ?? {})) {
      const nested = `${key}/node_modules/${dep}`;
      const depKey = lock.packages[nested] ? nested : `node_modules/${dep}`;
      const depMeta = lock.packages[depKey];
      if (depMeta && (depMeta.os || depMeta.cpu) && fits(depMeta) && !present(depKey)) missing.push(dep);
    }
  }
  if (installed.length) console.log(`    für ${target}: ${installed.join(', ')}`);
  if (foreign.length) fail(`Im Paket liegen Module für ein anderes System: ${foreign.join(', ')}`);
  if (missing.length) fail(`Für ${target} fehlen: ${missing.join(', ')} – ohne Internetzugang (--offline) sind sie evtl. nicht im npm-Zwischenspeicher.`);
}

console.log(`\n  Installationspaket ${name}\n`);
fs.rmSync(stage, { recursive: true, force: true });
fs.mkdirSync(stage, { recursive: true });

console.log('  ▸ Dateien kopieren');
for (const entry of INCLUDE) {
  const from = path.join(root, entry);
  if (!fs.existsSync(from)) fail(`${entry} fehlt.`);
  fs.cpSync(from, path.join(stage, entry), {
    recursive: true,
    // Keine Protokolle, Build-Stempel oder Editor-Reste mitnehmen
    filter: (src) => !/[\\/](node_modules|\.git)([\\/]|$)/.test(path.relative(root, src)) && !/\.log$/.test(src),
  });
}

// Was die mitgelieferten Skripte selbst einbinden, muss im Paket liegen – sonst bricht der Assistent erst beim
// Installieren ab. Erst die Verweise im Quelltext, dann ein Probelauf des Installationskerns aus dem Paket heraus
// (verändert nichts und braucht keine Abhängigkeiten).
const unresolved = [];
for (const entry of INCLUDE.filter((name) => /^scripts\/[^/]+\.mjs$/.test(name))) {
  const source = fs.readFileSync(path.join(stage, entry), 'utf8');
  for (const match of source.matchAll(/\b(?:from|import)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    // Bezugsort ist der Ordner des Skripts – oder der Programmordner bei Code, den es mit »node -e« dort startet
    if (!fs.existsSync(path.join(stage, path.dirname(entry), match[1])) && !fs.existsSync(path.join(stage, match[1]))) unresolved.push(`${entry} → ${match[1]}`);
  }
}
if (unresolved.length) fail(`Im Paket fehlen Dateien, die mitgelieferte Skripte einbinden: ${unresolved.join(', ')}`);
const probe = spawnSync(process.execPath, ['scripts/install.mjs', '--lang', 'de', '--dry-run', '--skip-prepare', '--skip-test', '--env-path', path.join(stage, '.env.probe')], {
  cwd: stage,
  encoding: 'utf8',
});
if (probe.status !== 0) fail(`Der Installationskern startet aus dem Paket heraus nicht: ${(probe.stderr || probe.stdout).trim()}`);

if (targetPlatform !== 'win32') {
  // Mit Windows-Zeilenenden bricht bash ab („$'\r': command not found“)
  for (const script of ['install.sh', 'update.sh', 'start.sh', 'scripts/install/linux/extras.sh']) {
    if (fs.readFileSync(path.join(stage, script)).includes(13)) fail(`${script} hat Windows-Zeilenenden (CRLF) – bitte mit LF speichern.`);
  }
}

console.log(`  ▸ Laufzeit-Abhängigkeiten installieren (ohne Entwicklungswerkzeuge${cross ? `, für ${target}` : ''})`);
run(
  'npm',
  [
    'ci',
    '--omit=dev',
    '--workspace=server',
    '--include-workspace-root',
    '--no-audit',
    '--no-fund',
    // npm wählt die nativen Module dann für das Zielsystem statt für diesen Rechner
    ...(cross ? [`--os=${targetPlatform}`, `--cpu=${targetArch}`] : []),
    ...(offline ? ['--offline'] : []),
  ],
  stage,
);
checkPlatformPackages();

// Stempel wie scripts/prepare.mjs – so erkennt der Start, dass nichts nachzuholen ist
const lockHash = hashFiles(stage, ['package.json', 'package-lock.json', 'server/package.json', 'web/package.json']);
fs.writeFileSync(
  path.join(stage, 'node_modules', '.knowstead-install.json'),
  JSON.stringify({ lockHash, version, production: true, platform: targetPlatform, installedAt: new Date().toISOString() }, null, 2),
);
const packageInfo = JSON.stringify(
  { version, platform: targetPlatform, arch: targetArch, node: process.versions.node, builtOn: `${process.platform}-${process.arch}`, builtAt: new Date().toISOString() },
  null,
  2,
);
fs.writeFileSync(path.join(stage, '.knowstead-package.json'), packageInfo);
// Dieselbe Beschreibung unter ihrem früheren Namen: Das update.sh einer Installation bis 1.9 nimmt ein Paket
// nur an, wenn es sie findet – danach übernimmt das update.sh aus diesem Paket. Entfällt mit Version 3.
fs.writeFileSync(path.join(stage, '.doku-package.json'), packageInfo);

console.log('  ▸ Archiv erstellen');
let archive;
if (targetPlatform === 'win32') {
  archive = path.join(outDir, `${name}.zip`);
  const { zipStream } = await import('../server/src/core/zip.ts');
  const files = walk(stage).sort();
  async function* sources() {
    for (const file of files) yield { name: `${name}/${file.replace(/\\/g, '/')}`, file: path.join(stage, file) };
  }
  await pipeline(zipStream(sources()), fs.createWriteStream(archive));
} else {
  // Eigenes tar: Besitzer root und Rechte 644/755 – unabhängig davon, auf welchem System gebaut wird
  archive = path.join(outDir, `${name}.tar.gz`);
  const { tarGzStream } = await import('../server/src/core/tar.ts');
  await pipeline(tarGzStream(tarEntries(stage, name)), fs.createWriteStream(archive));
}

// Den ausgepackten Zwischenstand nicht liegen lassen: 250 MB, und ESLint würde ihn mitprüfen
fs.rmSync(stage, { recursive: true, force: true });

const digest = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
fs.writeFileSync(`${archive}.sha256`, `${digest}  ${path.basename(archive)}\n`);
const size = fs.statSync(archive).size;
console.log(`\n  Fertig: ${archive} (${(size / 1024 / 1024).toFixed(1)} MB)\n  SHA-256: ${digest}\n`);
