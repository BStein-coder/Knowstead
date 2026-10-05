import type { Migration } from '../migrate.ts';

/**
 * Papierkorb für Aufgaben: Löschen ist umkehrbar, endgültig entfernt sie die Wartung nach der
 * Aufbewahrungszeit (`trashRetentionDays`) – wie bei Seiten.
 */
export const migration021: Migration = {
  version: 21,
  name: 'task_trash',
  up: (db) => {
    db.exec(`
      ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
      ALTER TABLE tasks ADD COLUMN deleted_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
      CREATE INDEX idx_tasks_deleted ON tasks(deleted_at) WHERE deleted_at IS NOT NULL;
    `);
  },
};
