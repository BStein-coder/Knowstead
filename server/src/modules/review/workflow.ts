/**
 * Mehrstufige Freigaben mit Abwesenheitsvertretungen.
 *
 * Ein Bereich legt optional einen Ablauf fest, z. B. „Fachbereich → Qualitätsmanagement →
 * Veröffentlichung“. Jede Stufe nennt Freigebende (Gruppen, Personen), wie viele Freigaben nötig
 * sind und nach wie vielen Tagen eskaliert wird. Ein Prüfauftrag durchläuft die Stufen nacheinander;
 * eine Zurückweisung beendet ihn. Eine neue Version der Seite beginnt wieder bei der ersten Stufe.
 *
 * Regeln:
 * - Wer die Prüfung angefordert hat, gibt keine Stufe frei (Vier-Augen-Prinzip).
 * - Mit „unterschiedliche Personen je Stufe“ darf niemand – auch nicht in Vertretung – zwei Stufen
 *   derselben Version freigeben.
 * - Vertretung: Ist eine freigebende Person abwesend (Zeitraum mit Vertretung), entscheidet die
 *   Vertretung in ihrem Namen; die Entscheidung nennt beide. Benachrichtigungen gehen an beide.
 * - Hat eine Stufe niemanden (leere Gruppe, gesperrte Konten), entscheidet die Bereichsverwaltung.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { PageRow, SpaceRow, UserRef } from '../../core/types.ts';
import { Db, nowIso, parseJson } from '../../db/database.ts';
import { badRequest, forbidden, notFound } from '../../core/errors.ts';
import { pageUrl } from '../pages/service.ts';
import type { ReviewRow } from './service.ts';

export interface StageApprover {
  type: 'group' | 'user';
  id: number;
}

export interface Stage {
  name: string;
  approvers: StageApprover[];
  minApprovals: number;
  /** 0 = keine Eskalation */
  escalateDays: number;
}

export interface WorkflowInput {
  enabled: boolean;
  stages: Stage[];
  distinctApprovers?: boolean;
}

interface WorkflowRow {
  space_id: number;
  enabled: number;
  stages: string;
  distinct_approvers: number;
  updated_by: number | null;
  updated_at: string;
}

interface DecisionRow {
  id: number;
  review_id: number;
  stage: number;
  version: number;
  user_id: number | null;
  user_name: string;
  on_behalf_of: number | null;
  on_behalf_name: string | null;
  decision: 'approved' | 'rejected';
  note: string;
  created_at: string;
}

interface DeputyRow {
  id: number;
  user_id: number;
  deputy_id: number;
  starts_on: string;
  ends_on: string;
  note: string;
  created_by: number | null;
  created_at: string;
}

/** Stufen-Kopie im Prüfauftrag (mit Einstellung „unterschiedliche Personen“) */
interface Snapshot {
  stages: Stage[];
  distinct: boolean;
}

export interface DecisionRight {
  can: boolean;
  onBehalfOf: number | null;
  reason: string | null;
}

const MAX_STAGES = 6;

