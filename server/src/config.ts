import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { LEGACY_PACKAGE_INFO_FILE, PACKAGE_INFO_FILE, adoptLegacyEnv, defaultDbFile } from './core/legacy.ts';

/**
 * Zentrale Konfiguration. Werte kommen aus Umgebungsvariablen bzw. einer
 * optionalen `.env`-Datei im Projektstammverzeichnis (siehe `.env.example`).
 */
export interface Config {
  rootDir: string;
  version: string;
  port: number;
  host: string;
  baseUrl: string;
  dataDir: string;
  dbFile: string;
  uploadsDir: string;
  backupsDir: string;
  pluginsDir: string;
  webDistDir: string;
  logLevel: string;
  /** Protokolldatei mit Rotation (`LOG_FILE`, relativ zum Datenverzeichnis) – sonst nur Konsole */
  logFile: string | null;
  /** Wie der Server gestartet wurde (`KNOWSTEAD_SERVICE`: task, nssm, systemd, docker) – für Hinweise in der Administration */
  service: string | null;
  /** Wann das eingespielte Installationspaket gebaut wurde – zeigt nach einem Update, welcher Stand läuft */
  packageBuiltAt: string | null;
  /** `true` = jedem Proxy-Header glauben, sonst Liste vertrauenswürdiger Proxy-Adressen (IP, CIDR, `loopback`, `uniquelocal` …) */
  trustProxy: boolean | string;
  cookieSecure: 'auto' | boolean;
  secret: Buffer;
  isProduction: boolean;
  isTest: boolean;
}

export const ROOT_DIR = path.resolve(import.meta.dirname, '..', '..');

function readVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/**
 * Zeitpunkt aus `.knowstead-package.json` (legt `scripts/package.mjs` ins Paket). Zwei Pakete derselben Version
 * lassen sich sonst nicht unterscheiden – nach einem Update ist das die Antwort auf „läuft der neue Stand?“.
 * Aus dem Quelltext installiert gibt es die Datei nicht.
 */
export function packageBuiltAt(rootDir: string): string | null {
  // Pakete bis 1.9 legten die Datei unter dem früheren Namen ab
  for (const name of [PACKAGE_INFO_FILE, LEGACY_PACKAGE_INFO_FILE]) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(rootDir, name), 'utf8')) as { builtAt?: unknown };
      if (typeof info.builtAt === 'string' && !Number.isNaN(Date.parse(info.builtAt))) return info.builtAt;
    } catch {
      /* Datei fehlt oder ist beschädigt: nächste versuchen */
    }
  }
  return null;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'ja', 'on'].includes(value.toLowerCase());
}

const PROXY_TRUST_ITEM = /^(loopback|linklocal|uniquelocal|[0-9a-f:.]+(\/\d{1,3})?)$/i;

/**
 * TRUST_PROXY: `true`/`false` oder die Adressen der vorgeschalteten Proxys. Mit einer Liste werten
 * Server und Ratenbegrenzung `X-Forwarded-For` nur von diesen Adressen aus – wer den Port direkt
 * erreicht, kann sich dann keine fremde Client-Adresse geben. Unbekannte Werte gelten wie bisher als `false`.
 */
function trustProxy(value: string | undefined): boolean | string {
  if (value === undefined || value.trim() === '') return false;
  if (bool(value, false)) return true;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length && items.every((item) => PROXY_TRUST_ITEM.test(item)) ? items.join(',') : false;
}

function resolveDir(value: string | undefined, fallback: string): string {
  const dir = value && value.trim() !== '' ? value.trim() : fallback;
  // Immer normalisieren (Trennzeichen, „..“, Schrägstrich am Ende): Verzeichnisse werden an mehreren Stellen mit
  // startsWith(dir + path.sep) auf Enthaltensein geprüft – ein „/var/lib/knowstead/“ aus der .env darf daran nicht scheitern.
  return path.resolve(ROOT_DIR, dir);
}

/** Lädt bzw. erzeugt den Server-Schlüssel für Verschlüsselung und Signaturen. */
function loadSecret(dataDir: string, envSecret: string | undefined): Buffer {
  if (envSecret && envSecret.length >= 16) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  const file = path.join(dataDir, 'secret.key');
  if (fs.existsSync(file)) {
    const raw = fs.readFileSync(file, 'utf8').trim();
    const key = Buffer.from(raw, 'hex');
    if (key.length !== 32 || !/^[0-9a-f]+$/i.test(raw)) {
      throw new Error(`${file} ist beschädigt (erwartet: 64 Hex-Zeichen). Bitte die Datei aus einer Sicherung wiederherstellen.`);
    }
    return key;
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
  return key;
}

export function loadConfig(overrides: Partial<Record<string, string>> = {}): Config {
  const envFile = path.join(ROOT_DIR, '.env');
  if (fs.existsSync(envFile) && !process.env.KNOWSTEAD_SKIP_ENV_FILE) {
    process.loadEnvFile(envFile);
  }
  // Einträge aus der Zeit vor der Umbenennung (DOKU_SECRET, DOKU_SERVICE …) gelten weiter
  adoptLegacyEnv();
  const env = { ...process.env, ...overrides };

  const dataDir = resolveDir(env.DATA_DIR, 'data');
  const uploadsDir = path.join(dataDir, 'uploads');
  const backupsDir = path.join(dataDir, 'backups');
  for (const dir of [dataDir, uploadsDir, backupsDir]) fs.mkdirSync(dir, { recursive: true });

  const port = Number(env.PORT ?? 3000);
  const host = env.HOST ?? '0.0.0.0';
  const cookieSecureRaw = (env.COOKIE_SECURE ?? 'auto').toLowerCase();

  return {
    rootDir: ROOT_DIR,
    version: readVersion(),
    packageBuiltAt: packageBuiltAt(ROOT_DIR),
    port,
    host,
    baseUrl: (env.BASE_URL ?? `http://localhost:${port}`).replace(/\/+$/, ''),
    dataDir,
    dbFile: env.DB_FILE ? resolveDir(env.DB_FILE, 'data/knowstead.db') : defaultDbFile(dataDir),
    uploadsDir,
    backupsDir,
    pluginsDir: resolveDir(env.PLUGINS_DIR, 'plugins'),
    webDistDir: resolveDir(env.WEB_DIST_DIR, 'web/dist'),
    logLevel: env.LOG_LEVEL ?? 'info',
    logFile: env.LOG_FILE?.trim() ? (path.isAbsolute(env.LOG_FILE.trim()) ? env.LOG_FILE.trim() : path.join(dataDir, env.LOG_FILE.trim())) : null,
    service: env.KNOWSTEAD_SERVICE?.trim() || null,
    trustProxy: trustProxy(env.TRUST_PROXY),
    cookieSecure: cookieSecureRaw === 'auto' ? 'auto' : bool(cookieSecureRaw, false),
    secret: loadSecret(dataDir, env.KNOWSTEAD_SECRET),
    isProduction: env.NODE_ENV === 'production',
    isTest: env.NODE_ENV === 'test',
  };
}
