import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlDiff } from '../src/core/diff.ts';
import { htmlToText } from '../src/core/html.ts';
import { htmlToMarkdown, markdownToHtml } from '../src/core/markdown.ts';
import { Client, createTestApp } from './helpers.ts';

const MACRO = '<span data-type="page-stand"></span>';
const DATE_TIME = String.raw`\d{2}[./]\d{2}[./]\d{4}, \d{2}:\d{2} \S+`;

test('Baustein „Stand der Seite“: Markdown, Vergleich und Suchtext', () => {
  assert.equal(markdownToHtml('Gültig – <!-- stand -->').includes(MACRO), true, 'Markdown → Baustein');
  assert.equal(htmlToMarkdown(`<p>Gültig – ${MACRO}</p>`).trim(), 'Gültig – <!-- stand -->', 'Baustein → Markdown (z. B. Quelltext-Vergleich)');
  assert.equal(htmlToText(`<p>Gültig ${MACRO}</p>`).trim(), 'Gültig', 'kein fester Text im Suchindex');
  const diff = htmlDiff('<p>Text</p>', `<p>Text ${MACRO}</p>`);
  assert.ok(diff?.html.includes('⟨Stand der Seite⟩'), diff?.html);
});

test('Baustein „Stand der Seite“: bleibt beim Speichern erhalten und steht im Export als Text', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  let pageId = 0;
  const html = async (id = pageId, client = admin) => {
    const res = await client.get(`/api/v1/pages/${id}/export?format=html&inline=true`);
    assert.equal(res.status, 200, res.raw);
    return res.raw;
  };
  const save = async (content: string) => {
    const version = ctx.s.db.value<number>('SELECT version FROM pages WHERE id = ?', pageId)!;
    const res = await admin.put(`/api/v1/pages/${pageId}`, { content, baseVersion: version });
    assert.equal(res.status, 200, res.raw);
    return res.body;
  };

  try {
    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada Lovelace', password: 'geheim-geheim', sampleContent: true })).status, 200);
      const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Richtlinie', content: `<p>${MACRO}</p><p>Inhalt</p>` });
      assert.equal(page.status, 200, page.raw);
      pageId = page.body.id;
    });

    await t.test('Der gespeicherte Inhalt nennt kein Datum – nur, was gezeigt werden soll', async () => {
      const stored = ctx.s.db.value<string>('SELECT content FROM pages WHERE id = ?', pageId)!;
      assert.ok(stored.includes('data-type="page-stand"'), stored);
      assert.ok(!/\d{2}\.\d{2}\.\d{4}/.test(stored), 'kein Datum im Inhalt');
      const configured = await save('<p><span data-type="page-stand" data-source="updated" data-time="false" data-person="true" data-label="Gültig seit"></span></p><p>Inhalt</p>');
      for (const attr of ['data-source="updated"', 'data-time="false"', 'data-person="true"', 'data-label="Gültig seit"']) assert.ok(configured.content.includes(attr), attr);
    });

    await t.test('Export: Beschriftung, Datum ohne Uhrzeit, Name', async () => {
      const out = await html();
      assert.match(out, /<span class="page-stand">Gültig seit: \d{2}\.\d{2}\.\d{4} · Ada Lovelace<\/span>/);
    });

    await t.test('Export: Vorgabe mit Uhrzeit und Zeitzone; Markdown ebenso', async () => {
      await save(`<p>${MACRO}</p><p>Inhalt</p>`);
      assert.match(await html(), new RegExp(`<span class="page-stand">Stand: ${DATE_TIME}</span>`));
      const md = await admin.get(`/api/v1/pages/${pageId}/export?format=md`);
      assert.match(md.raw, new RegExp(`^Stand: ${DATE_TIME}$`, 'm'));
    });

    await t.test('Letzte Bestätigung: erst „noch nicht bestätigt“, nach „als aktuell bestätigen“ das Datum – ohne neue Version', async () => {
      await save('<p><span data-type="page-stand" data-source="verified"></span></p><p>Inhalt</p>');
      assert.ok((await html()).includes('<span class="page-stand">Stand: noch nicht bestätigt</span>'));
      const me = (await admin.get('/api/v1/auth/me')).body.user.id;
      assert.equal((await admin.put(`/api/v1/pages/${pageId}/review-cycle`, { ownerId: me, intervalMonths: 6 })).status, 200);
      const before = ctx.s.db.get<{ version: number; content: string }>('SELECT version, content FROM pages WHERE id = ?', pageId)!;
      const verified = await admin.post(`/api/v1/pages/${pageId}/verify`, {});
      assert.equal(verified.status, 200, verified.raw);
      const after = ctx.s.db.get<{ version: number; content: string }>('SELECT version, content FROM pages WHERE id = ?', pageId)!;
      assert.deepEqual(after, before, 'Bestätigen ändert weder Inhalt noch Version');
      assert.match(await html(), new RegExp(`<span class="page-stand">Stand: ${DATE_TIME}</span>`));
    });

    await t.test('Vorgabe: das spätere von Änderung und Bestätigung', async () => {
      await save(`<p>${MACRO}</p><p>Inhalt</p>`);
      const day = (iso: string) => new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      ctx.s.db.run("UPDATE pages SET updated_at = '2021-03-04T10:00:00.000Z', verified_at = '2022-05-06T10:00:00.000Z' WHERE id = ?", pageId);
      assert.ok((await html()).includes(`Stand: ${day('2022-05-06T10:00:00.000Z')}`), 'Bestätigung ist jünger');
      ctx.s.db.run("UPDATE pages SET updated_at = '2023-07-08T10:00:00.000Z' WHERE id = ?", pageId);
      assert.ok((await html()).includes(`Stand: ${day('2023-07-08T10:00:00.000Z')}`), 'Änderung ist jünger');
    });

    await t.test('Eingebundene Seite zeigt ihren eigenen Stand; englische Beschriftung', async () => {
      ctx.s.db.run("UPDATE pages SET updated_at = '2020-01-02T10:00:00.000Z', verified_at = NULL WHERE id = ?", pageId);
      const host = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Sammlung', content: `<p>${MACRO}</p><div data-type="include-page" data-page-id="${pageId}"></div>` });
      assert.equal(host.status, 200, host.raw);
      const out = await html(host.body.id);
      const stamps = [...out.matchAll(/<span class="page-stand">Stand: (\d{2}\.\d{2}\.\d{4})/g)].map((m) => m[1]);
      assert.equal(stamps.length, 2, out.slice(0, 400));
      assert.equal(stamps[1], new Date('2020-01-02T10:00:00.000Z').toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }));
      assert.notEqual(stamps[0], stamps[1]);

      assert.equal((await admin.patch('/api/v1/me/preferences', { locale: 'en' })).status, 200);
      assert.match(await html(), /<span class="page-stand">As of: \d{2}\/\d{2}\/\d{4}, /);
    });
  } finally {
    await ctx.close();
  }
});
