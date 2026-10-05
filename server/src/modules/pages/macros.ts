import type { Services } from '../../services.ts';
import type { PageRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { Db } from '../../db/database.ts';
import { normalizeLabel } from './labels.ts';

/** Datenquellen für dynamische Makros (Zuletzt geändert, Eigenschaften-Bericht …). */
export class MacroService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  recentPages(auth: AuthContext, options: { spaceKey?: string; limit?: number; label?: string }) {
    const limit = Math.min(options.limit ?? 10, 50);
    let spaceIds = this.s.perms.viewableSpaceIds(auth);
    if (options.spaceKey) {
      const space = this.s.spaces.requireViewable(auth, options.spaceKey);
      spaceIds = [space.id];
    }
    if (!spaceIds.length) return [];
    const params: (string | number)[] = [...spaceIds];
    let labelSql = '';
    if (options.label) {
      labelSql = 'AND EXISTS (SELECT 1 FROM page_labels pl JOIN labels l ON l.id = pl.label_id WHERE pl.page_id = p.id AND l.name = ?)';
      params.push(normalizeLabel(options.label));
    }
    const rows = this.s.db.all<PageRow>(
      `SELECT p.* FROM pages p WHERE p.space_id IN ${Db.placeholders(spaceIds.length)} AND p.deleted_at IS NULL AND p.status = 'current' ${labelSql}
       ORDER BY p.updated_at DESC LIMIT ?`,
      ...params,
      limit * 3,
    );
    return this.s.pages.summaries(auth, this.s.pages.filterVisible(auth, rows).slice(0, limit));
  }

  /**
   * Tabelle aus Seiteneigenschaften (wie der Confluence-Makro „Seiteneigenschaften-Bericht“).
   * Scope: Unterseiten einer Seite, alle Nachfahren oder alle Seiten mit einem Stichwort.
   */
  propertiesReport(
    auth: AuthContext,
    options: { pageId?: number; scope?: 'children' | 'descendants' | 'label'; label?: string; spaceKey?: string; columns?: string[]; limit?: number },
  ) {
    const scope = options.scope ?? 'children';
    let rows: PageRow[] = [];
    if (scope === 'label' && options.label) {
      let spaceIds = this.s.perms.viewableSpaceIds(auth);
      if (options.spaceKey) spaceIds = [this.s.spaces.requireViewable(auth, options.spaceKey).id];
      if (spaceIds.length) {
        rows = this.s.db.all<PageRow>(
          `SELECT p.* FROM pages p JOIN page_labels pl ON pl.page_id = p.id JOIN labels l ON l.id = pl.label_id
           WHERE l.name = ? AND p.space_id IN ${Db.placeholders(spaceIds.length)} AND p.deleted_at IS NULL AND p.status = 'current'
           ORDER BY p.title COLLATE NOCASE`,
          normalizeLabel(options.label),
          ...spaceIds,
        );
      }
    } else if (options.pageId) {
      const { page } = this.s.pages.requireViewable(auth, options.pageId);
      const ids = scope === 'descendants' ? this.s.pages.descendantIds(page.id) : [];
      rows =
        scope === 'descendants'
          ? ids.length
            ? this.s.db.all<PageRow>(
                `SELECT * FROM pages WHERE id IN ${Db.placeholders(ids.length)} AND status = 'current' ORDER BY title COLLATE NOCASE`,
                ...ids,
              )
            : []
          : this.s.db.all<PageRow>(
              "SELECT * FROM pages WHERE parent_id = ? AND deleted_at IS NULL AND status = 'current' ORDER BY position, id",
              page.id,
            );
    }
    const visible = this.s.pages.filterVisible(auth, rows).slice(0, options.limit ?? 200);
    const props = new Map<number, { name: string; value: string; type: string }[]>();
    const allNames: string[] = [];
    for (const p of visible) {
      const list = this.s.labels.propertiesOf(p.id);
      props.set(p.id, list);
      for (const item of list) if (!allNames.some((n) => n.toLowerCase() === item.name.toLowerCase())) allNames.push(item.name);
    }
    const columns = options.columns?.length ? options.columns : allNames;
    const summaries = this.s.pages.summaries(auth, visible);
    return {
      columns,
      rows: summaries.map((sm) => {
        const list = props.get(sm.id) ?? [];
        const values: Record<string, { value: string; type: string } | null> = {};
        for (const col of columns) {
          const found = list.find((x) => x.name.toLowerCase() === col.toLowerCase());
          values[col] = found ? { value: found.value, type: found.type } : null;
        }
        return { page: sm, values, labels: this.s.labels.labelsOf(sm.id) };
      }),
    };
  }
}
