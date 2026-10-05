import type { Migration } from '../migrate.ts';
import { nowIso } from '../database.ts';

/**
 * Kategorien für Bereiche (z. B. „Abteilungen“, „Projekte“) als eigene, sortierbare
 * Liste. Bereiche behalten den Namen in `spaces.category` – bestehende Werte werden übernommen.
 */
export const migration005: Migration = {
  version: 5,
  name: 'space_categories',
  up: (db) => {
    db.exec(`
      CREATE TABLE space_categories (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        icon TEXT,
        description TEXT NOT NULL DEFAULT '',
        position INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
    `);
    const now = nowIso();
    const names = db.all<{ name: string }>(
      "SELECT DISTINCT TRIM(category) AS name FROM spaces WHERE TRIM(COALESCE(category, '')) != '' ORDER BY name COLLATE NOCASE",
    );
    names.forEach((row, index) => db.run('INSERT OR IGNORE INTO space_categories (name, position, created_at) VALUES (?, ?, ?)', row.name, index, now));
  },
};
