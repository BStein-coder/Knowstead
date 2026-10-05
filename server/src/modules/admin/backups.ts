import fs from 'node:fs';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { Worker } from 'node:worker_threads';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { schemaVersion } from '../../db/migrate.ts';
import { badRequest, notFound } from '../../core/errors.ts';
import { zipStream, type ZipSource } from '../../core/zip.ts';
import { backupDbName, findBackupDb } from '../../core/legacy.ts';
import { BACKUP_NAME_RE, uniqueBackupName } from '../../db/backup-names.ts';
import { BACKUP_FAILURE_KEY } from '../system/alerts.ts';

export interface BackupInfo {
  name: string;
  createdAt: string;
  size: number;
  dbSize: number;
  includesUploads: boolean;
  reason: string;
  version: string;
}

const NAME_RE = BACKUP_NAME_RE;

function dirSize(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) total += fs.statSync(path.join(entry.parentPath, entry.name)).size;
  }
  return total;
}

function* walk(dir: string, prefix: string): Generator<ZipSource> {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(full, rel);
    else if (entry.isFile()) yield { name: rel, file: full };
  }
}

/** Sicherungen: Datenbank-Snapshot (VACUUM INTO) + optional Kopie der Anhänge. */
export class BackupService {
  private readonly s: Services;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(s: Services) {
    this.s = s;
  }

