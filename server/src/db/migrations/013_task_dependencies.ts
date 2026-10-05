import type { Migration } from '../migrate.ts';

/**
 * Aufgabenplaner: Abhängigkeiten zwischen Aufgaben (wie Microsoft Planner Premium bzw. Project).
 *
 * Typen: FS (Ende → Anfang, Standard), SS (Anfang → Anfang), FF (Ende → Ende), SF (Anfang → Ende),
 * jeweils mit Versatz in Kalendertagen. `auto_schedule` verschiebt Nachfolger automatisch.
 */
export const migration013: Migration = {
  version: 13,
  name: 'task_dependencies',
  up: (db) => {
    db.exec(`
      CREATE TABLE task_dependencies (
        task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        predecessor_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        type TEXT NOT NULL DEFAULT 'FS' CHECK (type IN ('FS', 'SS', 'FF', 'SF')),
        lag_days INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        PRIMARY KEY (task_id, predecessor_id),
        CHECK (task_id != predecessor_id)
      );
      CREATE INDEX idx_task_dependencies_predecessor ON task_dependencies(predecessor_id);

      ALTER TABLE task_boards ADD COLUMN auto_schedule INTEGER NOT NULL DEFAULT 1;
    `);
  },
};
