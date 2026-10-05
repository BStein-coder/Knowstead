import fs from 'node:fs';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { UserRow } from '../../core/types.ts';
import { localeOfPreferences, translate, type Locale } from '../../core/i18n.ts';
import { restartHint } from '../../core/program.ts';
import { nowIso } from '../../db/database.ts';
import { renderMail, type RenderedMail } from '../mail/templates.ts';

/**
 * Betriebswarnungen: Dinge, die die Administration wissen muss, bevor jemand sie bemerkt – die Sicherung
 * läuft nicht mehr, das Laufwerk ist fast voll, nach einem Update fehlt der Neustart.
 *
 * Der Dienst prüft alle zehn Minuten, zeigt den Stand in Administration → Übersicht, liefert ihn an
 * Überwachungssysteme (`GET /api/v1/monitoring`) und schreibt den Administratorkonten eine E-Mail:
 * sofort beim ersten Auftreten, danach einmal täglich als Erinnerung und zum Schluss die Entwarnung.
 */
export type AlertSeverity = 'warn' | 'error';

export interface Alert {
  id: 'restart' | 'backup-failed' | 'backup-old' | 'disk';
  severity: AlertSeverity;
  title: string;
  message: string;
  /** Was zu tun ist */
  hint: string;
  /** Seit wann die Warnung besteht */
  since: string;
}

interface AlertRecord {
  since: string;
  severity: AlertSeverity;
  title: string;
  /** letzte E-Mail zu dieser Warnung – null, solange noch keine hinausging (z. B. E-Mail-Versand nicht eingerichtet) */
  mailedAt: string | null;
}

/** Letzter Fehlschlag der automatischen Sicherung (setzt `BackupService`, löscht die nächste gelungene Sicherung). */
export const BACKUP_FAILURE_KEY = 'backup:lastFailure';

const STATE_KEY = 'alerts:state';
const CHECK_MS = 10 * 60_000;
const REMIND_MS = 24 * 3600_000;
/** Darunter ist „wenig Platz“ ein Fehler: SQLite braucht Raum für das Protokoll, sonst scheitert das Speichern. */
const CRITICAL_FREE_BYTES = 500 * 1024 ** 2;
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

const size = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1).replace('.', ',')} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

/** Zusätzliche Empfänger aus den Einstellungen: Adressen, durch Komma, Semikolon oder Leerraum getrennt. */
export function parseRecipients(value: string): { valid: string[]; invalid: string[] } {
  const parts = value
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  return { valid: [...new Set(parts.filter((p) => EMAIL_RE.test(p)))], invalid: parts.filter((p) => !EMAIL_RE.test(p)) };
}

export class AlertService {
  private readonly s: Services;
  private timer: NodeJS.Timeout | null = null;
  /** Messfühler – in Tests ersetzbar */
  probes = {
    freeBytes: (): number | null => {
      try {
        const stat = fs.statfsSync(this.s.config.dataDir);
        return Number(stat.bavail) * Number(stat.bsize);
      } catch {
        return null; // Dateisystem liefert keine Angaben
      }
    },
  };

  constructor(s: Services) {
    this.s = s;
  }

  /** Was liegt jetzt vor? Ohne Seiteneffekte – `since` kommt aus dem gemerkten Stand. */
  check(now = new Date()): Alert[] {
    const settings = this.s.settings.get('alerts');
    const state = this.state();
    const found: Omit<Alert, 'since'>[] = [];

    const change = this.s.program.change();
    if (change) {
      found.push({
        id: 'restart',
        severity: change === 'missing' ? 'error' : 'warn',
        title: 'Neustart erforderlich',
        message:
          change === 'missing'
            ? 'Der Programmordner ist nicht mehr vorhanden – Knowstead läuft nur noch aus dem Arbeitsspeicher.'
            : 'Die Programmdateien wurden seit dem Start des Servers ersetzt – Knowstead läuft noch mit dem alten Stand.',
        hint: `Bitte den Dienst neu starten: ${restartHint(this.s.config.service)}`,
      });
    }

    const failure = this.s.settings.getInternal<{ at: string; message: string } | null>(BACKUP_FAILURE_KEY, null);
    if (failure) {
      found.push({
        id: 'backup-failed',
        severity: 'error',
        title: 'Automatische Sicherung fehlgeschlagen',
        message: `Die Sicherung vom ${new Date(failure.at).toLocaleString('de-DE')} ist gescheitert: ${failure.message}`,
        hint: 'Speicherplatz und Rechte im Sicherungsordner prüfen, dann unter Administration → Sicherungen „Jetzt sichern“ ausführen.',
      });
    } else if (this.s.settings.get('backupEnabled') && settings.backupMaxAgeDays > 0) {
      // Ohne Sicherung zählt, seit wann es etwas zu sichern gibt – eine frische Installation warnt nicht sofort
      const newest = this.s.backups.newestAt();
      const reference = newest ?? this.firstUseAt();
      const age = reference ? (now.getTime() - reference.getTime()) / 86_400_000 : 0;
      if (age > settings.backupMaxAgeDays) {
        found.push({
          id: 'backup-old',
          severity: 'warn',
          title: 'Keine aktuelle Sicherung',
          message: newest ? `Die neueste Sicherung ist ${Math.floor(age)} Tage alt.` : 'Es gibt noch keine Sicherung.',
          hint: 'Administration → Sicherungen prüfen: Läuft die tägliche Sicherung, ist genug Speicherplatz frei?',
        });
      }
    }

    const free = settings.diskMinGb > 0 ? this.probes.freeBytes() : null;
    if (free !== null && free < settings.diskMinGb * 1024 ** 3) {
      found.push({
        id: 'disk',
        severity: free < CRITICAL_FREE_BYTES ? 'error' : 'warn',
        title: 'Wenig freier Speicherplatz',
        message: `Auf dem Laufwerk des Datenverzeichnisses sind nur noch ${size(free)} frei.`,
        hint: 'Platz schaffen oder das Laufwerk vergrößern – ohne freien Speicher scheitern Sicherungen, Uploads und schließlich das Speichern.',
      });
    }
    return found.map((a) => ({ ...a, since: state[a.id]?.since ?? now.toISOString() }));
  }

