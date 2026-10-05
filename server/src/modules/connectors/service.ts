import type { Services } from '../../services.ts';
import type { ConnectorRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { nowIso, parseJson } from '../../db/database.ts';
import { decryptSecret, encryptSecret } from '../../core/crypto.ts';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../../core/errors.ts';
import { parse } from 'node-html-parser';

export type AuthType = ConnectorRow['auth_type'];

export interface ConnectorAuth {
  token?: string;
  username?: string;
  password?: string;
  name?: string;
  value?: string;
}

export interface ConnectorInput {
  key: string;
  name: string;
  description?: string;
  baseUrl: string;
  authType?: AuthType;
  auth?: ConnectorAuth | null;
  headers?: Record<string, string>;
  allowedPaths?: string[];
  cacheTtl?: number;
  timeoutMs?: number;
  active?: boolean;
}

export interface ConnectorDto {
  id: number;
  key: string;
  name: string;
  description: string;
  baseUrl: string;
  authType: AuthType;
  authConfigured: boolean;
  authHint: string;
  headers: Record<string, string>;
  allowedPaths: string[];
  cacheTtl: number;
  timeoutMs: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QueryResult {
  status: number;
  ok: boolean;
  contentType: string;
  data: unknown;
  fetchedAt: string;
  cached: boolean;
  url: string;
}

const MAX_RESPONSE = 2 * 1024 * 1024;
const AUTH_TYPES: AuthType[] = ['none', 'bearer', 'basic', 'header', 'query'];

/**
 * API-Konnektoren: Administratoren hinterlegen externe REST-APIs (inkl. Zugangsdaten).
 * Seiten binden Daten daraus über das Makro „API-Daten“ ein. Anfragen laufen über den
 * Server (Proxy), damit Zugangsdaten nie im Browser landen. Nur GET-Anfragen.
 */
export class ConnectorService {
  private readonly s: Services;
  private readonly cache = new Map<string, QueryResult & { expires: number }>();

  constructor(s: Services) {
    this.s = s;
  }

  private require(id: number): ConnectorRow {
    const row = this.s.db.get<ConnectorRow>('SELECT * FROM connectors WHERE id = ?', id);
    if (!row) throw notFound('Konnektor nicht gefunden');
    return row;
  }

  private toDto(row: ConnectorRow): ConnectorDto {
    const auth = this.readAuth(row);
    let hint = '';
    if (row.auth_type === 'basic') hint = auth?.username ? `Benutzer: ${auth.username}` : '';
    if (row.auth_type === 'header' || row.auth_type === 'query') hint = auth?.name ?? '';
    if (row.auth_type === 'bearer') hint = auth?.token ? `Token …${auth.token.slice(-4)}` : '';
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      baseUrl: row.base_url,
      authType: row.auth_type,
      authConfigured: !!row.auth_secret,
      authHint: hint,
      headers: parseJson<Record<string, string>>(row.headers, {}),
      allowedPaths: parseJson<string[]>(row.allowed_paths, []),
      cacheTtl: row.cache_ttl,
      timeoutMs: row.timeout_ms,
      active: !!row.active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private readAuth(row: ConnectorRow): ConnectorAuth | null {
    const raw = decryptSecret(this.s.config.secret, row.auth_secret);
    return raw ? parseJson<ConnectorAuth>(raw, {}) : null;
  }

  list(auth: AuthContext): ConnectorDto[] {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    return this.s.db.all<ConnectorRow>('SELECT * FROM connectors ORDER BY name COLLATE NOCASE').map((r) => this.toDto(r));
  }

  /** Öffentliche Kurzliste für die Makro-Konfiguration. */
  available(auth: AuthContext): { key: string; name: string; description: string; baseUrl: string }[] {
    this.s.perms.requireUser(auth);
    return this.s.db
      .all<ConnectorRow>('SELECT * FROM connectors WHERE active = 1 ORDER BY name COLLATE NOCASE')
      .map((r) => ({ key: r.key, name: r.name, description: r.description, baseUrl: r.base_url }));
  }

  private validate(input: ConnectorInput): void {
    if (!/^[a-z0-9][a-z0-9_-]{1,39}$/i.test(input.key ?? '')) throw badRequest('Der Schlüssel darf nur a–z, 0–9, _ und - enthalten (2–40 Zeichen)');
    if (!input.name?.trim()) throw badRequest('Bitte einen Namen angeben');
    let url: URL;
    try {
      url = new URL(input.baseUrl);
    } catch {
      throw badRequest('Ungültige Basis-URL');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw badRequest('Nur http(s)-URLs sind erlaubt');
    if (input.authType && !AUTH_TYPES.includes(input.authType)) throw badRequest('Unbekannte Authentifizierungsart');
    for (const [k, v] of Object.entries(input.headers ?? {})) {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(k) || /[\r\n]/.test(v)) throw badRequest(`Ungültiger Header: ${k}`);
    }
  }

  create(auth: AuthContext, input: ConnectorInput): ConnectorDto {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    this.validate(input);
    if (this.s.db.get('SELECT 1 FROM connectors WHERE key = ?', input.key)) throw conflict('Dieser Schlüssel ist bereits vergeben');
    const now = nowIso();
    const id = this.s.db.run(
      `INSERT INTO connectors (key, name, description, base_url, auth_type, auth_secret, headers, allowed_paths, cache_ttl, timeout_ms, active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.key.toLowerCase(),
      input.name.trim(),
      input.description ?? '',
      input.baseUrl.trim().replace(/\/+$/, ''),
      input.authType ?? 'none',
      input.auth ? encryptSecret(this.s.config.secret, JSON.stringify(input.auth)) : null,
      JSON.stringify(input.headers ?? {}),
      JSON.stringify((input.allowedPaths ?? []).filter(Boolean)),
      Math.max(0, input.cacheTtl ?? 300),
      Math.min(60000, Math.max(1000, input.timeoutMs ?? 10000)),
      input.active === false ? 0 : 1,
      auth.user?.id ?? null,
      now,
      now,
    ).lastInsertRowid;
    this.s.emit(auth, { type: 'connector.created', target: { type: 'connector', id, label: input.name }, data: { baseUrl: input.baseUrl } });
    return this.toDto(this.require(id));
  }

  update(auth: AuthContext, id: number, input: Partial<ConnectorInput>): ConnectorDto {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    const row = this.require(id);
    const merged: ConnectorInput = {
      key: input.key ?? row.key,
      name: input.name ?? row.name,
      description: input.description ?? row.description,
      baseUrl: input.baseUrl ?? row.base_url,
      authType: input.authType ?? row.auth_type,
      headers: input.headers ?? parseJson<Record<string, string>>(row.headers, {}),
      allowedPaths: input.allowedPaths ?? parseJson<string[]>(row.allowed_paths, []),
      cacheTtl: input.cacheTtl ?? row.cache_ttl,
      timeoutMs: input.timeoutMs ?? row.timeout_ms,
      active: input.active ?? !!row.active,
    };
    this.validate(merged);
    const other = this.s.db.get<{ id: number }>('SELECT id FROM connectors WHERE key = ?', merged.key);
    if (other && other.id !== id) throw conflict('Dieser Schlüssel ist bereits vergeben');
    // auth: undefined = unverändert, null = entfernen, Objekt = ersetzen (leere Felder behalten alte Werte)
    let secret = row.auth_secret;
    if (input.auth === null || merged.authType === 'none') secret = null;
    else if (input.auth) {
      const previous = this.readAuth(row) ?? {};
      const next: ConnectorAuth = { ...previous };
      for (const [k, v] of Object.entries(input.auth)) if (v !== undefined && v !== '') (next as Record<string, string>)[k] = v as string;
      secret = encryptSecret(this.s.config.secret, JSON.stringify(next));
    }
    this.s.db.run(
      `UPDATE connectors SET key = ?, name = ?, description = ?, base_url = ?, auth_type = ?, auth_secret = ?, headers = ?, allowed_paths = ?,
              cache_ttl = ?, timeout_ms = ?, active = ?, updated_at = ? WHERE id = ?`,
      merged.key.toLowerCase(),
      merged.name.trim(),
      merged.description ?? '',
      merged.baseUrl.trim().replace(/\/+$/, ''),
      merged.authType ?? 'none',
      secret,
      JSON.stringify(merged.headers ?? {}),
      JSON.stringify((merged.allowedPaths ?? []).filter(Boolean)),
      Math.max(0, merged.cacheTtl ?? 300),
      Math.min(60000, Math.max(1000, merged.timeoutMs ?? 10000)),
      merged.active ? 1 : 0,
      nowIso(),
      id,
    );
    this.clearCache(id);
    this.s.emit(auth, { type: 'connector.updated', target: { type: 'connector', id, label: merged.name } });
    return this.toDto(this.require(id));
  }

  delete(auth: AuthContext, id: number): void {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    const row = this.require(id);
    this.s.db.run('DELETE FROM connectors WHERE id = ?', id);
    this.clearCache(id);
    this.s.emit(auth, { type: 'connector.deleted', target: { type: 'connector', id, label: row.name } });
  }

  private clearCache(id: number): void {
    for (const key of this.cache.keys()) if (key.startsWith(`${id}:`)) this.cache.delete(key);
  }

  /** Baut die Ziel-URL und stellt sicher, dass sie unterhalb der Basis-URL liegt. */
  private buildUrl(row: ConnectorRow, path: string, params: Record<string, string> = {}, authData: ConnectorAuth | null): URL {
    const base = new URL(row.base_url.endsWith('/') ? row.base_url : row.base_url + '/');
    const relative = path.replace(/^\/+/, '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(relative) || relative.startsWith('//')) throw badRequest('Nur relative Pfade sind erlaubt');
    const url = new URL(relative, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) throw badRequest('Der Pfad verlässt die Basis-URL');
    if (/(^|\/)\.\.(\/|$)/.test(decodeURIComponent(url.pathname))) throw badRequest('Ungültiger Pfad');
    const allowed = parseJson<string[]>(row.allowed_paths, []);
    const relPath = '/' + url.pathname.slice(base.pathname.length);
    if (allowed.length && !allowed.some((p) => relPath.startsWith(p.startsWith('/') ? p : `/${p}`))) {
      throw forbidden(`Der Pfad ${relPath} ist für diesen Konnektor nicht freigegeben`);
    }
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    if (row.auth_type === 'query' && authData?.name) url.searchParams.set(authData.name, authData.value ?? '');
    return url;
  }

  private async fetchData(row: ConnectorRow, path: string, params: Record<string, string>, useCache: boolean): Promise<QueryResult> {
    if (!row.active) throw badRequest('Der Konnektor ist deaktiviert');
    const authData = this.readAuth(row);
    const url = this.buildUrl(row, path, params, authData);
    const displayUrl = new URL(url);
    if (row.auth_type === 'query' && authData?.name) displayUrl.searchParams.set(authData.name, '***');
    const cacheKey = `${row.id}:${url.toString()}`;
    const cached = this.cache.get(cacheKey);
    if (useCache && cached && cached.expires > Date.now()) return { ...cached, cached: true };

    const headers: Record<string, string> = { Accept: 'application/json, text/plain;q=0.8, */*;q=0.5', 'User-Agent': `Knowstead/${this.s.config.version}` };
    Object.assign(headers, parseJson<Record<string, string>>(row.headers, {}));
    if (row.auth_type === 'bearer' && authData?.token) headers.Authorization = `Bearer ${authData.token}`;
    if (row.auth_type === 'basic' && authData?.username) {
      headers.Authorization = `Basic ${Buffer.from(`${authData.username}:${authData.password ?? ''}`).toString('base64')}`;
    }
    if (row.auth_type === 'header' && authData?.name) headers[authData.name] = authData.value ?? '';

    let res: Response;
    try {
      // Keine Weiterleitungen: sonst könnte ein Ziel die Anfrage samt Zugangsdaten
      // auf einen anderen Host umlenken (SSRF).
      res = await fetch(url, { headers, signal: AbortSignal.timeout(row.timeout_ms), redirect: 'manual' });
    } catch (err) {
      throw new HttpError(502, 'upstream_error', `Die API ist nicht erreichbar: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status >= 300 && res.status < 400) {
      throw new HttpError(502, 'upstream_redirect', 'Die API antwortet mit einer Weiterleitung. Bitte die Basis-URL direkt eintragen.');
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_RESPONSE) {
          await reader.cancel();
          throw new HttpError(502, 'upstream_too_large', 'Die Antwort der API ist zu groß (max. 2 MB)');
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks).toString('utf8');
    const contentType = res.headers.get('content-type') ?? '';
    let data: unknown = text;
    if (/json/i.test(contentType) || /^\s*[[{]/.test(text)) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    const result: QueryResult = {
      status: res.status,
      ok: res.ok,
      contentType,
      data,
      fetchedAt: nowIso(),
      cached: false,
      url: displayUrl.toString(),
    };
    if (res.ok && row.cache_ttl > 0) {
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(cacheKey, { ...result, expires: Date.now() + row.cache_ttl * 1000 });
    }
    return result;
  }

  /**
   * Abfrage für das Makro „API-Daten“. Zugangsdaten eines Konnektors dürfen nicht zum
   * Selbstbedienungs-Proxy werden: Leser erhalten nur Daten, die in der Seite als Makro
   * (Konnektor + Pfad) hinterlegt sind. Wer die Seite bearbeiten darf (Makro einrichten)
   * oder Integrationen verwaltet, darf frei abfragen.
   */
  async query(auth: AuthContext, key: string, input: { path: string; params?: Record<string, string>; pageId?: number; refresh?: boolean }) {
    if (!this.s.perms.hasGlobal(auth, 'integrations.manage')) {
      if (!input.pageId) {
        this.s.perms.requireUser(auth);
        throw forbidden('Daten aus API-Konnektoren sind nur innerhalb einer Seite abrufbar');
      }
      const { page, space } = this.s.pages.requireViewable(auth, input.pageId);
      if (!this.s.pages.access(auth, page, space).edit) {
        const hasParams = !!input.params && Object.keys(input.params).length > 0;
        if (hasParams || !macroInContent(page.content_type === 'richtext' ? page.content : '', key, input.path)) {
          throw forbidden('Diese Abfrage ist in der Seite nicht hinterlegt');
        }
      }
    }
    const row = this.s.db.get<ConnectorRow>('SELECT * FROM connectors WHERE key = ?', key);
    if (!row) throw notFound(`Konnektor „${key}“ nicht gefunden`);
    return this.fetchData(row, input.path, input.params ?? {}, !input.refresh);
  }

  async test(auth: AuthContext, id: number, path: string) {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    return this.fetchData(this.require(id), path || '/', {}, false);
  }
}

/** Enthält der Seiteninhalt ein Makro „API-Daten“ mit diesem Konnektor und Pfad? */
export function macroInContent(html: string, key: string, path: string): boolean {
  if (!html || !html.includes('api-data')) return false;
  const wanted = path.trim();
  return parse(html)
    .querySelectorAll('[data-type="api-data"]')
    .some((el) => el.getAttribute('data-connector') === key && (el.getAttribute('data-path') ?? '').trim() === wanted);
}
