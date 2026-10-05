import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, createTestApp } from './helpers.ts';
import { pdfPageImages, toPgm } from '../src/modules/attachments/ocr.ts';

/** PDF mit einem eingebetteten Graustufenbild und ohne Textebene – wie ein Scan. */
function scannedPdf(width = 240, height = 120): Buffer {
  const pixels = Buffer.alloc(width * height);
  for (let i = 0; i < pixels.length; i++) pixels[i] = i % width < width / 2 ? 30 : 220;
  const content = Buffer.from('q 240 0 0 120 0 0 cm /Im1 Do Q\n', 'latin1');
  const objects: Buffer[] = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 120] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>'),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Length ${pixels.length} >>\nstream\n`), pixels, Buffer.from('\nendstream')]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('endstream')]),
  ];
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n')];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((o, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from('\nendobj\n')]);
    parts.push(chunk);
    length += chunk.length;
  });
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function multipart(name: string, data: Buffer, type: string) {
  const boundary = '----knowstead-ocr';
  return {
    body: Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`), data, Buffer.from(`\r\n--${boundary}--\r\n`)]),
    type: `multipart/form-data; boundary=${boundary}`,
  };
}

test('Texterkennung (OCR) für Scans und Bilder', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-ocr-test-'));
  const calls: { input: string; languages: string; header: string }[] = [];
  let pageId = 0;

  const upload = async (name: string, data: Buffer, type: string) => {
    const form = multipart(name, data, type);
    const res = await admin.request('POST', `/api/v1/pages/${pageId}/attachments`, form.body, { 'content-type': form.type });
    assert.equal(res.status, 200, res.raw);
    await ctx.s.attachmentText.process();
    return res.body[0].id as number;
  };
  const found = async (q: string) => ((await admin.get(`/api/v1/search?q=${encodeURIComponent(q)}`)).body.attachments as { filename: string }[]).map((a) => a.filename);

  try {
    await t.test('PGM-Umwandlung und Seitenbilder aus einem Scan', async () => {
      const gray = toPgm(2, 1, new Uint8Array([10, 20, 30, 40, 50, 60]), 2);
      assert.equal(gray.subarray(0, 11).toString('ascii'), 'P5\n2 1\n255\n');
      const bits = toPgm(9, 1, new Uint8Array([0b10000000, 0b10000000]), 1);
      assert.deepEqual([...bits.subarray(-9)], [255, 0, 0, 0, 0, 0, 0, 0, 255]);

      const files = await pdfPageImages(new Uint8Array(scannedPdf()), tmp, 5);
      assert.equal(files.length, 1, 'ein Seitenbild');
      const pgm = fs.readFileSync(files[0]);
      assert.equal(pgm.subarray(0, 15).toString('ascii'), 'P5\n240 120\n255\n');
      assert.equal(pgm.length, 15 + 240 * 120);
      assert.equal(pgm[15], 30, 'Pixelwerte übernommen');
    });

    await t.test('Ohne Texterkennung bleibt es beim Dateinamen', async () => {
      await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
      pageId = (await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Eingangspost', content: '<p>Scans</p>' })).body.id;
      ctx.s.attachmentText.ocrRunner = async (_bin, input, languages) => {
        calls.push({ input, languages, header: fs.readFileSync(input).subarray(0, 2).toString('latin1') });
        return input.endsWith('.pgm') ? 'Rechnung Nr. 4711\nStadtwerke' : 'Whiteboard Sprintplanung';
      };
      await upload('rechnung-scan.pdf', scannedPdf(), 'application/pdf');
      await upload('tafel.png', PNG, 'image/png');
      assert.deepEqual(await found('Stadtwerke'), []);
      assert.equal(calls.length, 0);
      const status = (await admin.get('/api/v1/admin/attachments/index')).body;
      assert.equal(status.ocr, false);
    });

    await t.test('Einstellungen werden geprüft', async () => {
      assert.equal((await admin.put('/api/v1/admin/settings', { ocr: { enabled: true, tesseractPath: 'C:\\Windows\\System32\\cmd.exe' } })).status, 400, 'nur Tesseract');
      assert.equal((await admin.put('/api/v1/admin/settings', { ocr: { enabled: true, languages: 'deu; rm -rf /' } })).status, 400, 'nur Sprachkürzel');
    });

    await t.test('Einschalten erkennt vorhandene Scans und Bilder nachträglich', async () => {
      const fake = path.join(tmp, process.platform === 'win32' ? 'tesseract.exe' : 'tesseract');
      fs.writeFileSync(fake, '');
      const res = await admin.put('/api/v1/admin/settings', { ocr: { enabled: true, tesseractPath: fake, languages: 'deu+eng', maxPages: 10 } });
      assert.equal(res.status, 200, res.raw);
      await ctx.s.attachmentText.process();
      assert.deepEqual(await found('Stadtwerke'), ['rechnung-scan.pdf']);
      assert.deepEqual(await found('Sprintplanung'), ['tafel.png']);
      assert.ok(calls.some((c) => c.header === 'P5' && c.languages === 'deu+eng'), 'PDF-Seite als PGM erkannt');
      const status = (await admin.get('/api/v1/admin/attachments/index')).body;
      assert.equal(status.ocr, true);
      assert.equal(status.recognized, 2);
      assert.equal(fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('knowstead-ocr-') && d !== path.basename(tmp)).length, 0, 'Seitenbilder aufgeräumt');
    });

    await t.test('PDFs mit Textebene brauchen keine Texterkennung; Fehler werden protokolliert', async () => {
      calls.length = 0;
      const text = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n', 'latin1');
      await upload('kaputt.pdf', text, 'application/pdf');
      ctx.s.attachmentText.ocrRunner = async () => {
        throw new Error('Tesseract nicht gefunden');
      };
      await upload('foto.jpg', PNG, 'image/jpeg');
      const failures = (await admin.get('/api/v1/admin/attachments/index')).body.recentFailures as { filename: string; error: string }[];
      assert.ok(failures.some((f) => f.filename === 'foto.jpg' && /Texterkennung: Tesseract nicht gefunden/.test(f.error)));
    });

    await t.test('Statusanzeige nur für die Administration', async () => {
      const tom = new Client(ctx.app);
      await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim' });
      await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' });
      assert.equal((await tom.get('/api/v1/admin/ocr')).status, 403);
      const status = await admin.get('/api/v1/admin/ocr');
      assert.equal(status.status, 200, status.raw);
      assert.equal(status.body.found, true);
      assert.equal(status.body.recognized, 2);
    });
  } finally {
    await ctx.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
