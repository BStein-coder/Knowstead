import type { Services } from '../../services.ts';
import type { PageRow, SpaceRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso } from '../../db/database.ts';

/** Favoriten, Beobachten und zuletzt besuchte Seiten. */
export class SocialService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  setFavorite(auth: AuthContext, pageId: number, on: boolean): boolean {
    const user = this.s.perms.requireUser(auth);
    this.s.pages.requireViewable(auth, pageId);
    if (on) this.s.db.run('INSERT OR IGNORE INTO favorites (user_id, page_id, created_at) VALUES (?, ?, ?)', user.id, pageId, nowIso());
    else this.s.db.run('DELETE FROM favorites WHERE user_id = ? AND page_id = ?', user.id, pageId);
    return on;
  }

  favorites(auth: AuthContext) {
    const user = this.s.perms.requireUser(auth);
    const rows = this.s.db.all<PageRow>(
      `SELECT p.* FROM favorites f JOIN pages p ON p.id = f.page_id
       WHERE f.user_id = ? AND p.deleted_at IS NULL AND p.status = 'current' ORDER BY f.created_at DESC`,
      user.id,
    );
    return this.s.pages.summaries(auth, this.s.pages.filterVisible(auth, rows));
  }

  setWatch(userId: number, type: 'page' | 'space', targetId: number, on: boolean): void {
    if (on) {
      this.s.db.run(
        'INSERT OR IGNORE INTO watches (user_id, target_type, target_id, created_at) VALUES (?, ?, ?, ?)',
        userId,
        type,
        targetId,
        nowIso(),
      );
    } else {
      this.s.db.run('DELETE FROM watches WHERE user_id = ? AND target_type = ? AND target_id = ?', userId, type, targetId);
    }
  }

  watch(auth: AuthContext, type: 'page' | 'space', targetId: number, on: boolean): boolean {
    const user = this.s.perms.requireUser(auth);
    if (type === 'page') this.s.pages.requireViewable(auth, targetId);
    else this.s.perms.requireSpace(auth, this.s.spaces.require(targetId), 'view');
    this.setWatch(user.id, type, targetId, on);
    return on;
  }

  /** Alle Beobachter einer Seite (direkt oder über den Bereich). */
  watchersOfPage(page: Pick<PageRow, 'id' | 'space_id'>): number[] {
    return this.s.db
      .all<{ user_id: number }>(
        `SELECT DISTINCT user_id FROM watches
         WHERE (target_type = 'page' AND target_id = ?) OR (target_type = 'space' AND target_id = ?)`,
        page.id,
        page.space_id,
      )
      .map((r) => r.user_id);
  }

  watchersOfSpace(spaceId: number): number[] {
    return this.s.db
      .all<{ user_id: number }>("SELECT user_id FROM watches WHERE target_type = 'space' AND target_id = ?", spaceId)
      .map((r) => r.user_id);
  }

  watching(auth: AuthContext) {
    const user = this.s.perms.requireUser(auth);
    const pages = this.s.db.all<PageRow>(
      `SELECT p.* FROM watches w JOIN pages p ON p.id = w.target_id
       WHERE w.user_id = ? AND w.target_type = 'page' AND p.deleted_at IS NULL ORDER BY p.title COLLATE NOCASE`,
      user.id,
    );
    const spaces = this.s.db.all<SpaceRow>(
      `SELECT s.* FROM watches w JOIN spaces s ON s.id = w.target_id WHERE w.user_id = ? AND w.target_type = 'space' ORDER BY s.name`,
      user.id,
    );
    return {
      pages: this.s.pages.summaries(auth, this.s.pages.filterVisible(auth, pages)),
      spaces: spaces.filter((sp) => this.s.perms.canSpace(auth, sp, 'view')).map((sp) => this.s.spaces.toDto(auth, sp)),
    };
  }

  recent(auth: AuthContext, limit = 20) {
    const user = this.s.perms.requireUser(auth);
    this.s.pages.flushViews();
    const rows = this.s.db.all<PageRow & { viewed_at: string }>(
      `SELECT p.*, v.viewed_at FROM page_views v JOIN pages p ON p.id = v.page_id
       WHERE v.user_id = ? AND p.deleted_at IS NULL AND p.status = 'current' ORDER BY v.viewed_at DESC LIMIT ?`,
      user.id,
      limit * 2,
    );
    const visible = this.s.pages.filterVisible(auth, rows).slice(0, limit);
    const viewed = new Map(rows.map((r) => [r.id, r.viewed_at]));
    return this.s.pages.summaries(auth, visible).map((sm) => ({ ...sm, viewedAt: viewed.get(sm.id) ?? null }));
  }
}
