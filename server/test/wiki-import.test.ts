import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { Client, createTestApp } from './helpers.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const zip = (files: Record<string, Uint8Array | string>) =>
  Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]))));

function multipart(fields: Record<string, string>, file: { name: string; data: Buffer }): { body: Buffer; type: string } {
  const boundary = '----knowstead-wiki';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

const MEDIAWIKI = `<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.11/" version="0.11" xml:lang="de">
<siteinfo><namespaces><namespace key="6" case="first-letter">Datei</namespace><namespace key="14" case="first-letter">Kategorie</namespace></namespaces></siteinfo>
<page><title>Handbuch</title><ns>0</ns>
<revision><timestamp>2021-03-01T08:00:00Z</timestamp><contributor><username>altuser</username></contributor><comment>Erste Fassung</comment><text xml:space="preserve">Entwurf</text></revision>
<revision><timestamp>2022-05-01T08:00:00Z</timestamp><contributor><username>admin</username></contributor><comment>Überarbeitet</comment><text xml:space="preserve">${xml(`{{Achtung|Nur für '''Administratoren'''.}}
Siehe [[Server/Liste|Serverliste]], [[Netz]] und [[Fehlt noch]].
[[Datei:Logo.png|mini|Firmenlogo]]
[[Media:Vertrag.pdf|Vertrag]]
== Ablauf ==
# Prüfen
# Freigeben
[[Kategorie:Betrieb]]`)}</text></revision></page>
<page><title>Server/Liste</title><ns>0</ns><revision><timestamp>2022-01-01T08:00:00Z</timestamp><text xml:space="preserve">Liste der Server</text></revision></page>
<page><title>Netz</title><ns>0</ns><revision><timestamp>2022-01-01T08:00:00Z</timestamp><text xml:space="preserve">#WEITERLEITUNG [[Server/Liste]]</text></revision></page>
<page><title>Vorlage:Achtung</title><ns>10</ns><revision><timestamp>2022-01-01T08:00:00Z</timestamp><text xml:space="preserve">x</text></revision></page>
</mediawiki>`;

test('Import aus MediaWiki, DokuWiki und XWiki', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);

  const startImport = async (client: Client, space: string, file: { name: string; data: Buffer }, fields: Record<string, string> = {}) => {
    const form = multipart(fields, file);
    const res = await client.request('POST', `/api/v1/spaces/${space}/import/wiki`, form.body, { 'content-type': form.type });
    return res;
  };
  const finish = async (client: Client, jobId: string) => {
    await ctx.s.imports.idle();
    const job = await client.get(`/api/v1/imports/${jobId}`);
    assert.equal(job.status, 200, job.raw);
    assert.equal(job.body.state, 'done', job.body.error ?? job.raw);
    return job.body;
  };
  const tree = async (space: string) => (await admin.get(`/api/v1/spaces/${space}/tree`)).body as { id: number; parentId: number | null; title: string }[];
  const page = async (id: number) => (await admin.get(`/api/v1/pages/${id}`)).body;

  try {
    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
      await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim' });
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
      for (const key of ['MW', 'DW', 'XW']) assert.equal((await admin.post('/api/v1/spaces', { key, name: `Import ${key}`, preset: 'private' })).status, 200);
    });

    await t.test('MediaWiki: Hierarchie, Verweise, Dateien, Kategorien, Versionen', async () => {
      const upload = zip({ 'dump.xml': MEDIAWIKI, 'images/a/ab/Logo.png': PNG, 'images/thumb/a/ab/Logo.png/120px-Logo.png': PNG });
      const started = await startImport(admin, 'MW', { name: 'mediawiki.zip', data: upload }, { history: 'true' });
      assert.equal(started.status, 202, started.raw);
      const job = await finish(admin, started.body.id);
      assert.equal(job.format, 'mediawiki');
      assert.equal(job.report.pages, 2);
      assert.equal(job.report.folders, 1, 'Ordnerseite „Server“ für die Unterseite');
      assert.equal(job.report.attachments, 1, 'Vorschaubilder (thumb) werden ignoriert');
      assert.equal(job.report.revisions, 1);
      assert.equal(job.report.unresolvedLinks, 1);
      assert.deepEqual(job.report.missingMedia, ['Vertrag.pdf']);
      assert.ok(job.report.skipped.some((s: { title: string }) => s.title === 'Vorlage:Achtung'));

      const pages = await tree('MW');
      const handbuch = pages.find((p) => p.title === 'Handbuch')!;
      const folder = pages.find((p) => p.title === 'Server')!;
      const liste = pages.find((p) => p.title === 'Liste')!;
      assert.equal(liste.parentId, folder.id, 'A/B wird zur Unterseite');
      const dto = await page(handbuch.id);
      assert.match(dto.content, new RegExp(`href="/s/MW/p/${liste.id}/liste"[^>]*>Serverliste`), 'interner Link aufgelöst');
      assert.equal((dto.content.match(new RegExp(`/s/MW/p/${liste.id}/`, 'g')) ?? []).length, 2, 'Weiterleitung „Netz“ zeigt auf die Liste');
      assert.match(dto.content, /class="knowstead-missing-link"[^>]*>Fehlt noch/);
      assert.match(dto.content, /<img src="\/api\/v1\/attachments\/\d+\/raw" alt="Firmenlogo"/);
      assert.match(dto.content, /data-type="callout" data-variant="warning"/);
      assert.match(dto.content, /<ol>/);
      assert.deepEqual(dto.labels, ['betrieb']);
      assert.equal(dto.version, 2);
      assert.equal(dto.updatedAt, '2022-05-01T08:00:00.000Z', 'Zeitstempel aus dem Wiki');
      const revisions = await admin.get(`/api/v1/pages/${handbuch.id}/revisions`);
      assert.equal(revisions.body.items.length, 2);
      assert.match(JSON.stringify(revisions.body.items), /Erste Fassung \(Autor in MediaWiki: altuser\)/);
      const attachments = await admin.get(`/api/v1/pages/${handbuch.id}/attachments`);
      assert.deepEqual(attachments.body.map((a: { filename: string }) => a.filename), ['Logo.png']);
      const backlinks = await admin.get(`/api/v1/pages/${liste.id}/backlinks`);
      if (backlinks.status === 200) assert.ok(JSON.stringify(backlinks.body).includes('Handbuch'), 'Rückverweise werden erfasst');
    });

    await t.test('DokuWiki: Namensräume, Startseiten, Medien, Kästen, Tabellen', async () => {
      const upload = zip({
        'data/pages/start.txt': '====== Willkommen ======\nZum [[it:start|IT-Bereich]].',
        'data/pages/it/start.txt': `====== IT ======
<note warning>Nicht **löschen**!</note>

^ Dienst ^ Status ^
| Mail | läuft |

{{server:plan.png?200|Plan}}
Siehe [[server:backup]].`,
        'data/pages/it/server/backup.txt': '====== Datensicherung ======\n  * täglich\n  * wöchentlich',
        'data/media/it/server/plan.png': PNG,
        'data/media/it/server/unbenutzt.pdf': strToU8('%PDF'),
        'data/attic/it/server/backup.1600000000.txt.gz': gzipSync(strToU8('====== Datensicherung ======\nalt')),
        'data/meta/it/server/backup.changes': '1600000000\t127.0.0.1\tC\tit:server:backup\tbob\tangelegt\n1700000000\t127.0.0.1\tE\tit:server:backup\tadmin\tergänzt\n',
      });
      const started = await startImport(admin, 'DW', { name: 'dokuwiki.zip', data: upload }, { format: 'dokuwiki', history: 'true' });
      assert.equal(started.status, 202, started.raw);
      const job = await finish(admin, started.body.id);
      assert.equal(job.report.pages, 3);
      assert.equal(job.report.folders, 1, 'Namensraum „server“ ohne Startseite');
      assert.equal(job.report.attachments, 2, 'Mediendateien landen auf der Seite ihres Namensraums');

      const pages = await tree('DW');
      const it = pages.find((p) => p.title === 'IT')!;
      const server = pages.find((p) => p.title === 'Server')!;
      const backup = pages.find((p) => p.title === 'Datensicherung')!;
      assert.equal(server.parentId, it.id, 'Startseite ist die Seite des Namensraums');
      assert.equal(backup.parentId, server.id);
      const itPage = await page(it.id);
      assert.match(itPage.content, /data-variant="error"/);
      assert.match(itPage.content, /<table>/);
      assert.match(itPage.content, new RegExp(`/s/DW/p/${backup.id}/`), 'relativer Link (server:backup im Namensraum it)');
      assert.match(itPage.content, /<img src="\/api\/v1\/attachments\/\d+\/raw" alt="Plan" width="200"/);
      const home = await page(pages.find((p) => p.title === 'Willkommen')!.id);
      assert.match(home.content, new RegExp(`/s/DW/p/${it.id}/`), 'Link auf it:start zeigt auf die Namensraum-Seite');
      assert.doesNotMatch(itPage.content, /<h1>IT<\/h1>/, 'Titelüberschrift nicht doppelt');
      const backupPage = await page(backup.id);
      assert.equal(backupPage.version, 2, 'Version aus attic übernommen');
      const serverAttachments = await admin.get(`/api/v1/pages/${server.id}/attachments`);
      assert.deepEqual(serverAttachments.body.map((a: { filename: string }) => a.filename).sort(), ['plan.png', 'unbenutzt.pdf']);
    });

    await t.test('XWiki: verschachtelte Seiten, Tags, Anhänge, Makros', async () => {
      const doc = (web: string, name: string, title: string, content: string, extra = '') => `<?xml version="1.1" encoding="UTF-8"?>
<xwikidoc version="1.5" reference="${web}.${name}" locale="">
<web>${web}</web><name>${name}</name><language/><creator>xwiki:XWiki.Admin</creator><creationDate>1705312345000</creationDate>
<author>xwiki:XWiki.admin</author><date>1710000000000</date><title>${title}</title><syntaxId>xwiki/2.1</syntaxId><hidden>false</hidden>
${extra}<content>${xml(content)}</content></xwikidoc>`;
      const upload = zip({
        'package.xml': '<?xml version="1.0"?><package><infos><name>Export</name></infos><files/></package>',
        'Betrieb/WebHome.xml': doc(
          'Betrieb',
          'WebHome',
          'Betrieb',
          '{{warning}}Achtung **Wartung**{{/warning}}\n\n[[Server>>Betrieb.Server.WebHome]] und [[image:schema.png||width="120"]]\n\n|=Name|=Wert\n|A|1',
          `<attachment><filename>schema.png</filename><content>${PNG.toString('base64')}</content></attachment><object><className>XWiki.TagClass</className><property><tags><value>betrieb</value></tags></property></object>`,
        ),
        'Betrieb/Server/WebHome.xml': doc('Betrieb.Server', 'WebHome', 'Server', '{{velocity}}$doc.name{{/velocity}}\n\nZurück zu [[Betrieb]]'),
        'XWiki/XWikiPreferences.xml': doc('XWiki', 'XWikiPreferences', 'Prefs', 'x'),
      });
      const started = await startImport(admin, 'XW', { name: 'export.xar', data: upload });
      assert.equal(started.status, 202, started.raw);
      const job = await finish(admin, started.body.id);
      assert.equal(job.format, 'xwiki');
      assert.equal(job.report.pages, 2);
      assert.equal(job.report.attachments, 1);
      const pages = await tree('XW');
      const betrieb = pages.find((p) => p.title === 'Betrieb')!;
      const server = pages.find((p) => p.title === 'Server')!;
      assert.equal(server.parentId, betrieb.id);
      const dto = await page(betrieb.id);
      assert.deepEqual(dto.labels, ['betrieb']);
      assert.match(dto.content, /data-variant="warning"/);
      assert.match(dto.content, new RegExp(`/s/XW/p/${server.id}/`));
      assert.match(dto.content, /<img src="\/api\/v1\/attachments\/\d+\/raw" alt="schema.png" width="120"/);
      assert.match((await page(server.id)).content, /Makro „velocity“ nicht übernommen/);
    });

    await t.test('Rechte, fremde Aufträge und ungültige Dateien', async () => {
      assert.ok([403, 404].includes((await startImport(tom, 'MW', { name: 'x.xml', data: Buffer.from(MEDIAWIKI) })).status), 'kein Import in fremde Bereiche');
      assert.equal((await admin.post('/api/v1/spaces', { key: 'OPEN', name: 'Offen', preset: 'open' })).status, 200);
      const started = await startImport(admin, 'OPEN', { name: 'kaputt.zip', data: Buffer.from('kein zip') });
      assert.equal(started.status, 202, started.raw);
      await ctx.s.imports.idle();
      const failed = await admin.get(`/api/v1/imports/${started.body.id}`);
      assert.equal(failed.body.state, 'failed');
      assert.match(failed.body.error, /kein gültiges ZIP/);
      assert.equal((await tom.get(`/api/v1/imports/${started.body.id}`)).status, 404, 'fremde Aufträge bleiben verborgen');
    });
  } finally {
    await ctx.s.imports.idle();
    await ctx.close();
  }
});
