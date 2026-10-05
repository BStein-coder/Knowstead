/**
 * Lesebestätigungen für Pflichtdokumente.
 *
 * Die Bereichsverwaltung legt auf einer Seite fest, wer sie „gelesen und verstanden“ bestätigen muss
 * (Gruppen, Personen oder alle mit Leserecht im Bereich), bis wann und mit welchem Text. Knowstead erinnert
 * über Benachrichtigungen und E-Mail – bei Zuweisung, kurz vor der Frist und bei Überschreitung –
 * und führt eine Nachweisliste.
 *
 * Runden: Eine Bestätigung zählt, wenn sie mindestens die geforderte Version betrifft und in der
 * aktuellen Runde abgegeben wurde. Eine neue Runde beginnt mit einer neuen (nicht geringfügigen)
 * Version – sofern „bei Änderungen erneut bestätigen“ gilt – und nach Ablauf der Wiederholung
 * (z. B. jährliche Unterweisung). Bestätigungen werden nie gelöscht.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { PageRow, SpaceRow, UserRef, UserRow } from '../../core/types.ts';
import { Db, nowIso, parseJson } from '../../db/database.ts';
import { badRequest, forbidden, notFound } from '../../core/errors.ts';
import { pageUrl } from '../pages/service.ts';
import { addMonths } from '../pages/reviewcycle.ts';
import { translator, type Locale } from '../../core/i18n.ts';

export const DEFAULT_STATEMENT = 'Ich habe den Inhalt gelesen und verstanden.';
const DUE_SOON_DAYS = 3;

export interface AudienceEntry {
  type: 'group' | 'user' | 'space';
  id: number;
}

interface RequirementRow {
  page_id: number;
  audience: string;
  statement: string;
  due_days: number;
  reconfirm_on_change: number;
  repeat_months: number;
  required_version: number;
  cycle_started_at: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

interface ConfirmationRow {
  id: number;
  page_id: number;
  user_id: number | null;
  user_name: string;
  version: number;
  statement: string;
  confirmed_at: string;
}

export type ReadStatus = 'confirmed' | 'open' | 'overdue';

export interface RequirementInput {
  audience: AudienceEntry[];
  statement?: string;
  dueDays?: number;
  reconfirmOnChange?: boolean;
  repeatMonths?: number;
  /** Neue Runde beginnen: alle müssen erneut bestätigen */
  restart?: boolean;
}

export interface MyReadState {
  status: ReadStatus;
  dueAt: string;
  statement: string;
  confirmedAt: string | null;
  confirmedVersion: number | null;
}

export interface EvidenceRow {
  user: UserRef | null;
  userName: string;
  status: ReadStatus | 'former';
  confirmedAt: string | null;
  confirmedVersion: number | null;
  statement: string | null;
  /** Person gehört zur Zielgruppe, darf die Seite aber nicht lesen */
  noAccess: boolean;
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * 86400_000).toISOString();
}

export class ReadConfirmationService {
  private readonly s: Services;
  private timer: NodeJS.Timeout | null = null;

  constructor(s: Services) {
    this.s = s;
  }

  /* ------------------------------ Grundlagen ------------------------------ */

  private row(pageId: number): RequirementRow | undefined {
    return this.s.db.get<RequirementRow>('SELECT * FROM read_requirements WHERE page_id = ?', pageId);
  }

  private audience(row: RequirementRow): AudienceEntry[] {
    return parseJson<AudienceEntry[]>(row.audience, []);
  }

  dueAt(row: RequirementRow): string {
    return addDays(row.cycle_started_at, row.due_days);
  }

