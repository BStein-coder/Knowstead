import type { Migration } from '../migrate.ts';

/**
 * Selbstregistrierung mit Bestätigung der E-Mail-Adresse: Solange `registration_pending_at` gesetzt
 * ist, kann sich das Konto nicht anmelden. Sonst ließe sich eine Domain-Beschränkung der
 * Registrierung mit einer fremden Firmenadresse umgehen.
 */
export const migration012: Migration = {
  version: 12,
  name: 'registration_verification',
  up: (db) => {
    db.exec(`
      ALTER TABLE users ADD COLUMN registration_pending_at TEXT;
      CREATE INDEX idx_users_registration_pending ON users(registration_pending_at) WHERE registration_pending_at IS NOT NULL;
    `);
  },
};
