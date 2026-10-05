/**
 * Dokument-Export (PDF und Word) nach der Firmenvorlage.
 *
 * Seiten werden im Hauptthread aufbereitet (Leserechte, statische Makros,
 * Anhangsbilder); das Setzen des Dokuments übernimmt ein Worker-Thread, damit
 * große Exporte andere Anfragen nicht aufhalten.
 */
import { Worker } from 'node:worker_threads';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { AttachmentRow, PageRow, SpaceRow } from '../../core/types.ts';
import { badRequest, HttpError } from '../../core/errors.ts';
import { safeName } from '../transfer/service.ts';
import { htmlToBlocks, minHeadingLevel, shiftHeadings, type ExportChapter, type ExportDocument, type ExportTemplate, type ModelContext } from './model.ts';
import { formatDay, type Locale } from '../../core/i18n.ts';

export type DocumentFormat = 'pdf' | 'docx';

export const MAX_EXPORT_PAGES = 300;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 150 * 1024 * 1024;
const RENDER_TIMEOUT_MS = 180_000;

export const DOCUMENT_TYPES: Record<DocumentFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

interface Pending {
  worker: Worker;
  resolve: (data: Buffer) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

export interface DocumentOptions {
  format: DocumentFormat;
  children?: boolean;
  cover?: boolean;
  toc?: boolean;
}

export class ExportService {
  private readonly s: Services;
  private worker: Worker | null = null;
  private readonly waiting = new Map<number, Pending>();
  /** laufende Exporte je Benutzer */
  private readonly running = new Map<string, number>();
  private seq = 0;

  constructor(s: Services) {
    this.s = s;
  }

  template(): ExportTemplate {
    return this.s.settings.get('exportTemplate');
  }

  /** Seite (optional mit allen sichtbaren Unterseiten) als PDF oder Word-Dokument. */
  async pageDocument(auth: AuthContext, pageId: number, options: DocumentOptions, locale: Locale = 'de'): Promise<{ filename: string; contentType: string; body: Buffer }> {
    const { page, space } = this.s.pages.requireAccess(auth, pageId, 'export');
    const entries: { page: PageRow; level: number }[] = [{ page, level: 1 }];
    if (options.children) this.collect(auth, page, space, 2, entries);
    const tpl: ExportTemplate = { ...this.template() };
    if (options.cover !== undefined) tpl.coverPage = options.cover;
    if (options.toc !== undefined) tpl.toc = options.toc;

    const key = auth.user ? `user:${auth.user.id}` : `ip:${auth.ip}`;
    const active = this.running.get(key) ?? 0;
    if (active >= 2) throw new HttpError(429, 'export_busy', 'Es laufen bereits zwei Exporte für dich. Bitte warte, bis sie fertig sind.');
    this.running.set(key, active + 1);
    let body: Buffer;
    try {
      const doc = { ...(await this.buildDocument(auth, page, space, entries, tpl.coverPage, locale)), locale };
      body = await this.render(options.format, doc, tpl);
    } finally {
      const left = (this.running.get(key) ?? 1) - 1;
      if (left > 0) this.running.set(key, left);
      else this.running.delete(key);
    }
    this.s.emit(auth, {
      type: 'page.exported',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'page', id: page.id, label: page.title },
      data: { format: options.format, pages: entries.length },
    });
    return { filename: `${safeName(page.title)}.${options.format}`, contentType: DOCUMENT_TYPES[options.format], body };
  }

  /** Musterdokument für die Vorschau in der Administration (mit ungespeicherter Vorlage). */
  async sample(auth: AuthContext, format: DocumentFormat, tpl: ExportTemplate): Promise<{ filename: string; contentType: string; body: Buffer }> {
    this.s.perms.requireGlobal(auth, 'admin');
    const ctx: ModelContext = { baseUrl: this.s.config.baseUrl, attachmentImage: () => null };
    // In der Sprache, in der die Administration gerade arbeitet
    const locale: Locale = auth.locale ?? this.s.settings.get('defaultLocale');
    const text = SAMPLE_TEXT[locale];
    const blocks = htmlToBlocks(text.html, ctx);
    const doc: ExportDocument = {
      locale,
      title: text.title,
      subtitle: text.subtitle,
      author: auth.user?.displayName ?? '',
      owner: auth.user?.displayName ?? '',
      date: formatDay(new Date(), locale),
      version: 'Version 1',
      chapters: [
        { title: text.title, level: 1, blocks },
        { title: text.child, level: 2, blocks: htmlToBlocks(text.childHtml, ctx) },
      ],
    };
    const body = await this.render(format, doc, tpl);
    return { filename: `${text.title}.${format}`, contentType: DOCUMENT_TYPES[format], body };
  }

