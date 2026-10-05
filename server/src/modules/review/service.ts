/**
 * Redaktionsprüfung („Review“): Autorinnen und Autoren bitten um Freigabe,
 * Prüfende geben frei oder schicken die Seite zurück.
 *
 * Zwei Betriebsarten:
 *  - freiwillig: „Prüfung anfordern“ auf jeder Seite,
 *  - verpflichtend: Bereichseinstellung „Änderungen müssen geprüft werden“ –
 *    dann landet jede Änderung von Personen ohne Prüfrecht automatisch in der
 *    Prüfliste (die Seite bleibt sichtbar, ist aber als „in Prüfung“ markiert).
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { PageRow, SpaceRow, UserRef } from '../../core/types.ts';
import { nowIso } from '../../db/database.ts';
import { badRequest, forbidden, notFound } from '../../core/errors.ts';
import { pageUrl } from '../pages/service.ts';

export type ReviewStatus = 'open' | 'approved' | 'rejected' | 'cancelled';

export interface ReviewRow {
  id: number;
  page_id: number;
  version: number;
  status: ReviewStatus;
  requested_by: number | null;
  reviewer_id: number | null;
  note: string;
  decision_note: string;
  decided_by: number | null;
  created_at: string;
  decided_at: string | null;
  /** Stufen-Kopie eines mehrstufigen Ablaufs (JSON) – null bei einstufiger Prüfung */
  stages: string | null;
  current_stage: number;
  stage_started_at: string | null;
}

export interface ReviewDto {
  id: number;
  pageId: number;
  page: { id: number; title: string; icon: string | null; url: string; spaceKey: string; spaceName: string } | null;
  version: number;
  currentVersion: number;
  status: ReviewStatus;
  requestedBy: UserRef | null;
  reviewer: UserRef | null;
  note: string;
  decisionNote: string;
  decidedBy: UserRef | null;
  createdAt: string;
  decidedAt: string | null;
  /** Darf der Aufrufende entscheiden? */
  canDecide: boolean;
  /** Mehrstufiger Ablauf mit Stufen, Entscheidungen und Vertretung */
  workflow: ReturnType<Services['approvals']['describe']>;
}

