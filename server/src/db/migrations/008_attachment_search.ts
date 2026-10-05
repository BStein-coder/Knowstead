import type { Migration } from '../migrate.ts';

/** Volltextsuche in Anhängen: Status der Textgewinnung und eigener FTS5-Index. */
export const migration008: Migration = {
  version: 8,
  name: 'attachment_search',
  up: (db) => {
    db.exec(`
      CREATE TABLE attachment_texts (
        attachment_id INTEGER PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
        status TEXT NOT NULL CHECK (status IN ('done', 'empty', 'unsupported', 'failed')),
        chars INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        extracted_at TEXT NOT NULL
      );
      CREATE INDEX idx_attachment_texts_status ON attachment_texts(status);

      -- rowid = attachments.id
      CREATE VIRTUAL TABLE attachments_fts USING fts5(
        filename,
        body,
        tokenize = 'unicode61 remove_diacritics 2',
        prefix = '2 3 4'
      );
    `);
  },
};
