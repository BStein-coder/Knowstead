import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { SpaceRow, UserRef } from '../../core/types.ts';
import { Db, nowIso } from '../../db/database.ts';
import { badRequest, forbidden, notFound } from '../../core/errors.ts';
import { extractMentions, htmlToText, sanitizeComment } from '../../core/html.ts';
import { truncate } from '../../core/util.ts';
import type { TaskRow } from './service.ts';

export interface TaskCommentRow {
  id: number;
  task_id: number;
  author_id: number | null;
  body: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface TaskCommentDto {
  id: number;
  taskId: number;
  author: UserRef | null;
  body: string;
  createdAt: string;
  updatedAt: string;
  edited: boolean;
  can: { edit: boolean; delete: boolean };
  /** Nur in der Antwort auf Schreiben und Bearbeiten: Erwähnte, die nichts erfahren (kein Zugriff, deaktiviert) */
  notNotified?: UserRef[];
}

const MAX_BODY = 20_000;

/**
 * Chat je Aufgabe – Nachrichten in zeitlicher Reihenfolge, mit @-Erwähnungen wie bei Seitenkommentaren.
 * Lesen darf, wer den Plan sehen darf; schreiben ab der Rolle „Kommentieren“ – also auch Personen, die
 * die Aufgabe selbst nicht bearbeiten dürfen. Gelöschte Nachrichten verschwinden ganz (keine Antworten,
 * die einen Platzhalter bräuchten).
 */
export class TaskCommentService {
  private readonly s: Services;
  private unreadBaseline: number | null = null;

  constructor(s: Services) {
    this.s = s;
  }

  private row(id: number): TaskCommentRow {
    const row = this.s.db.get<TaskCommentRow>('SELECT * FROM task_comments WHERE id = ? AND deleted_at IS NULL', id);
    if (!row) throw notFound('Nachricht nicht gefunden');
    return row;
  }

  /** Aufgabe samt Bereich – Aufgaben im Papierkorb gibt es hier nicht (404 wie überall sonst). */
  private context(auth: AuthContext, taskId: number, action: 'view' | 'comment'): { task: TaskRow; space: SpaceRow } {
    const task = this.s.tasks.taskRow(taskId);
    const board = this.s.tasks.boardRow(task.board_id);
    const space = this.s.spaces.require(board.space_id);
    this.s.perms.requireSpace(auth, space, action);
    return { task, space };
  }

  private clean(input: string): string {
    const body = sanitizeComment(input ?? '').trim();
    if (!htmlToText(body).trim()) throw badRequest('Die Nachricht ist leer');
    if (body.length > MAX_BODY) throw badRequest('Die Nachricht ist zu lang');
    return body;
  }

  private url(space: SpaceRow, task: TaskRow): string {
    return `/s/${encodeURIComponent(space.key)}/tasks?board=${task.board_id}&task=${task.id}`;
  }

  private dtos(auth: AuthContext, rows: TaskCommentRow[], space: SpaceRow): TaskCommentDto[] {
    const users = this.s.users.refs(rows.map((r) => r.author_id));
    const mayComment = this.s.perms.canSpace(auth, space, 'comment');
    const mayModerate = this.s.perms.canSpace(auth, space, 'moderate');
    return rows.map((r) => {
      const own = !!auth.user && r.author_id === auth.user.id;
      return {
        id: r.id,
        taskId: r.task_id,
        author: users.get(r.author_id ?? 0) ?? null,
        body: r.body,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        edited: r.updated_at !== r.created_at,
        can: { edit: own && mayComment, delete: (own && mayComment) || mayModerate },
      };
    });
  }

  list(auth: AuthContext, taskId: number): TaskCommentDto[] {
    const { space } = this.context(auth, taskId, 'view');
    const rows = this.s.db.all<TaskCommentRow>('SELECT * FROM task_comments WHERE task_id = ? AND deleted_at IS NULL ORDER BY created_at, id', taskId);
    return this.dtos(auth, rows, space);
  }

  create(auth: AuthContext, taskId: number, bodyInput: string): TaskCommentDto {
    const user = this.s.perms.requireUser(auth);
    const { task, space } = this.context(auth, taskId, 'comment');
    const body = this.clean(bodyInput);
    // Wer schon mitgeschrieben hat, ist Teil des Gesprächs und wird über neue Nachrichten informiert
    const participants = this.s.db
      .all<{ author_id: number }>('SELECT DISTINCT author_id FROM task_comments WHERE task_id = ? AND deleted_at IS NULL AND author_id IS NOT NULL', taskId)
      .map((r) => r.author_id);
    const now = nowIso();
    const res = this.s.db.run(
      'INSERT INTO task_comments (task_id, author_id, body, body_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      taskId,
      user.id,
      body,
      htmlToText(body),
      now,
      now,
    );
    // Wer schreibt, hat das Gespräch vor sich – bis hierhin gilt es für sie als gelesen
    this.setRead(taskId, user.id, res.lastInsertRowid);
    const mentions = extractMentions(body);
    this.s.emit(auth, {
      type: 'task.commented',
      spaceId: space.id,
      target: { type: 'task', id: task.id, label: task.title },
      data: {
        commentId: res.lastInsertRowid,
        excerpt: truncate(htmlToText(body), 200),
        mentions,
        assigneeId: task.assignee_id,
        createdBy: task.created_by,
        participants,
        url: this.url(space, task),
      },
    });
    return { ...this.dtos(auth, [this.row(res.lastInsertRowid)], space)[0], notNotified: this.unreachable(mentions, user.id, space) };
  }

