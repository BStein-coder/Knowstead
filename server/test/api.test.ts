import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client, createTestApp } from './helpers.ts';

test('Knowstead API – Gesamtablauf', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const bob = new Client(ctx.app);
  let spaceKey = 'DEV';
  let pageId = 0;
  let childId = 0;
  let bobId = 0;

  try {
    await t.test('Ersteinrichtung', async () => {
      const status = await admin.get('/api/v1/setup/status');
      assert.equal(status.body.needsSetup, true);
      const res = await admin.post('/api/v1/setup', {
        siteName: 'Test-Knowstead',
        username: 'admin',
        displayName: 'Ada Admin',
        email: 'admin@example.com',
        password: 'geheim-geheim',
        sampleContent: true,
      });
      assert.equal(res.status, 200, res.raw);
      const me = await admin.get('/api/v1/auth/me');
      assert.equal(me.body.user.username, 'admin');
      assert.ok(me.body.user.isAdmin);
      assert.equal(me.body.settings.siteName, 'Test-Knowstead');
      const again = await admin.post('/api/v1/setup', { siteName: 'x', username: 'x2', displayName: 'x', password: 'geheim-geheim' });
      assert.equal(again.status, 403);
    });

    await t.test('CSRF-Schutz ohne Header', async () => {
      const res = await ctx.app.inject({ method: 'POST', url: '/api/v1/spaces', payload: { key: 'X', name: 'x' } });
      assert.equal(res.statusCode, 403);
    });

    await t.test('Beispielbereich und Vorlagen vorhanden', async () => {
      const spaces = await admin.get('/api/v1/spaces');
      assert.ok(spaces.body.some((sp: { key: string }) => sp.key === 'TEAM'));
      const templates = await admin.get('/api/v1/templates');
      assert.ok(templates.body.length >= 10);
    });

    await t.test('Bereich anlegen', async () => {
      const res = await admin.post('/api/v1/spaces', { key: 'dev', name: 'Entwicklung', description: 'Technik', preset: 'private' });
      assert.equal(res.status, 200, res.raw);
      spaceKey = res.body.key;
      assert.equal(spaceKey, 'DEV');
      assert.ok(res.body.homePageId);
      const dup = await admin.post('/api/v1/spaces', { key: 'DEV', name: 'Doppelt' });
      assert.equal(dup.status, 409);
    });

    await t.test('Seiten anlegen, bearbeiten, Konflikt erkennen', async () => {
      const res = await admin.post('/api/v1/pages', {
        spaceKey,
        title: 'Architektur',
        content: '<h2>Überblick</h2><p>Die Anwendung nutzt <strong>SQLite</strong> und Fastify.</p><script>alert(1)</script>',
        labels: ['Technik', 'backend'],
        properties: [{ name: 'Status', value: 'aktiv' }],
      });
      assert.equal(res.status, 200, res.raw);
      pageId = res.body.id;
      assert.equal(res.body.version, 1);
      assert.ok(!res.body.content.includes('<script'), 'Script muss entfernt werden');
      assert.deepEqual(res.body.labels, ['backend', 'technik']);

      const child = await admin.post('/api/v1/pages', { spaceKey, parentId: pageId, title: 'Datenbank', content: '<p>Tabellen &amp; Indizes</p>' });
      childId = child.body.id;
      assert.equal(child.body.parentId, pageId);

      const upd = await admin.put(`/api/v1/pages/${pageId}`, {
        content: `<h2>Überblick</h2><p>Die Anwendung nutzt <strong>SQLite</strong>, Fastify und React.</p><p><a href="/s/DEV/p/${childId}/datenbank">DB</a></p>`,
        changeNote: 'React ergänzt',
        baseVersion: 1,
      });
      assert.equal(upd.status, 200, upd.raw);
      assert.equal(upd.body.version, 2);

      const stale = await admin.put(`/api/v1/pages/${pageId}`, { content: '<p>alt</p>', baseVersion: 1 });
      assert.equal(stale.status, 409);
      assert.equal(stale.body.error.details.currentVersion, 2);

      const md = await admin.put(`/api/v1/pages/${childId}`, { content: '# Titel\n\n- [ ] offen\n- [x] erledigt\n\n> [!WARNING]\n> Achtung', format: 'markdown' });
      assert.equal(md.status, 200, md.raw);
      assert.ok(md.body.content.includes('data-type="taskList"'));
      assert.ok(md.body.content.includes('data-type="callout"'));
    });

    await t.test('Baum, Rückverweise, Versionen, Diff, Wiederherstellen', async () => {
      const tree = await admin.get(`/api/v1/spaces/${spaceKey}/tree`);
      assert.ok(tree.body.some((n: { id: number }) => n.id === pageId));
      const back = await admin.get(`/api/v1/pages/${childId}/backlinks`);
      assert.ok(back.body.some((p: { id: number }) => p.id === pageId));
      const revs = await admin.get(`/api/v1/pages/${pageId}/revisions`);
      assert.equal(revs.body.total, 2);
      assert.equal(revs.body.items[0].changeNote, 'React ergänzt');
      const diff = await admin.get(`/api/v1/pages/${pageId}/diff?from=1&to=2`);
      assert.equal(diff.status, 200, diff.raw);
      assert.ok(diff.body.html.includes('knowstead-diff-ins'));
      assert.ok(diff.body.stats.added > 0);
      const restore = await admin.post(`/api/v1/pages/${pageId}/revisions/1/restore`);
      assert.equal(restore.body.version, 3);
      const page = await admin.get(`/api/v1/pages/${pageId}?render=true`);
      assert.ok(!page.body.content.includes('React'));
      assert.ok(page.body.html.includes('SQLite'));
    });

    await t.test('Suche mit Filtern', async () => {
      const res = await admin.get(`/api/v1/search?q=${encodeURIComponent('sqlite')}`);
      assert.equal(res.status, 200, res.raw);
      assert.ok(res.body.items.some((h: { id: number }) => h.id === pageId));
      assert.ok(res.body.items[0].snippet.includes('<mark>'));
      const byLabel = await admin.get(`/api/v1/search?q=${encodeURIComponent('label:technik')}`);
      assert.equal(byLabel.body.items[0].id, pageId);
      const byProp = await admin.get(`/api/v1/search?q=${encodeURIComponent('#status=aktiv')}`);
      assert.equal(byProp.body.items[0].id, pageId);
      const quick = await admin.get('/api/v1/search/quick?q=Archi');
      assert.equal(quick.body.pages[0].id, pageId);
    });

    await t.test('Zweiter Benutzer und Rechte', async () => {
      const created = await admin.post('/api/v1/admin/users', { username: 'bob', displayName: 'Bob Beispiel', email: 'bob@example.com', password: 'passwort-bob' });
      assert.equal(created.status, 200, created.raw);
      bobId = created.body.id;
      const login = await bob.post('/api/v1/auth/login', { login: 'bob', password: 'passwort-bob' });
      assert.equal(login.status, 200, login.raw);
      // Privater Bereich: kein Zugriff
      const denied = await bob.get(`/api/v1/pages/${pageId}`);
      assert.equal(denied.status, 404);
      // Leserechte vergeben
      const grants = await admin.get(`/api/v1/spaces/${spaceKey}/permissions`);
      const next = [...grants.body.map((g: object) => g), { subjectType: 'user', subjectId: bobId, role: 'viewer' }];
      const set = await admin.put(`/api/v1/spaces/${spaceKey}/permissions`, { grants: next });
      assert.equal(set.status, 200, set.raw);
      const ok = await bob.get(`/api/v1/pages/${pageId}`);
      assert.equal(ok.status, 200);
      assert.equal(ok.body.access.edit, false);
      const edit = await bob.put(`/api/v1/pages/${pageId}`, { content: '<p>Hack</p>' });
      assert.equal(edit.status, 403);
      // Lese-Einschränkung auf der Elternseite vererbt sich auf die Unterseite
      const restr = await admin.put(`/api/v1/pages/${pageId}/restrictions`, { view: [{ type: 'user', id: 1 }], edit: [] });
      assert.equal(restr.status, 200, restr.raw);
      assert.equal((await bob.get(`/api/v1/pages/${childId}`)).status, 404);
      const tree = await bob.get(`/api/v1/spaces/${spaceKey}/tree`);
      assert.ok(!tree.body.some((n: { id: number }) => n.id === childId));
      const search = await bob.get('/api/v1/search?q=sqlite');
      assert.ok(!search.body.items.some((h: { id: number }) => h.id === pageId));
      await admin.put(`/api/v1/pages/${pageId}/restrictions`, { view: [], edit: [] });
      assert.equal((await bob.get(`/api/v1/pages/${childId}`)).status, 200);
    });

    await t.test('Kommentare, Erwähnungen und Benachrichtigungen', async () => {
      await admin.put(`/api/v1/spaces/${spaceKey}/permissions`, {
        grants: [
          { subjectType: 'user', subjectId: 1, role: 'admin' },
          { subjectType: 'user', subjectId: bobId, role: 'commenter' },
        ],
      });
      await bob.post(`/api/v1/pages/${pageId}/watch`, { on: true });
      const c = await admin.post(`/api/v1/pages/${pageId}/comments`, {
        body: `<p>Hallo <span data-type="mention" data-id="${bobId}" data-label="Bob">@Bob</span></p>`,
      });
      assert.equal(c.status, 200, c.raw);
      const reply = await bob.post(`/api/v1/pages/${pageId}/comments`, { body: '<p>Danke!</p>', parentId: c.body.id });
      assert.equal(reply.status, 200, reply.raw);
      await new Promise((r) => setTimeout(r, 50));
      const notes = await bob.get('/api/v1/me/notifications');
      assert.ok(notes.body.items.some((n: { type: string }) => n.type === 'mention'), JSON.stringify(notes.body));
      const list = await admin.get(`/api/v1/pages/${pageId}/comments`);
      assert.equal(list.body[0].replies.length, 1);
      const resolve = await admin.post(`/api/v1/comments/${c.body.id}/resolve`, { resolved: true });
      assert.equal(resolve.status, 200);
    });

    await t.test('API-Token mit Umfängen', async () => {
      const created = await admin.post('/api/v1/me/tokens', { name: 'CI', scopes: ['read'] });
      assert.equal(created.status, 200, created.raw);
      const api = new Client(ctx.app);
      api.token = created.body.token;
      assert.equal((await api.get(`/api/v1/pages/${pageId}`)).status, 200);
      assert.equal((await api.post('/api/v1/pages', { spaceKey, title: 'X' })).status, 403);
      assert.equal((await api.get('/api/v1/admin/stats')).status, 403);
      const write = await admin.post('/api/v1/me/tokens', { name: 'Schreiben', scopes: ['read', 'write'] });
      api.token = write.body.token;
      const appended = await api.post(`/api/v1/pages/${childId}/append`, { content: '## Neu\n\nAus CI', format: 'markdown', changeNote: 'Build 42' });
      assert.equal(appended.status, 200, appended.raw);
      api.token = 'knowstead_ungueltig';
      assert.equal((await api.get('/api/v1/spaces')).status, 401);
    });

    await t.test('Webhook mit Signatur', async () => {
      const received: { body: string; signature: string; timestamp: string; event: string }[] = [];
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          received.push({
            body,
            signature: String(req.headers['x-knowstead-signature']),
            timestamp: String(req.headers['x-knowstead-timestamp']),
            event: String(req.headers['x-knowstead-event']),
          });
          res.end('ok');
        });
      });
      await new Promise<void>((r) => server.listen(0, r));
      const port = (server.address() as { port: number }).port;
      try {
        const hook = await admin.post('/api/v1/admin/webhooks', { name: 'Test', url: `http://127.0.0.1:${port}/hook`, events: ['page.*'] });
        assert.equal(hook.status, 200, hook.raw);
        const secret: string = hook.body.secret;
        const ping = await admin.post(`/api/v1/admin/webhooks/${hook.body.webhook.id}/test`);
        assert.equal(ping.body.success, true, JSON.stringify(ping.body));
        await admin.put(`/api/v1/pages/${childId}`, { content: '<p>Webhook-Test</p>' });
        for (let i = 0; i < 40 && !received.some((r) => r.event === 'page.updated'); i++) await new Promise((r) => setTimeout(r, 25));
        const evt = received.find((r) => r.event === 'page.updated');
        assert.ok(evt, 'page.updated sollte zugestellt werden');
        const expected = crypto.createHmac('sha256', secret).update(`${evt!.timestamp}.${evt!.body}`).digest('hex');
        assert.equal(evt!.signature, `sha256=${expected}`);
        assert.equal(JSON.parse(evt!.body).page.id, childId);
      } finally {
        server.close();
      }
    });

    await t.test('Export, Papierkorb, Änderungsprotokoll, Audit', async () => {
      const md = await admin.get(`/api/v1/pages/${pageId}/export?format=md`);
      assert.equal(md.status, 200);
      assert.ok(md.raw.includes('# Architektur'));
      const zip = await admin.get(`/api/v1/spaces/${spaceKey}/export?format=markdown`);
      assert.equal(zip.status, 200);
      assert.equal(zip.raw.slice(0, 2), 'PK');
      const del = await admin.del(`/api/v1/pages/${pageId}`);
      assert.equal(del.body.deleted, 2);
      assert.equal((await admin.get(`/api/v1/pages/${childId}`)).status, 404);
      const trash = await admin.get(`/api/v1/spaces/${spaceKey}/trash`);
      assert.equal(trash.body[0].id, pageId);
      const restored = await admin.post(`/api/v1/pages/${pageId}/restore`);
      assert.equal(restored.status, 200);
      assert.equal((await admin.get(`/api/v1/pages/${childId}`)).status, 200);
      const log = await admin.get(`/api/v1/spaces/${spaceKey}/changelog`);
      assert.ok(log.body.length >= 5);
      assert.ok(log.body.some((e: { changeNote: string }) => e.changeNote === 'React ergänzt'));
      const mdLog = await admin.get(`/api/v1/spaces/${spaceKey}/changelog?format=md`);
      assert.ok(mdLog.raw.startsWith('# Änderungsprotokoll'));
      const audit = await admin.get('/api/v1/admin/audit?category=security');
      assert.ok(audit.body.items.some((e: { type: string }) => e.type === 'auth.login'));
      const stats = await admin.get('/api/v1/admin/stats');
      assert.ok(stats.body.counts.pages > 3);
    });

    await t.test('Journal und persönlicher Bereich', async () => {
      const res = await admin.post('/api/v1/journal/today', {});
      assert.equal(res.status, 200, res.raw);
      const again = await admin.post('/api/v1/journal/today', {});
      assert.equal(again.body.id, res.body.id);
    });

    await t.test('Sicherung', async () => {
      const b = await admin.post('/api/v1/admin/backups');
      assert.equal(b.status, 200, b.raw);
      const list = await admin.get('/api/v1/admin/backups');
      assert.equal(list.body.length, 1);
      // Der Snapshot entsteht im Worker-Thread und ist eine vollständige, lesbare Datenbank
      const snapshot = new DatabaseSync(path.join(ctx.s.config.backupsDir, b.body.name, 'knowstead.db'), { readOnly: true });
      try {
        assert.equal(snapshot.prepare('SELECT count(*) AS n FROM pages').get()?.n, ctx.s.db.value('SELECT count(*) FROM pages'));
        assert.equal(snapshot.prepare('PRAGMA integrity_check').get()?.integrity_check, 'ok');
      } finally {
        snapshot.close();
      }
    });
  } finally {
    await ctx.close();
  }
});
