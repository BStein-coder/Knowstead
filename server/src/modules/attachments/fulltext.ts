/**
 * Volltextindex für Anhänge.
 *
 * Neue Dateien landen ohne Zutun im Index: Ein Hintergrundlauf sucht Anhänge
 * ohne Eintrag in `attachment_texts`, gewinnt den Text in einem Worker-Thread
 * und schreibt ihn in `attachments_fts`. Altformate (.doc, .xls, .ppt, .vsd)
 * werden – wenn LibreOffice eingerichtet ist – über die PDF-Umwandlung der
 * Vorschau gelesen. Die Suche filtert Treffer anschließend nach Leserechten.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { AttachmentRow } from '../../core/types.ts';
import { HttpError } from '../../core/errors.ts';
import { nowIso } from '../../db/database.ts';
import { kindFor, MAX_TEXT, tidy, type ExtractStatus } from './textract.ts';
import { findTesseract, isOcrImage, runTesseract, tesseractInfo } from './ocr.ts';

interface WorkerReply {
  id: number;
  status?: ExtractStatus;
  text?: string;
  files?: string[];
  error?: string;
}

const JOB_TIMEOUT_MS = 120_000;
const BATCH = 25;

export class AttachmentTextService {
  private readonly s: Services;
  private worker: Worker | null = null;
  private readonly waiting = new Map<number, { resolve: (r: WorkerReply) => void; timer: NodeJS.Timeout }>();
  private seq = 0;
  private processing: Promise<void> | null = null;
  private again = false;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  /** Aufruf von Tesseract – in Tests ersetzbar */
  ocrRunner: (bin: string, input: string, languages: string) => Promise<string> = runTesseract;

  constructor(s: Services) {
    this.s = s;
  }

  /** Eingerichtete Texterkennung oder `null`. */
  ocrConfig(): { bin: string; languages: string; maxPages: number } | null {
    const settings = this.s.settings.get('ocr');
    const bin = findTesseract(settings);
    return bin ? { bin, languages: settings.languages || 'deu+eng', maxPages: Math.max(1, Math.min(200, settings.maxPages || 30)) } : null;
  }

  /** Nach dem Einschalten: bisher nicht lesbare Bilder und textlose PDFs erneut indexieren. */
  requeueForOcr(): number {
    const rows = this.s.db.all<{ id: number; filename: string; mime_type: string; status: string }>(
      `SELECT a.id, a.filename, a.mime_type, t.status FROM attachment_texts t JOIN attachments a ON a.id = t.attachment_id
        WHERE t.status IN ('unsupported', 'empty', 'failed') AND t.method = 'text'`,
    );
    const ids = rows.filter((r) => isOcrImage(r.filename, r.mime_type) || kindFor(r.filename, r.mime_type) === 'pdf').map((r) => r.id);
    for (const id of ids) this.s.db.run('DELETE FROM attachment_texts WHERE attachment_id = ?', id);
    if (ids.length) this.kick();
    return ids.length;
  }

  /** Status für die Administration: Programm, Version, Sprachen. */
  async ocrStatus(auth: AuthContext) {
    this.s.perms.requireGlobal(auth, 'admin');
    const settings = this.s.settings.get('ocr');
    const bin = findTesseract({ ...settings, enabled: true });
    let info: { version: string; languages: string[] } | null = null;
    let error: string | null = null;
    if (bin) {
      try {
        info = await tesseractInfo(bin);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    const wanted = (settings.languages || 'deu+eng').split('+');
    return {
      enabled: settings.enabled,
      found: !!bin,
      path: bin,
      version: info?.version ?? null,
      languages: info?.languages ?? [],
      missingLanguages: info ? wanted.filter((l) => !info!.languages.includes(l)) : [],
      error,
      recognized: this.s.db.value<number>("SELECT COUNT(*) FROM attachment_texts WHERE method = 'ocr'") ?? 0,
    };
  }

  /** Neue Uploads sofort indexieren (auch ohne Zeitpläne, z. B. in Tests). */
  listen(): void {
    this.s.events.on('attachment.uploaded', () => this.kick());
    this.s.events.on('attachment.restored', () => this.kick());
  }

  /** Rückstand (z. B. nach dem Update) nach und nach abarbeiten. */
  schedule(): void {
    // Anhänge, deren Text nur deshalb fehlt, weil der Server keinen Worker starten konnte (Programmordner im
    // laufenden Betrieb ersetzt – „uv_cwd“), noch einmal versuchen: Die Datei war nicht das Problem.
    this.s.db.run("DELETE FROM attachment_texts WHERE status = 'failed' AND error LIKE '%uv_cwd%'");
    setTimeout(() => this.kick(), 15_000).unref();
    this.timer = setInterval(() => this.kick(), 10 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const [, job] of this.waiting) {
      clearTimeout(job.timer);
      job.resolve({ id: 0, error: 'Dienst beendet' });
    }
    this.waiting.clear();
    void this.worker?.terminate();
    this.worker = null;
  }

  kick(): void {
    if (this.stopped) return;
    setImmediate(() => void this.process());
  }

  /** Arbeitet alle noch nicht indexierten Anhänge ab. Parallele Aufrufe teilen sich einen Lauf. */
  process(): Promise<void> {
    if (this.processing) {
      this.again = true;
      return this.processing;
    }
    this.processing = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again && !this.stopped);
    })()
      .catch((err) => this.s.log.error({ err }, 'Anhangs-Index unterbrochen'))
      .finally(() => {
        this.processing = null;
      });
    return this.processing;
  }

  private async runOnce(): Promise<void> {
    for (let round = 0; round < 10_000 && !this.stopped; round++) {
      const rows = this.s.db.all<AttachmentRow>(
        `SELECT a.* FROM attachments a LEFT JOIN attachment_texts t ON t.attachment_id = a.id
          WHERE t.attachment_id IS NULL ORDER BY a.id DESC LIMIT ?`,
        BATCH,
      );
      if (!rows.length) return;
      for (const row of rows) {
        if (this.stopped) return;
        await this.index(row);
      }
    }
  }

  private workerInstance(): Worker {
    if (this.worker) return this.worker;
    this.s.program.prepareWorker();
    // Speichergrenze: Eine präparierte Datei bringt nur den Worker zum Absturz, nicht den Server
    const worker = new Worker(new URL('./extract-worker.ts', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 768 } });
    worker.unref();
    worker.on('message', (reply: WorkerReply) => {
      const job = this.waiting.get(reply.id);
      if (!job) return;
      clearTimeout(job.timer);
      this.waiting.delete(reply.id);
      job.resolve(reply);
    });
    worker.on('error', (err) => this.failAll(`Worker-Fehler: ${err.message}`));
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
      this.failAll('Worker beendet');
    });
    this.worker = worker;
    return worker;
  }

  private failAll(message: string): void {
    for (const [id, job] of this.waiting) {
      clearTimeout(job.timer);
      job.resolve({ id, error: message });
    }
    this.waiting.clear();
  }

  private extract(file: string, filename: string, mime: string): Promise<WorkerReply> {
    return this.post({ file, filename, mime });
  }

  private post(job: Record<string, unknown>): Promise<WorkerReply> {
    const id = ++this.seq;
    // Vor dem Auftrag: Lässt sich kein Worker starten (Programmordner entfernt), gibt es auch nichts abzuwarten
    const worker = this.workerInstance();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        // Hängende Datei: Worker neu starten, damit die übrigen weiterlaufen
        const stuck = this.worker;
        this.worker = null;
        void stuck?.terminate();
        resolve({ id, error: 'Zeitüberschreitung bei der Textgewinnung' });
      }, JOB_TIMEOUT_MS);
      this.waiting.set(id, { resolve, timer });
      worker.postMessage({ id, ...job });
    });
  }

  private async index(row: AttachmentRow): Promise<void> {
    const started = Date.now();
    const kind = kindFor(row.filename, row.mime_type);
    let result: WorkerReply = { id: 0, status: 'unsupported', text: '' };
    if (kind === 'legacy') {
      // Altformate nur mit LibreOffice (über die zwischengespeicherte PDF-Fassung)
      if (this.s.previews.converterPath()) {
        try {
          const pdf = await this.s.previews.pdfForRow(row);
          result = await this.extract(pdf.file, pdf.filename, 'application/pdf');
        } catch (err) {
          // Liegt es am Server statt an der Datei, bleibt sie für den nächsten Lauf offen
          if (err instanceof HttpError && err.code === 'restart_required') throw err;
          result = { id: 0, error: err instanceof Error ? err.message : String(err) };
        }
      }
    } else if (kind) {
      result = await this.extract(path.join(this.s.config.uploadsDir, row.storage_key), row.filename, row.mime_type);
    }
    // Texterkennung: Bilder und PDFs ohne (nennenswerte) Textebene
    let method: 'text' | 'ocr' = 'text';
    const ocr = this.ocrConfig();
    if (ocr && !result.error) {
      const scannedPdf = kind === 'pdf' && (result.text ?? '').replace(/\s+/g, '').length < 20;
      if (scannedPdf || (!kind && isOcrImage(row.filename, row.mime_type))) {
        const recognized = await this.recognize(row, ocr, kind === 'pdf');
        if (recognized.error) result = { id: 0, error: `Texterkennung: ${recognized.error}` };
        else {
          method = 'ocr';
          result = { id: 0, status: recognized.text ? 'done' : 'empty', text: recognized.text };
        }
      }
    }
    const text = result.error ? '' : (result.text ?? '');
    const status = result.error ? 'failed' : (result.status ?? 'unsupported');
    // Der Dateiname ist immer durchsuchbar, der Inhalt, soweit er sich lesen ließ.
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM attachments_fts WHERE rowid = ?', row.id);
      this.s.db.run('INSERT INTO attachments_fts (rowid, filename, body) VALUES (?, ?, ?)', row.id, row.filename.replace(/[._-]+/g, ' '), text);
      this.s.db.run(
        `INSERT INTO attachment_texts (attachment_id, status, chars, error, duration_ms, extracted_at, method) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(attachment_id) DO UPDATE SET status = excluded.status, chars = excluded.chars, error = excluded.error,
           duration_ms = excluded.duration_ms, extracted_at = excluded.extracted_at, method = excluded.method`,
        row.id,
        status,
        text.length,
        result.error?.slice(0, 500) ?? null,
        Date.now() - started,
        nowIso(),
        method,
      );
    });
    if (result.error) this.s.log.warn({ attachment: row.id, error: result.error }, 'Text aus Anhang nicht lesbar');
  }

  /** Text per Tesseract erkennen – ein Bild direkt, ein PDF über seine Seitenbilder. */
  private async recognize(row: AttachmentRow, ocr: { bin: string; languages: string; maxPages: number }, isPdf: boolean): Promise<{ text: string; error?: string }> {
    const source = path.join(this.s.config.uploadsDir, row.storage_key);
    try {
      if (!isPdf) return { text: tidy(await this.ocrRunner(ocr.bin, source, ocr.languages)) };
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-ocr-'));
      try {
        const reply = await this.post({ type: 'images', file: source, outDir: dir, maxPages: ocr.maxPages });
        if (reply.error) return { text: '', error: reply.error };
        let text = '';
        for (const file of reply.files ?? []) {
          if (this.stopped || text.length > MAX_TEXT) break;
          text += `${await this.ocrRunner(ocr.bin, file, ocr.languages)}\n\n`;
        }
        return { text: tidy(text) };
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (err) {
      return { text: '', error: err instanceof Error ? err.message : String(err) };
    }
  }

  /* ------------------------------ Verwaltung ------------------------------ */

  status(auth: AuthContext) {
    this.s.perms.requireGlobal(auth, 'admin');
    const total = this.s.db.value<number>('SELECT COUNT(*) FROM attachments') ?? 0;
    const counts = Object.fromEntries(
      this.s.db.all<{ status: string; n: number }>('SELECT status, COUNT(*) AS n FROM attachment_texts GROUP BY status').map((r) => [r.status, r.n]),
    ) as Record<string, number>;
    const indexed = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      total,
      pending: Math.max(0, total - indexed),
      done: counts.done ?? 0,
      empty: counts.empty ?? 0,
      unsupported: counts.unsupported ?? 0,
      failed: counts.failed ?? 0,
      office: !!this.s.previews.converterPath(),
      ocr: !!this.ocrConfig(),
      recognized: this.s.db.value<number>("SELECT COUNT(*) FROM attachment_texts WHERE method = 'ocr'") ?? 0,
      recentFailures: this.s.db.all<{ filename: string; error: string | null; extracted_at: string }>(
        `SELECT a.filename, t.error, t.extracted_at FROM attachment_texts t JOIN attachments a ON a.id = t.attachment_id
          WHERE t.status = 'failed' ORDER BY t.extracted_at DESC LIMIT 10`,
      ),
    };
  }

  /** Index verwerfen und neu aufbauen (Wartung). */
  reindexAll(): { queued: number } {
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM attachment_texts');
      this.s.db.run('DELETE FROM attachments_fts');
    });
    this.kick();
    return { queued: this.s.db.value<number>('SELECT COUNT(*) FROM attachments') ?? 0 };
  }
}
