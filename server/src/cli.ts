/**
 * Verwaltungswerkzeug für die Kommandozeile.
 *   npm run cli -- help
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { consoleLogger, createServices } from './services.ts';
import { syncHandbook } from './seed/index.ts';
import type { UserRow } from './core/types.ts';
import { Db } from './db/database.ts';
import { acquireInstanceLock, InstanceLockError, type InstanceLock } from './db/lock.ts';
import { MIGRATIONS, migrationStatus } from './db/migrate.ts';
import { BACKUP_NAME_RE, inspectBackupDatabase, restoreBackup } from './db/restore.ts';
import { findBackupDb } from './core/legacy.ts';
import { STOP_FILES } from './core/service-control.ts';
import { describeProgram, readRunningProgram, runDoctor } from './modules/system/doctor.ts';
import type { Locale } from './core/i18n.ts';
import { restartHint, runningIsCurrent } from './core/program.ts';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';

function option(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--')) return args[idx + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
}

function flag(name: string): boolean {
  return args.includes(`--${name}`);
}

function positional(index: number): string | undefined {
  return args.filter((a, i) => i > 0 && !a.startsWith('--') && !args[i - 1]?.startsWith('--'))[index];
}

const HELP = `Knowstead – Verwaltungswerkzeug

Befehle:
  user:list                                 Alle Benutzer anzeigen
  user:create --username U --name "N" [--email E] [--password P] [--admin]
                                            Benutzer anlegen (ohne --password wird eines erzeugt)
  user:password <benutzer> [--password P]   Passwort setzen (ohne --password wird eines erzeugt)
  user:admin <benutzer>                     Benutzer zur Administratorgruppe hinzufügen
  user:unlock <benutzer>                    Anmeldesperre aufheben, Konto aktivieren und freischalten
  status                                    Version, Datenbankstand, ausstehende Migrationen, Sicherungen
  doctor [--json] [--lang en]               Installation prüfen (Node.js, Oberfläche, Datenverzeichnis, Port,
                                            Adresse, Datenbank, Sicherungen) – Rückgabewert 1 bei Fehlern
  stop [--timeout 30]                       Laufenden Server sauber beenden (auch ohne Konsole, z. B. als
                                            geplante Aufgabe) und warten, bis er beendet ist
  backup                                    Sicherung erstellen (Datenbank + ggf. Anhänge)
  backup:list                               Sicherungen auflisten
  restore <sicherung> [--with-uploads]      Sicherung zurückspielen (Server muss beendet sein;
                                            der aktuelle Stand wird vorher gesichert)
  reindex                                   Suchindex neu aufbauen
  handbook:sync                             Handbuch nach einem Update ergänzen (von Hand geänderte Kapitel bleiben)
  migrate                                   Datenbankmigrationen ausführen (mit Sicherung vorab)
  settings:get [schlüssel]                  Einstellungen anzeigen
  settings:set <schlüssel> <json-wert>      Einstellung setzen, z. B. settings:set allowRegistration true
  help                                      Diese Hilfe
`;

function generatePassword(): string {
  return crypto.randomBytes(12).toString('base64url');
}

async function main() {
  if (command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }
  const config = loadConfig();
  if (command === 'status') return status(config);
  if (command === 'doctor') return doctor(config);
  if (command === 'stop') return stop(config);
  if (command === 'backup:list') return listBackups(config);
  if (command === 'restore') return restore(config);

  const s = createServices(config, consoleLogger(), { instanceLock: 'optional' });
  const system = s.perms.system();
  try {
    switch (command) {
      case 'migrate':
        console.log(`Datenbank ist auf dem aktuellen Stand (Schema ${migrationStatus(s.db).current}).`);
        break;
      case 'user:list': {
        const { items } = s.users.list({ limit: 1000 });
        for (const u of items) {
          console.log(`${String(u.id).padStart(4)}  ${u.username.padEnd(20)} ${u.displayName.padEnd(28)} ${u.status.padEnd(9)} ${u.isAdmin ? 'Admin' : ''} ${u.kind === 'bot' ? 'Bot' : ''}`);
        }
        break;
      }
      case 'user:create': {
        const username = option('username');
        if (!username) throw new Error('--username fehlt');
        const password = option('password') ?? generatePassword();
        const groupIds = flag('admin') ? [s.groups.systemGroup('admin')!.id] : [];
        const user = s.users.create({ username, displayName: option('name') ?? username, email: option('email') ?? null, password, groupIds }, system);
        console.log(`Benutzer „${user.username}“ angelegt (ID ${user.id}).`);
        if (!option('password')) console.log(`Passwort: ${password}`);
        break;
      }
      case 'user:password': {
        const name = positional(0);
        const user = name ? s.users.byUsername(name) : undefined;
        if (!user) throw new Error('Benutzer nicht gefunden');
        const password = option('password') ?? generatePassword();
        s.users.setPassword(user.id, password);
        s.db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
        s.events.emit({ type: 'auth.password_changed', target: { type: 'user', id: user.id, label: user.username }, data: { via: 'cli' } });
        console.log(`Passwort für „${user.username}“ gesetzt.${option('password') ? '' : ` Neues Passwort: ${password}`}`);
        break;
      }
      case 'user:admin': {
        const name = positional(0);
        const user = name ? s.users.byUsername(name) : undefined;
        if (!user) throw new Error('Benutzer nicht gefunden');
        const group = s.groups.systemGroup('admin')!;
        s.db.run('INSERT OR IGNORE INTO group_members (group_id, user_id, added_at) VALUES (?, ?, ?)', group.id, user.id, new Date().toISOString());
        s.db.run("UPDATE users SET status = 'active' WHERE id = ?", user.id);
        s.events.emit({ type: 'group.members_changed', target: { type: 'group', id: group.id, label: group.name }, data: { added: [user.id], via: 'cli' } });
        console.log(`„${user.username}“ ist jetzt Administrator.`);
        break;
      }
      case 'user:unlock': {
        const name = positional(0);
        const user = name ? s.users.byUsername(name) : undefined;
        if (!user) throw new Error('Benutzer nicht gefunden');
        s.db.run("UPDATE users SET failed_logins = 0, locked_until = NULL, status = 'active', registration_pending_at = NULL WHERE id = ?", user.id);
        console.log(`„${user.username}“ entsperrt.`);
        break;
      }
      case 'backup': {
        const info = await s.backups.create(null, 'cli');
        console.log(`Sicherung erstellt: ${info.name} (${Math.round(info.size / 1024)} KB) in ${config.backupsDir}`);
        break;
      }
      case 'reindex':
        console.log(`${s.search.rebuildTexts()} Seiten neu berechnet und indiziert.`);
        break;
      case 'handbook:sync': {
        // Neue Versionen der Kapitel erscheinen unter dem ersten aktiven Administratorkonto
        const adminGroup = s.groups.systemGroup('admin');
        const actor = adminGroup
          ? s.db.get<UserRow>(
              "SELECT u.* FROM users u JOIN group_members m ON m.user_id = u.id WHERE m.group_id = ? AND u.status = 'active' ORDER BY u.id LIMIT 1",
              adminGroup.id,
            )
          : undefined;
        if (!actor) throw new Error('Kein aktives Administratorkonto gefunden – bitte zuerst die Ersteinrichtung abschließen.');
        const result = await syncHandbook(s, s.perms.forUser(actor, { via: 'system' }));
        console.log(`Handbuch: ${result.created} Kapitel angelegt, ${result.updated} aktualisiert, ${result.skipped} von Hand geändert und daher unverändert.`);
        break;
      }
      case 'settings:get': {
        const key = positional(0);
        const all = s.settings.all() as unknown as Record<string, unknown>;
        console.log(JSON.stringify(key ? all[key] : { ...all, smtp: { ...(all.smtp as object), password: '***' } }, null, 2));
        break;
      }
      case 'settings:set': {
        const key = positional(0);
        const raw = positional(1);
        if (!key || raw === undefined) throw new Error('Aufruf: settings:set <schlüssel> <json-wert>');
        let value: unknown;
        try {
          value = JSON.parse(raw);
        } catch {
          value = raw;
        }
        // Über die Administration: gleiche Prüfungen, Zusammenführung von Objekten und Verschlüsselung von Passwörtern
        const before = JSON.stringify((s.settings.all() as unknown as Record<string, unknown>)[key]);
        s.admin.updateSettings(system, { [key]: value } as never);
        const after = JSON.stringify((s.settings.all() as unknown as Record<string, unknown>)[key]);
        console.log(before !== after ? `„${key}“ gespeichert.` : 'Keine Änderung (unbekannter Schlüssel, falscher Typ oder gleicher Wert).');
        break;
      }
      default:
        console.log(`Unbekannter Befehl: ${command}\n`);
        console.log(HELP);
        process.exitCode = 1;
    }
  } finally {
    s.db.close();
  }
}

type Config = ReturnType<typeof loadConfig>;

function formatSize(bytes: number): string {
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}

function backupNames(config: Config): string[] {
  if (!fs.existsSync(config.backupsDir)) return [];
  return fs
    .readdirSync(config.backupsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && BACKUP_NAME_RE.test(e.name))
    .map((e) => e.name)
    .sort()
    .reverse();
}

function serverRunning(config: Config): boolean {
  try {
    acquireInstanceLock(config.dbFile, 0).release();
    return false;
  } catch (err) {
    if (err instanceof InstanceLockError) return true;
    throw err;
  }
}

/** „1.6.0 (Paket vom 15.09.2026, 17:50)“ – zwei Pakete derselben Version unterscheidet nur der Bauzeitpunkt. */
function versionLine(config: Config, locale: Locale = 'de'): string {
  if (!config.packageBuiltAt) return config.version;
  return locale === 'en'
    ? `${config.version} (package of ${new Date(config.packageBuiltAt).toLocaleString('en-GB')})`
    : `${config.version} (Paket vom ${new Date(config.packageBuiltAt).toLocaleString('de-DE')})`;
}

