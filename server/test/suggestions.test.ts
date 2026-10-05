import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';
import { acceptAllSuggestions, collectSuggestions, rejectAllSuggestions } from '../src/modules/pages/suggestions.ts';

test('Vorschlagsmodus: Änderungen vorschlagen, annehmen, ablehnen', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const c: Record<string, Client> = {};
  const ids: Record<string, number> = {};
  let pageId = 0;

  const page = async (name = 'autor') => (await c[name].get(`/api/v1/pages/${pageId}?render=true`)).body;
  const publish = async (name: string, content: string, title = 'Richtlinie') => {
    const current = await page(name);
    return c[name].put(`/api/v1/pages/${pageId}`, { title, content, baseVersion: current.version });
  };
  /**
    * Findet die Suche DIESE Seite? Die Gesamtzahl taugt dafür nicht: Dieselben Wörter stehen auch im
    * mitgelieferten Handbuch, und dann zählt die Suche Treffer mit, die nichts mit dem Test zu tun haben.
    */
  const findetSeite = async (q: string, name = 'leser') => {
    const res = await c[name].get(`/api/v1/search?q=${encodeURIComponent(q)}`);
    assert.equal(res.status, 200, res.raw);
    return (res.body.items as { id: number }[]).some((hit) => hit.id === pageId);
  };
  const ins = (sid: string, text: string, author = 0, name = 'Wer auch immer') => `<ins data-suggestion="insert" data-sid="${sid}" data-author="${author}" data-author-name="${name}">${text}</ins>`;
  const del = (sid: string, text: string) => `<del data-suggestion="delete" data-sid="${sid}" data-author="0">${text}</del>`;

  try {
    await t.test('Hilfsfunktionen', () => {
      const html = `<p>Hallo ${del('a', 'alte')}${ins('a', 'neue')} Welt</p>`;
      assert.equal(rejectAllSuggestions(html), '<p>Hallo alte Welt</p>');
      assert.equal(acceptAllSuggestions(html), '<p>Hallo neue Welt</p>');
      assert.deepEqual(collectSuggestions(html).map((s) => [s.sid, s.deleted, s.inserted]), [['a', 'alte', 'neue']]);
    });

    await t.test('Einrichtung', async () => {
      await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
      c.admin = admin;
      for (const name of ['autor', 'lektor', 'zweiter', 'leser']) {
        ids[name] = (await admin.post('/api/v1/admin/users', { username: name, displayName: name[0].toUpperCase() + name.slice(1), password: 'geheim-geheim' })).body.id;
        c[name] = new Client(ctx.app);
        await c[name].post('/api/v1/auth/login', { login: name, password: 'geheim-geheim' });
      }
      await admin.post('/api/v1/spaces', { key: 'VM', name: 'Vorschläge', preset: 'open' });
      pageId = (await c.autor.post('/api/v1/pages', { spaceKey: 'VM', title: 'Richtlinie', content: '<p>Bitte Türen schließen.</p>' })).body.id;
    });

    await t.test('Modus: Autor stellt ein, andere nicht', async () => {
      assert.equal((await c.lektor.put(`/api/v1/pages/${pageId}/edit-mode`, { mode: 'suggest' })).status, 403);
      const res = await c.autor.put(`/api/v1/pages/${pageId}/edit-mode`, { mode: 'suggest' });
      assert.equal(res.status, 200, res.raw);
      assert.equal(res.body.mode, 'suggest');
      const lektorView = (await page('lektor')).editMode;
      assert.deepEqual([lektorView.forced, lektorView.canResolve, lektorView.canChange], [true, false, false]);
      assert.equal((await page('autor')).editMode.forced, false);
    });

    await t.test('Direkte Änderungen und Titeländerungen werden abgelehnt', async () => {
      const direct = await publish('lektor', '<p>Bitte Fenster schließen.</p>');
      assert.equal(direct.status, 403);
      assert.match(direct.body.error.message, /nur Vorschläge/);
      assert.equal((await publish('lektor', '<p>Bitte Türen schließen.</p>', 'Neuer Titel')).status, 403);
    });

    await t.test('Vorschlag wird gespeichert und der richtigen Person zugeordnet', async () => {
      // Gefälschte Autorschaft (Autor) wird vom Server korrigiert
      const res = await publish('lektor', `<p>Bitte ${del('s1', 'Türen')}${ins('s1', 'Fenster und Türen', ids.autor, 'Autor')} schließen.</p>`);
      assert.equal(res.status, 200, res.raw);
      const view = await page('lektor');
      assert.equal(view.editMode.pending, 1);
      const [suggestion] = collectSuggestions(view.content);
      assert.equal(suggestion.author, ids.lektor);
      assert.equal(suggestion.authorName, 'Lektor');
      assert.ok(suggestion.at);

      // Lesende und Suche sehen den bisherigen Text
      assert.equal((await page('leser')).html, '<p>Bitte Türen schließen.</p>');
      assert.equal(await findetSeite('Fenster'), false, 'vorgeschlagener Text ist noch nicht auffindbar');
      assert.match(JSON.stringify((await c.autor.get('/api/v1/me/notifications')).body), /Neuer Änderungsvorschlag von Lektor: Richtlinie/);
      assert.deepEqual((await c.lektor.get(`/api/v1/pages/${pageId}/suggestions`)).body.items.map((s: any) => s.inserted), ['Fenster und Türen']);
      assert.notEqual((await new Client(ctx.app).get(`/api/v1/pages/${pageId}/suggestions`)).status, 200, 'ohne Anmeldung nicht');
    });

    await t.test('Fremde Vorschläge bleiben unangetastet', async () => {
      const removed = await publish('zweiter', '<p>Bitte Türen schließen.</p>');
      assert.equal(removed.status, 403);
      assert.match(removed.body.error.message, /Vorschläge von Lektor/);
      // Eigener zusätzlicher Vorschlag ist erlaubt
      const current = (await page('zweiter')).content as string;
      const extended = current.replace('</p>', `${ins('s2', ' Sofort!')}</p>`);
      assert.equal((await publish('zweiter', extended)).status, 200);
      assert.equal((await page('autor')).editMode.pending, 2);
    });

    await t.test('Autor nimmt an bzw. lehnt ab – direkt veröffentlicht', async () => {
      const current = (await page('autor')).content as string;
      // s1 annehmen, s2 ablehnen
      const resolved = current
        .replace(/<del[^>]*data-sid="s1"[^>]*>.*?<\/del>/, '')
        .replace(/<ins[^>]*data-sid="s1"[^>]*>(.*?)<\/ins>/, '$1')
        .replace(/<ins[^>]*data-sid="s2"[^>]*>.*?<\/ins>/, '');
      const res = await publish('autor', resolved);
      assert.equal(res.status, 200, res.raw);
      const view = await page('leser');
      assert.equal(view.html, '<p>Bitte Fenster und Türen schließen.</p>');
      assert.equal(view.editMode.pending, 0);
      assert.equal(await findetSeite('Fenster'), true, 'nach der Annahme findet die Suche den Text');
    });

    await t.test('Bereichsverwaltung schreibt den Modus fest; Vorgabe für neue Seiten', async () => {
      const locked = await admin.put(`/api/v1/pages/${pageId}/edit-mode`, { mode: 'suggest', locked: true });
      assert.equal(locked.body.locked, true);
      const denied = await c.autor.put(`/api/v1/pages/${pageId}/edit-mode`, { mode: 'direct' });
      assert.equal(denied.status, 403);
      assert.match(denied.body.error.message, /Bereichsverwaltung festgelegt/);

      assert.equal((await admin.patch('/api/v1/spaces/VM', { defaultEditMode: 'suggest' })).status, 200);
      const created = (await c.lektor.post('/api/v1/pages', { spaceKey: 'VM', title: 'Neu', content: '<p>x</p>' })).body.id;
      const own = (await c.lektor.get(`/api/v1/pages/${created}`)).body.editMode;
      assert.deepEqual([own.mode, own.forced], ['suggest', false], 'Autor selbst schreibt direkt');
      assert.equal((await c.zweiter.get(`/api/v1/pages/${created}`)).body.editMode.forced, true);
      const markdown = (await c.lektor.post('/api/v1/pages', { spaceKey: 'VM', title: 'MD', content: '# x', contentType: 'markdown' })).body.id;
      assert.equal((await c.lektor.get(`/api/v1/pages/${markdown}`)).body.editMode.mode, 'direct', 'nur Rich-Text');
    });
  } finally {
    await ctx.close();
  }
});
