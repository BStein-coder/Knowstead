/**
 * Vorschau von Office-Dateien (PowerPoint, Visio, Word, Excel …) als PDF.
 *
 * Browser können diese Formate nicht selbst darstellen. Ist auf dem Server
 * LibreOffice installiert, wandelt Knowstead die Datei beim ersten Aufruf in ein PDF
 * um und legt das Ergebnis im Datenverzeichnis ab (Schlüssel: SHA-256 der
 * Datei). Angezeigt wird die Vorschau dann mit dem eingebauten PDF-Betrachter.
 *
 * Sicherheit: Die Umwandlung läuft ohne Shell, mit eigenem Benutzerprofil,
 * Zeitlimit und Größenbegrenzung; Makros werden im Headless-Modus nicht
 * ausgeführt. Die Funktion ist standardmäßig ausgeschaltet.
 */
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { AttachmentRow } from '../../core/types.ts';
import { HttpError, badRequest, notFound } from '../../core/errors.ts';

/** Dateiendungen, die LibreOffice zuverlässig nach PDF umwandelt. */
export const OFFICE_EXTENSIONS = new Set([
  'ppt', 'pptx', 'pps', 'ppsx', 'odp',
  'doc', 'docx', 'odt', 'rtf',
  'xls', 'xlsx', 'ods',
  'vsd', 'vsdx', 'vdx',
]);

const MAX_SOURCE_BYTES = 60 * 1024 * 1024;
const TIMEOUT_MS = 90_000;
/** Gleichzeitige LibreOffice-Prozesse (je Prozess mehrere 100 MB Arbeitsspeicher) */
const MAX_PARALLEL = 2;

/** Nur LibreOffice selbst darf als Konverter eingetragen werden – nicht beliebige Programme. */
export const SOFFICE_NAME = /^soffice(\.exe|\.com|\.bin)?$/i;

/**
 * Benutzerprofil für die Umwandlung: Makros aus, Links aus nicht vertrauenswürdigen Dokumenten
 * (z. B. eingebettete Bilder von fremden Servern) blockieren – sonst könnte ein präpariertes
 * Dokument den Server Adressen im internen Netz abrufen lassen.
 */
