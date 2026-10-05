import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { Client, createTestApp } from './helpers.ts';

interface Received {
  from: string;
  to: string[];
  data: string;
}

/** Minimaler SMTP-Server (ohne TLS) mit AUTH PLAIN/LOGIN – schreibt empfangene Mails mit. */
function fakeSmtp(credentials = { user: 'knowstead', pass: 'geheim' }) {
  const messages: Received[] = [];
  let authAttempts = 0;
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    let buffer = '';
    let mode: 'cmd' | 'data' | 'login-user' | 'login-pass' | 'plain' = 'cmd';
    let loginUser = '';
    let current: Received = { from: '', to: [], data: '' };
    const send = (line: string) => socket.write(`${line}\r\n`);
    const checkAuth = (user: string, pass: string) => {
      authAttempts++;
      send(user === credentials.user && pass === credentials.pass ? '235 2.7.0 Authentication successful' : '535 5.7.8 Authentication credentials invalid');
    };
    send('220 fake.smtp ESMTP bereit');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (mode === 'data') {
          if (line === '.') {
            mode = 'cmd';
            messages.push(current);
            current = { from: '', to: [], data: '' };
            send('250 2.0.0 OK queued');
          } else current.data += `${line.startsWith('..') ? line.slice(1) : line}\n`;
          continue;
        }
        if (mode === 'login-user') {
          loginUser = Buffer.from(line, 'base64').toString();
          mode = 'login-pass';
          send('334 UGFzc3dvcmQ6');
          continue;
        }
        if (mode === 'login-pass') {
          mode = 'cmd';
          checkAuth(loginUser, Buffer.from(line, 'base64').toString());
          continue;
        }
        if (mode === 'plain') {
          mode = 'cmd';
          const [, user, pass] = Buffer.from(line, 'base64').toString().split('\0');
          checkAuth(user, pass);
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO')) socket.write('250-fake.smtp\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n');
        else if (upper.startsWith('HELO')) send('250 fake.smtp');
        else if (upper.startsWith('AUTH PLAIN')) {
          const payload = line.slice(10).trim();
          if (payload) {
            const [, user, pass] = Buffer.from(payload, 'base64').toString().split('\0');
            checkAuth(user, pass);
          } else {
            mode = 'plain';
            send('334 ');
          }
        } else if (upper.startsWith('AUTH LOGIN')) {
          mode = 'login-user';
          send('334 VXNlcm5hbWU6');
        } else if (upper.startsWith('MAIL FROM')) {
          current.from = line;
          send('250 2.1.0 OK');
        } else if (upper.startsWith('RCPT TO')) {
          current.to.push(line);
          send('250 2.1.5 OK');
        } else if (upper === 'DATA') {
          mode = 'data';
          send('354 Ende mit <CRLF>.<CRLF>');
        } else if (upper === 'QUIT') {
          send('221 2.0.0 Tschüss');
          socket.end();
        } else if (upper === 'RSET' || upper === 'NOOP') send('250 OK');
        else send('502 5.5.2 Nicht unterstützt');
      }
    });
    socket.on('error', () => {});
  });
  return { server, messages, authAttempts: () => authAttempts };
}

async function waitFor(check: () => boolean, ms = 5000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error('Zeitüberschreitung beim Warten');
    await new Promise((r) => setTimeout(r, 20));
  }
}

