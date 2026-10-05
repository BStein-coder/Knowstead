import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { Config } from '../../config.ts';
import { Db } from '../../db/database.ts';
import { acquireInstanceLock, InstanceLockError } from '../../db/lock.ts';
import { migrationStatus } from '../../db/migrate.ts';
import { restartHint, runningIsCurrent, RUNNING_KEY, type RunningProgram } from '../../core/program.ts';
import { translate, type Locale } from '../../core/i18n.ts';

export type CheckStatus = 'ok' | 'warn' | 'error';

export interface DoctorCheck {
  id: string;
  status: CheckStatus;
  title: string;
  message: string;
  /** Was zu tun ist, wenn nicht „ok“ */
  hint?: string;
}

const MIN_FREE_BYTES = 2 * 1024 ** 3;

function serverRunning(config: Config): boolean {
  try {
    acquireInstanceLock(config.dbFile, 0).release();
    return false;
  } catch (err) {
    if (err instanceof InstanceLockError) return true;
    throw err;
  }
}

function portFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

/** Fragt den laufenden Server über seine eigene Adresse – null, wenn er binnen drei Sekunden nicht antwortet. */
async function probeHttp(config: Config): Promise<{ version: string } | null> {
  const host = config.host === '0.0.0.0' ? '127.0.0.1' : config.host === '::' ? '[::1]' : config.host.includes(':') ? `[${config.host}]` : config.host;
  try {
    const res = await fetch(`http://${host}:${config.port}/api/v1/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const body = (await res.json()) as { status?: string; version?: string };
    return body.status === 'ok' ? { version: String(body.version ?? '') } : null;
  } catch {
    return null;
  }
}

function inside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

/** „Knowstead 1.7.0 (Paket vom 4.10.2026, 12:25:21)“ – zwei Pakete derselben Version unterscheidet nur der Bauzeitpunkt. */
export function describeProgram(version: string, builtAt: string | null, locale: Locale = 'de'): string {
  if (!builtAt) return `Knowstead ${version}`;
  return locale === 'en' ? `Knowstead ${version} (package of ${new Date(builtAt).toLocaleString('en-GB')})` : `Knowstead ${version} (Paket vom ${new Date(builtAt).toLocaleString('de-DE')})`;
}

/** Was der laufende Server beim Start über sich festgehalten hat – null bei einem Server aus einer älteren Version. */
export function readRunningProgram(db: Db): RunningProgram | null {
  try {
    const raw = db.value<string>('SELECT value FROM settings WHERE key = ?', `internal:${RUNNING_KEY}`);
    const value = raw ? (JSON.parse(raw) as Partial<RunningProgram>) : null;
    return value && typeof value.version === 'string' ? { version: value.version, builtAt: value.builtAt ?? null, startedAt: String(value.startedAt ?? ''), pid: Number(value.pid ?? 0) } : null;
  } catch {
    return null;
  }
}

/**
 * Prüft eine Installation, ohne etwas zu verändern (außer einer kurzen Probedatei im Datenverzeichnis).
 * Genutzt von `npm run cli -- doctor` und von den Installationsassistenten nach der Einrichtung.
 *
 * Die Texte sind deutsch – darauf verlassen sich update.sh und die Assistenten, die einzelne Meldungen
 * auswerten („läuft“). Mit `locale: 'en'` kommen sie auf Englisch, für die Anzeige im englischen Installer.
 */
export async function runDoctor(config: Config, locale: Locale = 'de'): Promise<DoctorCheck[]> {
  const L = (de: string, en: string) => (locale === 'en' ? en : de);
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck) => checks.push(check);

  const major = Number(process.versions.node.split('.')[0]);
  add(
    major >= 24
      ? { id: 'node', status: 'ok', title: 'Node.js', message: `Version ${process.versions.node}` }
      : { id: 'node', status: 'error', title: 'Node.js', message: L(`Version ${process.versions.node} ist zu alt`, `Version ${process.versions.node} is too old`), hint: L('Node.js 24 oder neuer installieren (https://nodejs.org/).', 'Install Node.js 24 or newer (https://nodejs.org/).') },
  );

  const distIndex = path.join(config.webDistDir, 'index.html');
  add(
    fs.existsSync(distIndex)
      ? { id: 'web', status: 'ok', title: L('Oberfläche', 'Interface'), message: L(`gebaut (${config.webDistDir})`, `built (${config.webDistDir})`) }
      : { id: 'web', status: 'error', title: L('Oberfläche', 'Interface'), message: L('nicht gebaut', 'not built'), hint: L('node scripts/prepare.mjs ausführen.', 'Run node scripts/prepare.mjs.') },
  );

  // Datenverzeichnis: vorhanden, beschreibbar, nicht im Programmordner, kein Netzlaufwerk, genug Platz
  try {
    const probe = path.join(config.dataDir, `.knowstead-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    add({ id: 'data-writable', status: 'ok', title: L('Datenverzeichnis', 'Data directory'), message: L(`${config.dataDir} ist beschreibbar`, `${config.dataDir} is writable`) });
  } catch (err) {
    add({
      id: 'data-writable',
      status: 'error',
      title: L('Datenverzeichnis', 'Data directory'),
      message: L(`${config.dataDir} ist nicht beschreibbar (${err instanceof Error ? err.message : String(err)})`, `${config.dataDir} is not writable (${err instanceof Error ? err.message : String(err)})`),
      hint: L('Dem Dienstkonto Änderungsrechte auf das Datenverzeichnis geben.', 'Give the service account modify rights on the data directory.'),
    });
  }
  if (inside(config.dataDir, config.rootDir)) {
    add({
      id: 'data-location',
      status: 'warn',
      title: L('Speicherort der Daten', 'Location of the data'),
      message: L('Das Datenverzeichnis liegt im Programmordner', 'The data directory is inside the program folder'),
      hint: L(
        'Für einfache Updates DATA_DIR außerhalb des Programmordners wählen (z. B. D:\\KnowsteadDaten oder /var/lib/knowstead).',
        'For easy updates choose a DATA_DIR outside the program folder (e.g. D:\\KnowsteadData or /var/lib/knowstead).',
      ),
    });
  }
  if (/^\\\\|^\/\//.test(config.dataDir)) {
    add({
      id: 'data-network',
      status: 'error',
      title: L('Speicherort der Daten', 'Location of the data'),
      message: L('Das Datenverzeichnis liegt auf einer Netzfreigabe', 'The data directory is on a network share'),
      hint: L('SQLite braucht zuverlässige Dateisperren – eine lokale SSD verwenden.', 'SQLite needs reliable file locks – use a local SSD.'),
    });
  }
  try {
    const stat = fs.statfsSync(config.dataDir);
    const free = Number(stat.bavail) * Number(stat.bsize);
    add(
      free >= MIN_FREE_BYTES
        ? { id: 'disk', status: 'ok', title: L('Freier Speicherplatz', 'Free disk space'), message: size(free) }
        : {
            id: 'disk',
            status: 'warn',
            title: L('Freier Speicherplatz', 'Free disk space'),
            message: L(`nur ${size(free)} frei`, `only ${size(free)} free`),
            hint: L('Für Datenbank, Anhänge und Sicherungen mindestens 2 GB frei halten.', 'Keep at least 2 GB free for database, attachments and backups.'),
          },
    );
  } catch {
    /* Dateisystem liefert keine Angaben */
  }

  // Adresse
  let baseUrl: URL | null = null;
  try {
    baseUrl = new URL(config.baseUrl);
  } catch {
    add({
      id: 'base-url',
      status: 'error',
      title: L('Adresse (BASE_URL)', 'Address (BASE_URL)'),
      message: L(`„${config.baseUrl}“ ist keine gültige Adresse`, `“${config.baseUrl}” is not a valid address`),
      hint: L('z. B. https://knowstead.firma.de', 'e.g. https://knowstead.example.com'),
    });
  }
  if (baseUrl) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
    if (baseUrl.protocol === 'https:') add({ id: 'base-url', status: 'ok', title: L('Adresse (BASE_URL)', 'Address (BASE_URL)'), message: config.baseUrl });
    else if (local) {
      add({
        id: 'base-url',
        status: config.isProduction ? 'warn' : 'ok',
        title: L('Adresse (BASE_URL)', 'Address (BASE_URL)'),
        message: L(`${config.baseUrl} – nur auf diesem Rechner erreichbar`, `${config.baseUrl} – reachable on this computer only`),
        hint: config.isProduction
          ? L('Für den Betrieb die öffentliche HTTPS-Adresse eintragen, sonst zeigen Links in E-Mails auf localhost.', 'For production enter the public HTTPS address, otherwise links in e-mails point to localhost.')
          : undefined,
      });
    } else {
      add({
        id: 'base-url',
        status: 'warn',
        title: L('Adresse (BASE_URL)', 'Address (BASE_URL)'),
        message: L(`${config.baseUrl} ohne HTTPS`, `${config.baseUrl} without HTTPS`),
        hint: L('Einen Reverse-Proxy mit Zertifikat vorschalten (Installationsanleitung, Abschnitt 7).', 'Put a reverse proxy with a certificate in front (installation guide, section 7).'),
      });
    }
    if (baseUrl.protocol === 'https:' && !config.trustProxy) {
      add({
        id: 'trust-proxy',
        status: 'warn',
        title: L('Reverse-Proxy', 'Reverse proxy'),
        message: L('HTTPS-Adresse, aber TRUST_PROXY ist nicht gesetzt', 'HTTPS address, but TRUST_PROXY is not set'),
        hint: L(
          'Läuft ein Proxy vor Knowstead, TRUST_PROXY auf dessen Adresse setzen (z. B. loopback) – sonst sieht Knowstead nicht die Adressen der Nutzenden.',
          'If a proxy runs in front of Knowstead, set TRUST_PROXY to its address (e.g. loopback) – otherwise Knowstead does not see the addresses of the users.',
        ),
      });
    }
  }

  const running = serverRunning(config);
  if (running) {
    add({ id: 'server', status: 'ok', title: 'Server', message: L('läuft', 'running') });
    // Der Prozess hält die Datenbank – antwortet er auch? (hängt er, oder startet er noch und migriert?)
    const answer = await probeHttp(config);
    add(
      answer
        ? { id: 'http', status: 'ok', title: L('Erreichbarkeit', 'Availability'), message: L(`antwortet auf Port ${config.port} (Knowstead ${answer.version})`, `responds on port ${config.port} (Knowstead ${answer.version})`) }
        : {
            id: 'http',
            status: 'warn',
            title: L('Erreichbarkeit', 'Availability'),
            message: L(`Der Server läuft, antwortet aber nicht auf Port ${config.port}`, `The server is running but does not respond on port ${config.port}`),
            hint: L(
              'Kurz nach dem Start ist das normal (Datenbank wird geprüft). Bleibt es dabei: Protokoll ansehen und den Dienst neu starten.',
              'Shortly after the start this is normal (the database is being checked). If it stays that way: look at the log and restart the service.',
            ),
          },
    );
  } else {
    const free = await portFree(config.port, config.host);
    add(
      free
        ? { id: 'server', status: 'ok', title: 'Server', message: L(`läuft nicht – Port ${config.port} ist frei`, `not running – port ${config.port} is free`) }
        : {
            id: 'server',
            status: 'error',
            title: 'Server',
            message: L(`läuft nicht, Port ${config.port} ist aber belegt`, `not running, but port ${config.port} is in use`),
            hint: L('Ein anderes Programm nutzt den Port – PORT in der .env ändern oder das Programm beenden.', 'Another program uses the port – change PORT in the .env file or stop that program.'),
          },
    );
  }

  // Serverschlüssel und Datenbank
  const secretFile = path.join(config.dataDir, 'secret.key');
  const envSecret = process.env.KNOWSTEAD_SECRET;
  // Steht der Schlüssel noch unter dem Namen aus der Zeit vor Version 2.0 in der .env, nennt die Prüfung diesen
  const secretName =
    process.env.DOKU_SECRET && process.env.DOKU_SECRET === envSecret ? L('DOKU_SECRET (früherer Name von KNOWSTEAD_SECRET)', 'DOKU_SECRET (former name of KNOWSTEAD_SECRET)') : 'KNOWSTEAD_SECRET';
  add(
    envSecret && envSecret.length >= 16
      ? { id: 'secret', status: 'ok', title: L('Serverschlüssel', 'Server key'), message: L(`aus ${secretName}`, `from ${secretName}`) }
      : fs.existsSync(secretFile)
        ? { id: 'secret', status: 'ok', title: L('Serverschlüssel', 'Server key'), message: L(`${secretFile} – mit dem Datenverzeichnis sichern`, `${secretFile} – back it up with the data directory`) }
        : { id: 'secret', status: 'ok', title: L('Serverschlüssel', 'Server key'), message: L('wird beim ersten Start angelegt', 'is created on first start') },
  );

  if (!fs.existsSync(config.dbFile)) {
    add({ id: 'database', status: 'ok', title: L('Datenbank', 'Database'), message: L('wird beim ersten Start angelegt', 'is created on first start') });
  } else {
    const db = new Db(config.dbFile);
    try {
      const st = migrationStatus(db);
      if (st.unknown.length) {
        add({
          id: 'database',
          status: 'error',
          title: L('Datenbank', 'Database'),
          message: L('stammt von einer neueren Knowstead-Version', 'comes from a newer Knowstead version'),
          hint: L('Die neuere Version starten oder eine passende Sicherung zurückspielen.', 'Start the newer version or restore a matching backup.'),
        });
      } else {
        add({
          id: 'database',
          status: 'ok',
          title: L('Datenbank', 'Database'),
          message: st.pending.length
            ? L(`Schema ${st.current} – ${st.pending.length} Migration(en) beim nächsten Start`, `schema ${st.current} – ${st.pending.length} migration(s) on next start`)
            : L(`Schema ${st.current}, aktuell`, `schema ${st.current}, up to date`),
        });
      }
      // Update eingespielt, Dienst aber nicht neu gestartet? Dann arbeitet der laufende Server noch mit dem alten Stand.
      if (running && !st.unknown.length) {
        const current = readRunningProgram(db);
        if (!runningIsCurrent(current, config)) {
          add({
            id: 'program',
            status: 'warn',
            title: L('Programmstand', 'Program version'),
            message: current
              ? L(
                  `Der laufende Server arbeitet noch mit ${describeProgram(current.version, current.builtAt)} – im Programmordner liegt ${describeProgram(config.version, config.packageBuiltAt)}`,
                  `The running server still works with ${describeProgram(current.version, current.builtAt, 'en')} – the program folder contains ${describeProgram(config.version, config.packageBuiltAt, 'en')}`,
                )
              : L(
                  `Der laufende Server wurde vor dem Einspielen dieses Programmstands gestartet (${describeProgram(config.version, config.packageBuiltAt)})`,
                  `The running server was started before this program version was installed (${describeProgram(config.version, config.packageBuiltAt, 'en')})`,
                ),
            hint: L(`Den Dienst neu starten: ${restartHint(config.service)}`, `Restart the service: ${translate(restartHint(config.service), 'en')}`),
          });
        }
      }
      const users = Number(db.value<number>('SELECT COUNT(*) FROM users') ?? 0);
      add(
        users > 0
          ? { id: 'setup', status: 'ok', title: L('Ersteinrichtung', 'First-time setup'), message: L('abgeschlossen', 'completed') }
          : {
              id: 'setup',
              status: 'warn',
              title: L('Ersteinrichtung', 'First-time setup'),
              message: L('noch offen', 'still open'),
              hint: L(
                `Im Browser ${config.baseUrl}/setup öffnen (auf dem Server selbst: http://localhost:${config.port}/setup, dann ohne Code).`,
                `Open ${config.baseUrl}/setup in the browser (on the server itself: http://localhost:${config.port}/setup, then without a code).`,
              ),
            },
      );
    } finally {
      db.close();
    }
  }

  const backups = fs.existsSync(config.backupsDir) ? fs.readdirSync(config.backupsDir).filter((n) => /^backup-\d{8}-\d{6}/.test(n)).sort() : [];
  if (fs.existsSync(config.dbFile)) {
    const newest = backups.at(-1);
    const age = newest ? Date.now() - fs.statSync(path.join(config.backupsDir, newest)).mtimeMs : Infinity;
    add(
      age < 2 * 86400000
        ? { id: 'backups', status: 'ok', title: L('Sicherungen', 'Backups'), message: L(`${backups.length}, neueste: ${newest}`, `${backups.length}, newest: ${newest}`) }
        : {
            id: 'backups',
            status: 'warn',
            title: L('Sicherungen', 'Backups'),
            message: newest ? L(`neueste Sicherung ist älter als zwei Tage (${newest})`, `the newest backup is older than two days (${newest})`) : L('noch keine Sicherung', 'no backup yet'),
            hint: L(
              'Automatische Sicherung unter Administration → Sicherungen prüfen und das Datenverzeichnis zusätzlich extern sichern.',
              'Check the automatic backup under Administration → Backups and additionally back up the data directory externally.',
            ),
          },
    );
  }

  if (config.logFile) {
    try {
      fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
      fs.accessSync(path.dirname(config.logFile), fs.constants.W_OK);
      add({ id: 'log', status: 'ok', title: L('Protokoll', 'Log'), message: config.logFile });
    } catch {
      add({
        id: 'log',
        status: 'error',
        title: L('Protokoll', 'Log'),
        message: L(`${config.logFile} ist nicht beschreibbar`, `${config.logFile} is not writable`),
        hint: L('LOG_FILE anpassen oder Rechte vergeben.', 'Adjust LOG_FILE or grant permissions.'),
      });
    }
  }
  return checks;
}
