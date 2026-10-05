import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Client, createTestApp } from './helpers.ts';

/** Kleiner Nachbau der Anbieter-Schnittstellen, der Anfragen mitschreibt. */
function fakeProvider() {
  const requests: { url: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null;
      requests.push({ url: req.url ?? '', headers: req.headers, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/messages') {
        res.end(
          JSON.stringify({
            content: [{ type: 'text', text: '- Punkt eins\n- Punkt zwei' }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 42, output_tokens: 7 },
          }),
        );
      } else if (req.url === '/v1/chat/completions') {
        res.end(JSON.stringify({ choices: [{ message: { content: 'backup\nsicherung\nbetrieb' } }], usage: { prompt_tokens: 30, completion_tokens: 5 } }));
      } else {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: { message: 'unbekannt' } }));
      }
    });
  });
  return { server, requests };
}

test('KI, Aufgabenplaner, Zwischenablage, Duplizieren, Stichwörter', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);
  const provider = fakeProvider();
  await new Promise<void>((resolve) => provider.server.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${(provider.server.address() as AddressInfo).port}`;
  let pageId = 0;
  let tomId = 0;

  try {
    await t.test('Einrichtung', async () => {
      const setup = await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
      assert.equal(setup.status, 200, setup.raw);
      const user = await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim' });
      tomId = user.body.id;
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
      const page = await admin.post('/api/v1/pages', {
        spaceKey: 'TEAM',
        title: 'Betriebshandbuch',
        content: '<p>Die Sicherung läuft jede Nacht um 3 Uhr. Verantwortlich ist das Betriebsteam.</p>',
      });
      assert.equal(page.status, 200, page.raw);
      pageId = page.body.id;
    });

    await t.test('KI ist ohne Einrichtung aus', async () => {
      const status = await tom.get('/api/v1/ai/status');
      assert.equal(status.body.available, false);
      const run = await tom.post('/api/v1/ai/run', { action: 'summarize', pageId });
      assert.equal(run.status, 400, run.raw);
    });

    await t.test('Anthropic-Anbindung: Header, Modell, kein temperature', async () => {
      const saved = await admin.put('/api/v1/admin/settings', {
        ai: { enabled: true, provider: 'anthropic', baseUrl: providerUrl, apiKey: 'sk-test-123', model: 'claude-opus-5', dailyLimit: 2 },
      });
      assert.equal(saved.status, 200, saved.raw);
      assert.equal(saved.body.ai.apiKey, '••••••••', 'Schlüssel wird maskiert');

      const res = await tom.post('/api/v1/ai/run', { action: 'summarize', pageId });
      assert.equal(res.status, 200, res.raw);
      assert.match(res.body.text, /Punkt eins/);
      assert.equal(res.body.usage.inputTokens, 42);

      const call = provider.requests.at(-1)!;
      assert.equal(call.url, '/v1/messages');
      assert.equal(call.headers['x-api-key'], 'sk-test-123');
      assert.equal(call.headers['anthropic-version'], '2023-06-01');
      assert.equal(call.body.model, 'claude-opus-5');
      assert.ok(call.body.max_tokens > 0);
      assert.equal(call.body.temperature, undefined, 'aktuelle Claude-Modelle bekommen keine Temperatur');
      assert.match(call.body.messages[0].content, /Sicherung läuft jede Nacht/);
    });

    await t.test('Tageslimit und Rechte', async () => {
      assert.equal((await tom.post('/api/v1/ai/run', { action: 'improve', text: 'Das ist ein text mit fehler.' })).status, 200);
      const limited = await tom.post('/api/v1/ai/run', { action: 'improve', text: 'Noch ein Text.' });
      assert.equal(limited.status, 429, 'Tageslimit greift');

      // Recht entziehen: Standardgruppe ohne ai.use
      const groups = await admin.get('/api/v1/groups');
      const users = groups.body.find((g: { name: string }) => g.name === 'Benutzer');
      const detail = await admin.get(`/api/v1/admin/groups/${users.id}`);
      await admin.patch(`/api/v1/admin/groups/${users.id}`, { permissions: detail.body.group.permissions.filter((p: string) => p !== 'ai.use') });
      const denied = await tom.post('/api/v1/ai/run', { action: 'summarize', pageId });
      assert.equal(denied.status, 403, denied.raw);
    });

    await t.test('OpenAI-kompatibler Anbieter', async () => {
      await admin.put('/api/v1/admin/settings', { ai: { provider: 'custom', baseUrl: providerUrl, model: 'lokal', apiKey: 'abc', dailyLimit: 0 } });
      const res = await admin.post('/api/v1/ai/run', { action: 'tags', pageId });
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual(res.body.items, ['backup', 'sicherung', 'betrieb']);
      const call = provider.requests.at(-1)!;
      assert.equal(call.url, '/v1/chat/completions');
      assert.equal(call.headers.authorization, 'Bearer abc');
      assert.equal(call.body.messages[0].role, 'system');

      const usage = await admin.get('/api/v1/admin/ai/usage');
      assert.ok(usage.body.totals.requests >= 3);
    });

    let boardId = 0;
    await t.test('Plan und Aufgaben', async () => {
      const board = await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Relaunch' });
      assert.equal(board.status, 200, board.raw);
      boardId = board.body.id;
      assert.equal(board.body.buckets.length, 4);

      const task = await admin.post(`/api/v1/boards/${boardId}/tasks`, {
        title: 'Sicherung prüfen',
        assigneeId: tomId,
        dueDate: '2020-01-01',
        priority: 'high',
        pageId,
        checklist: [{ text: 'Log lesen' }],
      });
      assert.equal(task.status, 200, task.raw);
      assert.equal(task.body.assignee.username, 'tom');
      assert.equal(task.body.overdue, true);
      assert.equal(task.body.page.id, pageId);

      const mine = await tom.get('/api/v1/tasks?assignee=me&status=open-all');
      assert.equal(mine.body.items.length, 1);

      const me = await tom.get('/api/v1/auth/me');
      assert.equal(me.body.openTasks, 1);

      const notes = await tom.get('/api/v1/me/notifications');
      assert.ok(JSON.stringify(notes.body).includes('Aufgabe für dich'), 'Verantwortliche werden benachrichtigt');

      const moved = await admin.post(`/api/v1/tasks/${task.body.id}/move`, { bucket: 'done', index: 0 });
      assert.equal(moved.status, 200, moved.raw);
      assert.equal(moved.body.status, 'done', 'letzte Spalte schließt ab');
      assert.equal(moved.body.progress, 100);

      const reopened = await admin.patch(`/api/v1/tasks/${task.body.id}`, { status: 'open', bucket: 'doing' });
      assert.equal(reopened.body.status, 'open');
      assert.equal(reopened.body.completedAt, null);
      assert.equal(reopened.body.progress, 0, 'wieder geöffnet → Fortschritt zurückgesetzt');

      const forPage = await admin.get(`/api/v1/tasks?page=${pageId}`);
      assert.equal(forPage.body.items.length, 1);

      // Spalte „Erledigt“ und Status bleiben stimmig
      const inDone = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Schon erledigt', bucket: 'done' });
      assert.equal(inDone.body.status, 'done');
      assert.equal(inDone.body.progress, 100);
      assert.ok(inDone.body.completedAt);

      const ticked = await admin.patch(`/api/v1/tasks/${task.body.id}`, { status: 'done' });
      assert.equal(ticked.body.bucket, 'done', 'Abhaken verschiebt in die letzte Spalte');
      assert.equal(ticked.body.progress, 100);

      const unticked = await admin.patch(`/api/v1/tasks/${task.body.id}`, { status: 'open' });
      assert.equal(unticked.body.bucket, 'todo', 'Wieder öffnen holt die Karte aus „Erledigt“');

      const viaBucket = await admin.patch(`/api/v1/tasks/${task.body.id}`, { bucket: 'done', status: 'open' });
      assert.equal(viaBucket.body.status, 'done', 'Spaltenwechsel nach „Erledigt“ schließt ab');
      await admin.patch(`/api/v1/tasks/${task.body.id}`, { bucket: 'doing' });
    });

    await t.test('Aufgaben respektieren Bereichsrechte', async () => {
      const secret = await admin.post('/api/v1/spaces', { key: 'GEHEIM', name: 'Geheim', preset: 'private' });
      assert.equal(secret.status, 200);
      const board = await admin.post('/api/v1/spaces/GEHEIM/boards', { name: 'Intern' });
      const denied = await tom.get(`/api/v1/boards/${board.body.id}`);
      assert.ok([403, 404].includes(denied.status), `Status ${denied.status}`);
      const create = await tom.post(`/api/v1/boards/${board.body.id}/tasks`, { title: 'x' });
      assert.ok([403, 404].includes(create.status));
      const all = await tom.get('/api/v1/boards');
      assert.ok(!all.body.items.some((b: { spaceKey: string }) => b.spaceKey === 'GEHEIM'));
    });

    await t.test('Keine Interna über Aufgaben und KI', async () => {
      const secretPage = await admin.post('/api/v1/pages', { spaceKey: 'GEHEIM', title: 'Gehaltsliste 2027', content: '<p>vertraulich</p>' });
      assert.equal(secretPage.status, 200, secretPage.raw);

      // Aufgabe im sichtbaren Plan, verknüpft mit einer Seite, die Tom nicht sehen darf
      const linked = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Budget abstimmen', pageId: secretPage.body.id });
      assert.equal(linked.body.page.title, 'Gehaltsliste 2027');
      const seen = await tom.get(`/api/v1/boards/${boardId}`);
      const task = seen.body.tasks.find((x: { id: number }) => x.id === linked.body.id);
      assert.equal(task.page, null, 'Seitentitel bleibt verborgen');

      // Bearbeiten ohne pageId lässt die (unsichtbare) Verknüpfung stehen
      await admin.patch(`/api/v1/tasks/${linked.body.id}`, { priority: 'high' });
      const afterEdit = await admin.get(`/api/v1/boards/${boardId}`);
      assert.equal(afterEdit.body.tasks.find((x: { id: number }) => x.id === linked.body.id).page.id, secretPage.body.id);

      // Verantwortlich nur mit Zugriff auf den Bereich
      const secretBoard = await admin.post('/api/v1/spaces/GEHEIM/boards', { name: 'Personal' });
      const assign = await admin.post(`/api/v1/boards/${secretBoard.body.id}/tasks`, { title: 'Gespräch', assigneeId: tomId });
      assert.equal(assign.status, 400, assign.raw);
      const notes = await tom.get('/api/v1/me/notifications');
      assert.ok(!JSON.stringify(notes.body).includes('Gespräch'), 'keine Benachrichtigung aus fremden Bereichen');

      // KI: Seitenangabe wird auch mit mitgesendetem Text geprüft
      const groups = await admin.get('/api/v1/groups');
      const users = groups.body.find((g: { name: string }) => g.name === 'Benutzer');
      const detail = await admin.get(`/api/v1/admin/groups/${users.id}`);
      await admin.patch(`/api/v1/admin/groups/${users.id}`, { permissions: [...detail.body.group.permissions, 'ai.use'] });
      const sneaky = await tom.post('/api/v1/ai/run', { action: 'improve', text: 'Hallo', pageId: secretPage.body.id });
      assert.ok([403, 404].includes(sneaky.status), `Status ${sneaky.status}`);

      // KI-Nutzung taucht nicht im Aktivitätsfeed auf
      const feed = await admin.get('/api/v1/activity');
      assert.equal(feed.status, 200, feed.raw);
      assert.ok(feed.body.items.some((i: { type: string }) => i.type.startsWith('task.')), 'Feed enthält Planer-Ereignisse');
      assert.ok(!feed.body.items.some((i: { type: string }) => i.type === 'ai.used'), 'aber keine KI-Nutzung');
    });

    await t.test('Zwischenablage ist privat und bereinigt', async () => {
      const clip = await tom.post('/api/v1/clips', { content: '<p onclick="x()">Hallo <script>alert(1)</script><strong>Welt</strong></p>', sourcePageId: pageId });
      assert.equal(clip.status, 200, clip.raw);
      assert.ok(!clip.body.content.includes('script') && !clip.body.content.includes('onclick'));
      assert.equal(clip.body.source.id, pageId);

      const foreign = await admin.del(`/api/v1/clips/${clip.body.id}`);
      assert.equal(foreign.status, 404, 'fremde Einträge sind unsichtbar');
      assert.equal((await admin.get('/api/v1/clips')).body.items.length, 0);

      const pinned = await tom.patch(`/api/v1/clips/${clip.body.id}`, { pinned: true });
      assert.equal(pinned.status, 200);
      await tom.post('/api/v1/clips', { content: 'zweiter', kind: 'text' });
      const cleared = await tom.del('/api/v1/clips');
      assert.equal(cleared.body.removed, 1, 'angeheftete bleiben');

      assert.equal((await tom.post('/api/v1/clips', { content: 'javascript:alert(1)', kind: 'link' })).status, 400, 'gefährliche Link-Schemata');
      assert.equal((await tom.post('/api/v1/clips', { content: 'https://example.org/a', kind: 'link' })).status, 200);
    });

    await t.test('Spalten ändern verliert keine Karten', async () => {
      const board = await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Umbau' });
      const card = await admin.post(`/api/v1/boards/${board.body.id}/tasks`, { title: 'Karte in Prüfung', bucket: 'review' });
      assert.equal(card.body.bucket, 'review');
      const changed = await admin.patch(`/api/v1/boards/${board.body.id}`, {
        buckets: [
          { id: 'neu', name: 'Neu' },
          { id: 'neu', name: 'Doppelt' },
          { id: 'fertig', name: 'Fertig' },
        ],
      });
      assert.equal(changed.status, 200, changed.raw);
      assert.deepEqual(
        changed.body.buckets.map((b: { id: string }) => b.id),
        ['neu', 'neu-2', 'fertig'],
        'doppelte Kennungen werden eindeutig',
      );
      const tasks = await admin.get(`/api/v1/boards/${board.body.id}`);
      assert.equal(tasks.body.tasks.find((x: { id: number }) => x.id === card.body.id).bucket, 'neu', 'Karte wandert in die erste Spalte');
    });

    await t.test('Duplizieren', async () => {
      const dup = await admin.post(`/api/v1/pages/${pageId}/duplicate`, {});
      assert.equal(dup.status, 200, dup.raw);
      assert.equal(dup.body.title, 'Betriebshandbuch (Kopie)');
      assert.notEqual(dup.body.id, pageId);
      const original = await admin.get(`/api/v1/pages/${pageId}`);
      assert.equal(dup.body.parentId, original.body.parentId);
    });

    await t.test('Stichwörter umbenennen und zusammenführen', async () => {
      await admin.put(`/api/v1/pages/${pageId}/labels`, { labels: ['betrieb', 'backup'] });
      const denied = await tom.post('/api/v1/labels/rename', { from: 'backup', to: 'sicherung' });
      assert.equal(denied.status, 403);
      const renamed = await admin.post('/api/v1/labels/rename', { from: 'backup', to: 'sicherung' });
      assert.equal(renamed.status, 200, renamed.raw);
      assert.equal(renamed.body.merged, false);
      const merged = await admin.post('/api/v1/labels/rename', { from: 'sicherung', to: 'betrieb' });
      assert.equal(merged.body.merged, true);
      const page = await admin.get(`/api/v1/pages/${pageId}`);
      assert.deepEqual(page.body.labels, ['betrieb']);
    });

    await t.test('Handbuch aktualisieren', async () => {
      const tree = await admin.get('/api/v1/spaces/HANDBUCH/tree');
      assert.equal(tree.status, 200, tree.raw);
      const flat = JSON.stringify(tree.body);
      assert.ok(flat.includes('Aufgabenplaner') && flat.includes('KI-Assistent'), 'neue Kapitel beim Einrichten');
      const nodes = (tree.body.items ?? tree.body) as { id: number; title: string }[];
      const planner = nodes.find((n) => n.title === 'Aufgabenplaner')!;
      const editor = nodes.find((n) => n.title === 'Editor und Makros')!;

      // Ein Kapitel fehlt (gelöscht), ein anderes wurde von Hand angepasst
      assert.equal((await admin.del(`/api/v1/pages/${planner.id}`)).status, 200);
      const page = await admin.get(`/api/v1/pages/${editor.id}?render=false`);
      await admin.put(`/api/v1/pages/${editor.id}`, { content: `${page.body.content}<p>Unsere Hausregeln</p>`, changeNote: 'Eigene Ergänzung', baseVersion: page.body.version });

      assert.equal((await tom.post('/api/v1/admin/maintenance/sync-handbook', {})).status, 403);
      const sync = await admin.post('/api/v1/admin/maintenance/sync-handbook', {});
      assert.equal(sync.status, 200, sync.raw);
      assert.equal(sync.body.created, 1, 'fehlendes Kapitel wird neu angelegt');
      assert.ok(sync.body.skipped >= 1, 'von Hand geänderte Kapitel bleiben unangetastet');
      const kept = await admin.get(`/api/v1/pages/${editor.id}?render=false`);
      assert.match(kept.body.content, /Unsere Hausregeln/);

      const again = await admin.post('/api/v1/admin/maintenance/sync-handbook', {});
      assert.deepEqual([again.body.created, again.body.updated], [0, 0], 'zweiter Lauf ändert nichts');
    });

    await t.test('Vorschau: PDF direkt, Office nur mit LibreOffice', async () => {
      const pdf = '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF';
      const boundary = '----knowstead';
      const payload =
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="plan.pdf"\r\nContent-Type: application/pdf\r\n\r\n${pdf}\r\n` +
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="folien.pptx"\r\nContent-Type: application/octet-stream\r\n\r\nPK\r\n` +
        `--${boundary}--\r\n`;
      const upload = await admin.request('POST', `/api/v1/pages/${pageId}/attachments`, payload, { 'content-type': `multipart/form-data; boundary=${boundary}` });
      assert.equal(upload.status, 200, upload.raw);
      const pdfAtt = upload.body.find((a: { filename: string }) => a.filename === 'plan.pdf');
      const pptAtt = upload.body.find((a: { filename: string }) => a.filename === 'folien.pptx');
      assert.equal(pdfAtt.preview, 'pdf');
      assert.equal(pptAtt.preview, null, 'ohne LibreOffice keine Office-Vorschau');

      const preview = await admin.get(`/api/v1/attachments/${pdfAtt.id}/preview`);
      assert.equal(preview.status, 200);
      assert.equal(preview.headers['content-type'], 'application/pdf');
      assert.match(String(preview.headers['content-security-policy']), /sandbox/);

      const office = await admin.get(`/api/v1/attachments/${pptAtt.id}/preview`);
      assert.equal(office.status, 501, office.raw);

      const stranger = await tom.get(`/api/v1/attachments/${pdfAtt.id}/preview`);
      assert.equal(stranger.status, 200, 'Team-Bereich ist offen – Lesen erlaubt');
    });
  } finally {
    provider.server.close();
    await ctx.close();
  }
});
