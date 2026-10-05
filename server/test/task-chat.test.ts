import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/**
 * Chat je Aufgabe: Nachrichten mit @-Erwähnungen, Rechte ab „Kommentieren“, Benachrichtigungen an
 * Erwähnte, Verantwortliche und Mitschreibende, Zähler auf der Karte und im CSV, Papierkorb.
 */
test('Chat je Aufgabe', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app); // Bearbeiter
  const cora = new Client(ctx.app); // darf nur kommentieren
  const eva = new Client(ctx.app); // darf nur lesen, ist aber verantwortlich
  const ids: Record<string, number> = {};
  let boardId = 0;
  let taskId = 0;
  let firstMessage = 0;
  let corasMessage = 0;

  const mention = (id: number, name: string) => `<span data-type="mention" data-id="${id}" data-label="${name}">@${name}</span>`;
  const messages = async (client: Client) => {
    const res = await client.get(`/api/v1/tasks/${taskId}/comments`);
    return { status: res.status, items: (res.body.items ?? []) as { id: number; body: string; author: { username: string } | null; edited: boolean; can: { edit: boolean; delete: boolean } }[] };
  };
  // Benachrichtigungen entstehen kurz nach dem Ereignis – darauf warten
  const notified = async (client: Client, needle: string) => {
    for (let i = 0; i < 100; i++) {
      const res = await client.get('/api/v1/me/notifications');
      if (JSON.stringify(res.body.items).includes(needle)) return res.body.items as { type: string; title: string; body: string; link: string }[];
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return null;
  };

  try {
    await t.test('Einrichtung: Bereich mit drei Rollen', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
      for (const [name, display, client] of [['tom', 'Tom', tom], ['cora', 'Cora', cora], ['eva', 'Eva', eva]] as const) {
        const res = await admin.post('/api/v1/admin/users', { username: name, displayName: display, password: 'geheim-geheim', email: `${name}@example.com` });
        assert.equal(res.status, 200, res.raw);
        ids[name] = res.body.id;
        assert.equal((await client.post('/api/v1/auth/login', { login: name, password: 'geheim-geheim' })).status, 200);
      }
      // „readonly“: alle Angemeldeten lesen; Tom bearbeitet, Cora kommentiert
      assert.equal((await admin.post('/api/v1/spaces', { key: 'PROJ', name: 'Projekt', preset: 'readonly' })).status, 200);
      const grants = (await admin.get('/api/v1/spaces/PROJ/permissions')).body as { subjectType: string; subjectId: number; role: string }[];
      const put = await admin.put('/api/v1/spaces/PROJ/permissions', {
        grants: [...grants, { subjectType: 'user', subjectId: ids.tom, role: 'editor' }, { subjectType: 'user', subjectId: ids.cora, role: 'commenter' }],
      });
      assert.equal(put.status, 200, put.raw);
      boardId = (await tom.post('/api/v1/spaces/PROJ/boards', { name: 'Umbau' })).body.id;
      const task = await tom.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Verkabelung planen', notes: 'Beschreibung der Aufgabe', assigneeId: ids.eva });
      assert.equal(task.status, 200, task.raw);
      taskId = task.body.id;
      assert.equal(task.body.commentCount, 0);
      const board = (await tom.get(`/api/v1/boards/${boardId}`)).body;
      assert.equal(board.board.canComment, true);
      assert.equal((await eva.get(`/api/v1/boards/${boardId}`)).body.board.canComment, false, 'Leserin darf nicht schreiben');
      assert.equal((await cora.get(`/api/v1/boards/${boardId}`)).body.board.canComment, true);
      assert.equal((await cora.get(`/api/v1/boards/${boardId}`)).body.board.canEdit, false);
    });

    await t.test('Nachricht mit Erwähnung: Erwähnte und Verantwortliche werden benachrichtigt, der Absender nicht', async () => {
      const res = await tom.post(`/api/v1/tasks/${taskId}/comments`, { body: `<p>Bitte prüfen, ${mention(ids.cora, 'Cora')} – Ist der Plan aktuell?</p>` });
      assert.equal(res.status, 200, res.raw);
      firstMessage = res.body.id;
      assert.equal(res.body.author.username, 'tom');
      assert.equal(res.body.edited, false);
      assert.deepEqual(res.body.can, { edit: true, delete: true });

      const forCora = await notified(cora, 'erwähnt');
      assert.ok(forCora, 'Cora wurde als Erwähnte benachrichtigt');
      const m = forCora.find((n) => n.type === 'mention')!;
      assert.equal(m.title, 'Tom hat dich in der Aufgabe „Verkabelung planen“ erwähnt');
      assert.match(m.body, /Ist der Plan aktuell/);
      assert.equal(m.link, `/s/PROJ/tasks?board=${boardId}&task=${taskId}`);

      const forEva = await notified(eva, 'geschrieben');
      assert.ok(forEva, 'Eva ist verantwortlich und wird informiert');
      assert.equal(forEva.find((n) => n.type === 'task.commented')!.title, 'Tom hat in der Aufgabe „Verkabelung planen“ geschrieben');

      const forTom = (await tom.get('/api/v1/me/notifications')).body.items as { title: string }[];
      assert.ok(!forTom.some((n) => n.title.includes('Verkabelung planen')), 'keine Benachrichtigung an den Absender');
    });

    await t.test('Rechte: Kommentieren genügt zum Schreiben, Lesen genügt nur zum Mitlesen', async () => {
      const res = await cora.post(`/api/v1/tasks/${taskId}/comments`, { body: '<p>Ja, Stand von gestern.</p>' });
      assert.equal(res.status, 200, res.raw);
      corasMessage = res.body.id;
      assert.equal((await cora.patch(`/api/v1/tasks/${taskId}`, { title: 'geändert' })).status, 403, 'Cora darf die Aufgabe nicht bearbeiten');

      const eviews = await messages(eva);
      assert.equal(eviews.status, 200, 'Leserin liest mit');
      assert.deepEqual(eviews.items.map((m) => m.can), [{ edit: false, delete: false }, { edit: false, delete: false }]);
      assert.equal((await eva.post(`/api/v1/tasks/${taskId}/comments`, { body: '<p>Darf ich?</p>' })).status, 403);

      const anonymous = new Client(ctx.app);
      assert.equal((await anonymous.get(`/api/v1/tasks/${taskId}/comments`)).status, 401);

      // Tom schreibt erneut – Cora hat mitgeschrieben und ist jetzt Teil des Gesprächs
      await tom.post(`/api/v1/tasks/${taskId}/comments`, { body: '<p>Danke!</p>' });
      const again = await notified(cora, 'geschrieben');
      assert.ok(again?.some((n) => n.type === 'task.commented'), 'Mitschreibende werden über neue Nachrichten informiert');
    });

    await t.test('Bearbeiten nur eigene; löschen eigene oder als Bereichsverwaltung', async () => {
      assert.equal((await cora.patch(`/api/v1/task-comments/${firstMessage}`, { body: '<p>fremd</p>' })).status, 403);
      const own = await cora.patch(`/api/v1/task-comments/${corasMessage}`, { body: '<p>Ja, Stand von heute.</p>' });
      assert.equal(own.status, 200, own.raw);
      assert.equal(own.body.edited, true);
      assert.match((await messages(tom)).items.find((m) => m.id === corasMessage)!.body, /heute/);

      assert.equal((await cora.del(`/api/v1/task-comments/${firstMessage}`)).status, 403, 'fremde Nachricht');
      assert.equal((await admin.del(`/api/v1/task-comments/${corasMessage}`)).status, 200, 'Bereichsverwaltung darf löschen');
      assert.ok(!(await messages(tom)).items.some((m) => m.id === corasMessage), 'gelöschte Nachricht ist weg');
      assert.equal((await cora.patch(`/api/v1/task-comments/${corasMessage}`, { body: '<p>x</p>' })).status, 404);
    });

    await t.test('Eingaben: leer abgelehnt, Skripte entfernt, Erwähnung bleibt', async () => {
      assert.equal((await tom.post(`/api/v1/tasks/${taskId}/comments`, { body: '<p>   </p>' })).status, 400);
      const res = await tom.post(`/api/v1/tasks/${taskId}/comments`, { body: `<p onclick="x()">Hallo ${mention(ids.eva, 'Eva')}<script>alert(1)</script><img src=x onerror=alert(1)></p>` });
      assert.equal(res.status, 200, res.raw);
      assert.ok(!/script|onerror|onclick/.test(res.body.body), res.body.body);
      assert.match(res.body.body, /data-type="mention"/);
      assert.ok(await notified(eva, 'erwähnt'));
    });

    await t.test('Zähler auf der Karte und im CSV', async () => {
      const board = (await tom.get(`/api/v1/boards/${boardId}`)).body;
      const task = board.tasks.find((x: { id: number }) => x.id === taskId);
      assert.equal(task.commentCount, 3, 'drei Nachrichten übrig (eine gelöscht)');
      const csv = await tom.get(`/api/v1/boards/${boardId}/export.csv`);
      assert.equal(csv.status, 200);
      const lines = csv.raw.replace(new RegExp("^" + String.fromCharCode(0xfeff)), '').trim().split('\r\n');
      assert.match(lines[0], /;Beschreibung;Nachrichten$/);
      assert.match(lines[1], /;Beschreibung der Aufgabe;3$/);
    });

    await t.test('Ungelesen-Zeichen: zählt Nachrichten anderer seit dem letzten Öffnen des Chats', async () => {
      const fresh = (await tom.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Abnahme vorbereiten' })).body as { id: number; unreadComments: number };
      assert.equal(fresh.unreadComments, 0);
      const card = async (client: Client) =>
        ((await client.get(`/api/v1/boards/${boardId}`)).body.tasks as { id: number; commentCount: number; unreadComments: number }[]).find((x) => x.id === fresh.id)!;
      const write = async (client: Client, text: string) => assert.equal((await client.post(`/api/v1/tasks/${fresh.id}/comments`, { body: `<p>${text}</p>` })).status, 200);

      await write(tom, 'Termin steht');
      await write(tom, 'Protokoll folgt');
      const own = await card(tom);
      assert.deepEqual([own.commentCount, own.unreadComments], [2, 0], 'eigene Nachrichten sind nie ungelesen');
      assert.equal((await card(cora)).unreadComments, 2);
      assert.equal((await card(eva)).unreadComments, 2, 'auch wer nur lesen darf, sieht das Zeichen');

      // Cora öffnet den Chat
      assert.equal((await cora.post(`/api/v1/tasks/${fresh.id}/comments/read`, {})).status, 200);
      assert.equal((await card(cora)).unreadComments, 0);
      assert.equal((await card(eva)).unreadComments, 2, 'der Lesestand gilt je Person');

      // Cora antwortet: für Tom ungelesen, für sie selbst nicht
      await write(cora, 'Bin dabei');
      assert.equal((await card(tom)).unreadComments, 1);
      assert.equal((await card(cora)).unreadComments, 0);
      // Die Liste über alle Pläne („Meine Aufgaben“) liefert denselben Stand wie der Plan
      const listed = ((await tom.get(`/api/v1/tasks?board=${boardId}`)).body.items as { id: number; unreadComments: number }[]).find((x) => x.id === fresh.id);
      assert.equal(listed?.unreadComments, 1);

      // Wer antwortet, hat das Gespräch vor sich
      await write(tom, 'Danke');
      assert.equal((await card(tom)).unreadComments, 0, 'mit der eigenen Antwort gilt der Chat als gelesen');
      assert.equal((await card(cora)).unreadComments, 1);

      // Gelöschte Nachrichten zählen nicht
      const items = (await tom.get(`/api/v1/tasks/${fresh.id}/comments`)).body.items as { id: number }[];
      await tom.del(`/api/v1/task-comments/${items.at(-1)!.id}`);
      assert.equal((await card(cora)).unreadComments, 0);

      assert.equal((await new Client(ctx.app).post(`/api/v1/tasks/${fresh.id}/comments/read`, {})).status, 401, 'ohne Anmeldung kein Lesestand');
      assert.equal((await tom.post('/api/v1/tasks/999999/comments/read', {})).status, 404);
    });

    await t.test('Papierkorb: im Papierkorb kein Chat, nach dem Wiederherstellen alles da, endgültig weg beim Leeren', async () => {
      assert.equal((await tom.del(`/api/v1/tasks/${taskId}`)).status, 200);
      assert.equal((await messages(tom)).status, 404);
      assert.equal((await tom.post(`/api/v1/tasks/${taskId}/comments`, { body: '<p>x</p>' })).status, 404);
      assert.equal((await tom.post(`/api/v1/tasks/${taskId}/restore`)).status, 200);
      assert.equal((await messages(tom)).items.length, 3);
      await tom.del(`/api/v1/tasks/${taskId}`);
      assert.equal((await admin.del(`/api/v1/tasks/${taskId}/purge`)).status, 200);
      assert.equal(ctx.s.db.value<number>('SELECT COUNT(*) FROM task_comments WHERE task_id = ?', taskId), 0, 'Fremdschlüssel räumt mit');
    });
  } finally {
    await ctx.close();
  }
});

