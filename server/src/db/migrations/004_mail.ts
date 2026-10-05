import type { Migration } from '../migrate.ts';

/**
 * E-Mail-Versand über eine Warteschlange (Wiederholungen, Protokoll) und
 * tägliche Zusammenfassungen.
 */
export const migration004: Migration = {
  version: 4,
  name: 'mail_queue',
  up: (db) => {
    db.exec(`
      CREATE TABLE mail_queue (
        id INTEGER PRIMARY KEY,
        recipient TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        kind TEXT NOT NULL DEFAULT 'notification',
        subject TEXT NOT NULL,
        text_body TEXT NOT NULL,
        html_body TEXT,
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        next_attempt_at TEXT NOT NULL,
        sent_at TEXT
      );
      CREATE INDEX idx_mail_queue_due ON mail_queue(status, next_attempt_at);
      CREATE INDEX idx_mail_queue_created ON mail_queue(created_at);

      CREATE TABLE mail_digests (
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_sent_at TEXT NOT NULL
      );
    `);
    // Bis 1.1 gab es nur den Schalter „secure“ – in die neue Auswahl übernehmen.
    db.run(
      `UPDATE settings SET value = json_set(value, '$.security', CASE WHEN json_extract(value, '$.secure') THEN 'tls' ELSE 'starttls' END)
        WHERE key = 'smtp' AND json_valid(value) AND json_extract(value, '$.security') IS NULL`,
    );
  },
};
