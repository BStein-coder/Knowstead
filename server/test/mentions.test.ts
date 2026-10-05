import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/**
 * Erwähnungen (@Name) im Zusammenhang: Suche für das Vorschlagsmenü (Beteiligte zuerst, Zugriff gekennzeichnet,
 * Umlaute), Rückmeldung an die Verfasserin, wenn eine Erwähnung niemanden erreicht, und Benachrichtigung von
 * Personen, die erst beim Bearbeiten erwähnt werden – im Chat einer Aufgabe und in Seitenkommentaren.
 */
test('Erwähnungen im Zusammenhang', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const mia = new Client(ctx.app);
  const jonas = new Client(ctx.app);
  const oezlem = new Client(ctx.app);
  const ids: Record<string, number> = {};
  let openTask = 0;
  let privateTask = 0;
  let openBoard = 0;
  let privatePage = 0;
  let openPage = 0;

  const mention = (id: number, name: string) => `<span data-type="mention" data-id="${id}" data-label="${name}">@${name}</span>`;
  type Found = { id: number; username: string; displayName: string; access?: boolean; involved?: boolean };
  const search = async (client: Client, query: string) => {
    const res = await client.get(`/api/v1/users/search${query}`);
    assert.equal(res.status, 200, res.raw);
    return res.body as Found[];
  };
  const names = (list: Found[]) => list.map((u) => u.username);
  type Notification = { type: string; title: string; link: string };
  const inbox = async (client: Client) => ((await client.get('/api/v1/me/notifications')).body.items ?? []) as Notification[];
  /** Benachrichtigungen entstehen kurz nach dem Ereignis – auf die erwartete Anzahl warten. */
  const waitFor = async (client: Client, match: (n: Notification) => boolean, count: number) => {
    let found: Notification[] = [];
    for (let i = 0; i < 100; i++) {
      found = (await inbox(client)).filter(match);
      if (found.length >= count) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return found;
  };
  /** Zeit lassen, damit eine Benachrichtigung, die es nicht geben darf, auch wirklich auffiele. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 250));

  try {
    await t.test('Einrichtung: offener und privater Bereich, je eine Aufgabe und eine Seite', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada Admin', password: 'geheim-geheim', sampleContent: false })).status, 200);
      ids.admin = (await admin.get('/api/v1/auth/me')).body.user.id;
      for (const [username, displayName, client] of [
        ['mia', 'Mia Mitglied', mia],
        ['jonas', 'Jonas Keller', jonas],
        ['oezlem', 'Özlem Ünal', oezlem],
        ['tom', 'Tom Berg', null],
        ['prozent', '100% Müller', null],
        ['zora', 'Zora Zuletzt', null],
      ] as const) {
        const res = await admin.post('/api/v1/admin/users', { username, displayName, password: 'geheim-geheim', email: `${username}@example.com` });
        assert.equal(res.status, 200, res.raw);
        ids[username] = res.body.id;
        if (client) assert.equal((await client.post('/api/v1/auth/login', { login: username, password: 'geheim-geheim' })).status, 200);
      }
      assert.equal((await admin.post('/api/v1/spaces', { key: 'OFFEN', name: 'Offen', preset: 'open' })).status, 200);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'PRIV', name: 'Privat', preset: 'private' })).status, 200);
      const grants = (await admin.get('/api/v1/spaces/PRIV/permissions')).body as { subjectType: string; subjectId: number; role: string }[];
      assert.equal((await admin.put('/api/v1/spaces/PRIV/permissions', { grants: [...grants, { subjectType: 'user', subjectId: ids.mia, role: 'editor' }] })).status, 200);

      openBoard = (await admin.post('/api/v1/spaces/OFFEN/boards', { name: 'Plan' })).body.id;
      const task = await admin.post(`/api/v1/boards/${openBoard}/tasks`, { title: 'Switch tauschen', assigneeId: ids.zora });
      assert.equal(task.status, 200, task.raw);
      openTask = task.body.id;
      const privateBoard = (await admin.post('/api/v1/spaces/PRIV/boards', { name: 'Vertraulich' })).body.id;
      privateTask = (await admin.post(`/api/v1/boards/${privateBoard}/tasks`, { title: 'Geheime Abstimmung' })).body.id;
      openPage = (await admin.post('/api/v1/pages', { spaceKey: 'OFFEN', title: 'Offene Seite', content: '<p>Inhalt</p>' })).body.id;
      privatePage = (await admin.post('/api/v1/pages', { spaceKey: 'PRIV', title: 'Geheime Seite', content: '<p>Inhalt</p>' })).body.id;
      assert.ok(openTask && privateTask && openPage && privatePage);
    });

    await t.test('Suche ohne Suchtext: alle nach Namen – auch wer kein „a“ im Namen trägt', async () => {
      const all = await search(mia, '?limit=20');
      assert.deepEqual(names(all), ['prozent', 'admin', 'jonas', 'mia', 'oezlem', 'tom', 'zora'], '„Özlem“ steht bei O, nicht hinter Z');
      assert.ok(!('access' in all[0]), 'ohne Zusammenhang keine Angabe zum Zugriff');
      assert.equal((await search(mia, '?q=&limit=3')).length, 3, 'leeres q ist erlaubt');
    });

    await t.test('Suche mit Umlauten: klein getippt findet groß Geschriebenes', async () => {
      assert.deepEqual(names(await search(mia, `?q=${encodeURIComponent('öz')}`)), ['oezlem']);
      assert.deepEqual(names(await search(mia, `?q=${encodeURIComponent('ÖZL')}`)), ['oezlem']);
      assert.deepEqual(names(await search(mia, `?q=${encodeURIComponent('ünal')}`)), ['oezlem']);
      assert.deepEqual(names(await search(mia, `?q=${encodeURIComponent('müll')}`)), ['prozent']);
      assert.deepEqual(names(await search(mia, '?q=JON')), ['jonas'], 'ASCII weiterhin ohne Rücksicht auf Groß- und Kleinschreibung');
    });

    await t.test('Prozent und Unterstrich im Suchtext sind Text, keine Platzhalter', async () => {
      assert.deepEqual(names(await search(mia, `?q=${encodeURIComponent('%')}`)), ['prozent']);
      assert.deepEqual(names(await search(mia, `?q=${encodeURIComponent('0%')}`)), ['prozent']);
      assert.deepEqual(names(await search(mia, `?q=${encodeURIComponent('_')}`)), []);
      assert.deepEqual(names(await search(mia, `?q=${encodeURIComponent('!')}`)), []);
    });

    await t.test('Treffer am Namensanfang stehen vor Treffern in der Mitte', async () => {
      assert.deepEqual(names(await search(mia, '?q=mi')), ['mia', 'admin'], '„Mia Mitglied“ vor „Ada Admin“');
    });

    await t.test('Zusammenhang Aufgabe: Beteiligte zuerst, Zugriff je Person', async () => {
      const list = await search(mia, `?task=${openTask}&limit=20`);
      assert.deepEqual(names(list).slice(0, 2), ['zora', 'admin'], 'Verantwortliche, dann wer die Aufgabe angelegt hat');
      assert.deepEqual(list.filter((u) => u.involved).map((u) => u.username), ['zora', 'admin']);
      assert.ok(list.every((u) => u.access === true), 'im offenen Bereich haben alle Zugriff');

      // Wer im Chat schreibt, gehört zum Gespräch
      assert.equal((await jonas.post(`/api/v1/tasks/${openTask}/comments`, { body: '<p>Ich bin dabei.</p>' })).status, 200);
      assert.deepEqual(names(await search(mia, `?task=${openTask}&limit=20`)).slice(0, 3), ['zora', 'admin', 'jonas']);
      // Beteiligte stehen nur vorn, wenn sie zum Suchtext passen
      assert.deepEqual(names(await search(mia, `?task=${openTask}&q=tom`)), ['tom']);
      assert.deepEqual(names(await search(mia, `?task=${openTask}&q=z`)).slice(0, 1), ['zora']);
    });

    await t.test('Zusammenhang privater Bereich: wer keinen Zugriff hat, ist gekennzeichnet', async () => {
      const list = await search(admin, `?task=${privateTask}&limit=20`);
      const access = Object.fromEntries(list.map((u) => [u.username, u.access]));
      assert.equal(access.mia, true);
      assert.equal(access.admin, true);
      assert.equal(access.jonas, false);
      assert.equal(access.tom, false);
      const forPage = Object.fromEntries((await search(admin, `?page=${privatePage}&limit=20`)).map((u) => [u.username, u.access]));
      assert.equal(forPage.mia, true);
      assert.equal(forPage.jonas, false);
    });

    await t.test('kein Leck: Wer den Ort nicht sehen darf, bekommt die einfache Liste ohne Zusammenhang', async () => {
      for (const query of [`?task=${privateTask}`, `?page=${privatePage}`, '?task=99999', '?page=99999']) {
        const list = await search(jonas, `${query}&limit=20`);
        assert.ok(list.length > 0);
        assert.ok(list.every((u) => !('access' in u) && !('involved' in u)), `${query}: keine Angaben zu Zugriff oder Beteiligung`);
        assert.equal(list[0].username, 'prozent', `${query}: Reihenfolge wie ohne Zusammenhang`);
      }
      assert.equal((await new Client(ctx.app).get('/api/v1/users/search?q=a')).status, 401, 'nur angemeldet');
    });

    await t.test('Chat: Erwähnung ohne Zugriff erreicht niemanden – die Verfasserin erfährt es', async () => {
      const res = await admin.post(`/api/v1/tasks/${privateTask}/comments`, {
        body: `<p>${mention(ids.jonas, 'Jonas Keller')} und ${mention(ids.mia, 'Mia Mitglied')} und ich selbst ${mention(ids.admin, 'Ada Admin')}</p>`,
      });
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual(res.body.notNotified.map((u: Found) => u.username), ['jonas'], 'nur Jonas – Mia hat Zugriff, die Verfasserin zählt nicht');
      assert.equal((await waitFor(mia, (n) => n.type === 'mention' && n.title.includes('Geheime Abstimmung'), 1)).length, 1);
      await settle();
      assert.ok(!(await inbox(jonas)).some((n) => JSON.stringify(n).includes('Geheime')), 'Jonas erfährt nichts über die Aufgabe');
      assert.ok(!(await inbox(admin)).some((n) => n.title.includes('Geheime Abstimmung')), 'keine Benachrichtigung an sich selbst');
      // Die Liste der Nachrichten trägt das Feld nicht – es gehört nur zur Antwort auf das Schreiben
      const listed = (await admin.get(`/api/v1/tasks/${privateTask}/comments`)).body.items;
      assert.ok(!('notNotified' in listed[0]));
    });

    await t.test('Chat: deaktivierte Konten gelten als nicht erreicht und fehlen im Menü', async () => {
      assert.equal((await admin.post(`/api/v1/admin/users/${ids.tom}/status`, { status: 'disabled' })).status, 200);
      const res = await admin.post(`/api/v1/tasks/${openTask}/comments`, { body: `<p>${mention(ids.tom, 'Tom Berg')} bitte melden</p>` });
      assert.equal(res.status, 200, res.raw);
      assert.deepEqual(res.body.notNotified.map((u: Found) => u.username), ['tom']);
      assert.ok(!names(await search(mia, '?limit=20')).includes('tom'));
      assert.equal((await admin.post(`/api/v1/admin/users/${ids.tom}/status`, { status: 'active' })).status, 200);
    });

    await t.test('Chat bearbeiten: nur neu Erwähnte werden benachrichtigt', async () => {
      const first = await admin.post(`/api/v1/tasks/${openTask}/comments`, { body: `<p>${mention(ids.mia, 'Mia Mitglied')} schau bitte</p>` });
      assert.equal(first.status, 200, first.raw);
      assert.deepEqual(first.body.notNotified, []);
      const forThisTask = (n: Notification) => n.link.endsWith(`task=${openTask}`) && n.type === 'mention';
      assert.equal((await waitFor(mia, forThisTask, 1)).length, 1);

      const edited = await admin.patch(`/api/v1/task-comments/${first.body.id}`, {
        body: `<p>${mention(ids.mia, 'Mia Mitglied')} und ${mention(ids.oezlem, 'Özlem Ünal')} schaut bitte</p>`,
      });
      assert.equal(edited.status, 200, edited.raw);
      assert.equal(edited.body.edited, true);
      assert.deepEqual(edited.body.notNotified, []);
      const forOezlem = await waitFor(oezlem, forThisTask, 1);
      assert.equal(forOezlem.length, 1, 'Özlem wurde erst beim Bearbeiten erwähnt');
      assert.equal(forOezlem[0].title, 'Ada Admin hat dich in der Aufgabe „Switch tauschen“ erwähnt');
      await settle();
      assert.equal((await inbox(mia)).filter(forThisTask).length, 1, 'Mia war schon erwähnt – keine zweite Benachrichtigung');
      // Beteiligte (Verantwortliche, Mitschreibende) erfahren vom Bearbeiten nichts
      const jonasBefore = (await inbox(jonas)).length;
      const again = await admin.patch(`/api/v1/task-comments/${first.body.id}`, { body: `<p>${mention(ids.mia, 'Mia Mitglied')} und ${mention(ids.oezlem, 'Özlem Ünal')} – erledigt</p>` });
      assert.equal(again.status, 200);
      await settle();
      assert.equal((await inbox(jonas)).length, jonasBefore);
      assert.equal((await inbox(oezlem)).filter(forThisTask).length, 1, 'ohne neue Erwähnung keine neue Benachrichtigung');
    });

    await t.test('Seitenkommentare: Rückmeldung und Benachrichtigung beim Bearbeiten wie im Chat', async () => {
      const hidden = await admin.post(`/api/v1/pages/${privatePage}/comments`, { body: `<p>${mention(ids.jonas, 'Jonas Keller')} siehe oben</p>` });
      assert.equal(hidden.status, 200, hidden.raw);
      assert.deepEqual(hidden.body.notNotified.map((u: Found) => u.username), ['jonas']);

      const comment = await admin.post(`/api/v1/pages/${openPage}/comments`, { body: '<p>Erster Stand</p>' });
      assert.equal(comment.status, 200, comment.raw);
      assert.deepEqual(comment.body.notNotified, []);
      const edited = await admin.patch(`/api/v1/comments/${comment.body.id}`, { body: `<p>Erster Stand – ${mention(ids.jonas, 'Jonas Keller')} bitte prüfen</p>` });
      assert.equal(edited.status, 200, edited.raw);
      assert.deepEqual(edited.body.notNotified, []);
      const forJonas = await waitFor(jonas, (n) => n.type === 'mention' && n.title.includes('Offene Seite'), 1);
      assert.equal(forJonas.length, 1, 'beim Bearbeiten erwähnt – benachrichtigt');
      assert.equal(forJonas[0].title, 'Ada Admin hat dich in einem Kommentar zu „Offene Seite“ erwähnt');
      assert.match(forJonas[0].link, new RegExp(`#comment-${comment.body.id}$`));
      await settle();
      assert.ok(!(await inbox(jonas)).some((n) => JSON.stringify(n).includes('Geheime Seite')), 'vom Kommentar auf der privaten Seite erfährt Jonas nichts');

      const privateEdit = await admin.patch(`/api/v1/comments/${hidden.body.id}`, { body: `<p>${mention(ids.jonas, 'Jonas Keller')} und ${mention(ids.oezlem, 'Özlem Ünal')}</p>` });
      assert.equal(privateEdit.status, 200);
      assert.deepEqual(privateEdit.body.notNotified.map((u: Found) => u.username), ['oezlem'], 'nur die neu Erwähnte – Jonas wurde schon beim Anlegen gemeldet');
    });
  } finally {
    await ctx.close();
  }
});
