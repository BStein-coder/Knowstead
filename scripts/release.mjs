#!/usr/bin/env node
/**
 * Release vorbereiten und prüfen – damit Versionsnummer, Änderungsprotokoll und Git-Stand zusammenpassen, bevor ein
 * Tag gesetzt wird (der Workflow „Release“ prüft dasselbe und bricht sonst erst auf GitHub ab).
 *
 *   node scripts/release.mjs bump 2.3.0 [--date 2026-11-01] [--dry-run]
 *       Versionsnummer überall setzen: die drei package.json, die eigenen Einträge der Lock-Datei, die Beispiele in
 *       Dokumentation und Vorlagen. Der Abschnitt „Unveröffentlicht“ im Änderungsprotokoll wird zu „[2.3.0] – Datum“.
 *   node scripts/release.mjs check [2.3.0] [--tag v2.3.0] [--git]
 *       Prüft, ob alles zusammenpasst: gleiche Version in allen Dateien, Abschnitt im Änderungsprotokoll (mit Datum,
 *       nicht leer, kein offener Abschnitt „Unveröffentlicht“), Versionshinweise lesbar, Beispiele nennen die Version.
 *       Mit --tag zusätzlich: Tag-Name passt zur Version. Mit --git zusätzlich: nichts Uncommittetes, nichts
 *       Ungepushtes, Tag existiert noch nicht.
 *
 * Ablauf eines Releases (npm run release:bump / release:check):
 *   Änderungen unter „Unveröffentlicht“ eintragen → bump → committen → pushen → check --git → Tag setzen und pushen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MANIFESTS = ['package.json', 'server/package.json', 'web/package.json'];
/** Dateien, in denen Beispiele die aktuelle Version nennen (Dateinamen von Paketen, Ausgaben, Tag-Namen). */
export const EXAMPLE_FILES = [
  'docs/INSTALLATION.md',
  'docs/INSTALLATION.en.md',
  'docs/GITHUB.md',
  'docs/ENTWICKLUNG.md',
  '.github/ISSUE_TEMPLATE/bug_report.yml',
  '.github/workflows/release.yml',
  'scripts/release-notes.mjs',
];
/** Zeilen mit dieser Angabe nennen eine Version als geschichtliche Tatsache und bleiben beim Hochzählen stehen. */
const HISTORY = /erstes Release/;
/** Namen der eigenen Einträge in der Lock-Datei (Abhängigkeiten mit gleicher Nummer sind nicht gemeint). */
const OWN_NAMES = ['"name": "knowstead"', '"name": "@knowstead/server"', '"name": "@knowstead/web"'];
const SEMVER = /^\d+\.\d+\.\d+$/;
const UNRELEASED = /^## \[(Unveröffentlicht|Unreleased)\]/i;

const read = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

const parse = (version) => version.split('.').map(Number);
export function compareVersions(a, b) {
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}

export function currentVersion(root = ROOT) {
  return JSON.parse(read(root, 'package.json')).version;
}

/** Zeilen der Lock-Datei, die die Version des Projekts selbst tragen: Wurzel (zweimal), server, web. */
function lockVersionLines(lines, version) {
  const hits = [];
  lines.forEach((line, i) => {
    if (line.trim() !== `"version": "${version}",`) return;
    const context = lines.slice(Math.max(0, i - 2), i).join(' ');
    if (OWN_NAMES.some((name) => context.includes(name))) hits.push(i);
  });
  return hits;
}

/** Aufbau des Änderungsprotokolls: Zeilennummern der Versionsüberschriften. */
function changelogSections(text) {
  const lines = text.split(/\r?\n/);
  const heads = [];
  lines.forEach((line, i) => {
    if (line.startsWith('## [')) heads.push(i);
  });
  return { lines, heads };
}

/**
 * Versionsnummer überall setzen. Alles wird zuerst im Speicher berechnet und erst am Ende geschrieben:
 * Scheitert etwas (fehlender Abschnitt, unerwartete Lock-Datei), bleibt die Arbeitskopie unverändert.
 * Rückgabe: Dateien mit Änderungen.
 */
