import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * update.sh – Update mit einem Befehl. Geprüft wird der echte Ablauf an einer nachgestellten Installation:
 * Programmordner mit eigener Kommandozeile, ein Dienst (»systemctl« merkt sich, welcher Stand läuft) und ein
 * Installationspaket. Ohne Root-Rechte, nichts am System wird verändert.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function findBash(): string | null {
  if (process.platform !== 'win32') return 'bash';
  for (const base of [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')]) {
    if (base && fs.existsSync(path.join(base, 'Git', 'bin', 'bash.exe'))) return path.join(base, 'Git', 'bin', 'bash.exe');
  }
  return null;
}
const bash = findBash();
/** Pfad, wie ihn die Shell sieht (Git Bash: /c/Users/…) */
const posix = (p: string) => (process.platform === 'win32' ? p.replace(/^([A-Za-z]):/, (_, drive: string) => `/${drive.toLowerCase()}`).replaceAll('\\', '/') : p);

/**
 * Kommandozeile der nachgestellten Installation. Sie spielt eine Version nach: `doctor` berichtet, was der
 * Dienst gerade tut; ab 1.8.0 gibt es die Prüfungen »http« und »program«, davor nicht.
 */
const CLI_STUB = `import fs from 'node:fs';
import path from 'node:path';
const here = path.resolve(import.meta.dirname, '..', '..');
const state = process.env.STATE_DIR;
const version = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).version;
const schemaOf = (v) => (v.startsWith('1.7') ? 23 : v.startsWith('1.') ? 24 : 25);
// Bis 1.9 hieß das Programm „Doku“ – so nennt es sich auch in seinen Meldungen
const product = version.startsWith('1.') ? 'Doku' : 'Knowstead';
const read = (name) => { try { return fs.readFileSync(path.join(state, name), 'utf8').trim(); } catch { return ''; } };
const [command, ...rest] = process.argv.slice(2);
fs.appendFileSync(path.join(state, 'calls.log'), 'cli ' + version + ' ' + [command, ...rest].join(' ') + '\\n');
if (command === 'stop') {
  fs.rmSync(path.join(state, 'running'), { force: true });
} else if (command === 'doctor') {
  const running = read('running');
  const checks = [{ id: 'node', status: 'ok', title: 'Node.js', message: 'ok' }];
  checks.push({ id: 'server', status: 'ok', title: 'Server', message: running ? 'läuft' : 'läuft nicht – Port 3000 ist frei' });
  if (running && !version.startsWith('1.7')) {
    checks.push({ id: 'http', status: read('broken') === running ? 'warn' : 'ok', title: 'Erreichbarkeit', message: 'x' });
    if (running !== version) checks.push({ id: 'program', status: 'warn', title: 'Programmstand', message: 'alter Stand' });
  }
  const schema = Number(read('schema') || 23);
  checks.push(schema > schemaOf(version) ? { id: 'database', status: 'error', title: 'Datenbank', message: 'stammt von einer neueren ' + product + '-Version' } : { id: 'database', status: 'ok', title: 'Datenbank', message: 'Schema ' + schema });
  const failed = checks.some((c) => c.status === 'error');
  console.log(rest.includes('--json') ? JSON.stringify({ ok: !failed, checks }) : checks.map((c) => c.title + ': ' + c.message).join('\\n'));
  if (failed) process.exitCode = 1;
} else if (command === 'restore') {
  fs.writeFileSync(path.join(state, 'schema'), String(schemaOf(version)));
  console.log('Datenbank aus ' + rest[0] + ' zurückgespielt');
} else if (command === 'handbook:sync') {
  console.log('Handbuch: 2 Kapitel ergänzt');
}
`;

interface Fixture {
  dir: string;
  target: string;
  data: string;
  state: string;
  archive: string;
  packageDir: string;
  calls(): string[];
  /** Konten, unter denen die Kommandozeile lief (runuser) */
  ranAs(): string[];
  /** Eigentümer des Datenverzeichnisses, wie ihn die Shell sieht */
  dataOwner(): string;
  run(script: string, args: string[], extra?: Record<string, string>): { status: number | null; out: string; err: string };
  version(dir?: string): string;
  siblings(): string[];
}

/**
 * `legacy`: eine Installation aus der Zeit, als Knowstead noch „Doku“ hieß – so, wie install.sh und die Pakete
 * 1.8/1.9 sie hinterlassen haben: Ordner /opt/doku, Dienst »doku«, .doku-package.json, DOKU_-Einträge in der
 * .env, doku.db und das damalige update.sh (test/fixtures/update-1.9.0.sh, unverändert aus dem Paket 1.9.0).
 */
function fixture(options: { dataInside?: boolean; newVersion?: string; newArch?: string; legacy?: boolean } = {}): Fixture {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-update-'));
  const legacy = options.legacy ?? false;
  const bin = path.join(dir, 'bin');
  const state = path.join(dir, 'state');
  const units = path.join(dir, 'units');
  const target = path.join(dir, 'opt', legacy ? 'doku' : 'knowstead');
  const data = options.dataInside ? path.join(target, 'data') : path.join(dir, 'var', 'daten');
  const unit = legacy ? path.join(units, 'doku.service') : path.join(dir, 'knowstead.service');
  for (const d of [bin, state, units, path.join(data, 'backups')]) fs.mkdirSync(d, { recursive: true });

  /** `before`: Stand eines Pakets bis 1.9 (nur .doku-package.json, damaliges update.sh) */
  const program = (where: string, version: string, builtAt: string, arch = 'x64', before = false) => {
    fs.mkdirSync(path.join(where, 'server', 'src'), { recursive: true });
    fs.mkdirSync(path.join(where, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(where, 'plugins', 'beispiel'), { recursive: true });
    fs.writeFileSync(path.join(where, 'package.json'), JSON.stringify({ name: before ? 'doku' : 'knowstead', type: 'module', version }));
    const info = JSON.stringify({ version, platform: 'linux', arch, builtAt });
    if (before) {
      fs.writeFileSync(path.join(where, '.doku-package.json'), info);
      // Auch das Linux-Paket brachte die Windows-Skripte mit – unter dem damaligen Namen
      for (const name of ['Doku-Dienst.cmd', 'Doku-Installation.cmd']) fs.writeFileSync(path.join(where, name), '@echo off\r\n');
    } else {
      fs.writeFileSync(path.join(where, '.knowstead-package.json'), info);
      // Pakete ab 2.0 tragen die Beschreibung zusätzlich unter dem früheren Namen – das update.sh einer
      // Installation bis 1.9 erkennt nur daran ein Installationspaket (scripts/package.mjs)
      if (!version.startsWith('1.')) fs.writeFileSync(path.join(where, '.doku-package.json'), info);
    }
    fs.writeFileSync(path.join(where, 'server', 'src', 'cli.ts'), CLI_STUB);
    fs.writeFileSync(path.join(where, 'server', 'src', 'index.ts'), '// Server\n');
    fs.writeFileSync(path.join(where, 'plugins', 'beispiel', 'plugin.json'), JSON.stringify({ name: 'beispiel', version }));
    fs.copyFileSync(before ? path.join(root, 'server', 'test', 'fixtures', 'update-1.9.0.sh') : path.join(root, 'update.sh'), path.join(where, 'update.sh'));
  };

  // Bisherige Installation: 1.7.0 (bzw. 1.9.0 aus der Zeit vor der Umbenennung) mit .env, eigenem Plugin und laufendem Dienst
  const oldVersion = legacy ? '1.9.0' : '1.7.0';
  program(target, oldVersion, '2026-10-04T11:01:30.000Z', 'x64', legacy);
  fs.writeFileSync(
    path.join(target, '.env'),
    `PORT=3000\nDATA_DIR=${options.dataInside ? 'data' : posix(data)}\n${legacy ? 'DOKU_SERVICE=systemd\nDOKU_SECRET' : 'KNOWSTEAD_SECRET'}=bleibt-wie-es-ist\n`,
  );
  fs.mkdirSync(path.join(target, 'plugins', 'eigenes'), { recursive: true });
  fs.writeFileSync(path.join(target, 'plugins', 'eigenes', 'plugin.json'), '{"name":"eigenes"}');
  fs.writeFileSync(path.join(data, legacy ? 'doku.db' : 'knowstead.db'), 'Datenbank');
  fs.writeFileSync(unit, `[Service]\nUser=${legacy ? 'doku' : 'knowstead'}\nWorkingDirectory=${posix(target)}\n`);
  fs.writeFileSync(path.join(state, 'running'), oldVersion);

  // Neues Paket
  const newVersion = options.newVersion ?? (legacy ? '2.0.0' : '1.8.0');
  const packageDir = path.join(dir, 'paket', `knowstead-${newVersion}-linux-x64`);
  program(packageDir, newVersion, '2026-10-05T09:00:00.000Z', options.newArch);
  fs.writeFileSync(path.join(packageDir, 'neu-in-dieser-version.txt'), 'neu');

  const stub = (name: string, body: string) => {
    fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}\n`);
    fs.chmodSync(path.join(bin, name), 0o755);
  };
  stub('id', 'if [ "${NOT_ROOT:-0}" = 1 ]; then echo 1000; else echo 0; fi');
  stub('sudo', `echo "sudo $*" >> "${posix(state)}/calls.log"\nexit 97`);
  // runuser -u <konto> -- <befehl>: merkt sich das Konto und führt den Befehl aus
  stub('runuser', `echo "$2" >> "${posix(state)}/runuser.log"\nshift 3\nexec "$@"`);
  // Der Dienst: »start« liest, welcher Stand im Programmordner liegt, und merkt ihn sich als laufend.
  // Gibt der Test einen Schemastand vor (Datei »schema«), stellt ein neuerer Stand die Datenbank um und legt
  // vorher seine Sicherung an – wie der echte Server. Ohne Vorgabe steht keine Umstellung an.
  stub(
    'systemctl',
    `state="${posix(state)}"
echo "systemctl $*" >> "$state/calls.log"
dir="$(sed -n 's/^WorkingDirectory=//p' "$STUB_UNIT")"
case "$1" in
  start)
    version="$(sed -n 's/.*"version":"\\([^"]*\\)".*/\\1/p' "$dir/package.json")"
    if [ "$(cat "$state/unstartbar" 2>/dev/null)" = "$version" ]; then exit 1; fi
    echo "$version" > "$state/running"
    case "$version" in 1.7*) schema=23 ;; 1.*) schema=24 ;; *) schema=25 ;; esac
    if [ -f "$state/schema" ] && [ "$(cat "$state/schema")" -lt "$schema" ]; then
      mkdir -p "${posix(data)}/backups/backup-20261005-090000-update"
      echo "$schema" > "$state/schema"
    fi ;;
  stop) rm -f "$state/running" ;;
