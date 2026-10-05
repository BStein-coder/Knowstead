/**
 * Datenbank öffnen und sicher auf den Stand dieses Programms bringen.
 *
 * Reihenfolge beim Start einer neuen Version:
 *  1. Stand prüfen – kennt die Datenbank Migrationen, die dieses Programm nicht kennt, stammt sie
 *     von einer neueren Version: Start verweigern (sonst schreibt altes Programm in neues Schema).
 *  2. Stehen Migrationen an und enthält die Datenbank schon Daten: vollständige Kopie unter
 *     `backups/backup-…-update` anlegen. Scheitert die Sicherung, wird nicht migriert.
 *  3. Alle Migrationen in einer Transaktion anwenden (alles oder nichts).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Db } from './database.ts';
import { MIGRATIONS, migrate, migrationStatus, type Migration } from './migrate.ts';
import { uniqueBackupName } from './backup-names.ts';
import { backupDbName } from '../core/legacy.ts';

export class DatabaseVersionError extends Error {}

export interface OpenDatabaseOptions {
  backupsDir: string;
  appVersion: string;
  log?: (msg: string) => void;
  migrations?: Migration[];
  /** Start trotz neuerer Datenbank (nur im Notfall, z. B. zum Auslesen) */
  allowDowngrade?: boolean;
  /** Keine Sicherung vor Migrationen (nicht empfohlen) */
  skipBackup?: boolean;
  /** Anzahl aufzubewahrender Update-Sicherungen */
  keepUpdateBackups?: number;
  /**
   * Prüfung einer bestehenden Datenbank vor Sicherung und Migrationen (z. B. Serverschlüssel).
   * Wirft sie, bleibt die Datenbank unverändert.
   */
  beforeChanges?: (db: Db) => void;
}

export interface OpenDatabaseResult {
  db: Db;
  /** angewendete Migrationen */
  migrated: number;
  fromSchema: number;
  toSchema: number;
  /** Name der Sicherung vor dem Update (falls angelegt) */
  backup: string | null;
  /** Programmversion, die zuletzt mit dieser Datenbank lief (null = unbekannt/neu) */
  previousAppVersion: string | null;
}

const UPDATE_BACKUP_RE = /^backup-\d{8}-\d{6}-update$/;

function readPreviousVersion(db: Db): string | null {
  try {
    const raw = db.value<string>("SELECT value FROM settings WHERE key = 'internal:app:version'");
    return raw ? (JSON.parse(raw) as string) : null;
  } catch {
    return null; // Tabelle existiert (noch) nicht
  }
}

/** Konsistente Kopie der Datenbank vor den Migrationen – im Format der normalen Sicherungen. */
export function createUpdateBackup(
  db: Db,
  backupsDir: string,
  info: { fromSchema: number; toSchema: number; appVersion: string; previousAppVersion: string | null; dbFile: string },
): string {
  const now = new Date();
  const name = uniqueBackupName(backupsDir, 'update', now);
  const dir = path.join(backupsDir, name);
  fs.mkdirSync(dir, { recursive: true });
  try {
    // Derselbe Dateiname wie die laufende Datenbank: Die Vorversion muss diese Sicherung zurückspielen können
    db.exec(`VACUUM INTO '${path.join(dir, backupDbName(info.dbFile)).replace(/'/g, "''")}'`);
    fs.writeFileSync(
      path.join(dir, 'manifest.json'),
      JSON.stringify(
        {
          createdAt: now.toISOString(),
          version: info.previousAppVersion ?? '',
          schemaVersion: info.fromSchema,
          includeUploads: false,
          reason: 'update',
          update: { from: info.previousAppVersion, to: info.appVersion, fromSchema: info.fromSchema, toSchema: info.toSchema },
        },
        null,
        2,
      ),
    );
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw err;
  }
  return name;
}

function pruneUpdateBackups(backupsDir: string, keep: number): void {
  if (keep <= 0 || !fs.existsSync(backupsDir)) return;
  const names = fs
    .readdirSync(backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && UPDATE_BACKUP_RE.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const name of names.slice(keep)) fs.rmSync(path.join(backupsDir, name), { recursive: true, force: true });
}

export function openDatabase(file: string, options: OpenDatabaseOptions): OpenDatabaseResult {
  const log = options.log ?? (() => {});
  const migrations = options.migrations ?? MIGRATIONS;
  const db = new Db(file);
  try {
    const status = migrationStatus(db, migrations);
    const previousAppVersion = readPreviousVersion(db);
    if (status.unknown.length) {
      const message =
        `Die Datenbank wurde bereits von einer neueren Knowstead-Version verwendet (Schema ${status.current}, ` +
        `diese Version ${options.appVersion} kennt bis ${status.latest}${previousAppVersion ? `, zuletzt lief ${previousAppVersion}` : ''}). ` +
        'Bitte die neuere Version starten oder eine zu dieser Version passende Sicherung zurückspielen (npm run cli -- restore).';
      if (!options.allowDowngrade) throw new DatabaseVersionError(message);
      log(`WARNUNG: ${message} – Start wegen KNOWSTEAD_ALLOW_DOWNGRADE trotzdem.`);
    }

    let backup: string | null = null;
    const hasData = status.applied.length > 0;
    if (hasData) options.beforeChanges?.(db);
    if (status.pending.length && hasData) {
      if (options.skipBackup) {
        log('WARNUNG: Sicherung vor dem Update ist abgeschaltet (KNOWSTEAD_SKIP_UPDATE_BACKUP).');
      } else {
        try {
          backup = createUpdateBackup(db, options.backupsDir, {
            fromSchema: status.current,
            toSchema: status.latest,
            appVersion: options.appVersion,
            previousAppVersion,
            dbFile: file,
          });
        } catch (err) {
          throw new Error(
            `Sicherung vor dem Update fehlgeschlagen – es wurde nichts verändert. Bitte freien Speicherplatz unter ${options.backupsDir} prüfen. ` +
              `Ursache: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }
        log(`Sicherung vor dem Update angelegt: ${backup}`);
        pruneUpdateBackups(options.backupsDir, options.keepUpdateBackups ?? 5);
      }
    }

    const migrated = migrate(db, log, migrations);
    return { db, migrated, fromSchema: status.current, toSchema: migrationStatus(db, migrations).current, backup, previousAppVersion };
  } catch (err) {
    db.close();
    throw err;
  }
}