export function bump(root, version, { date = new Date().toISOString().slice(0, 10), dryRun = false, force = false } = {}) {
  if (!SEMVER.test(version)) throw new Error(`„${version}“ ist keine Version (Form 2.3.0).`);
  const old = currentVersion(root);
  if (compareVersions(version, old) === 0) throw new Error(`Die Version ist schon ${old}.`);
  if (compareVersions(version, old) < 0 && !force) throw new Error(`${version} liegt vor der aktuellen Version ${old} (mit --force trotzdem).`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`„${date}“ ist kein Datum (Form 2026-11-01).`);

  const writes = new Map();

  for (const file of MANIFESTS) {
    const text = read(root, file);
    const needle = `"version": "${old}"`;
    if (text.split(needle).length !== 2) throw new Error(`${file}: Die Version ${old} steht nicht genau einmal darin.`);
    writes.set(file, text.replace(needle, `"version": "${version}"`));
  }

  const lock = read(root, 'package-lock.json');
  const lockLines = lock.split(eolOf(lock));
  const hits = lockVersionLines(lockLines, old);
  if (hits.length !== 4) throw new Error(`package-lock.json: ${hits.length} statt 4 eigene Einträge mit Version ${old} gefunden.`);
  for (const i of hits) lockLines[i] = lockLines[i].replace(old, version);
  writes.set('package-lock.json', lockLines.join(eolOf(lock)));

  for (const file of EXAMPLE_FILES) {
    const text = read(root, file);
    const eol = eolOf(text);
    const lines = text.split(eol).map((line) => (line.includes(old) && !HISTORY.test(line) ? line.split(old).join(version) : line));
    writes.set(file, lines.join(eol));
  }

  const changelog = read(root, 'CHANGELOG.md');
  const { lines, heads } = changelogSections(changelog);
  const open = heads.find((i) => UNRELEASED.test(lines[i]));
  if (open === undefined) throw new Error('Im Änderungsprotokoll gibt es keinen Abschnitt „Unveröffentlicht“ – zuerst die Änderungen dort eintragen.');
  lines[open] = `## [${version}] – ${date}`;
  writes.set('CHANGELOG.md', lines.join(eolOf(changelog)));

  const changed = [...writes].filter(([file, text]) => text !== read(root, file)).map(([file]) => file);
  if (!dryRun) for (const file of changed) fs.writeFileSync(path.join(root, file), writes.get(file));
  return changed;
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return { ok: result.status === 0, out: (result.stdout ?? '').trim(), err: (result.stderr ?? '').trim() };
}

/**
 * Passt alles zusammen? Rückgabe: { version, errors, warnings, passed }. Nichts wird verändert.
 * `git: true` prüft zusätzlich den Stand des Repositorys (Netz für `git fetch` nötig).
 */
