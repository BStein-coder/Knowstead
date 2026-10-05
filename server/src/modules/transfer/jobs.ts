/**
 * Hintergrundaufträge für Wiki-Importe. Große Wikis brauchen Minuten – der Upload
 * kehrt sofort zurück, die Oberfläche fragt den Fortschritt ab. Aufträge laufen
 * nacheinander, damit ein Import nicht den ganzen Server auslastet.
 */
import crypto from 'node:crypto';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { SpaceRow } from '../../core/types.ts';
import { HttpError, notFound } from '../../core/errors.ts';
import { nowIso } from '../../db/database.ts';
import { openUploads, type ReceivedUpload } from '../../core/archive-entries.ts';
import { WIKI_ARCHIVES, WikiImporter, parseWikiEntries, type WikiImportOptions, type WikiImportReport } from './wiki/importer.ts';

const KEEP_MS = 2 * 60 * 60 * 1000;

interface ImportJob {
  id: string;
  userId: number;
  space: { id: number; key: string; name: string };
  format: string;
  state: 'queued' | 'running' | 'done' | 'failed';
  phase: string;
  done: number;
  total: number;
  createdAt: string;
  finishedAt: string | null;
  report: WikiImportReport | null;
  error: string | null;
}

export type ImportJobDto = Omit<ImportJob, 'userId'>;

export class ImportJobService {
  private readonly s: Services;
  private readonly jobs = new Map<string, ImportJob>();
  private chain: Promise<void> = Promise.resolve();

  constructor(s: Services) {
    this.s = s;
  }

  /**
   * `upload` sind die Zwischendateien auf der Platte. Der Auftrag räumt sie weg, sobald er fertig ist – auch
   * nach einem Fehler. Lehnt `start` den Auftrag ab, bleibt das dem Aufrufer überlassen.
   */
  start(auth: AuthContext, space: SpaceRow, upload: ReceivedUpload, options: WikiImportOptions): ImportJobDto {
    const user = this.s.perms.requireUser(auth);
    this.s.perms.requireSpace(auth, space, 'create');
    this.cleanup();
    const open = [...this.jobs.values()].filter((j) => j.userId === user.id && (j.state === 'queued' || j.state === 'running'));
    if (open.length >= 2) throw new HttpError(429, 'import_busy', 'Es laufen bereits Importe für dich. Bitte warte, bis sie abgeschlossen sind.');
    const job: ImportJob = {
      id: crypto.randomUUID(),
      userId: user.id,
      space: { id: space.id, key: space.key, name: space.name },
      format: options.format,
      state: 'queued',
      phase: 'analyse',
      done: 0,
      total: 0,
      createdAt: nowIso(),
      finishedAt: null,
      report: null,
      error: null,
    };
    this.jobs.set(job.id, job);
    this.chain = this.chain.then(() => this.execute(job, auth, space, upload, options));
    return this.dto(job);
  }

  /** Wartet auf alle laufenden Aufträge (Tests, geordnetes Herunterfahren). */
  idle(): Promise<void> {
    return this.chain;
  }

  get(auth: AuthContext, id: string): ImportJobDto {
    const user = this.s.perms.requireUser(auth);
    const job = this.jobs.get(id);
    if (!job || (job.userId !== user.id && !auth.isAdmin)) throw notFound('Import nicht gefunden');
    return this.dto(job);
  }

  private async execute(job: ImportJob, auth: AuthContext, space: SpaceRow, upload: ReceivedUpload, options: WikiImportOptions): Promise<void> {
    job.state = 'running';
    let entries: ReturnType<typeof openUploads> | null = null;
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      // Die Einträge bleiben bis zum Schluss offen: Mediendateien liest der Importer erst beim Anhängen
      entries = openUploads(upload.files, { archives: WIKI_ARCHIVES });
      const parsed = await parseWikiEntries(entries, options, upload.dir);
      job.format = parsed.format;
      job.total = parsed.documents.length;
      const importer = new WikiImporter(this.s, auth, space, (phase, done, total) => {
        job.phase = phase;
        job.done = done;
        job.total = total;
      });
      job.report = await importer.run(parsed, options);
      job.state = 'done';
      job.phase = 'done';
      this.s.notifications.push({
        userId: job.userId,
        type: 'import.done',
        title: `Import abgeschlossen: ${job.report.pages} Seiten`,
        body: `${space.name} – ${job.report.attachments} Anhänge, ${job.report.revisions} ältere Versionen`,
        link: job.report.root[0]?.url ?? `/s/${encodeURIComponent(space.key)}`,
        spaceId: space.id,
      });
    } catch (err) {
      job.state = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      if (!(err instanceof HttpError)) this.s.log.error({ err }, 'Wiki-Import fehlgeschlagen');
    } finally {
      entries?.close();
      upload.cleanup();
      job.finishedAt = nowIso();
    }
  }

  private cleanup(): void {
    const limit = Date.now() - KEEP_MS;
    for (const [id, job] of this.jobs) if (job.finishedAt && Date.parse(job.finishedAt) < limit) this.jobs.delete(id);
  }

  private dto(job: ImportJob): ImportJobDto {
    const { userId: _userId, ...rest } = job;
    return structuredClone(rest);
  }
}
