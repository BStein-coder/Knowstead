import type { Migration } from '../migrate.ts';

/** Gemeinsames Bearbeiten: gespeicherter Yjs-Stand je Seite (bis zur Veröffentlichung). */
export const migration009: Migration = {
  version: 9,
  name: 'collaboration',
  up: (db) => {
    db.exec(`
      CREATE TABLE collab_documents (
        page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        state BLOB NOT NULL,
        -- Version der Seite, auf der der gemeinsame Stand aufsetzt
        base_version INTEGER NOT NULL,
        -- 1 = Änderungen seit der letzten Veröffentlichung
        dirty INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      );
    `);
  },
};
