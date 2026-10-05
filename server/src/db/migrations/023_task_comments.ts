import type { Migration } from '../migrate.ts';

/**
 * Chat je Aufgabe: Nachrichten mit @-Erwähnungen, ergänzend zur Beschreibung. Hängt an der Aufgabe –
 * wandert mit ihr in den Papierkorb und verschwindet beim endgültigen Löschen (Fremdschlüssel).
 */
export const migration023: Migration = {
  version: 23,
  name: 'task_comments',
  up: (db) => {
    db.exec(`
      CREATE TABLE task_comments (
        id INTEGER PRIMARY KEY,
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE INDEX idx_task_comments_task ON task_comments(task_id);
    `);
  },
};