export function check(root, { version, tag, git: withGit = false } = {}) {
  const errors = [];
  const warnings = [];
  const passed = [];
  const fail = (message) => errors.push(message);

  const own = currentVersion(root);
  const expected = version ?? own;
  if (!SEMVER.test(expected)) {
    fail(`„${expected}“ ist keine Version (Form 2.3.0).`);
    return { version: expected, errors, warnings, passed };
  }

  // Versionsfelder
  const versions = MANIFESTS.map((file) => [file, JSON.parse(read(root, file)).version]);
  const lockText = read(root, 'package-lock.json');
  const lock = JSON.parse(lockText);
  versions.push(
    ['package-lock.json (Kopf)', lock.version],
    ['package-lock.json (Wurzel)', lock.packages[''].version],
    ['package-lock.json (server)', lock.packages.server?.version],
    ['package-lock.json (web)', lock.packages.web?.version],
  );
  const wrong = versions.filter(([, v]) => v !== expected);
  if (wrong.length) for (const [file, v] of wrong) fail(`${file}: Version ${v ?? 'fehlt'} statt ${expected}`);
  else passed.push(`Version ${expected} in package.json, Lock-Datei, server und web`);

  // Tag
  if (tag) {
    if (tag !== `v${expected}`) fail(`Der Tag „${tag}“ passt nicht zur Version ${expected} (erwartet v${expected}).`);
    else passed.push(`Tag ${tag} passt zur Version`);
  }

  // Änderungsprotokoll
  const changelog = read(root, 'CHANGELOG.md');
  const { lines, heads } = changelogSections(changelog);
  const section = heads.find((i) => lines[i].startsWith(`## [${expected}]`));
  if (section === undefined) {
    fail(`CHANGELOG.md: Es gibt keinen Abschnitt „## [${expected}] – JJJJ-MM-TT“.`);
  } else {
    if (!/^## \[[^\]]+\] – \d{4}-\d{2}-\d{2}$/.test(lines[section])) fail(`CHANGELOG.md: Die Überschrift „${lines[section]}“ braucht ein Datum („## [${expected}] – JJJJ-MM-TT“).`);
    const next = heads.find((i) => i > section) ?? lines.length;
    if (!lines.slice(section + 1, next).join('').trim()) fail(`CHANGELOG.md: Der Abschnitt ${expected} ist leer.`);
    const newer = heads.filter((i) => i < section && !UNRELEASED.test(lines[i]));
    if (newer.length) warnings.push(`CHANGELOG.md: Über ${expected} steht ${lines[newer[0]].slice(3)} – ${expected} ist nicht die neueste Version.`);
    if (!errors.some((e) => e.startsWith('CHANGELOG.md'))) passed.push(`Änderungsprotokoll: Abschnitt ${expected} mit Datum und Inhalt`);
  }
  const open = heads.find((i) => UNRELEASED.test(lines[i]));
  if (open !== undefined) {
    const end = heads.find((i) => i > open) ?? lines.length;
    if (lines.slice(open + 1, end).join('').trim()) fail('CHANGELOG.md: Der Abschnitt „Unveröffentlicht“ hat noch Einträge – mit „bump“ zur Version machen (sonst fehlen sie in den Versionshinweisen).');
  }

  // Versionshinweise so, wie der Workflow sie liest
  const notes = spawnSync(process.execPath, [path.join(root, 'scripts', 'release-notes.mjs'), expected], { cwd: root, encoding: 'utf8' });
  if (notes.status !== 0) fail(`scripts/release-notes.mjs ${expected} schlägt fehl: ${(notes.stderr || '').trim()}`);
  else if (notes.stdout.trim().length < 40) fail(`scripts/release-notes.mjs ${expected} liefert (fast) nichts.`);
  else passed.push('Versionshinweise für das Release lesbar');

  // Beispiele
  const stale = EXAMPLE_FILES.filter((file) => !read(root, file).includes(expected));
  if (stale.length) fail(`Diese Dateien nennen die Version ${expected} nicht (Beispiele nicht nachgezogen?): ${stale.join(', ')}`);
  else passed.push('Beispiele in Dokumentation und Vorlagen nennen die Version');

  // Git
  if (withGit) {
    const status = git(root, ['status', '--porcelain']);
    if (!status.ok) {
      fail(`git status schlägt fehl: ${status.err}`);
    } else if (status.out) {
      const files = status.out.split('\n').map((l) => l.slice(3));
      fail(`Nicht committet: ${files.slice(0, 6).join(', ')}${files.length > 6 ? ` … (${files.length} Dateien)` : ''}`);
    } else {
      passed.push('Alles committet');
    }
    const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (branch.ok && branch.out !== 'main') warnings.push(`Der aktuelle Zweig ist „${branch.out}“, nicht „main“.`);
    const fetched = git(root, ['fetch', 'origin', '--quiet', '--tags']);
    if (!fetched.ok) {
      warnings.push(`git fetch origin schlägt fehl (${fetched.err.split('\n')[0]}) – Stand gegenüber origin nicht geprüft.`);
    } else {
      const counts = git(root, ['rev-list', '--left-right', '--count', 'origin/main...HEAD']);
      const [behind, ahead] = counts.out.split(/\s+/).map(Number);
      if (!counts.ok || Number.isNaN(ahead)) warnings.push('Stand gegenüber origin/main nicht lesbar.');
      else if (ahead > 0) fail(`${ahead} Commit(s) sind noch nicht auf origin/main gepusht.`);
      else if (behind > 0) fail(`origin/main hat ${behind} Commit(s), die hier fehlen.`);
      else passed.push('HEAD ist gepusht und gleich origin/main');
      const exists = git(root, ['tag', '-l', `v${expected}`]).out || git(root, ['ls-remote', '--tags', 'origin', `refs/tags/v${expected}`]).out;
      if (exists) fail(`Der Tag v${expected} gibt es schon.`);
      else passed.push(`Tag v${expected} ist noch frei`);
    }
  }

  return { version: expected, errors, warnings, passed };
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const option = (name) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined;
  };
  const flag = (name) => args.includes(`--${name}`);
  let positional;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--date' || args[i] === '--tag') i++;
    else if (!args[i].startsWith('--')) {
      positional = args[i];
      break;
    }
  }

  try {
    if (command === 'bump') {
      if (!positional) throw new Error('Aufruf: node scripts/release.mjs bump <version> [--date JJJJ-MM-TT] [--dry-run]');
      const changed = bump(ROOT, positional, { date: option('date'), dryRun: flag('dry-run'), force: flag('force') });
      console.log(`${flag('dry-run') ? 'Würde ändern' : 'Geändert'} (${changed.length} Dateien):`);
      for (const file of changed) console.log(`  ${file}`);
      if (!flag('dry-run')) console.log(`\nNächste Schritte: prüfen (git diff), committen, pushen, dann\n  node scripts/release.mjs check ${positional} --git\nund danach den Tag v${positional} setzen und pushen.`);
      return;
    }
    if (command === 'check') {
      const result = check(ROOT, { version: positional, tag: option('tag'), git: flag('git') });
      for (const line of result.passed) console.log(`  ✔ ${line}`);
      for (const line of result.warnings) console.log(`  ! ${line}`);
      for (const line of result.errors) console.log(`  ✖ ${line}`);
      console.log(result.errors.length ? `\nNicht bereit für ${result.version}: ${result.errors.length} Fehler.` : `\nBereit für ${result.version}.`);
      process.exitCode = result.errors.length ? 1 : 0;
      return;
    }
    console.log(`Release-Hilfe
  node scripts/release.mjs bump <version> [--date JJJJ-MM-TT] [--dry-run] [--force]
  node scripts/release.mjs check [<version>] [--tag v<version>] [--git]`);
    process.exitCode = command ? 1 : 0;
  } catch (err) {
    console.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
