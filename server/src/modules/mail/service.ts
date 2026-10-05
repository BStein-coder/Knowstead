/**
 * E-Mail-Versand über eine Warteschlange.
 *
 * Mails werden nie im Anfrage-Kontext verschickt: Fachdienste legen sie in
 * `mail_queue` ab, ein Hintergrundlauf versendet sie über eine wiederverwendete
 * SMTP-Verbindung und wiederholt Fehlversuche mit wachsendem Abstand. So bleibt
 * die Oberfläche schnell, auch wenn eine Seitenänderung an hunderte Beobachter geht,
 * und Administratoren sehen im Versandprotokoll, was passiert ist.
 */
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso, parseJson } from '../../db/database.ts';
import { EMAIL_RE, describeMailError } from '../../core/mailer.ts';
import { HttpError, badRequest, notFound } from '../../core/errors.ts';
import { renderMail, type MailBrand, type RenderedMail } from './templates.ts';
import { localeOfPreferences } from '../../core/i18n.ts';

export type EmailMode = 'instant' | 'daily' | 'off';

export interface MailRow {
  id: number;
  recipient: string;
  user_id: number | null;
  kind: string;
  subject: string;
  text_body: string;
  html_body: string | null;
  status: 'queued' | 'sending' | 'sent' | 'failed';
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_attempt_at: string;
  sent_at: string | null;
}

export interface MailDto {
  id: number;
  recipient: string;
  kind: string;
  subject: string;
  status: MailRow['status'];
  attempts: number;
  lastError: string | null;
  createdAt: string;
  nextAttemptAt: string;
  sentAt: string | null;
}

/** Benachrichtigungen, die eine Person direkt betreffen (für „nur Persönliches“). */
export const PERSONAL_TYPES = new Set([
  'mention',
  'comment.reply',
  'review.requested',
  'review.approved',
  'review.rejected',
  'task.assigned',
  'task.due',
  'task.overdue',
  'page.review_due',
  'page.review_overdue',
  'page.owner_assigned',
  'read.required',
  'read.due',
  'read.overdue',
  'review.stage_approved',
  'deputy.assigned',
  'page.suggestions',
]);

const MAX_ATTEMPTS = 5;
/** Abstand bis zum nächsten Versuch nach dem n-ten Fehlschlag (Minuten) */
const BACKOFF_MINUTES = [1, 5, 30, 120];
const BATCH = 20;
const PARALLEL = 4;

export function emailModeOf(prefs: Record<string, unknown>): EmailMode {
  const mode = prefs.emailMode;
  if (mode === 'instant' || mode === 'daily' || mode === 'off') return mode;
  return prefs.emailNotifications === false ? 'off' : 'instant';
}

function localDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export class MailService {
  private readonly s: Services;
  private processing: Promise<void> | null = null;
  private again = false;
  private timers: NodeJS.Timeout[] = [];

  constructor(s: Services) {
    this.s = s;
  }

  /** Hintergrundläufe: Warteschlange alle 20 s, Zusammenfassungen alle 5 min prüfen. */
  start(): void {
    // Nach einem Absturz „hängende“ Mails wieder einreihen
    this.s.db.run("UPDATE mail_queue SET status = 'queued' WHERE status = 'sending'");
    const queue = setInterval(() => void this.processQueue(), 20_000);
    const digest = setInterval(() => void this.sendDigests().catch((err) => this.s.log.warn({ err }, 'Tägliche Zusammenfassung fehlgeschlagen')), 5 * 60_000);
    queue.unref();
    digest.unref();
    this.timers.push(queue, digest);
    void this.processQueue();
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.s.mailer.close();
  }

  brand(): MailBrand {
    return { siteName: this.s.settings.get('siteName'), accent: this.s.settings.get('accentColor'), baseUrl: this.s.config.baseUrl };
  }

  /** Benachrichtigungen per E-Mail sind global aktiv und SMTP ist eingerichtet. */
  notificationsEnabled(): boolean {
    return this.s.settings.get('emailNotifications') && this.s.mailer.isConfigured();
  }

  /* ------------------------------ Einreihen ------------------------------ */

  enqueue(input: { to: string; mail: RenderedMail; kind: string; userId?: number | null }): number | null {
    const to = input.to.trim();
    if (!EMAIL_RE.test(to)) return null;
    const now = nowIso();
    const id = this.s.db.run(
      `INSERT INTO mail_queue (recipient, user_id, kind, subject, text_body, html_body, status, created_at, next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', ?, ?)`,
      to,
      input.userId ?? null,
      input.kind,
      input.mail.subject.slice(0, 250),
      input.mail.text,
      input.mail.html,
      now,
      now,
    ).lastInsertRowid;
    this.kick();
    return id;
  }

  /** Benachrichtigung für eine Person – beachtet globale Schalter und persönliche Einstellungen. */
  notify(userId: number, n: { type: string; title: string; body?: string; link: string }): void {
    if (!this.notificationsEnabled()) return;
    const user = this.s.users.get(userId);
    if (!user?.email || user.status !== 'active' || user.kind === 'bot') return;
    const prefs = this.s.users.preferences(user.id);
    if (emailModeOf(prefs) !== 'instant') return;
    if (prefs.emailOnlyMentions === true && !PERSONAL_TYPES.has(n.type)) return;
    const site = this.s.settings.get('siteName');
    const mail = renderMail(
      this.brand(),
      `${site}: ${n.title}`,
      {
        heading: n.title,
        quote: n.body?.trim() || undefined,
        action: { label: 'In Knowstead öffnen', url: n.link },
        reason: 'Du erhältst diese E-Mail, weil du Inhalte beobachtest, erwähnt wurdest oder dir etwas zugewiesen wurde.',
      },
      localeOfPreferences(prefs, this.s.settings.get('defaultLocale')),
    );
    this.enqueue({ to: user.email, mail, kind: n.type, userId: user.id });
  }

  private kick(): void {
    if (!this.s.mailer.isConfigured()) return;
    setImmediate(() => void this.processQueue());
  }

  /* ------------------------------ Versand ------------------------------ */

  /** Sendet alle fälligen Mails. Parallele Aufrufe teilen sich einen Lauf. */
  processQueue(): Promise<void> {
    if (this.processing) {
      this.again = true;
      return this.processing;
    }
    this.processing = (async () => {
      do {
        this.again = false;
        await this.runOnce();
      } while (this.again);
    })()
      .catch((err) => this.s.log.error({ err }, 'E-Mail-Warteschlange unterbrochen'))
      .finally(() => {
        this.processing = null;
      });
    return this.processing;
  }

  private async runOnce(): Promise<void> {
    if (!this.s.mailer.isConfigured()) return;
    for (let round = 0; round < 50; round++) {
      const due = this.s.db.all<MailRow>(
        "SELECT * FROM mail_queue WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY id LIMIT ?",
        nowIso(),
        BATCH,
      );
      if (!due.length) return;
      for (let i = 0; i < due.length; i += PARALLEL) {
        await Promise.all(due.slice(i, i + PARALLEL).map((m) => this.deliver(m)));
      }
    }
  }

  private async deliver(m: MailRow): Promise<void> {
    this.s.db.run("UPDATE mail_queue SET status = 'sending' WHERE id = ?", m.id);
    const attempts = m.attempts + 1;
    try {
      await this.s.mailer.send({ to: m.recipient, subject: m.subject, text: m.text_body, html: m.html_body ?? undefined });
      this.s.db.run("UPDATE mail_queue SET status = 'sent', attempts = ?, sent_at = ?, last_error = NULL WHERE id = ?", attempts, nowIso(), m.id);
    } catch (err) {
      const message = describeMailError(err);
      if (attempts >= MAX_ATTEMPTS) {
        this.s.db.run("UPDATE mail_queue SET status = 'failed', attempts = ?, last_error = ? WHERE id = ?", attempts, message, m.id);
      } else {
        const next = new Date(Date.now() + BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] * 60_000).toISOString();
        this.s.db.run("UPDATE mail_queue SET status = 'queued', attempts = ?, last_error = ?, next_attempt_at = ? WHERE id = ?", attempts, message, next, m.id);
      }
      this.s.log.warn({ err, mail: m.id }, 'E-Mail-Versand fehlgeschlagen');
    }
  }

  /* ------------------------------ Zusammenfassungen ------------------------------ */

  /**
   * Tägliche Zusammenfassung für alle, die „täglich“ gewählt haben: ungelesene
   * Benachrichtigungen seit der letzten Zusammenfassung (höchstens 24 h zurück).
   */
  async sendDigests(options: { force?: boolean } = {}): Promise<number> {
    if (!this.notificationsEnabled()) return 0;
    const today = localDay();
    if (!options.force) {
      if (new Date().getHours() < this.s.settings.get('mailDigestHour')) return 0;
      if (this.s.settings.getInternal('mail:digestDay', '') === today) return 0;
    }
    this.s.settings.setInternal('mail:digestDay', today);
    const users = this.s.db.all<{ id: number; email: string; display_name: string; preferences: string }>(
      "SELECT id, email, display_name, preferences FROM users WHERE status = 'active' AND kind != 'bot' AND email IS NOT NULL AND email != ''",
    );
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const site = this.s.settings.get('siteName');
    let sent = 0;
    for (const user of users) {
      const prefs = parseJson<Record<string, unknown>>(user.preferences, {});
      if (emailModeOf(prefs) !== 'daily') continue;
      const last = this.s.db.value<string>('SELECT last_sent_at FROM mail_digests WHERE user_id = ?', user.id);
      const since = last && last > dayAgo ? last : dayAgo;
      // Wer seit der Benachrichtigung den Zugriff verloren hat, bekommt Titel und Text nicht nachträglich per Mail
      const account = this.s.users.get(user.id);
      if (account) this.s.notifications.withdrawInvisible(this.s.perms.forUser(account));
      let notes = this.s.db.all<{ type: string; title: string; link: string; created_at: string }>(
        'SELECT type, title, link, created_at FROM notifications WHERE user_id = ? AND read_at IS NULL AND created_at > ? ORDER BY created_at DESC LIMIT 60',
        user.id,
        since,
      );
      if (prefs.emailOnlyMentions === true) notes = notes.filter((n) => PERSONAL_TYPES.has(n.type));
      if (!notes.length) continue;
      const mail = renderMail(this.brand(), `${site}: ${notes.length === 1 ? '1 neue Benachrichtigung' : `${notes.length} neue Benachrichtigungen`}`, {
        heading: `Guten Morgen, ${user.display_name}`,
        paragraphs: [notes.length === 1 ? 'Seit der letzten Zusammenfassung ist eine Sache passiert:' : `Seit der letzten Zusammenfassung ist einiges (${notes.length}) passiert:`],
        items: notes.slice(0, 40).map((n) => ({
          title: n.title,
          meta: new Date(n.created_at).toLocaleString(localeOfPreferences(prefs, 'de') === 'en' ? 'en-GB' : 'de-DE', { dateStyle: 'short', timeStyle: 'short' }),
          url: n.link,
        })),
        action: { label: 'Alle Benachrichtigungen', url: '/notifications' },
        reason: 'Du erhältst diese tägliche Zusammenfassung, weil du sie in deinem Profil gewählt hast.',
      }, localeOfPreferences(prefs, this.s.settings.get('defaultLocale')));
      if (this.enqueue({ to: user.email, mail, kind: 'digest', userId: user.id })) {
        this.s.db.run(
          'INSERT INTO mail_digests (user_id, last_sent_at) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET last_sent_at = excluded.last_sent_at',
          user.id,
          nowIso(),
        );
        sent++;
      }
    }
    return sent;
  }

  /* ------------------------------ Administration ------------------------------ */

  private toDto(r: MailRow): MailDto {
    return {
      id: r.id,
      recipient: r.recipient,
      kind: r.kind,
      subject: r.subject,
      status: r.status,
      attempts: r.attempts,
      lastError: r.last_error,
      createdAt: r.created_at,
      nextAttemptAt: r.next_attempt_at,
      sentAt: r.sent_at,
    };
  }

  overview(auth: AuthContext, filter: { status?: string; q?: string; limit?: number; offset?: number }) {
    this.s.perms.requireGlobal(auth, 'admin');
    const where: string[] = [];
    const params: (string | number)[] = [];
    if (filter.status && ['queued', 'sending', 'sent', 'failed'].includes(filter.status)) {
      where.push('status = ?');
      params.push(filter.status);
    }
    if (filter.q?.trim()) {
      where.push('(recipient LIKE ? OR subject LIKE ?)');
      const like = `%${filter.q.trim().replace(/[%_]/g, '')}%`;
      params.push(like, like);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(filter.limit ?? 50, 200);
    const offset = filter.offset ?? 0;
    const items = this.s.db
      .all<MailRow>(`SELECT * FROM mail_queue ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, offset)
      .map((r) => this.toDto(r));
    const total = this.s.db.value<number>(`SELECT COUNT(*) FROM mail_queue ${clause}`, ...params) ?? 0;
    const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
    const stats = this.s.db.get<{ queued: number; failed: number; sent24h: number; failed24h: number }>(
      `SELECT COALESCE(SUM(CASE WHEN status IN ('queued', 'sending') THEN 1 ELSE 0 END), 0) AS queued,
              COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed,
              COALESCE(SUM(CASE WHEN status = 'sent' AND sent_at >= ? THEN 1 ELSE 0 END), 0) AS sent24h,
              COALESCE(SUM(CASE WHEN status = 'failed' AND created_at >= ? THEN 1 ELSE 0 END), 0) AS failed24h
         FROM mail_queue`,
      dayAgo,
      dayAgo,
    ) ?? { queued: 0, failed: 0, sent24h: 0, failed24h: 0 };
    return {
      configured: this.s.mailer.isConfigured(),
      notificationsEnabled: this.s.settings.get('emailNotifications'),
      stats,
      items,
      total,
      limit,
      offset,
    };
  }

  async verify(auth: AuthContext): Promise<{ ok: true; durationMs: number; message: string }> {
    this.s.perms.requireGlobal(auth, 'admin');
    if (!this.s.mailer.isConfigured()) throw badRequest('Bitte zuerst SMTP-Server und Absender eintragen und speichern');
    try {
      const { durationMs } = await this.s.mailer.verify();
      const smtp = this.s.settings.get('smtp');
      return { ok: true, durationMs, message: `Verbindung zu ${smtp.host}:${smtp.port} erfolgreich${smtp.user ? ', Anmeldung akzeptiert' : ''}.` };
    } catch (err) {
      throw new HttpError(400, 'smtp_error', describeMailError(err));
    }
  }

  /** Test-Mail direkt (nicht über die Warteschlange) – Fehler sollen sofort sichtbar sein. */
  async sendTest(auth: AuthContext, to: string): Promise<{ ok: true; durationMs: number }> {
    this.s.perms.requireGlobal(auth, 'admin');
    const recipient = to.trim();
    if (!EMAIL_RE.test(recipient)) throw badRequest('Bitte eine gültige E-Mail-Adresse angeben');
    if (!this.s.mailer.isConfigured()) throw badRequest('SMTP ist nicht vollständig eingerichtet (Server und Absender)');
    const site = this.s.settings.get('siteName');
    const smtp = this.s.settings.get('smtp');
    const mail = renderMail(this.brand(), `${site}: Test-E-Mail`, {
      heading: 'Der E-Mail-Versand funktioniert',
      paragraphs: [
        `Diese Nachricht wurde über ${smtp.host}:${smtp.port} verschickt.`,
        'Benachrichtigungen, Erinnerungen und Passwort-Links kommen auf demselben Weg an.',
      ],
      action: { label: 'Knowstead öffnen', url: '/' },
      reason: `Test-E-Mail, ausgelöst von ${auth.user?.displayName ?? 'der Administration'}.`,
    }, localeOfPreferences(auth.user?.preferences, this.s.settings.get('defaultLocale')));
    const now = nowIso();
    const id = this.s.db.run(
      `INSERT INTO mail_queue (recipient, user_id, kind, subject, text_body, html_body, status, attempts, created_at, next_attempt_at)
       VALUES (?, ?, 'test', ?, ?, ?, 'sending', 1, ?, ?)`,
      recipient,
      auth.user?.id ?? null,
      mail.subject,
      mail.text,
      mail.html,
      now,
      now,
    ).lastInsertRowid;
    const started = Date.now();
    try {
      await this.s.mailer.send({ to: recipient, subject: mail.subject, text: mail.text, html: mail.html });
      this.s.db.run("UPDATE mail_queue SET status = 'sent', sent_at = ? WHERE id = ?", nowIso(), id);
      return { ok: true, durationMs: Date.now() - started };
    } catch (err) {
      const message = describeMailError(err);
      this.s.db.run("UPDATE mail_queue SET status = 'failed', last_error = ? WHERE id = ?", message, id);
      throw new HttpError(400, 'smtp_error', message);
    }
  }

  retry(auth: AuthContext, id: number): MailDto {
    this.s.perms.requireGlobal(auth, 'admin');
    const row = this.s.db.get<MailRow>('SELECT * FROM mail_queue WHERE id = ?', id);
    if (!row) throw notFound('E-Mail nicht gefunden');
    if (row.status === 'sent' || row.status === 'sending') throw badRequest('Diese E-Mail wurde bereits verschickt');
    this.s.db.run("UPDATE mail_queue SET status = 'queued', attempts = 0, next_attempt_at = ? WHERE id = ?", nowIso(), id);
    this.kick();
    return this.toDto(this.s.db.get<MailRow>('SELECT * FROM mail_queue WHERE id = ?', id)!);
  }

  retryFailed(auth: AuthContext): number {
    this.s.perms.requireGlobal(auth, 'admin');
    const changes = this.s.db.run("UPDATE mail_queue SET status = 'queued', attempts = 0, next_attempt_at = ? WHERE status IN ('failed', 'queued')", nowIso()).changes;
    this.kick();
    return changes;
  }

  /** Verschickte und endgültig gescheiterte Mails nach Frist entfernen. */
  prune(days = 30): number {
    const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
    return this.s.db.run("DELETE FROM mail_queue WHERE status IN ('sent', 'failed') AND created_at < ?", cutoff).changes;
  }
}
