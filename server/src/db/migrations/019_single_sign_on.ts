import type { Migration } from '../migrate.ts';

/**
 * Single Sign-on: verknüpfte Konten bei Identitätsanbietern (OIDC, SAML, Windows-Anmeldung) und
 * kurzlebige Anmeldevorgänge, die an den Browser gebunden sind.
 */
export const migration019: Migration = {
  version: 19,
  name: 'single_sign_on',
  up: (db) => {
    db.exec(`
      CREATE TABLE user_identities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('oidc', 'saml', 'kerberos')),
        issuer TEXT NOT NULL DEFAULT '',
        subject TEXT NOT NULL,
        label TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        last_login_at TEXT,
        UNIQUE (provider, issuer, subject)
      );
      CREATE INDEX idx_user_identities_user ON user_identities(user_id);

      CREATE TABLE auth_flows (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        request_id TEXT NOT NULL UNIQUE,
        data TEXT NOT NULL DEFAULT '{}',
        result TEXT,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_auth_flows_expires ON auth_flows(expires_at);
    `);
  },
};
