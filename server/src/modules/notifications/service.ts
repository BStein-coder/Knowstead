import type { Services } from '../../services.ts';
import type { UserRef } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { DomainEvent } from '../../core/events.ts';
import { Db, nowIso } from '../../db/database.ts';
import { FREE_TEXT_MIN_FIXED, translate, translator, type Locale } from '../../core/i18n.ts';

export interface NotificationDto {
  id: number;
  type: string;
  actor: UserRef | null;
  spaceId: number | null;
  pageId: number | null;
  commentId: number | null;
  title: string;
  body: string;
  link: string;
  read: boolean;
  createdAt: string;
}

interface Pending {
  userId: number;
  type: string;
  title: string;
  body: string;
}

/** Erzeugt Benachrichtigungen aus Ereignissen (Beobachten, Erwähnungen, Kommentare). */
export class NotificationService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  start(): void {
    this.s.events.on('page.created', (e) => this.onPageEvent(e));
    this.s.events.on('page.updated', (e) => this.onPageEvent(e));
    this.s.events.on('page.moved', (e) => this.onPageEvent(e));
    this.s.events.on('page.deleted', (e) => this.onPageEvent(e));
    this.s.events.on('comment.created', (e) => this.onComment(e));
    this.s.events.on('task.commented', (e) => this.onTaskComment(e));
    // Bearbeitet: nur wer dabei neu erwähnt wurde, erfährt davon
    this.s.events.on('comment.updated', (e) => this.onComment(e));
    this.s.events.on('task.comment_updated', (e) => this.onTaskComment(e));
  }

  /** Darf diese Person die Seite sehen? (Erwähnungen und Benachrichtigungen erreichen sonst niemanden.) */
  canView(userId: number, pageId: number): boolean {
    const user = this.s.users.get(userId);
    if (!user || user.status !== 'active') return false;
    const page = this.s.pages.get(pageId);
    if (!page) return false;
    const space = this.s.spaces.get(page.space_id);
    if (!space) return false;
    const auth = this.s.perms.forUser(user);
    return this.s.perms.canViewPage(auth, page, space, { includeDeleted: true });
  }

  private onPageEvent(e: DomainEvent): void {
    if (!e.pageId || !e.actor) return;
    const page = this.s.pages.get(e.pageId);
    if (!page) return;
    const actorName = e.actor.displayName;
    const title = page.title;
    const pending = new Map<number, Pending>();
    const mentions = (e.data.mentions as number[] | undefined) ?? [];
    for (const uid of mentions) {
      pending.set(uid, { userId: uid, type: 'mention', title: `${actorName} hat dich in „${title}“ erwähnt`, body: '' });
    }
    const minor = !!e.data.minor;
    if (!minor) {
      const watchers = e.type === 'page.created' ? this.s.social.watchersOfSpace(page.space_id) : this.s.social.watchersOfPage(page);
      for (const uid of watchers) {
        if (pending.has(uid)) continue;
        let text = '';
        if (e.type === 'page.created') text = `${actorName} hat die Seite „${title}“ erstellt`;
        else if (e.type === 'page.updated') text = `${actorName} hat „${title}“ aktualisiert (Version ${e.data.version ?? page.version})`;
        else if (e.type === 'page.moved') text = `${actorName} hat „${title}“ verschoben`;
        else if (e.type === 'page.deleted') text = `${actorName} hat „${title}“ in den Papierkorb verschoben`;
        pending.set(uid, { userId: uid, type: e.type, title: text, body: (e.data.changeNote as string | undefined) ?? '' });
      }
    }
    this.deliver(e, [...pending.values()], (e.data.url as string | undefined) ?? this.s.pages.url(page));
  }

  private onComment(e: DomainEvent): void {
    if (!e.pageId || !e.actor) return;
    const page = this.s.pages.get(e.pageId);
    if (!page) return;
    const actorName = e.actor.displayName;
    const excerpt = (e.data.excerpt as string | undefined) ?? '';
    const pending = new Map<number, Pending>();
    for (const uid of (e.data.mentions as number[] | undefined) ?? []) {
      pending.set(uid, { userId: uid, type: 'mention', title: `${actorName} hat dich in einem Kommentar zu „${page.title}“ erwähnt`, body: excerpt });
    }
    // Antwortende und Beobachtende erfahren nur von neuen Kommentaren – beim Bearbeiten zählen allein neue Erwähnungen
    if (e.type === 'comment.created') {
      const parentAuthor = e.data.parentAuthorId as number | null | undefined;
      if (parentAuthor && !pending.has(parentAuthor)) {
        pending.set(parentAuthor, { userId: parentAuthor, type: 'comment.reply', title: `${actorName} hat auf deinen Kommentar zu „${page.title}“ geantwortet`, body: excerpt });
      }
      for (const uid of this.s.social.watchersOfPage(page)) {
        if (pending.has(uid)) continue;
        pending.set(uid, { userId: uid, type: 'comment.created', title: `${actorName} hat „${page.title}“ kommentiert`, body: excerpt });
      }
    }
    if (!pending.size) return;
    this.deliver(e, [...pending.values()], (e.data.url as string | undefined) ?? this.s.pages.url(page));
  }

  /**
   * Nachricht im Chat einer Aufgabe: Erwähnte, die verantwortliche Person, wer die Aufgabe angelegt hat
   * und wer schon mitgeschrieben hat. Sichtbarkeit richtet sich nach dem Bereich des Plans.
   */
  private onTaskComment(e: DomainEvent): void {
    if (!e.actor || !e.spaceId || e.target?.type !== 'task') return;
    const space = this.s.spaces.get(e.spaceId);
    if (!space) return;
    const actorName = e.actor.displayName;
    const title = e.target.label ?? '';
    const excerpt = (e.data.excerpt as string | undefined) ?? '';
    const pending = new Map<number, Pending>();
    for (const uid of (e.data.mentions as number[] | undefined) ?? []) {
      pending.set(uid, { userId: uid, type: 'mention', title: `${actorName} hat dich in der Aufgabe „${title}“ erwähnt`, body: excerpt });
    }
    // Beteiligte erfahren nur von neuen Nachrichten – beim Bearbeiten zählen allein neue Erwähnungen
    const involved = e.type === 'task.commented' ? [e.data.assigneeId, e.data.createdBy, ...((e.data.participants as number[] | undefined) ?? [])] : [];
    for (const uid of involved) {
      if (typeof uid !== 'number' || uid <= 0 || pending.has(uid)) continue;
      pending.set(uid, { userId: uid, type: 'task.commented', title: `${actorName} hat in der Aufgabe „${title}“ geschrieben`, body: excerpt });
    }
    if (!pending.size) return;
    const link = (e.data.url as string | undefined) ?? '/tasks';
    this.deliver(e, [...pending.values()], link, (userId) => this.canViewSpace(userId, space.id));
  }

  /** Darf diese Person den Bereich sehen? */
  canViewSpace(userId: number, spaceId: number): boolean {
    const user = this.s.users.get(userId);
    if (!user || user.status !== 'active') return false;
    const space = this.s.spaces.get(spaceId);
    return !!space && this.s.perms.canSpace(this.s.perms.forUser(user), space, 'view');
  }

  /**
   * Einzelne Benachrichtigung aus einem Fachdienst heraus (z. B. Prüfaufträge).
   * Sichtbarkeit und Selbstbenachrichtigung werden hier geprüft.
   */
  push(input: {
    userId: number;
    type: string;
    title: string;
    link: string;
    body?: string;
    actorId?: number | null;
    spaceId?: number | null;
    pageId?: number | null;
    commentId?: number | null;
  }): void {
    if (input.actorId && input.actorId === input.userId) return;
    if (input.pageId && !this.canView(input.userId, input.pageId)) return;
    const id = this.s.db.run(
      `INSERT INTO notifications (user_id, type, actor_id, space_id, page_id, comment_id, title, body, link, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.userId,
      input.type,
      input.actorId ?? null,
      input.spaceId ?? null,
      input.pageId ?? null,
      input.commentId ?? null,
      input.title,
      (input.body ?? '').slice(0, 500),
      input.link,
      nowIso(),
    ).lastInsertRowid;
    this.s.realtime.sendToUser(input.userId, 'notification', { id, title: input.title, link: input.link, type: input.type });
    this.s.mail.notify(input.userId, { type: input.type, title: input.title, body: input.body, link: input.link });
  }

  /** `visible` entscheidet, wer die Sache sehen darf – ohne Angabe gilt die Seite des Ereignisses. */
  private deliver(e: DomainEvent, items: Pending[], link: string, visible?: (userId: number) => boolean): void {
    const now = nowIso();
    for (const item of items) {
      if (item.userId === e.actor?.id) continue;
      const allowed = visible ? visible(item.userId) : !!e.pageId && this.canView(item.userId, e.pageId);
      if (!allowed) continue;
      const id = this.s.db.run(
        `INSERT INTO notifications (user_id, type, actor_id, space_id, page_id, comment_id, title, body, link, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        item.userId,
        item.type,
        e.actor?.id ?? null,
        e.spaceId,
        e.pageId,
        (e.data.commentId as number | undefined) ?? null,
        item.title,
        item.body.slice(0, 500),
        link,
        now,
      ).lastInsertRowid;
      this.s.realtime.sendToUser(item.userId, 'notification', { id, title: item.title, link, type: item.type });
      this.s.mail.notify(item.userId, { type: item.type, title: item.title, body: item.body, link });
    }
  }

  /**
   * Zieht Benachrichtigungen zurück, deren Seite oder Bereich die Person inzwischen nicht mehr sehen
   * darf – etwa weil die Seite nachträglich eingeschränkt oder das Recht im Bereich entzogen wurde.
   * Titel, Kommentartext und Änderungsnotiz stünden sonst weiter in der Liste und in der täglichen
   * Zusammenfassung per E-Mail. Entwurfs- und Papierkorbstatus spielen hier bewusst keine Rolle:
   * Prüfaufträge zu Entwürfen und Hinweise auf gelöschte Seiten bleiben erhalten.
   */
  withdrawInvisible(auth: AuthContext): number {
    const user = auth.user;
    if (!user || auth.isAdmin) return 0;
    let removed = 0;
    const viewable = this.s.perms.viewableSpaceIds(auth);
    const outside = viewable.length ? `space_id NOT IN ${Db.placeholders(viewable.length)}` : '1 = 1';
    // Erst nachsehen, dann löschen: Der Zähler wird oft abgefragt und soll im Normalfall nichts schreiben
    if (this.s.db.value(`SELECT 1 FROM notifications WHERE user_id = ? AND space_id IS NOT NULL AND ${outside} LIMIT 1`, user.id, ...viewable)) {
      removed += this.s.db.run(`DELETE FROM notifications WHERE user_id = ? AND space_id IS NOT NULL AND ${outside}`, user.id, ...viewable).changes;
    }
    if (!this.s.perms.hasViewRestrictions()) return removed;
    const pageIds = this.s.db.all<{ page_id: number }>('SELECT DISTINCT page_id FROM notifications WHERE user_id = ? AND page_id IS NOT NULL', user.id).map((r) => r.page_id);
    const hidden = pageIds.filter((id) => !this.s.perms.passesViewRestrictions(auth, id));
    for (let i = 0; i < hidden.length; i += 500) {
      const chunk = hidden.slice(i, i + 500);
      removed += this.s.db.run(`DELETE FROM notifications WHERE user_id = ? AND page_id IN ${Db.placeholders(chunk.length)}`, user.id, ...chunk).changes;
    }
    return removed;
  }

  list(auth: AuthContext, options: { unreadOnly?: boolean; limit?: number; offset?: number; locale?: Locale } = {}) {
    const tr = translator(options.locale ?? 'de');
    const user = this.s.perms.requireUser(auth);
    this.withdrawInvisible(auth);
    const limit = options.limit ?? 30;
    const offset = options.offset ?? 0;
    const where = options.unreadOnly ? 'user_id = ? AND read_at IS NULL' : 'user_id = ?';
    const rows = this.s.db.all<{
      id: number;
      type: string;
      actor_id: number | null;
      space_id: number | null;
      page_id: number | null;
      comment_id: number | null;
      title: string;
      body: string;
      link: string;
      read_at: string | null;
      created_at: string;
    }>(`SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, user.id, limit, offset);
    const actors = this.s.users.refs(rows.map((r) => r.actor_id));
    const items: NotificationDto[] = rows.map((r) => ({
      id: r.id,
      type: r.type,
      actor: actors.get(r.actor_id ?? 0) ?? null,
      spaceId: r.space_id,
      pageId: r.page_id,
      commentId: r.comment_id,
      title: tr(r.title),
      body: translate(r.body, options.locale ?? 'de', FREE_TEXT_MIN_FIXED),
      link: r.link,
      read: !!r.read_at,
      createdAt: r.created_at,
    }));
    return { items, unread: this.unreadCount(auth), limit, offset };
  }

  unreadCount(auth: AuthContext): number {
    if (!auth.user) return 0;
    this.withdrawInvisible(auth);
    return this.s.db.value<number>('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND read_at IS NULL', auth.user.id) ?? 0;
  }

  markRead(auth: AuthContext, ids: number[] | 'all'): void {
    const user = this.s.perms.requireUser(auth);
    if (ids === 'all') {
      this.s.db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', nowIso(), user.id);
    } else if (ids.length) {
      this.s.db.run(
        `UPDATE notifications SET read_at = ? WHERE user_id = ? AND id IN ${Db.placeholders(ids.length)}`,
        nowIso(),
        user.id,
        ...ids,
      );
    }
  }

  clearRead(auth: AuthContext): number {
    const user = this.s.perms.requireUser(auth);
    return this.s.db.run('DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL', user.id).changes;
  }
}
