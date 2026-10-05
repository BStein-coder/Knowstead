import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { tarGzStream, type TarSource } from '../src/core/tar.ts';

interface Entry {
  type: string;
  mode: number;
  uid: number;
  gid: number;
  uname: string;
  linkname: string;
  data: Buffer;
}

/** Minimaler tar-Leser: prüft Prüfsummen, wertet PAX-Kopfzeilen aus */
function readTar(archive: Buffer): { entries: Map<string, Entry>; length: number } {
  const tar = zlib.gunzipSync(archive);
  const entries = new Map<string, Entry>();
  const text = (block: Buffer, start: number, length: number) => {
    const field = block.subarray(start, start + length);
    const end = field.indexOf(0);
    return field.subarray(0, end < 0 ? length : end).toString('utf8');
  };
  const number = (block: Buffer, start: number, length: number) => parseInt(text(block, start, length).trim() || '0', 8);
  let pax: Record<string, string> = {};
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const block = tar.subarray(offset, offset + 512);
    if (block.every((byte) => byte === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : block[i];
    assert.equal(number(block, 148, 8), sum, `Prüfsumme bei Byte ${offset}`);
    assert.equal(text(block, 257, 6), 'ustar');
    const size = number(block, 124, 12);
    const type = text(block, 156, 1);
    const data = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
    if (type === 'x') {
      for (const record of data.toString('utf8').split('\n').filter(Boolean)) {
        const [, key, value] = /^\d+ ([^=]+)=(.*)$/s.exec(record)!;
        pax[key] = value;
      }
      continue;
    }
    const name = pax.path ?? text(block, 0, 100);
    entries.set(name, {
      type,
      mode: number(block, 100, 8),
      uid: number(block, 108, 8),
      gid: number(block, 116, 8),
      uname: text(block, 265, 32),
      linkname: pax.linkpath ?? text(block, 157, 100),
      data: Buffer.from(data),
    });
    pax = {};
  }
  return { entries, length: tar.length };
}

test('tar.gz: Rechte und Besitzer fest, lange und nicht-ASCII-Pfade, lesbar für GNU tar bzw. bsdtar', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-tar-'));
  try {
    const src = path.join(dir, 'quelle');
    const longDir = `node_modules/${'sehr-langer-paketname-'.repeat(4)}/dist/${'unterordner-'.repeat(3)}`;
    const files: Record<string, Buffer> = {
      'package.json': Buffer.from('{"name":"knowstead"}\n'),
      'install.sh': Buffer.from('#!/usr/bin/env bash\necho ok\n'),
      'leer.txt': Buffer.alloc(0),
      'docs/Größe und Maße.md': Buffer.from('# Umlaute\n'),
      [`${longDir}/index.js`]: Buffer.from('export default 1;\n'),
      // mehrere Lesepuffer und krumme Blockgrenze
      'daten.bin': crypto.randomBytes(3 * 65_536 + 123),
    };
    const sources: TarSource[] = [{ name: 'knowstead/', type: 'directory' }];
    const dirs = new Set<string>();
    for (const [name, content] of Object.entries(files)) {
      const parts = name.split('/').slice(0, -1);
      for (let i = 1; i <= parts.length; i++) {
        const sub = parts.slice(0, i).join('/');
        if (!dirs.has(sub)) {
          dirs.add(sub);
          sources.push({ name: `knowstead/${sub}`, type: 'directory' });
        }
      }
      fs.mkdirSync(path.join(src, ...parts), { recursive: true });
      fs.writeFileSync(path.join(src, name), content);
      sources.push({ name: `knowstead/${name}`, type: 'file', file: path.join(src, name), mode: name.endsWith('.sh') ? 0o755 : undefined });
    }
    const archive = path.join(dir, 'paket.tar.gz');
    await pipeline(tarGzStream([...sources, { name: 'knowstead/node_modules/@knowstead/server', type: 'symlink', target: '../../server' }]), fs.createWriteStream(archive));

    const { entries, length } = readTar(fs.readFileSync(archive));
    assert.equal(length % 10_240, 0, 'auf ganze Records aufgefüllt');
    for (const [name, content] of Object.entries(files)) {
      const entry = entries.get(`knowstead/${name}`);
      assert.ok(entry, `${name} fehlt`);
      assert.equal(entry.type, '0');
      assert.ok(entry.data.equals(content), `${name} unverändert`);
      assert.equal(entry.mode, name.endsWith('.sh') ? 0o755 : 0o644, `Rechte von ${name}`);
      assert.equal(entry.uid, 0);
      assert.equal(entry.gid, 0);
      assert.equal(entry.uname, 'root');
    }
    assert.ok(Buffer.byteLength(`knowstead/${longDir}/index.js`) > 100, 'Testpfad ist länger als das ustar-Feld');
    assert.equal(entries.get('knowstead/docs/')?.mode, 0o755);
    assert.equal(entries.get('knowstead/docs/')?.type, '5');
    assert.equal(entries.get('knowstead/node_modules/@knowstead/server')?.type, '2');
    assert.equal(entries.get('knowstead/node_modules/@knowstead/server')?.linkname, '../../server');

    // Gegenprobe mit dem tar des Systems (GNU tar unter Linux, bsdtar unter Windows): Liste und Entpacken
    const plain = path.join(dir, 'ohne-link.tar.gz');
    await pipeline(tarGzStream(sources), fs.createWriteStream(plain));
    const listed = spawnSync('tar', ['-tzf', 'ohne-link.tar.gz'], { cwd: dir, encoding: 'utf8' });
    if (listed.error) {
      console.log('  (kein tar gefunden – Gegenprobe übersprungen)');
      return;
    }
    assert.equal(listed.status, 0, listed.stderr);
    assert.ok(listed.stdout.includes(`knowstead/${longDir}/index.js`), 'langer Pfad wird gelesen');
    fs.mkdirSync(path.join(dir, 'aus'));
    const extracted = spawnSync('tar', ['-xzf', 'ohne-link.tar.gz', '-C', 'aus'], { cwd: dir, encoding: 'utf8' });
    assert.equal(extracted.status, 0, extracted.stderr);
    for (const [name, content] of Object.entries(files)) {
      assert.ok(fs.readFileSync(path.join(dir, 'aus', 'knowstead', name)).equals(content), `${name} entpackt`);
    }
    if (process.platform !== 'win32') {
      assert.equal(fs.statSync(path.join(dir, 'aus', 'knowstead', 'install.sh')).mode & 0o777, 0o755);
      assert.equal(fs.statSync(path.join(dir, 'aus', 'knowstead', 'package.json')).mode & 0o022, 0, 'nicht für Gruppe/andere beschreibbar');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tar.gz: Pfade mit ".." werden abgelehnt', async () => {
  await assert.rejects(
    pipeline(tarGzStream([{ name: 'knowstead/../../etc/passwd', type: 'directory' }]), fs.createWriteStream(path.join(os.tmpdir(), `knowstead-tar-${process.pid}.tar.gz`))),
    /Ungültiger Name/,
  );
  fs.rmSync(path.join(os.tmpdir(), `knowstead-tar-${process.pid}.tar.gz`), { force: true });
});
