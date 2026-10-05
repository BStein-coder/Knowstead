import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

type Checklist = { items: { id: string; state: string; detail: string | null }[]; done: number; total: number; dismissed: boolean };

test('Einrichtung abschließen: Stand der Checkliste und Ausblenden', async (t) => {
  const ctx = await createTestApp({ env: { KNOWSTEAD_SERVICE: 'task' } });
  const admin = new Client(ctx.app);
  const eva = new Client(ctx.app);
  const state = (list: Checklist, id: string) => list.items.find((item) => item.id === id)?.state;
  try {
    await t.test('Frische Installation: Pflichtpunkte offen, Autostart vom Assistenten erkannt', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true })).status, 200);
      const res = await admin.get('/api/v1/admin/setup-checklist');
      assert.equal(res.status, 200, res.raw);
      const list = res.body as Checklist;
      assert.deepEqual(list.items.map((item) => item.id), ['address', 'service', 'mail', 'backup', 'users', 'spaces', 'login', 'extras']);
      assert.equal(state(list, 'address'), 'open', 'http://localhost ist keine öffentliche HTTPS-Adresse');
      assert.equal(state(list, 'service'), 'done');
      assert.equal(list.items.find((item) => item.id === 'service')?.detail, 'task');
      assert.equal(state(list, 'mail'), 'open');
      assert.equal(state(list, 'backup'), 'open');
      assert.equal(state(list, 'users'), 'open');
      assert.equal(state(list, 'spaces'), 'open', 'Handbuch und Beispielbereich zählen nicht');
      assert.equal(state(list, 'login'), 'optional');
      assert.equal(state(list, 'extras'), 'optional');
      assert.equal(list.total, 6);
      assert.equal(list.done, 1);
      assert.equal(list.dismissed, false);
    });

    await t.test('Erledigte Punkte werden erkannt', async () => {
      assert.equal((await admin.put('/api/v1/admin/settings', { smtp: { host: 'smtp.example.com', port: 587, security: 'starttls', user: '', password: '', from: 'knowstead@example.com', replyTo: '', rejectUnauthorized: true } })).status, 200);
      assert.equal((await admin.post('/api/v1/admin/backups')).status, 200);
      const user = await admin.post('/api/v1/admin/users', { username: 'eva', displayName: 'Eva', password: 'geheim-geheim' });
      assert.equal(user.status, 200, user.raw);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'IT', name: 'IT' })).status, 200);
      assert.equal((await admin.put('/api/v1/admin/settings', { ocr: { enabled: true, tesseractPath: process.platform === 'win32' ? 'tesseract.exe' : 'tesseract' } })).status, 200);
      const list = (await admin.get('/api/v1/admin/setup-checklist')).body as Checklist;
      for (const id of ['service', 'mail', 'backup', 'users', 'spaces', 'extras']) assert.equal(state(list, id), 'done', id);
      assert.equal(list.items.find((item) => item.id === 'mail')?.detail, 'smtp.example.com');
      assert.ok(list.items.find((item) => item.id === 'backup')?.detail, 'Zeitpunkt der neuesten Sicherung');
      assert.equal(list.done, 5);
    });

    await t.test('Hinweis aus- und einblenden, nur für Administratoren', async () => {
      const hidden = await admin.put('/api/v1/admin/setup-checklist', { dismissed: true });
      assert.equal(hidden.status, 200);
      assert.equal((hidden.body as Checklist).dismissed, true);
      assert.equal(((await admin.get('/api/v1/admin/setup-checklist')).body as Checklist).dismissed, true);
      assert.equal(((await admin.put('/api/v1/admin/setup-checklist', { dismissed: false })).body as Checklist).dismissed, false);

      assert.equal((await eva.post('/api/v1/auth/login', { login: 'eva', password: 'geheim-geheim' })).status, 200);
      assert.equal((await eva.get('/api/v1/admin/setup-checklist')).status, 403);
      assert.equal((await eva.put('/api/v1/admin/setup-checklist', { dismissed: true })).status, 403);
      assert.equal((await new Client(ctx.app).get('/api/v1/admin/setup-checklist')).status, 401);
    });

    await t.test('Systeminformationen nennen Betriebsart und Protokolldatei', async () => {
      const system = await admin.get('/api/v1/admin/system');
      assert.equal(system.body.service, 'task');
      assert.equal(system.body.logFile, null);
    });
  } finally {
    await ctx.close();
  }
});
