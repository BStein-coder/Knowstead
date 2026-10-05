import fs from 'node:fs';
import { once } from 'node:events';
import zlib from 'node:zlib';
import { PassThrough, type Readable } from 'node:stream';
import { Zip, ZipPassThrough, type ZipInputFile } from 'fflate';

export type ZipSource = { name: string; data: string | Uint8Array } | { name: string; file: string };

const STORED = /\.(png|jpe?g|gif|webp|avif|zip|gz|7z|mp4|webm|mp3|ogg|pdf|docx|xlsx|pptx)$/i;

/**
 * ZIP-Eintrag, den zlib von Node.js komprimiert. Der streamende Kompressor von fflate (ZipDeflate, 0.8.3)
 * erzeugt bei manchen Eingaben ungültige Daten („invalid distance too far back“) – betroffen wären
 * Bereichsexporte und heruntergeladene Sicherungen. fflate schreibt weiterhin nur die ZIP-Struktur.
 */
class NodeDeflateEntry implements ZipInputFile {
  readonly filename: string;
  readonly compression = 8;
  size = 0;
  crc = 0;
  ondata?: ZipInputFile['ondata'];
  private readonly deflate = zlib.createDeflateRaw({ level: 6 });

  constructor(filename: string) {
    this.filename = filename;
    this.deflate.on('data', (chunk: Buffer) => this.ondata?.(null, new Uint8Array(chunk), false));
    // Größe und Prüfsumme stehen fest, bevor der letzte Block gemeldet wird
    this.deflate.on('end', () => this.ondata?.(null, new Uint8Array(0), true));
    this.deflate.on('error', (err) => this.ondata?.(Object.assign(err, { code: 0 }), new Uint8Array(0), true));
  }

  /** Gibt `false` zurück, wenn vor dem nächsten Stück auf `drain()` gewartet werden soll. */
  push(chunk: Uint8Array, final = false): boolean {
    let ready = true;
    if (chunk.length) {
      this.size += chunk.length;
      this.crc = zlib.crc32(chunk, this.crc);
      ready = this.deflate.write(chunk);
    }
    if (final) this.deflate.end();
    return ready;
  }

  async drain(): Promise<void> {
    await once(this.deflate, 'drain');
  }

  terminate(): void {
    this.deflate.destroy();
  }
}

/**
 * Erzeugt ein ZIP-Archiv als Stream (speicherschonend, Dateien werden
 * nacheinander gelesen). `sources` darf ein (async) Iterable sein.
 */
export function zipStream(sources: Iterable<ZipSource> | AsyncIterable<ZipSource>): Readable {
  const out = new PassThrough();
  const zip = new Zip((err, chunk, final) => {
    if (err) {
      out.destroy(err);
      return;
    }
    out.write(Buffer.from(chunk));
    if (final) out.end();
  });

  (async () => {
    try {
      for await (const src of sources as AsyncIterable<ZipSource>) {
        const name = src.name.replace(/\\/g, '/').replace(/^\/+/, '');
        const entry = STORED.test(name) ? new ZipPassThrough(name) : new NodeDeflateEntry(name);
        zip.add(entry);
        if ('data' in src) {
          entry.push(typeof src.data === 'string' ? new TextEncoder().encode(src.data) : src.data, true);
          continue;
        }
        for await (const chunk of fs.createReadStream(src.file)) {
          const ready = entry.push(chunk as Buffer, false);
          if (ready === false && entry instanceof NodeDeflateEntry) await entry.drain();
          if (out.writableNeedDrain) await once(out, 'drain');
        }
        entry.push(new Uint8Array(0), true);
      }
      zip.end();
    } catch (err) {
      out.destroy(err as Error);
    }
  })();
  return out;
}

/** Eintragsname aus einem Archiv ohne Laufwerk, absolute Pfade und `.`/`..` – Importe bleiben in ihrem Ziel. */
export function safeEntryName(name: string): string {
  return name
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..' && !/^[a-z]:$/i.test(segment))
    .join('/');
}