function status(config: Config): void {
  console.log(`Knowstead ${versionLine(config)}`);
  console.log(`Datenverzeichnis:  ${config.dataDir}`);
  if (!fs.existsSync(config.dbFile)) {
    console.log('Datenbank:         noch nicht angelegt (Ersteinrichtung ausstehend)');
    return;
  }
  const db = new Db(config.dbFile);
  // Mit welchem Stand der Server gestartet wurde (fängt Lesefehler selbst ab)
  const runningProgram = readRunningProgram(db);
  try {
    const st = migrationStatus(db);
    let lastVersion = '';
    try {
      lastVersion = JSON.parse(db.value<string>("SELECT value FROM settings WHERE key = 'internal:app:version'") ?? '""') as string;
    } catch {
      lastVersion = '';
    }
    console.log(`Datenbank:         ${config.dbFile} (${formatSize(fs.statSync(config.dbFile).size)})`);
    console.log(`Schema:            ${st.current} von ${st.latest}${lastVersion ? ` – zuletzt gestartet mit Knowstead ${lastVersion}` : ''}`);
    if (st.unknown.length) console.log(`WARNUNG:           Datenbank ist neuer als dieses Programm (unbekannte Migrationen ${st.unknown.join(', ')})`);
    console.log(
      st.pending.length
        ? `Ausstehend:        ${st.pending.map((m) => `${m.version} ${m.name}`).join(', ')} – werden beim nächsten Start nach einer automatischen Sicherung angewendet`
        : 'Ausstehend:        keine Migrationen',
    );
  } finally {
    db.close();
  }
  const running = serverRunning(config);
  console.log(`Server läuft:      ${running ? 'ja' : 'nein'}`);
  // Update eingespielt, Dienst aber nicht neu gestartet: Der laufende Server arbeitet noch mit dem alten Stand
  if (running && !runningIsCurrent(runningProgram, config)) {
    console.log(
      runningProgram
        ? `ACHTUNG:           Der laufende Server arbeitet noch mit ${describeProgram(runningProgram.version, runningProgram.builtAt)}.`
        : 'ACHTUNG:           Der laufende Server wurde vor dem Einspielen dieses Programmstands gestartet.',
    );
    console.log(`                   Bitte den Dienst neu starten: ${restartHint(config.service)}`);
  }
  const names = backupNames(config);
  console.log(`Sicherungen:       ${names.length}${names[0] ? ` (neueste: ${names[0]})` : ''}`);
}

