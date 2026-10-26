import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import { badRequest, HttpError } from './errors.ts';
import { ZipFile, ZIP_FILE_LIMITS } from './zip-file.ts';

/**
 * Importe ohne das ganze Archiv im Arbeitsspeicher.
 *
 * Hochgeladene Dateien landen als Zwischendateien im Datenverzeichnis (`receiveUploads`). Die Konverter
 * sehen sie als Verzeichnis benannter Einträge (`ArchiveEntries`): Namen und Größen sind sofort da, der
 * Inhalt eines Eintrags wird erst beim Zugriff von der Platte gelesen – und bei jedem Zugriff neu, damit
 * nichts hängen bleibt. Vorher lagen der Upload (bis 2 GB) und alle entpackten Dateien (noch einmal bis
 * 2 GB) gleichzeitig im Speicher.
 */
export interface UploadedFile {
  /** Dateiname, wie ihn der Browser gemeldet hat */
  name: string;
  /** Zwischendatei auf der Platte */
  path: string;
  size: number;
}

export interface ArchiveEntries {
  names(): string[];
  has(name: string): boolean;
  /** Größe des entpackten Inhalts */
  size(name: string): number;
  /** Inhalt – frisch gelesen, der Aufrufer darf ihn verwerfen */
  read(name: string, maxBytes?: number): Uint8Array;
  /** Anfang des Inhalts (Formaterkennung), ohne alles zu lesen */
  head(name: string, bytes: number): Uint8Array;
  /**
   * Inhalt als Datei auf der Platte – für große Texte, die stückweise gelesen werden. Eine hochgeladene Datei
   * ist schon eine; ein Eintrag eines Archivs wird nach `dir` entpackt, ohne ihn ganz in den Speicher zu holen.
   */
  materialize(name: string, dir: string): Promise<string>;
  close(): void;
}

type Source = { zip: ZipFile; entry: string } | { file: UploadedFile } | { data: Uint8Array };

class Entries implements ArchiveEntries {
  private readonly sources = new Map<string, Source>();
  private readonly zips: ZipFile[] = [];
  private materialized = 0;

  add(name: string, source: Source): void {
    this.sources.set(name, source);
  }

  track(zip: ZipFile): void {
    this.zips.push(zip);
  }

  names(): string[] {
    return [...this.sources.keys()];
  }

  has(name: string): boolean {
    return this.sources.has(name);
  }

  private source(name: string): Source {
    const source = this.sources.get(name);
    if (!source) throw new Error(`${name} ist nicht im Import enthalten`);
    return source;
  }

  size(name: string): number {
    const source = this.source(name);
    if ('zip' in source) return source.zip.entries.get(source.entry)!.size;
    return 'file' in source ? source.file.size : source.data.byteLength;
  }

  read(name: string, maxBytes = ZIP_FILE_LIMITS.maxEntryBytes): Uint8Array {
    const source = this.source(name);
    if ('zip' in source) return source.zip.read(source.entry, maxBytes);
    if ('data' in source) return source.data;
    if (source.file.size > maxBytes) throw badRequest(`${name} ist zu groß (höchstens ${Math.round(maxBytes / 1024 ** 2)} MB).`);
    return fs.readFileSync(source.file.path);
  }

  head(name: string, bytes: number): Uint8Array {
    const source = this.source(name);
    if ('zip' in source) return source.zip.head(source.entry, bytes);
    if ('data' in source) return source.data.subarray(0, bytes);
    const fd = fs.openSync(source.file.path, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(bytes, source.file.size));
      const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
      return buffer.subarray(0, read);
    } finally {
      fs.closeSync(fd);
    }
  }

  async materialize(name: string, dir: string): Promise<string> {
    const source = this.source(name);
    if ('file' in source) return source.file.path;
    const target = path.join(dir, `entpackt-${this.materialized++}`);
    if ('data' in source) fs.writeFileSync(target, source.data);
    else await source.zip.extract(source.entry, target);
    return target;
  }

  close(): void {
    for (const zip of this.zips) zip.close();
  }
}

/**
 * Hochgeladene Dateien als Einträge öffnen: Archive (`archives`) werden zu ihren Einträgen, alles andere ist
 * selbst ein Eintrag. Ordner und der macOS-Beifang `__MACOSX/` zählen nicht.
 */
