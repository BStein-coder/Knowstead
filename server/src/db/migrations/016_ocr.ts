import type { Migration } from '../migrate.ts';

/** Texterkennung: merkt sich, ob der Text eines Anhangs aus der Textebene oder per OCR stammt. */
export const migration016: Migration = {
  version: 16,
  name: 'ocr',
  up: (db) => {
    db.exec(`ALTER TABLE attachment_texts ADD COLUMN method TEXT NOT NULL DEFAULT 'text';`);
  },
};