const HARDENED_PROFILE = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
</oor:items>
`;

/** Übliche Installationsorte, falls kein Pfad eingetragen ist. */
const CANDIDATES =
  process.platform === 'win32'
    ? ['C:\\Program Files\\LibreOffice\\program\\soffice.exe', 'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe']
    : ['/usr/bin/soffice', '/usr/local/bin/soffice', '/usr/lib/libreoffice/program/soffice', '/opt/libreoffice/program/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'];

export function extensionOf(filename: string): string {
  return path.extname(filename).slice(1).toLowerCase();
}

export class PreviewService {
  private readonly s: Services;
  /** Laufende Umwandlungen je Prüfsumme – verhindert Doppelarbeit. */
  private readonly running = new Map<string, Promise<string>>();
  private active = 0;
  private readonly queue: (() => void)[] = [];

  constructor(s: Services) {
    this.s = s;
  }

  private dir(): string {
    const dir = path.join(this.s.config.dataDir, 'previews');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /** Pfad zu LibreOffice oder `null`. */
  converterPath(): string | null {
    const settings = this.s.settings.get('officePreview');
    if (!settings.enabled) return null;
    const configured = settings.sofficePath.trim();
    if (configured) return SOFFICE_NAME.test(path.basename(configured)) && fs.existsSync(configured) ? configured : null;
    return CANDIDATES.find((c) => fs.existsSync(c)) ?? null;
  }

  /** Wie lässt sich eine Datei im Browser anzeigen? */
  kindOf(filename: string, mimeType: string): 'pdf' | 'office' | null {
    if (mimeType === 'application/pdf' || extensionOf(filename) === 'pdf') return 'pdf';
    if (OFFICE_EXTENSIONS.has(extensionOf(filename)) && this.converterPath()) return 'office';
    return null;
  }

  /**
   * Liefert den Pfad zu einem PDF für den Anhang – bei PDFs die Datei selbst,
   * bei Office-Dateien die (zwischengespeicherte) Umwandlung.
   */
  async pdfFor(auth: AuthContext, attachmentId: number): Promise<{ file: string; filename: string }> {
    const row = this.s.attachments.require(attachmentId);
    this.s.pages.requireViewable(auth, row.page_id);
    return this.pdfForRow(row);
  }

  /** Wie `pdfFor`, aber ohne Rechteprüfung – nur für interne Dienste (z. B. Suchindex). */
  async pdfForRow(row: AttachmentRow): Promise<{ file: string; filename: string }> {
    const source = path.join(this.s.config.uploadsDir, row.storage_key);
    if (!fs.existsSync(source)) throw notFound('Die Datei ist nicht mehr vorhanden');
    const base = row.filename.replace(/\.[^.]+$/, '');
    const kind = this.kindOf(row.filename, row.mime_type);
    if (kind === 'pdf') return { file: source, filename: row.filename };
    if (!OFFICE_EXTENSIONS.has(extensionOf(row.filename))) throw badRequest('Für diesen Dateityp gibt es keine Vorschau');
    const soffice = this.converterPath();
    if (!soffice) {
      throw new HttpError(501, 'preview_unavailable', 'Die Office-Vorschau ist nicht eingerichtet (LibreOffice auf dem Server erforderlich).');
    }
    if (row.size > MAX_SOURCE_BYTES) throw badRequest('Die Datei ist für eine Vorschau zu groß (max. 60 MB)');

    const hash = row.sha256 || crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
    const target = path.join(this.dir(), `${hash}.pdf`);
    if (fs.existsSync(target)) return { file: target, filename: `${base}.pdf` };

    let job = this.running.get(hash);
    if (!job) {
      job = this.limited(() => this.convert(soffice, source, extensionOf(row.filename), target)).finally(() => this.running.delete(hash));
      this.running.set(hash, job);
    }
    await job;
    return { file: target, filename: `${base}.pdf` };
  }

  /** Höchstens MAX_PARALLEL Umwandlungen gleichzeitig, weitere warten. */
  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_PARALLEL) await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  private async convert(soffice: string, source: string, ext: string, target: string): Promise<string> {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-preview-'));
    const profile = path.join(work, 'profile');
    const input = path.join(work, `quelle.${ext.replace(/[^a-z0-9]/g, '')}`);
    try {
      fs.mkdirSync(path.join(profile, 'user'), { recursive: true });
      fs.writeFileSync(path.join(profile, 'user', 'registrymodifications.xcu'), HARDENED_PROFILE);
      fs.copyFileSync(source, input);
      await new Promise<void>((resolve, reject) => {
        execFile(
          soffice,
          [
            `-env:UserInstallation=${pathToFileURL(profile).href}`,
            '--headless',
            '--norestore',
            '--nolockcheck',
            '--nodefault',
            '--convert-to',
            'pdf',
            '--outdir',
            work,
            input,
          ],
          { timeout: TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
          (err, _stdout, stderr) => {
            if (err) reject(new Error(err.killed ? 'Zeitüberschreitung bei der Umwandlung' : stderr?.trim() || err.message));
            else resolve();
          },
        );
      });
      const produced = path.join(work, 'quelle.pdf');
      if (!fs.existsSync(produced)) throw new Error('LibreOffice hat kein PDF erzeugt');
      fs.copyFileSync(produced, target);
      return target;
    } catch (err) {
      throw new HttpError(502, 'preview_failed', `Die Vorschau konnte nicht erstellt werden: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      fs.rmSync(work, { recursive: true, force: true });
    }
  }

  /** Für die Administration: ist LibreOffice auffindbar? */
  status(auth: AuthContext): { enabled: boolean; path: string | null; cached: number } {
    this.s.perms.requireGlobal(auth, 'admin');
    const settings = this.s.settings.get('officePreview');
    let cached = 0;
    try {
      cached = fs.readdirSync(this.dir()).filter((f) => f.endsWith('.pdf')).length;
    } catch {
      /* Zwischenspeicher noch nicht angelegt */
    }
    return { enabled: settings.enabled, path: this.converterPath(), cached };
  }
}
