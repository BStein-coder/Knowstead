import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { SpaceRow, UserRef } from '../../core/types.ts';
import { nowIso } from '../../db/database.ts';
import { badRequest, notFound } from '../../core/errors.ts';
import type { TaskRow } from './service.ts';

export interface DeletedTask {
  id: number;
  title: string;
  boardId: number;
  boardName: string;
  deletedAt: string;
  deletedBy: UserRef | null;
  /** Abhängigkeiten, die beim Wiederherstellen zurückkommen */
  dependencies: number;
}

/**
 * Papierkorb für Aufgaben. Gelöschte Aufgaben verschwinden aus Plan, Suche und Abhängigkeiten, bleiben
 * aber samt Checkliste und Verknüpfungen erhalten, bis die Wartung sie nach `trashRetentionDays`
 * endgültig entfernt. Wiederherstellen bringt auch die Abhängigkeiten zurück.
 */
export class TaskTrashService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /** Aufgabe inklusive gelöschter – nur für den Papierkorb. */
  private row(id: number): TaskRow {
    const row = this.s.db.get<TaskRow>('SELECT * FROM tasks WHERE id = ?', id);
    if (!row) throw notFound('Aufgabe nicht gefunden');
    return row;
  }

  private requireAccess(auth: AuthContext, row: TaskRow, right: 'edit' | 'admin'): SpaceRow {
    const board = this.s.tasks.boardRow(row.board_id);
    const space = this.s.spaces.require(board.space_id);
    this.s.perms.requireSpace(auth, space, right);
    return space;
  }

  /** In den Papierkorb legen. Nachfolgerinnen warten danach nicht mehr auf diese Aufgabe. */
  moveToTrash(auth: AuthContext, id: number): void {
    const row = this.row(id);
    if (row.deleted_at) return;
    const space = this.requireAccess(auth, row, 'edit');
    this.s.db.run('UPDATE tasks SET deleted_at = ?, deleted_by = ?, updated_at = ? WHERE id = ?', nowIso(), auth.user?.id ?? null, nowIso(), id);
    this.s.emit(auth, { type: 'task.deleted', spaceId: space.id, target: { type: 'task', id, label: row.title } });
  }

  list(auth: AuthContext, space: SpaceRow): DeletedTask[] {
    this.s.perms.requireSpace(auth, space, 'edit');
    const rows = this.s.db.all<TaskRow & { board_name: string; dependencies: number }>(
      `SELECT t.*, b.name AS board_name,
              (SELECT COUNT(*) FROM task_dependencies d WHERE d.task_id = t.id OR d.predecessor_id = t.id) AS dependencies
         FROM tasks t JOIN task_boards b ON b.id = t.board_id
        WHERE b.space_id = ? AND t.deleted_at IS NOT NULL
        ORDER BY t.deleted_at DESC`,
      space.id,
    );
    const users = this.s.users.refs(rows.map((r) => r.deleted_by));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      boardId: r.board_id,
      boardName: r.board_name,
      deletedAt: r.deleted_at!,
      deletedBy: users.get(r.deleted_by ?? 0) ?? null,
      dependencies: r.dependencies,
    }));
  }

  restore(auth: AuthContext, id: number): TaskRow {
    const row = this.row(id);
    const space = this.requireAccess(auth, row, 'edit');
    if (!row.deleted_at) return row;
    this.s.db.run('UPDATE tasks SET deleted_at = NULL, deleted_by = NULL, updated_at = ? WHERE id = ?', nowIso(), id);
    // Abhängigkeiten zu inzwischen endgültig gelöschten Aufgaben sind über die Fremdschlüssel schon weg;
    // die Termine der Nachfolgerinnen können jetzt wieder gebunden sein.
    const board = this.s.tasks.boardRow(row.board_id);
    if (board.auto_schedule) this.s.taskDependencies.rescheduleTask(this.s.tasks.taskRow(id));
    this.s.emit(auth, { type: 'task.restored', spaceId: space.id, target: { type: 'task', id, label: row.title } });
    return this.s.tasks.taskRow(id);
  }

  /** Endgültig löschen – Abhängigkeiten verschwinden über die Fremdschlüssel mit. */
  purge(auth: AuthContext, id: number): void {
    const row = this.row(id);
    const space = this.requireAccess(auth, row, 'admin');
    if (!row.deleted_at) throw badRequest('Nur Aufgaben im Papierkorb können endgültig gelöscht werden');
    this.s.db.run('DELETE FROM tasks WHERE id = ?', id);
    this.s.emit(auth, { type: 'task.purged', spaceId: space.id, target: { type: 'task', id, label: row.title } });
  }

  /** Wartung: abgelaufene Aufgaben endgültig entfernen. */
  purgeExpired(): number {
    const days = this.s.settings.get('trashRetentionDays');
    if (days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return this.s.db.run('DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?', cutoff).changes;
  }
}