  /** Erwähnte, die den Bereich nicht sehen dürfen – die Verfasserin soll wissen, dass sie nichts erfahren. */
  private unreachable(mentions: number[], authorId: number, space: SpaceRow): UserRef[] {
    return this.s.mentions.unreachable(mentions, authorId, (userId) => this.s.notifications.canViewSpace(userId, space.id));
  }

  update(auth: AuthContext, id: number, bodyInput: string): TaskCommentDto {
    const user = this.s.perms.requireUser(auth);
    const row = this.row(id);
    if (row.author_id !== user.id) throw forbidden('Nur eigene Nachrichten können bearbeitet werden');
    // Wer nicht mehr schreiben darf (Rolle entzogen, Bereich archiviert), ändert auch nichts mehr
    const { task, space } = this.context(auth, row.task_id, 'comment');
    const body = this.clean(bodyInput);
    // Wer erst beim Bearbeiten erwähnt wird, soll es erfahren – wer schon erwähnt war, nicht noch einmal
    const before = new Set(extractMentions(row.body));
    const added = extractMentions(body).filter((userId) => !before.has(userId));
    this.s.db.run('UPDATE task_comments SET body = ?, body_text = ?, updated_at = ? WHERE id = ?', body, htmlToText(body), nowIso(), id);
    this.s.emit(auth, {
      type: 'task.comment_updated',
      spaceId: space.id,
      target: { type: 'task', id: task.id, label: task.title },
      data: { commentId: id, mentions: added, excerpt: truncate(htmlToText(body), 200), url: this.url(space, task) },
    });
    return { ...this.dtos(auth, [this.row(id)], space)[0], notNotified: this.unreachable(added, user.id, space) };
  }

  delete(auth: AuthContext, id: number): void {
    const user = this.s.perms.requireUser(auth);
    const row = this.row(id);
    const { task, space } = this.context(auth, row.task_id, 'view');
    if (row.author_id !== user.id && !this.s.perms.canSpace(auth, space, 'moderate')) throw forbidden('Du darfst diese Nachricht nicht löschen');
    this.s.db.run('UPDATE task_comments SET deleted_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), id);
    this.s.emit(auth, {
      type: 'task.comment_deleted',
      spaceId: space.id,
      target: { type: 'task', id: task.id, label: task.title },
      data: { commentId: id, byModerator: row.author_id !== user.id },
    });
  }

  /** Anzahl je Aufgabe – gebündelt, damit ein Plan mit vielen Karten nicht je Karte eine Abfrage kostet. */
  counts(taskIds: number[]): Map<number, number> {
    const result = new Map<number, number>();
    for (let i = 0; i < taskIds.length; i += 500) {
      const chunk = taskIds.slice(i, i + 500);
      if (!chunk.length) continue;
      for (const r of this.s.db.all<{ task_id: number; n: number }>(
        `SELECT task_id, COUNT(*) AS n FROM task_comments WHERE deleted_at IS NULL AND task_id IN ${Db.placeholders(chunk.length)} GROUP BY task_id`,
        ...chunk,
      )) {
        result.set(r.task_id, r.n);
      }
    }
    return result;
  }

  count(taskId: number): number {
    return this.s.db.value<number>('SELECT COUNT(*) FROM task_comments WHERE task_id = ? AND deleted_at IS NULL', taskId) ?? 0;
  }

  /* ------------------------------ Gelesen / ungelesen ------------------------------ */

  /** Nachrichten bis zu dieser Kennung galten beim Einführen des Ungelesen-Stands als gelesen (Migration 024). */
  private baseline(): number {
    this.unreadBaseline ??= this.s.settings.getInternal<number>('taskChat:unreadBaseline', 0);
    return this.unreadBaseline;
  }

  private setRead(taskId: number, userId: number, commentId: number): void {
    this.s.db.run(
      `INSERT INTO task_comment_reads (task_id, user_id, last_comment_id, read_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(task_id, user_id) DO UPDATE SET last_comment_id = MAX(last_comment_id, excluded.last_comment_id), read_at = excluded.read_at`,
      taskId,
      userId,
      commentId,
      nowIso(),
    );
  }

  /** Chat geöffnet: Alles, was jetzt da ist, gilt für diese Person als gelesen. */
  markRead(auth: AuthContext, taskId: number): void {
    const user = this.s.perms.requireUser(auth);
    this.context(auth, taskId, 'view');
    const newest = this.s.db.value<number>('SELECT MAX(id) FROM task_comments WHERE task_id = ? AND deleted_at IS NULL', taskId) ?? 0;
    if (newest) this.setRead(taskId, user.id, newest);
  }

  /**
   * Ungelesene Nachrichten je Aufgabe für eine Person: von anderen geschrieben und neuer als ihr Lesestand.
   * Gebündelt wie `counts` – ein Plan mit vielen Karten kostet eine Abfrage je 500 Aufgaben.
   */
  unreadCounts(userId: number | null | undefined, taskIds: number[]): Map<number, number> {
    const result = new Map<number, number>();
    if (!userId) return result;
    for (let i = 0; i < taskIds.length; i += 500) {
      const chunk = taskIds.slice(i, i + 500);
      if (!chunk.length) continue;
      for (const r of this.s.db.all<{ task_id: number; n: number }>(
        `SELECT c.task_id, COUNT(*) AS n
           FROM task_comments c LEFT JOIN task_comment_reads r ON r.task_id = c.task_id AND r.user_id = ?
          WHERE c.deleted_at IS NULL AND c.task_id IN ${Db.placeholders(chunk.length)}
            AND (c.author_id IS NULL OR c.author_id != ?) AND c.id > MAX(COALESCE(r.last_comment_id, 0), ?)
          GROUP BY c.task_id`,
        userId,
        ...chunk,
        userId,
        this.baseline(),
      )) {
        result.set(r.task_id, r.n);
      }
    }
    return result;
  }
}