  list(): BackupInfo[] {
    const dir = this.s.config.backupsDir;
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && NAME_RE.test(e.name))
      .map((e) => {
        const full = path.join(dir, e.name);
        let manifest: Partial<BackupInfo> & { includeUploads?: boolean } = {};
        try {
          manifest = JSON.parse(fs.readFileSync(path.join(full, 'manifest.json'), 'utf8'));
        } catch {
          /* ältere oder unvollständige Sicherung */
        }
        const dbFile = findBackupDb(full);
        return {
          name: e.name,
          createdAt: manifest.createdAt ?? fs.statSync(full).mtime.toISOString(),
          size: dirSize(full),
          dbSize: dbFile ? fs.statSync(dbFile).size : 0,
          includesUploads: !!manifest.includeUploads,
          reason: manifest.reason ?? '',
          version: manifest.version ?? '',
        };
      })
      .sort((a, b) => b.name.localeCompare(a.name));
  }

  /**
   * Sicherung anlegen. `suffix` kennzeichnet besondere Sicherungen im Namen (z. B. „loeschung“ vor dem
   * Löschen eines Bereichs); `includeUploads` überschreibt die Einstellung für Anhänge.
   */
  async create(auth: AuthContext | null, reason = 'manuell', options: { suffix?: string; includeUploads?: boolean } = {}): Promise<BackupInfo> {
    if (this.running) throw badRequest('Es läuft bereits eine Sicherung');
    this.running = true;
    try {
      const d = new Date();
      const name = uniqueBackupName(this.s.config.backupsDir, options.suffix ?? (reason === 'auto' ? 'auto' : ''), d);
      const dir = path.join(this.s.config.backupsDir, name);
      fs.mkdirSync(dir, { recursive: true });
      const dbTarget = path.join(dir, backupDbName(this.s.config.dbFile));
      await this.snapshot(dbTarget);
      const includeUploads = options.includeUploads ?? this.s.settings.get('backupIncludeUploads');
      if (includeUploads) {
        await fs.promises.cp(this.s.config.uploadsDir, path.join(dir, 'uploads'), { recursive: true });
      }
      fs.writeFileSync(
        path.join(dir, 'manifest.json'),
        JSON.stringify(
          { createdAt: d.toISOString(), version: this.s.config.version, schemaVersion: schemaVersion(this.s.db), includeUploads, reason },
          null,
          2,
        ),
      );
      this.prune();
      // Eine gelungene Sicherung hebt die Warnung über die gescheiterte auf
      if (this.s.settings.getInternal(BACKUP_FAILURE_KEY, null)) {
        this.s.settings.setInternal(BACKUP_FAILURE_KEY, null);
        this.s.alerts.kick();
      }
      const info = this.list().find((b) => b.name === name)!;
      if (auth) this.s.emit(auth, { type: 'backup.created', target: { type: 'backup', id: name, label: name }, data: { size: info.size, reason } });
      else this.s.events.emit({ type: 'backup.created', target: { type: 'backup', id: name, label: name }, data: { size: info.size, reason } });
      return info;
    } finally {
      this.running = false;
    }
  }

  /** Datenbank-Snapshot im Worker-Thread, damit der Server während der Sicherung weiter antwortet. */
  private snapshot(target: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.s.program.prepareWorker();
      const worker = new Worker(new URL('./snapshot-worker.ts', import.meta.url), { workerData: { source: this.s.config.dbFile, target } });
      let settled = false;
      worker.once('message', (reply: { ok: boolean; error?: string }) => {
        settled = true;
        if (reply.ok) resolve();
        else reject(new Error(`Datenbank-Snapshot fehlgeschlagen: ${reply.error}`));
      });
      worker.once('error', (err) => {
        settled = true;
        reject(err);
      });
      worker.once('exit', (code) => {
        if (!settled) reject(new Error(`Datenbank-Snapshot abgebrochen (Code ${code})`));
      });
    });
  }

  private prune(): void {
    const keep = this.s.settings.get('backupKeep');
    if (keep <= 0) return;
    const auto = this.list().filter((b) => b.name.endsWith('-auto'));
    for (const b of auto.slice(keep)) fs.rmSync(path.join(this.s.config.backupsDir, b.name), { recursive: true, force: true });
    // Sicherungen vor dem Löschen von Bereichen: die letzten zehn behalten
    const deletions = this.list().filter((b) => b.name.endsWith('-loeschung'));
    for (const b of deletions.slice(10)) fs.rmSync(path.join(this.s.config.backupsDir, b.name), { recursive: true, force: true });
  }

  private dirOf(name: string): string {
    if (!NAME_RE.test(name)) throw badRequest('Ungültiger Sicherungsname');
    const dir = path.join(this.s.config.backupsDir, name);
    if (!fs.existsSync(dir)) throw notFound('Sicherung nicht gefunden');
    return dir;
  }

  delete(auth: AuthContext, name: string): void {
    const dir = this.dirOf(name);
    fs.rmSync(dir, { recursive: true, force: true });
    this.s.emit(auth, { type: 'backup.deleted', target: { type: 'backup', id: name, label: name } });
  }

  zip(name: string): Readable {
    const dir = this.dirOf(name);
    return zipStream(walk(dir, name));
  }

  /** Wann die neueste Sicherung entstand (gleich welcher Art) – null, wenn es keine gibt. */
  newestAt(): Date | null {
    const times = this.list()
      .map((b) => Date.parse(b.createdAt))
      .filter((t) => Number.isFinite(t));
    return times.length ? new Date(Math.max(...times)) : null;
  }

  /**
   * Tägliche Sicherung, sobald die eingestellte Stunde erreicht ist und heute noch keine entstand.
   * Ein Fehlschlag wird festgehalten, bis wieder eine Sicherung gelingt – daraus entsteht die Warnung
   * an die Administration. Erneut versucht wird nach einer Stunde, nicht alle Viertelstunde.
   */
  async runScheduled(now = new Date()): Promise<'skipped' | 'done' | 'failed'> {
    if (!this.s.settings.get('backupEnabled')) return 'skipped';
    if (now.getHours() < this.s.settings.get('backupHour')) return 'skipped';
    const pad = (n: number) => String(n).padStart(2, '0');
    const today = `backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    if (this.list().some((b) => b.name.startsWith(today) && b.name.endsWith('-auto'))) return 'skipped';
    const failure = this.s.settings.getInternal<{ at: string; message: string } | null>(BACKUP_FAILURE_KEY, null);
    if (failure && now.getTime() - Date.parse(failure.at) < 3_600_000) return 'skipped';
    try {
      await this.create(null, 'auto');
      this.s.log.info('Automatische Sicherung erstellt');
      return 'done';
    } catch (err) {
      this.s.log.error({ err }, 'Automatische Sicherung fehlgeschlagen');
      this.s.settings.setInternal(BACKUP_FAILURE_KEY, { at: now.toISOString(), message: (err instanceof Error ? err.message : String(err)).slice(0, 300) });
      this.s.alerts.kick();
      return 'failed';
    }
  }

  schedule(): void {
    const tick = () => void this.runScheduled().catch((err) => this.s.log.error({ err }, 'Automatische Sicherung fehlgeschlagen'));
    this.timer = setInterval(tick, 15 * 60_000);
    this.timer.unref();
    setTimeout(tick, 60_000).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
