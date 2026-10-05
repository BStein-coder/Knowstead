import { test } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { strFromU8, unzipSync } from 'fflate';
import { Client, createTestApp } from './helpers.ts';

/** Einfarbiges PNG erzeugen (Logo und Inhaltsbild sollen sich unterscheiden). */
function solidPng(width: number, height: number, [r, g, b]: number[]): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: width }, () => [r, g, b]).flat())]);
  const pixels = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
const LOGO = solidPng(120, 40, [15, 118, 110]);
const WHITEBOARD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="120" viewBox="0 0 320 120"><style>@font-face{font-family:Excalifont;src:url(data:font/woff2;base64,AAAA)}</style>' +
  '<rect x="10" y="10" width="120" height="60" fill="none" stroke="#1e1e1e"/><text x="20" y="100" font-family="Excalifont, Xiaolai" font-size="16">Skizzentext → Ziel 🎉</text></svg>';

function multipart(name: string, data: Buffer, type: string): { body: Buffer; type: string } {
  const boundary = '----knowstead-export';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
    data,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, type: `multipart/form-data; boundary=${boundary}` };
}

async function pdfText(data: Buffer): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(data), verbosity: 0 });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' ').replace(/\s+/g, ' '));
  }
  await task.destroy();
  return pages;
}

function docxParts(data: Buffer): Record<string, string> {
  const files = unzipSync(new Uint8Array(data));
  return Object.fromEntries(Object.entries(files).map(([name, content]) => [name, name.endsWith('.xml') || name.endsWith('.rels') ? strFromU8(content) : `[${content.length} Bytes]`]));
}

/** Antwort mit Binärinhalt */
async function download(client: Client, url: string, method: 'GET' | 'POST' = 'GET', body?: unknown) {
  const res = await client.request(method, url, body);
  return { status: res.status, body: res.bytes, headers: res.headers, raw: res.status === 200 ? '' : res.raw };
}

