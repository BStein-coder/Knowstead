import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { Settings } from '../../core/settings.ts';
import { DEFAULT_SETTINGS } from '../../core/settings.ts';
import { schemaVersion } from '../../db/migrate.ts';
import { encryptSecret } from '../../core/crypto.ts';
import { EMAIL_RE } from '../../core/mailer.ts';
import { badRequest } from '../../core/errors.ts';
import { validateExportTemplate } from '../export/template.ts';
import { SOFFICE_NAME } from '../attachments/preview.ts';
import { OCR_LANGUAGES, TESSERACT_NAME } from '../attachments/ocr.ts';
import { parseRecipients } from '../system/alerts.ts';

export class AdminService {
  private readonly s: Services;
  private readonly startedAt = new Date();

  constructor(s: Services) {
    this.s = s;
  }

  stats(auth: AuthContext) {
    this.s.perms.requireGlobal(auth, 'admin');
    const db = this.s.db;
    const count = (sql: string) => db.value<number>(sql) ?? 0;
    const since = new Date(Date.now() - 30 * 86400000).toISOString();
    const activity = db.all<{ day: string; edits: number; views: number }>(
      `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS edits, 0 AS views FROM page_revisions WHERE created_at >= ? GROUP BY day ORDER BY day`,
      since,
    );
    this.s.pages.flushViews();
    const topPages = db.all<{ id: number; title: string; space_id: number; view_count: number }>(
      "SELECT id, title, space_id, view_count FROM pages WHERE deleted_at IS NULL AND status = 'current' ORDER BY view_count DESC LIMIT 10",
    );
    const topContributors = db.all<{ author_id: number; edits: number }>(
      'SELECT author_id, COUNT(*) AS edits FROM page_revisions WHERE created_at >= ? AND author_id IS NOT NULL GROUP BY author_id ORDER BY edits DESC LIMIT 10',
      since,
    );
    const users = this.s.users.refs(topContributors.map((c) => c.author_id));
    let dbSize = 0;
    try {
      dbSize = fs.statSync(this.s.config.dbFile).size;
      const wal = `${this.s.config.dbFile}-wal`;
      if (fs.existsSync(wal)) dbSize += fs.statSync(wal).size;
    } catch {
      /* ignorieren */
    }
    return {
      counts: {
        users: count("SELECT COUNT(*) FROM users WHERE kind = 'user'"),
        activeUsers: count(`SELECT COUNT(*) FROM users WHERE last_login_at >= '${since}'`),
        bots: count("SELECT COUNT(*) FROM users WHERE kind = 'bot'"),
        groups: count('SELECT COUNT(*) FROM groups'),
        spaces: count("SELECT COUNT(*) FROM spaces WHERE kind = 'team'"),
        personalSpaces: count("SELECT COUNT(*) FROM spaces WHERE kind = 'personal'"),
        archivedSpaces: count('SELECT COUNT(*) FROM spaces WHERE archived_at IS NOT NULL'),
        pages: count("SELECT COUNT(*) FROM pages WHERE deleted_at IS NULL AND status = 'current'"),
        drafts: count("SELECT COUNT(*) FROM pages WHERE status = 'draft'"),
        trashed: count('SELECT COUNT(*) FROM pages WHERE deleted_at IS NOT NULL'),
        revisions: count('SELECT COUNT(*) FROM page_revisions'),
        comments: count('SELECT COUNT(*) FROM comments WHERE deleted_at IS NULL'),
        attachments: count('SELECT COUNT(*) FROM attachments WHERE deleted_at IS NULL'),
        templates: count('SELECT COUNT(*) FROM templates'),
        webhooks: count('SELECT COUNT(*) FROM webhooks WHERE active = 1'),
        connectors: count('SELECT COUNT(*) FROM connectors WHERE active = 1'),
        tokens: count('SELECT COUNT(*) FROM api_tokens WHERE revoked_at IS NULL'),
        events: count('SELECT COUNT(*) FROM events'),
      },
      storage: { database: dbSize, attachments: this.s.attachments.totalSize() },
      activity,
      topPages: topPages.map((p) => ({ ...p, url: this.s.pages.url({ id: p.id, title: p.title, space_id: p.space_id }) })),
      topContributors: topContributors.map((c) => ({ user: users.get(c.author_id) ?? null, edits: c.edits })),
    };
  }

