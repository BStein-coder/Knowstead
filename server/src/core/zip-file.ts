import fs from 'node:fs';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import { badRequest, HttpError } from './errors.ts';

/**
 * ZIP-Archiv von der Platte lesen – Eintrag für Eintrag.
 *
 * Für Importe: Ein hochgeladenes Archiv liegt als Datei im Datenverzeichnis, gelesen wird nur das
 * Inhaltsverzeichnis am Ende der Datei. Der Inhalt eines Eintrags kommt erst beim Zugriff in den Speicher
 * und kann danach wieder verworfen werden. So hängt der Speicherbedarf vom größten Eintrag ab, nicht von
 * der Größe des Archivs (vorher: Upload und sämtliche entpackten Dateien gleichzeitig im Speicher).
 *
 * Unterstützt: gespeicherte und mit Deflate gepackte Einträge, ZIP64, Dateinamen in UTF-8 (auch ohne das
 * Kennzeichen dafür, wie sie Linux und macOS schreiben). Verschlüsselte Einträge werden abgewiesen.
 */
export interface ZipEntry {
  name: string;
  /** 0 = gespeichert, 8 = Deflate */
  method: number;
  compressedSize: number;
  /** Größe des entpackten Inhalts laut Archiv */
  size: number;
  crc: number;
  encrypted: boolean;
  /** Position des lokalen Dateikopfs */
  offset: number;
}

/** Obergrenzen – schützen vor „ZIP-Bomben“ (kleines Archiv, riesiger Inhalt) und vor beschädigten Verzeichnissen. */
export const ZIP_FILE_LIMITS = {
  maxEntries: 100_000,
  /** Summe der entpackten Größen laut Archiv */
  maxTotalBytes: 8 * 1024 ** 3,
  /** größter Eintrag, der in den Speicher gelesen wird */
  maxEntryBytes: 512 * 1024 ** 2,
};

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const UTF8_STRICT = new TextDecoder('utf-8', { fatal: true });

