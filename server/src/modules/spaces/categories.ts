/**
 * Kategorien gliedern Bereiche in Navigation und Bereichsverzeichnis
 * (z. B. „Abteilungen“, „Projekte“, „Archiv“). Die Administration pflegt die
 * Liste und ihre Reihenfolge; Bereichsadministratoren wählen daraus.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { Db, nowIso } from '../../db/database.ts';
import { badRequest, conflict, notFound } from '../../core/errors.ts';

interface CategoryRow {
  id: number;
  name: string;
  icon: string | null;
  description: string;
  position: number;
  created_at: string;
}

export interface CategoryDto {
  id: number;
  name: string;
  icon: string | null;
  description: string;
  position: number;
  /** sichtbare, nicht archivierte Team-Bereiche in dieser Kategorie */
  spaceCount: number;
}

function cleanName(value: unknown): string {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export class CategoryService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  private row(id: number): CategoryRow {
    const row = this.s.db.get<CategoryRow>('SELECT * FROM space_categories WHERE id = ?', id);
    if (!row) throw notFound('Kategorie nicht gefunden');
    return row;
  }

  list(auth: AuthContext): CategoryDto[] {
    const rows = this.s.db.all<CategoryRow>('SELECT * FROM space_categories ORDER BY position, name COLLATE NOCASE');
    const ids = this.s.perms.viewableSpaceIds(auth);
    const counts = new Map<string, number>();
    if (ids.length) {
      for (const r of this.s.db.all<{ name: string; n: number }>(
        `SELECT LOWER(category) AS name, COUNT(*) AS n FROM spaces
          WHERE kind = 'team' AND archived_at IS NULL AND category != '' AND id IN ${Db.placeholders(ids.length)}
          GROUP BY LOWER(category)`,
        ...ids,
      )) {
        counts.set(r.name, r.n);
      }
    }
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      icon: r.icon,
      description: r.description,
      position: r.position,
      spaceCount: counts.get(r.name.toLowerCase()) ?? 0,
    }));
  }

  /**
   * Kategorie für einen Bereich bestimmen: bekannte Namen werden auf die gepflegte
   * Schreibweise gebracht; neue Namen darf nur die Administration anlegen.
   */
  resolve(auth: AuthContext, input: string | undefined): string {
    const name = cleanName(input);
    if (!name) return '';
    const existing = this.s.db.get<CategoryRow>('SELECT * FROM space_categories WHERE name = ? COLLATE NOCASE', name);
    if (existing) return existing.name;
    if (!this.s.perms.hasGlobal(auth, 'admin')) {
      throw badRequest(`Die Kategorie „${name}“ gibt es nicht. Kategorien legt die Administration unter Administration → Bereiche an.`);
    }
    return this.insert(name, null, '').name;
  }

  private insert(name: string, icon: string | null, description: string): CategoryRow {
    const position = (this.s.db.value<number>('SELECT COALESCE(MAX(position), -1) FROM space_categories') ?? -1) + 1;
    const id = this.s.db.run(
      'INSERT INTO space_categories (name, icon, description, position, created_at) VALUES (?, ?, ?, ?, ?)',
      name,
      icon,
      description,
      position,
      nowIso(),
    ).lastInsertRowid;
    return this.row(id);
  }

  create(auth: AuthContext, input: { name: string; icon?: string | null; description?: string }): CategoryDto {
    this.s.perms.requireGlobal(auth, 'admin');
    const name = cleanName(input.name);
    if (!name) throw badRequest('Bitte einen Namen für die Kategorie angeben');
    if (this.s.db.get('SELECT id FROM space_categories WHERE name = ? COLLATE NOCASE', name)) throw conflict(`Die Kategorie „${name}“ gibt es bereits`);
    const row = this.insert(name, input.icon?.trim() || null, (input.description ?? '').trim().slice(0, 300));
    this.s.emit(auth, { type: 'space.category_created', target: { type: 'category', id: row.id, label: row.name } });
    return this.list(auth).find((c) => c.id === row.id)!;
  }

  update(auth: AuthContext, id: number, input: { name?: string; icon?: string | null; description?: string }): CategoryDto {
    this.s.perms.requireGlobal(auth, 'admin');
    const row = this.row(id);
    const name = input.name !== undefined ? cleanName(input.name) : row.name;
    if (!name) throw badRequest('Bitte einen Namen für die Kategorie angeben');
    const clash = this.s.db.get<CategoryRow>('SELECT * FROM space_categories WHERE name = ? COLLATE NOCASE AND id != ?', name, id);
    if (clash) throw conflict(`Die Kategorie „${name}“ gibt es bereits`);
    this.s.db.transaction(() => {
      this.s.db.run(
        'UPDATE space_categories SET name = ?, icon = ?, description = ? WHERE id = ?',
        name,
        input.icon !== undefined ? input.icon?.trim() || null : row.icon,
        input.description !== undefined ? input.description.trim().slice(0, 300) : row.description,
        id,
      );
      // Umbenennen wirkt auf alle Bereiche der Kategorie
      if (name !== row.name) this.s.db.run('UPDATE spaces SET category = ?, updated_at = ? WHERE category = ? COLLATE NOCASE', name, nowIso(), row.name);
    });
    if (name !== row.name) {
      this.s.emit(auth, { type: 'space.category_updated', target: { type: 'category', id, label: name }, data: { from: row.name, to: name } });
    }
    return this.list(auth).find((c) => c.id === id)!;
  }

  /** Kategorie entfernen – die Bereiche bleiben erhalten und stehen danach unter „Weitere Bereiche“. */
  delete(auth: AuthContext, id: number): { spaces: number } {
    this.s.perms.requireGlobal(auth, 'admin');
    const row = this.row(id);
    let spaces = 0;
    this.s.db.transaction(() => {
      spaces = this.s.db.run("UPDATE spaces SET category = '', updated_at = ? WHERE category = ? COLLATE NOCASE", nowIso(), row.name).changes;
      this.s.db.run('DELETE FROM space_categories WHERE id = ?', id);
    });
    this.s.emit(auth, { type: 'space.category_deleted', target: { type: 'category', id, label: row.name }, data: { spaces } });
    return { spaces };
  }

  reorder(auth: AuthContext, ids: number[]): CategoryDto[] {
    this.s.perms.requireGlobal(auth, 'admin');
    const known = new Set(this.s.db.all<{ id: number }>('SELECT id FROM space_categories').map((r) => r.id));
    const ordered = [...new Set(ids)].filter((id) => known.has(id));
    // Nicht genannte Kategorien behalten ihre relative Reihenfolge dahinter
    const rest = this.s.db
      .all<{ id: number }>('SELECT id FROM space_categories ORDER BY position, name COLLATE NOCASE')
      .map((r) => r.id)
      .filter((id) => !ordered.includes(id));
    this.s.db.transaction(() => {
      [...ordered, ...rest].forEach((id, index) => this.s.db.run('UPDATE space_categories SET position = ? WHERE id = ?', index, id));
    });
    return this.list(auth);
  }
}
