/**
 * Wiedervorlage von Seiten.
 *
 * Jede Seite kann eine verantwortliche Person und ein Prüfintervall haben (oder
 * die Vorgabe ihres Bereichs erben). Wer eine Seite als „aktuell“ bestätigt – oder
 * als Verantwortliche eine wesentliche Änderung veröffentlicht, oder eine
 * Redaktionsprüfung freigibt –, startet das Intervall neu. Ein stündlicher Lauf
 * erinnert vor der Fälligkeit und bei Überfälligkeit; auf Wunsch entsteht dazu
 * eine Aufgabe im Plan des Bereichs, die beim Bestätigen automatisch erledigt wird
 * (und umgekehrt).
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { PageRow, SpaceRow, UserRef } from '../../core/types.ts';
import type { DomainEvent } from '../../core/events.ts';
import { Db, nowIso } from '../../db/database.ts';
import { badRequest, forbidden } from '../../core/errors.ts';
import { pageUrl } from './service.ts';

export const REVIEW_INTERVALS = [0, 1, 3, 6, 12, 24, 36];
/** So viele Tage vor der Fälligkeit gilt eine Seite als „bald fällig“ und es kommt eine Erinnerung. */
export const UPCOMING_DAYS = 14;

export type ReviewState = 'none' | 'ok' | 'due' | 'overdue';

export interface ReviewCycleDto {
  owner: UserRef | null;
  /** tatsächlich geltendes Intervall in Monaten (0 = keine Wiedervorlage) */
  intervalMonths: number;
  /** eigene Einstellung der Seite; null = Vorgabe des Bereichs */
  pageIntervalMonths: number | null;
  spaceIntervalMonths: number;
  verifiedAt: string | null;
  verifiedBy: UserRef | null;
  dueAt: string | null;
  state: ReviewState;
  /** erhält Erinnerungen: Verantwortliche, sonst zuletzt Bearbeitende */
  responsible: UserRef | null;
  canVerify: boolean;
  canConfigure: boolean;
}

export interface ReviewListItem {
  id: number;
  title: string;
  icon: string | null;
  url: string;
  space: { key: string; name: string; icon: string | null };
  owner: UserRef | null;
  responsible: UserRef | null;
  intervalMonths: number;
  verifiedAt: string | null;
  dueAt: string;
  state: ReviewState;
  updatedAt: string;
}

type PageReviewRow = PageRow & {
  owner_id: number | null;
  review_interval_months: number | null;
  verified_at: string | null;
  verified_by: number | null;
  review_due_at: string | null;
};

type SpaceReviewRow = SpaceRow & { review_interval_months: number; review_board_id: number | null };

/** Monate addieren; der Tag wird auf das Monatsende begrenzt (31.01. + 1 Monat = 28./29.02.). */
export function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

export function reviewState(dueAt: string | null, now = new Date()): ReviewState {
  if (!dueAt) return 'none';
  const due = new Date(dueAt).getTime();
  if (due <= now.getTime()) return 'overdue';
  if (due - now.getTime() <= UPCOMING_DAYS * 86400_000) return 'due';
  return 'ok';
}

export class ReviewCycleService {
  private readonly s: Services;
  private timer: NodeJS.Timeout | null = null;
  /** Seiten, die gerade bestätigt werden – verhindert Rückkopplung über erledigte Aufgaben */
  private readonly verifying = new Set<number>();

  constructor(s: Services) {
    this.s = s;
  }

  /** Ereignisse: erledigte Wiedervorlage-Aufgaben und Freigaben bestätigen die Seite. */
  listen(): void {
    this.s.events.on('task.completed', (e) => this.onTaskCompleted(e));
    this.s.events.on('review.approved', (e) => this.onReviewApproved(e));
  }