  stop(): void {
    for (const [, job] of this.waiting) {
      clearTimeout(job.timer);
      job.reject(new HttpError(503, 'export_stopped', 'Der Export wurde abgebrochen'));
    }
    this.waiting.clear();
    void this.worker?.terminate();
    this.worker = null;
  }

  private collect(auth: AuthContext, parent: PageRow, space: SpaceRow, level: number, out: { page: PageRow; level: number }[]): void {
    const kids = this.s.pages.children(auth, parent.id === space.home_page_id ? null : parent.id, space);
    for (const kid of kids) {
      if (out.length >= MAX_EXPORT_PAGES) {
        throw badRequest(`Zu viele Seiten für einen Dokument-Export (höchstens ${MAX_EXPORT_PAGES}). Bitte einen kleineren Teilbaum exportieren.`);
      }
      out.push({ page: kid, level });
      if (level < 50) this.collect(auth, kid, space, level + 1, out);
    }
  }

  private async buildDocument(auth: AuthContext, page: PageRow, space: SpaceRow, entries: { page: PageRow; level: number }[], cover: boolean, locale: Locale): Promise<ExportDocument> {
    let budget = MAX_TOTAL_IMAGE_BYTES;
    const images = new Map<number, { data: Buffer; mime: string } | null>();
    const ctx: ModelContext = {
      baseUrl: this.s.config.baseUrl,
      attachmentImage: (id) => {
        if (!images.has(id)) {
          const image = this.loadImage(auth, id, budget);
          if (image) budget -= image.data.length;
          images.set(id, image);
        }
        return images.get(id) ?? null;
      },
    };
    const chapters: ExportChapter[] = [];
    for (const entry of entries) {
      const html = await this.s.transfer.renderStatic(auth, entry.page, space);
      const blocks = htmlToBlocks(html, ctx);
      // Überschriften im Inhalt unter die Kapitelüberschrift einordnen (Seitentitel = Ebene 1, Unterseiten = 2, 3 …)
      const titled = entries.length > 1 || !cover;
      const chapterLevel = entries.length > 1 ? Math.min(entry.level, 3) : 1;
      const min = minHeadingLevel(blocks);
      const shift = titled && min ? Math.max(0, chapterLevel + 1 - min) : 0;
      chapters.push({ title: entry.page.title, level: entry.level, blocks: shiftHeadings(blocks, shift) });
    }
    const users = this.s.users.refs([page.updated_by, page.owner_id]);
    return {
      title: page.title,
      subtitle: space.name,
      author: users.get(page.updated_by ?? 0)?.displayName ?? '',
      owner: users.get(page.owner_id ?? 0)?.displayName ?? '',
      date: formatDay(page.updated_at, locale),
      version: `Version ${page.version}`,
      chapters,
    };
  }

  /** Bild eines Anhangs – nur wenn die exportierende Person die zugehörige Seite sehen darf. */
  private loadImage(auth: AuthContext, id: number, budget: number): { data: Buffer; mime: string } | null {
    const row = this.s.db.get<AttachmentRow>('SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL', id);
    if (!row || !row.mime_type.startsWith('image/') || row.size > Math.min(MAX_IMAGE_BYTES, budget)) return null;
    const page = this.s.pages.get(row.page_id);
    const space = page ? this.s.spaces.get(page.space_id) : undefined;
    if (!page || !space || page.deleted_at || !this.s.perms.canViewPage(auth, page, space)) return null;
    const data = this.s.attachments.readFile(row);
    return data ? { data, mime: row.mime_type } : null;
  }

