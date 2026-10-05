import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { zipStream, type ZipSource } from '../src/core/zip.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

async function collect(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

test('ZIP-Stream: Inhalte bleiben unverändert – auch bei Dateien, an denen der Kompressor von fflate scheitert', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-zip-'));
  try {
    const expected = new Map<string, Buffer>();
    const sources: ZipSource[] = [];
    // Diese Schriftdateien machte fflates ZipDeflate (0.8.3) unlesbar („invalid distance too far back“)
    const fonts = path.join(ROOT, 'node_modules', 'katex', 'dist', 'fonts');
    for (const font of ['KaTeX_SansSerif-Bold.ttf', 'KaTeX_SansSerif-Regular.ttf', 'KaTeX_Size1-Regular.ttf']) {
      const file = path.join(fonts, font);
      if (!fs.existsSync(file)) continue;
      expected.set(`fonts/${font}`, fs.readFileSync(file));
      sources.push({ name: `fonts/${font}`, file });
    }
    // große, teils komprimierbare Datei über mehrere Lesepuffer hinweg
    const lines: string[] = [];
    for (let i = 0; i < 60_000; i++) lines.push(`Zeile ${i} ${crypto.randomBytes(6).toString('hex')} ${'Inhalt '.repeat(i % 7)}`);
    const big = Buffer.from(lines.join('\n'));
    fs.writeFileSync(path.join(dir, 'gross.txt'), big);
    expected.set('gross.txt', big);
    sources.push({ name: 'gross.txt', file: path.join(dir, 'gross.txt') });
    // zufällige (nicht komprimierbare) Daten, bereits komprimierte Endung und Daten aus dem Speicher
    const random = crypto.randomBytes(300_000);
    fs.writeFileSync(path.join(dir, 'zufall.bin'), random);
    expected.set('zufall.bin', random);
    sources.push({ name: 'zufall.bin', file: path.join(dir, 'zufall.bin') });
    const png = crypto.randomBytes(5000);
    expected.set('bild.png', png);
    sources.push({ name: 'bild.png', data: png });
    expected.set('leer.txt', Buffer.alloc(0));
    sources.push({ name: 'leer.txt', data: '' });
    expected.set('text/umlaute.md', Buffer.from('# Überschrift\n\nÄrger über Öl – „Anführungszeichen“'));
    sources.push({ name: 'text\\umlaute.md', data: '# Überschrift\n\nÄrger über Öl – „Anführungszeichen“' });

    async function* slowly() {
      for (const source of sources) {
        await new Promise((resolve) => setImmediate(resolve));
        yield source;
      }
    }
    const archive = await collect(zipStream(slowly()));
    const files = unzipSync(new Uint8Array(archive));
    assert.deepEqual(Object.keys(files).sort(), [...expected.keys()].sort());
    for (const [name, content] of expected) {
      assert.ok(Buffer.from(files[name]).equals(content), `${name} unverändert`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
