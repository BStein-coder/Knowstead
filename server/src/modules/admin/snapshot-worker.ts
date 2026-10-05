/**
 * Worker-Thread für den Datenbank-Snapshot einer Sicherung. `VACUUM INTO` dauert bei großen
 * Datenbanken Sekunden bis Minuten; im Hauptthread würde es so lange alle Anfragen blockieren.
 * Die eigene Verbindung liest im WAL-Modus einen festen Stand – Schreibzugriffe laufen weiter.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';

const { source, target } = workerData as { source: string; target: string };

let db: DatabaseSync | null = null;
try {
  db = new DatabaseSync(source);
  db.exec('PRAGMA busy_timeout = 30000');
  db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  parentPort?.postMessage({ ok: true });
} catch (err) {
  parentPort?.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
} finally {
  db?.close();
}