  schedule(): void {
    const run = () => {
      // Wie bei Aufgaben: erst ab der Uhrzeit der täglichen Zusammenfassung – niemand bekommt nachts Mails
      if (new Date().getHours() < this.s.settings.get('mailDigestHour')) return;
      try {
        this.runReminders();
      } catch (err) {
        this.s.log.error({ err }, 'Wiedervorlage-Erinnerungen fehlgeschlagen');
      }
    };
    setTimeout(run, 30_000).unref();
    this.timer = setInterval(run, 60 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /* ------------------------------ Berechnung ------------------------------ */

  private pageRow(id: number): PageReviewRow {
    return this.s.pages.require(id) as PageReviewRow;
  }

  private spaceRow(id: number): SpaceReviewRow {
    return this.s.spaces.require(id) as SpaceReviewRow;
  }

  effectiveInterval(page: PageReviewRow, space: SpaceReviewRow): number {
    return page.review_interval_months ?? space.review_interval_months ?? 0;
  }

  computeDue(page: PageReviewRow, space: SpaceReviewRow): string | null {
    const months = this.effectiveInterval(page, space);
    if (!months || page.status !== 'current' || page.deleted_at) return null;
    return addMonths(page.verified_at ?? page.published_at ?? page.created_at, months);
  }

  responsibleId(page: PageReviewRow): number | null {
    return page.owner_id ?? page.updated_by ?? page.created_by ?? null;
  }

  /** Fälligkeit einer Seite neu berechnen und speichern. */
  refresh(pageId: number): void {
    const page = this.s.pages.get(pageId) as PageReviewRow | undefined;
    if (!page) return;
    const due = this.computeDue(page, this.spaceRow(page.space_id));
    if (due !== page.review_due_at) this.s.db.run('UPDATE pages SET review_due_at = ? WHERE id = ?', due, pageId);
  }

  /** Alle Seiten eines Bereichs, die dessen Vorgabe erben, neu berechnen. */
  refreshSpace(spaceId: number): void {
    const ids = this.s.db.all<{ id: number }>('SELECT id FROM pages WHERE space_id = ? AND review_interval_months IS NULL', spaceId).map((r) => r.id);
    this.s.db.transaction(() => ids.forEach((id) => this.refresh(id)));
  }

  private canConfigure(auth: AuthContext, page: PageReviewRow, space: SpaceRow): boolean {
    return !!auth.user && this.s.pages.access(auth, page, space).edit;
  }

  private canVerify(auth: AuthContext, page: PageReviewRow, space: SpaceRow): boolean {
    if (!auth.user) return false;
    if (page.owner_id === auth.user.id) return this.s.perms.canViewPage(auth, page, space);
    return this.s.pages.access(auth, page, space).edit;
  }

  dto(auth: AuthContext, pageInput: PageRow, spaceInput: SpaceRow): ReviewCycleDto {
    const page = pageInput as PageReviewRow;
    const space = spaceInput as SpaceReviewRow;
    const refs = this.s.users.refs([page.owner_id, page.verified_by, this.responsibleId(page)]);
    return {
      owner: refs.get(page.owner_id ?? 0) ?? null,
      intervalMonths: this.effectiveInterval(page, space),
      pageIntervalMonths: page.review_interval_months,
      spaceIntervalMonths: space.review_interval_months ?? 0,
      verifiedAt: page.verified_at,
      verifiedBy: refs.get(page.verified_by ?? 0) ?? null,
      dueAt: page.review_due_at,
      state: reviewState(page.review_due_at),
      responsible: refs.get(this.responsibleId(page) ?? 0) ?? null,
      canVerify: this.canVerify(auth, page, space),
      canConfigure: this.canConfigure(auth, page, space),
    };
  }

  /* ------------------------------ Aktionen ------------------------------ */

  /** Seite als aktuell bestätigen – startet das Intervall neu. */
  verify(auth: AuthContext, pageId: number, options: { note?: string; silent?: boolean } = {}): ReviewCycleDto {
    const user = this.s.perms.requireUser(auth);
    const { page: row, space } = this.s.pages.requireViewable(auth, pageId);
    const page = row as PageReviewRow;
    if (!this.canVerify(auth, page, space)) throw forbidden('Bestätigen dürfen Verantwortliche und alle mit Schreibrecht');
    if (page.status !== 'current') throw badRequest('Entwürfe können nicht bestätigt werden');
    const now = nowIso();
    this.verifying.add(pageId);
    try {
      this.s.db.run('UPDATE pages SET verified_at = ?, verified_by = ? WHERE id = ?', now, user.id, pageId);
      this.refresh(pageId);
      this.completeLinkedTasks(pageId);
    } finally {
      this.verifying.delete(pageId);
    }
    if (!options.silent) {
      this.s.emit(auth, {
        type: 'page.verified',
        spaceId: space.id,
        pageId,
        target: { type: 'page', id: pageId, label: page.title },
        data: { note: options.note?.trim().slice(0, 500) || undefined },
      });
    }
    const fresh = this.pageRow(pageId);
    return this.dto(auth, fresh, space);
  }

  configure(auth: AuthContext, pageId: number, input: { ownerId?: number | null; intervalMonths?: number | null }): ReviewCycleDto {
    this.s.perms.requireUser(auth);
    const { page: row, space } = this.s.pages.requireViewable(auth, pageId);
    const page = row as PageReviewRow;
    if (!this.canConfigure(auth, page, space)) throw forbidden('Verantwortliche und Wiedervorlage ändern darf, wer die Seite bearbeiten darf');
    let ownerId = page.owner_id;
    if (input.ownerId !== undefined && input.ownerId !== page.owner_id) {
      if (input.ownerId === null) ownerId = null;
      else {
        const owner = this.s.users.get(input.ownerId);
        if (!owner || owner.status !== 'active' || owner.kind === 'bot') throw badRequest('Diese Person kann nicht verantwortlich sein');
        if (!this.s.perms.canViewPage(this.s.perms.forUser(owner), page, space)) throw badRequest(`${owner.display_name} darf diese Seite nicht sehen`);
        ownerId = owner.id;
      }
    }
    let interval = page.review_interval_months;
    if (input.intervalMonths !== undefined) {
      if (input.intervalMonths !== null && !REVIEW_INTERVALS.includes(input.intervalMonths)) throw badRequest('Ungültiges Prüfintervall');
      interval = input.intervalMonths;
    }
    this.s.db.run('UPDATE pages SET owner_id = ?, review_interval_months = ? WHERE id = ?', ownerId, interval, pageId);
    this.refresh(pageId);
    if (ownerId && ownerId !== page.owner_id) {
      this.s.notifications.push({
        userId: ownerId,
        type: 'page.owner_assigned',
        actorId: auth.user?.id ?? null,
        spaceId: space.id,
        pageId,
        title: `Du bist jetzt verantwortlich für „${page.title}“`,
        link: pageUrl(space.key, pageId, page.title),
      });
    }
    this.s.emit(auth, {
      type: 'page.review_cycle_changed',
      spaceId: space.id,
      pageId,
      target: { type: 'page', id: pageId, label: page.title },
      data: { ownerId, intervalMonths: interval },
    });
    return this.dto(auth, this.pageRow(pageId), space);
  }

  spaceSettings(auth: AuthContext, key: string) {
    const space = this.s.spaces.requireViewable(auth, key) as SpaceReviewRow;
    return { intervalMonths: space.review_interval_months ?? 0, boardId: space.review_board_id ?? null };
  }

  configureSpace(auth: AuthContext, key: string, input: { intervalMonths?: number; boardId?: number | null }) {
    const space = this.s.spaces.requireByKey(key) as SpaceReviewRow;
    this.s.perms.requireSpace(auth, space, 'admin');
    let interval = space.review_interval_months ?? 0;
    if (input.intervalMonths !== undefined) {
      if (!REVIEW_INTERVALS.includes(input.intervalMonths)) throw badRequest('Ungültiges Prüfintervall');
      interval = input.intervalMonths;
    }
    let boardId = space.review_board_id ?? null;
    if (input.boardId !== undefined) {
      if (input.boardId !== null) {
        const board = this.s.tasks.boardRow(input.boardId);
        if (board.space_id !== space.id) throw badRequest('Der Plan muss zum selben Bereich gehören');
      }
      boardId = input.boardId;
    }
    this.s.db.run('UPDATE spaces SET review_interval_months = ?, review_board_id = ?, updated_at = ? WHERE id = ?', interval, boardId, nowIso(), space.id);
    if (interval !== (space.review_interval_months ?? 0)) this.refreshSpace(space.id);
    this.s.emit(auth, {
      type: 'space.updated',
      spaceId: space.id,
      target: { type: 'space', id: space.id, label: space.name },
      data: { reviewIntervalMonths: interval, reviewBoardId: boardId },
    });
    return { intervalMonths: interval, boardId };
  }

  /** Nach dem Veröffentlichen: Fälligkeit aktualisieren; Verantwortliche bestätigen durch wesentliche Änderungen. */
  onPageSaved(auth: AuthContext, pageInput: PageRow, minor: boolean): void {
    const page = pageInput as PageReviewRow;
    if (!minor && auth.user && page.owner_id === auth.user.id) {
      this.s.db.run('UPDATE pages SET verified_at = ?, verified_by = ? WHERE id = ?', nowIso(), auth.user.id, page.id);
      this.completeLinkedTasks(page.id);
    }
    this.refresh(page.id);
  }

  private completeLinkedTasks(pageId: number): void {
    const open = this.s.db.all<{ task_id: number }>(
      `SELECT r.task_id FROM page_review_reminders r JOIN tasks t ON t.id = r.task_id
        WHERE r.page_id = ? AND r.task_id IS NOT NULL AND t.status != 'done'`,
      pageId,
    );
    for (const { task_id } of open) {
      try {
        this.s.tasks.update(this.s.perms.system(), task_id, { status: 'done' });
      } catch (err) {
        this.s.log.warn({ err, task: task_id }, 'Wiedervorlage-Aufgabe konnte nicht abgeschlossen werden');
      }
    }
  }

  private authFor(actorId: number | undefined): AuthContext | null {
    if (!actorId) return null;
    const user = this.s.users.get(actorId);
    return user && user.status === 'active' ? this.s.perms.forUser(user) : null;
  }

  private onTaskCompleted(e: DomainEvent): void {
    const taskId = Number(e.target?.id);
    if (!taskId) return;
    const link = this.s.db.get<{ page_id: number }>('SELECT page_id FROM page_review_reminders WHERE task_id = ? LIMIT 1', taskId);
    if (!link || this.verifying.has(link.page_id)) return;
    const auth = this.authFor(e.actor?.id);
    if (!auth) return;
    try {
      this.verify(auth, link.page_id, { note: 'Wiedervorlage-Aufgabe erledigt' });
    } catch {
      // Wer die Aufgabe erledigt, darf die Seite evtl. nicht bestätigen – dann bleibt sie fällig.
    }
  }

  private onReviewApproved(e: DomainEvent): void {
    if (!e.pageId || this.verifying.has(e.pageId)) return;
    const auth = this.authFor(e.actor?.id);
    if (!auth) return;
    try {
      this.verify(auth, e.pageId, { note: 'Redaktionsprüfung freigegeben', silent: true });
    } catch {
      /* Freigabe ohne Schreibrecht – Wiedervorlage bleibt unverändert */
    }
  }

  /* ------------------------------ Übersicht ------------------------------ */

  overview(
    auth: AuthContext,
    filter: { scope?: 'mine' | 'all'; space?: string; state?: 'overdue' | 'due' | 'attention' | 'all'; limit?: number },
  ): { items: ReviewListItem[]; counts: { overdue: number; due: number; ok: number } } {
    const user = this.s.perms.requireUser(auth);
    let spaceIds = this.s.perms.viewableSpaceIds(auth);
    if (filter.space) {
      const space = this.s.spaces.requireViewable(auth, filter.space);
      spaceIds = spaceIds.filter((id) => id === space.id);
    }
    const empty = { items: [], counts: { overdue: 0, due: 0, ok: 0 } };
    if (!spaceIds.length) return empty;
    const where = [
      `p.space_id IN ${Db.placeholders(spaceIds.length)}`,
      'p.deleted_at IS NULL',
      "p.status = 'current'",
      'p.review_due_at IS NOT NULL',
    ];
    const params: (string | number)[] = [...spaceIds];
    if (filter.scope !== 'all') {
      where.push('(p.owner_id = ? OR (p.owner_id IS NULL AND COALESCE(p.updated_by, p.created_by) = ?))');
      params.push(user.id, user.id);
    }
    const rows = this.s.db.all<PageReviewRow>(
      `SELECT p.id, p.space_id, p.parent_id, p.title, p.icon, p.status, p.deleted_at, p.created_by, p.updated_by, p.updated_at,
              p.created_at, p.published_at, p.owner_id, p.review_interval_months, p.verified_at, p.verified_by, p.review_due_at
         FROM pages p WHERE ${where.join(' AND ')} ORDER BY p.review_due_at LIMIT 2000`,
      ...params,
    );
    const visible = this.s.pages.filterVisible(auth, rows as PageRow[]) as PageReviewRow[];
    const now = new Date();
    const counts = { overdue: 0, due: 0, ok: 0 };
    const refs = this.s.users.refs(visible.flatMap((r) => [r.owner_id, this.responsibleId(r)]));
    const items: ReviewListItem[] = [];
    for (const r of visible) {
      const state = reviewState(r.review_due_at, now);
      if (state === 'overdue' || state === 'due' || state === 'ok') counts[state]++;
      const wanted = filter.state ?? 'attention';
      if (wanted === 'attention' && state === 'ok') continue;
      if (wanted === 'overdue' && state !== 'overdue') continue;
      if (wanted === 'due' && state !== 'due') continue;
      if (items.length >= Math.min(filter.limit ?? 200, 500)) continue;
      const space = this.spaceRow(r.space_id);
      items.push({
        id: r.id,
        title: r.title,
        icon: r.icon,
        url: pageUrl(space.key, r.id, r.title),
        space: { key: space.key, name: space.name, icon: space.icon },
        owner: refs.get(r.owner_id ?? 0) ?? null,
        responsible: refs.get(this.responsibleId(r) ?? 0) ?? null,
        intervalMonths: this.effectiveInterval(r, space),
        verifiedAt: r.verified_at,
        dueAt: r.review_due_at!,
        state,
        updatedAt: r.updated_at,
      });
    }
    return { items, counts };
  }

  /** Fällige und überfällige Seiten, für die man verantwortlich ist (Navigation). */
  dueCount(auth: AuthContext): number {
    if (!auth.user) return 0;
    const soon = new Date(Date.now() + UPCOMING_DAYS * 86400_000).toISOString();
    const rows = this.s.db.all<PageRow>(
      `SELECT p.id, p.space_id, p.parent_id, p.status, p.deleted_at, p.created_by FROM pages p
        WHERE p.deleted_at IS NULL AND p.status = 'current' AND p.review_due_at IS NOT NULL AND p.review_due_at <= ?
          AND (p.owner_id = ? OR (p.owner_id IS NULL AND COALESCE(p.updated_by, p.created_by) = ?))
        LIMIT 500`,
      soon,
      auth.user.id,
      auth.user.id,
    );
    return this.s.pages.filterVisible(auth, rows).length;
  }

  /* ------------------------------ Erinnerungen ------------------------------ */

  /**
   * Erinnert Verantwortliche einmal vor der Fälligkeit und einmal bei Überfälligkeit.
   * Ist im Bereich ein Plan hinterlegt, entsteht bei Überfälligkeit eine Aufgabe.
   */
  runReminders(now = new Date()): { upcoming: number; overdue: number; tasks: number } {
    const result = { upcoming: 0, overdue: 0, tasks: 0 };
    const soon = new Date(now.getTime() + UPCOMING_DAYS * 86400_000).toISOString();
    const rows = this.s.db.all<PageReviewRow>(
      `SELECT * FROM pages WHERE deleted_at IS NULL AND status = 'current' AND review_due_at IS NOT NULL AND review_due_at <= ?
        ORDER BY review_due_at LIMIT 5000`,
      soon,
    );
    for (const page of rows) {
      const state = reviewState(page.review_due_at, now);
      if (state !== 'due' && state !== 'overdue') continue;
      const kind = state === 'overdue' ? 'overdue' : 'upcoming';
      const done = this.s.db.value('SELECT 1 FROM page_review_reminders WHERE page_id = ? AND due_at = ? AND kind = ?', page.id, page.review_due_at, kind);
      if (done) continue;
      const space = this.spaceRow(page.space_id);
      const responsible = this.responsibleId(page);
      const url = pageUrl(space.key, page.id, page.title);
      const dueText = new Date(page.review_due_at!).toLocaleDateString('de-DE');
      let taskId: number | null = null;
      if (responsible) {
        this.s.notifications.push({
          userId: responsible,
          type: kind === 'overdue' ? 'page.review_overdue' : 'page.review_due',
          spaceId: space.id,
          pageId: page.id,
          title: kind === 'overdue' ? `Wiedervorlage überfällig: „${page.title}“` : `Wiedervorlage bald fällig: „${page.title}“`,
          body: kind === 'overdue' ? `Die Seite sollte seit dem ${dueText} geprüft werden.` : `Bitte bis zum ${dueText} prüfen und als aktuell bestätigen.`,
          link: url,
        });
      }
      if (kind === 'overdue' && space.review_board_id) {
        try {
          const task = this.s.tasks.create(this.s.perms.system(), space.review_board_id, {
            title: `Seite prüfen: ${page.title}`.slice(0, 300),
            notes: `Wiedervorlage fällig seit ${dueText}. Inhalt prüfen und auf der Seite „Als aktuell bestätigen“ – die Aufgabe wird dann automatisch erledigt.`,
            assigneeId: responsible,
            dueDate: page.review_due_at!.slice(0, 10),
            priority: 'high',
            pageId: page.id,
            labels: ['wiedervorlage'],
          });
          taskId = task.id;
          result.tasks++;
        } catch (err) {
          this.s.log.warn({ err, page: page.id }, 'Wiedervorlage-Aufgabe konnte nicht angelegt werden');
        }
      }
      this.s.db.run(
        'INSERT OR IGNORE INTO page_review_reminders (page_id, due_at, kind, user_id, task_id, sent_at) VALUES (?, ?, ?, ?, ?, ?)',
        page.id,
        page.review_due_at,
        kind,
        responsible,
        taskId,
        now.toISOString(),
      );
      result[kind]++;
    }
    return result;
  }
}
