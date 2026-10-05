/**
 * Single Sign-on: Anmeldung über Microsoft Entra ID bzw. einen anderen OpenID-Connect-Anbieter, über
 * SAML 2.0 und – für die Windows-integrierte Anmeldung im Firmennetz – über einen vorgeschalteten
 * Webserver, der Kerberos prüft und das Konto in einer Kopfzeile weiterreicht.
 *
 * Sicherheitsregeln:
 *  - Jeder Anmeldevorgang ist über ein kurzlebiges, HttpOnly-Cookie an den Browser gebunden, der ihn
 *    begonnen hat. Eine fremde Rückmeldung (Login-CSRF) läuft dadurch ins Leere.
 *  - OIDC: Autorisierungscode mit PKCE, state und nonce; das ID-Token prüft openid-client (Signatur,
 *    Aussteller, Zielgruppe, Ablauf). Entra ID nur mandantengebunden – nie „common“.
 *  - SAML: signierte Assertion, Aussteller, Zielgruppe, Gültigkeit und InResponseTo werden geprüft;
 *    vom Anbieter angestoßene Anmeldungen (ohne vorherige Anfrage) werden abgelehnt.
 *  - Verknüpft wird über die unveränderliche Kennung beim Anbieter, nie über die E-Mail-Adresse.
 *    Vorhandene Konten gleichen Namens werden nur auf ausdrücklichen Wunsch übernommen – lokale
 *    Administratorkonten nie (die verknüpfen sich selbst im Profil).
 */
import crypto from 'node:crypto';
import net from 'node:net';
import type { FastifyReply, FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { SAML, ValidateInResponseTo } from '@node-saml/node-saml';
import type { CacheProvider, Profile, SamlConfig } from '@node-saml/node-saml';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { UserRow } from '../../core/types.ts';
import type { KerberosSettings, OidcSettings, SamlSettings, Settings, SsoAccountRules } from '../../core/settings.ts';
import { DEFAULT_SETTINGS } from '../../core/settings.ts';
import { nowIso, parseJson } from '../../db/database.ts';
import { decryptSecret, encryptSecret, randomToken, safeEqual, sha256 } from '../../core/crypto.ts';
import { headerValue } from '../../core/legacy.ts';
import { HttpError, badRequest, notFound } from '../../core/errors.ts';
import { colorFor } from '../../core/util.ts';
import { translate, type Locale } from '../../core/i18n.ts';

export type SsoProvider = 'oidc' | 'saml' | 'kerberos';

export const SSO_FLOW_COOKIE = 'knowstead_sso';
const FLOW_COOKIE_PATH = '/api/v1/auth';
const FLOW_MINUTES = 10;
const MASK = '••••••••';
const USERNAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,39}$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CLAIM_RE = /^[A-Za-z0-9_.:/#-]{1,200}$/;
/** Kopfzeilen, die ein Webserver nie als Kontoangabe liefern darf */
const RESERVED_HEADERS = new Set(['authorization', 'cookie', 'host', 'content-type', 'content-length', 'x-forwarded-for', 'forwarded', 'x-real-ip', 'x-knowstead-client', 'x-knowstead-proxy-secret', 'x-doku-client', 'x-doku-proxy-secret']);
const TRANSIENT_NAMEID = 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient';

/** Fehlerkennungen – die Anmeldeseite zeigt dazu einen übersetzten Hinweis (nie Text aus der URL). */
export type SsoErrorCode =
  | 'unavailable'
  | 'flow'
  | 'provider'
  | 'no_account'
  | 'account_exists'
  | 'admin_link'
  | 'conflict'
  | 'group'
  | 'disabled'
  | 'identity_taken'
  | 'proxy'
  | 'no_user';

export class SsoError extends Error {
  readonly code: SsoErrorCode;
  constructor(code: SsoErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Vom Anbieter bestätigte Person. */
export interface ExternalIdentity {
  provider: SsoProvider;
  issuer: string;
  subject: string;
  username: string;
  displayName: string;
  email: string | null;
  /** null = Anbieter hat keine Gruppen geliefert (Abgleich entfällt) */
  groups: string[] | null;
  label: string;
}

interface FlowData {
  next: string;
  remember: boolean;
  linkUserId: number | null;
  verifier?: string;
  nonce?: string;
}

interface FlowRow {
  id: string;
  kind: string;
  request_id: string;
  data: string;
  result: string | null;
  expires_at: string;
}

interface IdentityRow {
  id: number;
  user_id: number;
  provider: SsoProvider;
  issuer: string;
  subject: string;
  label: string;
  created_at: string;
  last_login_at: string | null;
}

export interface IdentityDto {
  id: number;
  provider: SsoProvider;
  label: string;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SsoPublicInfo {
  providers: { id: SsoProvider; label: string; kind?: 'entra' | 'generic' }[];
  showLocalLogin: boolean;
  kerberosAuto: boolean;
}

/** Nur Ziele innerhalb von Knowstead – sonst wäre die Anmeldung ein offener Weiterleiter. */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') && next.length < 2000 ? next : '/';
}

/** „DOMAIN\\anna“, „anna@firma.de“ → gültiger Knowstead-Benutzername. */
export function usernameFrom(raw: string, stripDomain: boolean): string {
  let value = raw.trim();
  if (value.includes('\\')) value = value.slice(value.lastIndexOf('\\') + 1);
  if (stripDomain && value.includes('@')) value = value.slice(0, value.lastIndexOf('@'));
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '.')
    .replace(/^[^a-zA-Z0-9]+/, '')
    .slice(0, 40)
    .replace(/[._-]+$/, '');
}

/** PEM-Blöcke (Zertifikate oder öffentliche Schlüssel) aus einem Textfeld. */
export function pemBlocks(text: string): string[] {
  return [...text.matchAll(/-----BEGIN (CERTIFICATE|PUBLIC KEY)-----[\s\S]+?-----END \1-----/g)].map((m) => m[0].replace(/\r\n?/g, '\n'));
}

function isLoopbackHost(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
}

function plainAddress(address: string | undefined): string {
  if (!address) return '';
  return address.startsWith('::ffff:') && net.isIPv4(address.slice(7)) ? address.slice(7) : address;
}

/** Liste aus IP-Adressen und Netzen (CIDR) als BlockList – ungültige Einträge liefern einen Fehlertext. */
export function proxyList(entries: string[]): { list: net.BlockList; invalid: string | null } {
  const list = new net.BlockList();
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    const [address, prefix] = entry.split('/');
    const family = net.isIPv4(address) ? 'ipv4' : net.isIPv6(address) ? 'ipv6' : null;
    if (!family) return { list, invalid: entry };
    if (prefix === undefined) {
      list.addAddress(address, family);
      continue;
    }
    const bits = Number(prefix);
    if (!/^\d{1,3}$/.test(prefix) || bits > (family === 'ipv4' ? 32 : 128)) return { list, invalid: entry };
    list.addSubnet(address, bits, family);
  }
  return { list, invalid: null };
}

function claimString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value) && value.length) return claimString(value[0]);
  return '';
}

