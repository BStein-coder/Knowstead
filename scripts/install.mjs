#!/usr/bin/env node
/**
 * Installationskern – plattformunabhängig, ohne Rückfragen. Wird von den Assistenten aufgerufen
 * (Windows: Knowstead-Installation.cmd, Linux: install.sh), lässt sich aber auch direkt nutzen:
 *
 *   node scripts/install.mjs --data-dir D:\KnowsteadDaten --port 3000 --base-url https://knowstead.firma.de \
 *        --host 127.0.0.1 --trust-proxy loopback
 *
 * Schritte: Node.js prüfen → .env schreiben (vorhandene Werte und Serverschlüssel bleiben, alte Datei wird
 * gesichert) → Verzeichnisse anlegen → Abhängigkeiten und Oberfläche (scripts/prepare.mjs) → Probestart
 * mit geordnetem Stopp → optionale Zusatzprogramme eintragen → Prüfung (cli doctor).
 *
 * Optionen:
 *   --data-dir <pfad>        Datenverzeichnis (Standard: data im Programmordner)
 *   --port <zahl>            Port (Standard 3000)
 *   --host <adresse>         Netzwerkschnittstelle: 127.0.0.1 (nur Proxy auf diesem Rechner) oder 0.0.0.0
 *   --base-url <url>         öffentliche Adresse, z. B. https://knowstead.firma.de
 *   --trust-proxy <wert>     loopback, IP/Netz des Proxys oder false
 *   --log-file <pfad>        Protokolldatei (relativ zum Datenverzeichnis), z. B. logs/knowstead.log
 *   --service <art>          task | nssm | systemd | docker | none (nur Hinweis für die Administration)
 *   --ocr-path <pfad>        Tesseract eintragen und Texterkennung einschalten
 *   --ocr-languages <kürzel> Sprachen der Texterkennung, z. B. deu+eng – fehlende Sprachdaten werden gemeldet
 *   --office-path <pfad>     LibreOffice (soffice) eintragen und Office-Vorschau einschalten
 *   --report <datei>         Hinweise zu Zusatzprogrammen zusätzlich in diese Datei schreiben, einer je Zeile
 *                            (für install.sh – der Aufrufer zeigt sie dann am Ende selbst)
 *   --env-path <pfad>        abweichende .env (Standard: .env im Programmordner)
 *   --skip-prepare           Abhängigkeiten/Oberfläche nicht prüfen (z. B. fertiges Installationspaket)
 *   --skip-test              keinen Probestart
 *   --dry-run                nur anzeigen, was geschehen würde
 *   --json-progress          Fortschritt zusätzlich als Zeilen „@@KNOWSTEAD {json}“ (für grafische Assistenten)
 *   --lang <de|en>           Sprache der Meldungen (Standard: KNOWSTEAD_LANG, sonst die Sprache des Systems)
 */
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveLanguage, texts } from './lang.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--')) return args[i + 1];
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline ? inline.slice(name.length + 3) : undefined;
};
const flag = (name) => args.includes(`--${name}`);
const dryRun = flag('dry-run');
const jsonProgress = flag('json-progress');

/**
 * Sprache der Meldungen. Beim Einbinden in Tests bleibt es bei Deutsch – erst `main` legt die Sprache fest.
 * @type {'de' | 'en'}
 */
let lang = 'de';
/** Text in der gewählten Sprache: L('deutsch', 'english') */
let L = texts(lang);

function emit(event) {
  if (jsonProgress) console.log(`@@KNOWSTEAD ${JSON.stringify(event)}`);
}
function step(id, title) {
  console.log(`\n  ▸ ${title}`);
  emit({ event: 'step', id, title });
}
function info(message) {
  console.log(`    ${message}`);
}
function fail(message) {
  console.error(`\n  [!] ${message}`);
  emit({ event: 'error', message });
  process.exit(1);
}
/** Hinweis, der die Installation nicht aufhält – steht am Ende noch einmal und geht an die Assistenten. */
const warnings = [];
function warn(message) {
  console.log(`    [!] ${message}`);
  warnings.push(message);
  emit({ event: 'warning', message });
}

/* ------------------------------- .env lesen/schreiben ------------------------------- */

