import type { Migration } from '../migrate.ts';

/**
 * Wiedervorlage: Verantwortliche je Seite, Prüfintervall (je Seite oder als
 * Vorgabe des Bereichs), letzte Bestätigung und Fälligkeit. Erinnerungen werden
 * je Fälligkeit nur einmal verschickt.
 */
export const migration006: Migration = {
  version: 6,
  name: 'review_cycle',
  up: (db) => {
    db.exec(`
      ALTER TABLE pages ADD COLUMN owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL;
      -- NULL = Vorgabe des Bereichs, 0 = keine Wiedervorlage
      ALTER TABLE pages ADD COLUMN review_interval_months INTEGER;
      ALTER TABLE pages ADD COLUMN verified_at TEXT;
      ALTER TABLE pages ADD COLUMN verified_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      ALTER TABLE pages ADD COLUMN review_due_at TEXT;
      CREATE INDEX idx_pages_review_due ON pages(review_due_at);
      CREATE INDEX idx_pages_owner ON pages(owner_id);

      ALTER TABLE spaces ADD COLUMN review_interval_months INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE spaces ADD COLUMN review_board_id INTEGER REFERENCES task_boards(id) ON DELETE SET NULL;

      CREATE TABLE page_review_reminders (
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        due_at TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('upcoming', 'overdue')),
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (page_id, due_at, kind)
      );
      CREATE INDEX idx_review_reminders_task ON page_review_reminders(task_id);
    `);
  },
};