function claimList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return (Array.isArray(value) ? value : [value]).map(claimString).filter(Boolean);
}

export class SsoService {
  private readonly s: Services;
  private oidcCache: { key: string; at: number; config: oidc.Configuration } | null = null;
  /** Microsoft Graph für Gruppen bei Überlauf (austauschbar für Tests) */
  graphUrl = 'https://graph.microsoft.com';

  constructor(s: Services) {
    this.s = s;
  }

  /* ------------------------------ Übersicht ------------------------------ */

  private oidcReady(o: OidcSettings): boolean {
    return o.enabled && !!o.clientId.trim() && (o.provider === 'entra' ? GUID_RE.test(o.tenantId.trim()) : !!o.issuer.trim());
  }

  private samlReady(sa: SamlSettings): boolean {
    return sa.enabled && !!sa.entryPoint.trim() && pemBlocks(sa.idpCert).length > 0;
  }

  /**
   * Anmeldewege für die Anmeldeseite; unveränderte Standardbeschriftungen erscheinen in der Sprache der Anfrage –
   * auch wenn sie aus einer englischen Administration heraus auf Englisch gespeichert wurden.
   */
  publicInfo(locale: Locale = 'de'): SsoPublicInfo {
    const all = this.s.settings.all();
    const providers: SsoPublicInfo['providers'] = [];
    const tr = (label: string, builtIn: string) => translate(label === translate(builtIn, 'en') ? builtIn : label, locale);
    if (this.oidcReady(all.oidc)) providers.push({ id: 'oidc', label: tr(all.oidc.label, DEFAULT_SETTINGS.oidc.label), kind: all.oidc.provider });
    if (this.samlReady(all.saml)) providers.push({ id: 'saml', label: tr(all.saml.label, DEFAULT_SETTINGS.saml.label) });
    if (all.kerberos.enabled) providers.push({ id: 'kerberos', label: tr(all.kerberos.label, DEFAULT_SETTINGS.kerberos.label) });
    return {
      providers,
      showLocalLogin: all.showLocalLogin || providers.length === 0,
      kerberosAuto: all.kerberos.enabled && all.kerberos.autoLogin,
    };
  }

  private base(): string {
    return this.s.config.baseUrl.replace(/\/+$/, '');
  }

  urls() {
    const base = this.base();
    const metadataUrl = `${base}/api/v1/auth/saml/metadata`;
    return {
      redirectUri: `${base}/api/v1/auth/oidc/callback`,
      acsUrl: `${base}/api/v1/auth/saml/acs`,
      metadataUrl,
      spEntityId: this.s.settings.get('saml').spEntityId.trim() || metadataUrl,
      kerberosUrl: `${base}/api/v1/auth/kerberos`,
    };
  }

  /** Angaben für die Administrationsseite – inklusive Prüfung der aktuellen Anfrage für die Windows-Anmeldung. */
  adminInfo(auth: AuthContext, req: FastifyRequest) {
    this.s.perms.requireGlobal(auth, 'admin');
    const k = this.s.settings.get('kerberos');
    const remote = plainAddress(req.raw.socket?.remoteAddress);
    const warnings: string[] = [];
    let secureBase: boolean;
    try {
      const url = new URL(this.base());
      secureBase = url.protocol === 'https:' || isLoopbackHost(url.hostname);
    } catch {
      secureBase = false;
    }
    if (!secureBase) warnings.push('base_url_http');
    return {
      ...this.urls(),
      baseUrl: this.base(),
      warnings,
      request: {
        remoteAddress: remote,
        trustedProxy: this.isTrustedProxy(remote, k.trustedProxies),
        headerPresent: !!req.headers[k.header.toLowerCase()],
      },
    };
  }

  /* ------------------------------ Einstellungen ------------------------------ */

