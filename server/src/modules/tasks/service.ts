/**
 * Aufgabenplaner.
 *
 * Bewusst schlank gehalten – ein Plan („Board“) gehört zu einem Bereich und
 * besteht aus frei benennbaren Spalten (Buckets). Eine Aufgabe hat Titel,
 * Verantwortliche, Fälligkeit, Priorität, Fortschritt, optionale Checkliste und
 * kann mit einer Seite verknüpft sein. Rechte kommen vom Bereich: wer dort
 * schreiben darf, darf auch planen.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { SpaceRow, UserRef } from '../../core/types.ts';
import { nowIso, parseJson } from '../../db/database.ts';
import { badRequest, notFound } from '../../core/errors.ts';
import { pageUrl } from '../pages/service.ts';
import { translator, type Locale } from '../../core/i18n.ts';
import type { DependencyDto, DependencyInput, DependencyRow } from './dependencies.ts';

export interface Bucket {
  id: string;
  name: string;
  color?: string;
}

export const DEFAULT_BUCKETS: Bucket[] = [
  { id: 'todo', name: 'Zu erledigen', color: '#64748b' },
  { id: 'doing', name: 'In Arbeit', color: '#2563eb' },
  { id: 'review', name: 'Prüfung', color: '#a855f7' },
  { id: 'done', name: 'Erledigt', color: '#16a34a' },
];

/** Spalten neuer Pläne in der Sprache der anlegenden Person */
const DEFAULT_BUCKET_NAMES_EN: Record<string, string> = { todo: 'To do', doing: 'In progress', review: 'Review', done: 'Done' };

export interface BoardRow {
  id: number;
  space_id: number;
  name: string;
  description: string;
  buckets: string;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  auto_schedule: number;
}

export interface TaskRow {
  id: number;
  board_id: number;
  bucket: string;
  title: string;
  notes: string;
  assignee_id: number | null;
  due_date: string | null;
  start_date: string | null;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'doing' | 'done';
  progress: number;
  page_id: number | null;
  labels: string;
  checklist: string;
  position: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  recurrence: string | null;
  series_id: number | null;
  progress_from_checklist: number;
  deleted_at: string | null;
  deleted_by: number | null;
}

export interface Recurrence {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
}

export interface ChecklistItem {
  text: string;
  done: boolean;
}

export interface TaskDto {
  id: number;
  boardId: number;
  boardName: string;
  spaceKey: string;
  spaceName: string;
  bucket: string;
  title: string;
  notes: string;
  assignee: UserRef | null;
  dueDate: string | null;
  startDate: string | null;
  priority: TaskRow['priority'];
  status: TaskRow['status'];
  progress: number;
  page: { id: number; title: string; url: string } | null;
  labels: string[];
  checklist: ChecklistItem[];
  position: number;
  createdBy: UserRef | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Fällig und nicht erledigt */
  overdue: boolean;
  /** Wiederholung – beim Erledigen entsteht die nächste Aufgabe */
  recurrence: Recurrence | null;
  seriesId: number | null;
  /** Fortschritt folgt dem Anteil erledigter Checklistenpunkte statt dem Regler */
  progressFromChecklist: boolean;
  /** Aufgaben, auf die diese wartet */
  predecessors: DependencyDto[];
  /** Aufgaben, die auf diese warten */
  successors: DependencyDto[];
  /** Eine Vorgängerin ist noch nicht so weit (FS: nicht erledigt, SS: nicht begonnen) */
  blocked: boolean;
  /** Nachrichten im Chat der Aufgabe */
  commentCount: number;
  /** davon für die abfragende Person ungelesen (von anderen geschrieben, seit sie den Chat zuletzt offen hatte) */
  unreadComments: number;
}

/** Abhängigkeiten eines ganzen Plans – vermeidet eine Abfrage je Aufgabe */
interface DependencyContext {
  rows: DependencyRow[];
  tasks: Map<number, TaskRow>;
}

export interface BoardDto {
  id: number;
  spaceId: number;
  spaceKey: string;
  spaceName: string;
  name: string;
  description: string;
  buckets: Bucket[];
  canEdit: boolean;
  /** Darf im Chat der Aufgaben schreiben (ab Rolle „Kommentieren“) */
  canComment: boolean;
  /** Nachfolgerinnen automatisch verschieben, wenn sich Termine ändern */
  autoSchedule: boolean;
  counts: { total: number; done: number; overdue: number };
  createdAt: string;
}

/** Ein Plan als Projekt: Fortschritt, nächster Termin und Beteiligte auf einen Blick (Übersicht „Projekte“). */
export interface ProjectDto extends BoardDto {
  spaceIcon: string | null;
  spaceColor: string | null;
  summary: {
    /** Aufgaben in Arbeit */
    doing: number;
    /** Nächste offene Aufgabe mit Termin – der „nächste Meilenstein“ */
    nextTask: { id: number; title: string; dueDate: string } | null;
    /** Frühester Beginn und spätester Termin aller Aufgaben */
    startDate: string | null;
    dueDate: string | null;
    /** Wer die meisten Aufgaben hat (höchstens fünf) und wie viele Menschen insgesamt beteiligt sind */
    assignees: UserRef[];
    assigneeCount: number;
    /** Letzte Änderung an einer Aufgabe */
    updatedAt: string | null;
  };
}

export interface TaskInput {
  title?: string;
  notes?: string;
  bucket?: string;
  assigneeId?: number | null;
  dueDate?: string | null;
  startDate?: string | null;
  priority?: TaskRow['priority'];
  status?: TaskRow['status'];
  progress?: number;
  pageId?: number | null;
  labels?: string[];
  checklist?: ChecklistItem[];
  position?: number;
  recurrence?: Recurrence | null;
  /** Fortschritt aus der Checkliste berechnen statt vom Regler übernehmen */
  progressFromChecklist?: boolean;
  /** Ersetzt alle Vorgängerinnen */
  predecessors?: DependencyInput[];
}

const PRIORITIES: TaskRow['priority'][] = ['low', 'normal', 'high', 'urgent'];
const STATUSES: TaskRow['status'][] = ['open', 'doing', 'done'];
/** Genug für Kunde, Technik, Standort … – vorher war bei zehn Schluss, ohne jeden Hinweis */
const MAX_LABELS = 30;
/** Obergrenze für Sammeländerungen – hält Transaktion und Ereignisse überschaubar */
const MAX_BULK = 100;