  system(auth: AuthContext) {
    this.s.perms.requireGlobal(auth, 'admin');
    const mem = process.memoryUsage();
    return {
      version: this.s.config.version,
      schemaVersion: schemaVersion(this.s.db),
      node: process.version,
      platform: `${os.type()} ${os.release()} (${process.arch})`,
      hostname: os.hostname(),
      startedAt: this.startedAt.toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      memory: { rss: mem.rss, heapUsed: mem.heapUsed },
      dataDir: this.s.config.dataDir,
      pluginsDir: this.s.config.pluginsDir,
      baseUrl: this.s.config.baseUrl,
      sqlite: this.s.db.value<string>('SELECT sqlite_version()'),
      realtime: this.s.realtime.stats(),
      pluginsLoaded: this.s.plugins.loadedCount(),
      mailConfigured: this.s.mailer.isConfigured(),
      /** Betriebsart laut Installationsassistent (task, nssm, systemd, docker) */
      service: this.s.config.service,
      logFile: this.s.config.logFile,
      /** Bauzeitpunkt des Installationspakets – zeigt nach einem Update, welcher Stand läuft */
      packageBuiltAt: this.s.config.packageBuiltAt,
      /** Programmdateien seit dem Start ersetzt oder entfernt – der Server läuft noch mit dem alten Stand */
      restartRequired: this.s.program.change(),
    };
  }

  getSettings(auth: AuthContext): Settings {
    this.s.perms.requireGlobal(auth, 'admin');
    const all = structuredClone(this.s.settings.all());
    all.smtp = { ...all.smtp, password: all.smtp.password ? '••••••••' : '' };
    all.directory = { ...all.directory, bindPassword: all.directory.bindPassword ? '••••••••' : '' };
    all.ai = { ...all.ai, apiKey: all.ai.apiKey ? '••••••••' : '' };
    this.s.sso.maskSettings(all);
    return all;
  }