  /** Prüft und bereinigt die SSO-Einstellungen vor dem Speichern; Geheimnisse werden verschlüsselt. */
  prepareSettings(clean: Partial<Settings>): void {
    const secret = this.s.config.secret;
    const keepSecret = (next: unknown, current: string) =>
      next === undefined || next === MASK ? current : typeof next === 'string' && next ? encryptSecret(secret, next) : '';
    const text = (value: unknown, fallback: string, max = 500) => (typeof value === 'string' ? value.trim().slice(0, max) : fallback);
    const rules = (input: Partial<SsoAccountRules>, current: SsoAccountRules): SsoAccountRules => ({
      autoCreateUsers: input.autoCreateUsers === undefined ? current.autoCreateUsers : input.autoCreateUsers === true,
      adoptExistingUsers: input.adoptExistingUsers === undefined ? current.adoptExistingUsers : input.adoptExistingUsers === true,
      syncGroups: input.syncGroups === undefined ? current.syncGroups : input.syncGroups === true,
      stripDomain: input.stripDomain === undefined ? current.stripDomain : input.stripDomain === true,
      requireGroup: text(input.requireGroup, current.requireGroup, 300),
    });
    const claim = (value: string, label: string, optional = false) => {
      if (!value && optional) return value;
      if (!CLAIM_RE.test(value)) throw badRequest(`Ungültiger Claim- bzw. Attributname: ${label}`);
      return value;
    };

    if (clean.oidc) {
      const current = this.s.settings.get('oidc');
      const input = clean.oidc as Partial<OidcSettings>;
      const o: OidcSettings = {
        ...DEFAULT_SETTINGS.oidc,
        ...current,
        ...rules(input, current),
        enabled: input.enabled === undefined ? current.enabled : input.enabled === true,
        provider: input.provider === 'generic' ? 'generic' : input.provider === 'entra' ? 'entra' : current.provider,
        label: text(input.label, current.label, 60) || DEFAULT_SETTINGS.oidc.label,
        tenantId: text(input.tenantId, current.tenantId, 60),
        issuer: text(input.issuer, current.issuer),
        clientId: text(input.clientId, current.clientId, 200),
        clientSecret: keepSecret(input.clientSecret, current.clientSecret),
        scopes: text(input.scopes, current.scopes, 300) || DEFAULT_SETTINGS.oidc.scopes,
        usernameClaim: text(input.usernameClaim, current.usernameClaim, 200) || 'preferred_username',
        nameClaim: text(input.nameClaim, current.nameClaim, 200) || 'name',
        emailClaim: text(input.emailClaim, current.emailClaim, 200) || 'email',
        groupsClaim: text(input.groupsClaim, current.groupsClaim, 300),
      };
      claim(o.usernameClaim, 'Benutzername');
      claim(o.nameClaim, 'Anzeigename');
      claim(o.emailClaim, 'E-Mail');
      for (const g of o.groupsClaim.split(/[\s,;]+/).filter(Boolean)) claim(g, 'Gruppen');
      if (!/^[\x21-\x7e]+( [\x21-\x7e]+)*$/.test(o.scopes)) throw badRequest('Ungültige Scopes – bitte durch Leerzeichen trennen');
      if (!o.scopes.split(' ').includes('openid')) o.scopes = `openid ${o.scopes}`;
      if (o.tenantId && !GUID_RE.test(o.tenantId)) {
        throw badRequest('Bitte die Verzeichnis-ID (Mandanten-ID) als GUID angeben – „common“ oder „organizations“ sind aus Sicherheitsgründen nicht erlaubt');
      }
      if (o.issuer) {
        let url: URL;
        try {
          url = new URL(o.issuer);
        } catch {
          throw badRequest('Die Aussteller-URL ist ungültig');
        }
        if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname))) throw badRequest('Die Aussteller-URL muss mit https:// beginnen');
      }
      if (o.enabled) {
        if (!o.clientId) throw badRequest('Für OpenID Connect ist die Anwendungs-ID (Client-ID) erforderlich');
        if (o.provider === 'entra' && !o.tenantId) throw badRequest('Für Microsoft Entra ID ist die Verzeichnis-ID (Mandanten-ID) erforderlich');
        if (o.provider === 'generic' && !o.issuer) throw badRequest('Bitte die Aussteller-URL des Anbieters angeben');
      }
      clean.oidc = o;
    }

    if (clean.saml) {
      const current = this.s.settings.get('saml');
      const input = clean.saml as Partial<SamlSettings>;
      const sa: SamlSettings = {
        ...DEFAULT_SETTINGS.saml,
        ...current,
        ...rules(input, current),
        enabled: input.enabled === undefined ? current.enabled : input.enabled === true,
        label: text(input.label, current.label, 60) || DEFAULT_SETTINGS.saml.label,
        entryPoint: text(input.entryPoint, current.entryPoint, 1000),
        idpEntityId: text(input.idpEntityId, current.idpEntityId, 1000),
        idpCert: typeof input.idpCert === 'string' ? input.idpCert.trim().slice(0, 50_000) : current.idpCert,
        spEntityId: text(input.spEntityId, current.spEntityId, 1000),
        usernameAttribute: text(input.usernameAttribute, current.usernameAttribute, 300),
        nameAttribute: text(input.nameAttribute, current.nameAttribute, 300),
        emailAttribute: text(input.emailAttribute, current.emailAttribute, 300),
        groupsAttribute: text(input.groupsAttribute, current.groupsAttribute, 300),
      };
      claim(sa.usernameAttribute, 'Benutzername', true);
      claim(sa.nameAttribute, 'Anzeigename', true);
      claim(sa.emailAttribute, 'E-Mail', true);
      claim(sa.groupsAttribute, 'Gruppen', true);
      if (sa.entryPoint && !/^https:\/\/[^\s]+$/i.test(sa.entryPoint) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(sa.entryPoint)) {
        throw badRequest('Die Anmelde-URL des Identitätsanbieters muss mit https:// beginnen');
      }
      // Eingefügter Zertifikatstext ohne PEM-Rahmen (z. B. aus den Metadaten) wird eingerahmt
      if (sa.idpCert && !pemBlocks(sa.idpCert).length && /^[A-Za-z0-9+/=\s]+$/.test(sa.idpCert)) {
        const body = sa.idpCert.replace(/\s+/g, '');
        sa.idpCert = `-----BEGIN CERTIFICATE-----\n${body.match(/.{1,64}/g)?.join('\n') ?? body}\n-----END CERTIFICATE-----`;
      }
      if (sa.idpCert) {
        const blocks = pemBlocks(sa.idpCert);
        if (!blocks.length) throw badRequest('Das Zertifikat des Identitätsanbieters muss im PEM-Format vorliegen');
        for (const block of blocks) {
          try {
            if (block.includes('CERTIFICATE')) new crypto.X509Certificate(block);
            else crypto.createPublicKey(block);
          } catch {
            throw badRequest('Ein Zertifikat des Identitätsanbieters ist beschädigt');
          }
        }
      }
      if (sa.enabled && (!sa.entryPoint || !sa.idpCert)) throw badRequest('Für SAML sind Anmelde-URL und Zertifikat des Identitätsanbieters erforderlich');
      clean.saml = sa;
    }

    if (clean.kerberos) {
      const current = this.s.settings.get('kerberos');
      const input = clean.kerberos as Partial<KerberosSettings>;
      const k: KerberosSettings = {
        ...DEFAULT_SETTINGS.kerberos,
        ...current,
        enabled: input.enabled === undefined ? current.enabled : input.enabled === true,
        label: text(input.label, current.label, 60) || DEFAULT_SETTINGS.kerberos.label,
        header: text(input.header, current.header, 60) || 'X-Remote-User',
        trustedProxies: Array.isArray(input.trustedProxies)
          ? [...new Set(input.trustedProxies.map((p) => String(p).trim()).filter(Boolean))].slice(0, 50)
          : current.trustedProxies,
        proxySecret: keepSecret(input.proxySecret, current.proxySecret),
        autoLogin: input.autoLogin === undefined ? current.autoLogin : input.autoLogin === true,
        autoCreateUsers: input.autoCreateUsers === undefined ? current.autoCreateUsers : input.autoCreateUsers === true,
      };
      if (!/^[A-Za-z0-9-]{1,60}$/.test(k.header) || RESERVED_HEADERS.has(k.header.toLowerCase())) {
        throw badRequest('Ungültige Kopfzeile für die Windows-Anmeldung');
      }
      const { invalid } = proxyList(k.trustedProxies);
      if (invalid) throw badRequest(`Ungültige Adresse vertrauenswürdiger Webserver: ${invalid}`);
      if (k.enabled && !k.trustedProxies.length) throw badRequest('Für die Windows-Anmeldung mindestens einen vertrauenswürdigen Webserver angeben');
      clean.kerberos = k;
    }
  }

  /** Geheimnisse für die Anzeige maskieren. */
  maskSettings(all: Settings): void {
    all.oidc = { ...all.oidc, clientSecret: all.oidc.clientSecret ? MASK : '' };
    all.kerberos = { ...all.kerberos, proxySecret: all.kerberos.proxySecret ? MASK : '' };
  }

  /* ------------------------------ Anmeldevorgänge ------------------------------ */

  private createFlow(req: FastifyRequest, reply: FastifyReply, kind: string, requestId: string, data: FlowData): void {
    const token = randomToken(32);
    const now = new Date();
    this.s.db.run('DELETE FROM auth_flows WHERE expires_at < ?', now.toISOString());
    this.s.db.run(
      'INSERT INTO auth_flows (id, kind, request_id, data, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
      sha256(token),
      kind,
      requestId,
      JSON.stringify(data),
      now.toISOString(),
      new Date(now.getTime() + FLOW_MINUTES * 60_000).toISOString(),
    );
    reply.setCookie(SSO_FLOW_COOKIE, token, {
      path: FLOW_COOKIE_PATH,
      httpOnly: true,
      sameSite: 'lax',
      secure: this.s.auth.isSecureRequest(req),
      maxAge: FLOW_MINUTES * 60,
    });
  }

  /** Vorgang zum Cookie dieses Browsers lesen und verbrauchen (einmalig gültig). */
  private takeFlow(req: FastifyRequest, reply: FastifyReply, kind: string): (FlowRow & { parsed: FlowData }) | null {
    const token = req.cookies?.[SSO_FLOW_COOKIE];
    reply.clearCookie(SSO_FLOW_COOKIE, { path: FLOW_COOKIE_PATH });
    if (!token) return null;
    const row = this.s.db.get<FlowRow>('SELECT * FROM auth_flows WHERE id = ?', sha256(token));
    if (!row || row.kind !== kind) return null;
    this.s.db.run('DELETE FROM auth_flows WHERE id = ?', row.id);
    if (row.expires_at < nowIso()) return null;
    return { ...row, parsed: parseJson<FlowData>(row.data, { next: '/', remember: true, linkUserId: null }) };
  }

  /** Verknüpfung aus dem Profil: nur mit angemeldeter Sitzung und für das eigene Konto. */
  private linkTarget(auth: AuthContext, link: boolean): number | null {
    if (!link) return null;
    const user = this.s.perms.requireUser(auth);
    if (auth.via !== 'session') throw badRequest('Anmeldekonten lassen sich nur in einer Browsersitzung verknüpfen');
    return user.id;
  }

  /* ----------------------------------- OIDC ----------------------------------- */

  oidcIssuer(o: OidcSettings): string {
    return o.provider === 'entra' ? `https://login.microsoftonline.com/${o.tenantId.trim()}/v2.0` : o.issuer.trim();
  }

  private async oidcConfig(o: OidcSettings): Promise<oidc.Configuration> {
    const issuer = this.oidcIssuer(o);
    const clientSecret = decryptSecret(this.s.config.secret, o.clientSecret) ?? '';
    const key = sha256(`${issuer}\n${o.clientId}\n${clientSecret}`);
    if (this.oidcCache?.key === key && Date.now() - this.oidcCache.at < 3600_000) return this.oidcCache.config;
    const url = new URL(issuer);
    const insecure = url.protocol === 'http:' && isLoopbackHost(url.hostname);
    if (url.protocol !== 'https:' && !insecure) throw new SsoError('unavailable', 'Die Aussteller-URL muss mit https:// beginnen');
    const config = await oidc.discovery(url, o.clientId.trim(), undefined, clientSecret ? oidc.ClientSecretPost(clientSecret) : oidc.None(), {
      execute: insecure ? [oidc.allowInsecureRequests] : [],
      timeout: 15,
    });
    this.oidcCache = { key, at: Date.now(), config };
    return config;
  }

  async startOidc(req: FastifyRequest, reply: FastifyReply, options: { next: string; remember: boolean; link?: boolean }): Promise<string> {
    const o = this.s.settings.get('oidc');
    if (!this.oidcReady(o)) throw new SsoError('unavailable', 'Die Anmeldung über OpenID Connect ist nicht eingerichtet');
    const linkUserId = this.linkTarget(req.auth, !!options.link);
    let config: oidc.Configuration;
    try {
      config = await this.oidcConfig(o);
    } catch (err) {
      if (err instanceof SsoError) throw err;
      this.s.log.warn({ err }, 'OIDC: Anbieter nicht erreichbar');
      throw new SsoError('unavailable', 'Der Identitätsanbieter ist nicht erreichbar');
    }
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    this.createFlow(req, reply, 'oidc', state, { next: safeNext(options.next), remember: options.remember, linkUserId, verifier, nonce });
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: this.urls().redirectUri,
      scope: o.scopes,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      nonce,
      ...(linkUserId ? { prompt: 'select_account' } : {}),
    });
    return url.href;
  }

  /** Rückkehr vom Anbieter: Code einlösen, ID-Token prüfen, Person anmelden. */
  async finishOidc(req: FastifyRequest, reply: FastifyReply): Promise<{ user: UserRow; flow: FlowData }> {
    const flow = this.takeFlow(req, reply, 'oidc');
    if (!flow) throw new SsoError('flow', 'Kein passender Anmeldevorgang in diesem Browser');
    const query = req.query as Record<string, unknown>;
    if (typeof query.error === 'string') {
      throw new SsoError('provider', `Der Anbieter hat die Anmeldung abgelehnt: ${query.error.slice(0, 100)} ${claimString(query.error_description).slice(0, 300)}`);
    }
    const o = this.s.settings.get('oidc');
    if (!this.oidcReady(o)) throw new SsoError('unavailable', 'Die Anmeldung über OpenID Connect ist nicht eingerichtet');
    const search = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    const currentUrl = new URL(`${this.urls().redirectUri}${search}`);
    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    try {
      const config = await this.oidcConfig(o);
      tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: flow.parsed.verifier,
        expectedState: flow.request_id,
        expectedNonce: flow.parsed.nonce,
        idTokenExpected: true,
      });
    } catch (err) {
      this.s.log.warn({ err }, 'OIDC: Anmeldung fehlgeschlagen');
      throw new SsoError('provider', `Die Antwort des Identitätsanbieters war ungültig: ${err instanceof Error ? err.message : String(err)}`);
    }
    const claims = tokens.claims();
    if (!claims) throw new SsoError('provider', 'Der Identitätsanbieter hat kein ID-Token geliefert');
    const identity = await this.identityFromClaims(o, claims as unknown as Record<string, unknown>, tokens.access_token);
    return { user: this.complete(req.auth, identity, o, flow.parsed), flow: flow.parsed };
  }

  private async identityFromClaims(o: OidcSettings, claims: Record<string, unknown>, accessToken: string | undefined): Promise<ExternalIdentity> {
    const pick = (name: string) => claimString(claims[name]);
    // Entra ID: „oid“ ist je Person im Mandanten fest, „sub“ hängt zusätzlich von der App-Registrierung ab
    const subject = o.provider === 'entra' ? pick('oid') || pick('sub') : pick('sub');
    if (!subject) throw new SsoError('provider', 'Das ID-Token enthält keine Kennung der Person');
    const rawName = pick(o.usernameClaim) || pick('preferred_username') || pick('email') || subject;
    let groups: string[] | null = null;
    if (o.syncGroups || o.requireGroup.trim()) {
      const names = o.groupsClaim.split(/[\s,;]+/).filter(Boolean);
      const present = names.filter((n) => claims[n] !== undefined);
      const overage = (claims._claim_names as Record<string, unknown> | undefined)?.groups !== undefined;
      if (present.length) groups = [...new Set(present.flatMap((n) => claimList(claims[n])))];
      else if (overage && o.provider === 'entra') groups = accessToken ? await this.entraGroups(accessToken) : null;
      // Kein Gruppen-Claim: Person gehört keiner zugeordneten Gruppe an – Mitgliedschaften werden entzogen
      else if (names.length) groups = [];
    }
    return {
      provider: 'oidc',
      issuer: pick('iss'),
      subject,
      username: usernameFrom(rawName, o.stripDomain),
      displayName: pick(o.nameClaim).slice(0, 80),
      email: pick(o.emailClaim).slice(0, 200) || null,
      groups,
      label: (pick('preferred_username') || pick('email') || rawName).slice(0, 200),
    };
  }

  /** Mehr als 200 Gruppen: Entra ID liefert sie nicht im Token – über Microsoft Graph nachladen. */
  private async entraGroups(accessToken: string): Promise<string[] | null> {
    try {
      const res = await fetch(`${this.graphUrl}/v1.0/me/getMemberObjects`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
        body: JSON.stringify({ securityEnabledOnly: false }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        this.s.log.warn({ status: res.status }, 'Entra ID: Gruppen über Microsoft Graph nicht lesbar – Berechtigung GroupMember.Read.All erteilen oder nur zugewiesene Gruppen ausgeben');
        return null;
      }
      const body = (await res.json()) as { value?: unknown };
      return Array.isArray(body.value) ? body.value.filter((v): v is string => typeof v === 'string') : null;
    } catch (err) {
      this.s.log.warn({ err }, 'Entra ID: Microsoft Graph nicht erreichbar');
      return null;
    }
  }

  /** Verbindungstest für die Administration: Discovery-Dokument laden. */
  async testOidc(auth: AuthContext): Promise<{ ok: boolean; steps: { label: string; ok: boolean; detail: string }[] }> {
    this.s.perms.requireGlobal(auth, 'admin');
    const o = this.s.settings.get('oidc');
    const steps: { label: string; ok: boolean; detail: string }[] = [];
    if (!o.clientId.trim() || (o.provider === 'entra' ? !o.tenantId.trim() : !o.issuer.trim())) {
      return { ok: false, steps: [{ label: 'config', ok: false, detail: 'Client-ID und Mandanten-ID bzw. Aussteller-URL fehlen' }] };
    }
    this.oidcCache = null;
    try {
      const config = await this.oidcConfig(o);
      const meta = config.serverMetadata();
      steps.push({ label: 'discovery', ok: true, detail: meta.issuer });
      steps.push({ label: 'endpoints', ok: !!meta.authorization_endpoint && !!meta.token_endpoint, detail: meta.authorization_endpoint ?? '–' });
      const methods = meta.code_challenge_methods_supported;
      steps.push({ label: 'pkce', ok: !methods || methods.includes('S256'), detail: methods?.join(', ') || 'S256 (angenommen)' });
      steps.push({ label: 'secret', ok: o.provider !== 'entra' || !!o.clientSecret, detail: o.clientSecret ? 'hinterlegt' : 'nicht hinterlegt' });
    } catch (err) {
      steps.push({ label: 'discovery', ok: false, detail: err instanceof Error ? err.message : String(err) });
    }
    return { ok: steps.every((st) => st.ok), steps };
  }

  /* ----------------------------------- SAML ----------------------------------- */

  /** node-saml prüft InResponseTo gegen offene Vorgänge in der Datenbank. */
  private readonly samlCache: CacheProvider = {
    saveAsync: async (_key, value) => ({ value, createdAt: Date.now() }),
    getAsync: async (key) =>
      this.s.db.value<string>("SELECT created_at FROM auth_flows WHERE kind = 'saml' AND request_id = ? AND result IS NULL AND expires_at > ?", key, nowIso()) ?? null,
    removeAsync: async (key) => key,
  };

  private samlClient(sa: SamlSettings, requestId?: string): SAML {
    const urls = this.urls();
    const config: SamlConfig = {
      callbackUrl: urls.acsUrl,
      entryPoint: sa.entryPoint.trim(),
      issuer: urls.spEntityId,
      audience: urls.spEntityId,
      idpCert: pemBlocks(sa.idpCert),
      ...(sa.idpEntityId.trim() ? { idpIssuer: sa.idpEntityId.trim() } : {}),
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: false,
      signatureAlgorithm: 'sha256',
      identifierFormat: null,
      disableRequestedAuthnContext: true,
      validateInResponseTo: ValidateInResponseTo.always,
      requestIdExpirationPeriodMs: FLOW_MINUTES * 60_000,
      acceptedClockSkewMs: 120_000,
      cacheProvider: this.samlCache,
      generateUniqueId: () => requestId ?? `_${crypto.randomBytes(20).toString('hex')}`,
    };
    return new SAML(config);
  }

  async startSaml(req: FastifyRequest, reply: FastifyReply, options: { next: string; remember: boolean; link?: boolean }): Promise<string> {
    const sa = this.s.settings.get('saml');
    if (!this.samlReady(sa)) throw new SsoError('unavailable', 'Die Anmeldung über SAML ist nicht eingerichtet');
    const linkUserId = this.linkTarget(req.auth, !!options.link);
    const requestId = `_${crypto.randomBytes(20).toString('hex')}`;
    this.createFlow(req, reply, 'saml', requestId, { next: safeNext(options.next), remember: options.remember, linkUserId });
    return this.samlClient(sa, requestId).getAuthorizeUrlAsync('', undefined, {});
  }

  /**
   * Assertion Consumer Service: Der Anbieter schickt die Antwort per POST aus einer fremden Seite –
   * dabei fehlt das SameSite-Cookie. Die geprüfte Person wird deshalb am Vorgang abgelegt; angemeldet
   * wird erst im anschließenden Aufruf von `finishSaml`, der das Cookie wieder mitbringt.
   */
  async acceptSamlResponse(body: unknown): Promise<void> {
    const sa = this.s.settings.get('saml');
    if (!this.samlReady(sa)) throw new SsoError('unavailable', 'Die Anmeldung über SAML ist nicht eingerichtet');
    const response = (body as Record<string, unknown> | null)?.SAMLResponse;
    if (typeof response !== 'string' || !response || response.length > 1_000_000) throw new SsoError('provider', 'Keine SAML-Antwort erhalten');
    let profile: Profile | null;
    try {
      ({ profile } = await this.samlClient(sa).validatePostResponseAsync({ SAMLResponse: response }));
    } catch (err) {
      this.s.log.warn({ err }, 'SAML: Antwort abgelehnt');
      throw new SsoError('provider', `Die SAML-Antwort war ungültig: ${err instanceof Error ? err.message : String(err)}`);
    }
    const requestId = typeof profile?.inResponseTo === 'string' ? profile.inResponseTo : '';
    if (!profile || !requestId) throw new SsoError('flow', 'Die SAML-Antwort gehört zu keiner Anmeldung');
    // node-saml prüft den Aussteller nur bei Abmeldungen – für Anmeldungen hier selbst
    if (sa.idpEntityId.trim() && profile.issuer !== sa.idpEntityId.trim()) {
      throw new SsoError('provider', `Die SAML-Antwort stammt von einem anderen Aussteller (${String(profile.issuer).slice(0, 200)})`);
    }
    const identity = this.identityFromSaml(sa, profile);
    const stored = this.s.db.run(
      "UPDATE auth_flows SET result = ? WHERE kind = 'saml' AND request_id = ? AND result IS NULL AND expires_at > ?",
      JSON.stringify(identity),
      requestId,
      nowIso(),
    );
    if (!stored.changes) throw new SsoError('flow', 'Die SAML-Antwort wurde bereits verwendet');
  }

  async finishSaml(req: FastifyRequest, reply: FastifyReply): Promise<{ user: UserRow; flow: FlowData }> {
    const flow = this.takeFlow(req, reply, 'saml');
    if (!flow?.result) throw new SsoError('flow', 'Kein abgeschlossener Anmeldevorgang in diesem Browser');
    const identity = parseJson<ExternalIdentity | null>(flow.result, null);
    if (!identity) throw new SsoError('flow', 'Anmeldevorgang beschädigt');
    return { user: this.complete(req.auth, identity, this.s.settings.get('saml'), flow.parsed), flow: flow.parsed };
  }

  private identityFromSaml(sa: SamlSettings, profile: Profile): ExternalIdentity {
    const attributes = (profile.attributes ?? {}) as Record<string, unknown>;
    const pick = (name: string) => (name ? claimString(attributes[name]) : '');
    const rawName = pick(sa.usernameAttribute) || profile.nameID || '';
    // Transiente NameIDs wechseln bei jeder Anmeldung – dann trägt das Benutzername-Attribut die Kennung
    const transient = profile.nameIDFormat === TRANSIENT_NAMEID;
    const subject = transient ? pick(sa.usernameAttribute) : profile.nameID;
    if (!subject) throw new SsoError('provider', 'Die SAML-Antwort enthält keine dauerhafte Kennung (NameID bzw. Benutzername-Attribut)');
    let groups: string[] | null = null;
    if ((sa.syncGroups || sa.requireGroup.trim()) && sa.groupsAttribute) groups = [...new Set(claimList(attributes[sa.groupsAttribute]))];
    return {
      provider: 'saml',
      issuer: profile.issuer || sa.idpEntityId,
      subject,
      username: usernameFrom(rawName, sa.stripDomain),
      displayName: pick(sa.nameAttribute).slice(0, 80),
      email: (pick(sa.emailAttribute) || claimString(profile.email)).slice(0, 200) || null,
      groups,
      label: rawName.slice(0, 200),
    };
  }

  metadata(): string {
    const sa = this.s.settings.get('saml');
    const urls = this.urls();
    // Die Metadaten brauchen kein IdP-Zertifikat – vorläufiger Platzhalter, damit sie auch vor der Einrichtung abrufbar sind
    const client = new SAML({
      callbackUrl: urls.acsUrl,
      issuer: urls.spEntityId,
      idpCert: pemBlocks(sa.idpCert)[0] ?? 'MA==',
      wantAssertionsSigned: true,
      identifierFormat: null,
    });
    return client.generateServiceProviderMetadata(null, null);
  }

  testSaml(auth: AuthContext): { ok: boolean; steps: { label: string; ok: boolean; detail: string }[] } {
    this.s.perms.requireGlobal(auth, 'admin');
    const sa = this.s.settings.get('saml');
    const steps: { label: string; ok: boolean; detail: string }[] = [];
    steps.push({ label: 'entryPoint', ok: !!sa.entryPoint, detail: sa.entryPoint || 'fehlt' });
    const blocks = pemBlocks(sa.idpCert);
    if (!blocks.length) steps.push({ label: 'certificate', ok: false, detail: 'kein Zertifikat hinterlegt' });
    for (const block of blocks) {
      if (!block.includes('CERTIFICATE')) {
        steps.push({ label: 'certificate', ok: true, detail: 'öffentlicher Schlüssel' });
        continue;
      }
      const cert = new crypto.X509Certificate(block);
      const expired = new Date(cert.validTo).getTime() < Date.now();
      steps.push({ label: 'certificate', ok: !expired, detail: `${cert.subject.replace(/\n/g, ', ')} · gültig bis ${new Date(cert.validTo).toISOString().slice(0, 10)} · SHA-1 ${cert.fingerprint}` });
    }
    steps.push({ label: 'idpEntityId', ok: !!sa.idpEntityId, detail: sa.idpEntityId || 'nicht gesetzt – der Aussteller wird dann nicht geprüft' });
    return { ok: steps.every((st) => st.ok), steps };
  }

  /* ---------------------------- Windows-Anmeldung ---------------------------- */

  isTrustedProxy(address: string, entries: string[]): boolean {
    const plain = plainAddress(address);
    if (!plain) return false;
    const { list } = proxyList(entries);
    return list.check(plain, net.isIPv6(plain) ? 'ipv6' : 'ipv4');
  }

  /** Link aus dem Profil vorbereiten: Der nächste Aufruf der Windows-Anmeldung verknüpft statt anzumelden. */
  startKerberosLink(req: FastifyRequest, reply: FastifyReply): string {
    const k = this.s.settings.get('kerberos');
    if (!k.enabled) throw new SsoError('unavailable', 'Die Windows-Anmeldung ist nicht eingerichtet');
    const linkUserId = this.linkTarget(req.auth, true);
    this.createFlow(req, reply, 'kerberos', randomToken(16), { next: '/profile/sign-in', remember: true, linkUserId });
    return '/api/v1/auth/kerberos';
  }

  async kerberos(req: FastifyRequest, reply: FastifyReply, options: { next: string; remember: boolean }): Promise<{ user: UserRow; flow: FlowData }> {
    const k = this.s.settings.get('kerberos');
    if (!k.enabled) throw new SsoError('unavailable', 'Die Windows-Anmeldung ist nicht eingerichtet');
    const flow = req.cookies?.[SSO_FLOW_COOKIE] ? this.takeFlow(req, reply, 'kerberos') : null;
    const flowData: FlowData = flow?.parsed ?? { next: safeNext(options.next), remember: options.remember, linkUserId: null };

    // Maßgeblich ist die Socket-Adresse – X-Forwarded-For ließe sich fälschen
    const remote = plainAddress(req.raw.socket?.remoteAddress);
    if (!this.isTrustedProxy(remote, k.trustedProxies)) {
      throw new SsoError('proxy', `Windows-Anmeldung nur über den eingerichteten Webserver (Anfrage von ${remote || 'unbekannt'})`);
    }
    const secret = decryptSecret(this.s.config.secret, k.proxySecret) ?? '';
    if (secret) {
      // Ein Webserver, der vor der Umbenennung eingerichtet wurde, sendet noch X-Doku-Proxy-Secret
      const given = headerValue(req.headers, 'proxy-secret');
      if (typeof given !== 'string' || !safeEqual(given, secret)) throw new SsoError('proxy', 'Das gemeinsame Geheimnis des Webservers fehlt oder ist falsch');
    }
    const header = req.headers[k.header.toLowerCase()];
    const raw = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
    if (!raw || raw.length > 300) throw new SsoError('no_user', 'Der Webserver hat kein Windows-Konto übermittelt');

    let account = raw;
    let realm = '';
    if (account.includes('\\')) {
      realm = account.slice(0, account.indexOf('\\'));
      account = account.slice(account.lastIndexOf('\\') + 1);
    } else if (account.includes('@')) {
      realm = account.slice(account.lastIndexOf('@') + 1);
      account = account.slice(0, account.lastIndexOf('@'));
    }

    // Mit Verzeichnisanbindung: Profil und Gruppen wie bei der Passwortanmeldung aus dem AD
    if (this.s.directory.isEnabled() && !flowData.linkUserId) {
      let profile;
      try {
        profile = await this.s.directory.lookup(account);
      } catch (err) {
        throw new SsoError('no_account', err instanceof Error ? err.message : String(err));
      }
      if (!profile) throw new SsoError('no_account', 'Das Windows-Konto wurde im Verzeichnis nicht gefunden');
      let row: UserRow;
      try {
        row = this.s.directory.syncUser(profile);
      } catch (err) {
        throw new SsoError('conflict', err instanceof Error ? err.message : String(err));
      }
      if (row.status !== 'active') throw new SsoError('disabled', 'Dieses Konto ist deaktiviert');
      this.s.db.run('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?', nowIso(), row.id);
      this.emitLogin(req.auth, row, 'kerberos');
      return { user: row, flow: flowData };
    }

    const identity: ExternalIdentity = {
      provider: 'kerberos',
      issuer: realm.toLowerCase(),
      subject: account.toLowerCase(),
      username: usernameFrom(account, true),
      displayName: '',
      email: null,
      groups: null,
      label: raw.slice(0, 200),
    };
    const rules: SsoAccountRules = { autoCreateUsers: k.autoCreateUsers, adoptExistingUsers: true, syncGroups: false, requireGroup: '', stripDomain: true };
    return { user: this.complete(req.auth, identity, rules, flowData), flow: flowData };
  }

  /* ------------------------------ Konto zuordnen ------------------------------ */

  private emitLogin(auth: AuthContext, row: UserRow, via: SsoProvider): void {
    this.s.emit(
      { ...auth, user: { id: row.id, username: row.username, displayName: row.display_name, email: row.email, kind: row.kind, avatarColor: row.avatar_color, preferences: {} } },
      { type: 'auth.login', target: { type: 'user', id: row.id, label: row.username }, data: { via } },
    );
  }

  private identityRow(identity: ExternalIdentity): IdentityRow | undefined {
    return this.s.db.get<IdentityRow>('SELECT * FROM user_identities WHERE provider = ? AND issuer = ? AND subject = ?', identity.provider, identity.issuer, identity.subject);
  }

  private insertIdentity(userId: number, identity: ExternalIdentity): void {
    this.s.db.run(
      'INSERT INTO user_identities (user_id, provider, issuer, subject, label, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      userId,
      identity.provider,
      identity.issuer,
      identity.subject,
      identity.label,
      nowIso(),
      nowIso(),
    );
  }

  /** Bestätigte Person einem Knowstead-Konto zuordnen – anlegen, übernehmen oder verknüpfen. */
  private complete(auth: AuthContext, identity: ExternalIdentity, rules: SsoAccountRules, flow: FlowData): UserRow {
    const linked = this.identityRow(identity);

    if (flow.linkUserId) {
      // Die Verknüpfung muss in derselben Sitzung enden, in der sie begonnen wurde
      const current = auth.user;
      if (!current || current.id !== flow.linkUserId) throw new SsoError('flow', 'Die Verknüpfung wurde in einer anderen Sitzung begonnen');
      if (linked && linked.user_id !== flow.linkUserId) throw new SsoError('identity_taken', 'Dieses Anmeldekonto ist bereits mit einer anderen Person verknüpft');
      if (!linked) {
        this.insertIdentity(flow.linkUserId, identity);
        this.s.emit(auth, {
          type: 'auth.identity_linked',
          target: { type: 'user', id: flow.linkUserId, label: current.username },
          data: { provider: identity.provider, account: identity.label },
        });
      }
      return this.s.users.require(flow.linkUserId);
    }

    const failed = (code: SsoErrorCode, message: string, target?: UserRow): SsoError => {
      this.s.emit(auth, {
        type: 'auth.login_failed',
        target: { type: 'user', id: target?.id ?? 0, label: target?.username ?? identity.label.slice(0, 80) },
        data: { reason: `sso_${code}`, via: identity.provider },
      });
      return new SsoError(code, message);
    };

    if (rules.requireGroup.trim() && !(identity.groups && this.s.directory.matchesAny(identity.groups, [rules.requireGroup]))) {
      throw failed('group', 'Für dieses Konto fehlt die erforderliche Gruppe');
    }

    let user: UserRow;
    if (linked) {
      user = this.s.users.require(linked.user_id);
    } else {
      if (!USERNAME_RE.test(identity.username)) throw failed('no_user', `Aus „${identity.label}“ lässt sich kein gültiger Benutzername bilden`);
      const byName = this.s.users.byUsername(identity.username);
      if (byName) {
        if (!rules.adoptExistingUsers || byName.kind === 'bot') throw failed('account_exists', 'Für diesen Benutzernamen gibt es bereits ein Konto', byName);
        if (this.s.users.isAdmin(byName.id)) throw failed('admin_link', 'Administratorkonten werden nicht automatisch verknüpft', byName);
        const otherIdentity = this.s.db.value('SELECT 1 FROM user_identities WHERE user_id = ? AND provider = ? AND issuer = ?', byName.id, identity.provider, identity.issuer);
        if (otherIdentity) throw failed('conflict', 'Das vorhandene Konto ist bereits mit einem anderen Anmeldekonto verknüpft', byName);
        this.s.db.transaction(() => {
          this.insertIdentity(byName.id, identity);
          // Übernommene lokale Konten melden sich künftig nur noch über den Anbieter an
          if (identity.provider !== 'kerberos' && byName.auth_source === 'local') {
            this.s.db.run('UPDATE users SET auth_source = ?, password_hash = NULL, updated_at = ? WHERE id = ?', identity.provider, nowIso(), byName.id);
          }
        });
        this.s.emit(auth, {
          type: 'auth.identity_linked',
          target: { type: 'user', id: byName.id, label: byName.username },
          data: { provider: identity.provider, account: identity.label, adopted: true },
        });
        user = this.s.users.require(byName.id);
      } else {
        if (!rules.autoCreateUsers) throw failed('no_account', 'Für dieses Konto ist kein Zugang eingerichtet');
        user = this.createUser(identity);
        this.s.emit(auth, {
          type: 'user.created',
          target: { type: 'user', id: user.id, label: user.username },
          data: { via: identity.provider },
        });
      }
    }

    if (user.status !== 'active') throw failed('disabled', 'Dieses Konto ist deaktiviert', user);
    if (user.kind === 'bot') throw failed('no_account', 'Dieses Konto kann sich nicht anmelden', user);

    const now = nowIso();
    const emailOwner = identity.email ? this.s.db.value<number>('SELECT id FROM users WHERE email = ?', identity.email) : undefined;
    const email = identity.email && (emailOwner === undefined || emailOwner === user.id) ? identity.email : null;
    this.s.db.run(
      `UPDATE users SET display_name = COALESCE(NULLIF(?, ''), display_name), email = COALESCE(?, email), last_login_at = ?, synced_at = ?,
                        failed_logins = 0, locked_until = NULL WHERE id = ?`,
      identity.displayName,
      email,
      now,
      now,
      user.id,
    );
    this.s.db.run('UPDATE user_identities SET last_login_at = ?, label = ? WHERE provider = ? AND issuer = ? AND subject = ?', now, identity.label, identity.provider, identity.issuer, identity.subject);
    if (rules.syncGroups && identity.groups) this.s.directory.syncGroups(user.id, identity.groups);
    const fresh = this.s.users.require(user.id);
    this.emitLogin(auth, fresh, identity.provider);
    return fresh;
  }

  private createUser(identity: ExternalIdentity): UserRow {
    const now = nowIso();
    const emailTaken = identity.email ? this.s.db.value('SELECT 1 FROM users WHERE email = ?', identity.email) : undefined;
    const source = identity.provider === 'kerberos' ? 'local' : identity.provider;
    const id = this.s.db.transaction(() => {
      const res = this.s.db.run(
        `INSERT INTO users (username, email, display_name, password_hash, kind, status, avatar_color, created_at, updated_at, auth_source, synced_at)
         VALUES (?, ?, ?, NULL, 'user', 'active', ?, ?, ?, ?, ?)`,
        identity.username,
        emailTaken ? null : identity.email,
        identity.displayName || identity.username,
        colorFor(identity.username),
        now,
        now,
        source,
        now,
      );
      const userId = res.lastInsertRowid;
      for (const g of this.s.db.all<{ id: number }>('SELECT id FROM groups WHERE is_default = 1')) {
        this.s.db.run('INSERT OR IGNORE INTO group_members (group_id, user_id, added_at) VALUES (?, ?, ?)', g.id, userId, now);
      }
      this.insertIdentity(userId, identity);
      return userId;
    });
    return this.s.users.require(id);
  }

  /* ------------------------------ Profil ------------------------------ */

  private toDto(row: IdentityRow): IdentityDto {
    return { id: row.id, provider: row.provider, label: row.label, createdAt: row.created_at, lastLoginAt: row.last_login_at };
  }

  identities(userId: number): IdentityDto[] {
    return this.s.db.all<IdentityRow>('SELECT * FROM user_identities WHERE user_id = ? ORDER BY provider, created_at', userId).map((r) => this.toDto(r));
  }

  myIdentities(auth: AuthContext): IdentityDto[] {
    return this.identities(this.s.perms.requireUser(auth).id);
  }

  /** Verknüpfung lösen – nie die letzte Möglichkeit, sich anzumelden. */
  unlink(auth: AuthContext, userId: number, identityId: number): void {
    const self = this.s.perms.requireUser(auth).id === userId;
    if (!self) this.s.perms.requireGlobal(auth, 'users.manage');
    const row = this.s.db.get<IdentityRow>('SELECT * FROM user_identities WHERE id = ? AND user_id = ?', identityId, userId);
    if (!row) throw notFound('Verknüpfung nicht gefunden');
    const user = this.s.users.require(userId);
    const others = this.s.db.value<number>('SELECT COUNT(*) FROM user_identities WHERE user_id = ? AND id != ?', userId, identityId) ?? 0;
    const canStillSignIn = !!user.password_hash || (user.auth_source === 'ldap' && this.s.directory.isEnabled()) || others > 0;
    if (self && !canStillSignIn) {
      throw new HttpError(400, 'last_sign_in', 'Das ist die einzige Anmeldemöglichkeit dieses Kontos – bitte zuerst ein Passwort festlegen oder ein anderes Konto verknüpfen');
    }
    this.s.db.run('DELETE FROM user_identities WHERE id = ?', identityId);
    this.s.emit(auth, {
      type: 'auth.identity_unlinked',
      target: { type: 'user', id: userId, label: user.username },
      data: { provider: row.provider, account: row.label },
    });
  }

  /** Verknüpfung aus dem Profil beginnen – liefert die Adresse, zu der der Browser wechselt. */
  async startLink(req: FastifyRequest, reply: FastifyReply, provider: SsoProvider): Promise<string> {
    if (provider === 'oidc') return this.startOidc(req, reply, { next: '/profile/sign-in', remember: true, link: true });
    if (provider === 'saml') return this.startSaml(req, reply, { next: '/profile/sign-in', remember: true, link: true });
    return this.startKerberosLink(req, reply);
  }

  /** Abgelaufene Vorgänge entfernen (Wartung). */
  prune(): number {
    return this.s.db.run('DELETE FROM auth_flows WHERE expires_at < ?', nowIso()).changes;
  }
}
