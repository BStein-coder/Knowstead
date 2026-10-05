import fs from 'node:fs';
import zlib from 'node:zlib';
import { once } from 'node:events';
import type { Readable } from 'node:stream';

export type TarSource =
  | { name: string; type: 'directory'; mode?: number; mtime?: Date }
  | { name: string; type: 'file'; file: string; mode?: number }
  | { name: string; type: 'symlink'; target: string; mtime?: Date };

const BLOCK = 512;
/** GNU tar und bsdtar schreiben Archive in Blöcken von 20 × 512 Bytes */
const RECORD = 20 * BLOCK;
const MAX_SIZE = 8 ** 11 - 1;

function octal(value: number, length: number): string {
  return `${Math.floor(value).toString(8).padStart(length - 1, '0')}\0`;
}

/** PAX-Eintrag „<länge> <schlüssel>=<wert>\n“ – die Länge zählt sich selbst mit */
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  const bytes = Buffer.byteLength(body);
  let total = bytes + String(bytes).length;
  while (String(total).length + bytes !== total) total = String(total).length + bytes;
  return `${total}${body}`;
}

function header(entry: { name: string; mode: number; size: number; mtime: Date; type: '0' | '2' | '5' | 'x'; linkname?: string }): Buffer {
  const block = Buffer.alloc(BLOCK);
  block.write(entry.name, 0, 100, 'utf8');
  block.write(octal(entry.mode, 8), 100, 8, 'ascii');
  block.write(octal(0, 8), 108, 8, 'ascii');
  block.write(octal(0, 8), 116, 8, 'ascii');
  block.write(octal(entry.size, 12), 124, 12, 'ascii');
  block.write(octal(entry.mtime.getTime() / 1000, 12), 136, 12, 'ascii');
  block.write('        ', 148, 8, 'ascii');
  block.write(entry.type, 156, 1, 'ascii');
  if (entry.linkname) block.write(entry.linkname, 157, 100, 'utf8');
  // Kennung ustar, Byte 262 bleibt 0, Version 00
  block.write('ustar', 257, 5, 'ascii');
  block.write('00', 263, 2, 'ascii');
  block.write('root', 265, 32, 'ascii');
  block.write('root', 297, 32, 'ascii');
  block.write(octal(0, 8), 329, 8, 'ascii');
  block.write(octal(0, 8), 337, 8, 'ascii');
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
}

function padding(size: number): Buffer {
  return Buffer.alloc((BLOCK - (size % BLOCK)) % BLOCK);
}

function entryName(name: string): string {
  const clean = name.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!clean || clean.split('/').some((segment) => segment === '..')) throw new Error(`Ungültiger Name im Archiv: ${name}`);
  return clean;
}

/**
 * Erzeugt ein tar.gz als Stream – auf jedem Betriebssystem gleich: Besitzer root, Rechte wie angegeben
 * (Standard 644 bzw. 755 für Verzeichnisse). Das `tar` von Windows speichert dagegen 666/777, und GNU tar
 * übernimmt beim Entpacken als root Rechte und Benutzerkennung aus dem Archiv. Lange oder nicht-ASCII-Pfade
 * stehen zusätzlich in PAX-Kopfzeilen. Verzeichnisse vor ihrem Inhalt angeben.
 */
export function tarGzStream(sources: Iterable<TarSource> | AsyncIterable<TarSource>, options: { level?: number } = {}): Readable {
  const gzip = zlib.createGzip({ level: options.level ?? 9 });
  let written = 0;

  const write = async (chunk: Buffer) => {
    written += chunk.length;
    if (!gzip.write(chunk)) await once(gzip, 'drain');
  };

  const writeHeader = async (entry: Parameters<typeof header>[0]) => {
    const records: string[] = [];
    // Nur druckbares ASCII passt verlustfrei in die ustar-Felder
    const plain = (value: string) => Buffer.byteLength(value) <= 100 && /^[ -~]*$/.test(value);
    if (!plain(entry.name)) records.push(paxRecord('path', entry.name));
    if (entry.linkname && !plain(entry.linkname)) records.push(paxRecord('linkpath', entry.linkname));
    if (records.length) {
      const data = Buffer.from(records.join(''), 'utf8');
      await write(header({ name: `PaxHeaders/${entry.name.replace(/\/$/, '').split('/').pop()!.slice(0, 80)}`, mode: 0o644, size: data.length, mtime: entry.mtime, type: 'x' }));
      await write(data);
      await write(padding(data.length));
    }
    await write(header(entry));
  };

  (async () => {
    try {
      for await (const src of sources as AsyncIterable<TarSource>) {
        const name = entryName(src.name);
        if (src.type === 'directory') {
          await writeHeader({ name: `${name.replace(/\/$/, '')}/`, mode: src.mode ?? 0o755, size: 0, mtime: src.mtime ?? new Date(), type: '5' });
        } else if (src.type === 'symlink') {
          await writeHeader({ name, mode: 0o777, size: 0, mtime: src.mtime ?? new Date(), type: '2', linkname: src.target.replace(/\\/g, '/') });
        } else {
          const stat = await fs.promises.stat(src.file);
          if (stat.size > MAX_SIZE) throw new Error(`${src.file} ist für das Archiv zu groß`);
          await writeHeader({ name, mode: src.mode ?? 0o644, size: stat.size, mtime: stat.mtime, type: '0' });
          let size = 0;
          for await (const chunk of fs.createReadStream(src.file)) {
            size += (chunk as Buffer).length;
            await write(chunk as Buffer);
          }
          if (size !== stat.size) throw new Error(`${src.file} hat sich beim Packen geändert`);
          await write(padding(size));
        }
      }
      // Ende: zwei leere Blöcke, aufgefüllt auf ganze Records
      await write(Buffer.alloc(2 * BLOCK));
      await write(Buffer.alloc((RECORD - (written % RECORD)) % RECORD));
      gzip.end();
    } catch (err) {
      gzip.destroy(err as Error);
    }
  })();
  return gzip;
}