test('Update auf den durchsuchbaren Chat (Migration 024): Text nachgetragen, Bestand gilt als gelesen', async () => {
  let ctx = await createTestApp();
  const dir = ctx.dir;
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
    const userId = (await admin.post('/api/v1/admin/users', { username: 'lena', displayName: 'Lena', password: 'geheim-geheim' })).body.id as number;
    assert.ok(userId);
    const boardId = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Umzug' })).body.id as number;
    const taskId = (await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Kartons bestellen' })).body.id as number;
    await admin.post(`/api/v1/tasks/${taskId}/comments`, { body: '<p>Bitte <strong>hundert</strong> Stück &amp; Klebeband</p>' });
    await admin.post(`/api/v1/tasks/${taskId}/comments`, { body: '<p>Lieferung am Montag</p>' });

    // Zurück auf den Stand vor der Migration: Spalte, Tabelle, Merker und Eintrag der Migration entfernen
    const db = ctx.s.db;
    db.exec(`
      DROP TABLE task_comment_reads;
      ALTER TABLE task_comments DROP COLUMN body_text;
      DELETE FROM settings WHERE key = 'internal:taskChat:unreadBaseline';
      DELETE FROM schema_migrations WHERE version = 24;
    `);
    await ctx.close({ keepDir: true });

    // Neustart mit dem aktuellen Programm: Die Migration läuft über die vorhandenen Nachrichten
    ctx = await createTestApp({ dir });
    const texts = ctx.s.db.all<{ body_text: string }>('SELECT body_text FROM task_comments ORDER BY id').map((r) => r.body_text);
    assert.deepEqual(texts, ['Bitte hundert Stück & Klebeband', 'Lieferung am Montag']);
    const newest = ctx.s.db.value<number>('SELECT MAX(id) FROM task_comments');
    assert.equal(ctx.s.settings.getInternal('taskChat:unreadBaseline', -1), newest);

    const lena = new Client(ctx.app);
    assert.equal((await lena.post('/api/v1/auth/login', { login: 'lena', password: 'geheim-geheim' })).status, 200);
    const card = async () => ((await lena.get(`/api/v1/boards/${boardId}`)).body.tasks as { id: number; commentCount: number; unreadComments: number }[]).find((x) => x.id === taskId)!;
    assert.deepEqual([(await card()).commentCount, (await card()).unreadComments], [2, 0], 'was vor dem Update geschrieben wurde, ist nicht „neu“');
    assert.equal(((await lena.get('/api/v1/search?q=klebeband')).body.tasks as { id: number }[])[0]?.id, taskId, 'Bestand ist durchsuchbar');

    const again = new Client(ctx.app);
    assert.equal((await again.post('/api/v1/auth/login', { login: 'admin', password: 'geheim-geheim' })).status, 200);
    await again.post(`/api/v1/tasks/${taskId}/comments`, { body: '<p>Montag passt</p>' });
    assert.equal((await card()).unreadComments, 1, 'neue Nachrichten zählen');
  } finally {
    await ctx.close();
  }
});
