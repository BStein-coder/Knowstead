import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import type { Config } from '../../config.ts';
import { Db } from '../../db/database.ts';
import { acquireInstanceLock, InstanceLockError } from '../../db/lock.ts';
import { migrationStatus } from '../../db/migrate.ts';
import { restartHint, runningIsCurrent, RUNNING_KEY, type RunningProgram } from '../../core/program.ts';

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
export function describeProgram(version: string, builtAt: string | null): string {
  return builtAt ? `Knowstead ${version} (Paket vom ${new Date(builtAt).toLocaleString('de-DE')})` : `Knowstead ${version}`;
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
 */
export async function runDoctor(config: Config): Promise<DoctorCheck[]> {
  const checks: DoctorCheck[] = [];
  const add = (check: DoctorCheck) => checks.push(check);

  const major = Number(process.versions.node.split('.')[0]);
  add(
    major >= 24
      ? { id: 'node', status: 'ok', title: 'Node.js', message: `Version ${process.versions.node}` }
      : { id: 'node', status: 'error', title: 'Node.js', message: `Version ${process.versions.node} ist zu alt`, hint: 'Node.js 24 oder neuer installieren (https://nodejs.org/).' },
  );

  const distIndex = path.join(config.webDistDir, 'index.html');
  add(
    fs.existsSync(distIndex)
      ? { id: 'web', status: 'ok', title: 'Oberfläche', message: `gebaut (${config.webDistDir})` }
      : { id: 'web', status: 'error', title: 'Oberfläche', message: 'nicht gebaut', hint: 'node scripts/prepare.mjs ausführen.' },
  );

  // Datenverzeichnis: vorhanden, beschreibbar, nicht im Programmordner, kein Netzlaufwerk, genug Platz
  try {
    const probe = path.join(config.dataDir, `.knowstead-probe-${process.pid}`);
    fs.writeFileSync(probe, 'ok');
    fs.rmSync(probe, { force: true });
    add({ id: 'data-writable', status: 'ok', title: 'Datenverzeichnis', message: `${config.dataDir} ist beschreibbar` });
  } catch (err) {
    add({
      id: 'data-writable',
      status: 'error',
      title: 'Datenverzeichnis',
      message: `${config.dataDir} ist nicht beschreibbar (${err instanceof Error ? err.message : String(err)})`,
      hint: 'Dem Dienstkonto Änderungsrechte auf das Datenverzeichnis geben.',
    });
  }
  if (inside(config.dataDir, config.rootDir)) {
    add({
      id: 'data-location',
      status: 'warn',
      title: 'Speicherort der Daten',
      message: 'Das Datenverzeichnis liegt im Programmordner',
      hint: 'Für einfache Updates DATA_DIR außerhalb des Programmordners wählen (z. B. D:\\KnowsteadDaten oder /var/lib/knowstead).',
    });
  }
  if (/^\\\\|^\/\//.test(config.dataDir)) {
    add({
      id: 'data-network',
      status: 'error',
      title: 'Speicherort der Daten',
      message: 'Das Datenverzeichnis liegt auf einer Netzfreigabe',
      hint: 'SQLite braucht zuverlässige Dateisperren – eine lokale SSD verwenden.',
    });
  }
  try {
    const stat = fs.statfsSync(config.dataDir);
    const free = Number(stat.bavail) * Number(stat.bsize);
    add(
      free >= MIN_FREE_BYTES
        ? { id: 'disk', status: 'ok', title: 'Freier Speicherplatz', message: size(free) }
        : { id: 'disk', status: 'warn', title: 'Freier Speicherplatz', message: `nur ${size(free)} frei`, hint: 'Für Datenbank, Anhänge und Sicherungen mindestens 2 GB frei halten.' },
    );
  } catch {
    /* Dateisystem liefert keine Angaben */
  }

  // Adresse
  let baseUrl: URL | null = null;
  try {
    baseUrl = new URL(config.baseUrl);
  } catch {
    add({ id: 'base-url', status: 'error', title: 'Adresse (BASE_URL)', message: `„${config.baseUrl}“ ist keine gültige Adresse`, hint: 'z. B. https://knowstead.firma.de' });
  }
  if (baseUrl) {
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(baseUrl.hostname);
    if (baseUrl.protocol === 'https:') add({ id: 'base-url', status: 'ok', title: 'Adresse (BASE_URL)', message: config.baseUrl });
    else if (local) {
      add({
        id: 'base-url',
        status: config.isProduction ? 'warn' : 'ok',
        title: 'Adresse (BASE_URL)',
        message: `${config.baseUrl} – nur auf diesem Rechner erreichbar`,
        hint: config.isProduction ? 'Für den Betrieb die öffentliche HTTPS-Adresse eintragen, sonst zeigen Links in E-Mails auf localhost.' : undefined,
      });
    } else {
      add({ id: 'base-url', status: 'warn', title: 'Adresse (BASE_URL)', message: `${config.baseUrl} ohne HTTPS`, hint: 'Einen Reverse-Proxy mit Zertifikat vorschalten (Installationsanleitung, Abschnitt 7).' });
    }
    if (baseUrl.protocol === 'https:' && !config.trustProxy) {
      add({
        id: 'trust-proxy',
        status: 'warn',
        title: 'Reverse-Proxy',
        message: 'HTTPS-Adresse, aber TRUST_PROXY ist nicht gesetzt',
        hint: 'Läuft ein Proxy vor Knowstead, TRUST_PROXY auf dessen Adresse setzen (z. B. loopback) – sonst sieht Knowstead nicht die Adressen der Nutzenden.',
      });
    }
  }

  const running = serverRunning(config);
  if (running) {
    add({ id: 'server', status: 'ok', title: 'Server', message: 'läuft' });
    // Der Prozess hält die Datenbank – antwortet er auch? (hängt er, oder startet er noch und migriert?)
    const answer = await probeHttp(config);
    add(
      answer
        ? { id: 'http', status: 'ok', title: 'Erreichbarkeit', message: `antwortet auf Port ${config.port} (Knowstead ${answer.version})` }
        : {
            id: 'http',
            status: 'warn',
            title: 'Erreichbarkeit',
            message: `Der Server läuft, antwortet aber nicht auf Port ${config.port}`,
            hint: 'Kurz nach dem Start ist das normal (Datenbank wird geprüft). Bleibt es dabei: Protokoll ansehen und den Dienst neu starten.',
          },
    );
  } else {
    const free = await portFree(config.port, config.host);
    add(
      free
        ? { id: 'server', status: 'ok', title: 'Server', message: `läuft nicht – Port ${config.port} ist frei` }
        : { id: 'server', status: 'error', title: 'Server', message: `läuft nicht, Port ${config.port} ist aber belegt`, hint: 'Ein anderes Programm nutzt den Port – PORT in der .env ändern oder das Programm beenden.' },
    );
  }

  // Serverschlüssel und Datenbank
  const secretFile = path.join(config.dataDir, 'secret.key');
  const envSecret = process.env.KNOWSTEAD_SECRET;
  // Steht der Schlüssel noch unter dem Namen aus der Zeit vor Version 2.0 in der .env, nennt die Prüfung diesen
  const secretName = process.env.DOKU_SECRET && process.env.DOKU_SECRET === envSecret ? 'DOKU_SECRET (früherer Name von KNOWSTEAD_SECRET)' : 'KNOWSTEAD_SECRET';
  add(
    envSecret && envSecret.length >= 16
      ? { id: 'secret', status: 'ok', title: 'Serverschlüssel', message: `aus ${secretName}` }
      : fs.existsSync(secretFile)
        ? { id: 'secret', status: 'ok', title: 'Serverschlüssel', message: `${secretFile} – mit dem Datenverzeichnis sichern` }
        : { id: 'secret', status: 'ok', title: 'Serverschlüssel', message: 'wird beim ersten Start angelegt' },
  );

  if (!fs.existsSync(config.dbFile)) {
    add({ id: 'database', status: 'ok', title: 'Datenbank', message: 'wird beim ersten Start angelegt' });
  } else {
    const db = new Db(config.dbFile);
    try {
      const st = migrationStatus(db);
      if (st.unknown.length) {
        add({ id: 'database', status: 'error', title: 'Datenbank', message: 'stammt von einer neueren Knowstead-Version', hint: 'Die neuere Version starten oder eine passende Sicherung zurückspielen.' });
      } else {
        add({
          id: 'database',
          status: 'ok',
          title: 'Datenbank',
          message: st.pending.length ? `Schema ${st.current} – ${st.pending.length} Migration(en) beim nächsten Start` : `Schema ${st.current}, aktuell`,
        });
      }
      // Update eingespielt, Dienst aber nicht neu gestartet? Dann arbeitet der laufende Server noch mit dem alten Stand.
      if (running && !st.unknown.length) {
        const current = readRunningProgram(db);
        if (!runningIsCurrent(current, config)) {
          add({
            id: 'program',
            status: 'warn',
            title: 'Programmstand',
            message: current
              ? `Der laufende Server arbeitet noch mit ${describeProgram(current.version, current.builtAt)} – im Programmordner liegt ${describeProgram(config.version, config.packageBuiltAt)}`
              : `Der laufende Server wurde vor dem Einspielen dieses Programmstands gestartet (${describeProgram(config.version, config.packageBuiltAt)})`,
            hint: `Den Dienst neu starten: ${restartHint(config.service)}`,
          });
        }
      }
      const users = Number(db.value<number>('SELECT COUNT(*) FROM users') ?? 0);
      add(
        users > 0
          ? { id: 'setup', status: 'ok', title: 'Ersteinrichtung', message: 'abgeschlossen' }
          : { id: 'setup', status: 'warn', title: 'Ersteinrichtung', message: 'noch offen', hint: `Im Browser ${config.baseUrl}/setup öffnen (auf dem Server selbst: http://localhost:${config.port}/setup, dann ohne Code).` },
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
        ? { id: 'backups', status: 'ok', title: 'Sicherungen', message: `${backups.length}, neueste: ${newest}` }
        : {
            id: 'backups',
            status: 'warn',
            title: 'Sicherungen',
            message: newest ? `neueste Sicherung ist älter als zwei Tage (${newest})` : 'noch keine Sicherung',
            hint: 'Automatische Sicherung unter Administration → Sicherungen prüfen und das Datenverzeichnis zusätzlich extern sichern.',
          },
    );
  }

  if (config.logFile) {
    try {
      fs.mkdirSync(path.dirname(config.logFile), { recursive: true });
      fs.accessSync(path.dirname(config.logFile), fs.constants.W_OK);
      add({ id: 'log', status: 'ok', title: 'Protokoll', message: config.logFile });
    } catch {
      add({ id: 'log', status: 'error', title: 'Protokoll', message: `${config.logFile} ist nicht beschreibbar`, hint: 'LOG_FILE anpassen oder Rechte vergeben.' });
    }
  }
  return checks;
}