function listBackups(config: Config): void {
  const names = backupNames(config);
  if (!names.length) {
    console.log(`Keine Sicherungen in ${config.backupsDir}`);
    return;
  }
  for (const name of names) {
    const dir = path.join(config.backupsDir, name);
    let manifest: { reason?: string; includeUploads?: boolean; schemaVersion?: number } = {};
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    } catch {
      /* ältere Sicherung ohne Manifest */
    }
    const file = findBackupDb(dir);
    const size = file ? formatSize(fs.statSync(file).size) : '–';
    console.log(`${name.padEnd(32)} ${String(manifest.reason ?? '').padEnd(22)} Schema ${String(manifest.schemaVersion ?? '?').padEnd(4)} ${size.padStart(9)}${manifest.includeUploads ? '  + Anhänge' : ''}`);
  }
}

async function doctor(config: Config): Promise<void> {
  // Die Vorgabe bleibt Deutsch, unabhängig von der Sprache des Systems: update.sh und die Installationsassistenten
  // werten einzelne Meldungen aus. Englisch gibt es nur auf ausdrücklichen Wunsch.
  const requested = option('lang') ?? 'de';
  if (requested !== 'de' && requested !== 'en') throw new Error(`Unbekannte Sprache / unknown language: ${requested} (de, en)`);
  const locale: Locale = requested;
  const L = (de: string, en: string) => (locale === 'en' ? en : de);
  const checks = await runDoctor(config, locale);
  const failed = checks.some((c) => c.status === 'error');
  if (flag('json')) {
    console.log(JSON.stringify({ ok: !failed, version: config.version, packageBuiltAt: config.packageBuiltAt, checks }, null, 2));
  } else {
    console.log(`Knowstead ${versionLine(config, locale)} – ${L('Prüfung der Installation', 'installation check')}\n`);
    const icon = { ok: '  ✔', warn: '  !', error: '  ✖' } as const;
    for (const c of checks) {
      console.log(`${icon[c.status]} ${c.title.padEnd(24)} ${c.message}`);
      if (c.hint && c.status !== 'ok') console.log(`${' '.repeat(29)}→ ${c.hint}`);
    }
    const warnings = checks.filter((c) => c.status === 'warn').length;
    console.log(`\n${failed ? L('Fehler gefunden', 'Errors found') : warnings ? L(`In Ordnung, ${warnings} Hinweis(e)`, `All right, ${warnings} note(s)`) : L('Alles in Ordnung', 'Everything is in order')}.`);
  }
  if (failed) process.exitCode = 1;
}

