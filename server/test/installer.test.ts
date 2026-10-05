import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Die Skripte sprechen die Sprache des Systems. Die Prüfungen hier legen sie fest (Deutsch), damit das Ergebnis
// nicht vom Rechner abhängt, auf dem sie laufen – die englische Fassung wird ausdrücklich geprüft.
process.env.KNOWSTEAD_LANG = 'de';
/** Fortschrittszeilen des Installationskerns (--json-progress) */
const PROGRESS_PREFIX = '@@KNOWSTEAD ';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function install(args: string[]) {
  const result = spawnSync(process.execPath, ['scripts/install.mjs', ...args, '--json-progress'], {
    cwd: ROOT,
    env: { ...process.env, KNOWSTEAD_SKIP_ENV_FILE: '' },
    encoding: 'utf8',
    timeout: 180_000,
  });
  const events = result.stdout
    .split(/\r?\n/)
    .filter((line) => line.startsWith(PROGRESS_PREFIX))
    .map((line) => JSON.parse(line.slice(PROGRESS_PREFIX.length)) as { event: string; id?: string; ok?: boolean; [key: string]: unknown });
  return { ...result, events };
}

/**
 * Der Installationskern prüft am Ende die Installation – und dazu gehört die gebaute Oberfläche, wie sie ein
 * Installationspaket mitbringt. Ohne Build scheitert jeder Lauf an „Oberfläche: nicht gebaut“. Auf dem eigenen
 * Rechner wird der Test dann ausgelassen (mit Begründung); im CI-Lauf ist das ein Fehler der Reihenfolge, der
 * auffallen muss: dort erst bauen, dann testen.
 */
const BUILT = fs.existsSync(path.join(ROOT, 'web', 'dist', 'index.html'));
const NOT_BUILT = 'Die Oberfläche ist nicht gebaut (web/dist fehlt) – zuerst „npm run build“ ausführen, dann die Tests';