  updateSettings(auth: AuthContext, patch: Partial<Settings>): Settings {
    this.s.perms.requireGlobal(auth, 'admin');
    const clean: Partial<Settings> = { ...patch };
    if (clean.smtp) {
      const current = this.s.settings.get('smtp');
      const password = clean.smtp.password;
      const merged = {
        ...DEFAULT_SETTINGS.smtp,
        ...current,
        ...clean.smtp,
        host: String(clean.smtp.host ?? current.host).trim(),
        from: String(clean.smtp.from ?? current.from).trim(),
        replyTo: String(clean.smtp.replyTo ?? current.replyTo ?? '').trim(),
        user: String(clean.smtp.user ?? current.user).trim(),
        port: Number(clean.smtp.port ?? current.port),
        password: password === undefined || password === '••••••••' ? current.password : password ? encryptSecret(this.s.config.secret, password) : '',
      };
      // Älteres Feld `secure` weiter befüllen (z. B. für eigene Skripte)
      if (!['starttls', 'tls', 'none'].includes(merged.security)) merged.security = clean.smtp.secure ? 'tls' : 'starttls';
      merged.secure = merged.security === 'tls';
      merged.rejectUnauthorized = merged.rejectUnauthorized !== false;
      if (!Number.isInteger(merged.port) || merged.port < 1 || merged.port > 65535) throw badRequest('Ungültiger SMTP-Port (1–65535)');
      if (merged.host && !/^[a-z0-9.-]+$/i.test(merged.host) && !/^\[?[0-9a-f:.]+\]?$/i.test(merged.host)) throw badRequest('Ungültiger SMTP-Servername');
      const fromAddress = merged.from.includes('<') ? merged.from.slice(merged.from.indexOf('<') + 1, merged.from.lastIndexOf('>')) : merged.from;
      if (merged.from && !EMAIL_RE.test(fromAddress.trim())) throw badRequest('Die Absenderadresse ist keine gültige E-Mail-Adresse');
      if (merged.replyTo && !EMAIL_RE.test(merged.replyTo)) throw badRequest('Die Antwortadresse ist keine gültige E-Mail-Adresse');
      clean.smtp = merged;
    }
    if (clean.mailDigestHour !== undefined && (!Number.isInteger(clean.mailDigestHour) || clean.mailDigestHour < 0 || clean.mailDigestHour > 23)) {
      throw badRequest('Uhrzeit der Zusammenfassung: 0–23');
    }
    if (clean.directory) {
      const current = this.s.settings.get('directory');
      const password = clean.directory.bindPassword;
      clean.directory = {
        ...DEFAULT_SETTINGS.directory,
        ...current,
        ...clean.directory,
        bindPassword:
          password === undefined || password === '••••••••' ? current.bindPassword : password ? encryptSecret(this.s.config.secret, password) : '',
      };
      if (clean.directory.enabled && (!clean.directory.url.trim() || !clean.directory.baseDn.trim())) {
        throw badRequest('Für die Verzeichnisanmeldung sind Server-URL und Basis-DN erforderlich');
      }
      if (clean.directory.url && !/^ldaps?:\/\//i.test(clean.directory.url.trim())) {
        throw badRequest('Die Server-URL muss mit ldap:// oder ldaps:// beginnen');
      }
      if (clean.directory.userFilter && !clean.directory.userFilter.includes('{login}')) {
        throw badRequest('Der Benutzerfilter muss den Platzhalter {login} enthalten');
      }
    }
    this.s.sso.prepareSettings(clean);
    if (clean.showLocalLogin !== undefined) clean.showLocalLogin = clean.showLocalLogin !== false;
    if (clean.ai) {
      const current = this.s.settings.get('ai');
      const key = clean.ai.apiKey;
      clean.ai = {
        ...DEFAULT_SETTINGS.ai,
        ...current,
        ...clean.ai,
        apiKey: key === undefined || key === '••••••••' ? current.apiKey : key ? encryptSecret(this.s.config.secret, key) : '',
      };
      const ai = clean.ai;
      if (!['anthropic', 'openai', 'azure', 'ollama', 'custom'].includes(ai.provider)) throw badRequest('Unbekannter KI-Anbieter');
      if (ai.baseUrl && !/^https?:\/\//i.test(ai.baseUrl.trim())) throw badRequest('Die Basis-URL der KI muss mit http:// oder https:// beginnen');
      if ((ai.provider === 'azure' || ai.provider === 'custom' || ai.provider === 'ollama') && ai.enabled && !ai.baseUrl.trim()) {
        throw badRequest('Für diesen Anbieter ist eine Basis-URL erforderlich');
      }
      ai.maxTokens = Math.max(100, Math.min(32000, Math.round(Number(ai.maxTokens) || 2000)));
      ai.temperature = Math.max(0, Math.min(2, Number(ai.temperature) || 0));
      ai.dailyLimit = Math.max(0, Math.min(10000, Math.round(Number(ai.dailyLimit) || 0)));
      ai.actions = Array.isArray(ai.actions) ? ai.actions.filter((a) => typeof a === 'string').slice(0, 20) : DEFAULT_SETTINGS.ai.actions;
    }
    if (clean.drawioUrl !== undefined) {
      const value = clean.drawioUrl.trim().replace(/\/+$/, '');
      if (!/^https:\/\/[^\s/]+/i.test(value) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(value)) {
        throw badRequest('Die draw.io-Adresse muss mit https:// beginnen');
      }
      clean.drawioUrl = value;
    }
    if (clean.officePreview) {
      const current = this.s.settings.get('officePreview');
      clean.officePreview = { ...current, ...clean.officePreview, sofficePath: (clean.officePreview.sofficePath ?? current.sofficePath).trim() };
      const sofficePath = clean.officePreview.sofficePath;
      if (sofficePath && !SOFFICE_NAME.test(path.basename(sofficePath))) {
        throw badRequest('Als Konverter ist nur LibreOffice (soffice, soffice.exe) erlaubt');
      }
    }
    let requeueOcr = false;
    if (clean.ocr) {
      const current = this.s.settings.get('ocr');
      const ocr = { ...current, ...clean.ocr };
      ocr.tesseractPath = String(ocr.tesseractPath ?? '').trim();
      ocr.languages = String(ocr.languages ?? '').trim() || 'deu+eng';
      ocr.maxPages = Math.max(1, Math.min(200, Math.round(Number(ocr.maxPages) || 30)));
      ocr.enabled = !!ocr.enabled;
      if (ocr.tesseractPath && !TESSERACT_NAME.test(path.basename(ocr.tesseractPath))) throw badRequest('Für die Texterkennung ist nur Tesseract (tesseract, tesseract.exe) erlaubt');
      if (!OCR_LANGUAGES.test(ocr.languages)) throw badRequest('OCR-Sprachen bitte als Tesseract-Kürzel angeben, z. B. deu+eng');
      requeueOcr = ocr.enabled && !current.enabled;
      clean.ocr = ocr;
    }
    if (clean.allowedEmbedHosts !== undefined) {
      // Die Hosts landen in der Content-Security-Policy – nur echte Hostnamen zulassen
      const hosts = (Array.isArray(clean.allowedEmbedHosts) ? clean.allowedEmbedHosts : []).map((h) => String(h).trim().toLowerCase()).filter(Boolean);
      const invalid = hosts.find((h) => !/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*(:\d{1,5})?$/.test(h));
      if (invalid) throw badRequest(`Ungültiger Host für Einbettungen: ${invalid}`);
      clean.allowedEmbedHosts = [...new Set(hosts)];
    }
    const ranges: [keyof Settings, number, number, string][] = [
      ['sessionDays', 1, 365, 'Sitzungsdauer: 1–365 Tage'],
      ['maxLoginAttempts', 3, 100, 'Fehlversuche bis zur Sperre: 3–100'],
      ['lockMinutes', 1, 1440, 'Sperrdauer: 1–1440 Minuten'],
      ['trashRetentionDays', 0, 3650, 'Papierkorb-Frist: 0–3650 Tage'],
      ['revisionLimit', 0, 100000, 'Versionslimit: 0–100000'],
      ['eventRetentionDays', 0, 3650, 'Protokollaufbewahrung: 0–3650 Tage'],
      ['backupKeep', 1, 365, 'Anzahl Sicherungen: 1–365'],
    ];
    for (const [key, min, max, message] of ranges) {
      const value = clean[key];
      if (value === undefined || !Object.hasOwn(DEFAULT_SETTINGS, key)) continue;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw badRequest(message);
    }
    if (clean.realtimeCollaboration !== undefined) clean.realtimeCollaboration = clean.realtimeCollaboration === true;
    if (clean.exportTemplate) clean.exportTemplate = validateExportTemplate({ ...this.s.settings.get('exportTemplate'), ...clean.exportTemplate });
    if (clean.accentColor !== undefined && !/^#[0-9a-f]{6}$/i.test(clean.accentColor)) throw badRequest('Ungültige Akzentfarbe');
    if (clean.uiMotion !== undefined && clean.uiMotion !== 'full' && clean.uiMotion !== 'reduced') throw badRequest('Bewegung und Effekte: „full“ oder „reduced“');
    if (clean.passwordMinLength !== undefined && (clean.passwordMinLength < 6 || clean.passwordMinLength > 128)) {
      throw badRequest('Die Mindestlänge muss zwischen 6 und 128 liegen');
    }
    if (clean.maxUploadMb !== undefined && (clean.maxUploadMb < 1 || clean.maxUploadMb > 2048)) throw badRequest('Upload-Grenze: 1–2048 MB');
    if (clean.backupHour !== undefined && (clean.backupHour < 0 || clean.backupHour > 23)) throw badRequest('Stunde: 0–23');
    if (clean.alerts) {
      const alerts = { ...this.s.settings.get('alerts'), ...clean.alerts };
      alerts.email = alerts.email === true;
      alerts.recipients = String(alerts.recipients ?? '').trim();
      const parsed = parseRecipients(alerts.recipients);
      if (parsed.invalid.length) throw badRequest(`Ungültige E-Mail-Adresse bei den Empfängern der Warnungen: ${parsed.invalid[0]}`);
      if (parsed.valid.length > 20) throw badRequest('Höchstens 20 zusätzliche Empfänger für Warnungen');
      alerts.recipients = parsed.valid.join(', ');
      if (!Number.isFinite(alerts.diskMinGb) || alerts.diskMinGb < 0 || alerts.diskMinGb > 1000) throw badRequest('Warnung bei wenig Speicherplatz: 0–1000 GB');
      if (!Number.isInteger(alerts.backupMaxAgeDays) || alerts.backupMaxAgeDays < 0 || alerts.backupMaxAgeDays > 60) throw badRequest('Warnung bei alter Sicherung: 0–60 Tage');
      clean.alerts = alerts;
    }
    const changed = this.s.settings.update(clean);
    if (requeueOcr) this.s.attachmentText.requeueForOcr();
    if (changed.length) {
      this.s.emit(auth, {
        type: 'settings.updated',
        target: { type: 'settings', id: 'system', label: 'Systemeinstellungen' },
        data: { keys: changed },
      });
    }
    return this.getSettings(auth);
  }

  async testMail(auth: AuthContext, to: string): Promise<void> {
    await this.s.mail.sendTest(auth, to);
  }

  /** Wartungsaufgaben, die auch periodisch laufen. */
  runMaintenance(auth: AuthContext | null, task: 'reindex' | 'reindex-attachments' | 'vacuum' | 'purge-trash' | 'prune-events' | 'cleanup-sessions') {
    if (auth) this.s.perms.requireGlobal(auth, 'admin');
    let result: Record<string, unknown>;
    switch (task) {
      case 'reindex':
        result = { pages: this.s.search.rebuildTexts() };
        break;
      case 'reindex-attachments':
        result = this.s.attachmentText.reindexAll();
        break;
      case 'vacuum':
        this.s.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        this.s.db.exec('VACUUM');
        result = { ok: true };
        break;
      case 'purge-trash':
        result = {
          purged: this.s.trash.purgeExpired(),
          tasks: this.s.taskTrash.purgeExpired(),
          attachments: this.s.attachments.purgeExpiredDeleted(),
          files: this.s.attachments.purgeRemovedFiles(),
        };
        break;
      case 'prune-events':
        result = { deleted: this.s.activity.pruneOld(), mails: this.s.mail.prune(), analytics: this.s.analytics.prune() };
        break;
      case 'cleanup-sessions':
        result = {
          sessions: this.s.db.run('DELETE FROM sessions WHERE expires_at < ?', new Date().toISOString()).changes,
          signInFlows: this.s.sso.prune(),
          resets: this.s.db.run('DELETE FROM password_resets WHERE expires_at < ?', new Date().toISOString()).changes,
          unverifiedRegistrations: this.s.auth.pruneUnverifiedRegistrations(),
        };
        break;
      default:
        throw badRequest('Unbekannte Wartungsaufgabe');
    }
    if (auth) this.s.emit(auth, { type: 'maintenance.run', target: { type: 'maintenance', id: task, label: task }, data: result });
    return result;
  }

  scheduleMaintenance(): NodeJS.Timeout {
    const run = () => {
      try {
        this.runMaintenance(null, 'purge-trash');
        this.runMaintenance(null, 'prune-events');
        this.runMaintenance(null, 'cleanup-sessions');
      } catch (err) {
        this.s.log.error({ err }, 'Wartung fehlgeschlagen');
      }
    };
    const timer = setInterval(run, 6 * 3600_000);
    timer.unref();
    setTimeout(run, 30_000).unref();
    return timer;
  }
}
