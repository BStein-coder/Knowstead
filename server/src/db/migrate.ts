import type { Db } from './database.ts';
import { nowIso } from './database.ts';
import { migration001 } from './migrations/001_initial.ts';
import { migration002 } from './migrations/002_ad_review_structure.ts';
import { migration003 } from './migrations/003_ai_tasks_clips.ts';
import { migration004 } from './migrations/004_mail.ts';
import { migration005 } from './migrations/005_space_categories.ts';
import { migration006 } from './migrations/006_review_cycle.ts';
import { migration007 } from './migrations/007_planner_extensions.ts';
import { migration008 } from './migrations/008_attachment_search.ts';
import { migration009 } from './migrations/009_collaboration.ts';
import { migration010 } from './migrations/010_performance.ts';
import { migration011 } from './migrations/011_file_retention.ts';
import { migration012 } from './migrations/012_registration_verification.ts';
import { migration013 } from './migrations/013_task_dependencies.ts';
import { migration014 } from './migrations/014_content_analytics.ts';
import { migration015 } from './migrations/015_read_confirmations.ts';
import { migration016 } from './migrations/016_ocr.ts';
import { migration017 } from './migrations/017_approval_workflows.ts';
import { migration018 } from './migrations/018_suggestion_mode.ts';
import { migration019 } from './migrations/019_single_sign_on.ts';
import { migration020 } from './migrations/020_task_progress_source.ts';
import { migration021 } from './migrations/021_task_trash.ts';
import { migration022 } from './migrations/022_profile_indexes.ts';
import { migration023 } from './migrations/023_task_comments.ts';
import { migration024 } from './migrations/024_task_chat_search.ts';

export interface Migration {
  version: number;
  name: string;
  up: (db: Db) => void;
}

/**
 * Alle Migrationen in aufsteigender Reihenfolge. Neue Migrationen werden als
 * eigene Datei unter `migrations/` angelegt und hier registriert – bestehende
 * Migrationen werden nie nachträglich verändert.
 */
export const MIGRATIONS: Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008, migration009, migration010, migration011, migration012, migration013, migration014, migration015, migration016, migration017, migration018, migration019, migration020, migration021, migration022, migration023, migration024];

export interface MigrationStatus {
  /** bereits angewendete Versionen */
  applied: number[];
  /** noch anzuwendende Migrationen (aufsteigend) */
  pending: Migration[];
  /** Versionen in der Datenbank, die dieses Programm nicht kennt (Datenbank ist neuer) */
  unknown: number[];
  /** höchste angewendete Version (0 = neue Datenbank) */
  current: number;
  /** höchste Version, die dieses Programm kennt */
  latest: number;
}

/** Stand der Migrationen – ohne etwas zu verändern. */
export function migrationStatus(db: Db, migrations: Migration[] = MIGRATIONS): MigrationStatus {
  const hasTable = !!db.value("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
  const applied = hasTable ? db.all<{ version: number }>('SELECT version FROM schema_migrations ORDER BY version').map((r) => r.version) : [];
  const known = new Set(migrations.map((m) => m.version));
  const done = new Set(applied);
  return {
    applied,
    pending: [...migrations].sort((a, b) => a.version - b.version).filter((m) => !done.has(m.version)),
    unknown: applied.filter((v) => !known.has(v)),
    current: applied.length ? Math.max(...applied) : 0,
    latest: migrations.length ? Math.max(...migrations.map((m) => m.version)) : 0,
  };
}

/**
 * Wendet alle fehlenden Migrationen in **einer** Transaktion an: Entweder ist die Datenbank
 * danach vollständig auf dem neuen Stand, oder – bei einem Fehler – unverändert auf dem alten.
 *
 * Fremdschlüssel sind währenddessen ausgeschaltet, wie SQLite es für Tabellenumbauten vorsieht:
 * Sonst löste `DROP TABLE` beim Umbau einer Tabelle `ON DELETE CASCADE` aus und löschte abhängige
 * Zeilen (`PRAGMA defer_foreign_keys` verhindert das nicht). Das PRAGMA wirkt nur außerhalb einer
 * Transaktion; vor dem Commit prüft `foreign_key_check`, dass keine neuen ungültigen Verweise entstanden sind.
 */
export function migrate(db: Db, log: (msg: string) => void = () => {}, migrations: Migration[] = MIGRATIONS): number {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const pending = migrationStatus(db, migrations).pending;
  if (!pending.length) return 0;
  const foreignKeys = db.value<number>('PRAGMA foreign_keys') === 1;
  const before = foreignKeys ? foreignKeyViolations(db) : null;
  let running: Migration | null = null;
  if (foreignKeys) db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.transaction(() => {
      for (const m of pending) {
        running = m;
        m.up(db);
        db.run('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)', m.version, m.name, nowIso());
      }
      running = null;
      if (before) {
        const added = [...foreignKeyViolations(db)].filter(([key, count]) => count > (before.get(key) ?? 0)).map(([key]) => key);
        if (added.length) throw new Error(`Ungültige Verweise nach den Migrationen (${added.slice(0, 5).join(', ')})`);
      }
    });
  } catch (err) {
    const failed = running as Migration | null;
    throw new Error(
      `${failed ? `Migration ${failed.version} (${failed.name})` : 'Update'} fehlgeschlagen – alle Änderungen des Updates wurden zurückgerollt, die Datenbank ist unverändert: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  } finally {
    if (foreignKeys) db.exec('PRAGMA foreign_keys = ON');
  }
  for (const m of pending) log(`Migration ${m.version} (${m.name}) angewendet`);
  return pending.length;
}

/** Ungültige Verweise je „Tabelle → Zieltabelle“ (bereits vorhandene zählen nicht als Fehler des Updates). */
function foreignKeyViolations(db: Db): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of db.all<{ table: string; parent: string }>('PRAGMA foreign_key_check')) {
    const key = `${row.table} → ${row.parent}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function schemaVersion(db: Db): number {
  return db.value<number>('SELECT MAX(version) FROM schema_migrations') ?? 0;
}