  /** Seit wann wird Knowstead benutzt? (erstes Konto) – null vor der Ersteinrichtung. */
  private firstUseAt(): Date | null {
    const first = this.s.db.value<string>('SELECT MIN(created_at) FROM users');
    return first ? new Date(first) : null;
  }

  private state(): Record<string, AlertRecord> {
    return this.s.settings.getInternal<Record<string, AlertRecord>>(STATE_KEY, {});
  }

  /** Für Administration → Übersicht und Einstellungen – Texte in der Sprache der Anfrage. */
  overview(auth: AuthContext) {
    this.s.perms.requireGlobal(auth, 'admin');
    const locale = auth.locale ?? this.s.settings.get('defaultLocale');
    const tr = (text: string) => translate(text, locale);
    const settings = this.s.settings.get('alerts');
    return {
      alerts: this.check().map((a) => ({ ...a, title: tr(a.title), message: tr(a.message), hint: tr(a.hint) })),
      mail: {
        enabled: settings.email,
        configured: this.s.mailer.isConfigured(),
        recipients: this.recipients().length,
      },
    };
  }

  /** Für Überwachungssysteme: ein Wort zum Gesamtzustand und die Messwerte dahinter. */
  monitoring(auth: AuthContext) {
    this.s.perms.requireGlobal(auth, 'admin');
    const alerts = this.check();
    const newest = this.s.backups.newestAt();
    const failedMails = this.s.db.value<number>("SELECT COUNT(*) FROM mail_queue WHERE status = 'failed'") ?? 0;
    return {
      status: alerts.some((a) => a.severity === 'error') ? ('error' as const) : alerts.length ? ('warn' as const) : ('ok' as const),
      version: this.s.config.version,
      time: nowIso(),
      alerts: alerts.map(({ id, severity, title, message, since }) => ({ id, severity, title, message, since })),
      checks: {
        uptimeSeconds: Math.round(process.uptime()),
        restartRequired: this.s.program.change(),
        diskFreeBytes: this.probes.freeBytes(),
        backupAgeHours: newest ? Math.round(((Date.now() - newest.getTime()) / 3_600_000) * 10) / 10 : null,
        backupFailed: !!this.s.settings.getInternal(BACKUP_FAILURE_KEY, null),
        mailConfigured: this.s.mailer.isConfigured(),
        mailsFailed: failedMails,
      },
    };
  }

  /** Empfänger der Warnungen: aktive Administratorkonten mit E-Mail-Adresse, dazu die Adressen aus den Einstellungen. */
  recipients(): { email: string; locale: Locale; userId: number | null }[] {
    const fallback = this.s.settings.get('defaultLocale');
    const out = new Map<string, { email: string; locale: Locale; userId: number | null }>();
    const users = this.s.db.all<UserRow>("SELECT * FROM users WHERE status = 'active' AND kind != 'bot' AND email IS NOT NULL AND email != ''");
    for (const user of users) {
      if (!user.email || !this.s.users.isAdmin(user.id)) continue;
      out.set(user.email.toLowerCase(), { email: user.email, locale: localeOfPreferences(this.s.users.preferences(user.id), fallback), userId: user.id });
    }
    for (const email of parseRecipients(this.s.settings.get('alerts').recipients).valid) {
      if (!out.has(email.toLowerCase())) out.set(email.toLowerCase(), { email, locale: fallback, userId: null });
    }
    return [...out.values()];
  }

