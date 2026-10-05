import type { Services } from '../../services.ts';
import type { CommentRow, UserRef } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso } from '../../db/database.ts';
import { badRequest, forbidden, notFound } from '../../core/errors.ts';
import { extractMentions, htmlToText, sanitizeComment } from '../../core/html.ts';
import { truncate } from '../../core/util.ts';

export interface CommentDto {
  id: number;
  pageId: number;
  parentId: number | null;
  author: UserRef | null;
  body: string;
  quote: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  resolvedBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  deleted: boolean;
  can: { edit: boolean; delete: boolean; resolve: boolean; reply: boolean };
  replies: CommentDto[];
  /** Nur in der Antwort auf das Anlegen: Erwähnte, die nichts erfahren (kein Zugriff auf die Seite, deaktiviert) */
  notNotified?: UserRef[];
}

export class CommentService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  private require(id: number): CommentRow {
    const row = this.s.db.get<CommentRow>('SELECT * FROM comments WHERE id = ?', id);
    if (!row) throw notFound('Kommentar nicht gefunden');
    return row;
  }

  list(auth: AuthContext, pageId: number): CommentDto[] {
    const { page, space } = this.s.pages.requireViewable(auth, pageId);
    const access = this.s.pages.access(auth, page, space);
    const rows = this.s.db.all<CommentRow>('SELECT * FROM comments WHERE page_id = ? ORDER BY created_at', pageId);
    const users = this.s.users.refs(rows.flatMap((r) => [r.author_id, r.resolved_by]));
    const byId = new Map<number, CommentDto>();
    const roots: CommentDto[] = [];
    for (const r of rows) {
      const own = !!auth.user && r.author_id === auth.user.id;
      const dto: CommentDto = {
        id: r.id,
        pageId: r.page_id,
        parentId: r.parent_id,
        author: users.get(r.author_id ?? 0) ?? null,
        body: r.deleted_at ? '' : r.body,
        quote: r.deleted_at ? null : r.quote,
        resolved: !!r.resolved_at,
        resolvedAt: r.resolved_at,
        resolvedBy: users.get(r.resolved_by ?? 0) ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        edited: r.updated_at !== r.created_at,
        deleted: !!r.deleted_at,
        can: {
          edit: !r.deleted_at && own && access.comment,
          delete: !r.deleted_at && (own || access.moderate),
          resolve: !r.parent_id && !r.deleted_at && ((own && access.comment) || access.edit || access.moderate),
          reply: access.comment && !r.deleted_at,
        },
        replies: [],
      };
      byId.set(r.id, dto);
    }
    for (const dto of byId.values()) {
      const parent = dto.parentId ? byId.get(dto.parentId) : undefined;
      if (parent) parent.replies.push(dto);
      else roots.push(dto);
    }
    // Gelöschte Kommentare ohne Antworten ausblenden.
    const prune = (list: CommentDto[]): CommentDto[] =>
      list
        .map((c) => ({ ...c, replies: prune(c.replies) }))
        .filter((c) => !c.deleted || c.replies.length > 0);
    return prune(roots);
  }

  create(auth: AuthContext, pageId: number, input: { body: string; parentId?: number | null; quote?: string | null }): CommentDto {
    const user = this.s.perms.requireUser(auth);
    const { page, space } = this.s.pages.requireAccess(auth, pageId, 'comment');
    const body = sanitizeComment(input.body ?? '').trim();
    if (!htmlToText(body).trim()) throw badRequest('Der Kommentar ist leer');
    if (body.length > 50_000) throw badRequest('Der Kommentar ist zu lang');
    let parentId: number | null = null;
    let parentAuthor: number | null = null;
    if (input.parentId) {
      const parent = this.require(input.parentId);
      if (parent.page_id !== pageId) throw badRequest('Ungültiger übergeordneter Kommentar');
      parentId = parent.id;
      parentAuthor = parent.author_id;
    }
    const now = nowIso();
    const res = this.s.db.run(
      'INSERT INTO comments (page_id, parent_id, author_id, body, quote, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      pageId,
      parentId,
      user.id,
      body,
      input.quote ? truncate(input.quote.trim(), 1000) : null,
      now,
      now,
    );
    if (this.s.users.preferences(user.id).autoWatch !== false) this.s.social.setWatch(user.id, 'page', pageId, true);
    this.s.emit(auth, {
      type: 'comment.created',
      spaceId: space.id,
      pageId,
      target: { type: 'comment', id: res.lastInsertRowid, label: page.title },
      data: {
        commentId: res.lastInsertRowid,
        parentId,
        parentAuthorId: parentAuthor,
        excerpt: truncate(htmlToText(body), 200),
        mentions: extractMentions(body),
        url: this.s.pages.url(page, space.key) + `#comment-${res.lastInsertRowid}`,
      },
    });
    const created = this.list(auth, pageId).flatMap(function flat(c): CommentDto[] {
      return [c, ...c.replies.flatMap(flat)];
    }).find((c) => c.id === res.lastInsertRowid)!;
    return { ...created, notNotified: this.unreachable(extractMentions(body), user.id, pageId) };
  }

  /** Erwähnte, die die Seite nicht sehen dürfen – die Verfasserin soll wissen, dass sie nichts erfahren. */
  private unreachable(mentions: number[], authorId: number, pageId: number): UserRef[] {
    return this.s.mentions.unreachable(mentions, authorId, (userId) => this.s.notifications.canView(userId, pageId));
  }

  update(auth: AuthContext, id: number, bodyInput: string): { notNotified: UserRef[] } {
    const user = this.s.perms.requireUser(auth);
    const row = this.require(id);
    if (row.deleted_at) throw notFound('Kommentar nicht gefunden');
    const { page, space } = this.s.pages.requireViewable(auth, row.page_id);
    if (row.author_id !== user.id) throw forbidden('Nur eigene Kommentare können bearbeitet werden');
    // Wer nicht mehr kommentieren darf (Rolle entzogen, Bereich archiviert), ändert auch nichts mehr
    if (!this.s.pages.access(auth, page, space).comment) {
      throw forbidden(space.archived_at ? 'Der Bereich ist archiviert und kann nicht bearbeitet werden' : 'Du darfst auf dieser Seite nicht kommentieren');
    }
    const body = sanitizeComment(bodyInput).trim();
    if (!htmlToText(body).trim()) throw badRequest('Der Kommentar ist leer');
    // Wer erst beim Bearbeiten erwähnt wird, soll es erfahren – wer schon erwähnt war, nicht noch einmal
    const before = new Set(extractMentions(row.body));
    const added = extractMentions(body).filter((userId) => !before.has(userId));
    this.s.db.run('UPDATE comments SET body = ?, updated_at = ? WHERE id = ?', body, nowIso(), id);
    this.s.emit(auth, {
      type: 'comment.updated',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'comment', id, label: page.title },
      data: { commentId: id, mentions: added, excerpt: truncate(htmlToText(body), 200), url: this.s.pages.url(page, space.key) + `#comment-${id}` },
    });
    return { notNotified: this.unreachable(added, user.id, page.id) };
  }

  delete(auth: AuthContext, id: number): void {
    const user = this.s.perms.requireUser(auth);
    const row = this.require(id);
    if (row.deleted_at) return;
    const { page, space } = this.s.pages.requireViewable(auth, row.page_id);
    const access = this.s.pages.access(auth, page, space);
    if (row.author_id !== user.id && !access.moderate) throw forbidden('Du darfst diesen Kommentar nicht löschen');
    this.s.db.run('UPDATE comments SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
    this.s.emit(auth, {
      type: 'comment.deleted',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'comment', id, label: page.title },
      data: { commentId: id, byModerator: row.author_id !== user.id },
    });
  }

  resolve(auth: AuthContext, id: number, resolved: boolean): void {
    const user = this.s.perms.requireUser(auth);
    const row = this.require(id);
    if (row.parent_id) throw badRequest('Nur Kommentar-Threads können erledigt werden');
    const { page, space } = this.s.pages.requireViewable(auth, row.page_id);
    const access = this.s.pages.access(auth, page, space);
    if (!((row.author_id === user.id && access.comment) || access.edit || access.moderate)) throw forbidden();
    this.s.db.run(
      'UPDATE comments SET resolved_at = ?, resolved_by = ? WHERE id = ?',
      resolved ? nowIso() : null,
      resolved ? user.id : null,
      id,
    );
    this.s.emit(auth, {
      type: resolved ? 'comment.resolved' : 'comment.reopened',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'comment', id, label: page.title },
      data: { commentId: id },
    });
  }
}