export function openUploads(files: UploadedFile[], options: { archives: RegExp }): ArchiveEntries {
  const entries = new Entries();
  try {
    for (const file of files) {
      if (!options.archives.test(file.name)) {
        entries.add(file.name.replace(/\\/g, '/'), { file });
        continue;
      }
      let zip: ZipFile;
      try {
        zip = ZipFile.open(file.path);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        throw badRequest(`${file.name} ist kein gültiges ZIP-Archiv`);
      }
      entries.track(zip);
      for (const name of zip.entries.keys()) {
        const clean = name.replace(/\\/g, '/');
        if (clean.endsWith('/') || clean.startsWith('__MACOSX/')) continue;
        entries.add(clean, { zip, entry: name });
      }
    }
  } catch (err) {
    entries.close();
    throw err;
  }
  return entries;
}

/** Einträge aus dem Speicher – für Tests und kleine, schon geladene Inhalte. */
export function memoryEntries(record: Record<string, Uint8Array>): ArchiveEntries {
  const entries = new Entries();
  for (const [name, data] of Object.entries(record)) entries.add(name, { data });
  return entries;
}

/* ------------------------------ Upload auf die Platte ------------------------------ */

export interface ReceivedUpload {
  /** Ordner der Zwischendateien – auch für Dateien, die beim Verarbeiten entstehen */
  dir: string;
  files: UploadedFile[];
  fields: Map<string, string>;
  /** Zwischendateien entfernen – immer aufrufen, auch nach Fehlern */
  cleanup(): void;
}

/** Ordner für Zwischendateien: im Datenverzeichnis, nicht unter /tmp (dort liegt oft ein RAM-Laufwerk). */
export function uploadTempDir(dataDir: string): string {
  return path.join(dataDir, 'tmp');
}

/** Liegen gebliebene Zwischendateien entfernen (nach einem Absturz mitten im Import). Nur beim Start des Servers. */
export function clearUploadTemp(dataDir: string): void {
  fs.rmSync(uploadTempDir(dataDir), { recursive: true, force: true });
}

/** Ein abgebrochener oder beschädigter Multipart-Body ist ein Fehler des Aufrufs (400), kein Serverfehler. */
export function uploadError(err: unknown): unknown {
  const e = err as { code?: string; statusCode?: number; message?: string };
  if (err instanceof Error && !e.code && !e.statusCode && /multipart|boundary|malformed|part header/i.test(e.message ?? '')) {
    return new HttpError(400, 'bad_upload', 'Der Upload ist unvollständig oder beschädigt.');
  }
  return err;
}

/**
 * Multipart-Upload entgegennehmen: Dateien werden direkt auf die Platte geschrieben, Felder gesammelt.
 * Die Größe begrenzt die Multipart-Einstellung des Servers (2 GB je Datei).
 */
export async function receiveUploads(req: FastifyRequest, dataDir: string): Promise<ReceivedUpload> {
  const base = uploadTempDir(dataDir);
  fs.mkdirSync(base, { recursive: true });
  const dir = fs.mkdtempSync(path.join(base, 'import-'));
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  const files: UploadedFile[] = [];
  const fields = new Map<string, string>();
  try {
    for await (const part of req.parts()) {
      if (part.type !== 'file') {
        fields.set(part.fieldname, String(part.value ?? ''));
        continue;
      }
      // Der Name der Zwischendatei kommt nie vom Client
      const target = path.join(dir, String(files.length));
      await pipeline(part.file, fs.createWriteStream(target));
      if (part.file.truncated) throw new HttpError(413, 'file_too_large', 'Die Datei ist zu groß (höchstens 2 GB).');
      files.push({ name: part.filename, path: target, size: fs.statSync(target).size });
    }
  } catch (err) {
    cleanup();
    const code = (err as { code?: string }).code;
    if (code === 'ENOSPC') throw new HttpError(507, 'disk_full', 'Auf dem Server ist nicht genug Speicherplatz für diesen Upload frei.');
    if (code === 'FST_REQ_FILE_TOO_LARGE') throw new HttpError(413, 'file_too_large', 'Die Datei ist zu groß (höchstens 2 GB).');
    throw uploadError(err);
  }
  return { dir, files, fields, cleanup };
}