  private mail(kind: 'alert' | 'resolved' | 'test', active: Alert[], resolved: string[], locale: Locale): RenderedMail {
    const site = this.s.settings.get('siteName');
    const subject =
      kind === 'test'
        ? 'Testwarnung'
        : kind === 'resolved'
          ? resolved.length === 1
            ? `Wieder in Ordnung – ${resolved[0]}`
            : 'Wieder in Ordnung'
          : active.length === 1
            ? `Warnung – ${active[0].title}`
            : `${active.length} Warnungen`;
    return renderMail(
      this.s.mail.brand(),
      `${site}: ${subject}`,
      {
        heading: kind === 'test' ? 'Testwarnung' : kind === 'resolved' ? 'Wieder in Ordnung' : active.length === 1 ? active[0].title : `${active.length} Warnungen`,
        paragraphs: [
          kind === 'test'
            ? 'So sieht eine Warnung dieser Knowstead-Instanz aus. Kommt diese E-Mail an, erreichen dich auch die echten.'
            : kind === 'resolved'
              ? 'Diese Warnungen bestehen nicht mehr:'
              : 'Bei dieser Knowstead-Instanz ist etwas zu tun:',
        ],
        items: [
          ...active.map((a) => ({ title: a.title, lines: [a.message, a.hint], url: '/admin' })),
          ...(kind === 'alert' && resolved.length ? [{ title: 'Wieder in Ordnung', lines: resolved, url: '/admin' }] : []),
          ...(kind === 'resolved' ? resolved.map((title) => ({ title, url: '/admin' })) : []),
        ],
        action: { label: 'Übersicht öffnen', url: '/admin' },
        reason: 'Du erhältst diese E-Mail, weil du diese Knowstead-Instanz verwaltest. Die Warnungen lassen sich unter Administration → Einstellungen abschalten.',
      },
      locale,
    );
  }

  private send(kind: 'alert' | 'resolved' | 'test', active: Alert[], resolved: string[]): number {
    let sent = 0;
    for (const to of this.recipients()) {
      if (this.s.mail.enqueue({ to: to.email, mail: this.mail(kind, active, resolved, to.locale), kind: kind === 'test' ? 'alert.test' : 'alert', userId: to.userId })) sent++;
    }
    return sent;
  }

  /** Beispielwarnung an alle Empfänger – zeigt, ob der Weg funktioniert. */
  sendTest(auth: AuthContext): { recipients: number } {
    this.s.perms.requireGlobal(auth, 'admin');
    const sample: Alert = {
      id: 'disk',
      severity: 'warn',
      title: 'Wenig freier Speicherplatz',
      message: `Auf dem Laufwerk des Datenverzeichnisses sind nur noch ${size(1.4 * 1024 ** 3)} frei.`,
      hint: 'Platz schaffen oder das Laufwerk vergrößern – ohne freien Speicher scheitern Sicherungen, Uploads und schließlich das Speichern.',
      since: nowIso(),
    };
    return { recipients: this.send('test', [sample], []) };
  }

  /**
   * Prüfen und melden. Eine E-Mail geht hinaus, wenn eine Warnung neu ist, sich verschärft hat, seit einem Tag
   * besteht (Erinnerung) oder wegfällt (Entwarnung) – nie öfter, auch wenn alle zehn Minuten geprüft wird.
   */
  evaluate(now = new Date()): { alerts: Alert[]; mailed: number } {
    const active = this.check(now);
    const before = this.state();
    const after: Record<string, AlertRecord> = {};
    const mailAllowed = this.s.settings.get('alerts').email && this.s.mailer.isConfigured();
    const due: Alert[] = [];
    for (const alert of active) {
      const known = before[alert.id];
      const escalated = !!known && known.severity === 'warn' && alert.severity === 'error';
      const overdue = !known?.mailedAt || now.getTime() - Date.parse(known.mailedAt) >= REMIND_MS;
      if (!known) this.s.log.warn(`Warnung: ${alert.title} – ${alert.message}`);
      if (!known || escalated || overdue) due.push(alert);
      after[alert.id] = { since: known?.since ?? alert.since, severity: alert.severity, title: alert.title, mailedAt: known?.mailedAt ?? null };
    }
    const gone = Object.entries(before).filter(([id]) => !after[id]);
    for (const [, record] of gone) this.s.log.info(`Warnung behoben: ${record.title}`);
    // Entwarnung nur für Warnungen, über die auch eine E-Mail hinausging
    const resolved = gone.filter(([, record]) => record.mailedAt).map(([, record]) => record.title);

    let mailed = 0;
    if (mailAllowed && (due.length || resolved.length)) {
      mailed = due.length ? this.send('alert', due, resolved) : this.send('resolved', [], resolved);
      if (mailed) for (const alert of due) after[alert.id].mailedAt = now.toISOString();
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) this.s.settings.setInternal(STATE_KEY, after);
    return { alerts: active, mailed };
  }

  /** Bald prüfen – z. B. unmittelbar nach einer gescheiterten Sicherung. */
  kick(): void {
    setImmediate(() => this.safeEvaluate());
  }

  private safeEvaluate(): void {
    try {
      this.evaluate();
    } catch (err) {
      this.s.log.error({ err }, 'Prüfung der Betriebswarnungen fehlgeschlagen');
    }
  }

  schedule(): void {
    this.timer = setInterval(() => this.safeEvaluate(), CHECK_MS);
    this.timer.unref();
    setTimeout(() => this.safeEvaluate(), 90_000).unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
