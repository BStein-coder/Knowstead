import type { Migration } from '../migrate.ts';

/**
 * Mehrstufige Freigaben (z. B. Fachbereich → Qualitätsmanagement → Veröffentlichung) mit
 * Abwesenheitsvertretungen.
 *
 * Ein Bereich kann einen Freigabeablauf festlegen. Jeder Prüfauftrag speichert eine Kopie der Stufen
 * (spätere Änderungen am Ablauf betreffen laufende Aufträge nicht) und die aktuelle Stufe. Jede
 * Entscheidung wird mit Person, Vertretung, Version und Begründung festgehalten.
 */
export const migration017: Migration = {
  version: 17,
  name: 'approval_workflows',
  up: (db) => {
    db.exec(`
      CREATE TABLE approval_workflows (
        space_id INTEGER PRIMARY KEY REFERENCES spaces(id) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 1,
        -- [{"name":"Fachbereich","approvers":[{"type":"group","id":3}],"minApprovals":1,"escalateDays":5}]
        stages TEXT NOT NULL,
        distinct_approvers INTEGER NOT NULL DEFAULT 1,
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL
      );

      ALTER TABLE page_reviews ADD COLUMN stages TEXT;
      ALTER TABLE page_reviews ADD COLUMN current_stage INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE page_reviews ADD COLUMN stage_started_at TEXT;

      CREATE TABLE review_decisions (
        id INTEGER PRIMARY KEY,
        review_id INTEGER NOT NULL REFERENCES page_reviews(id) ON DELETE CASCADE,
        stage INTEGER NOT NULL,
        version INTEGER NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        user_name TEXT NOT NULL,
        on_behalf_of INTEGER REFERENCES users(id) ON DELETE SET NULL,
        on_behalf_name TEXT,
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_review_decisions_review ON review_decisions(review_id, stage, version);

      CREATE TABLE review_escalations (
        review_id INTEGER NOT NULL REFERENCES page_reviews(id) ON DELETE CASCADE,
        stage INTEGER NOT NULL,
        stage_started_at TEXT NOT NULL,
        sent_at TEXT NOT NULL,
        PRIMARY KEY (review_id, stage, stage_started_at)
      );

      CREATE TABLE user_deputies (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        deputy_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        starts_on TEXT NOT NULL,
        ends_on TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        CHECK (user_id != deputy_id),
        CHECK (starts_on <= ends_on)
      );
      CREATE INDEX idx_user_deputies_user ON user_deputies(user_id, ends_on);
      CREATE INDEX idx_user_deputies_deputy ON user_deputies(deputy_id, ends_on);
    `);
  },
};
