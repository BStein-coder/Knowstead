import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { UserRef } from '../../core/types.ts';

/** Zusammenhang, in dem jemand erwähnt wird: wer ist beteiligt, wer darf den Ort überhaupt sehen? */
export interface MentionContext {
  /** Personen, die im Vorschlagsmenü zuerst stehen (Verantwortliche, Verfasser, Mitschreibende) */
  involved: number[];
  /** Darf diese Person den Ort sehen – käme eine Erwähnung also bei ihr an? */
  canSee: (userId: number) => boolean;
}

/**
 * Erwähnungen (@Name) im Zusammenhang: Das Vorschlagsmenü zeigt Beteiligte zuerst und kennzeichnet
 * Personen ohne Zugriff; nach dem Speichern erfährt die Verfasserin, wen die Erwähnung nicht erreicht.
 * Benachrichtigt wird ohnehin nur, wer den Ort sehen darf (NotificationService) – ohne diese Rückmeldung
 * bliebe das aber unbemerkt.
 */
export class MentionService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /** Chat einer Aufgabe. `null`, wenn die anfragende Person die Aufgabe nicht sehen darf (oder es sie nicht gibt). */
  forTask(auth: AuthContext, taskId: number): MentionContext | null {
    let task;
    try {
      task = this.s.tasks.taskRow(taskId);
    } catch {
      return null;
    }
    const board = this.s.tasks.boardRow(task.board_id);
    const space = this.s.spaces.get(board.space_id);
    if (!space || !this.s.perms.canSpace(auth, space, 'view')) return null;
    const writers = this.s.db
      .all<{ author_id: number }>('SELECT DISTINCT author_id FROM task_comments WHERE task_id = ? AND deleted_at IS NULL AND author_id IS NOT NULL', taskId)
      .map((r) => r.author_id);
    return {
      involved: unique([task.assignee_id, task.created_by, ...writers]),
      canSee: (userId) => this.s.notifications.canViewSpace(userId, space.id),
    };
  }

  /** Seite und ihre Kommentare. `null`, wenn die anfragende Person die Seite nicht sehen darf. */
  forPage(auth: AuthContext, pageId: number): MentionContext | null {
    const page = this.s.pages.get(pageId);
    const space = page ? this.s.spaces.get(page.space_id) : undefined;
    if (!page || !space || !this.s.perms.canViewPage(auth, page, space)) return null;
    const writers = this.s.db
      .all<{ author_id: number }>('SELECT DISTINCT author_id FROM comments WHERE page_id = ? AND deleted_at IS NULL AND author_id IS NOT NULL', pageId)
      .map((r) => r.author_id);
    return {
      involved: unique([page.owner_id, page.created_by, page.updated_by, ...writers]),
      canSee: (userId) => this.s.notifications.canView(userId, pageId),
    };
  }

  /** Erwähnte, die nichts erfahren: kein Zugriff oder deaktiviert. Die Verfasserin selbst zählt nicht. */
  unreachable(mentions: number[], authorId: number, canSee: (userId: number) => boolean): UserRef[] {
    const ids = mentions.filter((id) => id !== authorId && !canSee(id));
    return ids.length ? [...this.s.users.refs(ids).values()] : [];
  }
}

function unique(ids: (number | null | undefined)[]): number[] {
  return [...new Set(ids.filter((id): id is number => typeof id === 'number' && id > 0))];
}
