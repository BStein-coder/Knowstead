import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { Db } from '../../db/database.ts';
import { badRequest, notFound } from '../../core/errors.ts';

export const PROPERTY_TYPES = ['text', 'number', 'date', 'url', 'user', 'page', 'boolean', 'status'] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

export interface PropertyInput {
  name: string;
  value: string;
  type?: string;
}

/** Spalten, die die Sichtbarkeitsprüfung einer Seite braucht (Einschränkungen vererben sich im Baum). */
const VISIBLE_CHECK_COLUMNS = 'p.id, p.space_id, p.parent_id, p.status, p.created_by, p.deleted_at';
interface VisibleCheckRow {
  id: number;
  space_id: number;
  parent_id: number | null;
  status: 'current' | 'draft';
  created_by: number | null;
  deleted_at: string | null;
}

export function normalizeLabel(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}_.-]/gu, '')
    .slice(0, 50);
}

/** Stichwörter (Labels) und Seiteneigenschaften (Schlüssel/Wert-Attribute). */
export class LabelService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  labelsOf(pageId: number): string[] {
    return this.s.db
      .all<{ name: string }>('SELECT l.name FROM labels l JOIN page_labels pl ON pl.label_id = l.id WHERE pl.page_id = ? ORDER BY l.name', pageId)
      .map((r) => r.name);
  }

  /** Schreibt Labels ohne Prüfung/Ereignis (intern). */
  writeLabels(pageId: number, names: string[]): string[] {
    const clean = [...new Set(names.map(normalizeLabel).filter(Boolean))].slice(0, 50);
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM page_labels WHERE page_id = ?', pageId);
      for (const name of clean) {
        this.s.db.run('INSERT OR IGNORE INTO labels (name) VALUES (?)', name);
        this.s.db.run('INSERT OR IGNORE INTO page_labels (page_id, label_id) SELECT ?, id FROM labels WHERE name = ?', pageId, name);
      }
      this.s.db.run('DELETE FROM labels WHERE id NOT IN (SELECT label_id FROM page_labels)');
    });
    return clean;
  }

  setLabels(auth: AuthContext, pageId: number, names: string[]): string[] {
    const { page, space } = this.s.pages.requireAccess(auth, pageId, 'edit');
    const before = this.labelsOf(pageId);
    const after = this.writeLabels(pageId, names);
    if (page.status === 'current') this.s.search.index(pageId);
    if (before.join() !== after.join()) {
      this.s.emit(auth, {
        type: 'page.labels_changed',
        spaceId: space.id,
        pageId,
        target: { type: 'page', id: pageId, label: page.title },
        data: { added: after.filter((l) => !before.includes(l)), removed: before.filter((l) => !after.includes(l)) },
      });
    }
    return after;
  }

  /** Alle Labels mit Häufigkeit (optional je Bereich). */
  allLabels(auth: AuthContext, filter: { spaceId?: number; q?: string; limit?: number } = {}) {
    const spaceIds = filter.spaceId ? [filter.spaceId] : this.s.perms.viewableSpaceIds(auth);
    if (!spaceIds.length) return [];
    const params: (string | number)[] = [...spaceIds];
    let where = `p.space_id IN ${Db.placeholders(spaceIds.length)} AND p.deleted_at IS NULL AND p.status = 'current'`;
    if (filter.q) {
      where += ' AND l.name LIKE ?';
      params.push(`%${normalizeLabel(filter.q)}%`);
    }
    const limit = filter.limit ?? 200;
    if (!this.mustFilterPages(auth)) {
      return this.s.db.all<{ name: string; count: number }>(
        `SELECT l.name, COUNT(*) AS count FROM labels l
         JOIN page_labels pl ON pl.label_id = l.id JOIN pages p ON p.id = pl.page_id
         WHERE ${where} GROUP BY l.id ORDER BY count DESC, l.name LIMIT ?`,
        ...params,
        limit,
      );
    }
    // Es gibt eingeschränkte Seiten: nur zählen, was die Person auch sehen darf – sonst verrät die
    // Stichwortliste, dass es z. B. eine Seite mit dem Stichwort „kündigung-müller“ gibt.
    const rows = this.s.db.all<VisibleCheckRow & { name: string }>(
      `SELECT l.name, ${VISIBLE_CHECK_COLUMNS} FROM labels l
       JOIN page_labels pl ON pl.label_id = l.id JOIN pages p ON p.id = pl.page_id
       WHERE ${where}`,
      ...params,
    );
    const visible = this.visibleIds(auth, rows);
    const counts = new Map<string, number>();
    for (const r of rows) if (visible.has(r.id)) counts.set(r.name, (counts.get(r.name) ?? 0) + 1);
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  /** Nur nötig, wenn es Leseeinschränkungen gibt und die Person sie nicht ohnehin alle überstimmt. */
  private mustFilterPages(auth: AuthContext): boolean {
    return !auth.isAdmin && this.s.perms.hasViewRestrictions();
  }

  private visibleIds(auth: AuthContext, rows: VisibleCheckRow[]): Set<number> {
    const pages = new Map(rows.map((r) => [r.id, r] as const));
    return new Set(this.s.pages.filterVisible(auth, [...pages.values()]).map((p) => p.id));
  }

  /**
   * Stichwort systemweit umbenennen bzw. mit einem bestehenden zusammenführen.
   * Nur für Administratoren, weil es Seiten in allen Bereichen betrifft.
   */
  renameLabel(auth: AuthContext, from: string, to: string): { pages: number; merged: boolean } {
    this.s.perms.requireGlobal(auth, 'admin');
    const source = normalizeLabel(from);
    const target = normalizeLabel(to);
    if (!source || !target) throw badRequest('Bitte altes und neues Stichwort angeben');
    if (source === target) return { pages: 0, merged: false };
    const sourceRow = this.s.db.get<{ id: number }>('SELECT id FROM labels WHERE name = ?', source);
    if (!sourceRow) throw notFound(`Das Stichwort „${source}“ existiert nicht`);
    const pageIds = this.s.db.all<{ page_id: number }>('SELECT page_id FROM page_labels WHERE label_id = ?', sourceRow.id).map((r) => r.page_id);
    const existing = this.s.db.get<{ id: number }>('SELECT id FROM labels WHERE name = ?', target);
    this.s.db.transaction(() => {
      if (existing) {
        // Zusammenführen: Zuordnungen umhängen, Doppelte ignorieren.
        this.s.db.run('INSERT OR IGNORE INTO page_labels (page_id, label_id) SELECT page_id, ? FROM page_labels WHERE label_id = ?', existing.id, sourceRow.id);
        this.s.db.run('DELETE FROM labels WHERE id = ?', sourceRow.id);
      } else {
        this.s.db.run('UPDATE labels SET name = ? WHERE id = ?', target, sourceRow.id);
      }
    });
    for (const id of pageIds) this.s.search.index(id);
    this.s.emit(auth, {
      type: 'label.renamed',
      target: { type: 'label', id: target, label: target },
      data: { from: source, to: target, pages: pageIds.length, merged: !!existing },
    });
    return { pages: pageIds.length, merged: !!existing };
  }

  /** Stichwort von allen Seiten entfernen (Administratoren). */
  deleteLabel(auth: AuthContext, name: string): number {
    this.s.perms.requireGlobal(auth, 'admin');
    const label = normalizeLabel(name);
    const row = this.s.db.get<{ id: number }>('SELECT id FROM labels WHERE name = ?', label);
    if (!row) throw notFound(`Das Stichwort „${label}“ existiert nicht`);
    const pageIds = this.s.db.all<{ page_id: number }>('SELECT page_id FROM page_labels WHERE label_id = ?', row.id).map((r) => r.page_id);
    this.s.db.run('DELETE FROM labels WHERE id = ?', row.id);
    for (const id of pageIds) this.s.search.index(id);
    this.s.emit(auth, { type: 'label.deleted', target: { type: 'label', id: label, label }, data: { pages: pageIds.length } });
    return pageIds.length;
  }

  propertiesOf(pageId: number): { name: string; value: string; type: string }[] {
    return this.s.db.all<{ name: string; value: string; type: string }>(
      'SELECT name, value, type FROM page_properties WHERE page_id = ? ORDER BY position, id',
      pageId,
    );
  }

  writeProperties(pageId: number, props: PropertyInput[]): { name: string; value: string; type: string }[] {
    const seen = new Set<string>();
    const clean: { name: string; value: string; type: PropertyType }[] = [];
    for (const p of props) {
      const name = p.name.trim().slice(0, 60);
      if (!name || seen.has(name.toLowerCase())) continue;
      if (!/^[\p{L}\p{N}_\- .]+$/u.test(name)) throw badRequest(`Ungültiger Eigenschaftsname: ${name}`);
      seen.add(name.toLowerCase());
      const type = (PROPERTY_TYPES as readonly string[]).includes(p.type ?? '') ? (p.type as PropertyType) : 'text';
      clean.push({ name, value: String(p.value ?? '').slice(0, 2000), type });
    }
    this.s.db.transaction(() => {
      this.s.db.run('DELETE FROM page_properties WHERE page_id = ?', pageId);
      clean.forEach((p, i) =>
        this.s.db.run('INSERT INTO page_properties (page_id, name, value, type, position) VALUES (?, ?, ?, ?, ?)', pageId, p.name, p.value, p.type, i),
      );
    });
    return this.propertiesOf(pageId);
  }

  setProperties(auth: AuthContext, pageId: number, props: PropertyInput[]) {
    const { page, space } = this.s.pages.requireAccess(auth, pageId, 'edit');
    const before = this.propertiesOf(pageId);
    const after = this.writeProperties(pageId, props);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      this.s.emit(auth, {
        type: 'page.properties_changed',
        spaceId: space.id,
        pageId,
        target: { type: 'page', id: pageId, label: page.title },
        data: {
          before: Object.fromEntries(before.map((p) => [p.name, p.value])),
          after: Object.fromEntries(after.map((p) => [p.name, p.value])),
        },
      });
    }
    return after;
  }

  /** Bekannte Eigenschaftsnamen (für Autovervollständigung). */
  propertyNames(auth: AuthContext, spaceId?: number): { name: string; type: string; count: number }[] {
    const spaceIds = spaceId ? [spaceId] : this.s.perms.viewableSpaceIds(auth);
    if (!spaceIds.length) return [];
    if (!this.mustFilterPages(auth)) {
      return this.s.db.all<{ name: string; type: string; count: number }>(
        `SELECT pp.name, MAX(pp.type) AS type, COUNT(*) AS count FROM page_properties pp JOIN pages p ON p.id = pp.page_id
         WHERE p.space_id IN ${Db.placeholders(spaceIds.length)} AND p.deleted_at IS NULL
         GROUP BY pp.name COLLATE NOCASE ORDER BY count DESC LIMIT 100`,
        ...spaceIds,
      );
    }
    // Wie bei den Stichwörtern: Namen von Eigenschaften eingeschränkter Seiten bleiben verborgen
    const rows = this.s.db.all<VisibleCheckRow & { name: string; type: string }>(
      `SELECT pp.name, pp.type, ${VISIBLE_CHECK_COLUMNS} FROM page_properties pp JOIN pages p ON p.id = pp.page_id
       WHERE p.space_id IN ${Db.placeholders(spaceIds.length)} AND p.deleted_at IS NULL`,
      ...spaceIds,
    );
    const visible = this.visibleIds(auth, rows);
    const names = new Map<string, { name: string; type: string; count: number }>();
    for (const r of rows) {
      if (!visible.has(r.id)) continue;
      const key = r.name.toLowerCase();
      const entry = names.get(key);
      if (entry) {
        entry.count++;
        if (r.type > entry.type) entry.type = r.type;
      } else names.set(key, { name: r.name, type: r.type, count: 1 });
    }
    return [...names.values()].sort((a, b) => b.count - a.count).slice(0, 100);
  }
}
