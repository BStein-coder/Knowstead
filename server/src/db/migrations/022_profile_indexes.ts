import type { Migration } from '../migrate.ts';

/**
 * Indizes für Abfragen, die bisher über die ganze Tabelle liefen:
 *
 * - Das Profil einer Person zählt angelegte Seiten, Bearbeitungen und Kommentare. Ohne Index
 *   liest jede dieser drei Zahlen die komplette Tabelle – `page_revisions` wächst mit jedem
 *   Speichern und ist auf Dauer die größte Tabelle überhaupt.
 * - Die Inhaltsanalyse sucht ungelesene Seiten mit `NOT EXISTS (… FROM page_views …)` je Seite.
 *   Der zusammengesetzte Index bedient Seite und Zeitraum in einem Zugriff.
 */
export const migration022: Migration = {
  version: 22,
  name: 'profile_indexes',
  up: (db) => {
    db.exec(`
      CREATE INDEX idx_pages_author ON pages(created_by) WHERE deleted_at IS NULL;
      CREATE INDEX idx_page_revisions_author ON page_revisions(author_id);
      CREATE INDEX idx_comments_author ON comments(author_id);
      CREATE INDEX idx_page_views_page ON page_views(page_id, viewed_at);
    `);
  },
};
