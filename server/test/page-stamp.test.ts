import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStamps, onlyStampsDiffer } from '../src/core/stamp.ts';
import { Client, createTestApp } from './helpers.ts';

test('Stand-Angaben: nur Datum und Uhrzeit hinter „Stand“ zählen, in allen üblichen Schreibweisen', () => {
  const same: [string, string][] = [
    ['<p>Stand: 03.11.2026 09:15</p>', '<p>Stand: 04.11.2026 10:42</p>'],
    ['<p><strong>Stand:</strong> 03.11.2026, 09:15 Uhr</p>', '<p><strong>Stand:</strong> 04.11.2026, 10:42 Uhr</p>'],
    ['<p>Stand: 3.11.26 9.15 Uhr</p>', '<p>Stand: 12.12.2027 18.00 Uhr</p>'],
    ['<p>Stand&nbsp;03.11.2026&nbsp;09:15</p>', '<p>Stand&nbsp;04.11.2026&nbsp;10:42</p>'],
    ['Stand: 2026-11-03 09:15:22', 'Stand: 2026-11-04T10:42:01'],
    ['Last updated: 11/03/2026 9:15 AM', 'Last updated: 11/04/2026 10:42 PM'],
    ['<p>Stand: 3. November 2026, 09:15 Uhr</p>', '<p>Stand: 14. Dezember 2026, 18:30 Uhr</p>'],
    ['<p>As of November 3, 2026 09:15</p>', '<p>As of December 14, 2026 18:30</p>'],
    ['<table><tr><td>Stand</td><td>03.11.2026 09:15</td></tr></table>', '<table><tr><td>Stand</td><td>04.11.2026 10:42</td></tr></table>'],
    ['<p>Stand: 03.11.2026</p>', '<p>Stand: 04.11.2026</p>'],
    ['<p>Stand: <span>03.11.2026</span> um <span>09:15</span> Uhr</p>', '<p>Stand: <span>04.11.2026</span> um <span>10:42</span> Uhr</p>'],
    ['**Stand:** 03.11.2026 09:15\n\nText', '**Stand:** 04.11.2026 10:42\n\nText'],
    ['<p>Stand: 03.11.2026 09:15</p><p>A</p><p>Zuletzt aktualisiert: 01.01.2026</p>', '<p>Stand: 04.11.2026 10:42</p><p>A</p><p>Zuletzt aktualisiert: 02.02.2027</p>'],
  ];
  for (const [a, b] of same) assert.equal(onlyStampsDiffer(a, b), true, `${a}  ↔  ${b}`);

  const different: [string, string][] = [
    ['<p>Stand: 03.11.2026 09:15</p><p>A</p>', '<p>Stand: 04.11.2026 10:42</p><p>B</p>'],
    ['<p>Stand 2026</p>', '<p>Stand 2027</p>'],
    ['<p>Release 03.11.2026</p>', '<p>Release 04.11.2026</p>'],
    ['<p>Der aktuelle Stand</p><p>03.11.2026 Release</p>', '<p>Der aktuelle Stand</p><p>04.11.2026 Release</p>'],
    ['<p>Stand: 03.11.2026</p><p>09:15 Besprechung</p>', '<p>Stand: 03.11.2026</p><p>10:00 Besprechung</p>'],
    ['<p>Bestand: 03.11.2026</p>', '<p>Bestand: 04.11.2026</p>'],
    ['<p>Stand: 03.11.2026 09:15</p>', '<p>Stand: 03.11.2026</p>'],
    ['<p>Stand: 03.11.2026</p>', '<p>Geprüft: 03.11.2026</p>'],
    ['<p>Stand: 03.11.2026 09:15</p>', '<p>Stand: <strong>03.11.2026</strong> 09:15 Uhr</p>'],
    ['<p>Treffen am 03.11.2026 um 09:15</p>', '<p>Treffen am 04.11.2026 um 10:42</p>'],
  ];
  for (const [a, b] of different) assert.equal(onlyStampsDiffer(a, b), false, `${a}  ↔  ${b}`);

  assert.equal(onlyStampsDiffer('<p>Stand: 03.11.2026 09:15</p>', '<p>Stand: 03.11.2026 09:15</p>'), false, 'gleich ist nicht „nur der Stand unterscheidet sich“');
  assert.equal(normalizeStamps('<p>Nichts</p>'), '<p>Nichts</p>');
});

