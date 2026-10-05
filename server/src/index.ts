import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.ts';
import { STOP_FILES } from './core/service-control.ts';
import { buildApp } from './app.ts';
import { InstanceLockError } from './db/lock.ts';
import { DatabaseVersionError } from './db/upgrade.ts';

const config = loadConfig();
let built: Awaited<ReturnType<typeof buildApp>>;
try {
  built = await buildApp(config);
} catch (err) {
  // Update-Schutz (Sperre, Datenbankversion, Serverschlüssel, Sicherung, Migration): Grund klar benennen
  console.error(`\n  [!] Knowstead wurde nicht gestartet: ${err instanceof Error ? err.message : String(err)}\n`);
  if (!(err instanceof InstanceLockError || err instanceof DatabaseVersionError)) console.error(err);
  process.exit(1);
}
const { app, services } = built;

services.events.emit({ type: 'system.started', data: { version: config.version, node: process.version } });

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Knowstead ${config.version} läuft auf ${config.baseUrl} (API-Dokumentation: ${config.baseUrl}/api/docs)`);
  if (services.users.count() === 0) {
    app.log.info(`Ersteinrichtung: Bitte ${config.baseUrl}/setup im Browser öffnen.`);
    // Zweisprachig, damit die Zeile im Protokoll auch mit »grep -i "setup code"« zu finden ist
    app.log.info(`Einrichtungscode / setup code (nur beim Aufruf von einem anderen Rechner nötig / only needed from another computer): ${services.auth.setupCode()}`);
  }
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

/** Nach dieser Zeit beendet sich der Prozess selbst – vor dem Zeitlimit von systemd (20 s) und Docker (10 s). */
const SHUTDOWN_DEADLINE_MS = 8_000;

let closing = false;
async function shutdown(signal: string) {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} empfangen – fahre herunter …`);
  // Notbremse: Hängt das Beenden, soll der Grund im Protokoll stehen statt in einem stillen SIGKILL. Rückgabewert 0,
  // damit die Aufgabenplanung unter Windows den Dienst nach „cli stop“ nicht als abgestürzt neu startet.
  const deadline = setTimeout(() => {
    app.log.error(`Geordnetes Beenden dauert länger als ${SHUTDOWN_DEADLINE_MS / 1000} s – Prozess wird jetzt beendet`);
    process.exit(0);
  }, SHUTDOWN_DEADLINE_MS);
  try {
    await app.close();
    app.log.info('Beendet.');
  } catch (err) {
    app.log.error(err, 'Fehler beim Beenden');
  } finally {
    clearTimeout(deadline);
    process.exit(0);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

// Hintergrundarbeiten (Mailversand, Webhooks, Anhang-Indexierung) laufen ohne wartenden Aufrufer.
// Schlägt dort ein Versprechen fehl, das niemand auffängt, beendet Node sonst den ganzen Server –
// samt aller offenen Bearbeitungen. Der Fehler gehört ins Protokoll, das Wiki bleibt erreichbar.
process.on('unhandledRejection', (reason) => {
  app.log.error({ err: reason }, 'Unbehandelter Fehler in einer Hintergrundaufgabe – der Server läuft weiter');
});

// Sauberes Beenden ohne Signal (Windows-Aufgabenplanung, Dienste ohne Strg+C): `npm run cli -- stop`
// legt eine Stopp-Datei im Datenverzeichnis an. Eine liegen gebliebene Datei vom letzten Lauf zählt nicht.
const stopFiles = STOP_FILES.map((name) => path.join(config.dataDir, name));
const clearStopFiles = () => stopFiles.forEach((file) => fs.rmSync(file, { force: true }));
clearStopFiles();
setInterval(() => {
  if (!stopFiles.some((file) => fs.existsSync(file))) return;
  clearStopFiles();
  void shutdown('Stopp-Anforderung');
}, 1000).unref();
