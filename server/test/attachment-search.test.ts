import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { Client, createTestApp } from './helpers.ts';

function makePdf(lines: string[]): Buffer {
  const objs: string[] = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
  let stream = '';
  lines.forEach((l, i) => {
    stream += `BT /F1 13 Tf 60 ${760 - i * 22} Td (${l}) Tj ET\n`;
  });
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

const zip = (files: Record<string, string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));

function multipart(files: { name: string; data: Buffer; type?: string }[]): { body: Buffer; type: string } {
  const boundary = '----knowstead-test';
  const parts: Buffer[] = [];
  for (const f of files) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${f.name}"\r\nContent-Type: ${f.type ?? 'application/octet-stream'}\r\n\r\n`));
    parts.push(f.data);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

test('Volltextsuche in Anhängen', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);

  const search = async (client: Client, q: string) => {
    const res = await client.get(`/api/v1/search?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, res.raw);
    return res.body.attachments as { filename: string; snippet: string | null; page: { title: string } }[];
  };

  try {
    await t.test('Einrichtung und Upload verschiedener Formate', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true })).status, 200);
      await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim' });
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
      const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Verträge und Pläne', content: '<p>Sammlung</p>' });

      const files = multipart([
        { name: 'wartung.pdf', data: makePdf(['Wartungsvertrag Klimaanlage', 'Laufzeit bis 2028']), type: 'application/pdf' },
        {
          name: 'konzept.docx',
          data: zip({
            'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Ausfallkonzept Rechenzentrum</w:t></w:r></w:p><w:p><w:r><w:instrText> TOC \\o "1-3" </w:instrText><w:t>Wiederanlauf &amp; Tests</w:t></w:r></w:p></w:body></w:document>',
            'word/footer1.xml': '<w:ftr><w:p><w:r><w:t>Vertraulich intern</w:t></w:r></w:p></w:ftr>',
          }),
        },
        {
          name: 'inventar.xlsx',
          data: zip({
            'xl/workbook.xml': '<workbook><sheets><sheet name="Hardware" sheetId="1"/></sheets></workbook>',
            'xl/sharedStrings.xml': '<sst><si><t>Serverraum Nord</t></si><si><t>Switch 48 Ports</t></si></sst>',
          }),
        },
        { name: 'migration.pptx', data: zip({ 'ppt/slides/slide1.xml': '<p:sld><a:p><a:r><a:t>Migrationsfahrplan</a:t></a:r></a:p></p:sld>', 'ppt/notesSlides/notesSlide1.xml': '<p:notes><a:p><a:r><a:t>Sprechernotiz Cutover</a:t></a:r></a:p></p:notes>' }) },
        { name: 'netz.vsdx', data: zip({ 'visio/pages/page1.xml': "<PageContents><Shapes><Shape><Text>Firewall<cp IX='0'/> Perimeter</Text></Shape></Shapes></PageContents>" }) },
        { name: 'vereinbarung.odt', data: zip({ 'content.xml': '<office:document-content><text:h>Betriebsvereinbarung</text:h><text:p>Homeoffice Regeln</text:p></office:document-content>' }) },
        { name: 'notfall.txt', data: Buffer.from('Notfallnummer der Leitstelle: 0800 555 1234', 'utf8'), type: 'text/plain' },
        { name: 'leitfaden.html', data: Buffer.from('<html><script>var geheimwort = 1</script><p>Leitfaden &amp; Hinweise zur Krisenkommunikation</p></html>', 'utf8'), type: 'text/html' },
        { name: 'foto.jpg', data: Buffer.from([0xff, 0xd8, 0xff, 0xe0]), type: 'image/jpeg' },
      ]);
      const upload = await admin.request('POST', `/api/v1/pages/${page.body.id}/attachments`, files.body, { 'content-type': files.type });
      assert.equal(upload.status, 200, upload.raw);
      await ctx.s.attachmentText.process();
    });

    await t.test('Inhalte aller Formate sind auffindbar', async () => {
      const cases: [string, string][] = [
        ['Klimaanlage', 'wartung.pdf'],
        ['Rechenzentrum', 'konzept.docx'],
        ['Wiederanlauf', 'konzept.docx'],
        ['Vertraulich', 'konzept.docx'],
        ['Serverraum', 'inventar.xlsx'],
        ['Hardware', 'inventar.xlsx'],
        ['Migrationsfahrplan', 'migration.pptx'],
        ['Cutover', 'migration.pptx'],
        ['Perimeter', 'netz.vsdx'],
        ['Betriebsvereinbarung', 'vereinbarung.odt'],
        ['Leitstelle', 'notfall.txt'],
        ['Krisenkommunikation', 'leitfaden.html'],
      ];
      for (const [q, file] of cases) {
        const hits = await search(admin, q);
        const hit = hits.find((h) => h.filename === file);
        assert.ok(hit, `„${q}“ findet ${file}`);
        assert.match(hit.snippet ?? '', /<mark>/, `Auszug für „${q}“`);
      }
      assert.equal((await search(admin, 'geheimwort')).length, 0, 'Skriptinhalt wird nicht indexiert');
      assert.equal((await search(admin, 'TOC')).length, 0, 'Feldfunktionen aus Word bleiben außen vor');
      assert.ok((await search(admin, 'foto')).some((h) => h.filename === 'foto.jpg'), 'Dateiname bleibt suchbar');
      assert.ok((await search(admin, 'Klima')).some((h) => h.filename === 'wartung.pdf'), 'Präfixsuche');
    });

    await t.test('Leserechte gelten auch für Anhänge', async () => {
      await admin.post('/api/v1/spaces', { key: 'HR', name: 'Personal', preset: 'private' });
      const secret = await admin.post('/api/v1/pages', { spaceKey: 'HR', title: 'Vergütung', content: '<p>x</p>' });
      const files = multipart([{ name: 'gehalt.txt', data: Buffer.from('Gehaltsband Stufe E13', 'utf8'), type: 'text/plain' }]);
      assert.equal((await admin.request('POST', `/api/v1/pages/${secret.body.id}/attachments`, files.body, { 'content-type': files.type })).status, 200);
      await ctx.s.attachmentText.process();
      assert.equal((await search(admin, 'Gehaltsband')).length, 1);
      assert.equal((await search(tom, 'Gehaltsband')).length, 0, 'Tom sieht den Bereich nicht');
    });

    await t.test('Gelöschte Anhänge verschwinden, Status und Neuaufbau', async () => {
      const hits = await admin.get('/api/v1/search?q=Leitstelle');
      const att = hits.body.attachments[0];
      assert.equal((await admin.del(`/api/v1/attachments/${att.id}`)).status, 200);
      assert.equal((await search(admin, 'Leitstelle')).length, 0);

      const status = await admin.get('/api/v1/admin/attachments/index');
      assert.equal(status.status, 200, status.raw);
      assert.equal(status.body.pending, 0);
      assert.ok(status.body.done >= 9, `indexiert: ${JSON.stringify(status.body)}`);
      assert.equal((await tom.get('/api/v1/admin/attachments/index')).status, 403);

      const rebuild = await admin.post('/api/v1/admin/maintenance/reindex-attachments', {});
      assert.equal(rebuild.status, 200, rebuild.raw);
      await ctx.s.attachmentText.process();
      assert.ok((await search(admin, 'Serverraum')).length === 1, 'nach Neuaufbau wieder auffindbar');
    });
  } finally {
    await ctx.close();
  }
});
