import { DatabaseSync, type StatementSync } from 'node:sqlite';

export type SqlValue = string | number | bigint | null | Uint8Array;
type InputValue = SqlValue | boolean | undefined | Date;

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

function normalize(value: InputValue): SqlValue {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function normalizeParams(params: InputValue[] | [Record<string, InputValue>]): SqlValue[] | [Record<string, SqlValue>] {
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object' && !(params[0] instanceof Uint8Array) && !(params[0] instanceof Date)) {
    const named: Record<string, SqlValue> = {};
    for (const [k, v] of Object.entries(params[0] as Record<string, InputValue>)) named[k] = normalize(v);
    return [named];
  }
  return (params as InputValue[]).map(normalize);
}

const MAX_CACHED_STATEMENTS = 800;

/**
 * Kleinschreibung für Vergleiche – auch jenseits von ASCII. `LIKE` von SQLite kennt nur a–z: „ö“ fände „Ö“
 * nicht. In SQL als `fold(spalte) LIKE ?` mit einem ebenso gefalteten Suchwort.
 */
export function fold(text: string): string {
  return text.toLocaleLowerCase('de-DE');
}

/**
 * Dünne Hülle um `node:sqlite` mit Statement-Cache, verschachtelbaren
 * Transaktionen (Savepoints) und Parameter-Normalisierung.
 *
 * Alle Methoden sind synchron – Transaktionen dürfen daher niemals über
 * ein `await` hinweg laufen.
 */
export class Db {
  readonly raw: DatabaseSync;
  readonly file: string;
  private readonly statements = new Map<string, StatementSync>();
  private depth = 0;
  /** Arbeiten, die erst nach dem erfolgreichen Abschluss der äußersten Transaktion laufen sollen */
  private commitHooks: (() => void)[] = [];

  constructor(file: string) {
    this.file = file;
    this.raw = new DatabaseSync(file);
    try {
      this.raw.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA temp_store = MEMORY;
        PRAGMA cache_size = -64000;
        PRAGMA mmap_size = 268435456;
      `);
      this.raw.function('fold', { deterministic: true }, (value) => (typeof value === 'string' ? fold(value) : value));
    } catch (err) {
      // z. B. „file is not a database“ – Datei nicht offen halten (unter Windows sonst gesperrt)
      this.raw.close();
      throw err;
    }
  }

  private prepare(sql: string): StatementSync {
    let stmt = this.statements.get(sql);
    if (stmt) {
      // zuletzt benutzt ans Ende (LRU)
      this.statements.delete(sql);
      this.statements.set(sql, stmt);
      return stmt;
    }
    stmt = this.raw.prepare(sql);
    this.statements.set(sql, stmt);
    // IN-Listen erzeugen viele Varianten – Cache begrenzen
    if (this.statements.size > MAX_CACHED_STATEMENTS) this.statements.delete(this.statements.keys().next().value as string);
    return stmt;
  }

  get<T = Record<string, unknown>>(sql: string, ...params: InputValue[] | [Record<string, InputValue>]): T | undefined {
    return this.prepare(sql).get(...(normalizeParams(params) as SqlValue[])) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: InputValue[] | [Record<string, InputValue>]): T[] {
    return this.prepare(sql).all(...(normalizeParams(params) as SqlValue[])) as T[];
  }

  run(sql: string, ...params: InputValue[] | [Record<string, InputValue>]): RunResult {
    const res = this.prepare(sql).run(...(normalizeParams(params) as SqlValue[]));
    return { changes: Number(res.changes), lastInsertRowid: Number(res.lastInsertRowid) };
  }

  /** Einzelwert der ersten Spalte der ersten Zeile. */
  value<T = unknown>(sql: string, ...params: InputValue[] | [Record<string, InputValue>]): T | undefined {
    const row = this.get<Record<string, unknown>>(sql, ...params);
    if (!row) return undefined;
    const keys = Object.keys(row);
    return keys.length ? (row[keys[0]] as T) : undefined;
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /**
   * Führt `fn` aus, sobald die äußerste Transaktion erfolgreich abgeschlossen ist – gleich, wenn keine läuft. Wird die
   * Transaktion (oder der Savepoint, in dem der Aufruf stand) zurückgerollt, entfällt `fn`: Ereignisse über Änderungen,
   * die es nie gab, erreichen so weder Webhooks noch Benachrichtigungen.
   */
  afterCommit(fn: () => void): void {
    if (this.depth === 0) fn();
    else this.commitHooks.push(fn);
  }

  /** Führt `fn` in einer Transaktion aus. Verschachtelte Aufrufe nutzen Savepoints. */
  transaction<T>(fn: () => T): T {
    const savepoint = `sp_${this.depth}`;
    const hooksBefore = this.commitHooks.length;
    if (this.depth === 0) this.raw.exec('BEGIN IMMEDIATE');
    else this.raw.exec(`SAVEPOINT ${savepoint}`);
    this.depth++;
    let result: T;
    try {
      result = fn();
      if (result instanceof Promise) {
        throw new Error('Transaktionen dürfen keine asynchronen Funktionen enthalten');
      }
    } catch (err) {
      this.depth--;
      this.commitHooks.length = Math.min(this.commitHooks.length, hooksBefore);
      try {
        if (this.depth === 0) this.raw.exec('ROLLBACK');
        else this.raw.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
      } catch {
        /* Rollback-Fehler dürfen die eigentliche Ursache nicht verdecken */
      }
      throw err;
    }
    this.depth--;
    try {
      if (this.depth === 0) this.raw.exec('COMMIT');
      else this.raw.exec(`RELEASE ${savepoint}`);
    } catch (err) {
      // COMMIT fehlgeschlagen (z. B. Datenträger voll): Transaktion sauber verwerfen, Tiefe stimmt bereits
      this.commitHooks.length = Math.min(this.commitHooks.length, hooksBefore);
      if (this.depth === 0 && this.raw.isTransaction) {
        try {
          this.raw.exec('ROLLBACK');
        } catch {
          /* bereits beendet */
        }
      }
      throw err;
    }
    if (this.depth === 0 && this.commitHooks.length) {
      const hooks = this.commitHooks;
      this.commitHooks = [];
      for (const hook of hooks) {
        try {
          hook();
        } catch {
          /* ein fehlerhafter Nachlauf darf die abgeschlossene Transaktion nicht umwerfen */
        }
      }
    }
    return result;
  }

  /** Platzhalter für IN-Listen: `(?, ?, ?)`. */
  static placeholders(count: number): string {
    return count > 0 ? `(${new Array(count).fill('?').join(', ')})` : '(NULL)';
  }

  close(): void {
    this.statements.clear();
    this.raw.close();
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || value === '') return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
