import type { Migration } from '../migrate.ts';

/**
 * Aufgabenplaner: wiederkehrende Aufgaben, Erinnerungen vor der Fälligkeit und
 * Kalender-Abo (ICS) über einen persönlichen, widerrufbaren Link.
 */
export const migration007: Migration = {
  version: 7,
  name: 'planner_extensions',
  up: (db) => {
    db.exec(`
      -- {"freq":"daily|weekly|monthly|yearly","interval":1}
      ALTER TABLE tasks ADD COLUMN recurrence TEXT;
      -- erste Aufgabe einer Serie
      ALTER TABLE tasks ADD COLUMN series_id INTEGER;

      CREATE TABLE task_reminders (
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('before', 'overdue')),
        due_date TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (task_id, kind, due_date)
      );

      CREATE TABLE calendar_feeds (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_used_at TEXT
      );
    `);
  },
};