esac
exit 0`,
  );

  const archive = path.join(dir, `knowstead-${newVersion}-linux-x64.tar.gz`);
  const packed = spawnSync(bash!, ['-c', `tar -czf "${posix(archive)}" -C "${posix(path.join(dir, 'paket'))}" "knowstead-${newVersion}-linux-x64"`], { encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  fs.writeFileSync(`${archive}.sha256`, `${crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex')}  ${path.basename(archive)}\n`);

  const calls = () => (fs.existsSync(path.join(state, 'calls.log')) ? fs.readFileSync(path.join(state, 'calls.log'), 'utf8').trim().split('\n').filter(Boolean) : []);
  return {
    dir,
    target,
    data,
    state,
    archive,
    packageDir,
    calls,
    ranAs: () => (fs.existsSync(path.join(state, 'runuser.log')) ? fs.readFileSync(path.join(state, 'runuser.log'), 'utf8').trim().split('\n').filter(Boolean) : []),
    dataOwner: () => spawnSync(bash!, ['-c', 'stat -c %U "$1"', 'owner', posix(data)], { encoding: 'utf8' }).stdout.trim(),
    version: (where = target) => JSON.parse(fs.readFileSync(path.join(where, 'package.json'), 'utf8')).version as string,
    siblings: () => fs.readdirSync(path.join(dir, 'opt')).sort(),
    run(script, args, extra = {}) {
      fs.rmSync(path.join(state, 'calls.log'), { force: true });
      fs.rmSync(path.join(state, 'runuser.log'), { force: true });
      // Die Bash von Git stellt ihre eigenen Ordner vor den Suchpfad – die nachgestellten Programme erst in der Shell nach vorn
      const res = spawnSync(bash!, ['-c', 'PATH="$STUBS:$PATH" exec bash "$@"', 'update', posix(script), ...args], {
        encoding: 'utf8',
        env: {
          ...process.env,
          STUBS: posix(bin),
          STATE_DIR: state.replaceAll('\\', '/'),
          STUB_UNIT: posix(unit),
          // Frühere Installation: Das neue Skript muss den Dienst »doku« selbst finden (nur der Ordner der
          // Dienst-Einträge ist umgelenkt); das Skript von 1.9 kennt seine eigenen Namen für die Prüfung
          ...(legacy
            ? { KNOWSTEAD_UNIT_DIR: posix(units), DOKU_UNIT_FILE: posix(unit), DOKU_UPDATE_TRIES: '3', DOKU_UPDATE_PAUSE: '0' }
            : { KNOWSTEAD_UNIT_FILE: posix(unit) }),
          KNOWSTEAD_UPDATE_TRIES: '3',
          KNOWSTEAD_UPDATE_PAUSE: '0',
          ...extra,
        },
      });
      return { status: res.status, out: res.stdout.replaceAll('\r', ''), err: res.stderr.replaceAll('\r', '') };
    },
  };
}