test('Export nach PDF und Word mit Firmenvorlage', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);
  let rootId = 0;

  try {
    await t.test('Einrichtung: Seitenbaum mit Bild, Tabelle und geschützter Unterseite', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
      await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim' });
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'OPS', name: 'Betrieb', preset: 'open' })).status, 200);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'HR', name: 'Personal', preset: 'private' })).status, 200);

      // Bild auf einer Seite, die Tom nicht sehen darf
      const hrPage = await admin.post('/api/v1/pages', { spaceKey: 'HR', title: 'Organigramm', content: '<p>intern</p>' });
      const file = multipart('organigramm.png', solidPng(40, 30, [200, 30, 30]), 'image/png');
      const upload = await admin.request('POST', `/api/v1/pages/${hrPage.body.id}/attachments`, file.body, { 'content-type': file.type });
      assert.equal(upload.status, 200, upload.raw);
      const imageId = upload.body[0].id;

      const root = await admin.post('/api/v1/pages', {
        spaceKey: 'OPS',
        title: 'Betriebshandbuch',
        content: `<h2>Zweck</h2><p>Dieses Handbuch beschreibt den <strong>Regelbetrieb</strong>.</p>
          <p><img src="/api/v1/attachments/${imageId}/raw" alt="Organigramm"></p>
          <table><tbody><tr><th><p>System</p></th><th><p>Betreuung</p></th></tr><tr><td><p>Mailserver</p></td><td><p>Team Infrastruktur</p></td></tr></tbody></table>
          <div data-type="callout" data-variant="warning"><p>Wartungsfenster beachten</p></div>
          <p>Pfad: Administration → Export-Vorlage ✓ 🙂</p>
          <div data-type="whiteboard" data-title="Skizze" data-scene="{}" data-svg="data:image/svg+xml;base64,${Buffer.from(WHITEBOARD_SVG).toString('base64')}"></div>`,
      });
      assert.equal(root.status, 200, root.raw);
      rootId = root.body.id;
      const child = await admin.post('/api/v1/pages', { spaceKey: 'OPS', parentId: rootId, title: 'Störungsmanagement', content: '<h2>Eskalation</h2><p>Erst Leitstelle anrufen.</p>' });
      assert.equal(child.status, 200, child.raw);
      const secret = await admin.post('/api/v1/pages', { spaceKey: 'OPS', parentId: rootId, title: 'Notfallzugänge', content: '<p>Tresorcode im Safe</p>' });
      const me = await admin.get('/api/v1/auth/me');
      const restricted = await admin.put(`/api/v1/pages/${secret.body.id}/restrictions`, { view: [{ type: 'user', id: me.body.user.id }], edit: [] });
      assert.equal(restricted.status, 200, restricted.raw);
    });

    await t.test('Firmenvorlage pflegen und prüfen', async () => {
      const saved = await admin.put('/api/v1/admin/settings', {
        exportTemplate: {
          company: 'Muster GmbH',
          primaryColor: '#0f766e',
          classification: 'Intern',
          headerText: '{company} · {title}',
          footerText: '{space} · {version}',
          logo: `data:image/jpeg;base64,${LOGO.toString('base64')}`,
        },
      });
      assert.equal(saved.status, 200, saved.raw);
      assert.equal(saved.body.exportTemplate.company, 'Muster GmbH');
      assert.match(saved.body.exportTemplate.logo, /^data:image\/png;base64,/, 'Bildtyp wird am Inhalt erkannt');
      assert.equal(saved.body.exportTemplate.toc, true, 'nicht gesendete Felder bleiben erhalten');

      assert.equal((await admin.put('/api/v1/admin/settings', { exportTemplate: { primaryColor: 'rot' } })).status, 400);
      const badLogo = await admin.put('/api/v1/admin/settings', { exportTemplate: { logo: `data:image/png;base64,${Buffer.from('<html>kein Bild</html>').toString('base64')}` } });
      assert.equal(badLogo.status, 400, badLogo.raw);
      assert.equal((await admin.put('/api/v1/admin/settings', { exportTemplate: { headerText: 'x'.repeat(300) } })).status, 400);
      assert.equal((await tom.put('/api/v1/admin/settings', { exportTemplate: { company: 'Tom AG' } })).status, 403);

      const defaults = await tom.get('/api/v1/export/template');
      assert.deepEqual(defaults.body, { company: 'Muster GmbH', coverPage: true, toc: true, hasLogo: true });
    });

    await t.test('PDF mit Deckblatt, Inhaltsverzeichnis, Kopf- und Fußzeile', async () => {
      const res = await download(admin, `/api/v1/pages/${rootId}/export/document?format=pdf&children=true`);
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.headers['content-type'], 'application/pdf');
      assert.match(String(res.headers['content-disposition']), /Betriebshandbuch\.pdf/);
      const pages = await pdfText(res.body);
      assert.ok(pages.length >= 3, `Seiten: ${pages.length}`);
      assert.match(pages[0], /Muster GmbH/);
      assert.match(pages[0], /Betriebshandbuch/);
      assert.match(pages[0], /Klassifizierung Intern/);
      assert.doesNotMatch(pages[0], /Seite 1 von/, 'Deckblatt ohne Fußzeile');
      assert.match(pages[1], /Inhaltsverzeichnis/);
      assert.match(pages[1], /Störungsmanagement/);
      const all = pages.join(' ');
      assert.match(all, /Muster GmbH · Betriebshandbuch/, 'Kopfzeile mit Platzhaltern');
      assert.match(all, new RegExp(`Betrieb · Version 1 Seite 2 von ${pages.length}`), 'Fußzeile mit Seitenzahl');
      assert.match(all, /Mailserver/);
      assert.match(all, /Wartungsfenster beachten/);
      assert.match(all, /Administration → Export-Vorlage √/, 'Pfeil aus Ersatzschrift, Häkchen ersetzt');
      assert.doesNotMatch(all, /\u{1F642}|\u{1F389}/u, 'Emoji entfernt');
      assert.match(all, /Skizzentext → Ziel/, 'Whiteboard-Text im PDF');
      assert.match(all, /Tresorcode/, 'Ada sieht die geschützte Unterseite');

      const tomPdf = await download(tom, `/api/v1/pages/${rootId}/export/document?format=pdf&children=true&cover=false&toc=false`);
      assert.equal(tomPdf.status, 200, tomPdf.raw);
      const tomText = (await pdfText(tomPdf.body)).join(' ');
      assert.doesNotMatch(tomText, /Tresorcode|Notfallzugänge/, 'geschützte Unterseite fehlt bei Tom');
      assert.doesNotMatch(tomText, /Inhaltsverzeichnis/, 'Inhaltsverzeichnis abgewählt');
      assert.match(tomText, /Bild: Organigramm/, 'Bild ohne Leserecht wird nur erwähnt');
    });

    await t.test('Word-Dokument mit Feldern, Kopfzeile und Bildern', async () => {
      const res = await download(admin, `/api/v1/pages/${rootId}/export/document?format=docx&children=true`);
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.headers['content-type'], 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      const parts = docxParts(res.body);
      const body = parts['word/document.xml'];
      assert.match(body, /TOC \\h \\o &quot;1-3&quot;/, 'Inhaltsverzeichnis-Feld');
      assert.match(body, /<w:titlePg\/>/, 'eigene erste Seite (Deckblatt)');
      assert.match(body, /Störungsmanagement/);
      assert.match(body, /Tresorcode/);
      const headers = Object.entries(parts).filter(([name]) => /word\/header\d\.xml/.test(name)).map(([, xml]) => xml).join('');
      assert.match(headers, /Muster GmbH · Betriebshandbuch/);
      const footers = Object.entries(parts).filter(([name]) => /word\/footer\d\.xml/.test(name)).map(([, xml]) => xml).join('');
      assert.match(footers, /PAGE/);
      assert.match(footers, /NUMPAGES/);
      assert.match(parts['word/settings.xml'], /updateFields/);
      const media = Object.keys(parts).filter((name) => name.startsWith('word/media/') && !name.endsWith('/'));
      assert.equal(media.filter((name) => name.endsWith('.svg')).length, 1, `Whiteboard als SVG: ${media.join(', ')}`);

      const tomDocx = docxParts((await download(tom, `/api/v1/pages/${rootId}/export/document?format=docx&children=true`)).body);
      assert.doesNotMatch(tomDocx['word/document.xml'], /Tresorcode/);
      const tomMedia = Object.keys(tomDocx).filter((name) => name.startsWith('word/media/') && !name.endsWith('/'));
      assert.equal(tomMedia.length, media.length - 1, 'Organigramm fehlt bei Tom');
    });

    await t.test('Englische Exporte: Hinweiskästen und unveränderte Standard-Fußzeile übersetzt', async () => {
      assert.equal((await admin.put('/api/v1/admin/settings', { exportTemplate: { footerText: '{space} · Stand {date} · {version}' } })).status, 200);
      const url = `/api/v1/pages/${rootId}/export/document?format=pdf&children=true`;
      const german = (await pdfText((await admin.request('GET', url)).bytes)).join(' ');
      assert.match(german, /Achtung Wartungsfenster beachten/);
      assert.match(german, /Betrieb · Stand \d{2}\.\d{2}\.\d{4} · Version 1/);
      const english = (await pdfText((await admin.request('GET', url, undefined, { 'x-knowstead-locale': 'en' })).bytes)).join(' ');
      assert.match(english, /Warning Wartungsfenster beachten/);
      assert.match(english, /Betrieb · Date \d{2}\/\d{2}\/\d{4} · Version 1 Page 2 of/);
      assert.doesNotMatch(english, /\b(Achtung|Stand|Seite \d+ von|Inhaltsverzeichnis)\b/);

      const docx = docxParts((await admin.request('GET', url.replace('format=pdf', 'format=docx'), undefined, { 'x-knowstead-locale': 'en' })).bytes);
      assert.match(docx['word/document.xml'], />Warning</);
      const footers = Object.entries(docx).filter(([name]) => /word\/footer\d\.xml/.test(name)).map(([, xml]) => xml).join('');
      assert.match(footers, /Betrieb · Date \d{2}\/\d{2}\/\d{4} · Version 1/);

      // Dieselbe Vorgabe, auf Englisch gespeichert (so steht sie in der englischen Administration im Feld):
      // Der Export richtet sich weiter nach der Sprache des Dokuments
      assert.equal((await admin.put('/api/v1/admin/settings', { exportTemplate: { footerText: '{space} · Date {date} · {version}' } })).status, 200);
      assert.match((await pdfText((await admin.request('GET', url)).bytes)).join(' '), /Betrieb · Stand \d{2}\.\d{2}\.\d{4} · Version 1/);
      assert.match((await pdfText((await admin.request('GET', url, undefined, { 'x-knowstead-locale': 'en' })).bytes)).join(' '), /Betrieb · Date \d{2}\/\d{2}\/\d{4} · Version 1/);

      // Eigene Texte der Firmenvorlage bleiben unverändert
      assert.equal((await admin.put('/api/v1/admin/settings', { exportTemplate: { footerText: '{space} · Stand {date}' } })).status, 200);
      const custom = (await pdfText((await admin.request('GET', url, undefined, { 'x-knowstead-locale': 'en' })).bytes)).join(' ');
      assert.match(custom, /Betrieb · Stand \d{2}\/\d{2}\/\d{4}/);
      await admin.put('/api/v1/admin/settings', { exportTemplate: { footerText: '{space} · {version}' } });
    });

    await t.test('Musterdokument nur für Administratoren', async () => {
      const sample = await download(admin, '/api/v1/admin/export-template/sample', 'POST', { format: 'docx', template: { company: 'Probe AG', coverPage: false } });
      assert.equal(sample.status, 200, sample.raw);
      const parts = docxParts(sample.body);
      assert.doesNotMatch(parts['word/document.xml'], /<w:titlePg\/>/, 'ohne Deckblatt');
      assert.match(Object.entries(parts).filter(([n]) => n.includes('header')).map(([, x]) => x).join(''), /Probe AG/);
      assert.equal((await admin.get('/api/v1/export/template')).body.company, 'Muster GmbH', 'Muster speichert nichts');

      // Das Muster folgt der Sprache der Person: Text und Dateiname
      assert.match(parts['word/document.xml'], /Musterdokument/);
      assert.match(decodeURIComponent(String(sample.headers['content-disposition'])), /Musterdokument\.docx/);
      const english = await admin.request('POST', '/api/v1/admin/export-template/sample', { format: 'docx', template: { company: 'Probe AG' } }, { 'x-knowstead-locale': 'en' });
      assert.equal(english.status, 200);
      const englishText = docxParts(english.bytes)['word/document.xml'];
      assert.match(englishText, /Sample document/);
      assert.match(englishText, /Child pages follow as chapters of their own\./);
      assert.doesNotMatch(englishText, /Musterdokument|Unterseite|Aufzählungspunkt|Verantwortlich/);
      assert.match(decodeURIComponent(String(english.headers['content-disposition'])), /Sample document\.docx/);
      assert.equal((await tom.post('/api/v1/admin/export-template/sample', { format: 'pdf' })).status, 403);
      assert.equal((await admin.post('/api/v1/admin/export-template/sample', { format: 'pdf', template: { primaryColor: 'blau' } })).status, 400);

      const events = await admin.get('/api/v1/admin/events?type=page.exported');
      if (events.status === 200) assert.ok(JSON.stringify(events.body).includes('page.exported'));
    });
  } finally {
    await ctx.close();
  }
});
