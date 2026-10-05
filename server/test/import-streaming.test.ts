import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { openUploads, uploadTempDir, type ArchiveEntries } from '../src/core/archive-entries.ts';
import { fileDump, stringDump } from '../src/modules/transfer/wiki/mediawiki.ts';
import { WIKI_ARCHIVES, WikiImporter, parseWikiEntries } from '../src/modules/transfer/wiki/importer.ts';
import { Client, createTestApp } from './helpers.ts';

/**
 * Importe in Stücken: Der Upload liegt als Zwischendatei auf der Platte, Einträge werden einzeln gelesen,
 * der MediaWiki-Dump Seite für Seite, Mediendateien erst beim Anhängen – und danach ist alles wieder weg.
 */
const zip = (files: Record<string, string | Uint8Array | [Uint8Array, { level: 0 }]>): Buffer =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]))));

function multipart(fields: Record<string, string>, files: { name: string; data: Buffer }[]): { body: Buffer; type: string } {
  const boundary = '----knowstead-stuecke';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const file of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

const page = (title: string, body: string, revisions = 1) =>
  `<page><title>${title}</title><ns>0</ns>${Array.from({ length: revisions }, (_, i) => `<revision><timestamp>2022-01-${String(i + 1).padStart(2, '0')}T08:00:00Z</timestamp><text xml:space="preserve">${i === revisions - 1 ? body : `alt ${i} ${'x'.repeat(2000)}`}</text></revision>`).join('')}</page>`;
const dump = (pages: string[]) =>
  `<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" version="0.11" xml:lang="de">\n<siteinfo><namespaces><namespace key="6" case="first-letter">Datei</namespace></namespaces></siteinfo>\n${pages.join('\n')}\n</mediawiki>`;

test('MediaWiki-Dump von der Platte: Seite für Seite, gleich dem Lesen am Stück', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-dump-'));
  try {
    // Über 3 MB mit Umlauten: Seiten und Mehrbyte-Zeichen liegen auf den Grenzen der gelesenen Stücke (1 MB)
    const pages = Array.from({ length: 900 }, (_, i) => page(`Seite ${i}`, `Inhalt ${i} – äöüß ${'Text mit Umlauten ä '.repeat(180)}`));
    const xml = dump(pages);
    assert.ok(Buffer.byteLength(xml) > 3 * 1024 * 1024);
    const file = path.join(dir, 'dump.xml');
    fs.writeFileSync(file, xml);

    const whole = stringDump(xml);
    const pieces = fileDump(file);
    assert.equal(pieces.header, whole.header);
    assert.match(pieces.header, /<namespace key="6"/);
    const expected = [...whole.pages()];
    const actual = [...pieces.pages()];
    assert.equal(actual.length, 900);
    assert.deepEqual(actual, expected);

    // Übergroße Seite: wird mit ihrem Titel gemeldet und übersprungen, die folgenden kommen an
    const mixed = path.join(dir, 'gemischt.xml');
    fs.writeFileSync(mixed, dump([page('Klein', 'kurz'), page('Riesig', 'y'.repeat(50_000), 30), page('Danach', 'auch da')]));
    const result = [...fileDump(mixed, 40_000).pages()];
    assert.deepEqual(
      result.map((p) => ('tooLarge' in p ? `zu groß: ${p.tooLarge}` : (p.inner.match(/<title>(.*?)<\/title>/)?.[1] ?? '?'))),
      ['Klein', 'zu groß: Riesig', 'Danach'],
    );
    // Leere und seitenlose Dateien
    fs.writeFileSync(mixed, '<mediawiki><siteinfo></siteinfo></mediawiki>');
    assert.deepEqual([...fileDump(mixed).pages()], []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** Zählt, welche Einträge wann gelesen werden. */
function counting(entries: ArchiveEntries): { entries: ArchiveEntries; reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    entries: {
      names: () => entries.names(),
      has: (name) => entries.has(name),
      size: (name) => entries.size(name),
      head: (name, bytes) => entries.head(name, bytes),
      read: (name, maxBytes) => {
        reads.push(name);
        return entries.read(name, maxBytes);
      },
      materialize: (name, dir) => entries.materialize(name, dir),
      close: () => entries.close(),
    },
  };
}

test('Wiki-Import in Stücken: Mediendateien einzeln, Zwischendateien danach weg', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tmp = uploadTempDir(ctx.dir);
  const leftovers = () => (fs.existsSync(tmp) ? fs.readdirSync(tmp) : []);
  const wikiImport = async (file: { name: string; data: Buffer }, fields: Record<string, string> = {}) => {
    const form = multipart(fields, [file]);
    const started = await admin.request('POST', '/api/v1/spaces/WIKI/import/wiki', form.body, { 'content-type': form.type });
    assert.equal(started.status, 202, started.raw);
    await ctx.s.imports.idle();
    return (await admin.get(`/api/v1/imports/${started.body.id}`)).body as {
      state: string;
      error: string | null;
      report: { pages: number; attachments: number; revisions: number; warnings: string[]; skipped: { title: string; reason: string }[] } | null;
    };
  };

  try {
    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'WIKI', name: 'Wiki' })).status, 200);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'ROH', name: 'Roh' })).status, 200);
    });

    await t.test('Mediendateien werden beim Umwandeln nicht gelesen – erst beim Anhängen, eine nach der anderen', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-stuecke-'));
      try {
        const media = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`data/media/bild${i}.png`, [crypto.randomBytes(40_000), { level: 0 }] as [Uint8Array, { level: 0 }]]));
        const archive = path.join(dir, '0');
        fs.writeFileSync(
          archive,
          zip({
            'data/pages/start.txt': `====== Start ======\n${Array.from({ length: 12 }, (_, i) => `{{:bild${i}.png}}`).join('\n')}`,
            'data/pages/zweite.txt': '====== Zweite ======\nText',
            ...media,
          }),
        );
        const source = counting(openUploads([{ name: 'wiki.zip', path: archive, size: fs.statSync(archive).size }], { archives: WIKI_ARCHIVES }));
        try {
          const options = { format: 'auto' as const, parentId: null, history: false };
          const parsed = await parseWikiEntries(source.entries, options, dir);
          assert.equal(parsed.format, 'dokuwiki');
          assert.equal(parsed.media.size, 12);
          assert.deepEqual(source.reads.filter((n) => n.includes('/media/')), [], 'beim Umwandeln bleibt jede Mediendatei auf der Platte');
          assert.deepEqual(source.reads.sort(), ['data/pages/start.txt', 'data/pages/zweite.txt'], 'jede Seite genau einmal');

          // Beim Anhängen: Zu jedem Zeitpunkt ist höchstens eine Mediendatei gelesen, aber noch nicht gespeichert
          const s = ctx.s;
          const auth = s.perms.forUser(s.users.byUsername('admin')!);
          const space = s.spaces.requireViewable(auth, 'ROH');
          const store = s.attachments.storeBuffer.bind(s.attachments);
          let stored = 0;
          let worst = 0;
          s.attachments.storeBuffer = (...args) => {
            worst = Math.max(worst, source.reads.filter((n) => n.includes('/media/')).length - stored);
            stored++;
            return store(...args);
          };
          try {
            const report = await new WikiImporter(s, auth, space).run(parsed, options);
            assert.equal(report.attachments, 12);
            assert.equal(report.pages, 2);
          } finally {
            s.attachments.storeBuffer = store;
          }
          assert.equal(stored, 12);
          assert.equal(worst, 1, 'nie mehr als eine Mediendatei gleichzeitig im Speicher');
        } finally {
          source.entries.close();
        }
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    await t.test('Über die Schnittstelle: DokuWiki-Archiv, danach liegt keine Zwischendatei mehr im Datenverzeichnis', async () => {
      const png = crypto.randomBytes(5000);
      const job = await wikiImport({
        name: 'wiki.zip',
        data: zip({ 'data/pages/handbuch.txt': '====== Handbuch ======\n{{:plan.png}}', 'data/media/plan.png': png }),
      });
      assert.equal(job.state, 'done', job.error ?? '');
      assert.deepEqual([job.report!.pages, job.report!.attachments], [1, 1]);
      assert.deepEqual(leftovers(), []);
      // Der Anhang kam unversehrt an
      const row = ctx.s.db.get<{ storage_key: string; size: number }>("SELECT storage_key, size FROM attachments WHERE filename = 'plan.png' ORDER BY id DESC LIMIT 1")!;
      assert.equal(row.size, 5000);
      assert.ok(fs.readFileSync(path.join(ctx.s.config.uploadsDir, row.storage_key)).equals(png));
    });

    await t.test('MediaWiki-Dump: direkt hochgeladen und aus einem Archiv – Versionen nur, wenn gewünscht', async () => {
      const xml = dump([page('Anleitung', 'Aktueller Stand [[Datei:Foto.jpg]]', 6), page('Kurz', 'nur eine Fassung')]);
      const direct = await wikiImport({ name: 'dump.xml', data: Buffer.from(xml) });
      assert.equal(direct.state, 'done', direct.error ?? '');
      assert.deepEqual([direct.report!.pages, direct.report!.revisions], [2, 0], 'ohne Versionsgeschichte bleibt nur der aktuelle Stand im Speicher');

      const packed = await wikiImport({ name: 'wiki.zip', data: zip({ 'export/dump.xml': xml, 'images/Foto.jpg': crypto.randomBytes(3000) }) }, { history: 'true' });
      assert.equal(packed.state, 'done', packed.error ?? '');
      assert.deepEqual([packed.report!.pages, packed.report!.revisions, packed.report!.attachments], [2, 5, 1], 'Dump aus dem Archiv entpackt und seitenweise gelesen');
      assert.deepEqual(leftovers(), [], 'auch der entpackte Dump ist wieder weg');
    });

    await t.test('Beschädigte Mediendatei: Der Import läuft durch und nennt sie', async () => {
      const good = crypto.randomBytes(2000);
      const archive = zip({ 'data/pages/seite.txt': '====== Seite ======\n{{:kaputt.bin}} {{:heil.bin}}', 'data/media/kaputt.bin': [crypto.randomBytes(2000), { level: 0 }], 'data/media/heil.bin': [good, { level: 0 }] });
      // Ein Byte im Inhalt von kaputt.bin verfälschen: hinter dem lokalen Kopf des Eintrags
      const at = archive.indexOf(Buffer.from('data/media/kaputt.bin')) + 'data/media/kaputt.bin'.length + 100;
      archive[at] ^= 0xff;
      const job = await wikiImport({ name: 'wiki.zip', data: archive });
      assert.equal(job.state, 'done', job.error ?? '');
      assert.deepEqual([job.report!.pages, job.report!.attachments], [1, 1]);
      assert.ok(job.report!.warnings.some((w) => /kaputt\.bin.*lässt sich nicht entpacken/.test(w)), job.report!.warnings.join(' | '));
      assert.deepEqual(leftovers(), []);
    });

    await t.test('Abgewiesene und gescheiterte Importe räumen ebenfalls auf', async () => {
      const bad = multipart({ format: 'gibtesnicht' }, [{ name: 'wiki.zip', data: zip({ 'a.txt': 'x' }) }]);
      assert.equal((await admin.request('POST', '/api/v1/spaces/WIKI/import/wiki', bad.body, { 'content-type': bad.type })).status, 400);
      assert.deepEqual(leftovers(), [], 'abgewiesen, bevor der Auftrag angelegt war');

      const noWiki = await wikiImport({ name: 'irgendwas.zip', data: zip({ 'readme.txt': 'kein Wiki' }) });
      assert.equal(noWiki.state, 'failed');
      assert.match(noWiki.error ?? '', /Format wurde nicht erkannt/);
      const noZip = await wikiImport({ name: 'kaputt.zip', data: Buffer.from('das ist kein Archiv, nur Text in passender Länge') });
      assert.equal(noZip.state, 'failed');
      assert.match(noZip.error ?? '', /kaputt\.zip ist kein gültiges ZIP-Archiv/);
      assert.deepEqual(leftovers(), []);
    });

    await t.test('Datei-Import (Markdown, ZIP) und Knowstead-Archiv: von der Platte, ohne Rückstände', async () => {
      const image = crypto.randomBytes(1500);
      const form = multipart({}, [
        { name: 'notiz.md', data: Buffer.from('# Notiz\n\nEinzeln hochgeladen') },
        { name: 'paket.zip', data: zip({ 'ordner/eins.md': '# Eins\n\n![Bild](bild.png)', 'ordner/bild.png': image, 'ordner/zwei.md': '# Zwei\n\nText' }) },
      ]);
      const res = await admin.request('POST', '/api/v1/spaces/ROH/import', form.body, { 'content-type': form.type });
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual((res.body.pages as { title: string }[]).map((p) => p.title).sort(), ['Eins', 'Notiz', 'Zwei', 'ordner']);
      assert.deepEqual(leftovers(), []);
      const stored = ctx.s.db.get<{ storage_key: string }>("SELECT storage_key FROM attachments WHERE filename = 'bild.png' ORDER BY id DESC LIMIT 1")!;
      assert.ok(fs.readFileSync(path.join(ctx.s.config.uploadsDir, stored.storage_key)).equals(image), 'relatives Bild als Anhang übernommen');

      // Bereich als Knowstead-Archiv exportieren und als neuen Bereich wieder einspielen
      const exported = await admin.request('GET', '/api/v1/spaces/ROH/export?format=json');
      assert.equal(exported.status, 200);
      const again = multipart({ key: 'KOPIE', name: 'Kopie' }, [{ name: 'roh.zip', data: exported.bytes }]);
      const copy = await admin.request('POST', '/api/v1/spaces/import-archive', again.body, { 'content-type': again.type });
      assert.equal(copy.status, 200, copy.raw);
      assert.equal(copy.body.space.key, 'KOPIE');
      assert.ok(copy.body.pages >= 4);
      assert.equal(ctx.s.db.value<number>("SELECT COUNT(*) FROM attachments a JOIN pages p ON p.id = a.page_id JOIN spaces s ON s.id = p.space_id WHERE s.key = 'KOPIE' AND a.filename = 'bild.png'"), 1);
      assert.deepEqual(leftovers(), []);

      const notArchive = multipart({ key: 'NEU' }, [{ name: 'x.zip', data: Buffer.from('kein Archiv, aber lang genug für die Prüfung der Signatur') }]);
      const rejected = await admin.request('POST', '/api/v1/spaces/import-archive', notArchive.body, { 'content-type': notArchive.type });
      assert.equal(rejected.status, 400);
      assert.match(rejected.body.error.message, /kein gültiges ZIP-Archiv/);
      assert.deepEqual(leftovers(), []);
    });
  } finally {
    await ctx.close();
  }
});

test('Start des Servers räumt liegen gebliebene Zwischendateien weg', async () => {
  const first = await createTestApp();
  const dir = first.dir;
  await first.close({ keepDir: true });
  try {
    const stale = path.join(uploadTempDir(dir), 'import-abgebrochen');
    fs.mkdirSync(stale, { recursive: true });
    fs.writeFileSync(path.join(stale, '0'), 'Rest eines Uploads, bei dem der Server abstürzte');
    const second = await createTestApp({ dir });
    try {
      assert.equal(fs.existsSync(stale), false);
    } finally {
      await second.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
