import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Services } from '../../services.ts';
import type { UserRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso } from '../../db/database.ts';
import crypto from 'node:crypto';
import { hashPassword, needsRehash, randomToken, safeEqual, sha256, verifyPasswordAsync } from '../../core/crypto.ts';
import { LEGACY_SESSION_COOKIE } from '../../core/legacy.ts';
import { HttpError, badRequest, forbidden, unauthorized } from '../../core/errors.ts';
import { renderMail } from '../mail/templates.ts';
import { localeOfPreferences } from '../../core/i18n.ts';
import { forgetSubject, rememberRowId } from '../../core/subjects.ts';

export const SESSION_COOKIE = 'knowstead_session';

/** Vergleichs-Hash für unbekannte Konten – gleiche Rechenzeit wie bei einer echten Prüfung. */
let dummyHash: string | null = null;
async function dummyPasswordCheck(password: string): Promise<void> {
  dummyHash ??= hashPassword('knowstead-timing-equalizer');
  await verifyPasswordAsync(password, dummyHash);
}

/** Unbestätigte Selbstregistrierungen werden nach dieser Frist gelöscht. */
export const REGISTRATION_PENDING_DAYS = 7;

function isLoopback(ip: string | null | undefined): boolean {
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

/**
 * Kommt die Anfrage direkt von einem Browser auf dem Server selbst? Maßgeblich ist die Socket-Adresse,
 * nicht `req.ip`: Mit TRUST_PROXY ließe sich die sonst per X-Forwarded-For fälschen. Über einen Proxy
 * weitergeleitete Anfragen gelten nie als lokal – auch nicht von einem Proxy auf demselben Rechner.
 */
export function isLocalRequest(req: FastifyRequest): boolean {
  const h = req.headers;
  return isLoopback(req.raw.socket?.remoteAddress) && !h['x-forwarded-for'] && !h.forwarded && !h['x-real-ip'];
}

const SETUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Einzelnes Cookie aus einer Cookie-Kopfzeile lesen. */
function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

interface SessionRow {
  id: string;
  user_id: number;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
}

export interface SessionDto {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export class AuthService {
  private readonly s: Services;
  private readonly touched = new Map<string, number>();
  private cachedSetupCode: string | null = null;

  constructor(s: Services) {
    this.s = s;
  }

  /* --------------------------- Anfrage-Kontext --------------------------- */

  resolve(req: FastifyRequest): AuthContext {
    return this.resolveHeaders(req.headers, req.ip ?? null, req.cookies?.[SESSION_COOKIE] ?? req.cookies?.[LEGACY_SESSION_COOKIE]);
  }

  /** Anmeldung aus rohen Kopfzeilen (z. B. beim WebSocket-Upgrade ohne Fastify-Request). */
  resolveHeaders(headers: Record<string, string | string[] | undefined>, ip: string | null, sessionCookie?: string): AuthContext {
    const userAgent = (headers['user-agent'] as string | undefined) ?? null;
    const header = headers.authorization as string | undefined;
    if (header && /^Bearer\s+/i.test(header)) {
      const token = header.replace(/^Bearer\s+/i, '').trim();
      const verified = this.s.tokens.verify(token, ip);
      if (!verified) throw unauthorized('Ungültiges, abgelaufenes oder widerrufenes API-Token');
      return this.s.perms.forUser(verified.user, {
        via: 'token',
        scopes: new Set(verified.scopes),
        tokenId: verified.row.id,
        ip,
        userAgent,
      });
    }
    // Wer vor der Umbenennung angemeldet war, bleibt es: Das frühere Cookie gilt bis zu seinem Ablauf weiter
    const cookie =
      sessionCookie ?? readCookie(headers.cookie as string | undefined, SESSION_COOKIE) ?? readCookie(headers.cookie as string | undefined, LEGACY_SESSION_COOKIE);
    if (cookie) {
      const session = this.s.db.get<SessionRow>('SELECT * FROM sessions WHERE id = ?', sha256(cookie));
      if (session && session.expires_at > nowIso()) {
        const user = this.s.users.get(session.user_id);
        if (user && user.status === 'active') {
          this.touch(session);
          return this.s.perms.forUser(user, { via: 'session', sessionId: session.id, ip, userAgent });
        }
      }
    }
    return this.s.perms.anonymous(ip, userAgent);
  }

  private touch(session: SessionRow): void {
    const last = this.touched.get(session.id) ?? 0;
    if (Date.now() - last < 5 * 60_000) return;
    // Merkliste klein halten (bei vielen Anmeldungen wächst sie sonst unbegrenzt)
    if (this.touched.size > 20_000) {
      const limit = Date.now() - 5 * 60_000;
      for (const [id, at] of this.touched) if (at < limit) this.touched.delete(id);
    }
    this.touched.set(session.id, Date.now());
    const lifetimeMs = new Date(session.expires_at).getTime() - new Date(session.last_seen_at).getTime();
    // Gleitende Verlängerung für "angemeldet bleiben"-Sitzungen (> 1 Tag).
    const expires = lifetimeMs > 86400000 ? new Date(Date.now() + this.s.settings.get('sessionDays') * 86400000).toISOString() : session.expires_at;
    this.s.db.run('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?', nowIso(), expires, session.id);
  }

  /* ------------------------------- Sitzungen ------------------------------- */

  createSession(userId: number, auth: AuthContext, remember: boolean): { token: string; expiresAt: string; id: string } {
    const token = randomToken(32);
    const id = sha256(token);
    const days = remember ? this.s.settings.get('sessionDays') : 1;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + days * 86400000).toISOString();
    this.s.db.run(
      'INSERT INTO sessions (id, user_id, ip, user_agent, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      userId,
      auth.ip,
      auth.userAgent?.slice(0, 300) ?? null,
      now.toISOString(),
      now.toISOString(),
      expiresAt,
    );
    this.s.db.run('DELETE FROM sessions WHERE expires_at < ?', now.toISOString());
    return { token, expiresAt, id };
  }

  /**
   * Cookies mit „Secure“ setzen? „auto“: sobald die Anfrage per HTTPS kommt – auch über einen Proxy ohne
   * TRUST_PROXY. Ein gefälschter Header könnte das Cookie nur strenger machen, nie schwächer.
   */
  isSecureRequest(req: FastifyRequest): boolean {
    return this.s.config.cookieSecure === 'auto' ? req.protocol === 'https' || req.headers['x-forwarded-proto'] === 'https' : this.s.config.cookieSecure;
  }

  setCookie(req: FastifyRequest, reply: FastifyReply, token: string, expiresAt: string, remember: boolean): void {
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.isSecureRequest(req),
      expires: remember ? new Date(expiresAt) : undefined,
    });
  }

  clearCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    reply.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' });
  }

  listSessions(auth: AuthContext): SessionDto[] {
    const user = this.s.perms.requireUser(auth);
    return this.s.db
      .all<SessionRow>('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC', user.id, nowIso())
      .map((r) => ({
        id: r.id.slice(0, 16),
        ip: r.ip,
        userAgent: r.user_agent,
        createdAt: r.created_at,
        lastSeenAt: r.last_seen_at,
        expiresAt: r.expires_at,
        current: r.id === auth.sessionId,
      }));
  }

  revokeSession(auth: AuthContext, shortId: string): void {
    const user = this.s.perms.requireUser(auth);
    this.s.db.run('DELETE FROM sessions WHERE user_id = ? AND substr(id, 1, 16) = ?', user.id, shortId);
  }

  revokeOtherSessions(auth: AuthContext): number {
    const user = this.s.perms.requireUser(auth);
    return this.s.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, auth.sessionId ?? '').changes;
  }

  logout(auth: AuthContext): void {
    if (auth.sessionId) this.s.db.run('DELETE FROM sessions WHERE id = ?', auth.sessionId);
    if (auth.user) this.s.emit(auth, { type: 'auth.logout', target: { type: 'user', id: auth.user.id, label: auth.user.username } });
  }

  /* -------------------------------- Anmeldung -------------------------------- */

  async login(auth: AuthContext, login: string, password: string): Promise<UserRow> {
    const settings = this.s.settings.all();
    const user = this.s.users.byLogin(login.trim());
    const fail = (reason: string, target?: UserRow) => {
      this.s.emit(auth, {
        type: 'auth.login_failed',
        target: { type: 'user', id: target?.id ?? 0, label: target?.username ?? login.slice(0, 80) },
        data: { reason },
      });
      return unauthorized('Benutzername oder Passwort ist falsch');
    };

    // 1. Verzeichnisanmeldung (Active Directory/LDAP), sofern eingerichtet.
    if (this.s.directory.isEnabled() && (!user || user.auth_source === 'ldap' || !user.password_hash)) {
      const profile = await this.s.directory.authenticate(login, password).catch((err) => {
        this.s.emit(auth, {
          type: 'auth.login_failed',
          target: { type: 'user', id: user?.id ?? 0, label: user?.username ?? login.slice(0, 80) },
          data: { reason: 'directory_rejected' },
        });
        throw err;
      });
      if (profile) {
        const row = this.s.directory.syncUser(profile);
        if (row.status !== 'active') throw forbidden('Dieses Konto ist deaktiviert. Bitte wende dich an einen Administrator.');
        this.s.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), row.id);
        this.s.emit(
          { ...auth, user: { id: row.id, username: row.username, displayName: row.display_name, email: row.email, kind: row.kind, avatarColor: row.avatar_color, preferences: {} } },
          { type: 'auth.login', target: { type: 'user', id: row.id, label: row.username }, data: { via: 'directory' } },
        );
        return row;
      }
      if (!settings.directory.allowLocalLogin) throw fail('directory_unknown', user);
    }

    // 2. Lokales Konto mit Passwort.
    if (!user || user.kind === 'bot' || !user.password_hash) {
      // Antwortzeit angleichen: Sonst ließe sich an der Dauer ablesen, ob ein Konto existiert.
      await dummyPasswordCheck(password);
      throw fail('unknown_user', user);
    }
    if (user.locked_until && user.locked_until > nowIso()) {
      const minutes = Math.max(1, Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000));
      this.s.emit(auth, { type: 'auth.login_failed', target: { type: 'user', id: user.id, label: user.username }, data: { reason: 'locked' } });
      throw new HttpError(429, 'locked', `Zu viele Fehlversuche. Bitte in ${minutes} Minute(n) erneut versuchen.`);
    }
    if (!(await verifyPasswordAsync(password, user.password_hash))) {
      const attempts = user.failed_logins + 1;
      const lock = attempts >= settings.maxLoginAttempts;
      this.s.db.run(
        'UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?',
        lock ? 0 : attempts,
        lock ? new Date(Date.now() + settings.lockMinutes * 60000).toISOString() : null,
        user.id,
      );
      throw fail(lock ? 'locked_now' : 'bad_password', user);
    }
    if (user.status !== 'active') throw forbidden('Dieses Konto ist deaktiviert. Bitte wende dich an einen Administrator.');
    if (user.registration_pending_at) {
      throw new HttpError(403, 'email_unverified', 'Bitte bestätige zuerst deine E-Mail-Adresse – den Link dazu haben wir dir per E-Mail geschickt.');
    }
    this.s.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), user.id);
    // Ältere, schwächere Hashes beim Anmelden unbemerkt auf die aktuellen Parameter heben
    if (needsRehash(user.password_hash)) this.s.db.run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(password), user.id);
    this.s.emit(
      { ...auth, user: { id: user.id, username: user.username, displayName: user.display_name, email: user.email, kind: user.kind, avatarColor: user.avatar_color, preferences: {} } },
      { type: 'auth.login', target: { type: 'user', id: user.id, label: user.username } },
    );
    return user;
  }

  /**
   * Selbstregistrierung. Ist der E-Mail-Versand eingerichtet, muss die Adresse bestätigt werden, bevor
   * das Konto sich anmelden kann (`pending`). Eine Beschränkung auf E-Mail-Domains ist ohne diese
   * Bestätigung wirkungslos – jeder könnte eine fremde Firmenadresse angeben – und setzt den
   * E-Mail-Versand deshalb voraus.
   */
  register(auth: AuthContext, input: { username: string; displayName: string; email: string; password: string }): { user: UserRow; pending: boolean } {
    const settings = this.s.settings.all();
    if (!settings.allowRegistration) throw forbidden('Die Selbstregistrierung ist deaktiviert');
    const email = input.email.trim().toLowerCase();
    if (settings.registrationDomains.length) {
      const domain = email.split('@')[1] ?? '';
      if (!settings.registrationDomains.map((d) => d.toLowerCase().replace(/^@/, '')).includes(domain)) {
        throw forbidden('Registrierung ist nur mit einer freigegebenen E-Mail-Domain möglich');
      }
    }
    const verify = this.s.mailer.isConfigured();
    if (!verify && settings.registrationDomains.length) {
      throw forbidden('Die Registrierung ist derzeit nicht möglich: Zur Bestätigung der E-Mail-Adresse fehlt der E-Mail-Versand. Bitte wende dich an die Administration.');
    }
    const created = this.s.users.create({ username: input.username, displayName: input.displayName, email, password: input.password });
    if (verify) {
      this.s.db.run('UPDATE users SET registration_pending_at = ? WHERE id = ?', nowIso(), created.id);
      const token = this.createResetToken(created.id, 48);
      const site = this.s.settings.get('siteName');
      this.s.mail.enqueue({
        to: email,
        userId: created.id,
        kind: 'registration',
        mail: renderMail(this.s.mail.brand(), `${site}: E-Mail-Adresse bestätigen`, {
          heading: 'Fast geschafft',
          paragraphs: [
            `Hallo ${created.display_name},`,
            `bitte bestätige deine E-Mail-Adresse, um dein Konto „${created.username}“ zu aktivieren. Der Link ist zwei Tage gültig.`,
          ],
          action: { label: 'E-Mail-Adresse bestätigen', url: `${this.s.config.baseUrl}/verify-email/${token}` },
          reason: `Du erhältst diese E-Mail, weil mit dieser Adresse ein Konto bei ${site} angelegt wurde. Warst du das nicht, kannst du sie ignorieren – das Konto wird nach ${REGISTRATION_PENDING_DAYS} Tagen gelöscht.`,
        }, settings.defaultLocale),
      });
    }
    this.s.emit(auth, { type: 'auth.registered', target: { type: 'user', id: created.id, label: created.username }, data: { pending: verify } });
    return { user: this.s.users.require(created.id), pending: verify };
  }

  /** Konto zu einem gültigen, unbenutzten Link (Passwort zurücksetzen, Einladung, Registrierung). */
  private userForLink(token: string): UserRow {
    const row = this.s.db.get<{ user_id: number; expires_at: string; used_at: string | null }>(
      'SELECT user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?',
      sha256(token),
    );
    if (!row || row.used_at || row.expires_at < nowIso()) throw badRequest('Der Link ist ungültig oder abgelaufen');
    return this.s.users.require(row.user_id);
  }

  /** Link aus der Registrierungs-E-Mail: Adresse bestätigt, Konto freigeschaltet. */
  verifyEmail(auth: AuthContext, token: string): UserRow {
    const user = this.userForLink(token);
    if (!user.registration_pending_at) throw badRequest('Die E-Mail-Adresse wurde bereits bestätigt – bitte melde dich an');
    if (user.status !== 'active') throw forbidden('Dieses Konto ist deaktiviert. Bitte wende dich an einen Administrator.');
    this.s.db.transaction(() => {
      this.s.db.run('UPDATE users SET registration_pending_at = NULL, last_login_at = ?, updated_at = ? WHERE id = ?', nowIso(), nowIso(), user.id);
      this.s.db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', nowIso(), user.id);
    });
    this.s.emit(auth, { type: 'auth.email_verified', target: { type: 'user', id: user.id, label: user.username } });
    return this.s.users.require(user.id);
  }

  /** Unbestätigte Selbstregistrierungen nach Ablauf der Frist entfernen (geben Namen und Adresse wieder frei). */
  pruneUnverifiedRegistrations(now = new Date()): number {
    const cutoff = new Date(now.getTime() - REGISTRATION_PENDING_DAYS * 86400_000).toISOString();
    const expired = this.s.db.all<{ id: number }>('SELECT id FROM users WHERE registration_pending_at IS NOT NULL AND registration_pending_at < ?', cutoff);
    return this.s.db.transaction(() => {
      // Wie beim Löschen eines Kontos: Verweise räumen, Nummer nicht wieder vergeben
      for (const { id } of expired) {
        rememberRowId(this.s.db, 'users', id);
        forgetSubject(this.s.db, 'user', id);
      }
      return this.s.db.run('DELETE FROM users WHERE registration_pending_at IS NOT NULL AND registration_pending_at < ?', cutoff).changes;
    });
  }

  /**
   * Einrichtungscode für die Ersteinrichtung über das Netzwerk. Solange es kein Konto gibt, könnte
   * sonst jeder, der den frisch gestarteten Server zuerst erreicht, Administrator werden. Der Code
   * steht im Serverprotokoll; vom Server selbst aus (localhost) ist er nicht nötig.
   */
  setupCode(): string {
    if (!this.cachedSetupCode) {
      const bytes = crypto.randomBytes(8);
      const chars = [...bytes].map((b) => SETUP_CODE_ALPHABET[b % SETUP_CODE_ALPHABET.length]).join('');
      this.cachedSetupCode = `${chars.slice(0, 4)}-${chars.slice(4)}`;
    }
    return this.cachedSetupCode;
  }

  checkSetupCode(req: FastifyRequest, code: string | undefined): void {
    if (isLocalRequest(req)) return;
    const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code || !safeEqual(normalize(code), normalize(this.setupCode()))) {
      throw new HttpError(403, 'setup_code', 'Einrichtungscode fehlt oder ist falsch. Er steht im Serverprotokoll (Startfenster, Dienstprotokoll bzw. „docker compose logs“).');
    }
  }

  /**
   * Aktuelles Passwort bestätigen, bevor sicherheitsrelevante Kontodaten geändert werden. Sonst genügte
   * eine fremde, offene Sitzung, um die E-Mail-Adresse umzustellen und über „Passwort vergessen“ das
   * Konto dauerhaft zu übernehmen. Konten ohne lokales Passwort (Verzeichnis) setzen ihr Passwort nicht
   * per E-Mail zurück und brauchen keine Bestätigung.
   */
  async confirmPassword(user: UserRow, password: string | undefined, purpose: string): Promise<void> {
    if (!user.password_hash) return;
    if (!password) throw new HttpError(400, 'password_required', `Bitte bestätige ${purpose} mit deinem aktuellen Passwort`);
    if (!(await verifyPasswordAsync(password, user.password_hash))) throw new HttpError(400, 'password_wrong', 'Das aktuelle Passwort ist falsch');
  }

  async changePassword(auth: AuthContext, current: string, next: string): Promise<void> {
    // Ein Token mit Schreibrecht soll das Passwort seiner Person weder ändern noch durch Probieren erraten können
    if (auth.via === 'token') throw forbidden('Das Passwort lässt sich nur in einer angemeldeten Sitzung ändern, nicht mit einem API-Token');
    const user = this.s.users.require(this.s.perms.requireUser(auth).id);
    if (!(await verifyPasswordAsync(current, user.password_hash))) throw badRequest('Das aktuelle Passwort ist falsch');
    this.s.users.setPassword(user.id, next);
    this.s.db.run('DELETE FROM sessions WHERE user_id = ? AND id != ?', user.id, auth.sessionId ?? '');
    this.s.emit(auth, { type: 'auth.password_changed', target: { type: 'user', id: user.id, label: user.username } });
  }

  /* --------------------------- Passwort zurücksetzen --------------------------- */

  createResetToken(userId: number, hours = 2): string {
    const token = randomToken(32);
    this.s.db.run(
      'INSERT INTO password_resets (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)',
      sha256(token),
      userId,
      new Date(Date.now() + hours * 3600000).toISOString(),
      nowIso(),
    );
    return token;
  }

  async requestReset(auth: AuthContext, login: string): Promise<void> {
    const user = this.s.users.byLogin(login.trim());
    if (!user || !user.email || user.status !== 'active' || user.kind === 'bot' || !this.s.mailer.isConfigured()) return;
    // Verzeichnis- und SSO-Konten melden sich beim Anbieter an – ein lokales Passwort bliebe sonst
    // gültig, auch wenn das Konto im Active Directory bzw. in Entra ID längst gesperrt oder gelöscht ist.
    if (user.auth_source !== 'local') return;
    const token = this.createResetToken(user.id);
    const link = `${this.s.config.baseUrl}/reset-password/${token}`;
    const site = this.s.settings.get('siteName');
    this.s.emit(auth, { type: 'auth.password_reset_requested', target: { type: 'user', id: user.id, label: user.username } });
    // Über die Warteschlange: Die Antwort verrät weder SMTP-Probleme noch Laufzeitunterschiede.
    this.s.mail.enqueue({
      to: user.email,
      userId: user.id,
      kind: 'password-reset',
      mail: renderMail(this.s.mail.brand(), `${site}: Passwort zurücksetzen`, {
        heading: 'Neues Passwort festlegen',
        paragraphs: [`Hallo ${user.display_name},`, 'über den folgenden Link kannst du ein neues Passwort festlegen. Der Link ist zwei Stunden gültig.'],
        action: { label: 'Passwort festlegen', url: link },
        reason: 'Du erhältst diese E-Mail, weil jemand ein neues Passwort für dein Konto angefordert hat. Warst du das nicht, kannst du sie ignorieren.',
      }, localeOfPreferences(this.s.users.preferences(user.id), this.s.settings.get('defaultLocale'))),
    });
  }

  resetPassword(auth: AuthContext, token: string, password: string): void {
    const user = this.userForLink(token);
    if (user.auth_source === 'ldap') throw badRequest('Dieses Konto meldet sich über das Verzeichnis (Windows-Anmeldung) an');
    if (user.auth_source !== 'local') throw badRequest('Dieses Konto meldet sich über Single Sign-on an');
    this.s.users.setPassword(user.id, password);
    // Der Link kam per E-Mail – damit ist auch die Adresse einer offenen Registrierung bestätigt
    if (user.registration_pending_at) this.s.db.run('UPDATE users SET registration_pending_at = NULL WHERE id = ?', user.id);
    // Alle offenen Links des Kontos entwerten, nicht nur den benutzten
    this.s.db.run('UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', nowIso(), user.id);
    this.s.db.run('DELETE FROM sessions WHERE user_id = ?', user.id);
    this.s.emit(auth, { type: 'auth.password_changed', target: { type: 'user', id: user.id, label: user.username }, data: { via: 'reset' } });
  }
}
