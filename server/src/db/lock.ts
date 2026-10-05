/**
 * Schutz gegen zwei Knowstead-Server auf derselben Datenbank.
 *
 * Ohne diesen Schutz könnte beim Update die neue Version die Datenbank migrieren, während
 * die alte noch läuft (die Migration geschieht vor dem Öffnen des Ports). Die Sperre nutzt
 * SQLite selbst: Eine kleine Nebendatei wird im Modus `locking_mode = EXCLUSIVE` beschrieben –
 * die exklusive Dateisperre bleibt bis zum Schließen der Verbindung bestehen und wird vom
 * Betriebssystem auch nach einem Absturz freigegeben. Veraltete Sperrdateien gibt es daher nicht.
 */
import { DatabaseSync } from 'node:sqlite';

export class InstanceLockError extends Error {}

export interface InstanceLock {
  readonly file: string;
  release(): void;
}

/**
 * Sperre für `dbFile` anfordern. Wartet bis `waitMs` (z. B. während ein alter Prozess nach
 * einem Neustart noch herunterfährt) und wirft dann `InstanceLockError`.
 */
export function acquireInstanceLock(dbFile: string, waitMs = 10_000): InstanceLock {
  const file = `${dbFile}.lock`;
  const conn = new DatabaseSync(file);
  try {
    conn.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.round(waitMs))}`);
    conn.exec('PRAGMA journal_mode = DELETE');
    conn.exec('PRAGMA locking_mode = EXCLUSIVE');
    conn.exec('BEGIN EXCLUSIVE');
    conn.exec('CREATE TABLE IF NOT EXISTS instance (pid INTEGER NOT NULL, started_at TEXT NOT NULL)');
    conn.exec('DELETE FROM instance');
    conn.prepare('INSERT INTO instance (pid, started_at) VALUES (?, ?)').run(process.pid, new Date().toISOString());
    conn.exec('COMMIT');
  } catch (err) {
    try {
      conn.close();
    } catch {
      /* bereits geschlossen */
    }
    const busy = /locked|busy/i.test(err instanceof Error ? err.message : String(err));
    if (busy) {
      throw new InstanceLockError(
        `Die Datenbank ${dbFile} wird bereits von einem laufenden Knowstead-Server verwendet. ` +
          'Bitte zuerst den laufenden Dienst beenden (bei einem Update: alten Dienst stoppen, dann die neue Version starten).',
      );
    }
    throw err;
  }
  let released = false;
  return {
    file,
    release() {
      if (released) return;
      released = true;
      try {
        conn.close();
      } catch {
        /* egal */
      }
    },
  };
}
