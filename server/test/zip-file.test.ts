import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { zipSync, strToU8 } from 'fflate';
import { ZipFile } from '../src/core/zip-file.ts';
import { memoryEntries, openUploads } from '../src/core/archive-entries.ts';

/**
 * ZIP-Archive von der Platte lesen: nur das Inhaltsverzeichnis sofort, Inhalte einzeln beim Zugriff.
 * Grundlage der Importe, die nicht mehr das ganze Archiv im Arbeitsspeicher halten.
 */
function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-zip-'));
}

/** Eintrag im Inhaltsverzeichnis suchen: Position des Kopfs (Signatur PK\x01\x02) zum Namen. */
function centralHeader(archive: Buffer, name: string): number {
  const needle = Buffer.from(name, 'utf8');
  for (let i = 0; i + 46 < archive.length; i++) {
    if (archive.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = archive.readUInt16LE(i + 28);
    if (nameLength === needle.length && archive.subarray(i + 46, i + 46 + nameLength).equals(needle)) return i;
  }
  throw new Error(`${name} nicht im Inhaltsverzeichnis`);
}

test('Archiv von der Platte: Verzeichnis, Inhalt, Anfang, Entpacken in eine Datei', async () => {
  const dir = tempDir();
  try {
    const big = crypto.randomBytes(300_000);
    const text = 'Zeile mit Umlauten: äöü ß\n'.repeat(4000);
    const file = path.join(dir, 'archiv.zip');
    fs.writeFileSync(
      file,
      zipSync({
        'seiten/start.txt': strToU8(text),
        'medien/bild.bin': [big, { level: 0 }],
        'medien/Größe und Maß.png': strToU8('png'),
        'leer.txt': new Uint8Array(),
        'ordner/': new Uint8Array(),
      }),
    );
    const zip = ZipFile.open(file);
    try {
      assert.deepEqual([...zip.entries.keys()].sort(), ['leer.txt', 'medien/Größe und Maß.png', 'medien/bild.bin', 'seiten/start.txt'], 'Ordner zählen nicht');
      assert.equal(zip.entries.get('seiten/start.txt')!.size, Buffer.byteLength(text));
      assert.equal(zip.entries.get('seiten/start.txt')!.method, 8);
      assert.equal(zip.entries.get('medien/bild.bin')!.method, 0, 'gespeichert, nicht gepackt');

      assert.equal(zip.read('seiten/start.txt').toString('utf8'), text);
      assert.ok(zip.read('medien/bild.bin').equals(big));
      assert.equal(zip.read('leer.txt').length, 0);
      // Zweimal lesen liefert zweimal dasselbe – nichts wird festgehalten
      assert.ok(zip.read('medien/bild.bin').equals(big));

      assert.ok(zip.head('seiten/start.txt', 30).equals(Buffer.from(text).subarray(0, 30)), 'nur der Anfang, ohne alles zu entpacken');
      assert.ok(zip.head('medien/bild.bin', 100).equals(big.subarray(0, 100)));
      assert.equal(zip.head('leer.txt', 10).length, 0);

      const target = path.join(dir, 'entpackt');
      await zip.extract('seiten/start.txt', target);
      assert.equal(fs.readFileSync(target, 'utf8'), text);
      await zip.extract('medien/bild.bin', target);
      assert.ok(fs.readFileSync(target).equals(big));
      await zip.extract('leer.txt', target);
      assert.equal(fs.statSync(target).size, 0);

      assert.throws(() => zip.read('medien/bild.bin', 1000), /bild\.bin ist zu groß/);
      assert.throws(() => zip.read('gibt-es-nicht'), /nicht im Archiv/);
    } finally {
      zip.close();
    }
    assert.throws(() => zip.read('leer.txt'), /geschlossen/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Archiv von der Platte: Obergrenzen und beschädigte Archive', async () => {
  const dir = tempDir();
  try {
    const write = (name: string, data: Uint8Array) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, data);
      return file;
    };
    const plain = zipSync({ 'a.txt': strToU8('a'.repeat(5000)), 'b.txt': strToU8('b'.repeat(5000)), 'c.txt': strToU8('c'.repeat(5000)) });
    const file = write('klein.zip', plain);
    assert.throws(() => ZipFile.open(file, { maxEntries: 2 }), /zu viele Dateien/);
    assert.throws(() => ZipFile.open(file, { maxTotalBytes: 12_000 }), /entpackt zu groß/);
    assert.throws(() => ZipFile.open(write('text.zip', strToU8('kein Archiv, nur Text – aber lang genug für die Prüfung'))), /kein ZIP-Archiv/);
    assert.throws(() => ZipFile.open(write('kurz.zip', strToU8('PK'))), /kein ZIP-Archiv/);

    // Gefälschte Größe im Verzeichnis (kleiner als der wahre Inhalt): Es wird nie mehr entpackt als angegeben
    const forged = Buffer.from(plain);
    forged.writeUInt32LE(10, centralHeader(forged, 'a.txt') + 24);
    const zipForged = ZipFile.open(write('gefaelscht.zip', forged));
    try {
      assert.throws(() => zipForged.read('a.txt'), /lässt sich nicht entpacken – das Archiv ist beschädigt/);
      await assert.rejects(() => zipForged.extract('a.txt', path.join(dir, 'x')), /lässt sich nicht entpacken/);
      assert.equal(fs.existsSync(path.join(dir, 'x')), false, 'kein halb geschriebenes Ergebnis');
      assert.equal(zipForged.read('b.txt').toString(), 'b'.repeat(5000), 'die übrigen Einträge bleiben lesbar');
    } finally {
      zipForged.close();
    }

    // Verfälschter Inhalt: die Prüfsumme deckt es auf
    const stored = Buffer.from(zipSync({ 'bild.bin': [crypto.randomBytes(2000), { level: 0 }], 'ok.txt': strToU8('in Ordnung') }));
    stored[60] ^= 0xff;
    const zipBroken = ZipFile.open(write('kaputt.zip', stored));
    try {
      assert.throws(() => zipBroken.read('bild.bin'), /das Archiv ist beschädigt/);
      assert.equal(zipBroken.read('ok.txt').toString(), 'in Ordnung');
    } finally {
      zipBroken.close();
    }

    // Verschlüsselte Einträge (Kennzeichen im Verzeichnis) werden mit klarer Meldung abgewiesen
    const locked = Buffer.from(plain);
    const at = centralHeader(locked, 'b.txt') + 8;
    locked.writeUInt16LE(locked.readUInt16LE(at) | 1, at);
    const zipLocked = ZipFile.open(write('kennwort.zip', locked));
    try {
      assert.throws(() => zipLocked.read('b.txt'), /b\.txt ist verschlüsselt/);
    } finally {
      zipLocked.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Archiv von der Platte: Dateinamen in UTF-8 auch ohne Kennzeichen, sonst Latin-1', () => {
  const dir = tempDir();
  try {
    // fflate setzt das UTF-8-Kennzeichen; so schreiben es Linux und macOS oft ohne
    const flagged = Buffer.from(zipSync({ 'Übersicht.txt': strToU8('x') }));
    const unflagged = Buffer.from(flagged);
    const header = centralHeader(unflagged, 'Übersicht.txt') + 8;
    unflagged.writeUInt16LE(unflagged.readUInt16LE(header) & ~0x800, header);
    const file = path.join(dir, 'ohne-kennzeichen.zip');
    fs.writeFileSync(file, unflagged);
    const zip = ZipFile.open(file);
    try {
      assert.deepEqual([...zip.entries.keys()], ['Übersicht.txt']);
    } finally {
      zip.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Kleines Archiv in der ZIP64-Form bauen: Zähler und Positionen stehen im erweiterten Verzeichnisende. */
function zip64Archive(files: Record<string, Buffer>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const nameBytes = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(45, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    parts.push(local, nameBytes, packed);
    // Verzeichniseintrag: Größen und Position als „siehe ZIP64-Zusatzfeld“
    const extra = Buffer.alloc(4 + 24);
    extra.writeUInt16LE(0x0001, 0);
    extra.writeUInt16LE(24, 2);
    extra.writeBigUInt64LE(BigInt(data.length), 4);
    extra.writeBigUInt64LE(BigInt(packed.length), 12);
    extra.writeBigUInt64LE(BigInt(offset), 20);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(45, 4);
    entry.writeUInt16LE(45, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(0xffffffff, 20);
    entry.writeUInt32LE(0xffffffff, 24);
    entry.writeUInt16LE(nameBytes.length, 28);
    entry.writeUInt16LE(extra.length, 30);
    entry.writeUInt32LE(0xffffffff, 42);
    central.push(entry, nameBytes, extra);
    offset += local.length + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const count = Object.keys(files).length;
  const end64 = Buffer.alloc(56);
  end64.writeUInt32LE(0x06064b50, 0);
  end64.writeBigUInt64LE(44n, 4);
  end64.writeUInt16LE(45, 12);
  end64.writeUInt16LE(45, 14);
  end64.writeBigUInt64LE(BigInt(count), 24);
  end64.writeBigUInt64LE(BigInt(count), 32);
  end64.writeBigUInt64LE(BigInt(directory.length), 40);
  end64.writeBigUInt64LE(BigInt(offset), 48);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
  locator.writeUInt32LE(1, 16);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  end.writeUInt32LE(0xffffffff, 12);
  end.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([...parts, directory, end64, locator, end]);
}

test('Archiv von der Platte: ZIP64 (mehr als 65 535 Einträge oder sehr große Archive)', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'zip64.zip');
    fs.writeFileSync(file, zip64Archive({ 'eins.txt': Buffer.from('erste Datei'), 'unter/zwei.txt': Buffer.from('zweite Datei '.repeat(500)) }));
    const zip = ZipFile.open(file);
    try {
      assert.deepEqual([...zip.entries.keys()], ['eins.txt', 'unter/zwei.txt']);
      assert.equal(zip.read('eins.txt').toString(), 'erste Datei');
      assert.equal(zip.read('unter/zwei.txt').toString(), 'zweite Datei '.repeat(500));
      assert.equal(zip.entries.get('unter/zwei.txt')!.size, 6500);
    } finally {
      zip.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Einträge eines Imports: Archive werden zu ihren Einträgen, andere Dateien sind selbst einer', async () => {
  const dir = tempDir();
  try {
    const archive = path.join(dir, '0');
    fs.writeFileSync(archive, zipSync({ 'data/pages/start.txt': strToU8('====== Start ======'), '__MACOSX/._start.txt': strToU8('x'), 'data\\media\\bild.png': strToU8('PNG') }));
    const single = path.join(dir, '1');
    fs.writeFileSync(single, 'einzelne Datei');
    const entries = openUploads(
      [
        { name: 'wiki.ZIP', path: archive, size: fs.statSync(archive).size },
        { name: 'notiz.md', path: single, size: 14 },
      ],
      { archives: /\.zip$/i },
    );
    try {
      assert.deepEqual(entries.names().sort(), ['data/media/bild.png', 'data/pages/start.txt', 'notiz.md'], 'ohne macOS-Beifang, Rückstriche als Schrägstriche');
      assert.equal(Buffer.from(entries.read('data/pages/start.txt')).toString(), '====== Start ======');
      assert.equal(Buffer.from(entries.read('notiz.md')).toString(), 'einzelne Datei');
      assert.equal(entries.size('notiz.md'), 14);
      assert.equal(Buffer.from(entries.head('notiz.md', 8)).toString(), 'einzelne');
      assert.equal(entries.has('__MACOSX/._start.txt'), false);
      // Hochgeladene Datei: schon auf der Platte; Eintrag eines Archivs: wird entpackt
      assert.equal(await entries.materialize('notiz.md', dir), single);
      const extracted = await entries.materialize('data/pages/start.txt', dir);
      assert.notEqual(extracted, archive);
      assert.equal(fs.readFileSync(extracted, 'utf8'), '====== Start ======');
    } finally {
      entries.close();
    }
    assert.throws(() => openUploads([{ name: 'kaputt.zip', path: single, size: 14 }], { archives: /\.zip$/i }), /kaputt\.zip ist kein gültiges ZIP-Archiv/);

    const memory = memoryEntries({ 'a.txt': strToU8('aus dem Speicher') });
    assert.deepEqual(memory.names(), ['a.txt']);
    assert.equal(Buffer.from(memory.head('a.txt', 3)).toString(), 'aus');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