  private instance(): Worker {
    if (this.worker) return this.worker;
    this.s.program.prepareWorker();
    const worker = new Worker(new URL('./render-worker.ts', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 1024 } });
    worker.unref();
    worker.on('message', (reply: { id: number; data?: Uint8Array; error?: string }) => {
      const job = this.waiting.get(reply.id);
      if (!job) return;
      clearTimeout(job.timer);
      this.waiting.delete(reply.id);
      if (reply.data) job.resolve(Buffer.from(reply.data.buffer, reply.data.byteOffset, reply.data.byteLength));
      else job.reject(new HttpError(500, 'export_failed', `Das Dokument konnte nicht erstellt werden: ${reply.error ?? 'unbekannter Fehler'}`));
    });
    worker.on('error', (err) => this.failAll(worker, `Export-Worker: ${err.message}`));
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = null;
      this.failAll(worker, 'Export-Worker beendet');
    });
    this.worker = worker;
    return worker;
  }

  /** Offene Aufträge eines abgestürzten oder beendeten Workers abbrechen. */
  private failAll(worker: Worker, message: string): void {
    for (const [id, job] of this.waiting) {
      if (job.worker !== worker) continue;
      clearTimeout(job.timer);
      this.waiting.delete(id);
      job.reject(new HttpError(500, 'export_failed', message));
    }
  }

  private render(format: DocumentFormat, doc: ExportDocument, tpl: ExportTemplate): Promise<Buffer> {
    const id = ++this.seq;
    const worker = this.instance();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        // Hängender Auftrag: Worker neu starten, weitere Aufträge auf ihm scheitern mit Hinweis
        if (this.worker === worker) this.worker = null;
        void worker.terminate();
        reject(new HttpError(504, 'export_timeout', 'Der Export hat zu lange gedauert. Bitte weniger Seiten auf einmal exportieren.'));
      }, RENDER_TIMEOUT_MS);
      this.waiting.set(id, { worker, resolve, reject, timer });
      worker.postMessage({ id, format, doc, tpl });
    });
  }
}

/** Musterdokument für die Vorschau der Export-Vorlage – je Sprache der Oberfläche. */
const SAMPLE_TEXT: Record<Locale, { title: string; subtitle: string; child: string; childHtml: string; html: string }> = {
  de: {
    title: 'Musterdokument',
    subtitle: 'Bereich „Beispiel“',
    child: 'Unterseite',
    childHtml: '<p>Unterseiten folgen als eigene Kapitel.</p>',
    html: `
      <p>Dieses Musterdokument zeigt, wie Exporte mit der aktuellen Vorlage aussehen: Deckblatt, Inhaltsverzeichnis sowie Kopf- und Fußzeile.</p>
      <h2>Überschriften und Text</h2>
      <p>Absätze mit <strong>fetter</strong>, <em>kursiver</em> und <a href="https://example.org">verlinkter</a> Schrift sowie <code>Inline-Code</code>.</p>
      <ul><li><p>Aufzählungspunkt</p></li><li><p>Noch ein Punkt</p><ul><li><p>Unterpunkt</p></li></ul></li></ul>
      <ol><li><p>Erster Schritt</p></li><li><p>Zweiter Schritt</p></li></ol>
      <div data-type="callout" data-variant="info"><p>Hinweisboxen bleiben als farbige Kästen erhalten.</p></div>
      <h2>Tabellen</h2>
      <table><tbody><tr><th><p>System</p></th><th><p>Verantwortlich</p></th><th><p>Nächste Prüfung</p></th></tr>
      <tr><td><p>Ticketsystem</p></td><td><p>IT-Service</p></td><td><p>03/2027</p></td></tr>
      <tr><td><p>Intranet</p></td><td><p>Kommunikation</p></td><td><p>06/2027</p></td></tr></tbody></table>
      <h3>Codebeispiel</h3>
      <pre><code class="language-bash">systemctl status knowstead</code></pre>`,
  },
  en: {
    title: 'Sample document',
    subtitle: 'Space “Example”',
    child: 'Child page',
    childHtml: '<p>Child pages follow as chapters of their own.</p>',
    html: `
      <p>This sample document shows what exports look like with the current template: cover page, table of contents, header and footer.</p>
      <h2>Headings and text</h2>
      <p>Paragraphs with <strong>bold</strong>, <em>italic</em> and <a href="https://example.org">linked</a> text and <code>inline code</code>.</p>
      <ul><li><p>Bullet point</p></li><li><p>Another point</p><ul><li><p>Sub-item</p></li></ul></li></ul>
      <ol><li><p>First step</p></li><li><p>Second step</p></li></ol>
      <div data-type="callout" data-variant="info"><p>Callouts are kept as coloured boxes.</p></div>
      <h2>Tables</h2>
      <table><tbody><tr><th><p>System</p></th><th><p>Owner</p></th><th><p>Next review</p></th></tr>
      <tr><td><p>Ticket system</p></td><td><p>IT service</p></td><td><p>03/2027</p></td></tr>
      <tr><td><p>Intranet</p></td><td><p>Communications</p></td><td><p>06/2027</p></td></tr></tbody></table>
      <h3>Code example</h3>
      <pre><code class="language-bash">systemctl status knowstead</code></pre>`,
  },
};
