/**
 * Abhängigkeiten zwischen Aufgaben eines Plans.
 *
 * Eine Abhängigkeit verbindet eine Vorgängerin mit einer Nachfolgerin:
 *
 * | Typ | Bedeutung                                   | Bedingung                          |
 * | --- | ------------------------------------------- | ---------------------------------- |
 * | FS  | Nachfolgerin beginnt nach Ende der Vorgängerin | Beginn ≥ Ende(Vorgängerin) + 1 + Versatz |
 * | SS  | beginnt frühestens mit der Vorgängerin      | Beginn ≥ Beginn(Vorgängerin) + Versatz   |
 * | FF  | endet frühestens mit der Vorgängerin        | Ende ≥ Ende(Vorgängerin) + Versatz       |
 * | SF  | endet frühestens, wenn die Vorgängerin beginnt | Ende ≥ Beginn(Vorgängerin) + Versatz  |
 *
 * Abhängigkeiten dürfen über Pläne und Bereiche hinweg gehen (Programm mit Teilprojekten). Verschoben
 * wird eine Nachfolgerin nur, wenn in ihrem eigenen Plan „automatisch planen“ eingeschaltet ist.
 *
 * Tage sind Kalendertage. Mit „automatisch planen“ werden Nachfolgerinnen samt Dauer nach hinten
 * verschoben, sobald eine Bedingung verletzt wäre – nie nach vorne, und erledigte Aufgaben nie. Eine
 * erledigte Vorgängerin bindet niemanden mehr: Ihre (evtl. nicht nachgetragenen) Termine zählen nicht.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso } from '../../db/database.ts';
import { badRequest } from '../../core/errors.ts';
import type { TaskRow } from './service.ts';

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';
export const DEPENDENCY_TYPES: DependencyType[] = ['FS', 'SS', 'FF', 'SF'];
export const MAX_PREDECESSORS = 20;

export interface DependencyRow {
  task_id: number;
  predecessor_id: number;
  type: DependencyType;
  lag_days: number;
  created_at: string;
}

export interface DependencyInput {
  taskId: number;
  type?: DependencyType;
  lagDays?: number;
}

export interface DependencyDto {
  /** Die jeweils andere Aufgabe (Vorgängerin bzw. Nachfolgerin) */
  taskId: number;
  title: string;
  status: TaskRow['status'];
  /** Plan der anderen Aufgabe – bei planübergreifenden Abhängigkeiten wichtig für die Anzeige */
  boardId: number;
  boardName: string;
  type: DependencyType;
  lagDays: number;
  /** Termine verletzen die Bedingung (nur ohne automatische Planung möglich) */
  violated: boolean;
}

type Dated = Pick<TaskRow, 'id' | 'title' | 'status' | 'progress' | 'start_date' | 'due_date' | 'board_id'>;
const DATED_COLUMNS = 'id, title, status, progress, start_date, due_date, board_id';

function dayIndex(day: string | null): number | null {
  if (!day) return null;
  const ms = Date.parse(`${day.slice(0, 10)}T00:00:00.000Z`);
  return Number.isNaN(ms) ? null : Math.round(ms / 86400_000);
}

function dayString(index: number): string {
  return new Date(index * 86400_000).toISOString().slice(0, 10);
}

function bounds(task: Dated): { start: number; end: number } | null {
  const start = dayIndex(task.start_date ?? task.due_date);
  const end = dayIndex(task.due_date ?? task.start_date);
  if (start === null || end === null) return null;
  return start <= end ? { start, end } : { start: end, end: start };
}

/** Um wie viele Tage die Nachfolgerin nach hinten rücken müsste (≤ 0: Bedingung erfüllt). */
export function requiredShift(predecessor: Dated, successor: Dated, type: DependencyType, lag: number): number {
  const p = bounds(predecessor);
  const s = bounds(successor);
  if (!p || !s) return 0;
  switch (type) {
    case 'SS':
      return p.start + lag - s.start;
    case 'FF':
      return p.end + lag - s.end;
    case 'SF':
      return p.start + lag - s.end;
    default:
      return p.end + 1 + lag - s.start;
  }
}

/** Bindet die Vorgängerin ihre Nachfolgerinnen noch? Erledigt ist sie fertig – egal, was als Termin eingetragen ist. */
function constrains(predecessor: Dated): boolean {
  return predecessor.status !== 'done';
}

/** Kann die Nachfolgerin schon bearbeitet werden? FS wartet auf das Ende, SS auf den Beginn der Vorgängerin. */
function blocks(predecessor: Dated, type: DependencyType): boolean {
  if (type === 'FS') return predecessor.status !== 'done';
  if (type === 'SS') return predecessor.status === 'open' && predecessor.progress === 0;
  return false;
}