  /** Aktive Konten der Zielgruppe (ohne Dienstkonten). */
  private audienceUsers(row: RequirementRow, page: PageRow, space: SpaceRow): { users: UserRow[]; noAccess: Set<number> } {
    const entries = this.audience(row);
    const ids = new Set<number>();
    const groupIds = entries.filter((e) => e.type === 'group').map((e) => e.id);
    for (const e of entries) if (e.type === 'user') ids.add(e.id);
    if (groupIds.length) {
      for (const m of this.s.db.all<{ user_id: number }>(`SELECT user_id FROM group_members WHERE group_id IN ${Db.placeholders(groupIds.length)}`, ...groupIds)) ids.add(m.user_id);
    }
    const everyone = entries.some((e) => e.type === 'space');
    const rows = everyone
      ? this.s.db.all<UserRow>("SELECT * FROM users WHERE status = 'active' AND kind = 'user'")
      : ids.size
        ? this.s.db.all<UserRow>(`SELECT * FROM users WHERE status = 'active' AND kind = 'user' AND id IN ${Db.placeholders(ids.size)}`, ...ids)
        : [];
    const users: UserRow[] = [];
    const noAccess = new Set<number>();
    for (const user of rows) {
      const canView = this.s.perms.canViewPage(this.s.perms.forUser(user), page, space);
      if (everyone && !ids.has(user.id)) {
        // „Alle mit Leserecht im Bereich“ umfasst nur, wer die Seite tatsächlich lesen darf
        if (canView) users.push(user);
        continue;
      }
      users.push(user);
      if (!canView) noAccess.add(user.id);
    }
    return { users, noAccess };
  }

  /** Gehört die Person zur Zielgruppe? (ohne alle Konten zu laden) */
  private inAudience(row: RequirementRow, auth: AuthContext, page: PageRow, space: SpaceRow): boolean {
    const user = auth.user;
    if (!user) return false;
    const entries = this.audience(row);
    if (entries.some((e) => e.type === 'user' && e.id === user.id)) return true;
    const groups = entries.filter((e) => e.type === 'group').map((e) => e.id);
    if (groups.length && this.s.db.value(`SELECT 1 FROM group_members WHERE user_id = ? AND group_id IN ${Db.placeholders(groups.length)}`, user.id, ...groups)) return true;
    return entries.some((e) => e.type === 'space') && this.s.perms.canViewPage(auth, page, space);
  }

  private latestConfirmation(pageId: number, userId: number): ConfirmationRow | undefined {
    return this.s.db.get<ConfirmationRow>('SELECT * FROM read_confirmations WHERE page_id = ? AND user_id = ? ORDER BY confirmed_at DESC, id DESC LIMIT 1', pageId, userId);
  }

  private statusOf(row: RequirementRow, confirmation: ConfirmationRow | undefined, now = new Date()): ReadStatus {
    if (confirmation && confirmation.version >= row.required_version && confirmation.confirmed_at >= row.cycle_started_at) return 'confirmed';
    return now.toISOString() >= this.dueAt(row) ? 'overdue' : 'open';
  }

  private requireManage(auth: AuthContext, pageId: number): { page: PageRow; space: SpaceRow } {
    const { page, space } = this.s.pages.requireViewable(auth, pageId);
    if (!this.s.perms.canSpace(auth, space, 'moderate')) throw forbidden('Lesebestätigungen verwaltet die Bereichsverwaltung');
    return { page, space };
  }

  /* ------------------------------ Anzeige ------------------------------ */

  /** Stand der angemeldeten Person für den Seitenkopf – null, wenn keine Bestätigung von ihr verlangt wird. */
  forPage(auth: AuthContext, page: PageRow, space: SpaceRow): MyReadState | null {
    if (!auth.user || page.status !== 'current') return null;
    const row = this.row(page.id);
    if (!row || !this.inAudience(row, auth, page, space)) return null;
    const confirmation = this.latestConfirmation(page.id, auth.user.id);
    const status = this.statusOf(row, confirmation);
    return {
      status,
      dueAt: this.dueAt(row),
      statement: row.statement,
      confirmedAt: status === 'confirmed' ? confirmation!.confirmed_at : null,
      confirmedVersion: status === 'confirmed' ? confirmation!.version : null,
    };
  }

