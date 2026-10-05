#!/usr/bin/env node
/**
 * Vorbereitung vor dem Start (start.cmd / start.sh): prüft Node.js, installiert Abhängigkeiten
 * und baut die Oberfläche – aber nur, wenn sich seit dem letzten Lauf etwas geändert hat.
 *
 * Nach einem Update (neue Programmdateien) erkennt das Skript geänderte Abhängigkeiten
 * (package-lock.json) bzw. geänderte Quelltexte der Oberfläche und holt Installation und
 * Build nach. Die Daten im Datenverzeichnis werden dabei nie angefasst.
 *
 *   node scripts/prepare.mjs            prüfen und nur Nötiges ausführen
 *   node scripts/prepare.mjs --force    Installation und Build erzwingen
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');

function fail(message) {
  console.error(`  [!] ${message}`);
  process.exit(1);
}

const major = Number(process.versions.node.split('.')[0]);
if (major < 24) fail(`Node.js ${process.versions.node} ist zu alt – benötigt wird Version 24 oder neuer (https://nodejs.org/).`);

function run(args) {
  // Unter Windows ist npm ein .cmd-Skript – über cmd.exe starten statt mit `shell: true`
  const result =
    process.platform === 'win32'
      ? spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', 'npm', ...args], { cwd: root, stdio: 'inherit' })
      : spawnSync('npm', args, { cwd: root, stdio: 'inherit' });
  return result.status === 0;
}

function hashFiles(files) {
  const hash = crypto.createHash('sha256');
  for (const file of files) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    hash.update(file.replace(/\\/g, '/'));
    hash.update(fs.readFileSync(full));
  }
  return hash.digest('hex');
}

function listFiles(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(root, path.join(e.parentPath, e.name)))
    .sort();
}

function readStamp(file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  } catch {
    return null;
  }
}

function writeStamp(file, value) {
  fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2));
}

const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

/* ----------------------------- Abhängigkeiten ----------------------------- */

// Installationspaket (scripts/package.mjs): Oberfläche fertig gebaut, nur Laufzeit-Abhängigkeiten
const packageInfo = readStamp('.knowstead-package.json');
if (packageInfo) {
  console.log(`  Installationspaket ${packageInfo.version} (${packageInfo.platform}-${packageInfo.arch})`);
  if (packageInfo.platform !== process.platform || packageInfo.arch !== process.arch) {
    console.log(`  Hinweis: Das Paket wurde für ${packageInfo.platform}-${packageInfo.arch} gebaut – die Abhängigkeiten werden für dieses System neu installiert (Internetzugang nötig).`);
  }
}

const lockHash = hashFiles(['package.json', 'package-lock.json', 'server/package.json', 'web/package.json']);
const installStamp = 'node_modules/.knowstead-install.json';
const installed = fs.existsSync(path.join(root, 'node_modules')) ? readStamp(installStamp) : null;
const platformChanged = !!packageInfo && (packageInfo.platform !== process.platform || packageInfo.arch !== process.arch) && installed?.platform !== process.platform;
if (force || !installed || installed.lockHash !== lockHash || platformChanged) {
  console.log(installed ? '  [1/3] Abhängigkeiten haben sich geändert – werden aktualisiert …' : '  [1/3] Abhängigkeiten werden installiert – das dauert beim ersten Mal ein paar Minuten …');
  const production = packageInfo ? ['--omit=dev', '--workspace=server', '--include-workspace-root'] : [];
  const ok = fs.existsSync(path.join(root, 'package-lock.json'))
    ? run(['ci', ...production, '--no-audit', '--no-fund']) || run(['install', ...production, '--no-audit', '--no-fund'])
    : run(['install', ...production, '--no-audit', '--no-fund']);
  if (!ok) fail('Installation der Abhängigkeiten fehlgeschlagen. Bitte die Meldungen oben prüfen.');
  writeStamp(installStamp, { lockHash, version, production: !!packageInfo, platform: process.platform, installedAt: new Date().toISOString() });
} else {
  console.log('  [1/3] Abhängigkeiten aktuell.');
}

/* ------------------------------- Oberfläche ------------------------------- */

if (!fs.existsSync(path.join(root, 'web/src'))) {
  // Paket ohne Quelltexte der Oberfläche: es gibt nichts zu bauen
  if (!fs.existsSync(path.join(root, 'web/dist/index.html'))) fail('Die Oberfläche fehlt (web/dist) – bitte das Installationspaket vollständig entpacken.');
  console.log('  [2/3] Oberfläche vorgebaut.');
  process.exit(0);
}

const sourceHash = hashFiles([
  ...listFiles('web/src'),
  ...listFiles('web/public'),
  'web/index.html',
  'web/vite.config.ts',
  'web/tsconfig.json',
  'web/package.json',
  'package-lock.json',
]);
const buildStamp = 'web/dist/.knowstead-build.json';
const built = fs.existsSync(path.join(root, 'web/dist/index.html')) ? readStamp(buildStamp) : null;
if (force || !built || built.sourceHash !== sourceHash) {
  console.log(built ? '  [2/3] Oberfläche hat sich geändert – wird neu gebaut …' : '  [2/3] Oberfläche wird gebaut …');
  if (!run(['run', 'build'])) fail('Bauen der Oberfläche fehlgeschlagen. Bitte die Meldungen oben prüfen.');
  writeStamp(buildStamp, { sourceHash, version, builtAt: new Date().toISOString() });
} else {
  console.log('  [2/3] Oberfläche aktuell.');
}
