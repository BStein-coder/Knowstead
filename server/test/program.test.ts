import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Config } from '../src/config.ts';
import type { Logger } from '../src/services.ts';
import { HttpError } from '../src/core/errors.ts';
import { identifyProgram, programChange, ProgramState, restartHint, runningIsCurrent, RUNNING_KEY } from '../src/core/program.ts';
import { runDoctor } from '../src/modules/system/doctor.ts';
import { createTestApp } from './helpers.ts';

/**
 * Update ohne Neustart: Der Programmordner wird ersetzt, der alte Prozess läuft weiter. Wird der alte Ordner
 * gelöscht, kann Node keinen Worker mehr starten („process.cwd failed … uv_cwd“) – Export, Sicherung und
 * Textgewinnung fielen aus. Der Server erkennt den Zustand, meldet ihn und hält die Worker am Laufen.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function collectingLogger(): { log: Logger; warnings: string[] } {
  const warnings: string[] = [];
  const log: Logger = { info() {}, warn: (message) => void warnings.push(String(message)), error() {}, debug() {}, child: () => log };
  return { log, warnings };
}

/** Programmordner nachstellen: package.json und – wie im Installationspaket – der Bauzeitpunkt. */
function writeProgram(dir: string, version: string, builtAt: string | null): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version }));
  if (builtAt) fs.writeFileSync(path.join(dir, '.knowstead-package.json'), JSON.stringify({ builtAt }));
}

test('Programmstand: unverändert, aktualisiert, ersetzt, entfernt', () => {
  const started = { folder: '1:100', version: '1.6.0', builtAt: '2026-10-04T08:40:06.000Z' };
  assert.equal(programChange(started, { ...started }), null);
  assert.equal(programChange(started, { ...started, builtAt: '2026-10-04T10:25:21.000Z' }), 'updated', 'neues Paket im selben Ordner');
  assert.equal(programChange(started, { ...started, version: '1.7.0' }), 'updated');
  assert.equal(programChange(started, { ...started, folder: '1:200' }), 'replaced', 'anderer Ordner am selben Pfad');
  assert.equal(programChange(started, null), 'missing');
  assert.equal(programChange(null, started), null, 'beim Start nicht feststellbar: keine Aussage');
  // Ordner wird gerade ersetzt, package.json fehlt noch: keine falsche Meldung allein deswegen
  assert.equal(programChange(started, { ...started, version: '' }), null);

  const running = { version: '1.6.0', builtAt: '2026-10-04T08:40:06.000Z', startedAt: '2026-10-04T09:00:00.000Z', pid: 1 };
  assert.equal(runningIsCurrent(running, { version: '1.6.0', packageBuiltAt: '2026-10-04T08:40:06.000Z' }), true);
  assert.equal(runningIsCurrent(running, { version: '1.6.0', packageBuiltAt: '2026-10-04T10:25:21.000Z' }), false, 'neueres Paket eingespielt');
  assert.equal(runningIsCurrent(running, { version: '1.7.0', packageBuiltAt: '2026-10-04T08:40:06.000Z' }), false);
  assert.equal(runningIsCurrent(null, { version: '1.6.0', packageBuiltAt: null }), false, 'Server aus einer Version, die noch nichts festhielt');
  assert.equal(runningIsCurrent({ ...running, builtAt: null }, { version: '1.6.0', packageBuiltAt: null }), true, 'aus dem Quelltext installiert');

  assert.equal(restartHint('systemd'), 'systemctl restart knowstead');
  assert.equal(restartHint('task'), 'Knowstead-Dienst.cmd restart');
  assert.equal(restartHint(null), 'Server beenden und neu starten');
});