  requirementDto(row: RequirementRow, page: PageRow, space: SpaceRow) {
    const entries = this.audience(row);
    const groupNames = new Map(
      this.s.db.all<{ id: number; name: string }>(`SELECT id, name FROM groups WHERE id IN ${Db.placeholders(Math.max(1, entries.length))}`, ...(entries.length ? entries.map((e) => e.id) : [0])).map((g) => [g.id, g.name]),
    );
    const userRefs = this.s.users.refs(entries.filter((e) => e.type === 'user').map((e) => e.id));
    const { users, noAccess } = this.audienceUsers(row, page, space);
    const counts = { total: users.length, confirmed: 0, open: 0, overdue: 0, noAccess: noAccess.size };
    for (const user of users) counts[this.statusOf(row, this.latestConfirmation(page.id, user.id))]++;
    return {
      audience: entries.map((e) => ({
        type: e.type,
        id: e.id,
        label: e.type === 'group' ? (groupNames.get(e.id) ?? `#${e.id}`) : e.type === 'user' ? (userRefs.get(e.id)?.displayName ?? `#${e.id}`) : space.name,
      })),
      statement: row.statement,
      dueDays: row.due_days,
      reconfirmOnChange: !!row.reconfirm_on_change,
      repeatMonths: row.repeat_months,
      requiredVersion: row.required_version,
      cycleStartedAt: row.cycle_started_at,
      dueAt: this.dueAt(row),
      nextCycleAt: row.repeat_months ? addMonths(row.cycle_started_at, row.repeat_months) : null,
      createdBy: this.s.users.refOf(row.created_by),
      counts,
    };
  }

  get(auth: AuthContext, pageId: number) {
    const { page, space } = this.s.pages.requireViewable(auth, pageId);
    const row = this.row(pageId);
    const canManage = this.s.perms.canSpace(auth, space, 'moderate');
    return {
      canManage,
      requirement: row && canManage ? this.requirementDto(row, page, space) : null,
      active: !!row,
      me: this.forPage(auth, page, space),
    };
  }

  /* ------------------------------ Verwaltung ------------------------------ */

  set(auth: AuthContext, pageId: number, input: RequirementInput) {
    const { page, space } = this.requireManage(auth, pageId);
    if (page.status !== 'current' || page.deleted_at) throw badRequest('Lesebestätigungen gibt es nur für veröffentlichte Seiten');
    const audience = this.cleanAudience(input.audience);
    if (!audience.length) throw badRequest('Bitte eine Zielgruppe wählen');
    const statement = (input.statement ?? '').trim().slice(0, 500) || DEFAULT_STATEMENT;
    const dueDays = Math.max(1, Math.min(365, Math.round(input.dueDays ?? 14)));
    const repeatMonths = Math.max(0, Math.min(60, Math.round(input.repeatMonths ?? 0)));
    const existing = this.row(pageId);
    const now = nowIso();
    const restart = !existing || !!input.restart;
    this.s.db.run(
      `INSERT INTO read_requirements (page_id, audience, statement, due_days, reconfirm_on_change, repeat_months, required_version, cycle_started_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET audience = excluded.audience, statement = excluded.statement, due_days = excluded.due_days,
         reconfirm_on_change = excluded.reconfirm_on_change, repeat_months = excluded.repeat_months,
         required_version = CASE WHEN ? THEN excluded.required_version ELSE read_requirements.required_version END,
         cycle_started_at = CASE WHEN ? THEN excluded.cycle_started_at ELSE read_requirements.cycle_started_at END,
         updated_at = excluded.updated_at`,
      pageId,
      JSON.stringify(audience),
      statement,
      dueDays,
      input.reconfirmOnChange === false ? 0 : 1,
      repeatMonths,
      page.version,
      now,
      auth.user?.id ?? null,
      now,
      now,
      restart ? 1 : 0,
      restart ? 1 : 0,
    );
    this.s.emit(auth, {
      type: 'page.read_requirement_changed',
      spaceId: space.id,
      pageId,
      target: { type: 'page', id: pageId, label: page.title },
      data: { audience, dueDays, restart },
    });
    this.remindPage(pageId, new Date());
    return this.get(auth, pageId);
  }

  remove(auth: AuthContext, pageId: number): void {
    const { page, space } = this.requireManage(auth, pageId);
    if (!this.s.db.run('DELETE FROM read_requirements WHERE page_id = ?', pageId).changes) return;
    this.s.db.run('DELETE FROM read_reminders WHERE page_id = ?', pageId);
    this.s.emit(auth, { type: 'page.read_requirement_changed', spaceId: space.id, pageId, target: { type: 'page', id: pageId, label: page.title }, data: { removed: true } });
  }

