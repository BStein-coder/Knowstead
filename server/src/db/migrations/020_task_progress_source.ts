import type { Migration } from '../migrate.ts';

/**
 * Aufgabenplaner: Fortschritt wahlweise von Hand (Regler) oder automatisch aus der Checkliste.
 * `0` = wie bisher von Hand, `1` = Anteil erledigter Punkte.
 */
export const migration020: Migration = {
  version: 20,
  name: 'task_progress_source',
  up: (db) => {
    db.exec(`ALTER TABLE tasks ADD COLUMN progress_from_checklist INTEGER NOT NULL DEFAULT 0;`);
  },
};