/** Laufenden Server über die Stopp-Datei beenden und warten, bis die Datenbank frei ist. */
async function stop(config: Config): Promise<void> {
  if (!serverRunning(config)) {
    console.log('Der Server läuft nicht.');
    return;
  }
  const timeout = Math.max(1, Number(option('timeout') ?? 30)) * 1000;
  // Beide Namen: Der laufende Server kann einer aus der Zeit vor der Umbenennung sein (Update, Rückkehr)
  const stopFiles = STOP_FILES.map((name) => path.join(config.dataDir, name));
  const clearStopFiles = () => stopFiles.forEach((file) => fs.rmSync(file, { force: true }));
  for (const file of stopFiles) fs.writeFileSync(file, new Date().toISOString());
  const started = Date.now();
  while (Date.now() - started < timeout) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!serverRunning(config)) {
      // Der Server räumt nur die Datei weg, die er kennt
      clearStopFiles();
      console.log(`Server beendet (${((Date.now() - started) / 1000).toFixed(1)} s).`);
      return;
    }
  }
  clearStopFiles();
  throw new Error(`Der Server hat sich nach ${timeout / 1000} s nicht beendet.`);
}

function restore(config: Config): void {
  const name = positional(0);
  if (!name) throw new Error('Aufruf: restore <sicherung> [--with-uploads] – Namen mit „backup:list“ anzeigen');
  const withUploads = flag('with-uploads');
  const file = BACKUP_NAME_RE.test(name) ? findBackupDb(path.join(config.backupsDir, name)) : null;
  if (file) {
    const inspected = inspectBackupDatabase(file);
    console.log(`Sicherung ${name}: Prüfung ${inspected.ok ? 'in Ordnung' : `FEHLGESCHLAGEN (${inspected.message})`}, Schema ${inspected.schemaVersion}`);
  }
  let lock: InstanceLock;
  try {
    lock = acquireInstanceLock(config.dbFile, 2000);
  } catch (err) {
    if (err instanceof InstanceLockError) throw new Error('Der Knowstead-Server läuft noch. Bitte zuerst den Dienst beenden, dann die Wiederherstellung starten.', { cause: err });
    throw err;
  }
  try {
    const result = restoreBackup({
      name,
      backupsDir: config.backupsDir,
      dbFile: config.dbFile,
      uploadsDir: config.uploadsDir,
      withUploads,
      latestSchema: Math.max(...MIGRATIONS.map((m) => m.version)),
    });
    if (result.safetyBackup) console.log(`Bisheriger Stand gesichert als ${result.safetyBackup}`);
    console.log(`Datenbank aus ${name} zurückgespielt (Schema ${result.schemaVersion}).`);
    console.log(withUploads ? `${result.uploadsCopied} Anhänge zurückkopiert.` : 'Anhänge wurden nicht verändert (bei Bedarf --with-uploads).');
    console.log('Jetzt den Server starten – ausstehende Migrationen werden dabei automatisch angewendet.');
  } finally {
    lock.release();
  }
}

main().catch((err) => {
  console.error(`Fehler: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
