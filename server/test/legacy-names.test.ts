import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { loadConfig, packageBuiltAt } from '../src/config.ts';
import { sha256 } from '../src/core/crypto.ts';
import { sanitizeRichText } from '../src/core/html.ts';
import { adoptLegacyEnv, backupDbName, defaultDbFile, findBackupDb, headerValue, systemdServiceName } from '../src/core/legacy.ts';
import { Db } from '../src/db/database.ts';
import { MIGRATIONS, migrate } from '../src/db/migrate.ts';
import { openDatabase } from '../src/db/upgrade.ts';
import { restoreBackup } from '../src/db/restore.ts';
import { dokuWikiToHtml } from '../src/modules/transfer/wiki/dokuwiki.ts';
import { renameLegacyEnv } from '../../scripts/install.mjs';
import { Client, createTestApp } from './helpers.ts';

/**
 * Bis Version 1.9 hieß Knowstead „Doku“. Eine bestehende Installation behält beim Update alles, was den früheren
 * Namen trägt: Datenbankdatei, Einträge der .env, Anmeldungen, API-Tokens, Kopfzeilen von Proxy und Skripten,
 * Sicherungen und Archive. Diese Datei hält fest, dass das so bleibt.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tempDir(prefix = 'knowstead-frueher-'): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

function multipart(file: { name: string; data: Buffer }, fields: Record<string, string>): { body: Buffer; type: string } {
  const boundary = '----knowstead-frueher';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`), file.data, Buffer.from('\r\n'));
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

test('Frühere Namen: Einstellungen, Dateien und Kopfzeilen', async (t) => {
  await t.test('Einträge mit DOKU_ gelten, solange der neue Name nicht gesetzt ist', () => {
    const env: NodeJS.ProcessEnv = {
      DOKU_SECRET: 'alt-geheim-alt-geheim',
      DOKU_SERVICE: 'systemd',
      KNOWSTEAD_SERVICE: 'docker',
      // Leer zählt als nicht gesetzt (so reicht Docker Compose eine fehlende Angabe durch)
      DOKU_ALLOW_DOWNGRADE: '1',
      KNOWSTEAD_ALLOW_DOWNGRADE: '',
      DOKUMENTE: 'bleibt',
      PATH: '/usr/bin',
    };
    assert.deepEqual(adoptLegacyEnv(env), ['DOKU_ALLOW_DOWNGRADE', 'DOKU_SECRET']);
    assert.equal(env.KNOWSTEAD_SECRET, 'alt-geheim-alt-geheim');
    assert.equal(env.KNOWSTEAD_ALLOW_DOWNGRADE, '1');
    assert.equal(env.KNOWSTEAD_SERVICE, 'docker', 'der neue Name hat Vorrang');
    assert.equal(env.DOKU_SECRET, 'alt-geheim-alt-geheim', 'der frühere Eintrag bleibt stehen');
    assert.equal('KNOWSTEAD_MENTE' in env, false, 'nur das Präfix DOKU_ zählt');
    // Zweiter Lauf: nichts mehr zu übernehmen
    assert.deepEqual(adoptLegacyEnv(env), []);
  });

  await t.test('Konfiguration: DOKU_SERVICE und DOKU_SECRET aus der Umgebung des Dienstes', () => {
    const dir = tempDir();
    const before = { ...process.env };
    try {
      process.env.KNOWSTEAD_SKIP_ENV_FILE = '1';
      delete process.env.KNOWSTEAD_SERVICE;
      delete process.env.KNOWSTEAD_SECRET;
      process.env.DOKU_SERVICE = 'systemd';
      process.env.DOKU_SECRET = 'frueherer-schluessel-0123456789';
      const config = loadConfig({ DATA_DIR: dir, NODE_ENV: 'test' });
      assert.equal(config.service, 'systemd');
      assert.equal(config.secret.toString('hex'), crypto.createHash('sha256').update('frueherer-schluessel-0123456789').digest('hex'), 'derselbe Schlüssel wie vor der Umbenennung');
      assert.equal(fs.existsSync(path.join(dir, 'secret.key')), false, 'kein neuer Schlüssel angelegt');
    } finally {
      for (const name of ['DOKU_SERVICE', 'DOKU_SECRET', 'KNOWSTEAD_SERVICE', 'KNOWSTEAD_SECRET']) {
        if (before[name] === undefined) delete process.env[name];
        else process.env[name] = before[name];
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('.env beim erneuten Installieren: DOKU_ wird zu KNOWSTEAD_, alles andere bleibt Zeichen für Zeichen', () => {
    const text = ['# Eigene Notiz zu DOKU_SECRET', 'PORT=3000', 'DOKU_SERVICE=systemd', '  export DOKU_SECRET = "abc=def"  ', 'DOKUMENTE=/srv/dokumente', 'KNOWSTEAD_ALLOW_DOWNGRADE=0', 'DOKU_ALLOW_DOWNGRADE=1', ''].join('\n');
    assert.equal(
      renameLegacyEnv(text),
      ['# Eigene Notiz zu DOKU_SECRET', 'PORT=3000', 'KNOWSTEAD_SERVICE=systemd', '  export KNOWSTEAD_SECRET = "abc=def"  ', 'DOKUMENTE=/srv/dokumente', 'KNOWSTEAD_ALLOW_DOWNGRADE=0', 'DOKU_ALLOW_DOWNGRADE=1', ''].join('\n'),
    );
    // Zeilenenden einer unter Windows bearbeiteten Datei bleiben
    assert.equal(renameLegacyEnv('DOKU_SERVICE=nssm\r\nPORT=3000\r\n'), 'KNOWSTEAD_SERVICE=nssm\r\nPORT=3000\r\n');
    assert.equal(renameLegacyEnv('PORT=3000\n'), 'PORT=3000\n');
  });

  await t.test('Datenbankdatei: eine vorhandene doku.db bleibt, neu angelegt wird knowstead.db', () => {
    const dir = tempDir();
    try {
      assert.equal(path.basename(defaultDbFile(dir)), 'knowstead.db');
      fs.writeFileSync(path.join(dir, 'doku.db'), '');
      assert.equal(path.basename(defaultDbFile(dir)), 'doku.db');
      process.env.KNOWSTEAD_SKIP_ENV_FILE = '1';
      assert.equal(loadConfig({ DATA_DIR: dir, NODE_ENV: 'test' }).dbFile, path.join(dir, 'doku.db'));
      // Ausdrückliche Angabe in der .env hat Vorrang
      assert.equal(loadConfig({ DATA_DIR: dir, DB_FILE: path.join(dir, 'eigene.db'), NODE_ENV: 'test' }).dbFile, path.join(dir, 'eigene.db'));
      // Beide vorhanden (jemand hat die Datei kopiert): der neue Name
      fs.writeFileSync(path.join(dir, 'knowstead.db'), '');
      assert.equal(path.basename(defaultDbFile(dir)), 'knowstead.db');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('Sicherungen: Name der Datenbank wie die laufende, gefunden wird jeder der beiden', () => {
    const dir = tempDir();
    try {
      assert.equal(backupDbName('/var/lib/doku/doku.db'), 'doku.db');
      assert.equal(backupDbName('/var/lib/knowstead/knowstead.db'), 'knowstead.db');
      assert.equal(backupDbName('/srv/wiki/eigene.db'), 'knowstead.db');
      assert.equal(findBackupDb(dir), null);
      fs.writeFileSync(path.join(dir, 'doku.db'), '');
      assert.equal(findBackupDb(dir), path.join(dir, 'doku.db'));
      fs.writeFileSync(path.join(dir, 'knowstead.db'), '');
      assert.equal(findBackupDb(dir), path.join(dir, 'knowstead.db'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('Paketbeschreibung: .doku-package.json eines Pakets bis 1.9 wird gelesen', () => {
    const dir = tempDir();
    try {
      fs.writeFileSync(path.join(dir, '.doku-package.json'), JSON.stringify({ version: '1.9.0', platform: 'linux', builtAt: '2026-10-04T10:00:00.000Z' }));
      assert.equal(packageBuiltAt(dir), '2026-10-04T10:00:00.000Z');
      fs.writeFileSync(path.join(dir, '.knowstead-package.json'), JSON.stringify({ version: '2.0.0', platform: 'linux', builtAt: '2026-10-05T10:00:00.000Z' }));
      assert.equal(packageBuiltAt(dir), '2026-10-05T10:00:00.000Z', 'der neue Name hat Vorrang');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('Kopfzeilen: X-Knowstead-… und X-Doku-…', () => {
    assert.equal(headerValue({ 'x-doku-client': 'skript' }, 'client'), 'skript');
    assert.equal(headerValue({ 'x-doku-locale': 'en', 'x-knowstead-locale': 'de' }, 'locale'), 'de');
    assert.equal(headerValue({ 'x-doku-proxy-secret': ['a', 'b'] }, 'proxy-secret'), 'a');
    assert.equal(headerValue({}, 'client'), undefined);
  });

  await t.test('Name des Dienstes für Hinweise: doku, wenn nur der frühere Dienst eingerichtet ist', () => {
    const dir = tempDir();
    try {
      assert.equal(systemdServiceName(dir), 'knowstead');
      fs.writeFileSync(path.join(dir, 'doku.service'), '[Unit]\n');
      assert.equal(systemdServiceName(dir), 'doku');
      fs.writeFileSync(path.join(dir, 'knowstead.service'), '[Unit]\n');
      assert.equal(systemdServiceName(dir), 'knowstead');
      assert.equal(systemdServiceName(path.join(dir, 'gibt-es-nicht')), 'knowstead');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('Seiteninhalt: Klassen mit doku- bleiben erhalten', () => {
    const html = sanitizeRichText('<p><span class="doku-missing-link" title="x">Fehlt</span> <span class="knowstead-missing-link">Fehlt auch</span> <ins data-suggestion="insert" class="doku-suggestion-insert">neu</ins></p>');
    assert.match(html, /class="doku-missing-link"/);
    assert.match(html, /class="knowstead-missing-link"/);
    assert.match(html, /class="doku-suggestion-insert"/);
  });

  await t.test('DokuWiki-Import: das Kürzel doku> gehört zu DokuWiki und heißt weiter so', () => {
    const { html } = dokuWikiToHtml('Siehe [[doku>wiki:syntax|Syntax]].', { ns: '', page: (id) => id, media: (id) => id });
    assert.match(html, /href="https:\/\/www\.dokuwiki\.org\/wiki%3Asyntax"/);
  });
});

test('Bestehende Installation mit doku.db: Update, Anmeldung, Token, Sicherung', async (t) => {
  // Eine Installation anlegen und so hinstellen, wie Version 1.9 sie hinterlässt
  const first = await createTestApp();
  const dir = first.dir;
  const admin = new Client(first.app);
  const setup = await admin.post('/api/v1/setup', { siteName: 'Doku', username: 'admin', displayName: 'Ada', password: 'geheim-geheim' });
  assert.equal(setup.status, 200, setup.raw);
  const space = await admin.post('/api/v1/spaces', { key: 'ALT', name: 'Altbestand' });
  assert.equal(space.status, 200, space.raw);
  const page = await admin.post('/api/v1/pages', { spaceKey: 'ALT', title: 'Vor der Umbenennung', content: '<p>Stand aus Version 1.9</p>' });
  assert.equal(page.status, 200, page.raw);
  const sessionValue = (admin as unknown as { cookie: string }).cookie.replace(/^knowstead_session=/, '');
  const legacyToken = `doku_${crypto.randomBytes(30).toString('base64url')}`;
  first.s.db.run(
    'INSERT INTO api_tokens (user_id, name, token_hash, prefix, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    setup.body.user.id,
    'Skript von früher',
    sha256(legacyToken),
    legacyToken.slice(0, 12),
    JSON.stringify(['read', 'write']),
    new Date().toISOString(),
  );
  first.s.settings.setInternal('app:version', '1.9.0');
  // So legte 1.9 den Handbuch-Bereich an
  first.s.db.run("UPDATE spaces SET description = 'Benutzer- und Administrationshandbuch für Doku.' WHERE key = 'HANDBUCH'");
  await first.close({ keepDir: true });
  fs.renameSync(path.join(dir, 'knowstead.db'), path.join(dir, 'doku.db'));
  for (const suffix of ['-wal', '-shm']) fs.rmSync(path.join(dir, `knowstead.db${suffix}`), { force: true });

  const ctx = await createTestApp({ dir });
  const legacyCookie = `doku_session=${sessionValue}`;
  const inject = (method: 'GET' | 'POST', url: string, headers: Record<string, string>, payload?: object) => ctx.app.inject({ method, url, headers, payload });
  try {
    await t.test('Die Datenbank bleibt doku.db – es entsteht keine zweite daneben', () => {
      assert.equal(ctx.s.config.dbFile, path.join(dir, 'doku.db'));
      assert.equal(fs.existsSync(path.join(dir, 'knowstead.db')), false);
      assert.equal(ctx.s.db.value('SELECT title FROM pages WHERE id = ?', page.body.id), 'Vor der Umbenennung');
    });

    await t.test('Der Name „Doku“ zieht beim Update einmalig mit', () => {
      assert.equal(ctx.s.settings.get('siteName'), 'Knowstead');
      assert.equal(ctx.s.settings.getInternal('app:version', null), ctx.s.config.version);
      assert.equal(ctx.s.db.value("SELECT description FROM spaces WHERE key = 'HANDBUCH'"), 'Benutzer- und Administrationshandbuch für Knowstead.');
    });

    await t.test('Anmeldung aus der Zeit vor dem Update gilt weiter (Cookie doku_session)', async () => {
      const me = await inject('GET', '/api/v1/auth/me', { cookie: legacyCookie });
      assert.equal(me.statusCode, 200);
      assert.equal(me.json().user.username, 'admin');
      // Schreibend mit der früheren Kopfzeile des Browsers bzw. eines Skripts
      const write = await inject('POST', '/api/v1/pages', { cookie: legacyCookie, 'x-doku-client': 'web' }, { spaceKey: 'ALT', title: 'Nach dem Update' });
      assert.equal(write.statusCode, 200, write.body);
      // Ohne eine der beiden Kopfzeilen bleibt der Schutz vor fremden Formularen
      const forged = await inject('POST', '/api/v1/pages', { cookie: legacyCookie }, { spaceKey: 'ALT', title: 'Untergeschoben' });
      assert.equal(forged.statusCode, 403, forged.body);
    });

    await t.test('Abmelden räumt beide Cookies weg', async () => {
      const fresh = new Client(ctx.app);
      assert.equal((await fresh.post('/api/v1/auth/login', { login: 'admin', password: 'geheim-geheim' })).status, 200);
      const out = await fresh.post('/api/v1/auth/logout');
      const cleared = ([] as string[]).concat((out.headers['set-cookie'] as string[] | string | undefined) ?? []);
      assert.ok(cleared.some((line) => line.startsWith('knowstead_session=;')), cleared.join(' | '));
      assert.ok(cleared.some((line) => line.startsWith('doku_session=;')), cleared.join(' | '));
    });

    await t.test('API-Token mit doku_ gilt weiter, neue beginnen mit knowstead_', async () => {
      const api = new Client(ctx.app);
      api.token = legacyToken;
      const spaces = await api.get('/api/v1/spaces');
      assert.equal(spaces.status, 200, spaces.raw);
      assert.ok(spaces.body.some((s: { key: string }) => s.key === 'ALT'));
      api.token = 'doku_gibt-es-nicht';
      assert.equal((await api.get('/api/v1/spaces')).status, 401);

      const session = new Client(ctx.app);
      await session.post('/api/v1/auth/login', { login: 'admin', password: 'geheim-geheim' });
      const created = await session.post('/api/v1/me/tokens', { name: 'Neu', scopes: ['read'] });
      assert.equal(created.status, 200, created.raw);
      assert.match(created.body.token, /^knowstead_/);
      // In der Liste zum Wiedererkennen: Kennung und sieben Zeichen – nicht nur die Kennung
      const shown: string = created.body.info.prefix;
      assert.equal(shown, created.body.token.slice(0, 'knowstead_'.length + 7));
    });

    await t.test('Sprache über die frühere Kopfzeile X-Doku-Locale', async () => {
      const english = await inject('GET', '/api/v1/pages/999999', { 'x-doku-locale': 'en' });
      const german = await inject('GET', '/api/v1/pages/999999', { 'x-doku-locale': 'de' });
      assert.notEqual(english.json().error.message, german.json().error.message);
      const current = await inject('GET', '/api/v1/pages/999999', { 'x-knowstead-locale': 'en' });
      assert.equal(english.json().error.message, current.json().error.message);
    });

    await t.test('Sicherung enthält doku.db – die Vorversion kann sie zurückspielen', async () => {
      const session = new Client(ctx.app);
      await session.post('/api/v1/auth/login', { login: 'admin', password: 'geheim-geheim' });
      const made = await session.post('/api/v1/admin/backups', {});
      assert.equal(made.status, 200, made.raw);
      const name: string = made.body.name;
      assert.deepEqual(fs.readdirSync(path.join(ctx.s.config.backupsDir, name)).filter((f) => f.endsWith('.db')), ['doku.db']);
      const listed = await session.get('/api/v1/admin/backups');
      assert.ok(listed.body.some((b: { name: string }) => b.name === name), 'Sicherung mit doku.db steht in der Liste');
    });

    await t.test('Webhooks senden beide Sätze Kopfzeilen', async () => {
      const received: http.IncomingHttpHeaders[] = [];
      const bodies: string[] = [];
      const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', () => {
          received.push(req.headers);
          bodies.push(body);
          res.end('ok');
        });
      });
      await new Promise<void>((r) => server.listen(0, r));
      try {
        const session = new Client(ctx.app);
        await session.post('/api/v1/auth/login', { login: 'admin', password: 'geheim-geheim' });
        const hook = await session.post('/api/v1/admin/webhooks', { name: 'Alt und neu', url: `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/hook`, events: ['page.*'] });
        assert.equal(hook.status, 200, hook.raw);
        const ping = await session.post(`/api/v1/admin/webhooks/${hook.body.webhook.id}/test`);
        assert.equal(ping.body.success, true, JSON.stringify(ping.body));
        const headers = received[0];
        for (const name of ['event', 'delivery', 'timestamp', 'signature']) {
          assert.ok(headers[`x-knowstead-${name}`], `x-knowstead-${name}`);
          assert.equal(headers[`x-doku-${name}`], headers[`x-knowstead-${name}`], `x-doku-${name}`);
        }
        const expected = crypto.createHmac('sha256', hook.body.secret).update(`${String(headers['x-doku-timestamp'])}.${bodies[0]}`).digest('hex');
        assert.equal(headers['x-doku-signature'], `sha256=${expected}`, 'ein Empfänger, der die frühere Kopfzeile prüft, kommt zum selben Ergebnis');
      } finally {
        server.close();
      }
    });

    await t.test('Archiv eines Bereichs aus Version 1.9 (doku-space.json) lässt sich einspielen', async () => {
      const session = new Client(ctx.app);
      await session.post('/api/v1/auth/login', { login: 'admin', password: 'geheim-geheim' });
      const exported = await session.get('/api/v1/spaces/ALT/export?format=json');
      assert.equal(exported.status, 200);
      const files = unzipSync(new Uint8Array(exported.bytes));
      assert.ok(files['knowstead-space.json'], 'neue Archive tragen den neuen Namen');
      const meta = JSON.parse(strFromU8(files['knowstead-space.json'])) as { format: string };
      assert.equal(meta.format, 'knowstead-space');
      // So sah dasselbe Archiv bis 1.9 aus
      const legacy: Record<string, Uint8Array> = {};
      for (const [name, data] of Object.entries(files)) {
        if (name === 'knowstead-space.json') legacy['doku-space.json'] = strToU8(JSON.stringify({ ...meta, format: 'doku-space' }));
        else legacy[name] = data;
      }
      const form = multipart({ name: 'alt.zip', data: Buffer.from(zipSync(legacy)) }, { key: 'ALT2', name: 'Aus dem Archiv' });
      const imported = await session.request('POST', '/api/v1/spaces/import-archive', form.body, { 'content-type': form.type });
      assert.equal(imported.status, 200, imported.raw);
      const tree = (await session.get('/api/v1/spaces/ALT2/tree')).body as { title: string }[];
      assert.ok(tree.some((p) => p.title === 'Vor der Umbenennung'), JSON.stringify(tree.map((p) => p.title)));
      // Unbekannte Formate bleiben abgewiesen
      const wrong = { ...legacy, 'doku-space.json': strToU8(JSON.stringify({ ...meta, format: 'etwas-anderes' })) };
      const badForm = multipart({ name: 'falsch.zip', data: Buffer.from(zipSync(wrong)) }, { key: 'ALT3', name: 'Falsch' });
      assert.equal((await session.request('POST', '/api/v1/spaces/import-archive', badForm.body, { 'content-type': badForm.type })).status, 400);
    });
  } finally {
    await ctx.close();
  }
});

test('Name der Installation: nur „Doku“ zieht mit, und nur beim Update von einer Version vor 2.0', async (t) => {
  const start = async (siteName: string, previousVersion: string, handbookDescription?: string) => {
    const first = await createTestApp();
    const admin = new Client(first.app);
    assert.equal((await admin.post('/api/v1/setup', { siteName, username: 'admin', displayName: 'Ada', password: 'geheim-geheim' })).status, 200);
    first.s.settings.setInternal('app:version', previousVersion);
    if (handbookDescription) first.s.db.run("UPDATE spaces SET description = ? WHERE key = 'HANDBUCH'", handbookDescription);
    await first.close({ keepDir: true });
    return createTestApp({ dir: first.dir });
  };

  await t.test('eigener Name bleibt', async () => {
    const ctx = await start('Wissen der Stadtwerke', '1.9.0', 'Unser Handbuch – gepflegt von der IT');
    try {
      assert.equal(ctx.s.settings.get('siteName'), 'Wissen der Stadtwerke');
      assert.equal(ctx.s.db.value("SELECT description FROM spaces WHERE key = 'HANDBUCH'"), 'Unser Handbuch – gepflegt von der IT');
    } finally {
      await ctx.close();
    }
  });

  await t.test('nie geänderter Name (steht nicht in der Datenbank): es gilt die neue Vorgabe', async () => {
    const first = await createTestApp();
    const admin = new Client(first.app);
    assert.equal((await admin.post('/api/v1/setup', { siteName: 'Knowstead', username: 'admin', displayName: 'Ada', password: 'geheim-geheim' })).status, 200);
    assert.equal(first.s.db.value("SELECT COUNT(*) FROM settings WHERE key = 'siteName'"), 0, 'die Vorgabe wird nicht gespeichert – so sah es auch bei „Doku“ aus');
    first.s.settings.setInternal('app:version', '1.9.0');
    await first.close({ keepDir: true });
    const ctx = await createTestApp({ dir: first.dir });
    try {
      assert.equal(ctx.s.settings.get('siteName'), 'Knowstead');
      assert.equal(ctx.s.db.value("SELECT COUNT(*) FROM settings WHERE key = 'siteName'"), 0, 'es wird nichts festgeschrieben');
    } finally {
      await ctx.close();
    }
  });

  await t.test('wer seine Installation später wieder „Doku“ nennt, behält den Namen', async () => {
    const ctx = await start('Doku', '2.0.0-vorab');
    try {
      assert.equal(ctx.s.settings.get('siteName'), 'Doku');
    } finally {
      await ctx.close();
    }
  });
});

test('Update mit Umstellung der Datenbank: Sicherung als doku.db, Rückweg auch mit der Vorversion', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'doku.db');
    const backups = path.join(dir, 'backups');
    const uploads = path.join(dir, 'uploads');
    fs.mkdirSync(uploads);
    // Stand einer früheren Version: nicht alle Migrationen angewendet
    const old = new Db(file);
    const before = MIGRATIONS.slice(0, MIGRATIONS.length - 1);
    migrate(old, () => {}, before);
    old.run("INSERT INTO settings (key, value) VALUES ('internal:app:version', '\"1.9.0\"')");
    old.close();

    const opened = openDatabase(file, { backupsDir: backups, appVersion: '2.0.0' });
    opened.db.close();
    assert.ok(opened.backup, 'Sicherung vor dem Update');
    assert.deepEqual(fs.readdirSync(path.join(backups, opened.backup!)).sort(), ['doku.db', 'manifest.json']);
    // Genau diese Datei sucht die Kommandozeile der Versionen 1.8 und 1.9 beim Zurückspielen
    const snapshot = new DatabaseSync(path.join(backups, opened.backup!, 'doku.db'), { readOnly: true });
    try {
      assert.equal((snapshot.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v, before.at(-1)!.version);
    } finally {
      snapshot.close();
    }

    // Diese Version spielt sie ebenso zurück – die Sicherung des jetzigen Stands heißt wie die laufende Datenbank
    const restored = restoreBackup({ name: opened.backup!, backupsDir: backups, dbFile: file, uploadsDir: uploads });
    assert.ok(restored.safetyBackup);
    assert.deepEqual(fs.readdirSync(path.join(backups, restored.safetyBackup!)).filter((f) => f.endsWith('.db')), ['doku.db']);
    const now = new DatabaseSync(file, { readOnly: true });
    try {
      assert.equal((now.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v, before.at(-1)!.version);
    } finally {
      now.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Stopp-Datei: Server und Kommandozeile verstehen sich über die Umbenennung hinweg', async () => {
  const dir = tempDir('knowstead-stopp-');
  const port = await freePort();
  const env = { ...process.env, KNOWSTEAD_SKIP_ENV_FILE: '1', DATA_DIR: dir, PORT: String(port), HOST: '127.0.0.1', BASE_URL: `http://127.0.0.1:${port}`, NODE_ENV: 'production' };
  const start = () => spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/index.ts'], { cwd: ROOT, env, stdio: 'ignore' });
  const waitUp = async () => {
    for (let i = 0; i < 300; i++) {
      if (await fetch(`http://127.0.0.1:${port}/api/v1/health`).then((r) => r.ok).catch(() => false)) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return false;
  };
  const started: import('node:child_process').ChildProcess[] = [];
  try {
    // Kommandozeile bis 1.9 beendet einen Server ab 2.0: Sie legt doku.stop an
    const server = start();
    started.push(server);
    const exited = new Promise<number | null>((resolve) => server.once('exit', (code) => resolve(code)));
    assert.ok(await waitUp(), 'Server erreichbar');
    fs.writeFileSync(path.join(dir, 'doku.stop'), new Date().toISOString());
    const code = await Promise.race([exited, new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 20_000))]);
    assert.equal(code, 0, 'geordnet beendet');
    assert.equal(fs.existsSync(path.join(dir, 'doku.stop')), false, 'Stopp-Datei aufgeräumt');

    // Kommandozeile ab 2.0 beendet einen Server bis 1.9: Der hält die Datenbank und achtet nur auf doku.stop
    const script = path.join(dir, 'frueherer-server.mjs');
    fs.writeFileSync(
      script,
      [
        "import fs from 'node:fs';",
        "import { pathToFileURL } from 'node:url';",
        'const [lockModule, dbFile, stopFile] = process.argv.slice(2);',
        'const { acquireInstanceLock } = await import(pathToFileURL(lockModule).href);',
        'const lock = acquireInstanceLock(dbFile, 5000);',
        "fs.writeFileSync(stopFile + '.bereit', '');",
        'setInterval(() => {',
        '  if (!fs.existsSync(stopFile)) return;',
        '  fs.rmSync(stopFile);',
        '  lock.release();',
        '  process.exit(0);',
        '}, 100);',
      ].join('\n'),
    );
    const legacyServer = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', script, path.join(ROOT, 'server', 'src', 'db', 'lock.ts'), path.join(dir, 'knowstead.db'), path.join(dir, 'doku.stop')], { cwd: ROOT, env, stdio: 'ignore' });
    started.push(legacyServer);
    const legacyExit = new Promise<number | null>((resolve) => legacyServer.once('exit', (c) => resolve(c)));
    for (let i = 0; i < 100 && !fs.existsSync(path.join(dir, 'doku.stop.bereit')); i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(fs.existsSync(path.join(dir, 'doku.stop.bereit')), 'früherer Server hält die Datenbank');
    const stopped = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/cli.ts', 'stop', '--timeout', '30'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.match(stopped.stdout, /Server beendet/);
    assert.equal(await legacyExit, 0, 'der frühere Server hat seine Stopp-Datei gesehen');
    // Die Datei mit dem neuen Namen kennt der frühere Server nicht – die Kommandozeile räumt sie selbst weg
    for (const name of ['knowstead.stop', 'doku.stop']) assert.equal(fs.existsSync(path.join(dir, name)), false, `${name} aufgeräumt`);
  } finally {
    for (const child of started) if (child.exitCode === null) child.kill();
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