test('Installationskern: Konfiguration, Probestart, Prüfung und erneuter Lauf', { skip: BUILT || process.env.CI ? false : NOT_BUILT }, async (t) => {
  assert.ok(BUILT, NOT_BUILT);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-install-'));
  const envPath = path.join(dir, '.env');
  // Leerzeichen und Raute: muss in der .env korrekt geschützt werden
  const dataDir = path.join(dir, 'Knowstead Daten #1');
  const port = await freePort();
  try {
    await t.test('Trockenlauf verändert nichts', () => {
      const res = install(['--env-path', envPath, '--data-dir', dataDir, '--port', String(port), '--skip-prepare', '--dry-run']);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(fs.existsSync(envPath), false);
      assert.equal(fs.existsSync(dataDir), false);
      assert.equal(res.events.at(-1)?.event, 'done');
      assert.equal(res.events.at(-1)?.dryRun, true);
    });

    await t.test('Erster Lauf: .env, Verzeichnisse, Probestart, Prüfung', () => {
      const res = install([
        '--env-path', envPath,
        '--data-dir', dataDir,
        '--port', String(port),
        '--host', '127.0.0.1',
        '--base-url', 'https://knowstead.example.com/',
        '--trust-proxy', 'loopback',
        '--log-file', 'logs/knowstead.log',
        '--service', 'task',
        '--skip-prepare',
      ]);
      assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.deepEqual(res.events.filter((e) => e.event === 'step').map((e) => e.id), ['node', 'config', 'dirs', 'test', 'doctor']);
      const done = res.events.at(-1)!;
      assert.equal(done.ok, true);
      assert.equal(done.needsSetup, true);
      assert.equal(done.setupUrl, `http://localhost:${port}/setup`);

      // Die .env liest Node genau so, wie der Assistent es meint
      const loaded = spawnSync(process.execPath, ['-e', `process.loadEnvFile(${JSON.stringify(envPath)}); console.log(JSON.stringify({ d: process.env.DATA_DIR, b: process.env.BASE_URL, p: process.env.PORT, s: process.env.KNOWSTEAD_SERVICE, l: process.env.LOG_FILE }))`], { encoding: 'utf8' });
      assert.deepEqual(JSON.parse(loaded.stdout), { d: dataDir, b: 'https://knowstead.example.com', p: String(port), s: 'task', l: 'logs/knowstead.log' });
      assert.ok(fs.existsSync(path.join(dataDir, 'knowstead.db')), 'Datenbank vom Probestart');
      assert.ok(fs.existsSync(path.join(dataDir, 'logs', 'knowstead.log')), 'Protokolldatei');
      assert.equal(fs.existsSync(path.join(dataDir, 'knowstead.stop')), false);
    });

    await t.test('Zusatzprogramme: Was sich nicht eintragen lässt, wird zum Hinweis – die Installation läuft durch', () => {
      const setting = (key: string) => {
        const res = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/cli.ts', 'settings:get', key], {
          cwd: ROOT,
          env: { ...process.env, DATA_DIR: dataDir, KNOWSTEAD_SKIP_ENV_FILE: '1' },
          encoding: 'utf8',
        });
        return JSON.parse(res.stdout) as Record<string, unknown>;
      };
      const base = ['--env-path', envPath, '--skip-prepare', '--skip-test'];
      const missing = path.join(dir, 'gibt-es-nicht.exe');
      // Vorhanden, aber nicht LibreOffice selbst: Als Konverter nimmt der Server nur „soffice“ an
      const starter = path.join(dir, 'libreoffice');
      fs.writeFileSync(starter, '');
      const report = path.join(dir, 'hinweise.txt');

      const res = install([...base, '--ocr-path', missing, '--office-path', starter, '--report', report]);
      assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
      const done = res.events.at(-1)!;
      assert.equal(done.event, 'done');
      assert.equal(done.ok, true);
      const warnings = done.warnings as string[];
      assert.equal(warnings.length, 2, warnings.join('\n'));
      assert.match(warnings[0], /^Texterkennung: .*gibt-es-nicht\.exe wurde nicht gefunden – die Einstellung bleibt unverändert\.$/);
      assert.match(warnings[1], /^Office-Vorschau ließ sich nicht eintragen: Als Konverter ist nur LibreOffice \(soffice, soffice\.exe\) erlaubt$/);
      assert.deepEqual(res.events.filter((e) => e.event === 'warning').map((e) => e.message), warnings);
      assert.deepEqual(fs.readFileSync(report, 'utf8').trim().split('\n'), warnings, 'dieselben Hinweise für install.sh');
      assert.ok(res.events.some((e) => e.event === 'step' && e.id === 'doctor'), 'die Prüfung läuft trotzdem');
      assert.equal(setting('ocr').enabled, false, 'Texterkennung bleibt aus');
      assert.equal(setting('officePreview').enabled, false, 'Office-Vorschau bleibt aus');

      // In der Konsole (ohne Assistenten) stehen die Hinweise am Ende noch einmal
      const plain = spawnSync(process.execPath, ['scripts/install.mjs', ...base, '--ocr-path', missing], {
        cwd: ROOT,
        env: { ...process.env, KNOWSTEAD_SKIP_ENV_FILE: '' },
        encoding: 'utf8',
        timeout: 180_000,
      });
      assert.equal(plain.status, 0, plain.stderr);
      assert.match(plain.stdout, /Installation prüfen[\s\S]*Hinweise – Knowstead ist eingerichtet[\s\S]*\[!\] Texterkennung: .*wurde nicht gefunden[\s\S]*Fertig\./);

      // Gegenprobe: LibreOffice selbst wird eingetragen, ein zweiter Lauf ändert nichts
      const soffice = path.join(dir, 'soffice');
      fs.writeFileSync(soffice, '');
      const ok = install([...base, '--office-path', soffice]);
      assert.equal(ok.status, 0, `${ok.stdout}\n${ok.stderr}`);
      assert.deepEqual(ok.events.at(-1)!.warnings, []);
      assert.deepEqual(setting('officePreview'), { enabled: true, sofficePath: soffice });
      const again = install([...base, '--office-path', soffice]);
      assert.equal(again.status, 0, `${again.stdout}\n${again.stderr}`);
      assert.match(again.stdout, /Office-Vorschau: bereits so eingetragen\./);
    });

    await t.test('Englisch: Schritte, Hinweise und Prüfung – und die Vorlage der .env', () => {
      const missing = path.join(dir, 'gibt-es-nicht.exe');
      const starter = path.join(dir, 'libreoffice');
      const res = install(['--env-path', envPath, '--skip-prepare', '--skip-test', '--lang', 'en', '--ocr-path', missing, '--office-path', starter]);
      assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
      assert.deepEqual(
        res.events.filter((e) => e.event === 'step').map((e) => e.title),
        ['Checking Node.js', 'Writing the configuration', 'Creating directories', 'Configuring the additional programs', 'Checking the installation'],
      );
      const done = res.events.at(-1)!;
      const warnings = done.warnings as string[];
      assert.match(warnings[0], /^Text recognition: .*gibt-es-nicht\.exe was not found – the setting stays unchanged\.$/);
      // Die Begründung stammt von der Kommandozeile (deutsch) und wird über den Katalog des Servers übertragen
      assert.equal(warnings[1], 'Office preview could not be configured: Only LibreOffice (soffice, soffice.exe) is allowed as converter');
      const checks = done.checks as { id: string; title: string; message: string; hint?: string }[];
      assert.equal(checks.find((c) => c.id === 'web')?.title, 'Interface');
      assert.match(checks.find((c) => c.id === 'data-writable')!.message, / is writable$/);
      assert.equal(checks.find((c) => c.id === 'setup')?.message, 'still open');
      assert.doesNotMatch(JSON.stringify(checks.map((c) => [c.title, c.hint ?? ''])), /Oberfläche|Datenverzeichnis|Datenbank|Sicherungen|prüfen|öffnen/);
      assert.match(res.stdout, /Notes – Knowstead is set up|Done\. /);
      assert.doesNotMatch(res.stdout, /Hinweise|Fertig\.|Konfiguration schreiben|Verzeichnisse anlegen|Installation prüfen|Texterkennung|Office-Vorschau/);

      // Vertrag mit update.sh und älteren Skripten: Ohne --lang antwortet die Prüfung auf Deutsch – auch wenn die
      // Umgebung Englisch nennt. Sie werten einzelne Meldungen aus („läuft“).
      const doctor = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/cli.ts', 'doctor', '--json'], {
        cwd: ROOT,
        env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), KNOWSTEAD_SKIP_ENV_FILE: '1', KNOWSTEAD_LANG: 'en', LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
        encoding: 'utf8',
      });
      const germanChecks = JSON.parse(doctor.stdout).checks as { id: string; title: string; message: string }[];
      assert.equal(germanChecks.find((c) => c.id === 'web')?.title, 'Oberfläche');
      assert.match(germanChecks.find((c) => c.id === 'server')!.message, /^läuft nicht – Port \d+ ist frei$/);
      const doctorEnglish = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/cli.ts', 'doctor', '--lang', 'en'], {
        cwd: ROOT,
        env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), KNOWSTEAD_SKIP_ENV_FILE: '1' },
        encoding: 'utf8',
      });
      assert.match(doctorEnglish.stdout, /installation check[\s\S]*Interface +built[\s\S]*Server +not running – port \d+ is free/);

      // Neue Installation: Die .env entsteht aus der Vorlage in der gewählten Sprache – mit denselben Werten
      const fresh = (lang: string) => {
        const file = path.join(dir, `neu-${lang}`, '.env');
        fs.mkdirSync(path.dirname(file));
        const run = install(['--env-path', file, '--data-dir', path.join(dir, `neu-${lang}`, 'data'), '--port', String(port), '--skip-prepare', '--skip-test', '--lang', lang]);
        assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
        return fs.readFileSync(file, 'utf8');
      };
      const english = fresh('en');
      const german = fresh('de');
      assert.match(english, /^# Port of the server$/m);
      assert.doesNotMatch(english, /Port des Servers|Verzeichnis für/);
      assert.match(german, /^# Port des Servers$/m);
      const values = (text: string) => text.split('\n').filter((line) => /^[A-Z_]+=/.test(line) && !line.startsWith('DATA_DIR=')).sort();
      assert.deepEqual(values(english), values(german));

      // Ohne --lang entscheidet KNOWSTEAD_LANG; eine unbekannte Sprache wird abgewiesen
      const byEnv = spawnSync(process.execPath, ['scripts/install.mjs', '--env-path', path.join(dir, 'neu-en', '.env'), '--skip-prepare', '--dry-run'], {
        cwd: ROOT,
        env: { ...process.env, KNOWSTEAD_LANG: 'en', KNOWSTEAD_SKIP_ENV_FILE: '' },
        encoding: 'utf8',
      });
      assert.match(byEnv.stdout, /Checking Node\.js/);
      const unknown = install(['--env-path', envPath, '--skip-prepare', '--dry-run', '--lang', 'fr']);
      assert.equal(unknown.status, 1);
      assert.match(unknown.stderr, /unknown language: fr/);
    });

    await t.test('Zweiter Lauf: Serverschlüssel und eigene Einträge bleiben, alte .env wird gesichert', () => {
      fs.appendFileSync(envPath, 'KNOWSTEAD_SECRET=eigener-geheimer-schluessel-1234567890\nTZ=Europe/Berlin\n');
      const res = install(['--env-path', envPath, '--port', String(port), '--service', 'none', '--log-file', '', '--skip-prepare', '--skip-test']);
      assert.equal(res.status, 0, `${res.stdout}\n${res.stderr}`);
      const text = fs.readFileSync(envPath, 'utf8');
      assert.match(text, /^KNOWSTEAD_SECRET=eigener-geheimer-schluessel-1234567890$/m);
      assert.match(text, /^TZ=Europe\/Berlin$/m);
      assert.match(text, /^BASE_URL=https:\/\/knowstead\.example\.com$/m, 'nicht angegebene Werte bleiben');
      assert.doesNotMatch(text, /^KNOWSTEAD_SERVICE=/m, 'Betriebsart entfernt');
      assert.doesNotMatch(text, /^LOG_FILE=/m, 'Protokolldatei entfernt');
      assert.ok(fs.readdirSync(dir).some((name) => name.startsWith('.env.bak-')), 'Sicherung der alten .env');
    });

    await t.test('Fehlerhafte Angaben werden verständlich abgewiesen', () => {
      for (const [args, message] of [
        [['--port', '70000'], /Ungültiger Port/],
        [['--base-url', 'ftp://x'], /Ungültige Adresse/],
        [['--host', 'irgendwo'], /Ungültige Netzwerkschnittstelle/],
        [['--data-dir', '\\\\server\\freigabe\\knowstead'], /Netzfreigabe/],
        [['--service', 'dienst'], /Unbekannte Betriebsart/],
      ] as const) {
        const res = install(['--env-path', envPath, '--skip-prepare', ...args]);
        assert.equal(res.status, 1, args.join(' '));
        assert.match(res.stderr, message);
        assert.equal(res.events.at(-1)?.event, 'error');
      }
    });

    await t.test('Belegter Port wird vor dem Probestart erkannt', async () => {
      const blocker = net.createServer();
      await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve));
      try {
        const res = install(['--env-path', envPath, '--data-dir', dataDir, '--port', String(port), '--host', '127.0.0.1', '--skip-prepare']);
        assert.equal(res.status, 1);
        assert.match(res.stderr, new RegExp(`Port ${port} ist belegt`));
      } finally {
        blocker.close();
      }
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
