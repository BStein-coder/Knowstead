import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Db } from '../src/db/database.ts';
import { MIGRATIONS, migrate, migrationStatus, type Migration } from '../src/db/migrate.ts';
import { DatabaseVersionError, openDatabase } from '../src/db/upgrade.ts';
import { acquireInstanceLock, InstanceLockError } from '../src/db/lock.ts';
import { restoreBackup } from '../src/db/restore.ts';
import { Client, createTestApp } from './helpers.ts';

const NOW = '2025-03-01T08:00:00.000Z';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-upgrade-'));
}

/** Datenbank im Stand von Knowstead 1.1 (Migrationen 1–3) mit typischen Inhalten. */
function createLegacyDatabase(dir: string): string {
  const file = path.join(dir, 'knowstead.db');
  const db = new Db(file);
  migrate(db, () => {}, MIGRATIONS.slice(0, 3));
  db.run("INSERT INTO users (id, username, display_name, email, created_at, updated_at) VALUES (1, 'anna', 'Anna', 'anna@example.com', ?, ?)", NOW, NOW);
  db.run("INSERT INTO spaces (id, key, name, category, created_at, updated_at) VALUES (1, 'IT', 'IT', 'Abteilungen', ?, ?)", NOW, NOW);
  db.run(
    "INSERT INTO pages (id, space_id, title, content, content_text, version, created_by, updated_by, created_at, updated_at, published_at) VALUES (1, 1, 'Notfallplan', '<p>Wichtig</p>', 'Wichtig', 2, 1, 1, ?, ?, ?)",
    NOW,
    NOW,
    NOW,
  );
  for (const v of [1, 2]) {
    db.run("INSERT INTO page_revisions (page_id, version, title, content_type, content, author_id, created_at) VALUES (1, ?, 'Notfallplan', 'richtext', ?, 1, ?)", v, `<p>Fassung ${v}</p>`, NOW);
  }
  db.run("INSERT INTO attachments (page_id, filename, mime_type, size, storage_key, sha256, created_at) VALUES (1, 'plan.pdf', 'application/pdf', 10, '2025/03/x', 'abc', ?)", NOW);
  // Bis 1.1 gab es nur „secure“ – Migration 004 muss daraus „security“ machen
  db.run("INSERT INTO settings (key, value) VALUES ('smtp', ?)", JSON.stringify({ host: 'mail.example.com', port: 465, secure: true, user: 'knowstead', password: 'v1:geheim' }));
  db.close();
  return file;
}

