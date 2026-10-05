/**
 * Legt die Ergebnisse der Wiki-Konverter als Knowstead-Seiten an: Hierarchie (inklusive
 * Ordnerseiten für Ebenen ohne eigene Seite), Stichwörter, Versionsgeschichte,
 * Anhänge und – in einem zweiten Durchlauf – interne Verweise.
 */
import path from 'node:path';
import { parse, type HTMLElement } from 'node-html-parser';
import type { Services } from '../../../services.ts';
import type { AuthContext } from '../../../core/permissions.ts';
import type { SpaceRow } from '../../../core/types.ts';
import { badRequest } from '../../../core/errors.ts';
import { translate, type Locale } from '../../../core/i18n.ts';
import type { ArchiveEntries } from '../../../core/archive-entries.ts';
import { pageUrl } from '../../pages/service.ts';
import { escapeHtml, type WikiDocument, type WikiParseResult } from './common.ts';
import { fileDump, isMediaWikiDump, parseMediaWiki } from './mediawiki.ts';
import { isDokuWikiArchive, parseDokuWiki } from './dokuwiki.ts';
import { isXWikiArchive, parseXWiki } from './xwiki.ts';
import { isConfluenceArchive, parseConfluence } from './confluence.ts';

export type WikiFormat = 'mediawiki' | 'dokuwiki' | 'xwiki' | 'confluence';

export interface WikiImportOptions {
  format: WikiFormat | 'auto';
  parentId: number | null;
  history: boolean;
  /** Sprache für Datumsangaben, die ein Konverter als Text in den Inhalt schreibt (Standard: Deutsch) */
  locale?: Locale;
}

export interface WikiImportReport {
  format: WikiFormat;
  pages: number;
  folders: number;
  attachments: number;
  revisions: number;
  unresolvedLinks: number;
  missingMedia: string[];
  unusedMedia: number;
  skipped: { title: string; reason: string }[];
  warnings: string[];
  root: { id: number; title: string; url: string }[];
}

export type ProgressFn = (phase: 'analyse' | 'pages' | 'media' | 'links', done: number, total: number) => void;

const MAX_REVISIONS = 50;
const MAX_DOCUMENTS = 20000;
const TEXT = new TextDecoder('utf-8');
const FORMAT_NAMES: Record<WikiFormat, string> = { mediawiki: 'MediaWiki', dokuwiki: 'DokuWiki', xwiki: 'XWiki', confluence: 'Confluence' };

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Hinweise, die die Konverter in den Inhalt schreiben („… wurde nicht übernommen“). In einer englischsprachigen
 * Installation stünden sie sonst auf Deutsch mitten in den importierten Seiten.
 */
const IMPORT_NOTES_EN: [RegExp, string][] = [
  [/Confluence-Makro „unbekannt“ wurde nicht übernommen\./g, 'Confluence macro “unknown” was not imported.'],
  [/Confluence-Makro „([^“<]*)“ wurde nicht übernommen\./g, 'Confluence macro “$1” was not imported.'],
  [/Jira-Abfrage aus Confluence \(nicht übernommen\)/g, 'Jira query from Confluence (not imported)'],
  [/<em>Eingebunden aus Confluence: /g, '<em>Included from Confluence: '],
  [/<em>Eingebunden: <a /g, '<em>Included: <a '],
  [/\[Plugin ([^\]<]*) nicht übernommen\]/g, '[plugin $1 not imported]'],
  [/\[Vorlage „([^“<\]]*)“ nicht übernommen\]/g, '[template “$1” not imported]'],
  [/\[Makro „([^“<\]]*)“ nicht übernommen\]/g, '[macro “$1” not imported]'],
];

export function localizeImportNotes(html: string, locale: Locale): string {
  if (locale !== 'en') return html;
  let out = html;
  for (const [pattern, replacement] of IMPORT_NOTES_EN) out = out.replace(pattern, replacement);
  return out;
}

/** Welche hochgeladenen Dateien Archive sind, deren Einträge einzeln zählen */
export const WIKI_ARCHIVES = /\.(zip|xar)$/i;

/**
 * Format erkennen und umwandeln. Die Einträge bleiben auf der Platte: Texte werden einzeln gelesen, der
 * MediaWiki-Dump Seite für Seite, Mediendateien erst beim Anhängen – `entries` muss deshalb offen bleiben,
 * bis der Import durch ist. `tempDir` nimmt einen Dump auf, der aus einem Archiv entpackt werden muss.
 */
