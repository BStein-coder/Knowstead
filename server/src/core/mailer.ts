import nodemailer, { type Transporter } from 'nodemailer';
import type { SettingsService, SmtpSettings } from './settings.ts';
import { decryptSecret } from './crypto.ts';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}

/** Einfache Prüfung auf eine plausible E-Mail-Adresse (ohne Anzeigenamen). */
export const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

/**
 * Übersetzt Fehler von nodemailer in verständliche Hinweise – Administratoren
 * sollen sofort sehen, ob Port, Verschlüsselung, Zertifikat oder Anmeldung klemmt.
 */
export function describeMailError(err: unknown): string {
  const e = (err ?? {}) as { code?: string; responseCode?: number; response?: string; message?: string };
  const msg = String(e.message ?? err);
  const code = e.code ?? '';
  if (/basic authentication is disabled|5\.7\.139|SmtpClientAuthentication is disabled/i.test(`${msg} ${e.response ?? ''}`)) {
    return 'Microsoft 365 lässt die Anmeldung mit Benutzername und Passwort für SMTP nicht zu (Basic Auth abgeschaltet oder „Authentifiziertes SMTP“ gesperrt). Stattdessen den Relay über einen Connector verwenden (Vorlage „Microsoft 365 – Relay über Connector“).';
  }
  if (code === 'EAUTH' || e.responseCode === 535 || e.responseCode === 534) {
    return 'Anmeldung am SMTP-Server fehlgeschlagen – Benutzer und Passwort prüfen. Bei Microsoft 365 muss „Authentifiziertes SMTP“ für das Postfach erlaubt sein; ist die Anmeldung per Passwort dort abgeschaltet, hilft der Relay über einen Connector.';
  }
  if (/self[- ]signed|unable to verify|unable to get local issuer|certificate|CERT_|altnames/i.test(msg)) {
    return 'Das Zertifikat des Servers ist nicht vertrauenswürdig oder passt nicht zum Namen. Für interne Server mit eigenem Zertifikat „Zertifikat prüfen“ abschalten.';
  }
  if (/wrong version number|EPROTO|ssl3_get_record|packet length too long|unknown protocol/i.test(msg)) {
    return 'Die Verschlüsselung passt nicht zum Port: 465 = TLS, 587 = STARTTLS, 25 = STARTTLS oder unverschlüsselt.';
  }
  if (/STARTTLS/i.test(msg)) {
    return 'Der Server bietet kein STARTTLS an. „Keine Verschlüsselung“ nur für interne Relays wählen, sonst Port 465 mit TLS versuchen.';
  }
  if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(msg)) return 'Verbindung abgelehnt – Servername und Port prüfen.';
  if (code === 'EDNS' || /ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Der Servername lässt sich nicht auflösen – Schreibweise und DNS prüfen.';
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || /timeout|timed out|ETIMEDOUT/i.test(msg)) {
    return 'Zeitüberschreitung – der Server antwortet nicht. Port, Firewall und ausgehende Verbindungen prüfen.';
  }
  if (code === 'EENVELOPE' || [530, 550, 551, 552, 553, 554].includes(e.responseCode ?? 0)) {
    return `Der Server hat Absender oder Empfänger abgelehnt (${(e.response ?? msg).slice(0, 200)}). Absenderadresse und Relay-Berechtigung prüfen.`;
  }
  return `Versand fehlgeschlagen: ${msg.slice(0, 300)}`;
}

/** E-Mail-Versand über SMTP (optional, in der Administration konfigurierbar). */
export class Mailer {
  private readonly settings: SettingsService;
  private readonly secret: Buffer;
  private cached: { key: string; transport: Transporter } | null = null;

  constructor(settings: SettingsService, secret: Buffer) {
    this.settings = settings;
    this.secret = secret;
  }

  isConfigured(): boolean {
    const smtp = this.settings.get('smtp');
    return !!(smtp.host && smtp.from);
  }

  private options(smtp: SmtpSettings, pool: boolean) {
    const password = decryptSecret(this.secret, smtp.password) ?? '';
    const security = smtp.security ?? (smtp.secure ? 'tls' : 'starttls');
    return {
      host: smtp.host,
      port: smtp.port,
      secure: security === 'tls',
      requireTLS: security === 'starttls',
      ignoreTLS: security === 'none',
      auth: smtp.user ? { user: smtp.user, pass: password } : undefined,
      tls: { rejectUnauthorized: smtp.rejectUnauthorized !== false },
      // Ohne Zeitlimits hinge ein falscher Port bis zu zwei Minuten.
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
      dnsTimeout: 10_000,
      pool,
      maxConnections: 2,
      maxMessages: 100,
    };
  }

  /** Wiederverwendete Verbindung; wird neu aufgebaut, sobald sich die Einstellungen ändern. */
  private transport(): Transporter {
    const smtp = this.settings.get('smtp');
    const key = JSON.stringify(smtp);
    if (!this.cached || this.cached.key !== key) {
      this.cached?.transport.close();
      this.cached = { key, transport: nodemailer.createTransport(this.options(smtp, true) as never) };
    }
    return this.cached.transport;
  }

  fromAddress(): string {
    const smtp = this.settings.get('smtp');
    const siteName = this.settings.get('siteName').replace(/["\\]/g, '');
    return smtp.from.includes('<') ? smtp.from : `"${siteName}" <${smtp.from}>`;
  }

  async send(message: MailMessage): Promise<void> {
    if (!this.isConfigured()) throw new Error('SMTP ist nicht konfiguriert');
    const smtp = this.settings.get('smtp');
    await this.transport().sendMail({
      from: this.fromAddress(),
      to: message.to,
      replyTo: message.replyTo || smtp.replyTo || undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: {
        // Keine Abwesenheitsnotizen auf automatische Mails
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'All',
      },
    });
  }

  /** Verbindung und Anmeldung prüfen – mit eigener, nicht gepoolter Verbindung. */
  async verify(): Promise<{ durationMs: number }> {
    if (!this.isConfigured()) throw new Error('SMTP ist nicht konfiguriert (Server und Absender angeben)');
    const started = Date.now();
    const transport = nodemailer.createTransport(this.options(this.settings.get('smtp'), false) as never);
    try {
      await transport.verify();
    } finally {
      transport.close();
    }
    return { durationMs: Date.now() - started };
  }

  close(): void {
    this.cached?.transport.close();
    this.cached = null;
  }
}
