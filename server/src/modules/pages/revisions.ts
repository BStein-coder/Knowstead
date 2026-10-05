import type { Services } from '../../services.ts';
import type { RevisionRow, UserRef } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { badRequest, notFound } from '../../core/errors.ts';
import { htmlDiff, lineDiff, type LineChange, type DiffStats } from '../../core/diff.ts';
import { htmlToMarkdown } from '../../core/markdown.ts';
import { sanitizeRichText } from '../../core/html.ts';
import { toDisplayHtml } from './content.ts';
import { pageUrl } from './service.ts';
import { FREE_TEXT_MIN_FIXED, translate } from '../../core/i18n.ts';

export interface RevisionDto {
  id: number;
  version: number;
  title: string;
  contentType: string;
  changeNote: string;
  changeType: string;
  minor: boolean;
  size: number;
  author: UserRef | null;
  createdAt: string;
  isCurrent: boolean;
}

export interface DiffResult {
  from: RevisionDto;
  to: RevisionDto;
  titleChanged: boolean;
  html: string | null;
  lines: LineChange[];
  stats: DiffStats;
}

export class RevisionService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  private toDto(auth: AuthContext, row: Omit<RevisionRow, 'content'>, author: UserRef | null, currentVersion: number): RevisionDto {
    return {
      id: row.id,
      version: row.version,
      title: row.title,
      contentType: row.content_type,
      // Automatische Notizen („Seite erstellt“, „Importiert aus …“) in der Sprache der Person; eigene Texte bleiben
      changeNote: translate(row.change_note, auth.locale ?? this.s.settings.get('defaultLocale'), FREE_TEXT_MIN_FIXED),
      changeType: row.change_type,
      minor: !!row.minor,
      size: row.size,
      author,
      createdAt: row.created_at,
      isCurrent: row.version === currentVersion,
    };
  }

  list(auth: AuthContext, pageId: number, options: { limit?: number; offset?: number } = {}) {
    const { page } = this.s.pages.requireViewable(auth, pageId);
    const limit = options.limit ?? 100;
    const offset = options.offset ?? 0;
    const rows = this.s.db.all<Omit<RevisionRow, 'content'>>(
      `SELECT id, page_id, version, title, content_type, language, change_note, change_type, minor, size, author_id, created_at
       FROM page_revisions WHERE page_id = ? ORDER BY version DESC LIMIT ? OFFSET ?`,
      pageId,
      limit,
      offset,
    );
    const total = this.s.db.value<number>('SELECT COUNT(*) FROM page_revisions WHERE page_id = ?', pageId) ?? 0;
    const users = this.s.users.refs(rows.map((r) => r.author_id));
    return { items: rows.map((r) => this.toDto(auth, r, users.get(r.author_id ?? 0) ?? null, page.version)), total, limit, offset };
  }

  get(auth: AuthContext, pageId: number, version: number) {
    const { page, space } = this.s.pages.requireViewable(auth, pageId);
    const row = this.s.db.get<RevisionRow>('SELECT * FROM page_revisions WHERE page_id = ? AND version = ?', pageId, version);
    if (!row) throw notFound(`Version ${version} existiert nicht (mehr)`);
    const author = this.s.users.refOf(row.author_id);
    return {
      ...this.toDto(auth, row, author, page.version),
      content: row.content,
      language: row.language,
      // Doppelt gesichert: gespeicherte Inhalte sind bereits bereinigt, ältere
      // bzw. importierte Versionen werden hier erneut geprüft.
      html: sanitizeRichText(toDisplayHtml(row.content_type, row.content, row.language, this.s.settings.get('allowedEmbedHosts')), this.s.settings.get('allowedEmbedHosts')),
      spaceKey: space.key,
    };
  }

  diff(auth: AuthContext, pageId: number, fromVersion: number, toVersion: number): DiffResult {
    const { page } = this.s.pages.requireViewable(auth, pageId);
    const load = (v: number) => {
      const row = this.s.db.get<RevisionRow>('SELECT * FROM page_revisions WHERE page_id = ? AND version = ?', pageId, v);
      if (!row) throw notFound(`Version ${v} existiert nicht (mehr)`);
      return row;
    };
    const a = load(fromVersion);
    const b = load(toVersion);
    const users = this.s.users.refs([a.author_id, b.author_id]);
    const hosts = this.s.settings.get('allowedEmbedHosts');

    let html: string | null = null;
    let stats: DiffStats = { added: 0, removed: 0 };
    let sourceA: string;
    let sourceB: string;
    if (a.content_type === 'richtext' && b.content_type === 'richtext') {
      const visual = htmlDiff(a.content, b.content);
      if (visual) {
        html = visual.html;
        stats = visual.stats;
      }
      sourceA = htmlToMarkdown(a.content);
      sourceB = htmlToMarkdown(b.content);
    } else {
      sourceA = a.content_type === 'richtext' ? htmlToMarkdown(a.content) : a.content;
      sourceB = b.content_type === 'richtext' ? htmlToMarkdown(b.content) : b.content;
      if (a.content_type === 'markdown' && b.content_type === 'markdown') {
        const visual = htmlDiff(toDisplayHtml('markdown', a.content, null, hosts), toDisplayHtml('markdown', b.content, null, hosts));
        if (visual) html = visual.html;
      }
    }
    const lines = lineDiff(sourceA, sourceB);
    if (!html) stats = lines.stats;
    if (html) html = sanitizeRichText(html, hosts);
    return {
      from: this.toDto(auth, a, users.get(a.author_id ?? 0) ?? null, page.version),
      to: this.toDto(auth, b, users.get(b.author_id ?? 0) ?? null, page.version),
      titleChanged: a.title !== b.title,
      html,
      lines: lines.lines,
      stats,
    };
  }

  /**
   * Die letzten Änderungen über alle sichtbaren Bereiche hinweg – Grundlage für
   * „Letzte Änderungen“ mit direkter Wiederherstellung.
   */
  recentChanges(auth: AuthContext, options: { spaceKey?: string; pageId?: number; username?: string; limit?: number } = {}) {
    this.s.perms.requireUser(auth);
    const limit = Math.min(options.limit ?? 50, 200);
    const spaceIds = options.spaceKey ? [this.s.spaces.requireViewable(auth, options.spaceKey).id] : this.s.perms.viewableSpaceIds(auth);
    if (!spaceIds.length) return { items: [], limit };
    const authorId = options.username ? (this.s.users.byUsername(options.username)?.id ?? -1) : null;
    const rows = this.s.db.all<
      Omit<RevisionRow, 'content'> & { page_title: string; space_id: number; space_key: string; space_name: string; page_deleted: string | null; current_version: number }
    >(
      `SELECT r.id, r.page_id, r.version, r.title, r.content_type, r.language, r.change_note, r.change_type, r.minor, r.size,
              r.author_id, r.created_at,
              p.title AS page_title, p.space_id, p.version AS current_version, p.deleted_at AS page_deleted,
              sp.key AS space_key, sp.name AS space_name
         FROM page_revisions r
         JOIN pages p ON p.id = r.page_id
         JOIN spaces sp ON sp.id = p.space_id
        WHERE p.space_id IN (${spaceIds.map(() => '?').join(',')})
          ${options.pageId ? 'AND r.page_id = ?' : ''}
          ${authorId !== null ? 'AND r.author_id = ?' : ''}
        ORDER BY r.created_at DESC, r.id DESC
        LIMIT ?`,
      ...spaceIds,
      ...(options.pageId ? [options.pageId] : []),
      ...(authorId !== null ? [authorId] : []),
      limit * 2,
    );
    const users = this.s.users.refs(rows.map((r) => r.author_id));
    const items = [];
    for (const row of rows) {
      if (items.length >= limit) break;
      const page = this.s.pages.get(row.page_id);
      const space = page ? this.s.spaces.get(page.space_id) : undefined;
      if (!page || !space || !this.s.perms.canViewPage(auth, page, space, { includeDeleted: true })) continue;
      const access = this.s.pages.access(auth, page, space);
      items.push({
        ...this.toDto(auth, row, users.get(row.author_id ?? 0) ?? null, row.current_version),
        pageId: row.page_id,
        pageTitle: row.page_title,
        pageIcon: page.icon,
        spaceKey: row.space_key,
        spaceName: row.space_name,
        url: pageUrl(row.space_key, row.page_id, row.page_title),
        deleted: !!row.page_deleted,
        /** Frühere Version, auf die „rückgängig“ zurückgeht. */
        previousVersion: row.version > 1 ? row.version - 1 : null,
        canRestore: access.edit && !row.page_deleted,
      });
    }
    return { items, limit };
  }

  /**
   * Macht eine einzelne Änderung rückgängig: stellt den Stand **vor** dieser
   * Version wieder her (als neue Version, damit nichts verloren geht).
   */
  async undoChange(auth: AuthContext, revisionId: number) {
    const row = this.s.db.get<RevisionRow>('SELECT * FROM page_revisions WHERE id = ?', revisionId);
    if (!row) throw notFound('Diese Änderung existiert nicht mehr');
    if (row.version <= 1) throw badRequest('Die erste Version einer Seite kann nicht rückgängig gemacht werden – nutze den Papierkorb.');
    const previous = this.s.db.get<RevisionRow>('SELECT * FROM page_revisions WHERE page_id = ? AND version < ? ORDER BY version DESC LIMIT 1', row.page_id, row.version);
    if (!previous) throw badRequest('Zu dieser Änderung gibt es keinen vorherigen Stand mehr');
    return this.restore(auth, row.page_id, previous.version);
  }

  async restore(auth: AuthContext, pageId: number, version: number) {
    const { page } = this.s.pages.requireAccess(auth, pageId, 'edit');
    const row = this.s.db.get<RevisionRow>('SELECT * FROM page_revisions WHERE page_id = ? AND version = ?', pageId, version);
    if (!row) throw notFound(`Version ${version} existiert nicht (mehr)`);
    if (version === page.version) throw badRequest('Diese Version ist bereits aktuell');
    const updated = await this.s.pages.save(auth, pageId, {
      title: row.title,
      content: row.content,
      contentType: row.content_type,
      language: row.language,
      baseVersion: page.version,
      changeNote: `Version ${version} wiederhergestellt`,
      changeType: 'restore',
    });
    this.s.emit(auth, {
      type: 'page.version_restored',
      spaceId: updated.space_id,
      pageId,
      target: { type: 'page', id: pageId, label: updated.title },
      data: { restoredVersion: version, newVersion: updated.version },
    });
    return updated;
  }
}
