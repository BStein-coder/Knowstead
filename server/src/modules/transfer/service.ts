import path from 'node:path';
import type { Readable } from 'node:stream';
import { parse, type HTMLElement } from 'node-html-parser';
import type { Services } from '../../services.ts';
import type { AttachmentRow, PageRow, RevisionRow, SpaceRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso } from '../../db/database.ts';
import { HttpError, badRequest } from '../../core/errors.ts';
import { escapeHtml, headingId } from '../../core/html.ts';
import { htmlToMarkdown, markdownToHtml } from '../../core/markdown.ts';
import { sanitizeRichText } from '../../core/html.ts';
import { safeEntryName, zipStream, type ZipSource } from '../../core/zip.ts';
import { openUploads, type ArchiveEntries, type UploadedFile } from '../../core/archive-entries.ts';
import { MAX_CONTENT_BYTES, toDisplayHtml } from '../pages/content.ts';
import { pageUrl } from '../pages/service.ts';
import { SPACE_KEY_RE } from '../spaces/service.ts';
import { parseFrontMatter, writeFrontMatter } from './frontmatter.ts';
import { formatDay, translate, type Locale } from '../../core/i18n.ts';
import { LEGACY_ARCHIVE_FILE, LEGACY_ARCHIVE_FORMAT } from '../../core/legacy.ts';

/** Beschreibungsdatei und Formatkennung eines Bereichsarchivs. Archive aus Versionen bis 1.9 heißen noch anders. */
const ARCHIVE_FILE = 'knowstead-space.json';
const ARCHIVE_FORMAT = 'knowstead-space';

function archiveFile(content: ArchiveEntries): string | null {
  return content.has(ARCHIVE_FILE) ? ARCHIVE_FILE : content.has(LEGACY_ARCHIVE_FILE) ? LEGACY_ARCHIVE_FILE : null;
}

const EXPORT_CSS = `
body{font-family:"Segoe UI",system-ui,-apple-system,sans-serif;line-height:1.6;color:#1f2937;max-width:900px;margin:2rem auto;padding:0 1.5rem}
h1{font-size:2rem;margin-bottom:.25rem}h1,h2,h3,h4{line-height:1.25;color:#111827}
.meta{color:#6b7280;font-size:.875rem;margin-bottom:2rem}
a{color:#2563eb}code{background:#f3f4f6;padding:.1rem .3rem;border-radius:4px;font-size:.9em}
pre{background:#0f172a;color:#e2e8f0;padding:1rem;border-radius:8px;overflow:auto}pre code{background:none;color:inherit;padding:0}
table{border-collapse:collapse;width:100%;margin:1rem 0}td,th{border:1px solid #d1d5db;padding:.4rem .6rem;vertical-align:top}th{background:#f3f4f6;text-align:left}
blockquote{border-left:4px solid #d1d5db;margin:1rem 0;padding:.25rem 1rem;color:#4b5563}
img{max-width:100%}
[data-type=callout]{border-left:4px solid #3b82f6;background:#eff6ff;padding:.75rem 1rem;border-radius:6px;margin:1rem 0}
[data-variant=warning]{border-color:#f59e0b;background:#fffbeb}[data-variant=error]{border-color:#ef4444;background:#fef2f2}
[data-variant=success]{border-color:#22c55e;background:#f0fdf4}[data-variant=note]{border-color:#8b5cf6;background:#f5f3ff}
.status{display:inline-block;padding:0 .4rem;border-radius:4px;font-size:.75rem;font-weight:700;text-transform:uppercase;background:#e5e7eb}
ul[data-type=taskList]{list-style:none;padding-left:.25rem}ul[data-type=taskList] li{display:flex;gap:.5rem}
ul[data-type=taskList] li>label{flex:none}
.toc{background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:.75rem 1rem}
nav.tree ul{list-style:none;padding-left:1rem}
@media print{body{margin:0;max-width:none}}
`;

interface ExportNode {
  page: PageRow;
  children: ExportNode[];
  path: string;
}