function formatBytes(bytes: number): string {
  return bytes >= 1024 ** 3 ? `${Math.round((bytes / 1024 ** 3) * 10) / 10} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;
}

function decodeName(raw: Buffer, utf8Flag: boolean): string {
  if (utf8Flag) return raw.toString('utf8');
  // Ohne Kennzeichen: Linux und macOS schreiben trotzdem UTF-8. Ist es keins, bleibt die bisherige Lesart (Latin-1).
  try {
    return UTF8_STRICT.decode(raw);
  } catch {
    return raw.toString('latin1');
  }
}

export class ZipFile {
  readonly file: string;
  readonly entries = new Map<string, ZipEntry>();
  private fd: number | null;

  private constructor(file: string, fd: number) {
    this.file = file;
    this.fd = fd;
  }

  /** Öffnet das Archiv und liest sein Inhaltsverzeichnis. Wirft bei allem, was kein lesbares ZIP ist. */
  static open(file: string, limits: Partial<typeof ZIP_FILE_LIMITS> = {}): ZipFile {
    const { maxEntries, maxTotalBytes } = { ...ZIP_FILE_LIMITS, ...limits };
    const fd = fs.openSync(file, 'r');
    const zip = new ZipFile(file, fd);
    try {
      zip.readDirectory(maxEntries, maxTotalBytes);
    } catch (err) {
      zip.close();
      throw err;
    }
    return zip;
  }

  private bytes(position: number, length: number): Buffer {
    if (this.fd === null) throw new Error('Das Archiv ist bereits geschlossen');
    const buffer = Buffer.allocUnsafe(length);
    let done = 0;
    while (done < length) {
      const read = fs.readSync(this.fd, buffer, done, length - done, position + done);
      if (read <= 0) throw new Error('Das Archiv endet vorzeitig');
      done += read;
    }
    return buffer;
  }

  private readDirectory(maxEntries: number, maxTotalBytes: number): void {
    const fileSize = fs.fstatSync(this.fd!).size;
    if (fileSize < 22) throw new Error('kein ZIP-Archiv');
    // Das Ende des Inhaltsverzeichnisses steht ganz hinten, davor höchstens ein Kommentar von 64 KB
    const tailLength = Math.min(fileSize, 22 + 0xffff);
    const tail = this.bytes(fileSize - tailLength, tailLength);
    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === SIG_EOCD) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('kein ZIP-Archiv');
    let count = tail.readUInt16LE(eocd + 10);
    let directorySize = tail.readUInt32LE(eocd + 12);
    let directoryOffset = tail.readUInt32LE(eocd + 16);
    if (count === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) {
      // ZIP64: Der Verweis steht unmittelbar vor dem Ende des Inhaltsverzeichnisses
      const locatorAt = fileSize - tailLength + eocd - 20;
      if (locatorAt < 0) throw new Error('beschädigtes ZIP64-Archiv');
      const locator = this.bytes(locatorAt, 20);
      if (locator.readUInt32LE(0) !== SIG_EOCD64_LOCATOR) throw new Error('beschädigtes ZIP64-Archiv');
      const record = this.bytes(Number(locator.readBigUInt64LE(8)), 56);
      if (record.readUInt32LE(0) !== SIG_EOCD64) throw new Error('beschädigtes ZIP64-Archiv');
      count = Number(record.readBigUInt64LE(32));
      directorySize = Number(record.readBigUInt64LE(40));
      directoryOffset = Number(record.readBigUInt64LE(48));
    }
    if (count > maxEntries) throw badRequest(`Das Archiv enthält zu viele Dateien (höchstens ${maxEntries.toLocaleString('de-DE')}).`);
    if (directoryOffset + directorySize > fileSize || directorySize > 512 * 1024 ** 2) throw new Error('beschädigtes ZIP-Archiv');

    const directory = this.bytes(directoryOffset, directorySize);
    let at = 0;
    let total = 0;
    for (let i = 0; i < count; i++) {
      if (at + 46 > directory.length || directory.readUInt32LE(at) !== SIG_CENTRAL) throw new Error('beschädigtes ZIP-Archiv');
      const flags = directory.readUInt16LE(at + 8);
      const method = directory.readUInt16LE(at + 10);
      const crc = directory.readUInt32LE(at + 16);
      let compressedSize = directory.readUInt32LE(at + 20);
      let size = directory.readUInt32LE(at + 24);
      const nameLength = directory.readUInt16LE(at + 28);
      const extraLength = directory.readUInt16LE(at + 30);
      const commentLength = directory.readUInt16LE(at + 32);
      let offset = directory.readUInt32LE(at + 42);
      const name = decodeName(directory.subarray(at + 46, at + 46 + nameLength), (flags & 0x800) !== 0);
      // ZIP64-Zusatzfeld: nur die Werte, die im Hauptfeld als „zu groß“ markiert sind – in fester Reihenfolge
      const extraEnd = at + 46 + nameLength + extraLength;
      for (let e = at + 46 + nameLength; e + 4 <= extraEnd; ) {
        const id = directory.readUInt16LE(e);
        const length = directory.readUInt16LE(e + 2);
        if (id === 0x0001) {
          let p = e + 4;
          if (size === 0xffffffff && p + 8 <= extraEnd) {
            size = Number(directory.readBigUInt64LE(p));
            p += 8;
          }
          if (compressedSize === 0xffffffff && p + 8 <= extraEnd) {
            compressedSize = Number(directory.readBigUInt64LE(p));
            p += 8;
          }
          if (offset === 0xffffffff && p + 8 <= extraEnd) offset = Number(directory.readBigUInt64LE(p));
        }
        e += 4 + length;
      }
      at = extraEnd + commentLength;
      if (name.endsWith('/')) continue; // Ordner
      total += size;
      if (total > maxTotalBytes) throw badRequest(`Das Archiv ist entpackt zu groß (höchstens ${formatBytes(maxTotalBytes)}).`);
      this.entries.set(name, { name, method, compressedSize, size, crc, encrypted: (flags & 1) !== 0, offset });
    }
  }

  private dataStart(entry: ZipEntry): number {
    const header = this.bytes(entry.offset, 30);
    if (header.readUInt32LE(0) !== SIG_LOCAL) throw new Error(`${entry.name}: beschädigter Eintrag`);
    return entry.offset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28);
  }

  private check(name: string): ZipEntry {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`${name} ist nicht im Archiv`);
    if (entry.encrypted) throw badRequest(`${name} ist verschlüsselt – bitte ein Archiv ohne Kennwort hochladen.`);
    if (entry.method !== 0 && entry.method !== 8) throw badRequest(`${name} ist mit einem nicht unterstützten Verfahren gepackt.`);
    return entry;
  }

  /**
   * Inhalt eines Eintrags. `maxBytes` begrenzt, was in den Speicher darf – entpackt wird nie mehr, als das
   * Archiv selbst für den Eintrag angibt (ein gefälschter Kopf bläht also nichts auf).
   */
  read(name: string, maxBytes = ZIP_FILE_LIMITS.maxEntryBytes): Buffer {
    const entry = this.check(name);
    if (entry.size > maxBytes) throw badRequest(`${name} ist zu groß (${formatBytes(entry.size)}, höchstens ${formatBytes(maxBytes)}).`);
    const raw = this.bytes(this.dataStart(entry), entry.compressedSize);
    let data: Buffer;
    if (entry.method === 0) data = raw;
    else {
      try {
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(entry.size, 1) });
      } catch {
        throw badRequest(`${name} lässt sich nicht entpacken – das Archiv ist beschädigt.`);
      }
    }
    if (data.length !== entry.size || zlib.crc32(data) !== entry.crc) throw badRequest(`${name} lässt sich nicht entpacken – das Archiv ist beschädigt.`);
    return data;
  }

  /** Die ersten Bytes eines Eintrags (Formaterkennung) – ohne ihn ganz zu entpacken. */
  head(name: string, bytes: number): Buffer {
    const entry = this.check(name);
    const start = this.dataStart(entry);
    if (entry.method === 0) return this.bytes(start, Math.min(bytes, entry.compressedSize));
    // Ein Stück der gepackten Daten genügt; Z_SYNC_FLUSH liefert, was sich daraus schon entpacken lässt
    const raw = this.bytes(start, Math.min(entry.compressedSize, Math.max(4096, bytes * 2)));
    try {
      // Deflate packt höchstens rund 1:1030 – mit dieser Grenze passt jedes Ergebnis des gelesenen Stücks
      return zlib.inflateRawSync(raw, { finishFlush: zlib.constants.Z_SYNC_FLUSH, maxOutputLength: Math.min(64 * 1024 ** 2, raw.length * 1100) }).subarray(0, bytes);
    } catch {
      return this.read(name).subarray(0, bytes);
    }
  }

  /**
   * Eintrag in eine Datei entpacken – als Strom, also ohne ihn ganz im Speicher zu halten. Geschrieben wird
   * höchstens die Größe, die das Archiv für den Eintrag angibt.
   */
  async extract(name: string, target: string): Promise<void> {
    const entry = this.check(name);
    const start = this.dataStart(entry);
    let written = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        written += chunk.length;
        done(written > entry.size ? badRequest(`${name} lässt sich nicht entpacken – das Archiv ist beschädigt.`) : null, chunk);
      },
    });
    const input = entry.compressedSize > 0 ? fs.createReadStream(this.file, { start, end: start + entry.compressedSize - 1 }) : Readable.from([]);
    try {
      if (entry.method === 0) await pipeline(input, limit, fs.createWriteStream(target));
      else await pipeline(input, zlib.createInflateRaw(), limit, fs.createWriteStream(target));
    } catch (err) {
      fs.rmSync(target, { force: true });
      if (err instanceof HttpError) throw err;
      throw badRequest(`${name} lässt sich nicht entpacken – das Archiv ist beschädigt.`);
    }
    if (written !== entry.size) {
      fs.rmSync(target, { force: true });
      throw badRequest(`${name} lässt sich nicht entpacken – das Archiv ist beschädigt.`);
    }
  }

  close(): void {
    if (this.fd === null) return;
    try {
      fs.closeSync(this.fd);
    } catch {
      /* bereits geschlossen */
    }
    this.fd = null;
  }
}
