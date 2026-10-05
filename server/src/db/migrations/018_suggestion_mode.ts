import type { Migration } from '../migrate.ts';

/** Vorschlagsmodus: Bearbeitungsmodus je Seite (optional festgeschrieben) und Vorgabe je Bereich. */
export const migration018: Migration = {
  version: 18,
  name: 'suggestion_mode',
  up: (db) => {
    db.exec(`
      ALTER TABLE pages ADD COLUMN edit_mode TEXT NOT NULL DEFAULT 'direct' CHECK (edit_mode IN ('direct', 'suggest'));
      ALTER TABLE pages ADD COLUMN edit_mode_locked INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE spaces ADD COLUMN default_edit_mode TEXT NOT NULL DEFAULT 'direct' CHECK (default_edit_mode IN ('direct', 'suggest'));
    `);
  },
};