test('Update ohne Datenverlust', async (t) => {
  await t.test('Ältere Datenbank: Sicherung, vollständige Migration, Daten unverändert', () => {
    const dir = tempDir();
    try {
      const file = createLegacyDatabase(dir);
      const backups = path.join(dir, 'backups');
      const opened = openDatabase(file, { backupsDir: backups, appVersion: '1.2.0' });
      try {
        assert.equal(opened.fromSchema, 3);
        assert.equal(opened.toSchema, MIGRATIONS.at(-1)!.version);
        assert.equal(opened.migrated, MIGRATIONS.length - 3);
        assert.ok(opened.backup, 'Sicherung vor dem Update');

        const db = opened.db;
        assert.equal(db.value('SELECT title FROM pages WHERE id = 1'), 'Notfallplan');
        assert.equal(db.value('SELECT content FROM pages WHERE id = 1'), '<p>Wichtig</p>');
        assert.equal(db.value('SELECT COUNT(*) FROM page_revisions WHERE page_id = 1'), 2);
        assert.equal(db.value('SELECT filename FROM attachments WHERE page_id = 1'), 'plan.pdf');
        assert.equal(db.value("SELECT username FROM users WHERE id = 1"), 'anna');
        // neue Spalten mit sinnvollen Standardwerten, übernommene Kategorie
        assert.equal(db.value('SELECT review_interval_months FROM pages WHERE id = 1'), null);
        assert.equal(db.value("SELECT name FROM space_categories WHERE name = 'Abteilungen'"), 'Abteilungen');
        const smtp = JSON.parse(db.value<string>("SELECT value FROM settings WHERE key = 'smtp'")!);
        assert.equal(smtp.security, 'tls');
        assert.equal(smtp.password, 'v1:geheim', 'Zugangsdaten bleiben erhalten');

        // Die Sicherung enthält den Stand vor dem Update
        const snapshot = new DatabaseSync(path.join(backups, opened.backup!, 'knowstead.db'), { readOnly: true });
        try {
          assert.equal((snapshot.prepare('SELECT MAX(version) AS v FROM schema_migrations').get() as { v: number }).v, 3);
          assert.equal((snapshot.prepare('SELECT COUNT(*) AS n FROM page_revisions').get() as { n: number }).n, 2);
        } finally {
          snapshot.close();
        }
        const manifest = JSON.parse(fs.readFileSync(path.join(backups, opened.backup!, 'manifest.json'), 'utf8'));
        assert.equal(manifest.reason, 'update');
      } finally {
        opened.db.close();
      }

      // Zweiter Start: nichts mehr zu tun, keine weitere Sicherung
      const again = openDatabase(file, { backupsDir: backups, appVersion: '1.2.0' });
      assert.equal(again.migrated, 0);
      assert.equal(again.backup, null);
      again.db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('Neue Installation: keine Sicherung nötig', () => {
    const dir = tempDir();
    try {
      const opened = openDatabase(path.join(dir, 'knowstead.db'), { backupsDir: path.join(dir, 'backups'), appVersion: '1.2.0' });
      assert.equal(opened.backup, null);
      assert.equal(opened.fromSchema, 0);
      opened.db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('Datenbank einer neueren Version: Start wird verweigert', () => {
    const dir = tempDir();
    try {
      const file = createLegacyDatabase(dir);
      const db = new Db(file);
      migrate(db);
      db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (999, 'zukunft', ?)", NOW);
      db.close();
      assert.throws(() => openDatabase(file, { backupsDir: path.join(dir, 'backups'), appVersion: '1.2.0' }), DatabaseVersionError);
      const forced = openDatabase(file, { backupsDir: path.join(dir, 'backups'), appVersion: '1.2.0', allowDowngrade: true });
      assert.equal(forced.migrated, 0);
      forced.db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('Fehlerhafte Migration: alles zurückgerollt, Sicherung vorhanden', () => {
    const dir = tempDir();
    try {
      const file = createLegacyDatabase(dir);
      const broken: Migration[] = [
        ...MIGRATIONS.slice(0, 3),
        { version: 4, name: 'erste', up: (db) => db.exec('CREATE TABLE teil_eins (id INTEGER PRIMARY KEY)') },
        { version: 5, name: 'kaputt', up: (db) => db.exec('ALTER TABLE gibt_es_nicht ADD COLUMN x TEXT') },
      ];
      const backups = path.join(dir, 'backups');
      assert.throws(() => openDatabase(file, { backupsDir: backups, appVersion: '9.9.9', migrations: broken }), /Migration 5 \(kaputt\).*zurückgerollt/);
      const db = new Db(file);
      try {
        assert.equal(migrationStatus(db, broken).current, 3, 'kein Teilstand');
        assert.equal(db.value("SELECT 1 FROM sqlite_master WHERE name = 'teil_eins'"), undefined);
        assert.equal(db.value('SELECT COUNT(*) FROM page_revisions'), 2);
      } finally {
        db.close();
      }
      assert.equal(fs.readdirSync(backups).filter((n) => n.endsWith('-update')).length, 1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('Tabellenumbau in einer Migration verliert keine abhängigen Zeilen', () => {
    const dir = tempDir();
    const db = new Db(path.join(dir, 'knowstead.db'));
    try {
      const base: Migration = {
        version: 1,
        name: 'basis',
        up: (d) =>
          d.exec(`CREATE TABLE parent (id INTEGER PRIMARY KEY);
                  CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id) ON DELETE CASCADE);
                  INSERT INTO parent (id) VALUES (1), (2);
                  INSERT INTO child (id, parent_id) VALUES (1, 1), (2, 1), (3, 2);`),
      };
      migrate(db, () => {}, [base]);
      // Üblicher SQLite-Umbau: neue Tabelle, Daten kopieren, alte löschen, umbenennen
      const rebuild: Migration = {
        version: 2,
        name: 'umbau',
        up: (d) =>
          d.exec(`CREATE TABLE parent_new (id INTEGER PRIMARY KEY, name TEXT NOT NULL DEFAULT '');
                  INSERT INTO parent_new (id) SELECT id FROM parent;
                  DROP TABLE parent;
                  ALTER TABLE parent_new RENAME TO parent;`),
      };
      assert.equal(migrate(db, () => {}, [base, rebuild]), 1);
      assert.equal(db.value('SELECT COUNT(*) FROM child'), 3, 'abhängige Zeilen bleiben erhalten');
      assert.equal(db.value('PRAGMA foreign_keys'), 1, 'Fremdschlüssel danach wieder aktiv');
      assert.throws(() => db.run('INSERT INTO child (id, parent_id) VALUES (9, 99)'), /FOREIGN KEY/);

      // Neue ungültige Verweise rollen das ganze Update zurück
      const broken: Migration = { version: 3, name: 'kaputt', up: (d) => d.exec('INSERT INTO child (id, parent_id) VALUES (4, 42)') };
      assert.throws(() => migrate(db, () => {}, [base, rebuild, broken]), /Ungültige Verweise/);
      assert.equal(db.value('SELECT COUNT(*) FROM child'), 3);
      assert.deepEqual(migrationStatus(db, [base, rebuild, broken]).pending.map((m) => m.version), [3]);
      assert.equal(db.value('PRAGMA foreign_keys'), 1);
    } finally {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  await t.test('Zweiter Server auf derselben Datenbank wird abgewiesen', async () => {
    const ctx = await createTestApp();
    try {
      assert.throws(() => acquireInstanceLock(path.join(ctx.dir, 'knowstead.db'), 0), InstanceLockError);
    } finally {
      await ctx.close({ keepDir: true });
    }
    // nach dem Beenden ist die Datenbank wieder frei
    acquireInstanceLock(path.join(ctx.dir, 'knowstead.db'), 0).release();
    fs.rmSync(ctx.dir, { recursive: true, force: true });
  });

  await t.test('Geänderter Serverschlüssel wird erkannt', async () => {
    const secretA = 'a'.repeat(40);
    const first = await createTestApp({ env: { KNOWSTEAD_SECRET: secretA } });
    await first.close({ keepDir: true });
    try {
      // Update steht an (Migration 011 zurückgenommen) – mit falschem Schlüssel darf nichts passieren
      const raw = new DatabaseSync(path.join(first.dir, 'knowstead.db'));
      raw.exec('DELETE FROM schema_migrations WHERE version = 11; DROP TABLE file_deletions;');
      raw.close();
      await assert.rejects(createTestApp({ dir: first.dir, env: { KNOWSTEAD_SECRET: 'b'.repeat(40) } }), /Serverschlüssel passt nicht/);
      const probe = new Db(path.join(first.dir, 'knowstead.db'));
      assert.deepEqual(migrationStatus(probe).pending.map((m) => m.version), [11], 'nicht migriert');
      probe.close();
      const backupsDir = path.join(first.dir, 'backups');
      assert.equal(fs.existsSync(backupsDir) ? fs.readdirSync(backupsDir).filter((n) => n.endsWith('-update')).length : 0, 0, 'keine Update-Sicherung');
      // gleicher Schlüssel: Start klappt, das Update läuft mit Sicherung
      const again = await createTestApp({ dir: first.dir, env: { KNOWSTEAD_SECRET: secretA } });
      assert.equal(migrationStatus(again.s.db).pending.length, 0);
      assert.equal(fs.readdirSync(backupsDir).filter((n) => n.endsWith('-update')).length, 1);
      await again.close({ keepDir: true });
      // bewusste Übernahme eines neuen Schlüssels
      process.env.KNOWSTEAD_ALLOW_KEY_CHANGE = '1';
      try {
        const changed = await createTestApp({ dir: first.dir, env: { KNOWSTEAD_SECRET: 'b'.repeat(40) } });
        await changed.close({ keepDir: true });
      } finally {
        delete process.env.KNOWSTEAD_ALLOW_KEY_CHANGE;
      }
    } finally {
      fs.rmSync(first.dir, { recursive: true, force: true });
    }
  });

  await t.test('Wiederherstellung einer Sicherung und gelöschte Standardvorlagen', async () => {
    const ctx = await createTestApp();
    const admin = new Client(ctx.app);
    assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
    await admin.post('/api/v1/spaces', { key: 'WIKI', name: 'Wiki', preset: 'open' });
    await admin.post('/api/v1/pages', { spaceKey: 'WIKI', title: 'Vor der Sicherung', content: '<p>a</p>' });
    const backup = await admin.post('/api/v1/admin/backups');
    assert.equal(backup.status, 200, backup.raw);
    await admin.post('/api/v1/pages', { spaceKey: 'WIKI', title: 'Nach der Sicherung', content: '<p>b</p>' });

    // Standardvorlage löschen – darf nach Neustart nicht wiederkommen
    const templates = (await admin.get('/api/v1/templates?scope=global')).body as { id: number; builtin: boolean; name: string }[];
    const builtin = templates.find((tpl) => tpl.builtin)!;
    assert.equal((await admin.del(`/api/v1/templates/${builtin.id}`)).status, 200);
    await ctx.close({ keepDir: true });

    const dbFile = path.join(ctx.dir, 'knowstead.db');
    const lock = acquireInstanceLock(dbFile, 0);
    let safety: string | null;
    try {
      const result = restoreBackup({ name: backup.body.name, backupsDir: path.join(ctx.dir, 'backups'), dbFile, uploadsDir: path.join(ctx.dir, 'uploads') });
      safety = result.safetyBackup;
      assert.ok(safety, 'aktueller Stand wurde vorher gesichert');
      const safetyManifest = JSON.parse(fs.readFileSync(path.join(ctx.dir, 'backups', safety!, 'manifest.json'), 'utf8'));
      assert.ok(safetyManifest.schemaVersion > 0, 'Schemastand der Sicherung vor der Wiederherstellung bekannt');
      assert.equal(fs.existsSync(`${dbFile}-wal`), false);
    } finally {
      lock.release();
    }

    const restarted = await createTestApp({ dir: ctx.dir });
    try {
      const titles = restarted.s.db.all<{ title: string }>("SELECT title FROM pages WHERE space_id = (SELECT id FROM spaces WHERE key = 'WIKI')").map((r) => r.title);
      assert.ok(titles.includes('Vor der Sicherung'));
      assert.ok(!titles.includes('Nach der Sicherung'), 'Stand der Sicherung');
      // Die Sicherung des vorherigen Stands enthält die neuere Seite
      const snapshot = new DatabaseSync(path.join(ctx.dir, 'backups', safety!, 'knowstead.db'), { readOnly: true });
      try {
        assert.ok((snapshot.prepare("SELECT 1 FROM pages WHERE title = 'Nach der Sicherung'").get()));
      } finally {
        snapshot.close();
      }
    } finally {
      await restarted.close({ keepDir: true });
    }

    // Zu neue oder fremde Sicherungen werden abgewiesen, ohne etwas zu verändern
    const backupsDir = path.join(ctx.dir, 'backups');
    const latest = Math.max(...MIGRATIONS.map((m) => m.version));
    assert.throws(() => restoreBackup({ name: backup.body.name, backupsDir, dbFile, uploadsDir: path.join(ctx.dir, 'uploads'), latestSchema: latest - 1 }), /neueren Knowstead-Version/);
    const foreign = path.join(backupsDir, 'backup-20200101-000000');
    fs.mkdirSync(foreign, { recursive: true });
    new DatabaseSync(path.join(foreign, 'knowstead.db')).close();
    assert.throws(() => restoreBackup({ name: 'backup-20200101-000000', backupsDir, dbFile, uploadsDir: path.join(ctx.dir, 'uploads') }), /keine Knowstead-Datenbank/);

    // Beschädigte aktuelle Datenbank: Zurückspielen gelingt trotzdem, die Dateien werden unverändert beiseitegelegt
    const intact = fs.readFileSync(dbFile);
    fs.writeFileSync(dbFile, Buffer.concat([Buffer.from('kaputt'.repeat(20)), intact.subarray(120)]));
    const broken = restoreBackup({ name: backup.body.name, backupsDir, dbFile, uploadsDir: path.join(ctx.dir, 'uploads'), latestSchema: latest });
    assert.ok(broken.safetyBackup);
    assert.ok(fs.readFileSync(path.join(backupsDir, broken.safetyBackup!, 'knowstead.db')).subarray(0, 6).equals(Buffer.from('kaputt')), 'Rohkopie');
    assert.equal(JSON.parse(fs.readFileSync(path.join(backupsDir, broken.safetyBackup!, 'manifest.json'), 'utf8')).rawCopy, true);

    // Vorlage: in der zurückgespielten Datenbank wieder vorhanden (Stand der Sicherung) – erneut löschen und neu starten
    const third = await createTestApp({ dir: ctx.dir });
    const admin3 = new Client(third.app);
    assert.equal((await admin3.post('/api/v1/auth/login', { login: 'admin', password: 'geheim-geheim' })).status, 200);
    const before = ((await admin3.get('/api/v1/templates?scope=global')).body as { id: number; builtin: boolean; name: string }[]).find((tpl) => tpl.name === builtin.name)!;
    assert.equal((await admin3.del(`/api/v1/templates/${before.id}`)).status, 200);
    await third.close({ keepDir: true });
    const fourth = await createTestApp({ dir: ctx.dir });
    try {
      const names = (fourth.s.templates.list(fourth.s.perms.system(), { scope: 'global' })).map((tpl) => tpl.name);
      assert.ok(!names.includes(builtin.name), 'gelöschte Standardvorlage bleibt gelöscht');
    } finally {
      await fourth.close();
    }
  });
});
