import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bump, check, compareVersions, currentVersion, EXAMPLE_FILES } from '../../scripts/release.mjs';

/** scripts/release.mjs: Versionsnummern setzen und vor dem Tag prüfen – an einer Kopie der echten Dateien. */
const REPO = path.resolve(import.meta.dirname, '..', '..');
const FILES = ['package.json', 'server/package.json', 'web/package.json', 'package-lock.json', 'scripts/release-notes.mjs', ...EXAMPLE_FILES];

function workCopy(changelog: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-release-'));
  for (const file of new Set(FILES)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.copyFileSync(path.join(REPO, file), path.join(dir, file));
  }
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), changelog);
  return dir;
}

const file = (dir: string, name: string) => fs.readFileSync(path.join(dir, name), 'utf8');
const snapshot = (dir: string) => Object.fromEntries([...new Set([...FILES, 'CHANGELOG.md'])].map((name) => [name, file(dir, name)]));

const nextOf = (version: string) => {
  const [major, minor, patch] = version.split('.').map(Number);
  return `${major}.${minor}.${patch + 1}`;
};

test('Versionen vergleichen', () => {
  assert.equal(compareVersions('2.2.1', '2.2.1'), 0);
  assert.equal(compareVersions('2.2.1', '2.2.2'), -1);
  assert.equal(compareVersions('2.10.0', '2.9.9'), 1, 'Zahlen, keine Zeichenfolgen');
  assert.equal(compareVersions('3.0.0', '2.99.99'), 1);
});