test('update.sh: Update mit einem Befehl', { skip: bash ? false : 'keine Bash gefunden (unter Windows: Git für Windows)' }, async (t) => {
  const made: Fixture[] = [];
  const make = (options?: Parameters<typeof fixture>[0]) => {
    const f = fixture(options);
    made.push(f);
    return f;
  };
  try {
    await t.test('aus der Installation mit Paket: prüfen, bereitlegen, anhalten, tauschen, starten, prüfen', () => {
      const f = make();
      fs.writeFileSync(path.join(f.target, 'eigene-notizen.txt'), 'von der Administration abgelegt');
      const res = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']);
      assert.equal(res.status, 0, res.out + res.err);
      assert.match(res.out, /Prüfsumme stimmt: [0-9a-f]{64}/);
      assert.match(res.out, /Bisher: +Knowstead 1\.7\.0 \(Paket vom 2026-10-04T11:01:30\.000Z\)/);
      assert.match(res.out, /Neu: +Knowstead 1\.8\.0 \(Paket vom 2026-10-05T09:00:00\.000Z\)/);
      assert.match(res.out, /Knowstead 1\.8\.0 \(Paket vom 2026-10-05T09:00:00\.000Z\) läuft und antwortet\./);
      assert.match(res.out, /Zurück zum Stand davor: +sudo bash .*\/opt\/knowstead\/update\.sh --rollback/);

      assert.equal(f.version(), '1.8.0');
      assert.ok(fs.existsSync(path.join(f.target, 'neu-in-dieser-version.txt')));
      assert.match(fs.readFileSync(path.join(f.target, '.env'), 'utf8'), /KNOWSTEAD_SECRET=bleibt-wie-es-ist/, '.env übernommen');
      assert.ok(fs.existsSync(path.join(f.target, 'plugins', 'eigenes', 'plugin.json')), 'eigenes Plugin übernommen');
      assert.equal(JSON.parse(fs.readFileSync(path.join(f.target, 'plugins', 'beispiel', 'plugin.json'), 'utf8')).version, '1.8.0', 'mitgeliefertes Plugin kommt aus dem neuen Paket');
      assert.deepEqual(f.siblings(), ['knowstead', 'knowstead.vor-1.8.0'], 'bisheriger Stand aufbewahrt, nichts Halbes liegen geblieben');
      assert.equal(f.version(path.join(f.dir, 'opt', 'knowstead.vor-1.8.0')), '1.7.0');
      assert.equal(fs.readFileSync(path.join(f.data, 'knowstead.db'), 'utf8'), 'Datenbank', 'Datenverzeichnis unberührt');
      // Eigene Dateien im Programmordner wandern nicht stillschweigend mit – sie werden genannt und bleiben im alten Ordner
      assert.match(res.out, /Nur im bisherigen Ordner, nicht übernommen: eigene-notizen\.txt\n/);
      assert.ok(fs.existsSync(path.join(f.dir, 'opt', 'knowstead.vor-1.8.0', 'eigene-notizen.txt')));

      // Reihenfolge: anhalten (Dienst, dann auch ein von Hand gestarteter Server), tauschen, starten, prüfen, Handbuch
      const calls = f.calls();
      assert.deepEqual(calls.slice(0, 3), ['systemctl stop knowstead', 'cli 1.7.0 stop --timeout 60', 'systemctl start knowstead']);
      assert.ok(calls.includes('cli 1.8.0 doctor --json'), calls.join(' | '));
      assert.equal(calls.at(-1), 'cli 1.8.0 handbook:sync');
      assert.ok(!calls.some((c) => c.startsWith('sudo')));
      // Die Kommandozeile läuft unter dem Konto, dem das Datenverzeichnis gehört – nicht als root: Was sie dort
      // anlegt (Sicherung, zurückgespielte Datenbank), könnte der Dienst sonst nicht mehr schreiben.
      const owner = f.dataOwner();
      if (owner && owner !== 'root' && owner !== 'UNKNOWN') {
        assert.equal(f.ranAs().length, calls.filter((c) => c.startsWith('cli ')).length, 'jeder Aufruf der Kommandozeile');
        assert.deepEqual([...new Set(f.ranAs())], [owner]);
      } else {
        assert.deepEqual(f.ranAs(), []);
      }
    });

    await t.test('falsche Prüfsumme: nichts wird angefasst', () => {
      const f = make();
      fs.writeFileSync(`${f.archive}.sha256`, `${'0'.repeat(64)}  paket\n`);
      const res = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']);
      assert.equal(res.status, 1);
      assert.match(res.err, /Die Prüfsumme stimmt nicht/);
      assert.equal(f.version(), '1.7.0');
      assert.deepEqual(f.siblings(), ['knowstead']);
      assert.deepEqual(f.calls(), [], 'der Dienst läuft ungestört weiter');
      // Ausdrücklich angegebene Prüfsumme geht vor
      const good = crypto.createHash('sha256').update(fs.readFileSync(f.archive)).digest('hex');
      assert.equal(f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes', '--sha256', good.toUpperCase()]).status, 0);
    });

    await t.test('aus dem entpackten Paket: Ziel kommt aus dem Dienst-Eintrag', () => {
      const f = make();
      const res = f.run(path.join(f.packageDir, 'update.sh'), ['--yes']);
      assert.equal(res.status, 0, res.out + res.err);
      assert.equal(f.version(), '1.8.0');
      assert.deepEqual(f.siblings(), ['knowstead', 'knowstead.vor-1.8.0']);
      assert.ok(fs.existsSync(f.packageDir), 'das entpackte Paket bleibt, wo es ist');

      // Derselbe Stand noch einmal: nichts zu tun, Dienst bleibt in Ruhe
      const again = f.run(path.join(f.packageDir, 'update.sh'), ['--yes']);
      assert.equal(again.status, 0, again.out + again.err);
      assert.match(again.out, /Dieser Stand ist bereits installiert/);
      assert.deepEqual(f.calls(), []);
    });

    await t.test('der neue Stand antwortet nicht: der bisherige kommt zurück', () => {
      const f = make();
      fs.writeFileSync(path.join(f.state, 'broken'), '1.8.0');
      const res = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']);
      assert.equal(res.status, 1, res.out + res.err);
      assert.match(res.out, /Der neue Stand läuft nicht – der bisherige kommt zurück/);
      assert.match(res.out, /Der bisherige Stand läuft wieder: Knowstead 1\.7\.0/);
      assert.equal(f.version(), '1.7.0');
      assert.equal(fs.readFileSync(path.join(f.state, 'running'), 'utf8').trim(), '1.7.0', 'der Dienst läuft wieder mit dem alten Stand');
      const kept = f.siblings();
      assert.equal(kept.length, 2);
      assert.match(kept[1], /^knowstead\.fehlgeschlagen-\d{8}-\d{6}$/, 'der gescheiterte Stand bleibt zur Fehlersuche');
      assert.ok(!f.calls().some((c) => / restore /.test(c)), 'die Datenbank war nicht umgestellt – nichts zurückzuspielen');
    });

    await t.test('der neue Stand hat die Datenbank schon umgestellt: Sicherung von diesem Update wird zurückgespielt', () => {
      const f = make();
      fs.writeFileSync(path.join(f.state, 'schema'), '23');
      fs.writeFileSync(path.join(f.state, 'broken'), '1.8.0');
      // Eine ältere Sicherung eines früheren Updates darf nicht genommen werden
      const stale = path.join(f.data, 'backups', 'backup-20260915-101500-update');
      fs.mkdirSync(stale);
      fs.utimesSync(stale, new Date('2026-09-15T10:15:00Z'), new Date('2026-09-15T10:15:00Z'));
      const res = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']);
      assert.equal(res.status, 1, res.out + res.err);
      assert.match(res.out, /Datenbank aus backup-20261005-090000-update zurückspielen/);
      assert.ok(f.calls().includes('cli 1.7.0 restore backup-20261005-090000-update'), f.calls().join(' | '));
      assert.equal(fs.readFileSync(path.join(f.state, 'schema'), 'utf8').trim(), '23');
      assert.equal(f.version(), '1.7.0');
      assert.match(res.out, /Der bisherige Stand läuft wieder/);
    });

    await t.test('--rollback: zurück zum aufbewahrten Stand', () => {
      const f = make();
      assert.equal(f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']).status, 0);
      assert.equal(f.version(), '1.8.0');
      const res = f.run(path.join(f.target, 'update.sh'), ['--rollback', '--yes']);
      assert.equal(res.status, 0, res.out + res.err);
      assert.match(res.out, /Zurück von +Knowstead 1\.8\.0/);
      assert.match(res.out, /Fertig: Knowstead 1\.7\.0 .* läuft wieder\./);
      assert.equal(f.version(), '1.7.0');
      assert.equal(fs.readFileSync(path.join(f.state, 'running'), 'utf8').trim(), '1.7.0');
      // Die Datenbank war nicht umgestellt: Es wird nur der Programmordner getauscht
      assert.doesNotMatch(res.out, /Datenbank/);
      assert.ok(!f.calls().some((c) => / restore /.test(c)), f.calls().join(' | '));
      assert.ok(f.siblings().some((n) => /^knowstead\.zurueckgenommen-/.test(n)));
      // Nichts mehr zum Zurückkehren
      const none = f.run(path.join(f.target, 'update.sh'), ['--rollback', '--yes']);
      assert.equal(none.status, 1);
      assert.match(none.err, /kein früherer Programmordner/);
      assert.deepEqual(f.calls(), [], 'der Dienst läuft ungestört weiter');
    });

    await t.test('--rollback nach umgestellter Datenbank: Warnung vorab, Sicherung vom Update kommt zurück – oder es bleibt, wie es ist', () => {
      const f = make();
      fs.writeFileSync(path.join(f.state, 'schema'), '23');
      assert.equal(f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']).status, 0);
      assert.equal(fs.readFileSync(path.join(f.state, 'schema'), 'utf8').trim(), '24', 'der neue Stand hat umgestellt');

      // Probelauf: sagt, was geschähe, und fasst nichts an
      const dry = f.run(path.join(f.target, 'update.sh'), ['--rollback', '--dry-run']);
      assert.equal(dry.status, 0, dry.out + dry.err);
      assert.match(dry.out, /Das Update hat die Datenbank umgestellt/);
      assert.match(dry.out, /\(Probelauf\) node server\/src\/cli\.ts restore backup-20261005-090000-update/);
      assert.equal(f.version(), '1.8.0');
      assert.ok(!f.calls().some((c) => /^systemctl|restore/.test(c)), f.calls().join(' | '));

      const res = f.run(path.join(f.target, 'update.sh'), ['--rollback', '--yes']);
      assert.equal(res.status, 0, res.out + res.err);
      assert.match(res.out, /Das Update hat die Datenbank umgestellt – der frühere Stand braucht die Datenbank von davor/);
      assert.match(res.out, /aus der Sicherung backup-20261005-090000-update zurückgespielt/);
      assert.equal(f.version(), '1.7.0');
      assert.equal(fs.readFileSync(path.join(f.state, 'schema'), 'utf8').trim(), '23');
      // Erst prüfen (mit der Kommandozeile des früheren Stands), dann anhalten, zurückspielen, tauschen, starten
      const calls = f.calls();
      assert.deepEqual(calls.slice(0, 5), ['cli 1.7.0 doctor --json', 'systemctl stop knowstead', 'cli 1.8.0 stop --timeout 60', 'cli 1.7.0 restore backup-20261005-090000-update', 'systemctl start knowstead']);

      // Sicherung vom Update nicht mehr da: ablehnen, bevor irgendetwas angefasst wird
      const g = make();
      fs.writeFileSync(path.join(g.state, 'schema'), '23');
      assert.equal(g.run(path.join(g.target, 'update.sh'), [posix(g.archive), '--yes']).status, 0);
      fs.rmSync(path.join(g.data, 'backups', 'backup-20261005-090000-update'), { recursive: true });
      const refused = g.run(path.join(g.target, 'update.sh'), ['--rollback', '--yes']);
      assert.equal(refused.status, 1);
      assert.match(refused.err, /die Sicherung von diesem Update liegt nicht mehr/);
      assert.equal(g.version(), '1.8.0');
      assert.deepEqual(g.calls(), ['cli 1.7.0 doctor --json'], 'nur nachgesehen – der Dienst läuft weiter');
      assert.equal(fs.readFileSync(path.join(g.state, 'running'), 'utf8').trim(), '1.8.0');
    });

    await t.test('Datenverzeichnis im Programmordner zieht mit um – und beim Zurückrollen zurück', () => {
      const f = make({ dataInside: true });
      const res = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']);
      assert.equal(res.status, 0, res.out + res.err);
      assert.match(res.out, /liegt im Programmordner und zieht mit um/);
      assert.equal(fs.readFileSync(path.join(f.target, 'data', 'knowstead.db'), 'utf8'), 'Datenbank');
      assert.equal(fs.existsSync(path.join(f.dir, 'opt', 'knowstead.vor-1.8.0', 'data')), false);

      // … und von dort mit --rollback wieder zum früheren Stand
      const back = f.run(path.join(f.target, 'update.sh'), ['--rollback', '--yes']);
      assert.equal(back.status, 0, back.out + back.err);
      assert.equal(f.version(), '1.7.0');
      assert.equal(fs.readFileSync(path.join(f.target, 'data', 'knowstead.db'), 'utf8'), 'Datenbank');

      // Wartezeit über --wait (hier: gar nicht warten) statt über die feste Zahl an Versuchen
      const g = make({ dataInside: true });
      fs.writeFileSync(path.join(g.state, 'broken'), '1.8.0');
      assert.equal(g.run(path.join(g.target, 'update.sh'), [posix(g.archive), '--yes', '--wait', '0'], { KNOWSTEAD_UPDATE_TRIES: '' }).status, 1);
      assert.equal(g.version(), '1.7.0');
      assert.equal(fs.readFileSync(path.join(g.target, 'data', 'knowstead.db'), 'utf8'), 'Datenbank', 'die Daten sind wieder beim alten Stand');
    });

    await t.test('Probelauf verändert nichts; ohne Root-Rechte und ohne --yes im Skript wird abgelehnt', () => {
      const f = make();
      const dry = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--dry-run'], { NOT_ROOT: '1' });
      assert.equal(dry.status, 0, dry.out + dry.err);
      assert.match(dry.out, /\(Probelauf\) tar -xzf/);
      const dryPackage = f.run(path.join(f.packageDir, 'update.sh'), ['--dry-run'], { NOT_ROOT: '1' });
      assert.equal(dryPackage.status, 0, dryPackage.out + dryPackage.err);
      assert.match(dryPackage.out, /\(Probelauf\) systemctl stop knowstead/);
      assert.match(dryPackage.out, /\(Probelauf\) mv .*\/opt\/knowstead .*\/opt\/knowstead\.vor-1\.8\.0/);
      assert.match(dryPackage.out, /Probelauf beendet – nichts wurde verändert/);
      assert.equal(f.version(), '1.7.0');
      assert.deepEqual(f.siblings(), ['knowstead']);
      assert.deepEqual(f.calls(), []);

      const notRoot = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes'], { NOT_ROOT: '1' });
      assert.equal(notRoot.status, 1);
      assert.match(notRoot.err, /Bitte als root ausführen/);
      // Ohne Terminal und ohne --yes: keine stille Zustimmung
      const unattended = f.run(path.join(f.target, 'update.sh'), [posix(f.archive)]);
      assert.equal(unattended.status, 1);
      assert.match(unattended.err, /Ohne Terminal bitte --yes angeben/);
      assert.equal(f.version(), '1.7.0');
      assert.deepEqual(f.siblings(), ['knowstead'], 'ausgepacktes Paket wieder weggeräumt');
    });

    await t.test('falsches Paket: andere Architektur, kein Paket, keine Installation', () => {
      const f = make({ newArch: 'arm64' });
      const res = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']);
      assert.equal(res.status, 1);
      assert.match(res.err, /Das Paket ist für linux-arm64 gebaut, dieser Rechner ist linux-x64/);
      assert.deepEqual(f.siblings(), ['knowstead']);
      assert.deepEqual(f.calls(), []);

      const noPackage = path.join(f.dir, 'irgendwas.tar.gz');
      fs.writeFileSync(noPackage, 'kein Archiv');
      const broken = f.run(path.join(f.target, 'update.sh'), [posix(noPackage), '--yes']);
      assert.equal(broken.status, 1);
      assert.match(broken.err, /ließ sich nicht auspacken/);
      assert.deepEqual(f.siblings(), ['knowstead']);

      const elsewhere = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes', '--target', posix(path.join(f.dir, 'leer'))]);
      assert.equal(elsewhere.status, 1);
      assert.match(elsewhere.err, /ist keine Knowstead-Installation/);
    });

    await t.test('ältere Programmordner werden aufgeräumt (--keep)', () => {
      const f = make();
      for (const old of ['1.5.0', '1.6.0']) {
        const dir = path.join(f.dir, 'opt', `knowstead.vor-${old}`);
        fs.mkdirSync(dir);
        const when = new Date(old === '1.5.0' ? '2026-09-14T08:00:00Z' : '2026-09-15T08:00:00Z');
        fs.utimesSync(dir, when, when);
      }
      const res = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes', '--keep', '2']);
      assert.equal(res.status, 0, res.out + res.err);
      assert.deepEqual(f.siblings(), ['knowstead', 'knowstead.vor-1.6.0', 'knowstead.vor-1.8.0'], 'die zwei jüngsten bleiben');
      assert.match(res.out, /Älteren Programmordner entfernen: .*knowstead\.vor-1\.5\.0/);
    });

    // ----- Installation aus der Zeit, als Knowstead noch „Doku“ hieß (bis 1.9): Ordner, Dienst, Konto, Datenbank
    // und .env behalten ihre Namen – getauscht wird nur das Programm.
    await t.test('frühere Installation: das installierte update.sh von 1.9 spielt das Paket 2.0 ein – Dienst »doku« bleibt', () => {
      const f = make({ legacy: true });
      const env = fs.readFileSync(path.join(f.target, '.env'), 'utf8');
      fs.writeFileSync(path.join(f.target, 'eigene-notizen.txt'), 'von der Administration abgelegt');
      const res = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']);
      assert.equal(res.status, 0, res.out + res.err);
      // Eigene Dateien werden genannt – nicht aber Dateien des früheren Pakets, die heute anders heißen (Doku-Dienst.cmd …)
      assert.match(res.out, /Nur im bisherigen Ordner, nicht übernommen: eigene-notizen\.txt\n/);
      // Das Skript von 1.9 prüft und packt aus, dann übernimmt das Skript aus dem neuen Paket
      assert.match(res.out, /Prüfsumme stimmt: [0-9a-f]{64}/);
      assert.match(res.out, /Bisher: +Knowstead 1\.9\.0 \(Paket vom 2026-10-04T11:01:30\.000Z\)/, 'Beschreibung der bisherigen Installation aus .doku-package.json');
      assert.match(res.out, /Neu: +Knowstead 2\.0\.0 \(Paket vom 2026-10-05T09:00:00\.000Z\)/);
      assert.match(res.out, /Knowstead 2\.0\.0 \(Paket vom 2026-10-05T09:00:00\.000Z\) läuft und antwortet\./);
      assert.match(res.out, /Zurück zum Stand davor: +sudo bash .*\/opt\/doku\/update\.sh --rollback/);

      assert.equal(f.version(), '2.0.0');
      assert.deepEqual(f.siblings(), ['doku', 'doku.vor-2.0.0'], 'der Ordner heißt weiter doku, nichts Halbes liegen geblieben');
      assert.equal(f.version(path.join(f.dir, 'opt', 'doku.vor-2.0.0')), '1.9.0');
      assert.equal(fs.readFileSync(path.join(f.target, '.env'), 'utf8'), env, '.env unverändert – die Einträge mit DOKU_ versteht der Server weiter');
      assert.ok(fs.existsSync(path.join(f.target, 'plugins', 'eigenes', 'plugin.json')), 'eigenes Plugin übernommen');
      assert.deepEqual(fs.readdirSync(f.data).sort(), ['backups', 'doku.db'], 'Datenverzeichnis unberührt, keine zweite Datenbank');

      const calls = f.calls();
      assert.deepEqual(calls.slice(0, 3), ['systemctl stop doku', 'cli 1.9.0 stop --timeout 60', 'systemctl start doku']);
      assert.ok(calls.includes('cli 2.0.0 doctor --json'), calls.join(' | '));
      assert.equal(calls.at(-1), 'cli 2.0.0 handbook:sync');
      assert.ok(!calls.some((c) => /knowstead/.test(c)), `kein Aufruf für einen Dienst »knowstead«: ${calls.join(' | ')}`);

      // Derselbe Stand noch einmal – jetzt mit dem neuen Skript in der Installation: nichts zu tun
      const again = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']);
      assert.equal(again.status, 0, again.out + again.err);
      assert.match(again.out, /Dieser Stand ist bereits installiert/);
      assert.deepEqual(f.calls(), []);
    });

    await t.test('frühere Installation: aus dem entpackten Paket – Dienst »doku« und sein Ordner werden gefunden', () => {
      const f = make({ legacy: true });
      const res = f.run(path.join(f.packageDir, 'update.sh'), ['--yes']);
      assert.equal(res.status, 0, res.out + res.err);
      assert.equal(f.version(), '2.0.0');
      assert.deepEqual(f.siblings(), ['doku', 'doku.vor-2.0.0']);
      assert.deepEqual(f.calls().slice(0, 3), ['systemctl stop doku', 'cli 1.9.0 stop --timeout 60', 'systemctl start doku']);

      // Probelauf an einer zweiten Installation: nennt den Dienst beim richtigen Namen
      const g = make({ legacy: true });
      const dry = g.run(path.join(g.packageDir, 'update.sh'), ['--dry-run'], { NOT_ROOT: '1' });
      assert.equal(dry.status, 0, dry.out + dry.err);
      assert.match(dry.out, /\(Probelauf\) systemctl stop doku/);
      assert.match(dry.out, /\(Probelauf\) mv .*\/opt\/doku .*\/opt\/doku\.vor-2\.0\.0/);
      assert.equal(g.version(), '1.9.0');
    });

    await t.test('frühere Installation: der neue Stand antwortet nicht – 1.9 läuft wieder, samt Datenbank von davor', () => {
      const f = make({ legacy: true });
      // Der neue Stand stellt die Datenbank um (Schema 24 → 25), antwortet danach aber nicht
      fs.writeFileSync(path.join(f.state, 'schema'), '24');
      fs.writeFileSync(path.join(f.state, 'broken'), '2.0.0');
      const res = f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']);
      assert.equal(res.status, 1, res.out + res.err);
      assert.match(res.out, /Der neue Stand läuft nicht – der bisherige kommt zurück/);
      // Die Kommandozeile von 1.9 meldet „… neueren Doku-Version“ – daran erkennt das Skript die umgestellte Datenbank
      assert.match(res.out, /Datenbank aus backup-20261005-090000-update zurückspielen/);
      assert.match(res.out, /Der bisherige Stand läuft wieder: Knowstead 1\.9\.0/);
      assert.equal(f.version(), '1.9.0');
      assert.equal(fs.readFileSync(path.join(f.state, 'schema'), 'utf8').trim(), '24');
      assert.equal(fs.readFileSync(path.join(f.state, 'running'), 'utf8').trim(), '1.9.0');
      const calls = f.calls();
      assert.ok(calls.includes('cli 1.9.0 restore backup-20261005-090000-update'), calls.join(' | '));
      assert.equal(calls.filter((c) => c === 'systemctl start doku').length, 2, 'erst der neue, dann wieder der bisherige Stand');
      assert.ok(!calls.some((c) => /knowstead/.test(c)), calls.join(' | '));
      const left = f.siblings();
      assert.equal(left[0], 'doku');
      assert.ok(left.length === 2 && /^doku\.fehlgeschlagen-\d{8}-\d{6}$/.test(left[1]), left.join(', '));
    });

    await t.test('frühere Installation: --rollback mit dem neuen Skript zurück auf 1.9', () => {
      const f = make({ legacy: true });
      fs.writeFileSync(path.join(f.state, 'schema'), '24');
      assert.equal(f.run(path.join(f.target, 'update.sh'), [posix(f.archive), '--yes']).status, 0);
      assert.equal(fs.readFileSync(path.join(f.state, 'schema'), 'utf8').trim(), '25', 'der neue Stand hat umgestellt');

      const res = f.run(path.join(f.target, 'update.sh'), ['--rollback', '--yes']);
      assert.equal(res.status, 0, res.out + res.err);
      assert.match(res.out, /Das Update hat die Datenbank umgestellt – der frühere Stand braucht die Datenbank von davor/);
      assert.match(res.out, /Fertig: Knowstead 1\.9\.0 .* läuft wieder\./);
      assert.equal(f.version(), '1.9.0');
      assert.equal(fs.readFileSync(path.join(f.state, 'schema'), 'utf8').trim(), '24');
      assert.deepEqual(f.calls().slice(0, 5), ['cli 1.9.0 doctor --json', 'systemctl stop doku', 'cli 2.0.0 stop --timeout 60', 'cli 1.9.0 restore backup-20261005-090000-update', 'systemctl start doku']);
    });
  } finally {
    for (const f of made) fs.rmSync(f.dir, { recursive: true, force: true });
  }
});