export async function parseWikiEntries(entries: ArchiveEntries, options: WikiImportOptions, tempDir: string): Promise<WikiParseResult> {
  const names = entries.names();
  if (!names.length) throw badRequest('Keine Dateien übermittelt');

  const dumps = names.filter((n) => /\.xml$/i.test(n) && isMediaWikiDump(TEXT.decode(entries.head(n, 4000))));
  let format = options.format;
  if (format === 'auto') {
    if (dumps.length) format = 'mediawiki';
    else if (isConfluenceArchive(entries)) format = 'confluence';
    else if (isXWikiArchive(entries)) format = 'xwiki';
    else if (isDokuWikiArchive(names)) format = 'dokuwiki';
    else throw badRequest('Das Format wurde nicht erkannt. Erwartet: MediaWiki-XML-Dump, DokuWiki-Datenordner als ZIP, XWiki-XAR oder Confluence-Export (XML oder HTML) als ZIP.');
  }

  try {
    if (format === 'mediawiki') {
      if (!dumps.length) throw new Error('Kein MediaWiki-XML-Dump gefunden (Spezial:Exportieren bzw. dumpBackup.php)');
      const media = new Map<string, () => Uint8Array>();
      for (const name of names) {
        if (/\.xml$/i.test(name) || /(^|\/)(thumb|archive|deleted|temp|lockdir)\//i.test(name)) continue;
        media.set(path.posix.basename(name), () => entries.read(name));
      }
      const result = parseMediaWiki(fileDump(await entries.materialize(dumps[0], tempDir)), media, { history: options.history, maxRevisions: MAX_REVISIONS });
      if (dumps.length > 1) result.warnings.push(`Mehrere XML-Dumps gefunden – übernommen wurde ${dumps[0]}`);
      return result;
    }
    if (format === 'dokuwiki') return parseDokuWiki(entries, { history: options.history, maxRevisions: MAX_REVISIONS });
    if (format === 'confluence') return parseConfluence(entries, { history: options.history, maxRevisions: MAX_REVISIONS, locale: options.locale });
    return parseXWiki(entries);
  } catch (err) {
    if (err instanceof Error && !('status' in err)) throw badRequest(err.message);
    throw err;
  }
}

export class WikiImporter {
  private readonly s: Services;
  private readonly auth: AuthContext;
  private readonly space: SpaceRow;
  private readonly progress: ProgressFn;

  constructor(s: Services, auth: AuthContext, space: SpaceRow, progress: ProgressFn = () => undefined) {
    this.s = s;
    this.auth = auth;
    this.space = space;
    this.progress = progress;
  }

  async run(parsed: WikiParseResult, options: WikiImportOptions): Promise<WikiImportReport> {
    const { s, auth, space } = this;
    s.perms.requireSpace(auth, space, 'create');
    const user = s.perms.requireUser(auth);
    // Was der Import selbst in die Seiten schreibt, folgt der Sprache der Installation
    const locale = s.settings.get('defaultLocale');
    const text = (german: string) => translate(german, locale);
    if (parsed.documents.length > MAX_DOCUMENTS) throw badRequest(`Zu viele Seiten für einen Import (höchstens ${MAX_DOCUMENTS})`);
    if (!parsed.documents.length) throw badRequest('Das Archiv enthält keine übernehmbaren Seiten');
    if (options.parentId) {
      const parent = s.pages.get(options.parentId);
      if (!parent || parent.space_id !== space.id || parent.deleted_at) throw badRequest('Die Zielseite gehört nicht zu diesem Bereich');
    }

    const report: WikiImportReport = {
      format: parsed.format,
      pages: 0,
      folders: 0,
      attachments: 0,
      revisions: 0,
      unresolvedLinks: 0,
      missingMedia: [],
      unusedMedia: 0,
      skipped: parsed.skipped.slice(0, 200),
      warnings: parsed.warnings.slice(0, 200),
      root: [],
    };
    const source = FORMAT_NAMES[parsed.format];
    const docs = new Map<string, WikiDocument>(parsed.documents.map((d) => [d.key, d]));
    const created = new Map<string, { id: number; title: string }>();
    // Was als Inhalt gespeichert wurde – darauf setzt das Auflösen der Verweise auf, nicht auf dem Original
    const stored = new Map<string, string>();
    const users = new Map<string, number | null>();
    const userId = (name: string | null) => {
      if (!name) return null;
      if (!users.has(name)) users.set(name, s.users.byUsername(name)?.id ?? s.users.byUsername(name.toLowerCase())?.id ?? null);
      return users.get(name) ?? null;
    };
    const note = (text: string, author: string | null) => {
      const who = author && !userId(author) ? ` (Autor in ${source}: ${author})` : '';
      return `${text || `Importiert aus ${source}`}${who}`.slice(0, 500);
    };

    /* ---------- 1. Seiten und Ordner anlegen ---------- */
    // Reihenfolge aus der Quelle (falls bekannt), sonst alphabetisch
    const order = [...parsed.documents].sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title, 'de'));
    const total = order.length + parsed.folders.size;
    let done = 0;
    const creating = new Set<string>();

    const ensure = async (key: string): Promise<number | null> => {
      const existing = created.get(key);
      if (existing) return existing.id;
      const doc = docs.get(key);
      const folder = parsed.folders.get(key);
      if ((!doc && !folder) || creating.has(key)) return options.parentId;
      creating.add(key);
      const parentKey = doc ? doc.parentKey : folder!.parentKey;
      const parentId = parentKey && parentKey !== key ? await ensure(parentKey) : options.parentId;
      const title = (doc ? doc.title : folder!.title).slice(0, 255) || text('Importierte Seite');
      let content = doc ? localizeImportNotes(doc.html, locale) : '<div data-type="children" data-depth="1"></div>';
      if (Buffer.byteLength(content, 'utf8') > 4.5 * 1024 * 1024) {
        report.warnings.push(`${title}: Inhalt zu groß – nur ein Hinweis übernommen`);
        content = `<p><em>${escapeHtml(text(`Der Inhalt dieser Seite war für den Import zu groß (${source}).`))}</em></p>`;
      }
      if (doc) stored.set(key, content);
      const page = await s.pages.create(auth, {
        spaceId: space.id,
        parentId,
        title,
        content,
        labels: doc?.labels ?? [],
        changeNote: `Importiert aus ${source}`,
        silent: true,
        watch: false,
      });
      created.set(key, { id: page.id, title: page.title });
      if (parentId === options.parentId && report.root.length < 20) report.root.push({ id: page.id, title: page.title, url: pageUrl(space.key, page.id, page.title) });
      if (doc) {
        report.pages++;
        const history = doc.revisions.map((r) => ({ title: r.title || title, content: localizeImportNotes(r.html, locale), authorId: userId(r.author) ?? user.id, changeNote: note(r.comment, r.author), createdAt: r.timestamp }));
        report.revisions += history.length;
        s.pages.importHistory(page.id, history, {
          authorId: userId(doc.author) ?? user.id,
          changeNote: note(doc.revisions.length ? '' : `Importiert aus ${source}`, doc.author),
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        });
      } else report.folders++;
      done++;
      if (done % 20 === 0) {
        this.progress('pages', done, total);
        await tick();
      }
      return page.id;
    };
    for (const doc of order) await ensure(doc.key);
    for (const key of parsed.folders.keys()) await ensure(key);
    this.progress('pages', total, total);

    const resolveKey = (key: string) => {
      let current = key;
      for (let i = 0; i < 5 && !created.has(current) && parsed.aliases.has(current); i++) current = parsed.aliases.get(current)!;
      return created.get(current) ?? null;
    };

    /* ---------- 2. Mediendateien ---------- */
    const referenced = new Map<string, string>(); // Medienschlüssel → erster verweisender Dokumentschlüssel
    for (const doc of order) {
      const texts = [doc.html, ...doc.revisions.map((r) => r.html)];
      for (const text of texts) {
        for (const m of text.matchAll(/\/__media\/([A-Za-z0-9%._~!*'()-]+)/g)) {
          const key = safeDecode(m[1]);
          if (!referenced.has(key)) referenced.set(key, doc.key);
        }
      }
    }
    const referencedLoose = new Map<string, string>();
    for (const [mediaKey, docKey] of referenced) if (!referencedLoose.has(mediaKey.toLowerCase())) referencedLoose.set(mediaKey.toLowerCase(), docKey);
    const mediaIndex = new Map<string, string>();
    for (const key of parsed.media.keys()) mediaIndex.set(key.toLowerCase(), key);
    const attachmentIds = new Map<string, number>();
    let mediaDone = 0;
    const mediaTotal = parsed.media.size;
    for (const [key, file] of parsed.media) {
      // Anhang gehört zur eigenen Seite (DokuWiki-Namensraum, XWiki) oder zur ersten Seite, die ihn verwendet
      const referencingDoc = referenced.get(key) ?? referencedLoose.get(key.toLowerCase()) ?? null;
      const ownerPage = (file.ownerKey && resolveKey(file.ownerKey)) || (referencingDoc ? resolveKey(referencingDoc) : null);
      if (!ownerPage) {
        report.unusedMedia++;
        continue;
      }
      // Der Inhalt kommt erst jetzt von der Platte – eine Datei, die sich nicht lesen lässt, hält den Rest nicht auf
      let data: Uint8Array;
      try {
        data = file.data;
      } catch (err) {
        if (report.warnings.length < 200) report.warnings.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      const row = s.attachments.storeBuffer(ownerPage.id, file.name, data, user.id);
      attachmentIds.set(key, row.id);
      report.attachments++;
      if (++mediaDone % 20 === 0) {
        this.progress('media', mediaDone, mediaTotal);
        await tick();
      }
    }
    s.attachmentText.kick();
    const attachmentFor = (raw: string): number | null => {
      const key = safeDecode(raw);
      const exact = attachmentIds.get(key);
      if (exact) return exact;
      const loose = mediaIndex.get(key.toLowerCase());
      return loose ? (attachmentIds.get(loose) ?? null) : null;
    };

    /* ---------- 3. Verweise auflösen ---------- */
    const missing = new Set<string>();
    const resolveHtml = (html: string): string => {
      if (!html.includes('/__wiki/') && !html.includes('/__media/')) return html;
      const root = parse(html);
      for (const a of root.querySelectorAll('a[href]') as HTMLElement[]) {
        const href = a.getAttribute('href') ?? '';
        const wiki = href.match(/^\/__wiki\/([^#]+)(?:#(.*))?$/);
        if (wiki) {
          const target = resolveKey(safeDecode(wiki[1]));
          if (target) a.setAttribute('href', `${pageUrl(space.key, target.id, target.title)}${wiki[2] ? `#${safeDecode(wiki[2])}` : ''}`);
          else {
            report.unresolvedLinks++;
            a.replaceWith(`<span class="knowstead-missing-link" title="${escapeHtml(text('Seite nicht im Import enthalten'))}">${a.innerHTML}</span>`);
          }
          continue;
        }
        const media = href.match(/^\/__media\/(.+)$/);
        if (media) {
          const id = attachmentFor(media[1]);
          if (id) a.setAttribute('href', `/api/v1/attachments/${id}/raw?download=1`);
          else {
            missing.add(safeDecode(media[1]));
            a.replaceWith(`<span class="knowstead-missing-link" title="${escapeHtml(text('Datei nicht im Import enthalten'))}">${a.innerHTML}</span>`);
          }
        }
      }
      for (const img of root.querySelectorAll('img[src]') as HTMLElement[]) {
        const media = (img.getAttribute('src') ?? '').match(/^\/__media\/(.+)$/);
        if (!media) continue;
        const id = attachmentFor(media[1]);
        if (id) img.setAttribute('src', `/api/v1/attachments/${id}/raw`);
        else {
          missing.add(safeDecode(media[1]));
          img.replaceWith(`<em>${escapeHtml(text(`[Bild fehlt: ${safeDecode(media[1])}]`))}</em>`);
        }
      }
      for (const gallery of root.querySelectorAll('div[data-type="gallery"]') as HTMLElement[]) {
        try {
          const items = JSON.parse(gallery.getAttribute('data-items') ?? '[]') as { src: string; alt: string; caption: string; attachmentId?: number }[];
          const next = items.flatMap((item) => {
            const media = item.src.match(/^\/__media\/(.+)$/);
            if (!media) return [item];
            const id = attachmentFor(media[1]);
            if (!id) {
              missing.add(safeDecode(media[1]));
              return [];
            }
            return [{ ...item, src: `/api/v1/attachments/${id}/raw`, attachmentId: id }];
          });
          gallery.setAttribute('data-items', JSON.stringify(next));
        } catch {
          gallery.remove();
        }
      }
      return root.toString();
    };

    let linkDone = 0;
    for (const doc of order) {
      const page = created.get(doc.key);
      if (!page) continue;
      // Ausgangspunkt ist, was Schritt 1 gespeichert hat: mit übersetzten Hinweisen – und bei einer zu großen
      // Seite nur der Hinweis darauf, nicht doch wieder der ganze Inhalt
      const original = stored.get(doc.key) ?? doc.html;
      stored.delete(doc.key);
      const html = resolveHtml(original);
      if (html !== original) s.pages.replaceContentInPlace(page.id, html);
      if (doc.revisions.length) {
        for (const r of s.db.all<{ version: number; content: string }>("SELECT version, content FROM page_revisions WHERE page_id = ? AND (content LIKE '%/\\_\\_wiki/%' ESCAPE '\\' OR content LIKE '%/\\_\\_media/%' ESCAPE '\\')", page.id)) {
          s.db.run('UPDATE page_revisions SET content = ? WHERE page_id = ? AND version = ?', resolveHtml(r.content), page.id, r.version);
        }
      }
      if (++linkDone % 20 === 0) {
        this.progress('links', linkDone, order.length);
        await tick();
      }
    }
    report.missingMedia = [...missing].slice(0, 100);

    s.emit(auth, {
      type: 'space.imported',
      spaceId: space.id,
      target: { type: 'space', id: space.id, label: space.name },
      data: { source: parsed.format, pages: report.pages, folders: report.folders, attachments: report.attachments, revisions: report.revisions },
    });
    return report;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