function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export class ApprovalWorkflowService {
  private readonly s: Services;
  private timer: NodeJS.Timeout | null = null;

  constructor(s: Services) {
    this.s = s;
  }

  /* ------------------------------ Ablauf je Bereich ------------------------------ */

  private workflowRow(spaceId: number): WorkflowRow | undefined {
    return this.s.db.get<WorkflowRow>('SELECT * FROM approval_workflows WHERE space_id = ?', spaceId);
  }

  /** Aktiver Ablauf eines Bereichs oder null. */
  activeFor(space: SpaceRow): Snapshot | null {
    const row = this.workflowRow(space.id);
    if (!row || !row.enabled) return null;
    const stages = parseJson<Stage[]>(row.stages, []);
    return stages.length ? { stages, distinct: !!row.distinct_approvers } : null;
  }

  get(auth: AuthContext, spaceKey: string) {
    const space = this.s.spaces.requireViewable(auth, spaceKey);
    const row = this.workflowRow(space.id);
    const stages = row ? parseJson<Stage[]>(row.stages, []) : [];
    return {
      canEdit: this.s.perms.canSpace(auth, space, 'admin'),
      enabled: !!row?.enabled,
      distinctApprovers: row ? !!row.distinct_approvers : true,
      stages: stages.map((stage) => ({ ...stage, approvers: this.approverLabels(stage.approvers) })),
      updatedAt: row?.updated_at ?? null,
      updatedBy: this.s.users.refOf(row?.updated_by),
    };
  }

  set(auth: AuthContext, spaceKey: string, input: WorkflowInput) {
    const space = this.s.spaces.requireByKey(spaceKey);
    this.s.perms.requireSpace(auth, space, 'admin');
    const stages = this.cleanStages(input.stages);
    if (input.enabled && !stages.length) throw badRequest('Ein Freigabeablauf braucht mindestens eine Stufe');
    this.s.db.run(
      `INSERT INTO approval_workflows (space_id, enabled, stages, distinct_approvers, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(space_id) DO UPDATE SET enabled = excluded.enabled, stages = excluded.stages, distinct_approvers = excluded.distinct_approvers,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      space.id,
      input.enabled ? 1 : 0,
      JSON.stringify(stages),
      input.distinctApprovers === false ? 0 : 1,
      auth.user?.id ?? null,
      nowIso(),
    );
    this.s.emit(auth, {
      type: 'space.approval_workflow_changed',
      spaceId: space.id,
      target: { type: 'space', id: space.id, label: space.name },
      data: { enabled: input.enabled, stages: stages.map((st) => st.name) },
    });
    return this.get(auth, spaceKey);
  }

  private cleanStages(stages: Stage[]): Stage[] {
    if (stages.length > MAX_STAGES) throw badRequest(`Höchstens ${MAX_STAGES} Stufen`);
    return stages.map((stage, index) => {
      const name = String(stage.name ?? '').trim().slice(0, 60);
      if (!name) throw badRequest(`Stufe ${index + 1}: Bitte einen Namen angeben`);
      const approvers: StageApprover[] = [];
      const seen = new Set<string>();
      for (const a of (stage.approvers ?? []).slice(0, 50)) {
        if (a.type !== 'group' && a.type !== 'user') continue;
        const id = Number(a.id);
        if (a.type === 'group' && !this.s.db.value('SELECT 1 FROM groups WHERE id = ?', id)) throw badRequest(`Stufe „${name}“: Gruppe existiert nicht`);
        if (a.type === 'user' && !this.s.users.get(id)) throw badRequest(`Stufe „${name}“: Person existiert nicht`);
        if (seen.has(`${a.type}:${id}`)) continue;
        seen.add(`${a.type}:${id}`);
        approvers.push({ type: a.type, id });
      }
      if (!approvers.length) throw badRequest(`Stufe „${name}“: Bitte Freigebende wählen`);
      return {
        name,
        approvers,
        minApprovals: Math.max(1, Math.min(10, Math.round(Number(stage.minApprovals) || 1))),
        escalateDays: Math.max(0, Math.min(60, Math.round(Number(stage.escalateDays) || 0))),
      };
    });
  }

  private approverLabels(approvers: StageApprover[]) {
    const groups = new Map(
      this.s.db
        .all<{ id: number; name: string }>(`SELECT id, name FROM groups WHERE id IN ${Db.placeholders(Math.max(1, approvers.length))}`, ...(approvers.length ? approvers.map((a) => a.id) : [0]))
        .map((g) => [g.id, g.name]),
    );
    const users = this.s.users.refs(approvers.filter((a) => a.type === 'user').map((a) => a.id));
    return approvers.map((a) => ({ ...a, label: a.type === 'group' ? (groups.get(a.id) ?? `#${a.id}`) : (users.get(a.id)?.displayName ?? `#${a.id}`) }));
  }

  /* ------------------------------ Vertretungen ------------------------------ */

  /** Aktive Vertretungen einer Person an einem Tag. */
  deputiesOf(userId: number, day = localDay()): number[] {
    return this.s.db.all<{ deputy_id: number }>('SELECT deputy_id FROM user_deputies WHERE user_id = ? AND starts_on <= ? AND ends_on >= ?', userId, day, day).map((r) => r.deputy_id);
  }

  /** Personen, die `deputyId` an einem Tag vertritt. */
  principalsOf(deputyId: number, day = localDay()): number[] {
    return this.s.db.all<{ user_id: number }>('SELECT user_id FROM user_deputies WHERE deputy_id = ? AND starts_on <= ? AND ends_on >= ?', deputyId, day, day).map((r) => r.user_id);
  }

  private deputyDto(row: DeputyRow) {
    const refs = this.s.users.refs([row.user_id, row.deputy_id]);
    const today = localDay();
    return {
      id: row.id,
      user: refs.get(row.user_id) ?? null,
      deputy: refs.get(row.deputy_id) ?? null,
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      note: row.note,
      active: row.starts_on <= today && row.ends_on >= today,
    };
  }

  listDeputies(auth: AuthContext, userId?: number) {
    const me = this.s.perms.requireUser(auth);
    const target = userId ?? me.id;
    if (target !== me.id) {
      this.s.perms.requireGlobal(auth, 'users.manage');
      this.s.users.require(target);
    }
    const today = localDay();
    return {
      absences: this.s.db.all<DeputyRow>('SELECT * FROM user_deputies WHERE user_id = ? AND ends_on >= ? ORDER BY starts_on', target, today).map((r) => this.deputyDto(r)),
      actingFor: this.s.db.all<DeputyRow>('SELECT * FROM user_deputies WHERE deputy_id = ? AND ends_on >= ? ORDER BY starts_on', target, today).map((r) => this.deputyDto(r)),
    };
  }

  setDeputy(auth: AuthContext, input: { userId?: number; deputyId: number; startsOn: string; endsOn: string; note?: string }) {
    const me = this.s.perms.requireUser(auth);
    const userId = input.userId ?? me.id;
    if (userId !== me.id) this.s.perms.requireGlobal(auth, 'users.manage');
    const owner = this.s.users.require(userId);
    if (userId !== me.id) this.s.users.requireManageable(auth, userId);
    const deputy = this.s.users.require(input.deputyId);
    if (deputy.id === userId) throw badRequest('Eine Person kann sich nicht selbst vertreten');
    if (deputy.status !== 'active' || deputy.kind !== 'user') throw badRequest('Die Vertretung muss ein aktives Personenkonto sein');
    const day = /^\d{4}-\d{2}-\d{2}$/;
    if (!day.test(input.startsOn) || !day.test(input.endsOn) || input.startsOn > input.endsOn) throw badRequest('Bitte einen gültigen Zeitraum angeben');
    if (input.endsOn < localDay()) throw badRequest('Der Zeitraum liegt in der Vergangenheit');
    const res = this.s.db.run(
      'INSERT INTO user_deputies (user_id, deputy_id, starts_on, ends_on, note, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      userId,
      deputy.id,
      input.startsOn,
      input.endsOn,
      (input.note ?? '').slice(0, 300),
      me.id,
      nowIso(),
    );
    this.s.emit(auth, {
      type: 'user.deputy_set',
      target: { type: 'user', id: userId, label: owner.username },
      data: { deputy: deputy.username, startsOn: input.startsOn, endsOn: input.endsOn },
    });
    if (deputy.id !== me.id) {
      this.s.notifications.push({
        userId: deputy.id,
        type: 'deputy.assigned',
        actorId: me.id,
        title: `Vertretung für ${owner.display_name}: ${new Date(input.startsOn).toLocaleDateString('de-DE')} – ${new Date(input.endsOn).toLocaleDateString('de-DE')}`,
        body: 'Du entscheidest in dieser Zeit über Freigaben in ihrem bzw. seinem Namen.',
        link: '/reviews',
      });
    }
    return this.deputyDto(this.s.db.get<DeputyRow>('SELECT * FROM user_deputies WHERE id = ?', res.lastInsertRowid)!);
  }

  removeDeputy(auth: AuthContext, id: number): void {
    const me = this.s.perms.requireUser(auth);
    const row = this.s.db.get<DeputyRow>('SELECT * FROM user_deputies WHERE id = ?', id);
    if (!row) throw notFound('Vertretung nicht gefunden');
    if (row.user_id !== me.id) {
      this.s.perms.requireGlobal(auth, 'users.manage');
      this.s.users.requireManageable(auth, row.user_id);
    }
    this.s.db.run('DELETE FROM user_deputies WHERE id = ?', id);
  }

  /* ------------------------------ Stufen ------------------------------ */

  snapshot(row: ReviewRow): Snapshot | null {
    if (!row.stages) return null;
    const parsed = parseJson<Snapshot | null>(row.stages, null);
    return parsed?.stages?.length ? parsed : null;
  }

  /** Freigabeberechtigte einer Stufe (aktive Personenkonten). */
  eligible(stage: Stage, space: SpaceRow): Set<number> {
    const ids = new Set<number>();
    const groups = stage.approvers.filter((a) => a.type === 'group').map((a) => a.id);
    for (const a of stage.approvers) if (a.type === 'user') ids.add(a.id);
    if (groups.length) for (const m of this.s.db.all<{ user_id: number }>(`SELECT user_id FROM group_members WHERE group_id IN ${Db.placeholders(groups.length)}`, ...groups)) ids.add(m.user_id);
    const active = ids.size
      ? new Set(this.s.db.all<{ id: number }>(`SELECT id FROM users WHERE status = 'active' AND kind = 'user' AND id IN ${Db.placeholders(ids.size)}`, ...ids).map((u) => u.id))
      : new Set<number>();
    // Niemand erreichbar: Bereichsverwaltung springt ein, damit der Auftrag nicht hängen bleibt
    return active.size ? active : new Set(this.s.spaces.moderatorIds(space));
  }

  private decisions(row: ReviewRow): DecisionRow[] {
    return this.s.db.all<DecisionRow>('SELECT * FROM review_decisions WHERE review_id = ? AND version = ? ORDER BY id', row.id, row.version);
  }

  private requiredApprovals(stage: Stage, eligible: Set<number>, requester: number | null): number {
    const possible = [...eligible].filter((id) => id !== requester).length;
    return Math.max(1, Math.min(stage.minApprovals, possible || 1));
  }

  /** Darf die angemeldete Person über die aktuelle Stufe entscheiden – selbst oder in Vertretung? */
  decisionRight(auth: AuthContext, row: ReviewRow, space: SpaceRow): DecisionRight {
    const snapshot = this.snapshot(row);
    const user = auth.user;
    if (!snapshot || !user) return { can: false, onBehalfOf: null, reason: null };
    if (row.status !== 'open') return { can: false, onBehalfOf: null, reason: 'Der Prüfauftrag ist abgeschlossen' };
    if (row.requested_by === user.id) return { can: false, onBehalfOf: null, reason: 'Die eigene Prüfanforderung kann nicht selbst freigegeben werden' };
    const stage = snapshot.stages[row.current_stage];
    if (!stage) return { can: false, onBehalfOf: null, reason: null };
    const decisions = this.decisions(row);
    const here = decisions.filter((d) => d.stage === row.current_stage);
    const earlier = decisions.filter((d) => d.stage < row.current_stage && d.decision === 'approved');
    const decidedEarlier = (id: number) => snapshot.distinct && earlier.some((d) => d.user_id === id || d.on_behalf_of === id);
    const decidedHere = (id: number) => here.some((d) => d.user_id === id || d.on_behalf_of === id);
    if (decidedEarlier(user.id)) return { can: false, onBehalfOf: null, reason: 'Du hast eine frühere Stufe freigegeben – jede Stufe braucht eine andere Person' };
    if (here.some((d) => d.user_id === user.id)) return { can: false, onBehalfOf: null, reason: 'Du hast in dieser Stufe bereits entschieden' };
    const eligible = this.eligible(stage, space);
    if (eligible.has(user.id) && !decidedHere(user.id)) return { can: true, onBehalfOf: null, reason: null };
    for (const principal of this.principalsOf(user.id)) {
      if (eligible.has(principal) && principal !== row.requested_by && !decidedHere(principal) && !decidedEarlier(principal)) return { can: true, onBehalfOf: principal, reason: null };
    }
    return { can: false, onBehalfOf: null, reason: `Für die Stufe „${stage.name}“ bist du nicht als freigebende Person (oder Vertretung) eingetragen` };
  }

  /** Entscheidung festhalten und den Auftrag weiterführen. Liefert das Ergebnis für den Aufrufer. */
  decide(auth: AuthContext, row: ReviewRow, page: PageRow, space: SpaceRow, approve: boolean, note: string): 'pending' | 'advanced' | 'approved' | 'rejected' {
    const snapshot = this.snapshot(row)!;
    const right = this.decisionRight(auth, row, space);
    if (!right.can) throw forbidden(right.reason ?? 'Keine Berechtigung für diese Freigabestufe');
    const user = this.s.perms.requireUser(auth);
    const principal = right.onBehalfOf ? this.s.users.get(right.onBehalfOf) : undefined;
    const stage = snapshot.stages[row.current_stage];
    const now = nowIso();
    this.s.db.run(
      'INSERT INTO review_decisions (review_id, stage, version, user_id, user_name, on_behalf_of, on_behalf_name, decision, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      row.id,
      row.current_stage,
      row.version,
      user.id,
      user.displayName,
      principal?.id ?? null,
      principal?.display_name ?? null,
      approve ? 'approved' : 'rejected',
      note.slice(0, 2000),
      now,
    );
    const url = pageUrl(space.key, page.id, page.title);
    const label = `Stufe ${row.current_stage + 1} von ${snapshot.stages.length} „${stage.name}“`;
    if (!approve) return 'rejected';

    const approvals = this.decisions(row).filter((d) => d.stage === row.current_stage && d.decision === 'approved').length;
    if (approvals < this.requiredApprovals(stage, this.eligible(stage, space), row.requested_by)) {
      this.s.emit(auth, { type: 'review.stage_decision', spaceId: space.id, pageId: page.id, target: { type: 'page', id: page.id, label: page.title }, data: { reviewId: row.id, stage: stage.name, approvals } });
      return 'pending';
    }
    this.s.emit(auth, {
      type: 'review.stage_approved',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'page', id: page.id, label: page.title },
      data: { reviewId: row.id, stage: stage.name, index: row.current_stage, onBehalfOf: principal?.username ?? null },
    });
    if (row.current_stage + 1 >= snapshot.stages.length) return 'approved';

    this.s.db.run('UPDATE page_reviews SET current_stage = ?, stage_started_at = ? WHERE id = ?', row.current_stage + 1, now, row.id);
    const next = this.s.db.get<ReviewRow>('SELECT * FROM page_reviews WHERE id = ?', row.id)!;
    this.notifyStage(page, space, next);
    if (row.requested_by && row.requested_by !== user.id) {
      this.s.notifications.push({
        userId: row.requested_by,
        type: 'review.stage_approved',
        actorId: user.id,
        pageId: page.id,
        spaceId: space.id,
        title: `${label} freigegeben: ${page.title}`,
        body: `Weiter mit „${snapshot.stages[row.current_stage + 1].name}“.`,
        link: url,
      });
    }
    return 'advanced';
  }

  /** Neue Version während eines laufenden Ablaufs: wieder bei der ersten Stufe beginnen. */
  restart(row: ReviewRow, page: PageRow, space: SpaceRow): void {
    if (!this.snapshot(row)) return;
    this.s.db.run('UPDATE page_reviews SET current_stage = 0, stage_started_at = ? WHERE id = ?', nowIso(), row.id);
    this.notifyStage(page, space, this.s.db.get<ReviewRow>('SELECT * FROM page_reviews WHERE id = ?', row.id)!);
  }

  /** Freigebende der aktuellen Stufe und ihre aktiven Vertretungen benachrichtigen. */
  notifyStage(page: PageRow, space: SpaceRow, row: ReviewRow, escalation = false): number {
    const snapshot = this.snapshot(row);
    if (!snapshot) return 0;
    const stage = snapshot.stages[row.current_stage];
    const recipients = new Map<number, string | null>();
    for (const id of this.eligible(stage, space)) {
      recipients.set(id, null);
      for (const deputy of this.deputiesOf(id)) if (!recipients.has(deputy)) recipients.set(deputy, this.s.users.get(id)?.display_name ?? null);
    }
    if (escalation) for (const id of this.s.spaces.moderatorIds(space)) if (!recipients.has(id)) recipients.set(id, null);
    recipients.delete(row.requested_by ?? -1);
    const label = `Stufe ${row.current_stage + 1} von ${snapshot.stages.length} „${stage.name}“`;
    for (const [userId, forName] of recipients) {
      this.s.notifications.push({
        userId,
        type: 'review.requested',
        actorId: escalation ? null : row.requested_by,
        pageId: page.id,
        spaceId: space.id,
        title: `${escalation ? 'Freigabe überfällig' : 'Freigabe erbeten'} (${label}): ${page.title}`,
        body: forName ? `In Vertretung für ${forName}. ${row.note}` : row.note,
        link: pageUrl(space.key, page.id, page.title),
      });
    }
    return recipients.size;
  }

  /** Fortschritt für die Anzeige. */
  describe(auth: AuthContext, row: ReviewRow, space: SpaceRow) {
    const snapshot = this.snapshot(row);
    if (!snapshot) return null;
    const decisions = this.decisions(row);
    const refs = this.s.users.refs(decisions.flatMap((d) => [d.user_id, d.on_behalf_of]));
    const ref = (id: number | null, name: string | null): UserRef | null => (id ? (refs.get(id) ?? null) : name ? { id: 0, username: '', displayName: name, avatarColor: null } as UserRef : null);
    const right = this.decisionRight(auth, row, space);
    return {
      currentStage: row.current_stage,
      stageStartedAt: row.stage_started_at,
      distinctApprovers: snapshot.distinct,
      onBehalfOf: right.onBehalfOf ? this.s.users.refOf(right.onBehalfOf) : null,
      blockedReason: right.can ? null : right.reason,
      stages: snapshot.stages.map((stage, index) => {
        const eligible = this.eligible(stage, space);
        return {
          name: stage.name,
          minApprovals: this.requiredApprovals(stage, eligible, row.requested_by),
          escalateDays: stage.escalateDays,
          approvers: this.approverLabels(stage.approvers),
          state: row.status === 'approved' || index < row.current_stage ? 'done' : index === row.current_stage ? (row.status === 'open' ? 'current' : row.status) : 'pending',
          decisions: decisions
            .filter((d) => d.stage === index)
            .map((d) => ({ user: ref(d.user_id, d.user_name), onBehalfOf: ref(d.on_behalf_of, d.on_behalf_name), decision: d.decision, note: d.note, createdAt: d.created_at })),
        };
      }),
    };
  }

  /* ------------------------------ Eskalation ------------------------------ */

  schedule(): void {
    const run = () => {
      if (new Date().getHours() < this.s.settings.get('mailDigestHour')) return;
      try {
        this.runEscalations();
      } catch (err) {
        this.s.log.error({ err }, 'Eskalation von Freigaben fehlgeschlagen');
      }
    };
    setTimeout(run, 50_000).unref();
    this.timer = setInterval(run, 60 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  runEscalations(now = new Date()): number {
    let escalated = 0;
    for (const row of this.s.db.all<ReviewRow>("SELECT * FROM page_reviews WHERE status = 'open' AND stages IS NOT NULL LIMIT 2000")) {
      const snapshot = this.snapshot(row);
      const stage = snapshot?.stages[row.current_stage];
      if (!stage?.escalateDays || !row.stage_started_at) continue;
      if (now.getTime() < new Date(row.stage_started_at).getTime() + stage.escalateDays * 86400_000) continue;
      const page = this.s.pages.get(row.page_id);
      const space = page ? this.s.spaces.get(page.space_id) : undefined;
      if (!page || !space || page.deleted_at) continue;
      if (!this.s.db.run('INSERT OR IGNORE INTO review_escalations (review_id, stage, stage_started_at, sent_at) VALUES (?, ?, ?, ?)', row.id, row.current_stage, row.stage_started_at, now.toISOString()).changes) continue;
      this.notifyStage(page, space, row, true);
      escalated++;
    }
    return escalated;
  }
}