/** Wert so schreiben, dass process.loadEnvFile ihn unverändert liest (Windows-Pfade ohne Escapes). */
export function formatEnvValue(value) {
  const text = String(value);
  if (/[\r\n]/.test(text)) throw new Error(L('Zeilenumbrüche sind in .env-Werten nicht möglich', 'Line breaks are not possible in .env values'));
  const needsQuotes = /#/.test(text) || /^\s|\s$/.test(text) || /^["'`]/.test(text);
  if (!needsQuotes) return text;
  if (!text.includes("'")) return `'${text}'`;
  if (!/["\\]/.test(text)) return `"${text}"`;
  throw new Error(L(`Der Wert ${text} lässt sich nicht in die .env schreiben (Anführungszeichen und #)`, `The value ${text} cannot be written to the .env file (quotation marks and #)`));
}

/** Setzt Schlüssel in einer .env: vorhandene Zeilen werden ersetzt, Kommentare und andere Werte bleiben. */
export function updateEnv(text, values) {
  const lines = text ? text.split(/\r?\n/) : [];
  const done = new Set();
  const out = lines.map((line) => {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match || !(match[1] in values)) return line;
    done.add(match[1]);
    const value = values[match[1]];
    return value === null ? `# ${line.trim()}  (${L('entfernt vom Installationsassistenten', 'removed by the installer')})` : `${match[1]}=${formatEnvValue(value)}`;
  });
  const missing = Object.entries(values).filter(([key, value]) => !done.has(key) && value !== null);
  if (missing.length) {
    if (out.length && out.at(-1) !== '') out.push('');
    out.push(`# ${L('Installationsassistent', 'Installer')} (${new Date().toISOString().slice(0, 10)})`);
    for (const [key, value] of missing) out.push(`${key}=${formatEnvValue(value)}`);
  }
  let result = out.join('\n');
  if (!result.endsWith('\n')) result += '\n';
  return result;
}

/**
 * Einträge aus der Zeit, als Knowstead noch „Doku“ hieß: `DOKU_SECRET=…` wird zu `KNOWSTEAD_SECRET=…` – der
 * Wert bleibt. Gibt es die neue Variable schon, bleibt die alte Zeile stehen (der Server nimmt die neue).
 */
export function renameLegacyEnv(text) {
  const present = new Set(Object.keys(readEnv(text)));
  return (text ?? '')
    .split('\n')
    .map((line) => {
      const match = line.match(/^(\s*(?:export\s+)?)DOKU_([A-Za-z0-9_]*)(\s*=.*)$/s);
      return match && !present.has(`KNOWSTEAD_${match[2]}`) ? `${match[1]}KNOWSTEAD_${match[2]}${match[3]}` : line;
    })
    .join('\n');
}

export function readEnv(text) {
  const values = {};
  for (const line of (text ?? '').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (/^'.*'$/.test(value) || /^".*"$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    values[match[1]] = value;
  }
  return values;
}

/* ------------------------------- Texterkennung: Sprachen ------------------------------- */

/** Wie der Server (modules/attachments/ocr.ts): Tesseract-Kürzel, mit + verbunden, höchstens sechs. */
export const OCR_LANGUAGES = /^[a-z_]{3,20}([+][a-z_]{3,20}){0,5}$/i;

/** Sprachen aus der Ausgabe von `tesseract --list-langs`. „osd“ (Schrift- und Lageerkennung) ist keine Sprache. */
export function parseTesseractLanguages(output) {
  const lines = String(output ?? '')
    .split(/[\r\n]+/)
    .map((line) => line.trim())
    .filter((line) => /^[a-z_]{3,20}$/i.test(line) && line !== 'osd');
  return [...new Set(lines)];
}

/** Von den gewünschten Sprachen bleiben die, die Tesseract kennt – in der gewünschten Reihenfolge. */
export function pickOcrLanguages(wanted, available) {
  const list = String(wanted).split('+').filter(Boolean);
  return { languages: list.filter((lang) => available.includes(lang)).join('+'), missing: list.filter((lang) => !available.includes(lang)) };
}

/**
 * Was wird für die Texterkennung eingetragen? `available` ist die Liste von Tesseract – oder null, wenn sie sich
 * nicht ermitteln ließ. Tesseract bricht bei einer einzigen fehlenden Sprache ganz ab, deshalb kommt nur in die
 * Einstellung, was vorhanden ist; ohne eine einzige der gewünschten Sprachen gibt es nichts einzutragen
 * (`languages: null`). `level: 'warn'` heißt: am Ende der Installation noch einmal zeigen. `language` ist die
 * Sprache der Meldung (Standard Deutsch).
 */
export function planOcrLanguages(wanted, available, language = 'de') {
  const T = texts(language);
  const list = (langs) => langs.split('+').join(', ');
  if (!available) {
    return {
      languages: wanted,
      level: 'info',
      message: T(
        `Vorhandene Sprachdaten ließen sich nicht ermitteln (tesseract --list-langs) – eingetragen wird ${wanted}.`,
        `The installed language data could not be determined (tesseract --list-langs) – ${wanted} will be configured.`,
      ),
    };
  }
  const picked = pickOcrLanguages(wanted, available);
  if (!picked.languages) {
    return {
      languages: null,
      level: 'warn',
      message: T(
        `Tesseract hat keine Sprachdaten für ${list(wanted)} (vorhanden: ${available.join(', ') || 'keine'}) – die Einstellung bleibt unverändert. Sprachdaten installieren oder --ocr-languages anpassen.`,
        `Tesseract has no language data for ${list(wanted)} (available: ${available.join(', ') || 'none'}) – the setting stays unchanged. Install the language data or adjust --ocr-languages.`,
      ),
    };
  }
  if (picked.missing.length) {
    return {
      languages: picked.languages,
      level: 'warn',
      message: T(
        `Sprachdaten fehlen für ${picked.missing.join(', ')} – erkannt wird vorerst nur ${list(picked.languages)}.`,
        `Language data is missing for ${picked.missing.join(', ')} – for now only ${list(picked.languages)} is recognised.`,
      ),
    };
  }
  return { languages: picked.languages, level: 'info', message: T(`Sprachen: ${picked.languages}`, `Languages: ${picked.languages}`) };
}

/* ----------------------------------- Hilfen ----------------------------------- */

function runNode(scriptArgs, env, { capture = false } = {}) {
  const result = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', ...scriptArgs], {
    cwd: root,
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  return result;
}

function portFree(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Meldung der Kommandozeile (deutsch) für die englische Ausgabe übertragen – über denselben Katalog, mit dem
 * der Server seine Antworten übersetzt. Unbekanntes bleibt, wie es ist.
 */
async function localized(message) {
  if (lang !== 'en' || !message) return message;
  try {
    const { translate } = await import('../server/src/core/i18n.ts');
    return translate(message, 'en');
  } catch {
    return message;
  }
}

/* ----------------------------------- Ablauf ----------------------------------- */

async function main() {
  try {
    lang = resolveLanguage(option('lang'));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  }
  L = texts(lang);
  // Was dieser Lauf selbst startet (scripts/prepare.mjs), spricht dieselbe Sprache
  process.env.KNOWSTEAD_LANG = lang;

  console.log(`\n  Knowstead – ${L('Installation', 'installation')}`);

  step('node', L('Node.js prüfen', 'Checking Node.js'));
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24) {
    fail(L(`Node.js ${process.versions.node} ist zu alt – benötigt wird Version 24 oder neuer (https://nodejs.org/).`, `Node.js ${process.versions.node} is too old – version 24 or newer is required (https://nodejs.org/).`));
  }
  info(`Node.js ${process.versions.node}`);
  const ocrLanguages = option('ocr-languages');
  if (ocrLanguages !== undefined && !OCR_LANGUAGES.test(ocrLanguages)) {
    fail(L(`Ungültige Sprachen der Texterkennung: ${ocrLanguages} (Tesseract-Kürzel, z. B. deu+eng)`, `Invalid text recognition languages: ${ocrLanguages} (Tesseract codes, e.g. deu+eng)`));
  }

  step('config', L('Konfiguration schreiben', 'Writing the configuration'));
  const envFile = path.resolve(option('env-path') ?? path.join(root, '.env'));
  const originalText = fs.existsSync(envFile) ? fs.readFileSync(envFile, 'utf8') : null;
  // Einträge einer Installation aus der Zeit vor der Umbenennung (DOKU_…) ziehen unter ihren heutigen Namen um
  // Neue Installation: Vorlage mit Kommentaren in der gewählten Sprache
  const template = lang === 'en' && fs.existsSync(path.join(root, '.env.example.en')) ? '.env.example.en' : '.env.example';
  const existingText = originalText === null ? fs.readFileSync(path.join(root, template), 'utf8') : renameLegacyEnv(originalText);
  if (originalText !== null && existingText !== originalText) info(L('Einträge DOKU_… heißen jetzt KNOWSTEAD_… – die Werte bleiben', 'Entries DOKU_… are now called KNOWSTEAD_… – the values stay'));
  const existing = readEnv(fs.existsSync(envFile) ? existingText : '');
  const port = Number(option('port') ?? existing.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail(L(`Ungültiger Port: ${option('port')}`, `Invalid port: ${option('port')}`));
  const host = option('host') ?? existing.HOST ?? '0.0.0.0';
  if (!net.isIP(host) && host !== 'localhost') {
    fail(L(`Ungültige Netzwerkschnittstelle: ${host} (z. B. 127.0.0.1 oder 0.0.0.0)`, `Invalid network interface: ${host} (e.g. 127.0.0.1 or 0.0.0.0)`));
  }
  const baseUrl = (option('base-url') ?? existing.BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, '');
  try {
    const url = new URL(baseUrl);
    if (!/^https?:$/.test(url.protocol)) throw new Error('Protokoll');
  } catch {
    fail(L(`Ungültige Adresse: ${baseUrl} (z. B. https://knowstead.firma.de)`, `Invalid address: ${baseUrl} (e.g. https://knowstead.example.com)`));
  }
  const dataDir = path.resolve(root, option('data-dir') ?? existing.DATA_DIR ?? 'data');
  if (/^\\\\/.test(dataDir)) {
    fail(L('Das Datenverzeichnis darf nicht auf einer Netzfreigabe liegen (SQLite braucht lokale Dateisperren).', 'The data directory must not be on a network share (SQLite needs local file locks).'));
  }
  const service = option('service') ?? existing.KNOWSTEAD_SERVICE ?? null;
  if (service && !['task', 'nssm', 'systemd', 'docker', 'none'].includes(service)) fail(L(`Unbekannte Betriebsart: ${service}`, `Unknown service type: ${service}`));
  const values = {
    PORT: String(port),
    HOST: host,
    BASE_URL: baseUrl,
    TRUST_PROXY: option('trust-proxy') ?? existing.TRUST_PROXY ?? 'false',
    COOKIE_SECURE: existing.COOKIE_SECURE ?? 'auto',
    DATA_DIR: dataDir,
    LOG_LEVEL: existing.LOG_LEVEL ?? 'info',
    NODE_ENV: 'production',
    ...(option('log-file') !== undefined ? { LOG_FILE: option('log-file') || null } : {}),
    ...(service && service !== 'none' ? { KNOWSTEAD_SERVICE: service } : service === 'none' ? { KNOWSTEAD_SERVICE: null } : {}),
  };
  const nextText = updateEnv(fs.existsSync(envFile) ? existingText : existingText, values);
  for (const [key, value] of Object.entries(values)) info(`${key.padEnd(14)} ${value ?? L('(entfernt)', '(removed)')}`);
  if (existing.KNOWSTEAD_SECRET) info(`KNOWSTEAD_SECRET    ${L('bleibt unverändert', 'stays unchanged')}`);
  if (!dryRun) {
    if (originalText !== null && originalText !== nextText) {
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
      fs.copyFileSync(envFile, `${envFile}.bak-${stamp}`);
      // Kann KNOWSTEAD_SECRET und Zugangsdaten enthalten – nur für den Eigentümer lesbar
      fs.chmodSync(`${envFile}.bak-${stamp}`, 0o600);
      info(L(`Bisherige Konfiguration gesichert: ${path.basename(envFile)}.bak-${stamp}`, `Previous configuration backed up: ${path.basename(envFile)}.bak-${stamp}`));
    }
    fs.writeFileSync(envFile, nextText, { mode: 0o600 });
    info(L(`Geschrieben: ${envFile}`, `Written: ${envFile}`));
  }

  step('dirs', L('Verzeichnisse anlegen', 'Creating directories'));
  const logFile = values.LOG_FILE ?? existing.LOG_FILE;
  const dirs = [dataDir, ...(logFile ? [path.dirname(path.resolve(dataDir, logFile))] : [])];
  for (const dir of dirs) {
    info(dir);
    if (!dryRun) fs.mkdirSync(dir, { recursive: true });
  }
  const relativeData = path.relative(root, dataDir);
  if (relativeData && !relativeData.startsWith('..') && !path.isAbsolute(relativeData)) {
    info(L('Hinweis: Das Datenverzeichnis liegt im Programmordner – für einfache Updates besser außerhalb.', 'Note: the data directory is inside the program folder – for easy updates it is better kept outside.'));
  }

  // Umgebung für Probestart und Prüfung: genau die neue Konfiguration, unabhängig von der Datei
  const env = { ...process.env, ...readEnv(nextText), KNOWSTEAD_SKIP_ENV_FILE: '1' };
  for (const [key, value] of Object.entries(values)) if (value === null) delete env[key];

  if (!flag('skip-prepare')) {
    step('prepare', L('Abhängigkeiten und Oberfläche', 'Dependencies and interface'));
    if (dryRun) info('node scripts/prepare.mjs');
    else if (runNode([path.join('scripts', 'prepare.mjs')], process.env).status !== 0) {
      fail(L('Abhängigkeiten oder Oberfläche konnten nicht vorbereitet werden – Meldungen oben prüfen.', 'Dependencies or interface could not be prepared – check the messages above.'));
    }
  }

  let needsSetup = null;
  if (!flag('skip-test') && !dryRun) {
    step('test', L('Probestart', 'Trial start'));
    // Ohne --lang antwortet die Prüfung auf Deutsch – daran erkennt dieser Lauf (wie update.sh) den laufenden Server
    const doctorBefore = JSON.parse(runNode([path.join('server', 'src', 'cli.ts'), 'doctor', '--json'], env, { capture: true }).stdout || '{}');
    const running = doctorBefore.checks?.find((c) => c.id === 'server')?.message === 'läuft';
    if (running) {
      info(L('Der Server läuft bereits mit diesem Datenverzeichnis – Probestart übersprungen.', 'The server is already running with this data directory – trial start skipped.'));
    } else {
      const testHost = host === '0.0.0.0' ? '127.0.0.1' : host;
      if (!(await portFree(port, host))) {
        fail(L(`Port ${port} ist belegt – bitte einen anderen Port wählen oder das Programm beenden, das ihn nutzt.`, `Port ${port} is in use – please choose another port or stop the program that uses it.`));
      }
      const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join('server', 'src', 'index.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      const exited = new Promise((resolve) => child.once('exit', (code) => resolve(code)));
      let status = null;
      for (let i = 0; i < 240 && child.exitCode === null && !status; i++) {
        status = await fetch(`http://${testHost}:${port}/api/v1/setup/status`)
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (!status) await sleep(250);
      }
      if (!status) {
        if (child.exitCode === null) child.kill();
        console.error(output.split('\n').slice(-20).join('\n'));
        fail(L('Der Probestart ist fehlgeschlagen – die letzten Zeilen des Protokolls stehen oben.', 'The trial start failed – the last lines of the log are shown above.'));
      }
      needsSetup = !!status.needsSetup;
      info(L(`Server antwortet (Knowstead ${status.version}${needsSetup ? ', Ersteinrichtung ausstehend' : ''})`, `Server responds (Knowstead ${status.version}${needsSetup ? ', first-time setup pending' : ''})`));
      fs.writeFileSync(path.join(dataDir, 'knowstead.stop'), 'Probestart');
      let timer;
      const code = await Promise.race([exited, new Promise((resolve) => (timer = setTimeout(() => resolve('timeout'), 30_000)))]);
      clearTimeout(timer);
      if (code === 'timeout') {
        child.kill();
        fail(L('Der Server hat sich nach dem Probestart nicht beendet.', 'The server did not stop after the trial start.'));
      }
      info(L('Probestart beendet', 'Trial start finished'));
    }
  }

  const cli = path.join('server', 'src', 'cli.ts');
  const extras = [
    ['ocr-path', 'ocr', L('Texterkennung', 'Text recognition')],
    ['office-path', 'officePreview', L('Office-Vorschau', 'Office preview')],
  ].filter(([name]) => option(name));
  if (extras.length) {
    step('extras', L('Zusatzprogramme eintragen', 'Configuring the additional programs'));
    // Zusatzprogramme sind keine Voraussetzung: Lässt sich eines nicht eintragen, bleibt seine Einstellung, wie sie
    // ist, und die Installation läuft weiter. Ein Abbruch an dieser Stelle ließe bei einem Update ein angehaltenes
    // Knowstead zurück – wegen einer Funktion, die sich jederzeit in der Administration nachtragen lässt.
    for (const [name, key, label] of extras) {
      const file = option(name);
      info(`${key}: ${file}`);
      if (!fs.existsSync(file)) {
        warn(L(`${label}: ${file} wurde nicht gefunden – die Einstellung bleibt unverändert.`, `${label}: ${file} was not found – the setting stays unchanged.`));
        continue;
      }
      let value = { enabled: true, sofficePath: file };
      if (key === 'ocr') {
        // Welche Sprachen sollen es sein? Angabe des Assistenten, sonst die bisherige Einstellung, sonst Deutsch und Englisch.
        let wanted = ocrLanguages;
        if (!wanted && !dryRun) {
          try {
            wanted = JSON.parse(runNode([cli, 'settings:get', 'ocr'], env, { capture: true }).stdout).languages;
          } catch {
            /* noch keine Datenbank – Standard */
          }
        }
        if (!wanted || !OCR_LANGUAGES.test(wanted)) wanted = 'deu+eng';
        const listed = spawnSync(file, ['--list-langs'], { encoding: 'utf8', timeout: 20_000, windowsHide: true });
        const available = listed.error || listed.status !== 0 ? null : parseTesseractLanguages(`${listed.stdout}\n${listed.stderr}`);
        const plan = planOcrLanguages(wanted, available, lang);
        if (plan.level === 'warn') warn(`${label}: ${plan.message}`);
        else info(`  ${plan.message}`);
        if (!plan.languages) continue;
        value = { enabled: true, tesseractPath: file, languages: plan.languages };
      }
      if (!dryRun) {
        const result = runNode([cli, 'settings:set', key, JSON.stringify(value)], env, { capture: true });
        if (result.status !== 0) {
          // Die letzte Zeile ist die Meldung („Fehler: …“), davor stehen allenfalls Protokollzeilen
          const last = (result.stderr || result.stdout || '').trim().split(/\r?\n/).at(-1)?.replace(/^Fehler:\s*/, '');
          const reason = last ? await localized(last) : L(`Abbruch mit Code ${result.status}`, `exited with code ${result.status}`);
          warn(L(`${label} ließ sich nicht eintragen: ${reason}`, `${label} could not be configured: ${reason}`));
          continue;
        }
        // Schlüssel und Typ stimmen hier immer – „Keine Änderung“ heißt also: stand schon so in den Einstellungen
        const said = result.stdout.trim();
        const unchanged = /^Keine Änderung/.test(said);
        info(unchanged ? L(`${label}: bereits so eingetragen.`, `${label}: already configured this way.`) : L(said, `${label}: saved.`));
      }
    }
  }

  step('doctor', L('Installation prüfen', 'Checking the installation'));
  let checks = [];
  if (!dryRun) {
    const result = runNode([cli, 'doctor', '--json', '--lang', lang], env, { capture: true });
    try {
      checks = JSON.parse(result.stdout).checks;
    } catch {
      fail(L(`Prüfung nicht möglich: ${(result.stderr || result.stdout).trim()}`, `The check could not be run: ${(result.stderr || result.stdout).trim()}`));
    }
    const icon = { ok: '✔', warn: '!', error: '✖' };
    for (const c of checks) {
      info(`${icon[c.status]} ${c.title}: ${c.message}`);
      if (c.hint && c.status !== 'ok') info(`  → ${c.hint}`);
    }
    if (checks.some((c) => c.status === 'error')) {
      emit({ event: 'done', ok: false, checks });
      fail(L('Die Prüfung hat Fehler gefunden – siehe oben.', 'The check found errors – see above.'));
    }
  }

  const reportFile = option('report');
  if (reportFile) {
    fs.writeFileSync(reportFile, warnings.map((line) => `${line}\n`).join(''));
  } else if (warnings.length && !jsonProgress) {
    // Die grafischen Assistenten bekommen die Hinweise mit dem Abschlussereignis und zeigen sie selbst
    console.log(`\n  ${L('Hinweise – Knowstead ist eingerichtet, bei den Zusatzprogrammen blieb etwas offen:', 'Notes – Knowstead is set up, but something remained open with the additional programs:')}`);
    for (const line of warnings) console.log(`    [!] ${line}`);
    console.log(`    → ${L('Nachholen: Administration → KI & Dateien, oder den Assistenten erneut ausführen.', 'To catch up: Administration → AI & files, or run the installer again.')}`);
  }

  const localUrl = `http://localhost:${port}`;
  const closing =
    needsSetup === false
      ? `Knowstead: ${baseUrl}`
      : L(`Ersteinrichtung auf diesem Rechner: ${localUrl}/setup (ohne Einrichtungscode)`, `First-time setup on this computer: ${localUrl}/setup (no setup code needed)`);
  console.log(`\n  ${L('Fertig.', 'Done.')} ${closing}\n`);
  emit({ event: 'done', ok: true, dryRun, envFile, dataDir, port, baseUrl, localUrl, setupUrl: `${localUrl}/setup`, needsSetup, checks, warnings });
}

// Beim Einbinden in Tests nur die Hilfsfunktionen bereitstellen
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
}
