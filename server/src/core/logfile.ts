import fs from 'node:fs';
import path from 'node:path';

/**
 * Protokoll in eine Datei mit einfacher Rotation (`LOG_FILE`). Gedacht für den Betrieb als
 * geplante Aufgabe oder Dienst ohne Konsole: `knowstead.log` wird bei Erreichen der Größe zu `knowstead.log.1`,
 * ältere Stände rücken nach, der älteste entfällt. Jede Zeile geht zusätzlich an die Konsole.
 */
export class RotatingLogStream {
  private fd: number;
  private size: number;
  readonly file: string;
  private readonly maxBytes: number;
  private readonly keep: number;
  private readonly mirror: NodeJS.WritableStream | null;

  constructor(file: string, options: { maxBytes?: number; keep?: number; mirror?: NodeJS.WritableStream | null } = {}) {
    this.file = file;
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
    this.keep = Math.max(1, options.keep ?? 5);
    this.mirror = options.mirror === undefined ? process.stdout : options.mirror;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.fd = fs.openSync(file, 'a');
    this.size = fs.fstatSync(this.fd).size;
  }

  write(chunk: string | Uint8Array): boolean {
    const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    try {
      if (this.size > 0 && this.size + data.length > this.maxBytes) this.rotate();
      fs.writeSync(this.fd, data);
      this.size += data.length;
    } catch {
      // Platte voll oder Datei gesperrt: Die Zeile geht in die Datei verloren, der Server läuft weiter (die Konsole bekommt sie trotzdem)
    }
    this.mirror?.write(data);
    return true;
  }

  private rotate(): void {
    fs.closeSync(this.fd);
    for (let i = this.keep; i >= 1; i--) {
      const from = i === 1 ? this.file : `${this.file}.${i - 1}`;
      const to = `${this.file}.${i}`;
      if (!fs.existsSync(from)) continue;
      if (i === this.keep) fs.rmSync(to, { force: true });
      try {
        fs.renameSync(from, to);
      } catch {
        // Datei gerade gesperrt (z. B. von einem Betrachter geöffnet) – dann eben ohne Umbenennen weiter
      }
    }
    this.fd = fs.openSync(this.file, 'a');
    this.size = fs.fstatSync(this.fd).size;
  }

  close(): void {
    try {
      fs.closeSync(this.fd);
    } catch {
      /* bereits geschlossen */
    }
  }
}
