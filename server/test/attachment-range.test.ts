import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';
import { parseRange } from '../src/modules/attachments/service.ts';

/**
 * Video und Ton hängen an Seiten wie jede andere Datei. Ohne Bereichsauslieferung („Range“) lässt
 * sich darin nicht springen, Safari spielt sie gar nicht erst ab und abgebrochene Downloads müssen
 * von vorn beginnen.
 */
function multipart(name: string, data: Buffer, type: string): { body: Buffer; type: string } {
  const boundary = '----knowstead-test';
  return {
    body: Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: ${type}\r\n\r\n`),
      data,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    type: `multipart/form-data; boundary=${boundary}`,
  };
}

test('Anhänge: Auslieferung in Bereichen', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  // 4 KB Inhalt mit erkennbarem Muster, damit sich jedes Byte zuordnen lässt
  const content = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i % 251) + 1));
  let id = 0;

  try {
    await t.test('Einrichtung und Upload', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim' })).status, 200);
      const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Schulungsvideos', content: '<p>Aufzeichnungen</p>' });
      const file = multipart('schulung.mp4', content, 'video/mp4');
      const upload = await admin.request('POST', `/api/v1/pages/${page.body.id}/attachments`, file.body, { 'content-type': file.type });
      assert.equal(upload.status, 200, upload.raw);
      id = upload.body[0].id;
    });

    await t.test('Ohne Range kommt die ganze Datei – aber mit Accept-Ranges', async () => {
      const res = await admin.get(`/api/v1/attachments/${id}/raw`);
      assert.equal(res.status, 200);
      assert.equal(res.headers['accept-ranges'], 'bytes');
      assert.equal(res.headers['content-length'], String(content.length));
      assert.equal(res.bytes.length, content.length);
      assert.ok(res.bytes.equals(content));
    });

    await t.test('Mit Range antwortet der Server mit 206 und genau dem Ausschnitt', async () => {
      const res = await admin.request('GET', `/api/v1/attachments/${id}/raw`, undefined, { range: 'bytes=100-199' });
      assert.equal(res.status, 206);
      assert.equal(res.headers['content-range'], `bytes 100-199/${content.length}`);
      assert.equal(res.headers['content-length'], '100');
      assert.ok(res.bytes.equals(content.subarray(100, 200)), 'genau die angeforderten Bytes');
    });

    await t.test('Offenes Ende und Bytes vom Dateiende', async () => {
      const open = await admin.request('GET', `/api/v1/attachments/${id}/raw`, undefined, { range: 'bytes=4000-' });
      assert.equal(open.status, 206);
      assert.equal(open.headers['content-range'], `bytes 4000-4095/${content.length}`);
      assert.ok(open.bytes.equals(content.subarray(4000)));

      const suffix = await admin.request('GET', `/api/v1/attachments/${id}/raw`, undefined, { range: 'bytes=-16' });
      assert.equal(suffix.status, 206);
      assert.equal(suffix.headers['content-range'], `bytes 4080-4095/${content.length}`);
      assert.ok(suffix.bytes.equals(content.subarray(4080)));
    });

    await t.test('Bereich außerhalb der Datei wird mit 416 abgelehnt', async () => {
      const res = await admin.request('GET', `/api/v1/attachments/${id}/raw`, undefined, { range: 'bytes=99999-' });
      assert.equal(res.status, 416);
      assert.equal(res.headers['content-range'], `bytes */${content.length}`);
    });

    await t.test('Unverständliche Angaben liefern weiterhin die ganze Datei', async () => {
      for (const header of ['bytes=abc', 'seiten=1-2', 'bytes=1-2, 5-6', '']) {
        const res = await admin.request('GET', `/api/v1/attachments/${id}/raw`, undefined, { range: header });
        assert.equal(res.status, 200, `„${header}“ darf die Auslieferung nicht stören`);
        assert.equal(res.bytes.length, content.length);
      }
    });

    await t.test('Rechte gelten auch für Ausschnitte', async () => {
      const gast = new Client(ctx.app);
      const res = await gast.request('GET', `/api/v1/attachments/${id}/raw`, undefined, { range: 'bytes=0-9' });
      assert.equal(res.status, 401, 'ohne Anmeldung kein Ausschnitt');
    });

    await t.test('Auswertung der Kopfzeile im Einzelnen', () => {
      assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
      assert.deepEqual(parseRange('bytes=90-999', 100), { start: 90, end: 99 }, 'zu großes Ende wird gekappt');
      assert.deepEqual(parseRange('bytes=-200', 100), { start: 0, end: 99 }, 'mehr Bytes vom Ende als vorhanden');
      assert.equal(parseRange(undefined, 100), null);
      assert.equal(parseRange('bytes=-', 100), null);
      assert.equal(parseRange('bytes=100-', 100), 'invalid');
      assert.equal(parseRange('bytes=50-20', 100), 'invalid');
      assert.equal(parseRange('bytes=-0', 100), 'invalid');
      assert.equal(parseRange('bytes=0-0', 0), 'invalid', 'leere Datei hat keinen gültigen Bereich');
    });
  } finally {
    await ctx.close();
  }
});
