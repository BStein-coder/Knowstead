import type { Migration } from '../migrate.ts';

/** Indizes für häufige Übersichten bei vielen Seiten (Bereichsliste, Zähler, zuletzt geändert). */
export const migration010: Migration = {
  version: 10,
  name: 'performance_indexes',
  up: (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_pages_space_status ON pages(space_id, status, deleted_at, updated_at);
      ANALYZE;
    `);
  },
};
