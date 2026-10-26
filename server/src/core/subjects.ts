import type { Db } from '../db/database.ts';
import { parseJson } from '../db/database.ts';

/**
 * Nummern von Benutzern, Gruppen, Seiten und Bereichen werden nie wiederverwendet, und wer gelöscht wird, hinterlässt
 * keine Rechte.
 *
 * Ohne `AUTOINCREMENT` vergibt SQLite die höchste vorhandene Nummer + 1: Wird die zuletzt angelegte Zeile gelöscht,
 * bekäme die nächste dieselbe Nummer – und mit ihr alles, was noch auf die alte zeigt: Seiteneinschränkungen, Bereichsrechte,
 * Zielgruppen von Lesebestätigungen, Freigabestufen – und der Verlauf. Der Aktivitätsfeed ordnet Ereignisse über die
 * Nummer der Seite bzw. des Bereichs zu; die neue Seite zeigte sonst Titel und Änderungsnotizen der gelöschten, womöglich
 * eingeschränkten. Beides wird hier verhindert: `nextRowId` zählt über die höchste je vergebene Nummer hinaus,
 * `forgetSubject` räumt die Verweise auf Personen und Gruppen beim Löschen ab.
 */

type Table = 'users' | 'groups' | 'pages' | 'spaces';

const markKey = (table: Table) => `internal:idmark:${table}`;

/** Nummer für ein neues Konto bzw. eine neue Gruppe – größer als jede, die es je gab. */
export function nextRowId(db: Db, table: Table): number {
  const present = db.value<number>(`SELECT COALESCE(MAX(id), 0) FROM ${table}`) ?? 0;
  const mark = Number(parseJson<number>(db.value<string>('SELECT value FROM settings WHERE key = ?', markKey(table)), 0)) || 0;
  return Math.max(present, mark) + 1;
}

/** Hält fest, dass diese Nummer vergeben war – vor dem Löschen aufrufen. */
export function rememberRowId(db: Db, table: Table, id: number): void {
  db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = MAX(CAST(value AS INTEGER), CAST(excluded.value AS INTEGER))',
    markKey(table),
    JSON.stringify(id),
  );
}

interface AudienceLike {
  type?: unknown;
  id?: unknown;
}

function withoutSubject<T extends AudienceLike>(entries: T[], type: string, id: number): T[] {
  return entries.filter((entry) => !(entry?.type === type && Number(entry?.id) === id));
}

/**
 * Räumt die Verweise auf eine Person (`user`) oder Gruppe (`group`) ab, die es nicht mehr gibt: Bereichsrechte,
 * Seiteneinschränkungen, Zielgruppen von Lesebestätigungen und die Stufen von Freigabeabläufen (auch laufender
 * Prüfaufträge – eine Stufe ohne erreichbare Person übernimmt die Bereichsverwaltung). Nichts davon darf dabei
 * Zugriff öffnen. In einer Transaktion aufrufen.
 */
export function forgetSubject(db: Db, type: 'user' | 'group', id: number): void {
  // Bereichsrechte entfallen ersatzlos – weniger Rechte sind immer die sichere Richtung
  db.run('DELETE FROM space_permissions WHERE subject_type = ? AND subject_id = ?', type, id);
  // Seiteneinschränkungen: Bliebe die Liste leer, wäre die Seite danach für alle im Bereich offen. Der letzte Eintrag
  // bleibt deshalb als Verweis ins Leere stehen („Benutzer #7“) – die Seite bleibt gesperrt, bis jemand sie neu vergibt.
  db.run(
    `DELETE FROM page_restrictions WHERE subject_type = ? AND subject_id = ?
       AND EXISTS (SELECT 1 FROM page_restrictions o WHERE o.page_id = page_restrictions.page_id AND o.kind = page_restrictions.kind
                   AND NOT (o.subject_type = page_restrictions.subject_type AND o.subject_id = page_restrictions.subject_id))`,
    type,
    id,
  );

  // Zielgruppen von Lesebestätigungen: ebenso nie ganz leer machen, die Anforderung soll nicht stillschweigend entfallen
  for (const row of db.all<{ page_id: number; audience: string }>('SELECT page_id, audience FROM read_requirements')) {
    const entries = parseJson<AudienceLike[]>(row.audience, []);
    const kept = withoutSubject(entries, type, id);
    if (kept.length && kept.length !== entries.length) db.run('UPDATE read_requirements SET audience = ? WHERE page_id = ?', JSON.stringify(kept), row.page_id);
  }

  interface Stage {
    approvers?: AudienceLike[];
  }
  const prune = (stages: Stage[]): { stages: Stage[]; changed: boolean } => {
    let changed = false;
    const next = stages.map((stage) => {
      const approvers = stage.approvers ?? [];
      const kept = withoutSubject(approvers, type, id);
      if (kept.length === approvers.length) return stage;
      changed = true;
      return { ...stage, approvers: kept };
    });
    return { stages: next, changed };
  };
  for (const row of db.all<{ space_id: number; stages: string }>('SELECT space_id, stages FROM approval_workflows')) {
    const { stages, changed } = prune(parseJson<Stage[]>(row.stages, []));
    if (changed) db.run('UPDATE approval_workflows SET stages = ? WHERE space_id = ?', JSON.stringify(stages), row.space_id);
  }
  // Prüfaufträge speichern eine Kopie der Stufen: { stages: [...], distinct: bool }
  for (const row of db.all<{ id: number; stages: string }>("SELECT id, stages FROM page_reviews WHERE status = 'open' AND stages IS NOT NULL")) {
    const snapshot = parseJson<{ stages?: Stage[] } | null>(row.stages, null);
    if (!snapshot?.stages) continue;
    const { stages, changed } = prune(snapshot.stages);
    if (changed) db.run('UPDATE page_reviews SET stages = ? WHERE id = ?', JSON.stringify({ ...snapshot, stages }), row.id);
  }
}