export class ReviewService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /* --------------------------------- Helfer --------------------------------- */

  private row(id: number): ReviewRow {
    const row = this.s.db.get<ReviewRow>('SELECT * FROM page_reviews WHERE id = ?', id);
    if (!row) throw notFound('Prüfauftrag nicht gefunden');
    return row;
  }

  /** Prüfen darf, wer im Bereich moderieren darf (Bereichsadmin, Redaktion, Admin). */
  canDecide(auth: AuthContext, space: SpaceRow): boolean {
    return this.s.perms.canSpace(auth, space, 'moderate');
  }

  /**
   * Über einen Auftrag entscheiden darf zusätzlich die ausdrücklich benannte prüfende Person – außer sie
   * hat die Prüfung selbst angefordert (Vier-Augen-Prinzip: niemand gibt sich selbst frei, indem er sich
   * als Prüfer einträgt).
   */
  canDecideReview(auth: AuthContext, space: SpaceRow, row: ReviewRow): boolean {
    if (row.stages) return this.s.approvals.decisionRight(auth, row, space).can;
    if (this.canDecide(auth, space)) return true;
    const userId = auth.user?.id;
    return !!userId && row.reviewer_id === userId && row.requested_by !== userId;
  }

  toDto(auth: AuthContext, row: ReviewRow): ReviewDto {
    const page = this.s.pages.get(row.page_id);
    const space = page ? this.s.spaces.get(page.space_id) : undefined;
    const users = this.s.users.refs([row.requested_by, row.reviewer_id, row.decided_by]);
    return {
      id: row.id,
      pageId: row.page_id,
      page:
        page && space
          ? {
              id: page.id,
              title: page.title,
              icon: page.icon,
              url: pageUrl(space.key, page.id, page.title),
              spaceKey: space.key,
              spaceName: space.name,
            }
          : null,
      version: row.version,
      currentVersion: page?.version ?? row.version,
      status: row.status,
      requestedBy: users.get(row.requested_by ?? 0) ?? null,
      reviewer: users.get(row.reviewer_id ?? 0) ?? null,
      note: row.note,
      decisionNote: row.decision_note,
      decidedBy: users.get(row.decided_by ?? 0) ?? null,
      createdAt: row.created_at,
      decidedAt: row.decided_at,
      canDecide: !!space && this.canDecideReview(auth, space, row),
      workflow: space ? this.s.approvals.describe(auth, row, space) : null,
    };
  }

  private setPageStatus(page: PageRow, status: 'none' | 'pending' | 'approved' | 'rejected', approvedBy?: number): void {
    if (status === 'approved') {
      this.s.db.run(
        'UPDATE pages SET review_status = ?, approved_version = ?, approved_at = ?, approved_by = ? WHERE id = ?',
        status,
        page.version,
        nowIso(),
        approvedBy ?? null,
        page.id,
      );
    } else {
      this.s.db.run('UPDATE pages SET review_status = ? WHERE id = ?', status, page.id);
    }
  }

  /* ------------------------------- Anforderung ------------------------------- */

  request(auth: AuthContext, pageId: number, input: { reviewerId?: number | null; note?: string } = {}): ReviewDto {
    const { page, space } = this.s.pages.requireAccess(auth, pageId, 'edit');
    const open = this.s.db.get<ReviewRow>("SELECT * FROM page_reviews WHERE page_id = ? AND status = 'open'", pageId);
    if (open) {
      // Bestehende Anforderung auf die aktuelle Version heben statt zu verdoppeln.
      this.s.db.run('UPDATE page_reviews SET version = ?, note = ?, reviewer_id = ? WHERE id = ?', page.version, input.note ?? open.note, input.reviewerId ?? open.reviewer_id, open.id);
      if (open.stages && open.version !== page.version) this.s.approvals.restart(this.row(open.id), page, space);
      return this.toDto(auth, this.row(open.id));
    }
    // Mehrstufiger Ablauf des Bereichs ersetzt die einzelne prüfende Person
    const workflow = this.s.approvals.activeFor(space);
    const reviewer = input.reviewerId && !workflow ? this.s.users.require(input.reviewerId) : null;
    const res = this.s.db.run(
      `INSERT INTO page_reviews (page_id, version, status, requested_by, reviewer_id, note, created_at, stages, current_stage, stage_started_at)
       VALUES (?, ?, 'open', ?, ?, ?, ?, ?, 0, ?)`,
      page.id,
      page.version,
      auth.user?.id ?? null,
      reviewer?.id ?? null,
      (input.note ?? '').slice(0, 2000),
      nowIso(),
      workflow ? JSON.stringify(workflow) : null,
      workflow ? nowIso() : null,
    );
    this.setPageStatus(page, 'pending');
    const review = this.row(res.lastInsertRowid);
    this.s.emit(auth, {
      type: 'review.requested',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'page', id: page.id, label: page.title },
      data: { reviewId: review.id, version: page.version, reviewer: reviewer?.id ?? null, note: review.note, stages: workflow?.stages.length ?? 1 },
    });
    if (workflow) this.s.approvals.notifyStage(page, space, review);
    else this.notifyReviewers(page, space, review);
    return this.toDto(auth, review);
  }

  /** Automatische Prüfpflicht beim Speichern einer Seite. */
  onPageSaved(auth: AuthContext, page: PageRow, space: SpaceRow): void {
    const open = this.s.db.get<ReviewRow>("SELECT * FROM page_reviews WHERE page_id = ? AND status = 'open'", page.id);
    if (open) {
      // Offener Auftrag bezieht sich immer auf den neuesten Stand – ein mehrstufiger beginnt wieder vorn.
      this.s.db.run('UPDATE page_reviews SET version = ? WHERE id = ?', page.version, open.id);
      this.setPageStatus(page, 'pending');
      if (open.stages && open.version !== page.version) this.s.approvals.restart(this.row(open.id), page, space);
      return;
    }
    if (!space.review_required) return;
    const workflow = this.s.approvals.activeFor(space);
    if (!workflow && this.canDecide(auth, space)) {
      // Wer prüfen darf, gibt seine eigene Änderung direkt frei.
      this.setPageStatus(page, 'approved', auth.user?.id);
      return;
    }
    const res = this.s.db.run(
      `INSERT INTO page_reviews (page_id, version, status, requested_by, note, created_at, stages, current_stage, stage_started_at)
       VALUES (?, ?, 'open', ?, ?, ?, ?, 0, ?)`,
      page.id,
      page.version,
      auth.user?.id ?? null,
      'Automatisch angefordert (Prüfpflicht im Bereich)',
      nowIso(),
      workflow ? JSON.stringify(workflow) : null,
      workflow ? nowIso() : null,
    );
    this.setPageStatus(page, 'pending');
    const review = this.row(res.lastInsertRowid);
    this.s.emit(auth, {
      type: 'review.requested',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'page', id: page.id, label: page.title },
      data: { reviewId: review.id, version: page.version, automatic: true },
    });
    if (workflow) this.s.approvals.notifyStage(page, space, review);
    else this.notifyReviewers(page, space, review);
  }

  private notifyReviewers(page: PageRow, space: SpaceRow, review: ReviewRow): void {
    const recipients = new Set<number>();
    if (review.reviewer_id) recipients.add(review.reviewer_id);
    else for (const id of this.s.spaces.moderatorIds(space)) recipients.add(id);
    recipients.delete(review.requested_by ?? -1);
    for (const userId of recipients) {
      this.s.notifications.push({
        userId,
        type: 'review.requested',
        actorId: review.requested_by,
        pageId: page.id,
        spaceId: space.id,
        title: `Prüfung angefordert: ${page.title}`,
        body: review.note,
        link: pageUrl(space.key, page.id, page.title),
      });
    }
  }

  /* -------------------------------- Entscheidung ------------------------------- */

  decide(auth: AuthContext, reviewId: number, approve: boolean, note = ''): ReviewDto {
    const row = this.row(reviewId);
    if (row.status !== 'open') throw badRequest('Dieser Prüfauftrag ist bereits abgeschlossen');
    const { page, space } = this.s.pages.requireViewable(auth, row.page_id);
    if (!this.canDecideReview(auth, space, row)) {
      throw forbidden(
        row.reviewer_id === auth.user?.id
          ? 'Die eigene Prüfanforderung kann nicht selbst freigegeben werden'
          : 'Zum Freigeben fehlt dir das Recht „Moderieren“ in diesem Bereich – oder du musst als prüfende Person eingetragen sein',
      );
    }
    const user = this.s.perms.requireUser(auth);
    if (row.stages) {
      // Mehrstufig: erst nach der letzten Stufe (oder bei einer Zurückweisung) endet der Auftrag
      const outcome = this.s.approvals.decide(auth, row, page, space, approve, note);
      if (outcome === 'pending' || outcome === 'advanced') return this.toDto(auth, this.row(reviewId));
    }
    this.s.db.run(
      'UPDATE page_reviews SET status = ?, decision_note = ?, decided_by = ?, decided_at = ?, version = ? WHERE id = ?',
      approve ? 'approved' : 'rejected',
      note.slice(0, 2000),
      user.id,
      nowIso(),
      page.version,
      reviewId,
    );
    this.setPageStatus(page, approve ? 'approved' : 'rejected', user.id);
    const updated = this.row(reviewId);
    this.s.emit(auth, {
      type: approve ? 'review.approved' : 'review.rejected',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'page', id: page.id, label: page.title },
      data: { reviewId, version: page.version, note },
    });
    if (row.requested_by && row.requested_by !== user.id) {
      this.s.notifications.push({
        userId: row.requested_by,
        type: approve ? 'review.approved' : 'review.rejected',
        actorId: user.id,
        pageId: page.id,
        spaceId: space.id,
        title: `${approve ? 'Freigegeben' : 'Zurückgewiesen'}: ${page.title}`,
        body: note,
        link: pageUrl(space.key, page.id, page.title),
      });
    }
    return this.toDto(auth, updated);
  }

  cancel(auth: AuthContext, reviewId: number): ReviewDto {
    const row = this.row(reviewId);
    if (row.status !== 'open') throw badRequest('Dieser Prüfauftrag ist bereits abgeschlossen');
    const { page, space } = this.s.pages.requireViewable(auth, row.page_id);
    const user = this.s.perms.requireUser(auth);
    if (row.requested_by !== user.id && !this.canDecide(auth, space)) throw forbidden('Nur die anfordernde Person oder die Redaktion kann abbrechen');
    this.s.db.run("UPDATE page_reviews SET status = 'cancelled', decided_by = ?, decided_at = ? WHERE id = ?", user.id, nowIso(), reviewId);
    this.setPageStatus(page, page.approved_version === page.version ? 'approved' : 'none');
    this.s.emit(auth, {
      type: 'review.cancelled',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'page', id: page.id, label: page.title },
      data: { reviewId },
    });
    return this.toDto(auth, this.row(reviewId));
  }

  /* --------------------------------- Listen --------------------------------- */

  forPage(auth: AuthContext, pageId: number): ReviewDto[] {
    this.s.pages.requireViewable(auth, pageId);
    return this.s.db
      .all<ReviewRow>('SELECT * FROM page_reviews WHERE page_id = ? ORDER BY id DESC LIMIT 50', pageId)
      .map((r) => this.toDto(auth, r));
  }

  /** Offene Prüfaufträge in allen sichtbaren Bereichen. */
  list(auth: AuthContext, options: { status?: ReviewStatus; spaceKey?: string; mine?: boolean; limit?: number } = {}): ReviewDto[] {
    this.s.perms.requireUser(auth);
    const spaceIds = options.spaceKey ? [this.s.spaces.requireViewable(auth, options.spaceKey).id] : this.s.perms.viewableSpaceIds(auth);
    if (!spaceIds.length) return [];
    const limit = Math.min(options.limit ?? 50, 200);
    const rows = this.s.db.all<ReviewRow>(
      `SELECT r.* FROM page_reviews r
         JOIN pages p ON p.id = r.page_id
        WHERE r.status = ? AND p.deleted_at IS NULL AND p.space_id IN (${spaceIds.map(() => '?').join(',')})
        ORDER BY r.created_at DESC LIMIT ?`,
      options.status ?? 'open',
      ...spaceIds,
      limit,
    );
    const visible = rows.filter((r) => {
      const page = this.s.pages.get(r.page_id);
      const space = page ? this.s.spaces.get(page.space_id) : undefined;
      return page && space && this.s.perms.canViewPage(auth, page, space);
    });
    const dtos = visible.map((r) => this.toDto(auth, r));
    return options.mine ? dtos.filter((r) => r.canDecide || r.reviewer?.id === auth.user?.id) : dtos;
  }

  /**
   * Anzahl offener Aufträge für die Navigation. Bewusst schlank gehalten
   * (eine Abfrage, keine Seitenprüfung) – die genaue Liste liefert `list()`.
   */
  openCount(auth: AuthContext): number {
    if (!auth.user) return 0;
    // Mehrstufige Aufträge: zählt, wer die aktuelle Stufe entscheiden darf (auch in Vertretung)
    let staged = 0;
    for (const row of this.s.db.all<ReviewRow>(
      "SELECT r.* FROM page_reviews r JOIN pages p ON p.id = r.page_id WHERE r.status = 'open' AND r.stages IS NOT NULL AND p.deleted_at IS NULL LIMIT 500",
    )) {
      const page = this.s.pages.get(row.page_id);
      const space = page ? this.s.spaces.get(page.space_id) : undefined;
      if (page && space && this.s.perms.canViewPage(auth, page, space) && this.s.approvals.decisionRight(auth, row, space).can) staged++;
    }
    // Nur Bereiche, in denen der Benutzer entscheiden darf …
    const spaceIds = this.s.perms
      .viewableSpaceIds(auth)
      .filter((id) => {
        const space = this.s.spaces.get(id);
        return !!space && this.canDecide(auth, space);
      });
    const placeholders = spaceIds.map(() => '?').join(',');
    // … plus Aufträge, bei denen er ausdrücklich als Prüfer eingetragen ist.
    return (
      staged +
      (this.s.db.value<number>(
        `SELECT COUNT(*) FROM page_reviews r JOIN pages p ON p.id = r.page_id
          WHERE r.status = 'open' AND r.stages IS NULL AND p.deleted_at IS NULL
            AND (${spaceIds.length ? `p.space_id IN (${placeholders}) OR ` : ''}r.reviewer_id = ?)`,
        ...spaceIds,
        auth.user.id,
      ) ?? 0)
    );
  }
}