/** Anteil erledigter Punkte; ohne Checkliste gibt es nichts zu rechnen. */
function checklistProgress(items: ChecklistItem[]): number | null {
  if (!items.length) return null;
  return Math.round((items.filter((c) => c.done).length / items.length) * 100);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class TaskService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /* --------------------------------- Boards --------------------------------- */

  boardRow(id: number): BoardRow {
    const row = this.s.db.get<BoardRow>('SELECT * FROM task_boards WHERE id = ?', id);
    if (!row) throw notFound('Plan nicht gefunden');
    return row;
  }

  private spaceOf(board: BoardRow): SpaceRow {
    return this.s.spaces.require(board.space_id);
  }

  boardDto(auth: AuthContext, row: BoardRow): BoardDto {
    const space = this.spaceOf(row);
    const counts = this.s.db.get<{ total: number; done: number; overdue: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END), 0) AS done,
              COALESCE(SUM(CASE WHEN status != 'done' AND due_date IS NOT NULL AND due_date < ? THEN 1 ELSE 0 END), 0) AS overdue
         FROM tasks WHERE board_id = ? AND deleted_at IS NULL`,
      today(),
      row.id,
    ) ?? { total: 0, done: 0, overdue: 0 };
    return {
      id: row.id,
      spaceId: space.id,
      spaceKey: space.key,
      spaceName: space.name,
      name: row.name,
      description: row.description,
      buckets: parseJson<Bucket[]>(row.buckets, DEFAULT_BUCKETS),
      canEdit: this.s.perms.canSpace(auth, space, 'edit'),
      canComment: this.s.perms.canSpace(auth, space, 'comment'),
      autoSchedule: row.auto_schedule !== 0,
      counts,
      createdAt: row.created_at,
    };
  }

  /** Alle Pläne eines Bereichs (legt beim ersten Aufruf keinen an). */
  listBoards(auth: AuthContext, spaceKey: string): BoardDto[] {
    const space = this.s.spaces.requireViewable(auth, spaceKey);
    return this.s.db
      .all<BoardRow>('SELECT * FROM task_boards WHERE space_id = ? ORDER BY name COLLATE NOCASE', space.id)
      .map((r) => this.boardDto(auth, r));
  }

  /** Pläne aller sichtbaren Bereiche (für die Auswahl in Makros). */
  allBoards(auth: AuthContext): BoardDto[] {
    const spaceIds = this.s.perms.viewableSpaceIds(auth);
    if (!spaceIds.length) return [];
    return this.s.db
      .all<BoardRow>(`SELECT * FROM task_boards WHERE space_id IN (${spaceIds.map(() => '?').join(',')}) ORDER BY name COLLATE NOCASE`, ...spaceIds)
      .map((r) => this.boardDto(auth, r));
  }

  /** Übersicht „Projekte“: die Pläne aller sichtbaren Bereiche mit Kennzahlen, nächstem Termin und Beteiligten. */
  projects(auth: AuthContext): ProjectDto[] {
    this.s.perms.requireUser(auth);
    return this.allBoards(auth).map((board) => {
      const space = this.s.spaces.require(board.spaceId);
      const agg = this.s.db.get<{ doing: number; start_date: string | null; due_date: string | null; updated_at: string | null }>(
        `SELECT COALESCE(SUM(CASE WHEN status = 'doing' THEN 1 ELSE 0 END), 0) AS doing,
                MIN(start_date) AS start_date, MAX(due_date) AS due_date, MAX(updated_at) AS updated_at
           FROM tasks WHERE board_id = ? AND deleted_at IS NULL`,
        board.id,
      );
      const next = this.s.db.get<{ id: number; title: string; due_date: string }>(
        `SELECT id, title, due_date FROM tasks
          WHERE board_id = ? AND deleted_at IS NULL AND status != 'done' AND due_date IS NOT NULL
          ORDER BY due_date, position LIMIT 1`,
        board.id,
      );
      const people = this.s.db.all<{ assignee_id: number }>(
        `SELECT assignee_id FROM tasks WHERE board_id = ? AND deleted_at IS NULL AND assignee_id IS NOT NULL
          GROUP BY assignee_id ORDER BY COUNT(*) DESC, assignee_id`,
        board.id,
      );
      const refs = people.map((p) => this.s.users.refOf(p.assignee_id)).filter((u): u is UserRef => !!u);
      return {
        ...board,
        spaceIcon: space.icon,
        spaceColor: space.color,
        summary: {
          doing: agg?.doing ?? 0,
          nextTask: next ? { id: next.id, title: next.title, dueDate: next.due_date } : null,
          startDate: agg?.start_date ?? null,
          dueDate: agg?.due_date ?? null,
          assignees: refs.slice(0, 5),
          assigneeCount: refs.length,
          updatedAt: agg?.updated_at ?? null,
        },
      };
    });
  }

  private defaultBuckets(auth: AuthContext): Bucket[] {
    if ((auth.locale ?? this.s.settings.get('defaultLocale')) !== 'en') return DEFAULT_BUCKETS;
    return DEFAULT_BUCKETS.map((b) => ({ ...b, name: DEFAULT_BUCKET_NAMES_EN[b.id] ?? b.name }));
  }

  createBoard(auth: AuthContext, spaceKey: string, input: { name: string; description?: string; buckets?: Bucket[] }): BoardDto {
    const space = this.s.spaces.requireByKey(spaceKey);
    this.s.perms.requireSpace(auth, space, 'edit');
    const name = input.name.trim();
    if (!name) throw badRequest('Bitte einen Namen für den Plan angeben');
    const now = nowIso();
    const res = this.s.db.run(
      'INSERT INTO task_boards (space_id, name, description, buckets, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      space.id,
      name,
      input.description ?? '',
      JSON.stringify(this.cleanBuckets(input.buckets) ?? this.defaultBuckets(auth)),
      auth.user?.id ?? null,
      now,
      now,
    );
    const board = this.boardRow(res.lastInsertRowid);
    this.s.emit(auth, {
      type: 'task.board_created',
      spaceId: space.id,
      target: { type: 'board', id: board.id, label: board.name },
    });
    return this.boardDto(auth, board);
  }

  updateBoard(auth: AuthContext, id: number, input: { name?: string; description?: string; buckets?: Bucket[]; autoSchedule?: boolean }): BoardDto {
    const row = this.boardRow(id);
    this.s.perms.requireSpace(auth, this.spaceOf(row), 'edit');
    const buckets = this.cleanBuckets(input.buckets);
    const autoSchedule = input.autoSchedule === undefined ? row.auto_schedule !== 0 : input.autoSchedule;
    this.s.db.transaction(() => {
      this.s.db.run(
        'UPDATE task_boards SET name = ?, description = ?, buckets = ?, auto_schedule = ?, updated_at = ? WHERE id = ?',
        input.name?.trim() || row.name,
        input.description ?? row.description,
        JSON.stringify(buckets ?? parseJson<Bucket[]>(row.buckets, DEFAULT_BUCKETS)),
        autoSchedule ? 1 : 0,
        nowIso(),
        id,
      );
      // Karten aus entfernten Spalten landen in der ersten Spalte statt unsichtbar zu werden.
      if (buckets) {
        this.s.db.run(
          `UPDATE tasks SET bucket = ?, updated_at = ? WHERE board_id = ? AND bucket NOT IN (${buckets.map(() => '?').join(',')})`,
          buckets[0].id,
          nowIso(),
          id,
          ...buckets.map((b) => b.id),
        );
      }
    });
    // Eingeschaltet: vorhandene Verletzungen sofort auflösen
    if (autoSchedule && row.auto_schedule === 0) {
      this.s.taskDependencies.reschedule(this.s.db.all<{ id: number }>('SELECT id FROM tasks WHERE board_id = ? AND deleted_at IS NULL', id).map((t) => t.id));
    }
    return this.boardDto(auth, this.boardRow(id));
  }

  deleteBoard(auth: AuthContext, id: number): void {
    const row = this.boardRow(id);
    this.s.perms.requireSpace(auth, this.spaceOf(row), 'admin');
    this.s.db.run('DELETE FROM task_boards WHERE id = ?', id);
    this.s.emit(auth, { type: 'task.board_deleted', spaceId: row.space_id, target: { type: 'board', id, label: row.name } });
  }

  private cleanBuckets(buckets?: Bucket[]): Bucket[] | null {
    if (!buckets) return null;
    const used = new Set<string>();
    const clean = buckets
      .filter((b) => b && typeof b.name === 'string' && b.name.trim())
      .slice(0, 12)
      .map((b, i) => {
        let id = (b.id || `b${i + 1}`).toString().replace(/[^a-z0-9_-]/gi, '').slice(0, 30) || `b${i + 1}`;
        // Doppelte Kennungen würden Karten zwei Spalten zuordnen.
        for (let n = 2; used.has(id); n++) id = `${id.slice(0, 26)}-${n}`;
        used.add(id);
        return { id, name: b.name.trim().slice(0, 40), color: typeof b.color === 'string' && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : undefined };
      });
    if (!clean.length) throw badRequest('Ein Plan braucht mindestens eine Spalte');
    return clean;
  }

  /* -------------------------------- Aufgaben -------------------------------- */

  taskRow(id: number): TaskRow {
    const row = this.s.db.get<TaskRow>('SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL', id);
    if (!row) throw notFound('Aufgabe nicht gefunden');
    return row;
  }

  /**
   * Aufgaben zu Kennungen laden – nur aus Bereichen, die diese Person sehen darf. Abhängigkeiten dürfen
   * über Pläne und Bereiche hinweg zeigen; fremde Titel dürfen dabei nicht durchsickern.
   */
  private visibleTasks(auth: AuthContext, ids: number[]): Map<number, TaskRow> {
    if (!ids.length) return new Map();
    const rows = this.s.db.all<TaskRow & { space_id: number }>(
      `SELECT t.*, b.space_id FROM tasks t JOIN task_boards b ON b.id = t.board_id
        WHERE t.deleted_at IS NULL AND t.id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    );
    const allowed = new Set(this.s.perms.viewableSpaceIds(auth));
    return new Map(rows.filter((r) => allowed.has(r.space_id)).map((r) => [r.id, r] as const));
  }

  /** Abhängigkeiten einer einzelnen Aufgabe samt der beteiligten Aufgaben laden. */
  private dependencyContext(auth: AuthContext, taskId: number): DependencyContext {
    const rows = this.s.taskDependencies.forTask(taskId);
    return { rows, tasks: this.visibleTasks(auth, [...new Set(rows.flatMap((r) => [r.task_id, r.predecessor_id]))]) };
  }

  toDto(auth: AuthContext, row: TaskRow, board?: BoardRow, deps?: DependencyContext, commentCounts?: Map<number, number>, unread?: Map<number, number>): TaskDto {
    const b = board ?? this.boardRow(row.board_id);
    const context = deps ?? this.dependencyContext(auth, row.id);
    const dependencies = this.s.taskDependencies.describe(row, context.rows, context.tasks);
    const space = this.s.spaces.require(b.space_id);
    // Verknüpfte Seite nur zeigen, wenn die betrachtende Person sie sehen darf (Titel könnte vertraulich sein).
    const linked = row.page_id ? this.s.pages.get(row.page_id) : undefined;
    const pageSpace = linked ? this.s.spaces.get(linked.space_id) : undefined;
    const page = linked && pageSpace && this.s.perms.canViewPage(auth, linked, pageSpace) ? linked : undefined;
    return {
      id: row.id,
      boardId: row.board_id,
      boardName: b.name,
      spaceKey: space.key,
      spaceName: space.name,
      bucket: row.bucket,
      title: row.title,
      notes: row.notes,
      assignee: this.s.users.refOf(row.assignee_id),
      dueDate: row.due_date,
      startDate: row.start_date,
      priority: row.priority,
      status: row.status,
      progress: row.progress,
      page: page && pageSpace ? { id: page.id, title: page.title, url: pageUrl(pageSpace.key, page.id, page.title) } : null,
      labels: parseJson<string[]>(row.labels, []),
      checklist: parseJson<ChecklistItem[]>(row.checklist, []),
      position: row.position,
      createdBy: this.s.users.refOf(row.created_by),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
      overdue: row.status !== 'done' && !!row.due_date && row.due_date < today(),
      recurrence: cleanRecurrence(parseJson<Recurrence | null>(row.recurrence, null)),
      seriesId: row.series_id,
      progressFromChecklist: row.progress_from_checklist !== 0,
      commentCount: commentCounts ? (commentCounts.get(row.id) ?? 0) : this.s.taskComments.count(row.id),
      unreadComments: (unread ?? this.s.taskComments.unreadCounts(auth.user?.id, [row.id])).get(row.id) ?? 0,
      ...dependencies,
    };
  }

  list(auth: AuthContext, boardId: number): TaskDto[] {
    const board = this.boardRow(boardId);
    this.s.perms.requireSpace(auth, this.spaceOf(board), 'view');
    const rows = this.s.db.all<TaskRow>('SELECT * FROM tasks WHERE board_id = ? AND deleted_at IS NULL ORDER BY position, id', boardId);
    const depRows = this.s.taskDependencies.forBoard(boardId);
    const tasks = new Map(rows.map((r) => [r.id, r] as const));
    // Verknüpfte Aufgaben aus anderen Plänen nachladen, damit Pfeile und Namen auch dort erscheinen
    const foreign = [...new Set(depRows.flatMap((r) => [r.task_id, r.predecessor_id]))].filter((id) => !tasks.has(id));
    for (const [id, task] of this.visibleTasks(auth, foreign)) tasks.set(id, task);
    const deps: DependencyContext = { rows: depRows, tasks };
    const ids = rows.map((r) => r.id);
    const commentCounts = this.s.taskComments.counts(ids);
    const unread = this.s.taskComments.unreadCounts(auth.user?.id, ids);
    return rows.map((r) => this.toDto(auth, r, board, deps, commentCounts, unread));
  }

  /**
   * Plan als CSV – für Besprechungen, Berichte und die Weiterverarbeitung in Excel. Semikolon als
   * Trennzeichen und BOM, damit Excel die Datei auf Deutsch direkt richtig öffnet.
   */
  exportCsv(auth: AuthContext, boardId: number, locale: Locale = 'de'): { filename: string; csv: string } {
    const board = this.boardRow(boardId);
    const space = this.spaceOf(board);
    this.s.perms.requireSpace(auth, space, 'view');
    const tr = translator(locale);
    const buckets = new Map(parseJson<Bucket[]>(board.buckets, DEFAULT_BUCKETS).map((b) => [b.id, b.name]));
    const tasks = this.list(auth, boardId);
    const statusLabel = { open: 'Offen', doing: 'In Arbeit', done: 'Erledigt' } as const;
    const priorityLabel = { low: 'Niedrig', normal: 'Normal', high: 'Hoch', urgent: 'Dringend' } as const;
    // Führende Steuerzeichen entschärfen: Tabellenprogramme würden „=…“ sonst als Formel auswerten
    const cell = (value: unknown) => {
      let text = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
      return /[;"\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [
      ['Titel', 'Spalte', 'Status', 'Fortschritt %', 'Verantwortlich', 'Beginn', 'Fällig', 'Überfällig', 'Priorität', 'Stichwörter', 'Checkliste', 'Wartet auf', 'Beschreibung', 'Nachrichten'].map(tr),
      ...tasks.map((t) => [
        t.title,
        buckets.get(t.bucket) ?? t.bucket,
        tr(statusLabel[t.status]),
        t.progress,
        t.assignee?.displayName ?? '',
        t.startDate ?? '',
        t.dueDate ?? '',
        t.overdue ? tr('ja') : '',
        tr(priorityLabel[t.priority]),
        t.labels.join(', '),
        t.checklist.length ? `${t.checklist.filter((c) => c.done).length}/${t.checklist.length}` : '',
        t.predecessors.map((p) => p.title).join(', '),
        t.notes.replace(/\s+/g, ' ').trim(),
        t.commentCount,
      ]),
    ];
    const name = board.name.replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'plan';
    return {
      filename: `${name}-${new Date().toISOString().slice(0, 10)}.csv`,
      csv: `\ufeff${lines.map((l) => l.map(cell).join(';')).join('\r\n')}\r\n`,
    };
  }

  /** Aufgaben über Bereiche hinweg – für „Meine Aufgaben“ und Makros. */
  query(
    auth: AuthContext,
    filter: { assignee?: 'me' | number; status?: TaskRow['status'] | 'open-all'; dueFrom?: string; dueBefore?: string; spanFrom?: string; spanTo?: string; spaceKey?: string; boardId?: number; pageId?: number; limit?: number },
  ): TaskDto[] {
    this.s.perms.requireUser(auth);
    const spaceIds = filter.spaceKey ? [this.s.spaces.requireViewable(auth, filter.spaceKey).id] : this.s.perms.viewableSpaceIds(auth);
    if (!spaceIds.length) return [];
    const where: string[] = ['t.deleted_at IS NULL', `b.space_id IN (${spaceIds.map(() => '?').join(',')})`];
    const params: (string | number)[] = [...spaceIds];
    if (filter.boardId) {
      where.push('t.board_id = ?');
      params.push(filter.boardId);
    }
    if (filter.pageId) {
      where.push('t.page_id = ?');
      params.push(filter.pageId);
    }
    if (filter.assignee !== undefined) {
      where.push('t.assignee_id = ?');
      params.push(filter.assignee === 'me' ? (auth.user?.id ?? 0) : filter.assignee);
    }
    if (filter.status === 'open-all') where.push("t.status != 'done'");
    else if (filter.status) {
      where.push('t.status = ?');
      params.push(filter.status);
    }
    if (filter.dueFrom) {
      where.push('t.due_date IS NOT NULL AND t.due_date >= ?');
      params.push(filter.dueFrom);
    }
    if (filter.dueBefore) {
      where.push('t.due_date IS NOT NULL AND t.due_date <= ?');
      params.push(filter.dueBefore);
    }
    // Zeitraum einer Aufgabe = Beginn bis Fälligkeit; fehlt eines von beiden, zählt das andere als einziger Tag.
    // Gefragt sind Aufgaben, deren Zeitraum den angegebenen berührt (auch solche, die ihn ganz überspannen).
    if (filter.spanFrom || filter.spanTo) {
      where.push('(t.start_date IS NOT NULL OR t.due_date IS NOT NULL)');
      if (filter.spanTo) {
        where.push('MIN(COALESCE(t.start_date, t.due_date), COALESCE(t.due_date, t.start_date)) <= ?');
        params.push(filter.spanTo);
      }
      if (filter.spanFrom) {
        where.push('MAX(COALESCE(t.start_date, t.due_date), COALESCE(t.due_date, t.start_date)) >= ?');
        params.push(filter.spanFrom);
      }
    }
    const rows = this.s.db.all<TaskRow & { board_name: string }>(
      `SELECT t.*, b.name AS board_name FROM tasks t JOIN task_boards b ON b.id = t.board_id
        WHERE ${where.join(' AND ')}
        ORDER BY CASE WHEN t.due_date IS NULL THEN 1 ELSE 0 END, t.due_date, t.position
        LIMIT ?`,
      ...params,
      Math.min(filter.limit ?? 100, 500),
    );
    // Abhängigkeiten gebündelt laden statt je Aufgabe einzeln – sonst kostet „Meine Aufgaben“ bei
    // 500 Treffern 500 zusätzliche Abfragen.
    const rowsById = new Map(rows.map((r) => [r.id, r] as const));
    const depRows = rows.length
      ? this.s.db.all<DependencyRow>(
          `SELECT * FROM task_dependencies WHERE task_id IN (${rows.map(() => '?').join(',')}) OR predecessor_id IN (${rows.map(() => '?').join(',')})`,
          ...rows.map((r) => r.id),
          ...rows.map((r) => r.id),
        )
      : [];
    const missing = [...new Set(depRows.flatMap((d) => [d.task_id, d.predecessor_id]))].filter((id) => !rowsById.has(id));
    const tasks = new Map<number, TaskRow>(rowsById);
    for (const [id, task] of this.visibleTasks(auth, missing)) tasks.set(id, task);
    const deps: DependencyContext = { rows: depRows, tasks };
    // Pläne ebenfalls gebündelt: `toDto` würde sie sonst je Aufgabe einzeln nachschlagen
    const boardIds = [...new Set([...tasks.values()].map((t) => t.board_id))];
    const boards = new Map(
      boardIds.length
        ? this.s.db.all<BoardRow>(`SELECT * FROM task_boards WHERE id IN (${boardIds.map(() => '?').join(',')})`, ...boardIds).map((b) => [b.id, b] as const)
        : [],
    );
    const ids = rows.map((r) => r.id);
    const commentCounts = this.s.taskComments.counts(ids);
    const unread = this.s.taskComments.unreadCounts(auth.user?.id, ids);
    return rows.map((r) => this.toDto(auth, r, boards.get(r.board_id), deps, commentCounts, unread));
  }

  create(auth: AuthContext, boardId: number, input: TaskInput, options: { notify?: boolean; seriesId?: number | null } = {}): TaskDto {
    const board = this.boardRow(boardId);
    const space = this.spaceOf(board);
    this.s.perms.requireSpace(auth, space, 'edit');
    const title = (input.title ?? '').trim();
    if (!title) throw badRequest('Bitte einen Titel für die Aufgabe angeben');
    const buckets = parseJson<Bucket[]>(board.buckets, DEFAULT_BUCKETS);
    const doneBucket = buckets.length > 1 ? buckets[buckets.length - 1].id : null;
    let bucket = buckets.some((b) => b.id === input.bucket) ? input.bucket! : buckets[0].id;
    let status: TaskRow['status'] = STATUSES.includes(input.status as TaskRow['status']) ? (input.status as TaskRow['status']) : 'open';
    // Die letzte Spalte gilt als „erledigt“ – Status und Spalte bleiben stimmig.
    if (bucket === doneBucket) status = 'done';
    else if (status === 'done' && doneBucket && input.bucket === undefined) bucket = doneBucket;
    const now = nowIso();
    const checklist = cleanChecklist(input.checklist);
    const fromChecklist = input.progressFromChecklist === true;
    const progress = status === 'done' ? 100 : ((fromChecklist ? checklistProgress(checklist) : null) ?? clamp(input.progress ?? 0));
    const maxPos = this.s.db.value<number>('SELECT COALESCE(MAX(position), 0) FROM tasks WHERE board_id = ? AND bucket = ? AND deleted_at IS NULL', boardId, bucket) ?? 0;
    // Alles oder nichts: Scheitert eine Vorgängerin (Kreis, anderer Plan), entsteht auch keine halbe Aufgabe
    const task = this.s.db.transaction(() => {
      const res = this.s.db.run(
        `INSERT INTO tasks (board_id, bucket, title, notes, assignee_id, due_date, start_date, priority, status, progress, page_id,
                            labels, checklist, position, created_by, created_at, updated_at, completed_at, recurrence, series_id,
                            progress_from_checklist)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        boardId,
        bucket,
        title.slice(0, 300),
        (input.notes ?? '').slice(0, 5000),
        this.validAssignee(input.assigneeId, space),
        cleanDate(input.dueDate),
        cleanDate(input.startDate),
        PRIORITIES.includes(input.priority as TaskRow['priority']) ? input.priority : 'normal',
        status,
        progress,
        this.validPage(auth, input.pageId),
        JSON.stringify((input.labels ?? []).slice(0, MAX_LABELS)),
        JSON.stringify(checklist),
        maxPos + 1,
        auth.user?.id ?? null,
        now,
        now,
        status === 'done' ? now : null,
        input.recurrence ? JSON.stringify(cleanRecurrence(input.recurrence)) : null,
        options.seriesId ?? null,
        fromChecklist ? 1 : 0,
      );
      const created = this.taskRow(res.lastInsertRowid);
      if (!input.predecessors?.length) return created;
      this.s.taskDependencies.setPredecessors(auth, created, input.predecessors);
      if (board.auto_schedule) this.s.taskDependencies.rescheduleTask(created);
      return this.taskRow(created.id);
    });
    this.s.emit(auth, {
      type: 'task.created',
      spaceId: space.id,
      pageId: task.page_id,
      target: { type: 'task', id: task.id, label: task.title },
      data: { board: board.name, assignee: task.assignee_id },
    });
    if (options.notify !== false) this.notifyAssignee(auth, task, board, space.key);
    return this.toDto(auth, task, board);
  }

  update(auth: AuthContext, id: number, input: TaskInput): TaskDto {
    const row = this.taskRow(id);
    const board = this.boardRow(row.board_id);
    const space = this.spaceOf(board);
    this.s.perms.requireSpace(auth, space, 'edit');
    const buckets = parseJson<Bucket[]>(board.buckets, DEFAULT_BUCKETS);
    const doneBucket = buckets.length > 1 ? buckets[buckets.length - 1].id : null;
    const bucketGiven = input.bucket !== undefined && buckets.some((b) => b.id === input.bucket);
    let bucket = bucketGiven ? input.bucket! : row.bucket;
    const statusGiven = STATUSES.includes(input.status as TaskRow['status']);
    let status = statusGiven ? (input.status as TaskRow['status']) : row.status;
    const wasDone = row.status === 'done';
    // Spalte „erledigt“ und Status gegenseitig nachführen (wie beim Verschieben per Drag & Drop)
    if (doneBucket) {
      if (bucketGiven && bucket !== row.bucket) {
        if (bucket === doneBucket) status = 'done';
        else if (row.bucket === doneBucket && !statusGiven && status === 'done') status = 'open';
      } else if (statusGiven && status !== row.status) {
        if (status === 'done') bucket = doneBucket;
        else if (row.bucket === doneBucket) bucket = buckets[0].id;
      }
    }
    const now = nowIso();
    // Fortschritt: aus der Checkliste, sonst vom Regler. „Erledigt“ bleibt 100 %.
    const checklist = input.checklist ? cleanChecklist(input.checklist) : parseJson<ChecklistItem[]>(row.checklist, []);
    const fromChecklist = input.progressFromChecklist ?? row.progress_from_checklist !== 0;
    const computed = fromChecklist ? checklistProgress(checklist) : null;
    const progress =
      status === 'done' ? 100 : (computed ?? (input.progress !== undefined ? clamp(input.progress) : wasDone && row.progress === 100 ? 0 : row.progress));
    let rescheduled: number[] = [];
    // Alles oder nichts: Wird eine Vorgängerin abgelehnt (Kreis, anderer Plan), bleiben auch die übrigen Felder unverändert
    this.s.db.transaction(() => {
      this.s.db.run(
        `UPDATE tasks SET bucket = ?, title = ?, notes = ?, assignee_id = ?, due_date = ?, start_date = ?, priority = ?, status = ?,
                          progress = ?, page_id = ?, labels = ?, checklist = ?, position = ?, updated_at = ?, recurrence = ?,
                          progress_from_checklist = ?,
                          completed_at = CASE WHEN ? = 'done' THEN COALESCE(completed_at, ?) ELSE NULL END
         WHERE id = ?`,
        bucket,
        (input.title ?? row.title).trim().slice(0, 300) || row.title,
        input.notes !== undefined ? input.notes.slice(0, 5000) : row.notes,
        input.assigneeId !== undefined && input.assigneeId !== row.assignee_id ? this.validAssignee(input.assigneeId, space) : row.assignee_id,
        input.dueDate !== undefined ? cleanDate(input.dueDate) : row.due_date,
        input.startDate !== undefined ? cleanDate(input.startDate) : row.start_date,
        PRIORITIES.includes(input.priority as TaskRow['priority']) ? input.priority : row.priority,
        status,
        progress,
        input.pageId !== undefined && input.pageId !== row.page_id ? this.validPage(auth, input.pageId) : row.page_id,
        input.labels ? JSON.stringify(input.labels.slice(0, MAX_LABELS)) : row.labels,
        JSON.stringify(checklist),
        input.position ?? row.position,
        now,
        input.recurrence !== undefined ? (input.recurrence ? JSON.stringify(cleanRecurrence(input.recurrence)) : null) : row.recurrence,
        fromChecklist ? 1 : 0,
        status,
        now,
        id,
      );
      if (input.predecessors) this.s.taskDependencies.setPredecessors(auth, row, input.predecessors);
      if (!board.auto_schedule) return;
      // Mit automatischer Planung bleibt der Plan frei von Konflikten: Neue Vorgängerinnen, geänderte Termine oder
      // eine wieder geöffnete Aufgabe legen sie hinter ihre Vorgängerinnen, danach rücken die Nachfolgerinnen nach.
      const current = this.taskRow(id);
      const datesChanged = current.start_date !== row.start_date || current.due_date !== row.due_date;
      const reopened = wasDone && current.status !== 'done';
      if (input.predecessors || datesChanged || reopened) rescheduled = this.s.taskDependencies.rescheduleTask(current).filter((taskId) => taskId !== id);
    });
    const updated = this.taskRow(id);
    if (!wasDone && updated.status === 'done') {
      this.spawnNext(auth, updated, board);
      this.s.emit(auth, {
        type: 'task.completed',
        spaceId: space.id,
        pageId: updated.page_id,
        target: { type: 'task', id, label: updated.title },
      });
    } else {
      this.s.emit(auth, {
        type: 'task.updated',
        spaceId: space.id,
        pageId: updated.page_id,
        target: { type: 'task', id, label: updated.title },
        data: rescheduled.length ? { rescheduled: rescheduled.length } : undefined,
      });
    }
    if (updated.assignee_id && updated.assignee_id !== row.assignee_id) this.notifyAssignee(auth, updated, board, space.key);
    // Neu lesen: Beim Erledigen kann die Wiederholung an die Folgeaufgabe übergegangen sein.
    return this.toDto(auth, this.taskRow(id), board);
  }

  /**
   * Mehrere Aufgaben in einem Zug ändern oder in den Papierkorb legen – spart zehn Dialoge, wenn ein
   * Arbeitspaket den Verantwortlichen wechselt. Rechte werden je Aufgabe geprüft; entweder gelingt alles
   * oder nichts.
   */
  bulk(auth: AuthContext, ids: number[], input: { patch?: TaskInput; delete?: boolean }): { changed: number } {
    const unique = [...new Set(ids)].filter((id) => Number.isInteger(id));
    if (!unique.length) throw badRequest('Bitte mindestens eine Aufgabe auswählen');
    if (unique.length > MAX_BULK) throw badRequest(`Höchstens ${MAX_BULK} Aufgaben auf einmal`);
    if (!input.delete && !input.patch) throw badRequest('Keine Änderung angegeben');
    return this.s.db.transaction(() => {
      for (const id of unique) {
        if (input.delete) this.delete(auth, id);
        else this.update(auth, id, input.patch!);
      }
      return { changed: unique.length };
    });
  }

  /** Verschieben innerhalb des Plans (Spalte und Reihenfolge). */
  move(auth: AuthContext, id: number, bucket: string, index: number): TaskDto {
    const row = this.taskRow(id);
    const board = this.boardRow(row.board_id);
    this.s.perms.requireSpace(auth, this.spaceOf(board), 'edit');
    const buckets = parseJson<Bucket[]>(board.buckets, DEFAULT_BUCKETS);
    const target = buckets.some((b) => b.id === bucket) ? bucket : row.bucket;
    const others = this.s.db
      .all<TaskRow>('SELECT * FROM tasks WHERE board_id = ? AND bucket = ? AND id != ? AND deleted_at IS NULL ORDER BY position, id', row.board_id, target, id)
      .map((t) => t.id);
    others.splice(Math.max(0, Math.min(index, others.length)), 0, id);
    this.s.db.transaction(() => {
      others.forEach((taskId, i) => this.s.db.run('UPDATE tasks SET position = ?, bucket = ?, updated_at = ? WHERE id = ?', i + 1, target, nowIso(), taskId));
      // Erledigt-Spalte setzt den Status mit (wie in gängigen Planern).
      const lastBucket = buckets[buckets.length - 1];
      if (target === lastBucket?.id) this.s.db.run("UPDATE tasks SET status = 'done', progress = 100, completed_at = COALESCE(completed_at, ?) WHERE id = ?", nowIso(), id);
      else if (row.status === 'done') {
        this.s.db.run("UPDATE tasks SET status = 'open', progress = CASE WHEN progress = 100 THEN 0 ELSE progress END, completed_at = NULL WHERE id = ?", id);
        // Wieder offen: wie beim Bearbeiten hinter die Vorgängerinnen legen
        if (board.auto_schedule) this.s.taskDependencies.rescheduleTask(this.taskRow(id));
      }
    });
    const moved = this.taskRow(id);
    if (row.status !== 'done' && moved.status === 'done') {
      this.spawnNext(auth, moved, board);
      this.s.emit(auth, { type: 'task.completed', spaceId: board.space_id, pageId: moved.page_id, target: { type: 'task', id, label: moved.title } });
    } else {
      // Auch das Umsortieren melden – andere sehen die Karte sonst erst nach dem Neuladen an ihrem neuen Platz
      this.s.emit(auth, { type: 'task.updated', spaceId: board.space_id, pageId: moved.page_id, target: { type: 'task', id, label: moved.title } });
    }
    return this.toDto(auth, this.taskRow(id), board);
  }

  /** Löschen legt die Aufgabe in den Papierkorb des Bereichs (siehe `TaskTrashService`). */
  delete(auth: AuthContext, id: number): void {
    this.s.taskTrash.moveToTrash(auth, id);
  }

  /* ------------------------------ Wiederholung ------------------------------ */

  /**
   * Nächste Aufgabe einer Serie anlegen, sobald eine wiederkehrende Aufgabe erledigt ist.
   * Die Wiederholung wandert zur neuen Aufgabe; verpasste Termine werden übersprungen.
   */
  private spawnNext(auth: AuthContext, task: TaskRow, board: BoardRow): void {
    const rule = cleanRecurrence(parseJson<Recurrence | null>(task.recurrence, null));
    if (!rule) return;
    const base = task.due_date ?? today();
    let next = advance(base, rule);
    for (let guard = 0; next < today() && guard < 1000; guard++) next = advance(next, rule);
    const shift = daysBetween(base, next);
    const start = task.start_date ? shiftDay(task.start_date, shift) : null;
    const seriesId = task.series_id ?? task.id;
    const buckets = parseJson<Bucket[]>(board.buckets, DEFAULT_BUCKETS);
    try {
      this.create(
        this.s.perms.system(),
        board.id,
        {
          title: task.title,
          notes: task.notes,
          bucket: buckets[0]?.id,
          assigneeId: task.assignee_id,
          dueDate: next,
          startDate: start,
          priority: task.priority,
          pageId: task.page_id,
          labels: parseJson<string[]>(task.labels, []),
          checklist: parseJson<ChecklistItem[]>(task.checklist, []).map((c) => ({ text: c.text, done: false })),
          recurrence: rule,
        },
        { notify: false, seriesId },
      );
      this.s.db.run('UPDATE tasks SET recurrence = NULL, series_id = ? WHERE id = ?', seriesId, task.id);
    } catch (err) {
      this.s.log.warn({ err, task: task.id }, 'Nächste wiederkehrende Aufgabe konnte nicht angelegt werden');
    }
  }

  /* ------------------------------ Erinnerungen ------------------------------ */

  private reminderTimer: NodeJS.Timeout | null = null;

  schedule(): void {
    const run = () => {
      try {
        this.runReminders();
      } catch (err) {
        this.s.log.error({ err }, 'Aufgaben-Erinnerungen fehlgeschlagen');
      }
    };
    setTimeout(run, 45_000).unref();
    this.reminderTimer = setInterval(run, 60 * 60_000);
    this.reminderTimer.unref();
  }

  stop(): void {
    if (this.reminderTimer) clearInterval(this.reminderTimer);
    this.reminderTimer = null;
  }

  /**
   * Erinnert Verantwortliche vor der Fälligkeit (Vorlauf je Person, Standard 1 Tag)
   * und einmal kurz nach dem Termin. Läuft stündlich, verschickt aber erst ab der
   * Uhrzeit der täglichen Zusammenfassung, damit niemand nachts Mails bekommt.
   */
  runReminders(now = new Date(), options: { force?: boolean } = {}): { before: number; overdue: number } {
    const result = { before: 0, overdue: 0 };
    if (!options.force && now.getHours() < this.s.settings.get('mailDigestHour')) return result;
    const day = localDate(now);
    const horizon = shiftDay(day, 14);
    const rows = this.s.db.all<TaskRow & { space_id: number }>(
      `SELECT t.*, b.space_id FROM tasks t JOIN task_boards b ON b.id = t.board_id
        WHERE t.deleted_at IS NULL AND t.status != 'done' AND t.assignee_id IS NOT NULL
          AND t.due_date IS NOT NULL AND t.due_date <= ? AND t.due_date >= ?`,
      horizon,
      shiftDay(day, -3),
    );
    const prefsCache = new Map<number, number>();
    for (const task of rows) {
      const userId = task.assignee_id!;
      if (!prefsCache.has(userId)) {
        const value = Number(this.s.users.preferences(userId).taskReminderDays ?? 1);
        prefsCache.set(userId, [0, 1, 2, 3, 7].includes(value) ? value : -1);
      }
      const lead = prefsCache.get(userId)!;
      if (lead < 0) continue;
      const diff = daysBetween(day, task.due_date!);
      const kind = diff < 0 ? 'overdue' : diff <= lead ? 'before' : null;
      if (!kind) continue;
      if (this.s.db.value('SELECT 1 FROM task_reminders WHERE task_id = ? AND kind = ? AND due_date = ?', task.id, kind, task.due_date)) continue;
      const user = this.s.users.get(userId);
      const space = this.s.spaces.get(task.space_id);
      if (!user || user.status !== 'active' || !space) continue;
      // Wer den Bereich nicht mehr sehen darf, bekommt auch keine Erinnerung mehr.
      if (!this.s.perms.canSpace(this.s.perms.forUser(user), space, 'view')) continue;
      const dueText = new Date(`${task.due_date}T12:00:00`).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
      this.s.notifications.push({
        userId,
        type: kind === 'overdue' ? 'task.overdue' : 'task.due',
        spaceId: space.id,
        title:
          kind === 'overdue'
            ? `Aufgabe überfällig: ${task.title}`
            : diff === 0
              ? `Aufgabe heute fällig: ${task.title}`
              : `Aufgabe fällig ${diff === 1 ? 'morgen' : `am ${dueText}`}: ${task.title}`,
        body: kind === 'overdue' ? `Die Aufgabe war am ${dueText} fällig.` : '',
        link: `/s/${encodeURIComponent(space.key)}/tasks?board=${task.board_id}&task=${task.id}`,
      });
      this.s.db.run('INSERT OR IGNORE INTO task_reminders (task_id, kind, due_date, sent_at) VALUES (?, ?, ?, ?)', task.id, kind, task.due_date, now.toISOString());
      result[kind]++;
    }
    return result;
  }

  /** Anzahl offener Aufgaben des Benutzers (Navigation). */
  openForUser(auth: AuthContext): number {
    if (!auth.user) return 0;
    return this.s.db.value<number>("SELECT COUNT(*) FROM tasks WHERE assignee_id = ? AND status != 'done' AND deleted_at IS NULL", auth.user.id) ?? 0;
  }

  /** Verantwortlich kann nur sein, wer den Bereich sehen darf – sonst verrät die Benachrichtigung Interna. */
  private validAssignee(id: number | null | undefined, space: SpaceRow): number | null {
    if (id === null || id === undefined) return null;
    const user = this.s.users.get(id);
    if (!user || user.status !== 'active') throw badRequest('Diese Person gibt es nicht oder sie ist deaktiviert');
    if (!this.s.perms.canSpace(this.s.perms.forUser(user), space, 'view')) {
      throw badRequest(`${user.display_name} hat keinen Zugriff auf den Bereich „${space.name}“ und kann die Aufgabe nicht übernehmen`);
    }
    return user.id;
  }

  private validPage(auth: AuthContext, id: number | null | undefined): number | null {
    if (id === null || id === undefined) return null;
    const { page } = this.s.pages.requireViewable(auth, id);
    return page.id;
  }

  private notifyAssignee(auth: AuthContext, task: TaskRow, board: BoardRow, spaceKey: string): void {
    if (!task.assignee_id || task.assignee_id === auth.user?.id) return;
    this.s.notifications.push({
      userId: task.assignee_id,
      type: 'task.assigned',
      actorId: auth.user?.id ?? null,
      spaceId: board.space_id,
      pageId: task.page_id,
      title: `Aufgabe für dich: ${task.title}`,
      body: task.due_date ? `Fälligkeitsdatum: ${task.due_date}` : '',
      link: `/s/${encodeURIComponent(spaceKey)}/tasks?board=${board.id}&task=${task.id}`,
    });
  }
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
}

/** Nur ISO-Datumsangaben (YYYY-MM-DD) zulassen. */
function cleanDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(String(value))?.[1];
  // Den Tag muss es geben (kein 30. Februar) und das Jahr muss plausibel sein – sonst rechnen Abhängigkeiten
  // und Erinnerungen mit verschobenen Terminen, und die Zeitachse würde Jahrhunderte breit.
  const ms = day ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
  const year = day ? Number(day.slice(0, 4)) : 0;
  if (!day || Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== day || year < 1970 || year > 2199) {
    throw badRequest('Ungültiges Datum – bitte einen Tag zwischen 1970 und 2199 im Format JJJJ-MM-TT angeben');
  }
  return day;
}

function cleanChecklist(items: ChecklistItem[] | undefined): ChecklistItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((i) => i && typeof i.text === 'string' && i.text.trim())
    .slice(0, 30)
    .map((i) => ({ text: i.text.trim().slice(0, 200), done: !!i.done }));
}

/** Wiederholungsregel prüfen (nur bekannte Frequenzen, Intervall 1–52). */
export function cleanRecurrence(value: Recurrence | null | undefined): Recurrence | null {
  if (!value || typeof value !== 'object') return null;
  if (!['daily', 'weekly', 'monthly', 'yearly'].includes(value.freq)) return null;
  const interval = Math.round(Number(value.interval) || 1);
  return { freq: value.freq, interval: Math.max(1, Math.min(52, interval)) };
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** Tage auf ein ISO-Datum (YYYY-MM-DD) addieren. */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00.000Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00.000Z`)) / 86400_000);
}

/** Nächster Termin einer Serie; Monatsenden werden begrenzt (31.01. → 28./29.02.). */
export function advance(day: string, rule: Recurrence): string {
  if (rule.freq === 'daily') return shiftDay(day, rule.interval);
  if (rule.freq === 'weekly') return shiftDay(day, 7 * rule.interval);
  const d = new Date(`${day.slice(0, 10)}T00:00:00.000Z`);
  const date = d.getUTCDate();
  d.setUTCDate(1);
  if (rule.freq === 'monthly') d.setUTCMonth(d.getUTCMonth() + rule.interval);
  else d.setUTCFullYear(d.getUTCFullYear() + rule.interval);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(date, last));
  return d.toISOString().slice(0, 10);
}
