import type { Services } from '../../services.ts';
import type { PageRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { Db } from '../../db/database.ts';
import type { PageSummary } from './service.ts';

/** Verweise zwischen Seiten: Backlinks, ausgehende Links und die Link-Karte. */
export class PageLinkService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  /** Ausgehende Verweise einer Seite ersetzen (nach dem Speichern). */
  replace(pageId: number, targets: number[]): void {
    this.s.db.run('DELETE FROM page_links WHERE source_id = ?', pageId);
    for (const t of targets) {
      if (t === pageId) continue;
      this.s.db.run('INSERT OR IGNORE INTO page_links (source_id, target_id) SELECT ?, id FROM pages WHERE id = ?', pageId, t);
    }
  }

  backlinks(auth: AuthContext, id: number): PageSummary[] {
    this.s.pages.requireViewable(auth, id);
    const rows = this.s.db.all<PageRow>(
      `SELECT p.* FROM page_links l JOIN pages p ON p.id = l.source_id
       WHERE l.target_id = ? AND p.deleted_at IS NULL AND p.status = 'current' ORDER BY p.title COLLATE NOCASE`,
      id,
    );
    return this.s.pages.summaries(auth, this.s.pages.filterVisible(auth, rows));
  }

  outgoing(auth: AuthContext, id: number): PageSummary[] {
    this.s.pages.requireViewable(auth, id);
    const rows = this.s.db.all<PageRow>(
      `SELECT p.* FROM page_links l JOIN pages p ON p.id = l.target_id
       WHERE l.source_id = ? AND p.deleted_at IS NULL AND p.status = 'current' ORDER BY p.title COLLATE NOCASE`,
      id,
    );
    return this.s.pages.summaries(auth, this.s.pages.filterVisible(auth, rows));
  }

  /** Linkgraph um eine Seite (für die Link-Karte). */
  graph(auth: AuthContext, id: number, depth = 2) {
    const { page: self } = this.s.pages.requireViewable(auth, id);
    const nodeIds = new Set<number>([id]);
    const edges = new Map<string, { source: number; target: number; kind: 'link' | 'tree' }>();
    let frontier = [id];
    for (let d = 0; d < depth && frontier.length && nodeIds.size < 200; d++) {
      const ph = Db.placeholders(frontier.length);
      const links = this.s.db.all<{ source_id: number; target_id: number }>(
        `SELECT source_id, target_id FROM page_links WHERE source_id IN ${ph} OR target_id IN ${ph}`,
        ...frontier,
        ...frontier,
      );
      const next: number[] = [];
      for (const l of links) {
        edges.set(`${l.source_id}-${l.target_id}`, { source: l.source_id, target: l.target_id, kind: 'link' });
        for (const n of [l.source_id, l.target_id]) {
          if (!nodeIds.has(n) && nodeIds.size < 200) {
            nodeIds.add(n);
            next.push(n);
          }
        }
      }
      frontier = next;
    }
    // Hierarchie (Eltern und Kinder) der Seite ergänzen
    if (self.parent_id) {
      nodeIds.add(self.parent_id);
      edges.set(`${self.parent_id}-${id}`, { source: self.parent_id, target: id, kind: 'tree' });
    }
    for (const c of this.s.db.all<{ id: number }>("SELECT id FROM pages WHERE parent_id = ? AND deleted_at IS NULL AND status = 'current' LIMIT 50", id)) {
      nodeIds.add(c.id);
      edges.set(`${id}-${c.id}`, { source: id, target: c.id, kind: 'tree' });
    }
    const ids = [...nodeIds];
    const rows = this.s.db.all<PageRow>(`SELECT * FROM pages WHERE id IN ${Db.placeholders(ids.length)}`, ...ids);
    const visible = this.s.pages.filterVisible(auth, rows);
    const visibleIds = new Set(visible.map((p) => p.id));
    return {
      nodes: this.s.pages.summaries(auth, visible).map((sm) => ({
        id: sm.id,
        title: sm.title,
        icon: sm.icon,
        spaceKey: sm.spaceKey,
        url: sm.url,
        current: sm.id === id,
      })),
      edges: [...edges.values()].filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target)),
    };
  }
}