test('release.mjs: hochzählen und prüfen', () => {
  const version = currentVersion(REPO);
  const next = nextOf(version);
  const changelog = `# Änderungsprotokoll\n\n## [Unveröffentlicht]\n\n### Behoben\n\n- Etwas.\n\n## [${version}] – 2026-01-01\n\nText der alten Version.\n`;
  const dir = workCopy(changelog);
  try {
    // Mit offenem Abschnitt „Unveröffentlicht“ ist der Stand nicht fertig – die Einträge fehlten sonst in den Hinweisen
    const before = check(dir, {});
    assert.ok(before.errors.some((e) => /Unveröffentlicht/.test(e)), before.errors.join('\n'));

    const original = snapshot(dir);
    assert.deepEqual(bump(dir, next, { dryRun: true }).includes('CHANGELOG.md'), true);
    assert.deepEqual(snapshot(dir), original, 'ein Probelauf ändert nichts');

    const changed = bump(dir, next, { date: '2026-11-01' });
    for (const name of ['package.json', 'server/package.json', 'web/package.json', 'package-lock.json', 'CHANGELOG.md']) assert.ok(changed.includes(name), `${name} geändert`);
    assert.match(file(dir, 'CHANGELOG.md'), new RegExp(`## \\[${next.replaceAll('.', '\\.')}\\] – 2026-11-01`));
    assert.ok(!/Unveröffentlicht/.test(file(dir, 'CHANGELOG.md')));
    for (const name of ['package.json', 'server/package.json', 'web/package.json']) assert.equal(JSON.parse(file(dir, name)).version, next);

    // Lock-Datei: nur die vier eigenen Einträge, Abhängigkeiten mit gleicher Nummer bleiben
    const lockBefore = JSON.parse(original['package-lock.json']) as { version: string; packages: Record<string, { version?: string }> };
    const lockAfter = JSON.parse(file(dir, 'package-lock.json')) as typeof lockBefore;
    assert.equal(lockAfter.version, next);
    const differing = Object.keys(lockBefore.packages).filter((key) => lockBefore.packages[key].version !== lockAfter.packages[key].version);
    assert.deepEqual(differing.sort(), ['', 'server', 'web']);
    assert.equal(Object.keys(lockAfter.packages).length, Object.keys(lockBefore.packages).length);

    const after = check(dir, { version: next, tag: `v${next}` });
    assert.deepEqual(after.errors, [], after.errors.join('\n'));
    assert.ok(after.passed.length >= 5);

    // Zweimal dasselbe Hochzählen, ein Schritt zurück, Unsinn: abgelehnt, nichts geschrieben
    const done = snapshot(dir);
    assert.throws(() => bump(dir, next), /schon/);
    assert.throws(() => bump(dir, version), /liegt vor/);
    assert.throws(() => bump(dir, '2.x'), /keine Version/);
    assert.throws(() => bump(dir, nextOf(next), { date: 'morgen' }), /kein Datum/);
    assert.deepEqual(snapshot(dir), done);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release.mjs: check findet vergessene Schritte', () => {
  const version = currentVersion(REPO);
  const base = `# Änderungsprotokoll\n\n## [${version}] – 2026-10-26\n\nText der Version.\n`;
  const dir = workCopy(base);
  try {
    assert.deepEqual(check(dir, {}).errors, [], 'Ausgangslage stimmt');

    // Tag passt nicht zur Version
    assert.ok(check(dir, { tag: 'v0.0.1' }).errors.some((e) => /passt nicht/.test(e)));
    assert.ok(check(dir, { version: '9.9.9' }).errors.some((e) => /9\.9\.9/.test(e)));

    // Eine der Dateien mit anderer Version
    const web = file(dir, 'web/package.json');
    fs.writeFileSync(path.join(dir, 'web/package.json'), web.replace(`"version": "${version}"`, '"version": "0.0.1"'));
    assert.ok(check(dir, {}).errors.some((e) => /web\/package\.json/.test(e)), 'Version in web/package.json');
    fs.writeFileSync(path.join(dir, 'web/package.json'), web);

    // Änderungsprotokoll: Abschnitt fehlt / ohne Datum / leer – der Fehler vom 2.2.1-Release (Überschrift noch „Unveröffentlicht“)
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Änderungsprotokoll\n\n## [Unveröffentlicht]\n\n- Etwas.\n`);
    assert.ok(check(dir, {}).errors.some((e) => /keinen Abschnitt/.test(e)));
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Änderungsprotokoll\n\n## [${version}]\n\nText.\n`);
    assert.ok(check(dir, {}).errors.some((e) => /Datum/.test(e)));
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `# Änderungsprotokoll\n\n## [${version}] – 2026-10-26\n\n## [0.0.1] – 2020-01-01\n\nAlt.\n`);
    assert.ok(check(dir, {}).errors.some((e) => /leer/.test(e)));
    fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), base);

    // Beispiele nicht nachgezogen
    const guide = file(dir, 'docs/GITHUB.md');
    fs.writeFileSync(path.join(dir, 'docs/GITHUB.md'), guide.split(version).join('0.0.1'));
    assert.ok(check(dir, {}).errors.some((e) => /docs\/GITHUB\.md/.test(e)));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release.mjs: bump ohne Abschnitt „Unveröffentlicht“ schreibt nichts', () => {
  const version = currentVersion(REPO);
  const dir = workCopy(`# Änderungsprotokoll\n\n## [${version}] – 2026-10-26\n\nText.\n`);
  try {
    const before = snapshot(dir);
    assert.throws(() => bump(dir, nextOf(version)), /Unveröffentlicht/);
    assert.deepEqual(snapshot(dir), before, 'weder package.json noch Lock-Datei wurden angefasst');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('release.mjs: Kommandozeile und Git-Prüfung', () => {
  const version = currentVersion(REPO);
  const dir = workCopy(`# Änderungsprotokoll\n\n## [${version}] – 2026-10-26\n\nText der Version.\n`);
  try {
    // Eine Kopie des Skripts im Wegwerf-Ordner: Es prüft immer den Ordner, in dem es liegt
    fs.copyFileSync(path.join(REPO, 'scripts', 'release.mjs'), path.join(dir, 'scripts', 'release.mjs'));
    const run = (...args: string[]) => spawnSync(process.execPath, [path.join(dir, 'scripts', 'release.mjs'), ...args], { cwd: dir, encoding: 'utf8' });

    const help = run();
    assert.equal(help.status, 0);
    assert.match(help.stdout, /bump/);
    assert.equal(run('unsinn').status, 1);

    const ready = run('check', '--tag', `v${version}`);
    assert.equal(ready.status, 0, ready.stdout + ready.stderr);
    assert.ok(ready.stdout.includes(`Bereit für ${version}`));
    const wrongTag = run('check', '--tag', 'v0.0.1');
    assert.equal(wrongTag.status, 1);
    assert.match(wrongTag.stdout, /passt nicht/);
    assert.equal(run('bump').status, 1, 'ohne Version');
    assert.equal(run('bump', nextOf(version), '--dry-run').status, 1, 'ohne Abschnitt „Unveröffentlicht“');

    // Git-Prüfung an einem frischen Repository: nichts committet → Fehler; committet, aber ohne origin → Hinweis statt Absturz
    const git = (...args: string[]) => spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], { cwd: dir, encoding: 'utf8' });
    if (git('init', '-q').status === 0) {
      const untracked = check(dir, { git: true });
      assert.ok(untracked.errors.some((e) => /Nicht committet/.test(e)), untracked.errors.join(' | '));
      git('add', '-A');
      assert.equal(git('commit', '-q', '-m', 'Stand').status, 0);
      const committed = check(dir, { git: true });
      assert.ok(!committed.errors.some((e) => /Nicht committet/.test(e)), committed.errors.join(' | '));
      assert.ok(committed.passed.includes('Alles committet'));
      assert.ok(committed.warnings.some((w) => /origin/.test(w)), 'ohne origin: Hinweis');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

