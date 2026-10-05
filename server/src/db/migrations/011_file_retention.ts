import type { Migration } from '../migrate.ts';

/**
 * Dateien endgültig gelöschter Anhänge (Papierkorb geleert, Bereich gelöscht) werden nicht sofort
 * vom Datenträger entfernt, sondern erst nach einer Karenzzeit. So findet eine zurückgespielte
 * Sicherung der Datenbank ihre Dateien noch.
 */
export const migration011: Migration = {
  version: 11,
  name: 'file_retention',
  up: (db) => {
    db.exec(`
      CREATE TABLE file_deletions (
        storage_key TEXT PRIMARY KEY,
        deleted_at TEXT NOT NULL
      );
      CREATE INDEX idx_file_deletions_deleted ON file_deletions(deleted_at);
    `);
  },
};
