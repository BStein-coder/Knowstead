import type { Services } from '../../services.ts';
import type { PageRow, SpaceRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { Db, nowIso } from '../../db/database.ts';
import { badRequest, notFound } from '../../core/errors.ts';
import { pageUrl } from './service.ts';

/**
 * Papierkorb: Seiten (mit Unterseiten) löschen, wiederherstellen und endgültig entfernen. Dateien der
 * Anhänge verschwinden erst nach der Karenzzeit vom Datenträger (`attachments.scheduleFileRemoval`).
 */
export class TrashService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /** Seite samt Unterseiten in den Papierkorb legen; nie veröffentlichte Entwürfe werden gleich gelöscht. */
  moveToTrash(auth: AuthContext, id: number): number {
    const user = this.s.perms.requireUser(auth);
    const { page, space } = this.s.pages.requireAccess(auth, id, 'delete');
    if (space.home_page_id === page.id) throw badRequest('Die Startseite eines Bereichs kann nicht gelöscht werden. Lege zuerst eine andere Startseite fest.');
    if (page.status === 'draft') {
      this.hardDelete([page.id]);
      return 1;
    }
    const ids = [page.id, ...this.s.pages.descendantIds(page.id)];
    const now = nowIso();
    this.s.db.transaction(() => {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        this.s.db.run(
          `UPDATE pages SET deleted_at = ?, deleted_by = ?, trash_root_id = ? WHERE id IN ${Db.placeholders(chunk.length)}`,
          now,
          user.id,
          page.id,
          ...chunk,
        );
        for (const pid of chunk) this.s.search.remove(pid);
      }
    });
    this.s.emit(auth, {
      type: 'page.deleted',
      spaceId: space.id,
      pageId: page.id,
      target: { type: 'page', id: page.id, label: page.title },
      data: { title: page.title, pages: ids.length },
    });
    return ids.length;
  }

  list(auth: AuthContext, space: SpaceRow) {
    this.s.perms.requireSpace(auth, space, 'delete');
    const rows = this.s.db.all<PageRow & { sub_count: number }>(
      `SELECT p.*, (SELECT COUNT(*) FROM pages c WHERE c.trash_root_id = p.id) - 1 AS sub_count
       FROM pages p WHERE p.space_id = ? AND p.deleted_at IS NOT NULL AND p.trash_root_id = p.id ORDER BY p.deleted_at DESC`,
      space.id,
    );
    const visible = this.s.perms.visiblePageIds(auth, space, rows.map((r) => ({ ...r, deleted_at: null })));
    const users = this.s.users.refs(rows.map((r) => r.deleted_by));
    return rows
      .filter((r) => visible.has(r.id))
      .map((r) => ({
        id: r.id,
        title: r.title,
        icon: r.icon,
        deletedAt: r.deleted_at!,
        deletedBy: users.get(r.deleted_by ?? 0) ?? null,
        subPages: Math.max(0, r.sub_count),
        version: r.version,
      }));
  }

  restore(auth: AuthContext, id: number): PageRow {
    // Rechte vor jeder Antwort prüfen – sonst verrät die Adresse (mit Titel) auch eingeschränkte Seiten
    const page = this.s.pages.get(id);
    const space = page ? this.s.spaces.get(page.space_id) : undefined;
    if (!page || !space || !this.s.perms.canViewPage(auth, page, space, { includeDeleted: true })) throw notFound('Seite nicht gefunden');
    this.s.perms.requireSpace(auth, space, 'delete');
    if (!page.deleted_at) return page;
    const rootId = page.trash_root_id ?? page.id;
    const ids = this.s.db.all<{ id: number }>('SELECT id FROM pages WHERE trash_root_id = ?', rootId).map((r) => r.id);
    const root = this.s.pages.require(rootId);
    let parentId = root.parent_id;
    if (parentId) {
      const parent = this.s.pages.get(parentId);
      if (!parent || parent.deleted_at || parent.space_id !== root.space_id) parentId = null;
    }
    this.s.db.transaction(() => {
      this.s.db.run('UPDATE pages SET parent_id = ? WHERE id = ?', parentId, rootId);
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        this.s.db.run(
          `UPDATE pages SET deleted_at = NULL, deleted_by = NULL, trash_root_id = NULL WHERE id IN ${Db.placeholders(chunk.length)}`,
          ...chunk,
        );
      }
      for (const pid of ids) this.s.search.index(pid);
    });
    for (const pid of ids) this.s.reviewCycle.refresh(pid);
    this.s.emit(auth, {
      type: 'page.restored',
      spaceId: space.id,
      pageId: rootId,
      target: { type: 'page', id: rootId, label: root.title },
      data: { title: root.title, pages: ids.length, url: pageUrl(space.key, rootId, root.title) },
    });
    return this.s.pages.require(rootId);
  }

  purge(auth: AuthContext, id: number): void {
    const page = this.s.pages.get(id);
    const space = page ? this.s.spaces.get(page.space_id) : undefined;
    if (!page || !space || !this.s.perms.canViewPage(auth, page, space, { includeDeleted: true })) throw notFound('Seite nicht gefunden');
    this.s.perms.requireSpace(auth, space, 'purge');
    if (!page.deleted_at) throw badRequest('Nur Seiten im Papierkorb können endgültig gelöscht werden');
    const rootId = page.trash_root_id ?? page.id;
    const ids = this.s.db.all<{ id: number }>('SELECT id FROM pages WHERE trash_root_id = ? OR id = ?', rootId, rootId).map((r) => r.id);
    this.hardDelete(ids);
    this.s.emit(auth, {
      type: 'page.purged',
      spaceId: space.id,
      target: { type: 'page', id: rootId, label: page.title },
      data: { pages: ids.length },
    });
  }

  empty(auth: AuthContext, space: SpaceRow): number {
    this.s.perms.requireSpace(auth, space, 'purge');
    const roots = this.s.db.all<{ id: number }>(
      'SELECT id FROM pages WHERE space_id = ? AND deleted_at IS NOT NULL AND trash_root_id = id',
      space.id,
    );
    for (const r of roots) this.purge(auth, r.id);
    return roots.length;
  }

  /** Endgültiges Löschen inkl. Dateien (ohne Berechtigungsprüfung). */
  hardDelete(ids: number[]): void {
    if (!ids.length) return;
    const files: string[] = [];
    this.s.db.transaction(() => {
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const ph = Db.placeholders(chunk.length);
        files.push(...this.s.db.all<{ storage_key: string }>(`SELECT storage_key FROM attachments WHERE page_id IN ${ph}`, ...chunk).map((r) => r.storage_key));
        this.s.db.run(`DELETE FROM attachments_fts WHERE rowid IN (SELECT id FROM attachments WHERE page_id IN ${ph})`, ...chunk);
        for (const pid of chunk) this.s.search.remove(pid);
        this.s.db.run(`UPDATE pages SET parent_id = NULL WHERE parent_id IN ${ph}`, ...chunk);
        this.s.db.run(`DELETE FROM watches WHERE target_type = 'page' AND target_id IN ${ph}`, ...chunk);
        this.s.db.run(`DELETE FROM pages WHERE id IN ${ph}`, ...chunk);
        this.s.db.run(`UPDATE spaces SET home_page_id = NULL WHERE home_page_id IN ${ph}`, ...chunk);
      }
    });
    // Dateien erst nach der Karenzzeit entfernen (Wiederherstellung aus Sicherungen bleibt möglich)
    this.s.attachments.scheduleFileRemoval(files);
  }

  /** Bereinigt den Papierkorb nach Ablauf der Aufbewahrungsfrist. */
  purgeExpired(): number {
    const days = this.s.settings.get('trashRetentionDays');
    if (days <= 0) return 0;
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const roots = this.s.db.all<{ id: number }>('SELECT id FROM pages WHERE deleted_at IS NOT NULL AND deleted_at < ? AND trash_root_id = id', cutoff);
    for (const r of roots) {
      const ids = this.s.db.all<{ id: number }>('SELECT id FROM pages WHERE trash_root_id = ?', r.id).map((x) => x.id);
      this.hardDelete(ids);
    }
    return roots.length;
  }
}