test('E-Mail: SMTP-Einstellungen, Test, Warteschlange, Zusammenfassung', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);
  const smtp = fakeSmtp();
  await new Promise<void>((resolve) => smtp.server.listen(0, '127.0.0.1', resolve));
  const port = (smtp.server.address() as AddressInfo).port;
  let tomId = 0;

  try {
    await t.test('Einrichtung', async () => {
      const setup = await admin.post('/api/v1/setup', { siteName: 'Testwiki', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
      assert.equal(setup.status, 200, setup.raw);
      const user = await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom Test', email: 'tom@example.org', password: 'geheim-geheim' });
      assert.equal(user.status, 200, user.raw);
      tomId = user.body.id;
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
    });

    await t.test('Einstellungen werden geprüft und das Passwort maskiert', async () => {
      const bad = await admin.put('/api/v1/admin/settings', { smtp: { host: '127.0.0.1', port: 70000, from: 'knowstead@example.org' } });
      assert.equal(bad.status, 400, 'Port außerhalb des Bereichs');
      const badFrom = await admin.put('/api/v1/admin/settings', { smtp: { host: '127.0.0.1', port, from: 'kein-absender' } });
      assert.equal(badFrom.status, 400, 'ungültiger Absender');

      const saved = await admin.put('/api/v1/admin/settings', {
        emailNotifications: true,
        smtp: { host: '127.0.0.1', port, security: 'none', user: 'knowstead', password: 'falsch', from: 'Knowstead <knowstead@example.org>', replyTo: 'support@example.org' },
      });
      assert.equal(saved.status, 200, saved.raw);
      assert.equal(saved.body.smtp.password, '••••••••');
      assert.equal(saved.body.smtp.security, 'none');
      assert.equal(saved.body.smtp.secure, false);
      assert.notEqual(ctx.s.settings.get('smtp').password, 'falsch', 'verschlüsselt gespeichert');
    });

    await t.test('Verbindungstest nennt die Ursache', async () => {
      const wrongPassword = await admin.post('/api/v1/admin/mail/verify', {});
      assert.equal(wrongPassword.status, 400);
      assert.equal(wrongPassword.body.error.code, 'smtp_error');
      assert.match(wrongPassword.body.error.message, /Anmeldung am SMTP-Server fehlgeschlagen/);

      await admin.put('/api/v1/admin/settings', { smtp: { password: 'geheim', security: 'starttls' } });
      const noStartTls = await admin.post('/api/v1/admin/mail/verify', {});
      assert.equal(noStartTls.status, 400);
      assert.match(noStartTls.body.error.message, /STARTTLS/);

      await admin.put('/api/v1/admin/settings', { smtp: { security: 'none' } });
      const ok = await admin.post('/api/v1/admin/mail/verify', {});
      assert.equal(ok.status, 200, ok.raw);
      assert.match(ok.body.message, /erfolgreich/);
      assert.equal((await tom.post('/api/v1/admin/mail/verify', {})).status, 403, 'nur Administration');
    });

    await t.test('Test-E-Mail kommt als HTML und Text an', async () => {
      const res = await admin.post('/api/v1/admin/mail/test', { to: 'ada@example.org' });
      assert.equal(res.status, 200, res.raw);
      const mail = smtp.messages.at(-1)!;
      assert.match(mail.to[0], /ada@example\.org/);
      assert.match(mail.data, /Subject: Testwiki: Test-E-Mail/);
      assert.match(mail.data, /text\/html/);
      assert.match(mail.data, /text\/plain/);
      assert.match(mail.data, /Reply-To: support@example\.org/);
      assert.match(mail.data, /Auto-Submitted: auto-generated/);
      const log = await admin.get('/api/v1/admin/mail');
      assert.equal(log.body.items[0].kind, 'test');
      assert.equal(log.body.items[0].status, 'sent');
    });

    await t.test('Benachrichtigungen laufen über die Warteschlange', async () => {
      const before = smtp.messages.length;
      const board = await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Betrieb' });
      const task = await admin.post(`/api/v1/boards/${board.body.id}/tasks`, { title: 'Zertifikat erneuern', assigneeId: tomId, dueDate: '2030-01-31' });
      assert.equal(task.status, 200, task.raw);
      await ctx.s.mail.processQueue();
      await waitFor(() => smtp.messages.length > before);
      const mail = smtp.messages.at(-1)!;
      assert.match(mail.to[0], /tom@example\.org/);
      assert.match(mail.data, /Zertifikat erneuern/);
      const log = await admin.get('/api/v1/admin/mail?status=sent');
      assert.ok(log.body.items.some((m: { kind: string }) => m.kind === 'task.assigned'));
    });

    await t.test('Persönliche Einstellungen: nur Persönliches, täglich, aus', async () => {
      // Nur persönliche Benachrichtigungen: Beobachtungen erzeugen keine Mail
      await tom.patch('/api/v1/me/preferences', { emailOnlyMentions: true });
      const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Runbook Zertifikate', content: '<p>v1</p>' });
      await tom.post(`/api/v1/pages/${page.body.id}/watch`, { on: true });
      const before = smtp.messages.length;
      await admin.put(`/api/v1/pages/${page.body.id}`, { content: '<p>v2</p>', baseVersion: page.body.version });
      await ctx.s.mail.processQueue();
      assert.equal(smtp.messages.length, before, 'keine Mail für beobachtete Seite');

      // Täglich: sofort nichts, in der Zusammenfassung alles
      await tom.patch('/api/v1/me/preferences', { emailOnlyMentions: false, emailMode: 'daily' });
      const board = await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Zusammenfassung' });
      await admin.post(`/api/v1/boards/${board.body.id}/tasks`, { title: 'Backup prüfen', assigneeId: tomId });
      await ctx.s.mail.processQueue();
      assert.equal(smtp.messages.length, before, 'bei „täglich“ keine Sofort-Mail');
      const digests = await ctx.s.mail.sendDigests({ force: true });
      assert.equal(digests, 1);
      await ctx.s.mail.processQueue();
      await waitFor(() => smtp.messages.length === before + 1);
      assert.match(smtp.messages.at(-1)!.data, /Backup pr=C3=BCfen|Backup prüfen/);
      assert.equal(await ctx.s.mail.sendDigests({ force: true }), 0, 'bereits zusammengefasst');

      // Aus
      await tom.patch('/api/v1/me/preferences', { emailMode: 'off' });
      await admin.post(`/api/v1/boards/${board.body.id}/tasks`, { title: 'Nichts senden', assigneeId: tomId });
      await ctx.s.mail.processQueue();
      assert.equal(smtp.messages.length, before + 1);
    });

    await t.test('Fehlschläge werden wiederholt und protokolliert', async () => {
      await tom.patch('/api/v1/me/preferences', { emailMode: 'instant' });
      const closed = net.createServer();
      await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
      const deadPort = (closed.address() as AddressInfo).port;
      await new Promise<void>((resolve) => closed.close(() => resolve()));

      await admin.put('/api/v1/admin/settings', { smtp: { port: deadPort } });
      const board = await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Störung' });
      await admin.post(`/api/v1/boards/${board.body.id}/tasks`, { title: 'Wird wiederholt', assigneeId: tomId });
      await ctx.s.mail.processQueue();
      const queued = await admin.get('/api/v1/admin/mail?status=queued');
      const item = queued.body.items.find((m: { subject: string }) => m.subject.includes('Wird wiederholt'));
      assert.ok(item, 'bleibt in der Warteschlange');
      assert.equal(item.attempts, 1);
      assert.match(item.lastError, /Verbindung abgelehnt/);
      assert.ok(item.nextAttemptAt > new Date().toISOString(), 'nächster Versuch später');

      // Server wieder erreichbar → erneut senden
      await admin.put('/api/v1/admin/settings', { smtp: { port } });
      const before = smtp.messages.length;
      const retry = await admin.post('/api/v1/admin/mail/retry-failed', {});
      assert.equal(retry.status, 200, retry.raw);
      await waitFor(() => smtp.messages.length > before);
      const sent = await admin.get('/api/v1/admin/mail?status=sent');
      assert.ok(sent.body.items.some((m: { subject: string }) => m.subject.includes('Wird wiederholt')));
    });

    await t.test('Passwort-Link kommt über die Warteschlange', async () => {
      const guest = new Client(ctx.app);
      const before = smtp.messages.length;
      const res = await guest.post('/api/v1/auth/forgot', { login: 'tom' });
      assert.ok([200, 204].includes(res.status), res.raw);
      await ctx.s.mail.processQueue();
      await waitFor(() => smtp.messages.length > before);
      assert.match(smtp.messages.at(-1)!.data, /reset-password\//);
    });

    await t.test('Einladung neuer Konten per E-Mail', async () => {
      const user = await admin.post('/api/v1/admin/users', { username: 'neu', displayName: 'Nora Neu', email: 'nora@example.org' });
      assert.equal(user.status, 200, user.raw);
      const before = smtp.messages.length;
      const invite = await admin.post(`/api/v1/admin/users/${user.body.id}/invite`, {});
      assert.equal(invite.status, 200, invite.raw);
      await ctx.s.mail.processQueue();
      await waitFor(() => smtp.messages.length > before);
      const mail = smtp.messages.at(-1)!;
      assert.match(mail.to[0], /nora@example\.org/);
      assert.match(mail.data, /Einladung zu Testwiki/);
      assert.match(mail.data, /reset-password\//);
      assert.equal((await tom.post(`/api/v1/admin/users/${user.body.id}/invite`, {})).status, 403);
    });
  } finally {
    smtp.server.close();
    await ctx.close();
  }
});