export function safeName(title: string): string {
  return (
    title
      .replace(/[\\/:*?"<>|#%]+/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Seite'
  );
}

const DOCUMENT_RE = /\.(md|markdown|txt|html?)$/i;

/** Datei im Anhangsordner eines Knowstead-Exports als Markdown oder HTML */
function isExportAttachment(name: string): boolean {
  return name.startsWith('_anhaenge/');
}

function relativeHref(fromFile: string, toFile: string): string {
  const rel = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return rel.split('/').map(encodeURIComponent).join('/');
}

export class TransferService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /* ================================ Export ================================ */

  private localeOf(auth: AuthContext): Locale {
    return auth.locale ?? this.s.settings.get('defaultLocale');
  }

  private dateTime(value: string | Date, locale: Locale): string {
    return new Date(value).toLocaleString(locale === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'short', timeStyle: 'short' });
  }

  /** Makros statisch auflösen (für Export, Druck, E-Mail). */
  async renderStatic(auth: AuthContext, page: PageRow, space: SpaceRow, depth = 0): Promise<string> {
    const hosts = this.s.settings.get('allowedEmbedHosts');
    const html = toDisplayHtml(page.content_type, page.content, page.language, hosts);
    if (page.content_type === 'code') return html;
    // Beschriftungen und Daten in der Sprache der exportierenden Person (auch in PDF und Word)
    const locale = this.localeOf(auth);
    const tr = (text: string) => translate(text, locale);
    const root = parse(html);
    const base = this.s.config.baseUrl;
    const link = (p: PageRow, sp: SpaceRow = space) => `<a href="${base}${pageUrl(sp.key, p.id, p.title)}">${escapeHtml(p.title)}</a>`;

    // Überschriften-IDs für Anker und Inhaltsverzeichnis
    const used = new Map<string, number>();
    const headings: { level: number; text: string; id: string }[] = [];
    for (const h of root.querySelectorAll('h1, h2, h3, h4')) {
      const text = h.textContent.trim();
      const id = headingId(text, used);
      h.setAttribute('id', id);
      headings.push({ level: Number(h.tagName.slice(1)), text, id });
    }

    for (const el of root.querySelectorAll('[data-type]')) {
      const type = el.getAttribute('data-type');
      switch (type) {
        case 'toc': {
          const items = headings.map((h) => `<li style="margin-left:${(h.level - 1) * 1}rem"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`);
          el.replaceWith(`<nav class="toc"><strong>${tr('Inhalt')}</strong><ul>${items.join('')}</ul></nav>`);
          break;
        }
        case 'children': {
          const kids = this.s.pages.children(auth, page.id === space.home_page_id ? null : page.id, space);
          el.replaceWith(kids.length ? `<ul>${kids.map((k) => `<li>${link(k)}</li>`).join('')}</ul>` : `<p><em>${tr('Keine Unterseiten')}</em></p>`);
          break;
        }
        case 'include-page': {
          const id = Number(el.getAttribute('data-page-id'));
          const target = id ? this.s.pages.get(id) : undefined;
          const targetSpace = target ? this.s.spaces.get(target.space_id) : undefined;
          if (target && targetSpace && depth < 2 && this.s.perms.canViewPage(auth, target, targetSpace)) {
            el.replaceWith(`<div class="included">${await this.renderStatic(auth, target, targetSpace, depth + 1)}</div>`);
          } else el.replaceWith(`<p><em>${tr('Eingebundene Seite nicht verfügbar')}</em></p>`);
          break;
        }
        case 'changelog': {
          const id = Number(el.getAttribute('data-page-id')) || page.id;
          try {
            const revs = this.s.revisions.list(auth, id, { limit: Number(el.getAttribute('data-limit')) || 20 }).items;
            const rows = revs
              .map(
                (r) =>
                  `<tr><td>${r.version}</td><td>${formatDay(r.createdAt, locale)}</td><td>${escapeHtml(r.author?.displayName ?? '')}</td><td>${escapeHtml(r.changeNote)}</td></tr>`,
              )
              .join('');
            el.replaceWith(`<table><thead><tr><th>${tr('Version')}</th><th>${tr('Datum')}</th><th>${tr('Autor')}</th><th>${tr('Änderung')}</th></tr></thead><tbody>${rows}</tbody></table>`);
          } catch {
            el.replaceWith('');
          }
          break;
        }
        case 'recent-pages': {
          const limit = Number(el.getAttribute('data-limit')) || 10;
          const rows = this.s.pages.filterVisible(
            auth,
            this.s.db.all<PageRow>(
              "SELECT * FROM pages WHERE space_id = ? AND deleted_at IS NULL AND status = 'current' ORDER BY updated_at DESC LIMIT ?",
              space.id,
              limit * 2,
            ),
          );
          el.replaceWith(`<ul>${rows.slice(0, limit).map((r) => `<li>${link(r)} – ${formatDay(r.updated_at, locale)}</li>`).join('')}</ul>`);
          break;
        }
        case 'attachments': {
          const files = this.s.attachments.list(auth, page.id);
          el.replaceWith(`<ul>${files.map((f) => `<li><a href="${base}${f.downloadUrl}">${escapeHtml(f.filename)}</a></li>`).join('')}</ul>`);
          break;
        }
        case 'api-data': {
          el.replaceWith(
            `<p><em>${tr('API-Daten')} (${escapeHtml(el.getAttribute('data-connector') ?? '')}${escapeHtml(el.getAttribute('data-path') ?? '')}) – ${tr('nur in der Online-Ansicht verfügbar')}</em></p>`,
          );
          break;
        }
        case 'properties-report': {
          el.replaceWith(`<p><em>${tr('Eigenschaften-Bericht')} – ${tr('nur in der Online-Ansicht verfügbar')}</em></p>`);
          break;
        }
        case 'status': {
          el.setAttribute('class', 'status');
          break;
        }
        case 'plugin-macro': {
          el.replaceWith(`<p><em>${tr('Plugin-Makro')} (${escapeHtml(el.getAttribute('data-plugin') ?? '')})</em></p>`);
          break;
        }
        default:
          break;
      }
    }
    const out = root.toString();
    return this.s.hooks.apply('page.export', out, { page, space, auth });
  }

  async pageExport(auth: AuthContext, pageId: number, format: 'md' | 'html') {
    const { page, space } = this.s.pages.requireAccess(auth, pageId, 'export');
    const labels = this.s.labels.labelsOf(page.id);
    const props = this.s.labels.propertiesOf(page.id);
    const author = this.s.users.refOf(page.updated_by);
    if (format === 'md') {
      const body = page.content_type === 'markdown' ? page.content : htmlToMarkdown(await this.renderStatic(auth, page, space));
      const front = writeFrontMatter({
        title: page.title,
        space: space.key,
        version: page.version,
        updated: page.updated_at,
        author: author?.displayName,
        labels: labels.length ? labels : undefined,
        properties: props.length ? Object.fromEntries(props.map((p) => [p.name, p.value])) : undefined,
      });
      return { filename: `${safeName(page.title)}.md`, contentType: 'text/markdown; charset=utf-8', body: `${front}\n# ${page.title}\n\n${body}` };
    }
    const content = await this.renderStatic(auth, page, space);
    const locale = this.localeOf(auth);
    const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(page.title)}</title><style>${EXPORT_CSS}</style></head>
<body><h1>${escapeHtml(page.icon ? `${page.icon} ${page.title}` : page.title)}</h1>
<div class="meta">${escapeHtml(space.name)} · ${translate('Version', locale)} ${page.version} · ${translate('zuletzt geändert am', locale)} ${this.dateTime(page.updated_at, locale)}${author ? ` ${translate('von', locale)} ${escapeHtml(author.displayName)}` : ''}</div>
${content}</body></html>`;
    return { filename: `${safeName(page.title)}.html`, contentType: 'text/html; charset=utf-8', body: html };
  }

  private buildTree(auth: AuthContext, space: SpaceRow, ext: string, rootId?: number): { nodes: ExportNode[]; flat: ExportNode[] } {
    const rows = this.s.pages.filterVisible(
      auth,
      this.s.db.all<PageRow>("SELECT * FROM pages WHERE space_id = ? AND deleted_at IS NULL AND status = 'current' ORDER BY position, id", space.id),
    );
    const byParent = new Map<number | null, PageRow[]>();
    for (const r of rows) {
      const list = byParent.get(r.parent_id) ?? [];
      list.push(r);
      byParent.set(r.parent_id, list);
    }
    const flat: ExportNode[] = [];
    const build = (parentId: number | null, dir: string, depth: number): ExportNode[] => {
      const used = new Set<string>();
      return (byParent.get(parentId) ?? []).map((p) => {
        let name = safeName(p.title);
        let n = 2;
        while (used.has(name.toLowerCase())) name = `${safeName(p.title)} (${n++})`;
        used.add(name.toLowerCase());
        const node: ExportNode = { page: p, children: [], path: `${dir}${name}.${ext}` };
        flat.push(node);
        if (depth < 50) node.children = build(p.id, `${dir}${name}/`, depth + 1);
        return node;
      });
    };
    let nodes: ExportNode[];
    if (rootId) {
      const root = rows.find((r) => r.id === rootId);
      if (!root) throw badRequest('Seite nicht gefunden');
      const node: ExportNode = { page: root, children: [], path: `${safeName(root.title)}.${ext}` };
      flat.push(node);
      node.children = build(root.id, `${safeName(root.title)}/`, 1);
      nodes = [node];
    } else nodes = build(null, '', 0);
    return { nodes, flat };
  }

  /** Bereich (oder Teilbaum) als ZIP exportieren: Markdown, HTML oder Knowstead-Archiv (JSON). */
  spaceExport(auth: AuthContext, key: string, format: 'markdown' | 'html' | 'json', rootId?: number): { filename: string; stream: Readable } {
    const space = this.s.spaces.requireViewable(auth, key);
    this.s.perms.requireSpace(auth, space, 'export');
    const stamp = new Date().toISOString().slice(0, 10);
    if (format === 'json') {
      return { filename: `${space.key}-archiv-${stamp}.zip`, stream: zipStream(this.archiveSources(auth, space)) };
    }
    const ext = format === 'markdown' ? 'md' : 'html';
    const { nodes, flat } = this.buildTree(auth, space, ext, rootId);
    const pathById = new Map(flat.map((n) => [n.page.id, n.path]));
    // Generatorfunktionen haben kein eigenes Pfeilfunktions-`this` – Dienste und Rendern vorab binden
    const self = { s: this.s, renderStatic: this.renderStatic.bind(this) };
    const locale = this.localeOf(auth);
    const exportedAt = `${translate('Exportiert am', locale)} ${this.dateTime(new Date(), locale)}`;

    async function* sources(): AsyncGenerator<ZipSource> {
      const attachmentPaths = new Map<number, string>();
      for (const node of flat) {
        const files = self.s.db.all<AttachmentRow>(
          `SELECT a.* FROM attachments a WHERE a.page_id = ? AND a.deleted_at IS NULL
           AND a.version = (SELECT MAX(version) FROM attachments b WHERE b.page_id = a.page_id AND b.filename = a.filename)`,
          node.page.id,
        );
        for (const f of files) {
          const zipPath = `_anhaenge/${node.page.id}/${f.filename}`;
          attachmentPaths.set(f.id, zipPath);
          yield { name: zipPath, file: path.join(self.s.config.uploadsDir, f.storage_key) };
        }
      }
      for (const node of flat) {
        let html = await self.renderStatic(auth, node.page, space);
        html = html.replace(/(src|href)="(?:[^"]*?)\/api\/v1\/attachments\/(\d+)\/raw(?:\?[^"]*)?"/g, (m, attr: string, id: string) => {
          const target = attachmentPaths.get(Number(id));
          return target ? `${attr}="${relativeHref(node.path, target)}"` : m;
        });
        html = html.replace(/href="(?:https?:\/\/[^"/]+)?\/s\/[^/"]+\/p\/(\d+)[^"]*"/g, (m, id: string) => {
          const target = pathById.get(Number(id));
          return target ? `href="${relativeHref(node.path, target)}"` : m;
        });
        if (format === 'markdown') {
          const labels = self.s.labels.labelsOf(node.page.id);
          const props = self.s.labels.propertiesOf(node.page.id);
          const body = node.page.content_type === 'markdown' ? node.page.content : htmlToMarkdown(html);
          yield {
            name: node.path,
            data:
              writeFrontMatter({
                title: node.page.title,
                version: node.page.version,
                updated: node.page.updated_at,
                labels: labels.length ? labels : undefined,
                properties: props.length ? Object.fromEntries(props.map((p) => [p.name, p.value])) : undefined,
              }) + `\n# ${node.page.title}\n\n${body}`,
          };
        } else {
          const css = relativeHref(node.path, 'style.css');
          const home = relativeHref(node.path, 'index.html');
          yield {
            name: node.path,
            data: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(node.page.title)}</title><link rel="stylesheet" href="${css}"></head><body><p><a href="${home}">← ${escapeHtml(space.name)}</a></p><h1>${escapeHtml(node.page.title)}</h1>${html}</body></html>`,
          };
        }
      }
      if (format === 'html') {
        const renderTree = (list: ExportNode[]): string =>
          list.length ? `<ul>${list.map((n) => `<li><a href="${n.path.split('/').map(encodeURIComponent).join('/')}">${escapeHtml(n.page.title)}</a>${renderTree(n.children)}</li>`).join('')}</ul>` : '';
        yield { name: 'style.css', data: EXPORT_CSS };
        yield {
          name: 'index.html',
          data: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><title>${escapeHtml(space.name)}</title><link rel="stylesheet" href="style.css"></head><body><h1>${escapeHtml(space.name)}</h1><p>${escapeHtml(space.description)}</p><nav class="tree">${renderTree(nodes)}</nav><p class="meta">${exportedAt}</p></body></html>`,
        };
      } else {
        const toc = (list: ExportNode[], depth = 0): string =>
          list.map((n) => `${'  '.repeat(depth)}- [${n.page.title}](${n.path.split('/').map(encodeURIComponent).join('/')})\n${toc(n.children, depth + 1)}`).join('');
        yield { name: 'README.md', data: `# ${space.name}\n\n${space.description}\n\n## ${translate('Inhalt', locale)}\n\n${toc(nodes)}\n_${exportedAt}_\n` };
      }
    }
    return { filename: `${space.key}-${format}-${stamp}.zip`, stream: zipStream(sources()) };
  }

  private async *archiveSources(auth: AuthContext, space: SpaceRow): AsyncGenerator<ZipSource> {
    const pages = this.s.pages.filterVisible(
      auth,
      this.s.db.all<PageRow>("SELECT * FROM pages WHERE space_id = ? AND deleted_at IS NULL AND status = 'current' ORDER BY position, id", space.id),
    );
    const visible = new Set(pages.map((p) => p.id));
    const users = this.s.users.refs(pages.flatMap((p) => [p.created_by, p.updated_by]));
    const attachments: { id: number; pageId: number; filename: string; version: number; mimeType: string; path: string; createdAt: string }[] = [];
    for (const p of pages) {
      const files = this.s.db.all<AttachmentRow>('SELECT * FROM attachments WHERE page_id = ? AND deleted_at IS NULL ORDER BY filename, version', p.id);
      for (const f of files) {
        const zipPath = `attachments/${f.id}_${f.filename}`;
        attachments.push({ id: f.id, pageId: p.id, filename: f.filename, version: f.version, mimeType: f.mime_type, path: zipPath, createdAt: f.created_at });
        yield { name: zipPath, file: path.join(this.s.config.uploadsDir, f.storage_key) };
      }
    }
    const archive = {
      format: ARCHIVE_FORMAT,
      formatVersion: 1,
      exportedAt: nowIso(),
      generator: `Knowstead ${this.s.config.version}`,
      space: { key: space.key, name: space.name, description: space.description, icon: space.icon, color: space.color, homePageId: space.home_page_id },
      pages: pages.map((p) => ({
        id: p.id,
        parentId: p.parent_id && visible.has(p.parent_id) ? p.parent_id : null,
        title: p.title,
        icon: p.icon,
        contentType: p.content_type,
        language: p.language,
        content: p.content,
        position: p.position,
        fullWidth: !!p.full_width,
        version: p.version,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        createdBy: users.get(p.created_by ?? 0)?.username ?? null,
        updatedBy: users.get(p.updated_by ?? 0)?.username ?? null,
        labels: this.s.labels.labelsOf(p.id),
        properties: this.s.labels.propertiesOf(p.id),
        revisions: this.s.db
          .all<RevisionRow>('SELECT * FROM page_revisions WHERE page_id = ? ORDER BY version', p.id)
          .map((r) => ({
            version: r.version,
            title: r.title,
            contentType: r.content_type,
            language: r.language,
            content: r.content,
            changeNote: r.change_note,
            changeType: r.change_type,
            minor: !!r.minor,
            author: this.s.users.refOf(r.author_id)?.username ?? null,
            createdAt: r.created_at,
          })),
      })),
      attachments,
    };
    yield { name: ARCHIVE_FILE, data: JSON.stringify(archive, null, 1) };
  }

  /* ================================ Import ================================ */

  /**
   * Markdown-/HTML-Dateien oder ZIP-Archive importieren. Ordnerstrukturen werden
   * zu Seitenhierarchien, relative Bilder zu Anhängen. Knowstead-Archive (knowstead-space.json)
   * werden inklusive Versionsgeschichte eingespielt.
   */
  async importFiles(auth: AuthContext, space: SpaceRow, parentId: number | null, files: UploadedFile[]) {
    this.s.perms.requireSpace(auth, space, 'create');
    // Die Dateien liegen als Zwischendateien auf der Platte; gelesen wird Eintrag für Eintrag
    const source = openUploads(files, { archives: /\.zip$/i });
    try {
      return await this.importEntries(auth, space, parentId, source);
    } finally {
      source.close();
    }
  }

  private async importEntries(auth: AuthContext, space: SpaceRow, parentId: number | null, source: ArchiveEntries) {
    if (archiveFile(source)) {
      const created = await this.importArchive(auth, space, parentId, source);
      return { created: created.length, pages: created };
    }
    // sicherer Name → Name des Eintrags; der Inhalt kommt erst beim Zugriff von der Platte
    const entries = new Map<string, string>();
    // Textdateien werden als Seite eingelesen – was größer ist, als eine Seite fassen kann, gar nicht erst lesen
    const isDocument = (name: string) => DOCUMENT_RE.test(name) && !isExportAttachment(safeEntryName(name));
    const maxSize = `${Math.round(MAX_CONTENT_BYTES / 1024 ** 2)} MB`;
    for (const name of source.names()) {
      // Namen wie „/abs.md“, „../../x.md“ oder „C:\x.md“ bleiben im Import
      const safe = safeEntryName(name);
      if (!safe || safe.startsWith('__MACOSX') || path.posix.basename(safe).startsWith('.')) continue;
      if (isDocument(safe) && source.size(name) > MAX_CONTENT_BYTES) throw badRequest(`${safe} ist zu groß für eine Seite (höchstens ${maxSize})`);
      entries.set(safe, name);
    }
    // Anhänge aus einem Knowstead-Export (_anhaenge/…) sind keine Seiten – sie werden über die Verweise übernommen
    const docs = [...entries.keys()].filter((n) => DOCUMENT_RE.test(n) && !isExportAttachment(n)).sort();
    if (!docs.length) throw badRequest('Keine importierbaren Dateien gefunden (.md, .markdown, .txt, .html oder .zip)');

    const created: { id: number; title: string }[] = [];
    const folderPages = new Map<string, number | null>([['', parentId]]);
    const decoder = new TextDecoder('utf-8');

    const ensureFolder = async (dir: string): Promise<number | null> => {
      if (folderPages.has(dir)) return folderPages.get(dir)!;
      const parentDir = path.posix.dirname(dir) === '.' ? '' : path.posix.dirname(dir);
      const parent = await ensureFolder(parentDir);
      // Existiert eine gleichnamige Datei (Ordner.md), wird sie zur Ordnerseite.
      const title = path.posix.basename(dir);
      const page = await this.s.pages.create(auth, {
        spaceId: space.id,
        parentId: parent,
        title,
        content: '<div data-type="children" data-depth="1"></div>',
        changeNote: 'Importiert (Ordner)',
      });
      created.push({ id: page.id, title });
      folderPages.set(dir, page.id);
      return page.id;
    };

    for (const name of docs) {
      const raw = decoder.decode(source.read(entries.get(name)!));
      const dir = path.posix.dirname(name) === '.' ? '' : path.posix.dirname(name);
      const base = path.posix.basename(name).replace(/\.(md|markdown|txt|html?)$/i, '');
      const isIndex = /^(index|readme|_index)$/i.test(base);
      const folderKey = dir ? `${dir}` : '';
      const ownFolder = dir ? `${dir}/${base}` : base;
      const hasChildren = [...entries.keys()].some((k) => k.startsWith(`${ownFolder}/`));
      let parent: number | null;
      if (isIndex && dir && !folderPages.has(dir)) parent = await ensureFolder(path.posix.dirname(dir) === '.' ? '' : path.posix.dirname(dir));
      else parent = await ensureFolder(folderKey);

      let html: string;
      let title = isIndex && dir ? path.posix.basename(dir) : base;
      let labels: string[] = [];
      let properties: { name: string; value: string }[] = [];
      if (/\.html?$/i.test(name)) {
        const root = parse(raw);
        const body = root.querySelector('body') ?? root;
        const h1 = body.querySelector('h1');
        if (h1) {
          title = h1.textContent.trim() || title;
          h1.remove();
        }
        html = body.innerHTML;
      } else {
        const { data, body } = parseFrontMatter(raw);
        let md = body;
        const h1 = md.match(/^\s*#\s+(.+)\s*\n/);
        if (typeof data.title === 'string' && data.title) title = data.title;
        else if (h1) title = h1[1].trim();
        if (h1 && (!data.title || data.title === h1[1].trim())) md = md.replace(h1[0], '');
        labels = Array.isArray(data.labels) ? data.labels.map(String) : [];
        properties = Object.entries((data.properties as Record<string, string> | undefined) ?? {}).map(([k, v]) => ({ name: k, value: String(v) }));
        html = /\.txt$/i.test(name) ? `<pre>${escapeHtml(md)}</pre>` : markdownToHtml(md);
      }

      const page = await this.s.pages.create(auth, {
        spaceId: space.id,
        parentId: parent,
        title: title.slice(0, 255) || 'Importierte Seite',
        content: html,
        changeNote: `Importiert aus ${path.posix.basename(name)}`,
        labels,
        properties,
      });
      created.push({ id: page.id, title: page.title });
      if (isIndex && dir) folderPages.set(dir, page.id);
      if (hasChildren) folderPages.set(ownFolder, page.id);

      // Relative Bilder/Dateien als Anhänge übernehmen
      const root = parse(page.content);
      let changed = false;
      for (const el of root.querySelectorAll('img[src], a[href]') as HTMLElement[]) {
        const attr = el.tagName === 'IMG' ? 'src' : 'href';
        const ref = el.getAttribute(attr) ?? '';
        if (!ref || /^(https?:|mailto:|tel:|#|\/|data:)/i.test(ref)) continue;
        const target = path.posix.normalize(path.posix.join(dir, decodeURIComponent(ref.split('#')[0].split('?')[0])));
        const entry = entries.get(target);
        if (!entry || /\.(md|markdown|html?)$/i.test(target)) continue;
        const att = this.s.attachments.storeBuffer(page.id, path.posix.basename(target), source.read(entry), auth.user?.id ?? null);
        el.setAttribute(attr, `/api/v1/attachments/${att.id}/raw`);
        changed = true;
      }
      if (changed) {
        this.s.db.run('UPDATE pages SET content = ? WHERE id = ?', root.toString(), page.id);
        this.s.db.run('UPDATE page_revisions SET content = ? WHERE page_id = ? AND version = 1', root.toString(), page.id);
      }
    }
    this.s.emit(auth, {
      type: 'space.imported',
      spaceId: space.id,
      target: { type: 'space', id: space.id, label: space.name },
      data: { pages: created.length, files: docs.length },
    });
    return { created: created.length, pages: created.slice(0, 50) };
  }

  /** Knowstead-Archiv inkl. Versionen, Stichwörtern, Eigenschaften und Anhängen einspielen. */
  private async importArchive(auth: AuthContext, space: SpaceRow, parentId: number | null, content: ArchiveEntries, options: { adoptHome?: boolean } = {}) {
    let archive: {
      format: string;
      space: { key: string; homePageId?: number | null };
      pages: {
        id: number;
        parentId: number | null;
        title: string;
        icon: string | null;
        contentType: 'richtext' | 'markdown' | 'code';
        language: string | null;
        content: string;
        position: number;
        fullWidth: boolean;
        labels: string[];
        properties: { name: string; value: string; type: string }[];
        revisions: { version: number; title: string; contentType: string; language: string | null; content: string; changeNote: string; changeType: string; minor: boolean; author: string | null; createdAt: string }[];
      }[];
      attachments: { id: number; pageId: number; filename: string; path: string }[];
    };
    try {
      archive = JSON.parse(new TextDecoder().decode(content.read(archiveFile(content) ?? ARCHIVE_FILE)));
    } catch {
      throw badRequest('knowstead-space.json ist beschädigt');
    }
    if (archive.format !== ARCHIVE_FORMAT && archive.format !== LEGACY_ARCHIVE_FORMAT) throw badRequest('Unbekanntes Archivformat');
    const user = this.s.perms.requireUser(auth);
    const idMap = new Map<number, number>();
    const created: { id: number; title: string }[] = [];
    const byParent = new Map<number | null, typeof archive.pages>();
    const known = new Set(archive.pages.map((p) => p.id));
    for (const p of archive.pages) {
      const key = p.parentId && known.has(p.parentId) ? p.parentId : null;
      const list = byParent.get(key) ?? [];
      list.push(p);
      byParent.set(key, list);
    }
    const walk = async (oldParent: number | null, newParent: number | null) => {
      for (const p of (byParent.get(oldParent) ?? []).sort((a, b) => a.position - b.position)) {
        const page = await this.s.pages.create(auth, {
          spaceId: space.id,
          parentId: newParent,
          title: p.title,
          icon: p.icon,
          content: p.content,
          contentType: p.contentType,
          language: p.language,
          fullWidth: p.fullWidth,
          labels: p.labels,
          properties: p.properties,
          changeNote: 'Importiert',
          silent: true,
        });
        idMap.set(p.id, page.id);
        created.push({ id: page.id, title: page.title });
        // Versionsgeschichte übernehmen (ersetzt die automatisch erzeugte Version 1)
        if (p.revisions?.length) {
          this.s.db.transaction(() => {
            this.s.db.run('DELETE FROM page_revisions WHERE page_id = ?', page.id);
            const hosts = this.s.settings.get('allowedEmbedHosts');
            for (const r of p.revisions) {
              // Autorenschaft aus dem Archiv nur für Administratoren übernehmen – sonst ließen sich
              // Versionen beliebigen Konten unterschieben. Der ursprüngliche Name bleibt in der Notiz.
              const archiveAuthor = r.author ? this.s.users.byUsername(r.author) : undefined;
              const author = auth.isAdmin ? archiveAuthor : undefined;
              const note = !auth.isAdmin && r.author && archiveAuthor?.id !== user.id ? `${r.changeNote ?? ''} (Autor im Archiv: ${r.author})`.trim() : r.changeNote;
              // Inhalte aus fremden Archiven sind nicht vertrauenswürdig.
              const safeContent = r.contentType === 'richtext' ? sanitizeRichText(r.content ?? '', hosts) : (r.content ?? '');
              this.s.db.run(
                `INSERT INTO page_revisions (page_id, version, title, content_type, language, content, change_note, change_type, minor, size, author_id, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                page.id,
                r.version,
                r.title,
                r.contentType,
                r.language,
                safeContent,
                (note ?? '').slice(0, 500),
                r.changeType,
                r.minor ? 1 : 0,
                Buffer.byteLength(safeContent),
                author?.id ?? user.id,
                r.createdAt,
              );
            }
            const last = p.revisions[p.revisions.length - 1];
            this.s.db.run('UPDATE pages SET version = ?, created_at = ?, updated_at = ? WHERE id = ?', last.version, p.revisions[0].createdAt, last.createdAt, page.id);
          });
        }
        await walk(p.id, page.id);
      }
    };
    await walk(null, parentId);

    // Anhänge
    const attMap = new Map<number, number>();
    for (const a of archive.attachments ?? []) {
      const newPage = idMap.get(a.pageId);
      if (!newPage || !content.has(a.path)) continue;
      // Anhänge einzeln von der Platte – nie alle zugleich im Speicher
      const row = this.s.attachments.storeBuffer(newPage, a.filename, content.read(a.path), user.id);
      attMap.set(a.id, row.id);
    }
    // Interne Verweise umschreiben
    for (const [, newId] of idMap) {
      const page = this.s.pages.get(newId)!;
      let html = page.content.replace(/\/api\/v1\/attachments\/(\d+)\/raw/g, (m, id: string) => {
        const mapped = attMap.get(Number(id));
        return mapped ? `/api/v1/attachments/${mapped}/raw` : m;
      });
      html = html.replace(/\/s\/[^/"]+\/p\/(\d+)(\/[^"]*)?/g, (m, id: string) => {
        const mapped = idMap.get(Number(id));
        return mapped ? pageUrl(space.key, mapped, this.s.pages.get(mapped)!.title) : m;
      });
      html = html.replace(/data-page-id="(\d+)"/g, (m, id: string) => {
        const mapped = idMap.get(Number(id));
        return mapped ? `data-page-id="${mapped}"` : m;
      });
      if (html !== page.content) {
        this.s.db.run('UPDATE pages SET content = ? WHERE id = ?', html, newId);
        this.s.db.run('UPDATE page_revisions SET content = ? WHERE page_id = ? AND version = ?', html, newId, page.version);
      }
      this.s.search.index(newId);
    }
    // Neuer Bereich aus einem Archiv: die Startseite des Archivs ersetzt die automatisch angelegte
    // (sonst gäbe es zwei „Übersicht“-Seiten)
    const importedHome = options.adoptHome && archive.space?.homePageId ? idMap.get(archive.space.homePageId) : undefined;
    const generatedHome = this.s.spaces.require(space.id).home_page_id;
    if (importedHome && generatedHome && generatedHome !== importedHome) {
      this.s.db.run('UPDATE spaces SET home_page_id = ? WHERE id = ?', importedHome, space.id);
      this.s.trash.hardDelete([generatedHome]);
    }
    this.s.emit(auth, {
      type: 'space.imported',
      spaceId: space.id,
      target: { type: 'space', id: space.id, label: space.name },
      data: { pages: created.length, source: archive.space?.key, archive: true },
    });
    return created;
  }

  /** Neuen Bereich direkt aus einem Knowstead-Archiv anlegen. */
  async importAsNewSpace(auth: AuthContext, file: UploadedFile, input: { key: string; name?: string }) {
    let content: ArchiveEntries;
    try {
      // Unabhängig vom Dateinamen als Archiv lesen
      content = openUploads([file], { archives: /^/ });
    } catch (err) {
      if (err instanceof HttpError && err.status !== 400) throw err;
      throw badRequest('Die Datei ist kein gültiges ZIP-Archiv');
    }
    try {
      return await this.createSpaceFromArchive(auth, content, input);
    } finally {
      content.close();
    }
  }

  private async createSpaceFromArchive(auth: AuthContext, content: ArchiveEntries, input: { key: string; name?: string }) {
    const metaFile = archiveFile(content);
    if (!metaFile) throw badRequest('Das ZIP enthält kein Knowstead-Archiv (knowstead-space.json)');
    const meta = JSON.parse(new TextDecoder().decode(content.read(metaFile))) as { space: { name: string; description: string; icon: string | null } };
    const key = input.key.toUpperCase();
    if (!SPACE_KEY_RE.test(key)) throw badRequest('Ungültiger Bereichsschlüssel');
    const space = await this.s.spaces.create(auth, {
      key,
      name: input.name || meta.space.name,
      description: meta.space.description,
      icon: meta.space.icon,
      preset: 'private',
    });
    const pages = await this.importArchive(auth, space, null, content, { adoptHome: true });
    return { space: this.s.spaces.require(space.id), pages: pages.length };
  }
}
