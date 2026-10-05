import type { Migration } from '../migrate.ts';

/**
 * Lesebestätigungen für Pflichtdokumente (Richtlinien, Unterweisungen, Datenschutz).
 *
 * Eine Anforderung gehört zu einer Seite und legt Zielgruppe, Bestätigungstext, Frist, erneute
 * Bestätigung bei neuen Versionen und eine optionale Wiederholung fest. Bestätigungen bleiben als
 * Nachweis erhalten – auch wenn die Anforderung entfernt oder das Konto gelöscht wird.
 */
export const migration015: Migration = {
  version: 15,
  name: 'read_confirmations',
  up: (db) => {
    db.exec(`
      CREATE TABLE read_requirements (
        page_id INTEGER PRIMARY KEY REFERENCES pages(id) ON DELETE CASCADE,
        -- [{"type":"group"|"user"|"space","id":1}]
        audience TEXT NOT NULL DEFAULT '[]',
        statement TEXT NOT NULL,
        due_days INTEGER NOT NULL DEFAULT 14,
        reconfirm_on_change INTEGER NOT NULL DEFAULT 1,
        repeat_months INTEGER NOT NULL DEFAULT 0,
        -- Bestätigungen zählen ab dieser Version und ab Beginn der aktuellen Runde
        required_version INTEGER NOT NULL,
        cycle_started_at TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE read_confirmations (
        id INTEGER PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_name TEXT NOT NULL,
        version INTEGER NOT NULL,
        statement TEXT NOT NULL,
        confirmed_at TEXT NOT NULL
      );
      CREATE INDEX idx_read_confirmations_page ON read_confirmations(page_id, user_id, confirmed_at);
      CREATE INDEX idx_read_confirmations_user ON read_confirmations(user_id, confirmed_at);

      CREATE TABLE read_reminders (
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('assigned', 'due', 'overdue', 'manual')),
        cycle TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (page_id, user_id, kind, cycle)
      );
    `);
  },
};
