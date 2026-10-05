import type { Migration } from '../migrate.ts';

/**
 * Erweiterung um Verzeichnisanmeldung (Active Directory/LDAP), Redaktionsprüfung
 * („Review“) und Struktur-Merkmale (Kategorien für Bereiche).
 */
export const migration002: Migration = {
  version: 2,
  name: 'ad_review_structure',
  up: (db) => {
    db.exec(`
      -- ---------------------------------------------------------------
      -- Verzeichnisanmeldung (Active Directory / LDAP)
      -- ---------------------------------------------------------------
      ALTER TABLE users ADD COLUMN auth_source TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE users ADD COLUMN external_id TEXT;
      ALTER TABLE users ADD COLUMN external_dn TEXT;
      ALTER TABLE users ADD COLUMN synced_at TEXT;
      CREATE INDEX idx_users_external ON users(external_id);

      -- Zuordnung einer AD-Sicherheitsgruppe zu einer Knowstead-Gruppe.
      -- Mehrere Kennungen (DN, sAMAccountName, CN) durch Zeilenumbruch getrennt.
      ALTER TABLE groups ADD COLUMN directory_groups TEXT NOT NULL DEFAULT '';
      ALTER TABLE groups ADD COLUMN sync_enabled INTEGER NOT NULL DEFAULT 1;

      -- ---------------------------------------------------------------
      -- Struktur: Kategorien für Bereiche, Prüfpflicht
      -- ---------------------------------------------------------------
      ALTER TABLE spaces ADD COLUMN category TEXT NOT NULL DEFAULT '';
      ALTER TABLE spaces ADD COLUMN review_required INTEGER NOT NULL DEFAULT 0;

      -- ---------------------------------------------------------------
      -- Redaktionsprüfung
      -- ---------------------------------------------------------------
      ALTER TABLE pages ADD COLUMN review_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE pages ADD COLUMN approved_version INTEGER;
      ALTER TABLE pages ADD COLUMN approved_at TEXT;
      ALTER TABLE pages ADD COLUMN approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

      CREATE TABLE page_reviews (
        id INTEGER PRIMARY KEY,
        page_id INTEGER NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'approved', 'rejected', 'cancelled')),
        requested_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reviewer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        note TEXT NOT NULL DEFAULT '',
        decision_note TEXT NOT NULL DEFAULT '',
        decided_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        decided_at TEXT
      );
      CREATE INDEX idx_reviews_page ON page_reviews(page_id, status);
      CREATE INDEX idx_reviews_status ON page_reviews(status, created_at);
      CREATE INDEX idx_reviews_reviewer ON page_reviews(reviewer_id, status);
    `);
  },
};
