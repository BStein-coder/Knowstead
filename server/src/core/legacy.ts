import fs from 'node:fs';
import path from 'node:path';

/**
 * Namen aus der Zeit, als Knowstead noch „Doku“ hieß (bis Version 1.9).
 *
 * Bestehende Installationen behalten, was sie haben: die Datenbankdatei, die Einträge in der `.env`, ihre
 * API-Tokens, ihre Anmeldungen und die Kopfzeilen, die ein vorgeschalteter Proxy oder ein Skript sendet. Der
 * Server versteht deshalb beide Schreibweisen – neu angelegt wird überall nur der neue Name.
 *
 * Alles, was den früheren Namen noch kennt, steht hier an einer Stelle. Ausnahme: der Prüfwert des
 * Serverschlüssels in `services.ts` – er steht in jeder bestehenden Datenbank und darf sich nie ändern.
 */
export const DB_FILE_NAME = 'knowstead.db';
export const LEGACY_DB_FILE_NAME = 'doku.db';
export const PACKAGE_INFO_FILE = '.knowstead-package.json';
export const LEGACY_PACKAGE_INFO_FILE = '.doku-package.json';
export const LEGACY_SESSION_COOKIE = 'doku_session';
/** Stopp-Datei im Datenverzeichnis, auf die ein Server bis 1.9 achtet (`cli stop`) */
export const LEGACY_STOP_FILE = 'doku.stop';
export const LEGACY_TOKEN_PREFIX = 'doku_';
/** Archiv eines Bereichs (Export/Import): Name der Beschreibungsdatei und Kennung des Formats */
export const LEGACY_ARCHIVE_FILE = 'doku-space.json';
export const LEGACY_ARCHIVE_FORMAT = 'doku-space';
/** Dienst, Konto und Ordner einer Installation, die install.sh vor der Umbenennung eingerichtet hat */
export const LEGACY_SERVICE_NAME = 'doku';

const ENV_PREFIX = 'KNOWSTEAD_';
const LEGACY_ENV_PREFIX = 'DOKU_';

/**
 * Einstellungen mit dem früheren Präfix übernehmen: `DOKU_SECRET` gilt als `KNOWSTEAD_SECRET`, solange die
 * neue Variable nicht gesetzt ist – auch eine leere zählt als nicht gesetzt (Docker Compose reicht eine
 * fehlende Angabe als leeren Wert durch). Liefert die übernommenen Namen (für einen Hinweis im Protokoll).
 */
export function adoptLegacyEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const adopted: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(LEGACY_ENV_PREFIX) || value === undefined) continue;
    const current = ENV_PREFIX + name.slice(LEGACY_ENV_PREFIX.length);
    if (env[current] === undefined || env[current] === '') {
      env[current] = value;
      adopted.push(name);
    }
  }
  return adopted.sort();
}

/**
 * Datenbankdatei im Datenverzeichnis: Gibt es dort schon eine Datenbank mit dem früheren Namen (und keine mit
 * dem neuen), bleibt sie es – eine laufende Installation wird beim Update nicht umgebaut.
 */
export function defaultDbFile(dataDir: string): string {
  const current = path.join(dataDir, DB_FILE_NAME);
  const legacy = path.join(dataDir, LEGACY_DB_FILE_NAME);
  return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current;
}

/**
 * Name der Datenbank in einer Sicherung: so, wie die laufende Datenbank heißt. Bei einer Installation mit
 * `doku.db` kann damit auch die Vorversion (1.8, 1.9) eine Sicherung zurückspielen, die diese Version vor dem
 * Umstellen der Datenbank angelegt hat – darauf verlässt sich `update.sh`, wenn ein Update scheitert.
 */
export function backupDbName(dbFile: string): string {
  return path.basename(dbFile) === LEGACY_DB_FILE_NAME ? LEGACY_DB_FILE_NAME : DB_FILE_NAME;
}

/** Datenbankdatei in einem Sicherungsordner – neuer oder früherer Name; `null`, wenn keine da ist. */
export function findBackupDb(dir: string): string | null {
  for (const name of [DB_FILE_NAME, LEGACY_DB_FILE_NAME]) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) return file;
  }
  return null;
}

/** Kopfzeile einer Anfrage unter dem neuen oder dem früheren Namen (`x-knowstead-client` bzw. `x-doku-client`). */
export function headerValue(headers: Record<string, string | string[] | undefined>, name: string): string | undefined {
  const value = headers[`x-knowstead-${name}`] ?? headers[`x-doku-${name}`];
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Name des systemd-Dienstes: `knowstead` – oder `doku`, wenn nur der frühere Dienst eingerichtet ist. Nur für
 * Hinweise („systemctl restart …“); gesteuert wird der Dienst von den Installationsskripten.
 */
export function systemdServiceName(unitDir = '/etc/systemd/system'): string {
  try {
    if (!fs.existsSync(path.join(unitDir, 'knowstead.service')) && fs.existsSync(path.join(unitDir, `${LEGACY_SERVICE_NAME}.service`))) return LEGACY_SERVICE_NAME;
  } catch {
    /* kein Zugriff: neuer Name */
  }
  return 'knowstead';
}
