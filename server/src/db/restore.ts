/**
 * Sicherung zurückspielen – bei gestopptem Server (Aufrufer hält die Instanz-Sperre).
 *
 * Vorgehen: Sicherung prüfen (integrity_check) → aktuellen Stand als Sicherung „…-restore“
 * ablegen → Datenbank schließen und WAL-/SHM-Dateien entfernen (eine alte WAL-Datei würde sonst
 * auf die zurückgespielte Datenbank angewendet und sie beschädigen) → Datei atomar ersetzen →
 * optional Anhänge zurückkopieren. Ältere Sicherungen werden beim nächsten Start migriert.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from './database.ts';
import { BACKUP_NAME_RE, uniqueBackupName } from './backup-names.ts';
import { backupDbName, findBackupDb } from '../core/legacy.ts';

export { BACKUP_NAME_RE };

export interface RestoreOptions {
  name: string;
  backupsDir: string;
  dbFile: string;
  uploadsDir: string;
  withUploads?: boolean;
  /** Höchste Schemaversion, die dieses Programm kennt – neuere Sicherungen werden abgewiesen */
  latestSchema?: number;
}

export interface RestoreResult {
  /** Sicherung des Stands vor der Wiederherstellung */
  safetyBackup: string | null;
  schemaVersion: number;
  uploadsCopied: number;
}

function countFiles(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true }).filter((e) => e.isFile()).length;
}

/** Prüft eine Sicherungsdatei, ohne sie zu verändern. */
export function inspectBackupDatabase(file: string): { ok: boolean; message: string; schemaVersion: number } {
  let conn: DatabaseSync | null = null;
  try {
    conn = new DatabaseSync(file, { readOnly: true });
    const check = conn.prepare('PRAGMA integrity_check').get() as { integrity_check?: string } | undefined;
    const message = check?.integrity_check ?? 'unbekannt';
    let schemaVersion = 0;
    try {
      schemaVersion = Number((conn.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v?: number } | undefined)?.v ?? 0);
    } catch {
      schemaVersion = 0;
    }
    return { ok: message === 'ok', message, schemaVersion };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), schemaVersion: 0 };
  } finally {
    conn?.close();
  }
}

export function restoreBackup(options: RestoreOptions): RestoreResult {
  if (!BACKUP_NAME_RE.test(options.name)) throw new Error(`Ungültiger Sicherungsname: ${options.name}`);
  const dir = path.join(options.backupsDir, options.name);
  // Sicherungen aus der Zeit vor der Umbenennung enthalten die Datenbank unter ihrem früheren Namen
  const source = findBackupDb(dir);
  if (!source) throw new Error(`Sicherung nicht gefunden: ${dir}`);
  const inspected = inspectBackupDatabase(source);
  if (!inspected.ok) throw new Error(`Die Sicherung ist beschädigt (${inspected.message}) – es wurde nichts verändert.`);
  if (inspected.schemaVersion < 1) throw new Error('Die Sicherung enthält keine Knowstead-Datenbank – es wurde nichts verändert.');
  if (options.latestSchema !== undefined && inspected.schemaVersion > options.latestSchema) {
    throw new Error(
      `Die Sicherung stammt von einer neueren Knowstead-Version (Schema ${inspected.schemaVersion}, dieses Programm kennt bis ${options.latestSchema}) – es wurde nichts verändert.`,
    );
  }
  const backupUploads = path.join(dir, 'uploads');
  if (options.withUploads && !fs.existsSync(backupUploads)) throw new Error('Diese Sicherung enthält keine Anhänge (ohne --with-uploads zurückspielen).');

  // 1. Aktuellen Stand sichern
  let safetyBackup: string | null = null;
  if (fs.existsSync(options.dbFile)) {
    safetyBackup = uniqueBackupName(options.backupsDir, 'restore');
    const safetyDir = path.join(options.backupsDir, safetyBackup);
    const safetyDb = path.join(safetyDir, backupDbName(options.dbFile));
    fs.mkdirSync(safetyDir, { recursive: true });
    let copied = false;
    try {
      const current = new Db(options.dbFile);
      try {
        current.exec(`VACUUM INTO '${safetyDb.replace(/'/g, "''")}'`);
      } finally {
        // Schließen überträgt die WAL-Datei in die Datenbank
        current.close();
      }
    } catch {
      // Beschädigte Datenbank – gerade dann muss das Zurückspielen gelingen: Dateien unverändert kopieren
      fs.rmSync(safetyDb, { force: true });
      for (const suffix of ['', '-wal', '-shm']) {
        if (fs.existsSync(`${options.dbFile}${suffix}`)) fs.copyFileSync(`${options.dbFile}${suffix}`, `${safetyDb}${suffix}`);
      }
      copied = true;
    }
    // Schemastand für „backup:list“ und die Übersicht in der Administration (ohne teure Integritätsprüfung)
    let schemaVersion: number | undefined;
    try {
      const conn = new DatabaseSync(safetyDb, { readOnly: true });
      try {
        schemaVersion = Number((conn.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v?: number } | undefined)?.v ?? 0) || undefined;
      } finally {
        conn.close();
      }
    } catch {
      /* beschädigte Datenbank: Stand unbekannt */
    }
    fs.writeFileSync(
      path.join(safetyDir, 'manifest.json'),
      JSON.stringify({ createdAt: new Date().toISOString(), schemaVersion, includeUploads: false, reason: 'vor-wiederherstellung', restoredFrom: options.name, rawCopy: copied }, null, 2),
    );
  }

  // 2. Reste des Write-Ahead-Logs entfernen, Datei atomar ersetzen
  for (const suffix of ['-wal', '-shm']) fs.rmSync(`${options.dbFile}${suffix}`, { force: true });
  const temp = `${options.dbFile}.restore-tmp`;
  fs.mkdirSync(path.dirname(options.dbFile), { recursive: true });
  fs.copyFileSync(source, temp);
  fs.renameSync(temp, options.dbFile);

  // 3. Anhänge: Dateien der Sicherung zurückkopieren (neuere Dateien bleiben liegen, nichts wird gelöscht)
  let uploadsCopied = 0;
  if (options.withUploads) {
    fs.mkdirSync(options.uploadsDir, { recursive: true });
    fs.cpSync(backupUploads, options.uploadsDir, { recursive: true, force: true });
    uploadsCopied = countFiles(backupUploads);
  }
  return { safetyBackup, schemaVersion: inspected.schemaVersion, uploadsCopied };
}