export class TaskDependencyService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  forBoard(boardId: number): DependencyRow[] {
    return this.s.db.all<DependencyRow>(
      `SELECT d.* FROM task_dependencies d
         JOIN tasks t ON t.id = d.task_id
         JOIN tasks p ON p.id = d.predecessor_id
        WHERE (t.board_id = ? OR p.board_id = ?) AND t.deleted_at IS NULL AND p.deleted_at IS NULL
        ORDER BY d.task_id, d.predecessor_id`,
      boardId,
      boardId,
    );
  }

  forTask(taskId: number): DependencyRow[] {
    return this.s.db.all<DependencyRow>('SELECT * FROM task_dependencies WHERE task_id = ? OR predecessor_id = ?', taskId, taskId);
  }

  /** Vorgängerinnen, Nachfolgerinnen und „blockiert“ für die Darstellung einer Aufgabe. */
  describe(task: Dated, rows: DependencyRow[], tasks: Map<number, Dated>): { predecessors: DependencyDto[]; successors: DependencyDto[]; blocked: boolean } {
    const predecessors: DependencyDto[] = [];
    const successors: DependencyDto[] = [];
    let blocked = false;
    for (const row of rows) {
      if (row.task_id === task.id) {
        const other = tasks.get(row.predecessor_id);
        if (!other) continue;
        if (task.status !== 'done' && blocks(other, row.type)) blocked = true;
        predecessors.push(this.dto(other, row, task.status !== 'done' && constrains(other) && requiredShift(other, task, row.type, row.lag_days) > 0));
      } else if (row.predecessor_id === task.id) {
        const other = tasks.get(row.task_id);
        if (!other) continue;
        successors.push(this.dto(other, row, other.status !== 'done' && constrains(task) && requiredShift(task, other, row.type, row.lag_days) > 0));
      }
    }
    return { predecessors, successors, blocked };
  }

  private dto(other: Dated, row: DependencyRow, violated: boolean): DependencyDto {
    return {
      taskId: other.id,
      title: other.title,
      status: other.status,
      boardId: other.board_id,
      boardName: this.boardName(other.board_id),
      type: row.type,
      lagDays: row.lag_days,
      violated,
    };
  }

  private readonly boardNames = new Map<number, string>();

  /** Plannamen für die Anzeige – je Abfrage höchstens einmal aus der Datenbank. */
  private boardName(boardId: number): string {
    const cached = this.boardNames.get(boardId);
    if (cached !== undefined) return cached;
    const name = this.s.db.value<string>('SELECT name FROM task_boards WHERE id = ?', boardId) ?? '';
    this.boardNames.set(boardId, name);
    // Umbenennungen sollen ankommen: Der Zwischenspeicher lebt nur kurz
    setTimeout(() => this.boardNames.delete(boardId), 30_000).unref();
    return name;
  }

  /**
   * Vorgängerinnen einer Aufgabe vollständig ersetzen. Sie dürfen in anderen Plänen liegen, solange die
   * ändernde Person deren Bereich sehen darf; Kreise (A wartet auf B, B auf A) werden abgelehnt.
   */
  setPredecessors(auth: AuthContext, task: TaskRow, input: DependencyInput[]): void {
    const unique = new Map<number, DependencyInput>();
    for (const item of input) {
      if (!Number.isInteger(item.taskId)) throw badRequest('Ungültige Vorgängerin');
      if (item.taskId === task.id) throw badRequest('Eine Aufgabe kann nicht von sich selbst abhängen');
      unique.set(item.taskId, item);
    }
    if (unique.size > MAX_PREDECESSORS) throw badRequest(`Höchstens ${MAX_PREDECESSORS} Vorgängerinnen je Aufgabe`);

    const ids = [...unique.keys()];
    if (ids.length) {
      const found = this.s.db.all<{ id: number; board_id: number; space_id: number }>(
        `SELECT t.id, t.board_id, b.space_id FROM tasks t JOIN task_boards b ON b.id = t.board_id
          WHERE t.deleted_at IS NULL AND t.id IN (${ids.map(() => '?').join(',')})`,
        ...ids,
      );
      if (found.length !== ids.length) throw badRequest('Eine Vorgängerin existiert nicht mehr');
      // Aus fremden Bereichen nur, was die ändernde Person auch sehen darf – sonst verriete der Plan fremde Titel
      for (const f of found) {
        if (f.board_id === task.board_id) continue;
        const space = this.s.spaces.get(f.space_id);
        if (!space || !this.s.perms.canSpace(auth, space, 'view')) throw badRequest('Eine Vorgängerin liegt in einem Bereich ohne Zugriff');
      }
    }

    // Kreis, wenn eine neue Vorgängerin (über beliebig viele Stufen) selbst auf diese Aufgabe wartet –
    // über Plangrenzen hinweg, deshalb Schritt für Schritt aus der Datenbank statt plangebunden
    const reachable = new Set<number>();
    const queue = [task.id];
    for (let guard = 0; queue.length && guard < 20_000; guard++) {
      const current = queue.shift()!;
      for (const row of this.s.db.all<{ task_id: number }>('SELECT task_id FROM task_dependencies WHERE predecessor_id = ?', current)) {
        if (row.task_id === task.id || reachable.has(row.task_id)) continue;
        reachable.add(row.task_id);
        queue.push(row.task_id);
      }
    }
    const cyclic = ids.find((id) => reachable.has(id));
    if (cyclic !== undefined) {
      const title = this.s.db.value<string>('SELECT title FROM tasks WHERE id = ?', cyclic);
      throw badRequest(`„${title}“ wartet bereits auf diese Aufgabe – die Abhängigkeit ergäbe einen Kreis`);
    }

    const now = nowIso();
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM task_dependencies WHERE task_id = ?', task.id);
      for (const item of unique.values()) {
        const type = DEPENDENCY_TYPES.includes(item.type as DependencyType) ? item.type! : 'FS';
        const lag = Math.max(-365, Math.min(365, Math.round(Number(item.lagDays) || 0)));
        this.s.db.run('INSERT INTO task_dependencies (task_id, predecessor_id, type, lag_days, created_at) VALUES (?, ?, ?, ?, ?)', task.id, item.taskId, type, lag, now);
      }
    });
  }

  /** Eine Aufgabe hinter ihre Vorgängerinnen legen (nach neuen Abhängigkeiten) und ihre Nachfolgerinnen nachziehen. */
  rescheduleTask(task: TaskRow): number[] {
    let shift = 0;
    if (task.status !== 'done') {
      for (const row of this.s.db.all<DependencyRow>('SELECT * FROM task_dependencies WHERE task_id = ?', task.id)) {
        const predecessor = this.s.db.get<Dated>(`SELECT ${DATED_COLUMNS} FROM tasks WHERE id = ? AND deleted_at IS NULL`, row.predecessor_id);
        if (predecessor && constrains(predecessor)) shift = Math.max(shift, requiredShift(predecessor, task, row.type, row.lag_days));
      }
    }
    if (shift <= 0) return this.reschedule([task.id]);
    this.s.db.run(
      'UPDATE tasks SET start_date = ?, due_date = ?, updated_at = ? WHERE id = ?',
      task.start_date ? dayString(dayIndex(task.start_date)! + shift) : null,
      task.due_date ? dayString(dayIndex(task.due_date)! + shift) : null,
      nowIso(),
      task.id,
    );
    return [task.id, ...this.reschedule([task.id])];
  }

  /**
   * Nachfolgerinnen nach hinten verschieben, bis alle Bedingungen erfüllt sind – ausgehend von den
   * geänderten Aufgaben, über beliebig viele Stufen und über Plangrenzen hinweg. Ein Plan ohne
   * „automatisch planen“ bleibt unberührt. Liefert die verschobenen Aufgaben.
   */
  reschedule(changedIds: number[]): number[] {
    const tasks = new Map<number, Dated>();
    const load = (id: number): Dated | null => {
      if (!tasks.has(id)) {
        const row = this.s.db.get<Dated>(`SELECT ${DATED_COLUMNS} FROM tasks WHERE id = ? AND deleted_at IS NULL`, id);
        if (!row) return null;
        tasks.set(id, { ...row });
      }
      return tasks.get(id) ?? null;
    };
    const autoSchedule = new Map<number, boolean>();
    const planned = (boardId: number): boolean => {
      const cached = autoSchedule.get(boardId);
      if (cached !== undefined) return cached;
      const value = this.s.db.value<number>('SELECT auto_schedule FROM task_boards WHERE id = ?', boardId) !== 0;
      autoSchedule.set(boardId, value);
      return value;
    };

    const changed = new Set<number>();
    const queue = [...changedIds];
    // Ohne Kreise endet das sicher; die Grenze schützt trotzdem vor Endlosschleifen bei inkonsistenten Daten
    for (let guard = 0; queue.length && guard < 20_000; guard++) {
      const predecessor = load(queue.shift()!);
      if (!predecessor || !constrains(predecessor)) continue;
      for (const row of this.s.db.all<DependencyRow>('SELECT * FROM task_dependencies WHERE predecessor_id = ?', predecessor.id)) {
        const successor = load(row.task_id);
        if (!successor || successor.status === 'done' || !planned(successor.board_id)) continue;
        const shift = requiredShift(predecessor, successor, row.type, row.lag_days);
        if (shift <= 0) continue;
        if (successor.start_date) successor.start_date = dayString(dayIndex(successor.start_date)! + shift);
        if (successor.due_date) successor.due_date = dayString(dayIndex(successor.due_date)! + shift);
        changed.add(successor.id);
        queue.push(successor.id);
      }
    }
    if (!changed.size) return [];
    const now = nowIso();
    this.s.db.transaction(() => {
      for (const id of changed) {
        const t = tasks.get(id)!;
        this.s.db.run('UPDATE tasks SET start_date = ?, due_date = ?, updated_at = ? WHERE id = ?', t.start_date, t.due_date, now, id);
      }
    });
    return [...changed];
  }
}