test('Stand-Angaben: auch bösartig geformte Texte werden in kurzer Zeit geprüft', () => {
  const big = 1_000_000;
  const inputs: Record<string, string> = {
    'Leerraum hinter „Stand“': `Stand${' '.repeat(2 * big)}x`,
    'viele „Stand“': 'Stand '.repeat(big / 2),
    'viele Tags hinter „Stand“': `Stand: ${'<span>'.repeat(big / 4)}`,
    'unvollständiger Tag': `Stand: <span${'x'.repeat(2 * big)}`,
    'halbe Daten': 'Stand: 03.11.'.repeat(big / 10),
    'Datum mit langem Leerraum zur Uhrzeit': `Stand: 03.11.2026${' '.repeat(2 * big)}x`,
    'Daten ohne Ende': `Stand: ${'12.'.repeat(big)}`,
  };
  for (const [name, text] of Object.entries(inputs)) {
    const started = performance.now();
    normalizeStamps(text);
    onlyStampsDiffer(text, `${text}!`);
    const ms = performance.now() - started;
    assert.ok(ms < 1500, `${name}: ${Math.round(ms)} ms`);
  }
});

test('Seite speichern: ändert sich nur der Stand, entsteht keine neue Version', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  let pageId = 0;
  let adminId = 0;
  const content = (stamp: string, body = 'Inhalt A') => `<p><strong>Stand:</strong> ${stamp}</p><p>${body}</p>`;
  const revisions = async () => (await admin.get(`/api/v1/pages/${pageId}/revisions`)).body.total as number;
  const stored = () => ctx.s.db.get<{ content: string; content_text: string; version: number; updated_at: string; updated_by: number }>('SELECT content, content_text, version, updated_at, updated_by FROM pages WHERE id = ?', pageId)!;

  try {
    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true })).status, 200);
      adminId = (await admin.get('/api/v1/auth/me')).body.user.id;
      const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Betriebsstand', content: content('03.11.2026 09:15') });
      assert.equal(page.status, 200, page.raw);
      pageId = page.body.id;
      assert.equal(page.body.version, 1);
    });

    await t.test('nur der Stand: gleiche Version, neuer Text in der aktuellen Fassung, auch im Suchindex', async () => {
      const before = stored();
      const res = await admin.put(`/api/v1/pages/${pageId}`, { content: content('17.12.2031 18:45'), baseVersion: 1 });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.version, 1, 'keine neue Version');
      assert.equal(await revisions(), 1);
      const after = stored();
      assert.ok(after.content.includes('17.12.2031 18:45'));
      assert.ok(after.content_text.includes('17.12.2031'));
      assert.equal(after.updated_at, before.updated_at, 'zuletzt geändert bleibt');
      assert.equal(after.updated_by, before.updated_by);
      const revision = ctx.s.db.get<{ content: string; size: number }>('SELECT content, size FROM page_revisions WHERE page_id = ? AND version = 1', pageId)!;
      assert.equal(revision.content, after.content, 'die aktuelle Fassung im Verlauf trägt den neuen Stand');
      assert.equal(revision.size, Buffer.byteLength(after.content, 'utf8'));
      const hits = ctx.s.db.all<{ rowid: number }>('SELECT rowid FROM pages_fts WHERE pages_fts MATCH ?', '"17 12 2031"');
      assert.deepEqual(hits.map((h) => h.rowid), [pageId], 'der Suchindex kennt den neuen Stand');
      assert.equal((await admin.get(`/api/v1/pages/${pageId}`)).body.version, 1);
    });

    await t.test('ein gespeicherter Entwurf wird dabei verworfen, der Konflikt bleibt erkannt', async () => {
      assert.equal((await admin.put(`/api/v1/pages/${pageId}/draft`, { title: 'Betriebsstand', content: content('01.01.2032 08:00'), baseVersion: 1 })).status, 200);
      assert.equal(ctx.s.db.value<number>('SELECT COUNT(*) FROM page_drafts WHERE page_id = ?', pageId), 1);
      assert.equal((await admin.put(`/api/v1/pages/${pageId}`, { content: content('01.01.2032 08:00'), baseVersion: 1 })).status, 200);
      assert.equal(ctx.s.db.value<number>('SELECT COUNT(*) FROM page_drafts WHERE page_id = ?', pageId), 0);
      const stale = await admin.put(`/api/v1/pages/${pageId}`, { content: content('02.01.2032 08:00'), baseVersion: 0 });
      assert.equal(stale.status, 409, 'veraltete Grundlage bleibt ein Konflikt');
    });

    await t.test('Stand plus echte Änderung, Änderungsnotiz oder ausdrückliche Art: neue Version', async () => {
      const real = await admin.put(`/api/v1/pages/${pageId}`, { content: content('02.01.2032 08:00', 'Inhalt B'), baseVersion: 1 });
      assert.equal(real.body.version, 2);
      const noted = await admin.put(`/api/v1/pages/${pageId}`, { content: content('03.01.2032 08:00', 'Inhalt B'), baseVersion: 2, changeNote: 'Stand nach Prüfung' });
      assert.equal(noted.body.version, 3, 'mit eigener Notiz bleibt es eine Version');
      assert.equal(await revisions(), 3);
      const noStamp = await admin.put(`/api/v1/pages/${pageId}`, { content: content('03.01.2032 08:00', 'Inhalt B'), baseVersion: 3 });
      assert.equal(noStamp.body.version, 3, 'unverändert bleibt unverändert');
    });

    await t.test('Wiederherstellen einer Fassung, die sich nur im Stand unterscheidet, ist eine Version', async () => {
      // Version 2 und 3 haben denselben Titel und unterscheiden sich nur im Stand
      const restored = await admin.post(`/api/v1/pages/${pageId}/revisions/2/restore`);
      assert.equal(restored.status, 200, restored.raw);
      assert.equal(stored().version, 4);
      assert.equal(await revisions(), 4);
    });

    await t.test('ein anderer Titel ist immer eine Version, auch mit neuem Stand', async () => {
      const title = await admin.put(`/api/v1/pages/${pageId}`, { title: 'Betriebsstand neu', content: content('04.01.2032 08:00', 'Inhalt B'), baseVersion: 4 });
      assert.equal(title.body.version, 5);
    });

    await t.test('Wer die Seite verantwortet, hat sie damit geprüft – auch ohne neue Version', async () => {
      assert.equal((await admin.put(`/api/v1/pages/${pageId}/review-cycle`, { ownerId: adminId, intervalMonths: 6 })).status, 200);
      const verified = () => ctx.s.db.value<string | null>('SELECT verified_at FROM pages WHERE id = ?', pageId);
      const version = stored().version;
      ctx.s.db.run("UPDATE pages SET verified_at = '2020-01-01T00:00:00.000Z' WHERE id = ?", pageId);
      const current = stored().content;
      const stamp = current.replace(/Stand:<\/strong> [^<]*/, 'Stand:</strong> 05.05.2033 05:05');
      assert.notEqual(stamp, current);
      assert.equal((await admin.put(`/api/v1/pages/${pageId}`, { content: stamp, baseVersion: version, minor: true })).body.version, version);
      assert.equal(verified(), '2020-01-01T00:00:00.000Z', 'geringfügig zählt nicht als Prüfung');
      const next = stamp.replace('05.05.2033 05:05', '06.06.2034 06:06');
      assert.equal((await admin.put(`/api/v1/pages/${pageId}`, { content: next, baseVersion: version })).body.version, version);
      assert.ok(String(verified()) > '2024', 'wesentlich: geprüft');
      assert.equal(await revisions(), 5);
    });

    await t.test('Markdown-Seiten ebenso, Code-Seiten nie', async () => {
      const md = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Notizen', contentType: 'markdown', content: '**Stand:** 03.11.2026 09:15\n\nText' });
      assert.equal(md.status, 200, md.raw);
      const mdSame = await admin.put(`/api/v1/pages/${md.body.id}`, { contentType: 'markdown', content: '**Stand:** 04.11.2026 10:42\n\nText', baseVersion: 1 });
      assert.equal(mdSame.body.version, 1);
      const mdReal = await admin.put(`/api/v1/pages/${md.body.id}`, { contentType: 'markdown', content: '**Stand:** 05.11.2026 10:42\n\nText 2', baseVersion: 1 });
      assert.equal(mdReal.body.version, 2);

      const code = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Skript', contentType: 'code', language: 'javascript', content: 'const note = "Stand: 03.11.2026 09:15";' });
      assert.equal(code.status, 200, code.raw);
      const codeStamp = await admin.put(`/api/v1/pages/${code.body.id}`, { contentType: 'code', language: 'javascript', content: 'const note = "Stand: 04.11.2026 10:42";', baseVersion: 1 });
      assert.equal(codeStamp.body.version, 2, 'in Code zählt jede Änderung');
    });
  } finally {
    await ctx.close();
  }
});
