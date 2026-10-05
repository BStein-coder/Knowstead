import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { Client, createTestApp } from './helpers.ts';
import { safeEntryName } from '../src/core/zip.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const zip = (files: Record<string, Uint8Array | string>) =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]))));

function multipart(files: { name: string; data: Buffer }[], fields: Record<string, string> = {}): { body: Buffer; type: string } {
  const boundary = '----knowstead-import';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  for (const file of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.data, Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

test('Eintragsnamen aus Archiven bleiben im Ziel', () => {
  assert.equal(safeEntryName('../../../etc/passwd.md'), 'etc/passwd.md');
  assert.equal(safeEntryName('/abs.md'), 'abs.md');
  assert.equal(safeEntryName('C:\\Windows\\x.md'), 'Windows/x.md');
  assert.equal(safeEntryName('ordner/..\\..\\win.md'), 'ordner/win.md');
  assert.equal(safeEntryName('./a/./b.md'), 'a/b.md');
  assert.equal(safeEntryName('/'), '');
});

test('Import: manipulierte Pfade, übergroße Dateien und Rundlauf Export → Import', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const upload = (space: string, files: { name: string; data: Buffer }[], url = `/api/v1/spaces/${space}/import`, fields: Record<string, string> = {}) => {
    const form = multipart(files, fields);
    return admin.request('POST', url, form.body, { 'content-type': form.type });
  };
  const tree = async (space: string) => (await admin.get(`/api/v1/spaces/${space}/tree`)).body as { id: number; parentId: number | null; title: string }[];

  try {
    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
      for (const key of ['IMP', 'SRC', 'ZIEL']) assert.equal((await admin.post('/api/v1/spaces', { key, name: key })).status, 200);
    });

    await t.test('Pfade mit .., absolut und Laufwerk erzeugen weder Fehler noch „..“-Seiten', async () => {
      const res = await upload('IMP', [
        {
          name: 'slip.zip',
          data: zip({ '../../../ausbruch.md': '# Ausbruch', '/absolut.md': '# Absolut', 'C:\\laufwerk.md': '# Laufwerk', 'ordner/..\\..\\win.md': '# Windows', '/': 'x' }),
        },
      ]);
      assert.equal(res.status, 200, res.raw);
      const titles = (await tree('IMP')).map((p) => p.title).sort();
      // Titel aus den bereinigten Dateinamen (ohne Zeilenumbruch gilt die Überschrift nicht als Titel)
      assert.deepEqual(titles, ['absolut', 'ausbruch', 'laufwerk', 'ordner', 'win']);
    });

    await t.test('Textdateien über 5 MB werden abgelehnt, bevor sie entpackt werden', async () => {
      const big = Buffer.alloc(6 * 1024 * 1024, 'A');
      const zipped = await upload('IMP', [{ name: 'bombe.zip', data: zip({ 'gross.md': big, 'klein.md': '# Klein' }) }]);
      assert.equal(zipped.status, 400, zipped.raw);
      assert.match(zipped.body.error.message, /gross\.md ist zu groß für eine Seite \(höchstens 5 MB\)/);
      const direct = await upload('IMP', [{ name: 'direkt.md', data: big }]);
      assert.equal(direct.status, 400, direct.raw);
      const en = await admin.request('POST', '/api/v1/spaces/IMP/import', multipart([{ name: 'direkt.md', data: big }]).body, {
        'content-type': multipart([{ name: 'direkt.md', data: big }]).type,
        'x-knowstead-locale': 'en',
      });
      assert.equal(en.body.error.message, 'direkt.md is too large for a page (at most 5 MB)');
      // große Anhänge im Archiv bleiben erlaubt
      const withImage = await upload('IMP', [{ name: 'bild.zip', data: zip({ 'mit-bild.md': '# Mit Bild\n\n![Bild](bilder/gross.png)', 'bilder/gross.png': Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]) }) }]);
      assert.equal(withImage.status, 200, withImage.raw);
    });

    await t.test('Markdown-Export lässt sich ohne Anhangsseiten wieder importieren', async () => {
      const page = await admin.post('/api/v1/pages', { spaceKey: 'SRC', title: 'Handbuch', content: '<p>Text</p>' });
      const form = multipart([{ name: 'liste.txt', data: Buffer.from('Anhang') }]);
      const att = await admin.request('POST', `/api/v1/pages/${page.body.id}/attachments`, form.body, { 'content-type': form.type });
      assert.equal(att.status, 200, att.raw);
      await admin.put(`/api/v1/pages/${page.body.id}`, { title: 'Handbuch', content: `<p>Siehe <a href="/api/v1/attachments/${att.body[0].id}/raw">Liste</a></p>`, baseVersion: 1 });
      const exported = await ctx.app.inject({ method: 'GET', url: '/api/v1/spaces/SRC/export?format=markdown', headers: { cookie: (admin as unknown as { cookie: string }).cookie, 'x-knowstead-client': 'test' } });
      assert.equal(exported.statusCode, 200);
      const res = await upload('ZIEL', [{ name: 'src.zip', data: exported.rawPayload }]);
      assert.equal(res.status, 200, res.raw);
      const titles = (await tree('ZIEL')).map((p) => p.title);
      assert.ok(titles.includes('Handbuch'), titles.join(','));
      assert.ok(!titles.some((title) => /_anhaenge|liste/i.test(title)), `keine Seiten aus dem Anhangsordner: ${titles.join(',')}`);
      const imported = (await tree('ZIEL')).find((p) => p.title === 'Handbuch')!;
      const attachments = (await admin.get(`/api/v1/pages/${imported.id}/attachments`)).body;
      assert.ok(JSON.stringify(attachments).includes('liste.txt'), 'verlinkter Anhang übernommen');
    });

    await t.test('Archiv als neuer Bereich übernimmt die Startseite des Archivs', async () => {
      const src = (await admin.get('/api/v1/spaces/SRC')).body;
      await admin.put(`/api/v1/pages/${src.homePageId}`, { title: 'Übersicht', content: '<p>Eigene Startseite aus dem Archiv</p>', baseVersion: 1 });
      const exported = await ctx.app.inject({ method: 'GET', url: '/api/v1/spaces/SRC/export?format=json', headers: { cookie: (admin as unknown as { cookie: string }).cookie, 'x-knowstead-client': 'test' } });
      const res = await upload('', [{ name: 'archiv.zip', data: exported.rawPayload }], '/api/v1/spaces/import-archive', { key: 'NEU', name: 'Neu' });
      assert.equal(res.status, 200, res.raw);
      const space = (await admin.get('/api/v1/spaces/NEU')).body;
      assert.equal(space.homePageId, res.body.space.homePageId);
      const home = (await admin.get(`/api/v1/pages/${space.homePageId}`)).body;
      assert.match(home.content, /Eigene Startseite aus dem Archiv/);
      const count = ctx.s.db.value<number>("SELECT COUNT(*) FROM pages WHERE space_id = ? AND title = 'Übersicht'", space.id);
      assert.equal(count, 1, 'nur eine Startseite');
      assert.ok((await tree('NEU')).some((p) => p.title === 'Handbuch'));
    });
  } finally {
    await ctx.close();
  }
});
