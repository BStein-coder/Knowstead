import type { Migration } from '../migrate.ts';

/**
 * Inhaltsanalyse für die Redaktion: Aufrufe je Tag, Suchbegriffe (ohne Personenbezug), alle Verweise
 * einer Seite – auch auf nicht mehr vorhandene Ziele – und als erledigt markierte Einträge.
 */
export const migration014: Migration = {
  version: 14,
  name: 'content_analytics',
  up: (db) => {
    db.exec(`
      CREATE TABLE page_view_days (
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        day TEXT NOT NULL,
        views INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (page_id, day)
      ) WITHOUT ROWID;
      CREATE INDEX idx_page_view_days_day ON page_view_days(day);

      -- Tagessummen je Suchbegriff; keine Benutzerkennung
      CREATE TABLE search_queries (
        day TEXT NOT NULL,
        query TEXT NOT NULL,
        searches INTEGER NOT NULL DEFAULT 0,
        results INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, query)
      ) WITHOUT ROWID;

      -- Verweise aus Seiteninhalten, ohne Fremdschlüssel auf das Ziel (defekte Verweise bleiben sichtbar)
      CREATE TABLE page_refs (
        source_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        kind TEXT NOT NULL CHECK (kind IN ('page', 'attachment')),
        target_id INTEGER NOT NULL,
        PRIMARY KEY (source_id, kind, target_id)
      ) WITHOUT ROWID;
      CREATE INDEX idx_page_refs_target ON page_refs(kind, target_id);

      CREATE TABLE analytics_dismissed (
        kind TEXT NOT NULL CHECK (kind IN ('search', 'orphan', 'link', 'unread')),
        item TEXT NOT NULL,
        dismissed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        dismissed_at TEXT NOT NULL,
        PRIMARY KEY (kind, item)
      );
    `);
  },
};