test('Programmordner im laufenden Betrieb ersetzt: erkannt, gemeldet, Worker bleiben startfähig', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-programm-'));
  const home = process.cwd();
  const dir = path.join(base, 'knowstead');
  try {
    writeProgram(dir, '1.6.0', '2026-10-04T08:40:06.000Z');
    const { log, warnings } = collectingLogger();
    const state = new ProgramState({ rootDir: dir, service: 'systemd' } as Config, log);
    assert.equal(state.change(), null);
    assert.equal(identifyProgram(dir)?.version, '1.6.0');

    // Neues Paket über den vorhandenen Ordner entpackt
    writeProgram(dir, '1.6.0', '2026-10-04T10:25:21.000Z');
    assert.equal(state.change(), 'updated');

    // Alter Ordner verschoben – einen Augenblick lang liegt unter dem Pfad nichts
    fs.renameSync(dir, path.join(base, 'knowstead.alt'));
    assert.equal(state.change(), 'missing');
    assert.throws(
      () => state.prepareWorker(),
      (err: unknown) => err instanceof HttpError && err.status === 503 && err.code === 'restart_required',
      'ohne Programmordner hilft nur der Neustart – mit klarer Meldung statt „uv_cwd“',
    );
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /nicht mehr vorhanden .*\(systemctl restart knowstead\)/);

    // Neuer Ordner an derselben Stelle, der alte wird gelöscht
    writeProgram(dir, '1.7.0', '2026-10-04T12:00:00.000Z');
    assert.equal(state.change(), 'replaced');
    fs.rmSync(path.join(base, 'knowstead.alt'), { recursive: true, force: true });
    assert.equal(state.change(), 'replaced');
    state.prepareWorker();
    assert.equal(fs.realpathSync(process.cwd()), fs.realpathSync(dir), 'Arbeitsverzeichnis ist der Programmordner unter dem bekannten Pfad');
    assert.equal(warnings.length, 1, 'die Warnung steht nur einmal im Protokoll');

    // Zweiter Zustand in einem frischen Prozess: Die Warnung nennt das Update ohne Neustart
    const fresh = collectingLogger();
    const again = new ProgramState({ rootDir: dir, service: null } as Config, fresh.log);
    writeProgram(dir, '1.7.1', '2026-10-05T08:00:00.000Z');
    again.prepareWorker();
    assert.match(fresh.warnings[0], /seit dem Start ersetzt – der Server läuft noch mit dem alten Stand.*Server beenden und neu starten/);
  } finally {
    process.chdir(home);
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('Prüfung der Installation und „cli status“: Update ohne Neustart wird gemeldet', async () => {
  const ctx = await createTestApp();
  try {
    const program = async () => (await runDoctor(ctx.s.config)).find((c) => c.id === 'program');
    const status = () =>
      spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/cli.ts', 'status'], {
        cwd: root,
        env: { ...process.env, DATA_DIR: ctx.dir, KNOWSTEAD_SKIP_ENV_FILE: '1' },
        encoding: 'utf8',
      }).stdout;

    // Frisch gestartet: Der Server hat seinen Stand festgehalten, alles passt
    assert.equal(await program(), undefined);
    assert.match(status(), /Server läuft: +ja/);
    assert.ok(!/ACHTUNG/.test(status()));
    assert.equal(ctx.s.admin.system(ctx.s.perms.system()).restartRequired, null);

    // Der laufende Server stammt aus einem älteren Paket
    ctx.s.settings.setInternal(RUNNING_KEY, { version: '1.6.0', builtAt: '2026-09-23T08:55:28.000Z', startedAt: new Date().toISOString(), pid: process.pid });
    const stale = await program();
    assert.equal(stale?.status, 'warn');
    assert.match(stale!.message, /Der laufende Server arbeitet noch mit Knowstead 1\.6\.0 \(Paket vom 23\.9\.2026/);
    assert.match(stale!.hint!, /Den Dienst neu starten: /);
    assert.match(status(), /ACHTUNG: +Der laufende Server arbeitet noch mit Knowstead 1\.6\.0 \(Paket vom 23\.9\.2026[^\n]*\n +Bitte den Dienst neu starten: /);
    // Die Meldung „läuft“ bleibt, wie sie ist – der Installationskern erkennt daran einen laufenden Server
    assert.equal((await runDoctor(ctx.s.config)).find((c) => c.id === 'server')?.message, 'läuft');

    // Server aus einer Version, die noch nichts festhielt (erstes Update auf diesen Stand)
    ctx.s.db.run('DELETE FROM settings WHERE key = ?', `internal:${RUNNING_KEY}`);
    assert.match((await program())!.message, /vor dem Einspielen dieses Programmstands gestartet/);
    assert.match(status(), /ACHTUNG: +Der laufende Server wurde vor dem Einspielen dieses Programmstands gestartet/);
  } finally {
    await ctx.close();
  }
});

// Unter Windows lässt sich das Arbeitsverzeichnis eines laufenden Prozesses nicht löschen – der Fehler tritt dort nicht auf.
test('Gelöschtes Arbeitsverzeichnis: Worker starten nach prepareWorker wieder', { skip: process.platform === 'win32' ? 'unter Windows nicht nachstellbar' : false }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-cwd-'));
  try {
    const program = path.join(base, 'knowstead');
    writeProgram(program, '1.7.0', null);
    const worker = path.join(base, 'worker.mjs');
    fs.writeFileSync(worker, "import { parentPort } from 'node:worker_threads';\nparentPort.postMessage('pong');\n");
    const script = path.join(base, 'pruefung.ts');
    fs.writeFileSync(
      script,
      `import fs from 'node:fs';
import { Worker } from 'node:worker_threads';
import { ProgramState } from ${JSON.stringify(pathToFileURL(path.join(root, 'server', 'src', 'core', 'program.ts')).href)};

const [program, worker, gone] = process.argv.slice(2);
const start = () =>
  new Promise((resolve) => {
    try {
      const w = new Worker(new URL(worker));
      w.once('message', (message) => resolve('ok:' + message));
      w.once('error', (err) => resolve('error:' + err.message));
    } catch (err) {
      resolve('error:' + err.message);
    }
  });
const log = { info() {}, warn() {}, error() {}, debug() {}, child() { return log; } };
const state = new ProgramState({ rootDir: program, service: null }, log);

// Wie nach einem Update ohne Neustart: Der Ordner, in dem der Prozess gestartet wurde, ist gelöscht
fs.mkdirSync(gone);
process.chdir(gone);
fs.rmdirSync(gone);
const before = await start();
state.prepareWorker();
const after = await start();
console.log(JSON.stringify({ before, after }));
`,
    );
    const res = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', script, program, pathToFileURL(worker).href, path.join(base, 'geloescht')], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const result = JSON.parse(res.stdout.trim().split('\n').at(-1)!) as { before: string; after: string };
    assert.equal(result.after, 'ok:pong', 'nach dem Wechsel in den Programmordner startet der Worker');
    // So sah der Fehler aus, den Export, Sicherung und Textgewinnung vorher meldeten
    if (process.platform === 'linux') assert.match(result.before, /^error:.*uv_cwd/);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