  private cleanAudience(entries: AudienceEntry[]): AudienceEntry[] {
    const seen = new Set<string>();
    const result: AudienceEntry[] = [];
    for (const e of entries.slice(0, 200)) {
      if (!['group', 'user', 'space'].includes(e.type)) continue;
      const id = e.type === 'space' ? 0 : Number(e.id);
      if (e.type !== 'space' && !Number.isInteger(id)) continue;
      if (e.type === 'group' && !this.s.db.value('SELECT 1 FROM groups WHERE id = ?', id)) throw badRequest('Eine gewählte Gruppe existiert nicht');
      if (e.type === 'user' && !this.s.users.get(id)) throw badRequest('Eine gewählte Person existiert nicht');
      const key = `${e.type}:${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ type: e.type, id });
    }
    return result;
  }

  /** Neue Version veröffentlicht: bei „erneut bestätigen“ beginnt eine neue Runde. */
  onPageSaved(page: PageRow, minor: boolean): void {
    const row = this.row(page.id);
    if (!row || minor || !row.reconfirm_on_change || page.version <= row.required_version) return;
    this.s.db.run('UPDATE read_requirements SET required_version = ?, cycle_started_at = ?, updated_at = ? WHERE page_id = ?', page.version, nowIso(), nowIso(), page.id);
    this.remindPage(page.id, new Date());
  }

  /* ------------------------------ Bestätigen ------------------------------ */

  confirm(auth: AuthContext, pageId: number): MyReadState {
    const user = this.s.perms.requireUser(auth);
    const { page, space } = this.s.pages.requireViewable(auth, pageId);
    const row = this.row(pageId);
    if (!row) throw notFound('Für diese Seite wird keine Lesebestätigung verlangt');
    if (page.status !== 'current') throw badRequest('Nur veröffentlichte Seiten können bestätigt werden');
    if (!this.inAudience(row, auth, page, space)) throw forbidden('Du gehörst nicht zur Zielgruppe dieser Lesebestätigung');
    const current = this.forPage(auth, page, space)!;
    if (current.status === 'confirmed') return current;
    const now = nowIso();
    this.s.db.run(
      'INSERT INTO read_confirmations (page_id, user_id, user_name, version, statement, confirmed_at) VALUES (?, ?, ?, ?, ?, ?)',
      pageId,
      user.id,
      user.displayName,
      page.version,
      row.statement,
      now,
    );
    this.s.emit(auth, {
      type: 'page.read_confirmed',
      spaceId: space.id,
      pageId,
      target: { type: 'page', id: pageId, label: page.title },
      data: { version: page.version, statement: row.statement },
    });
    return this.forPage(auth, page, space)!;
  }

  /* ------------------------------ Nachweis ------------------------------ */

  evidence(auth: AuthContext, pageId: number): { page: { id: number; title: string; version: number }; rows: EvidenceRow[]; requirement: ReturnType<ReadConfirmationService['requirementDto']> | null } {
    const { page, space } = this.requireManage(auth, pageId);
    const row = this.row(pageId);
    const rows: EvidenceRow[] = [];
    const seen = new Set<number>();
    if (row) {
      const { users, noAccess } = this.audienceUsers(row, page, space);
      const refs = this.s.users.refs(users.map((u) => u.id));
      for (const user of users) {
        seen.add(user.id);
        const confirmation = this.latestConfirmation(pageId, user.id);
        const status = this.statusOf(row, confirmation);
        rows.push({
          user: refs.get(user.id) ?? null,
          userName: user.display_name,
          status,
          confirmedAt: confirmation?.confirmed_at ?? null,
          confirmedVersion: confirmation?.version ?? null,
          statement: confirmation?.statement ?? null,
          noAccess: noAccess.has(user.id),
        });
      }
    }
    // Frühere Bestätigungen von Personen außerhalb der aktuellen Zielgruppe bleiben sichtbar
    for (const c of this.s.db.all<ConfirmationRow>(
      'SELECT * FROM read_confirmations WHERE page_id = ? AND id IN (SELECT MAX(id) FROM read_confirmations WHERE page_id = ? GROUP BY COALESCE(user_id, -id))',
      pageId,
      pageId,
    )) {
      if (c.user_id && seen.has(c.user_id)) continue;
      rows.push({ user: this.s.users.refOf(c.user_id), userName: c.user_name, status: 'former', confirmedAt: c.confirmed_at, confirmedVersion: c.version, statement: c.statement, noAccess: false });
    }
    const order = { overdue: 0, open: 1, confirmed: 2, former: 3 };
    rows.sort((a, b) => order[a.status] - order[b.status] || a.userName.localeCompare(b.userName, 'de'));
    return { page: { id: page.id, title: page.title, version: page.version }, rows, requirement: row ? this.requirementDto(row, page, space) : null };
  }

  evidenceCsv(auth: AuthContext, pageId: number, locale: Locale = 'de'): string {
    const tr = translator(locale);
    const { page, rows } = this.evidence(auth, pageId);
    const label = { confirmed: 'bestätigt', open: 'offen', overdue: 'überfällig', former: 'nicht mehr in der Zielgruppe' };
    const cell = (v: unknown) => {
      let text = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [
      ['Seite', 'Person', 'Benutzername', 'Status', 'Bestätigt am', 'Version', 'Bestätigter Text', 'Hinweis'].map(tr),
      ...rows.map((r) => [
        page.title,
        r.userName,
        r.user?.username ?? '',
        tr(label[r.status]),
        r.confirmedAt ? new Date(r.confirmedAt).toLocaleString(locale === 'en' ? 'en-GB' : 'de-DE') : '',
        r.confirmedVersion ?? '',
        r.statement ?? '',
        r.noAccess ? tr('kein Leserecht auf die Seite') : '',
      ]),
    ];
    return `\ufeff${lines.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`;
  }

  /* ------------------------------ Übersichten ------------------------------ */

  /** Pflichtdokumente der angemeldeten Person. */
  mine(auth: AuthContext): { page: { id: number; title: string; url: string; spaceName: string }; state: MyReadState }[] {
    this.s.perms.requireUser(auth);
    const result: { page: { id: number; title: string; url: string; spaceName: string }; state: MyReadState }[] = [];
    for (const row of this.s.db.all<RequirementRow>('SELECT * FROM read_requirements')) {
      const page = this.s.pages.get(row.page_id);
      const space = page ? this.s.spaces.get(page.space_id) : undefined;
      if (!page || !space || page.deleted_at || !this.s.perms.canViewPage(auth, page, space)) continue;
      const state = this.forPage(auth, page, space);
      if (state) result.push({ page: { id: page.id, title: page.title, url: pageUrl(space.key, page.id, page.title), spaceName: space.name }, state });
    }
    const order = { overdue: 0, open: 1, confirmed: 2 };
    return result.sort((a, b) => order[a.state.status] - order[b.state.status] || a.state.dueAt.localeCompare(b.state.dueAt));
  }

  openCount(auth: AuthContext): number {
    if (!auth.user) return 0;
    try {
      return this.mine(auth).filter((x) => x.state.status !== 'confirmed').length;
    } catch {
      return 0;
    }
  }

  /** Anforderungen in Bereichen, die die Person verwaltet – mit Fortschritt. */
  managed(auth: AuthContext) {
    this.s.perms.requireUser(auth);
    const items = [];
    for (const row of this.s.db.all<RequirementRow>('SELECT * FROM read_requirements ORDER BY updated_at DESC')) {
      const page = this.s.pages.get(row.page_id);
      const space = page ? this.s.spaces.get(page.space_id) : undefined;
      if (!page || !space || page.deleted_at || !this.s.perms.canSpace(auth, space, 'moderate') || !this.s.perms.canViewPage(auth, page, space)) continue;
      items.push({ page: { id: page.id, title: page.title, url: pageUrl(space.key, page.id, page.title), spaceName: space.name }, requirement: this.requirementDto(row, page, space) });
    }
    return items;
  }

  /* ------------------------------ Erinnerungen ------------------------------ */

  schedule(): void {
    const run = () => {
      if (new Date().getHours() < this.s.settings.get('mailDigestHour')) return;
      try {
        this.runReminders();
      } catch (err) {
        this.s.log.error({ err }, 'Erinnerungen an Lesebestätigungen fehlgeschlagen');
      }
    };
    setTimeout(run, 40_000).unref();
    this.timer = setInterval(run, 60 * 60_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Wiederholungen starten und fällige Erinnerungen verschicken (je Runde und Art höchstens einmal). */
  runReminders(now = new Date()): { assigned: number; due: number; overdue: number; cycles: number } {
    const result = { assigned: 0, due: 0, overdue: 0, cycles: 0 };
    for (const row of this.s.db.all<RequirementRow>('SELECT * FROM read_requirements')) {
      if (row.repeat_months && now.toISOString() >= addMonths(row.cycle_started_at, row.repeat_months)) {
        this.s.db.run('UPDATE read_requirements SET cycle_started_at = ?, updated_at = ? WHERE page_id = ?', now.toISOString(), now.toISOString(), row.page_id);
        result.cycles++;
      }
      const sent = this.remindPage(row.page_id, now);
      result.assigned += sent.assigned;
      result.due += sent.due;
      result.overdue += sent.overdue;
    }
    return result;
  }

  private remindPage(pageId: number, now: Date): { assigned: number; due: number; overdue: number } {
    const counts = { assigned: 0, due: 0, overdue: 0 };
    const row = this.row(pageId);
    const page = this.s.pages.get(pageId);
    const space = page ? this.s.spaces.get(page.space_id) : undefined;
    if (!row || !page || !space || page.deleted_at || page.status !== 'current') return counts;
    const dueAt = this.dueAt(row);
    const dueText = new Date(dueAt).toLocaleDateString('de-DE');
    const url = pageUrl(space.key, page.id, page.title);
    const { users, noAccess } = this.audienceUsers(row, page, space);
    for (const user of users) {
      if (noAccess.has(user.id)) continue;
      if (this.statusOf(row, this.latestConfirmation(pageId, user.id), now) === 'confirmed') continue;
      const kinds: ('assigned' | 'due' | 'overdue')[] = ['assigned'];
      if (now.toISOString() >= dueAt) kinds.push('overdue');
      else if (now.getTime() >= new Date(dueAt).getTime() - DUE_SOON_DAYS * 86400_000) kinds.push('due');
      for (const kind of kinds) {
        const inserted = this.s.db.run('INSERT OR IGNORE INTO read_reminders (page_id, user_id, kind, cycle, sent_at) VALUES (?, ?, ?, ?, ?)', pageId, user.id, kind, row.cycle_started_at, now.toISOString()).changes;
        if (!inserted) continue;
        // Zuweisung und Überfälligkeit am selben Tag: nur die dringendere Nachricht
        if (kind === 'assigned' && kinds.includes('overdue')) continue;
        this.s.notifications.push({
          userId: user.id,
          type: kind === 'overdue' ? 'read.overdue' : kind === 'due' ? 'read.due' : 'read.required',
          spaceId: space.id,
          pageId,
          title:
            kind === 'overdue'
              ? `Lesebestätigung überfällig: „${page.title}“`
              : kind === 'due'
                ? `Lesebestätigung bis ${dueText}: „${page.title}“`
                : `Bitte lesen und bestätigen: „${page.title}“`,
          body: kind === 'overdue' ? `Die Frist ist am ${dueText} abgelaufen.` : `${row.statement} – bitte bis zum ${dueText} bestätigen.`,
          link: url,
        });
        counts[kind]++;
      }
    }
    return counts;
  }

  /** Offene Personen jetzt erinnern (höchstens einmal täglich je Person). */
  remindNow(auth: AuthContext, pageId: number): { reminded: number } {
    const { page, space } = this.requireManage(auth, pageId);
    const row = this.row(pageId);
    if (!row) throw notFound('Für diese Seite wird keine Lesebestätigung verlangt');
    const today = new Date().toISOString().slice(0, 10);
    let reminded = 0;
    const { users, noAccess } = this.audienceUsers(row, page, space);
    for (const user of users) {
      if (noAccess.has(user.id) || this.statusOf(row, this.latestConfirmation(pageId, user.id)) === 'confirmed') continue;
      if (!this.s.db.run('INSERT OR IGNORE INTO read_reminders (page_id, user_id, kind, cycle, sent_at) VALUES (?, ?, ?, ?, ?)', pageId, user.id, 'manual', `${row.cycle_started_at}:${today}`, nowIso()).changes) continue;
      this.s.notifications.push({
        userId: user.id,
        type: 'read.due',
        actorId: auth.user?.id,
        spaceId: space.id,
        pageId,
        title: `Erinnerung: Bitte „${page.title}“ lesen und bestätigen`,
        body: `${row.statement} – Frist: ${new Date(this.dueAt(row)).toLocaleDateString('de-DE')}`,
        link: pageUrl(space.key, page.id, page.title),
      });
      reminded++;
    }
    return { reminded };
  }
}
