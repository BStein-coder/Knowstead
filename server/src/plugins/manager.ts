import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Services } from '../services.ts';
import type { AuthContext } from '../core/permissions.ts';
import { nowIso, parseJson } from '../db/database.ts';
import { HttpError, badRequest, forbidden, notFound, unauthorized } from '../core/errors.ts';
import { decryptSecret, encryptSecret } from '../core/crypto.ts';
import type {
  PluginContext,
  PluginInstance,
  PluginManifest,
  PluginRegister,
  PluginRequest,
  PluginResponse,
  PluginRouteHandler,
  PluginRouteOptions,
} from './types.ts';

interface Discovered {
  manifest: PluginManifest;
  dir: string;
  error: string | null;
}

interface RouteEntry {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: PluginRouteHandler;
  options: PluginRouteOptions;
}

interface Active {
  instance: PluginInstance | void;
  routes: RouteEntry[];
  loadedAt: string;
}

export interface PluginDto {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  homepage: string;
  enabled: boolean;
  loaded: boolean;
  error: string | null;
  hasServer: boolean;
  hasClient: boolean;
  settingsSchema: PluginManifest['settings'];
  settings: Record<string, unknown>;
}

const ID_RE = /^[a-z0-9][a-z0-9-]{1,48}$/;

/** Schlüssel, die nicht als Einstellungsname taugen (Objekt-Interna). */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Liegt `target` wirklich innerhalb von `dir` (nicht nur mit gleichem Präfix)? */
function isInside(dir: string, target: string): boolean {
  const rel = path.relative(dir, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function compileRoute(p: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const clean = '/' + p.replace(/^\/+|\/+$/g, '');
  const source = clean
    .split('/')
    .map((seg) => {
      if (seg.startsWith(':')) {
        keys.push(seg.slice(1));
        return '([^/]+)';
      }
      if (seg === '*') {
        keys.push('wildcard');
        return '(.*)';
      }
      return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return { pattern: new RegExp(`^${source === '' ? '/' : source}/?$`), keys };
}

/**
 * Lädt Plugins aus dem Plugin-Verzeichnis, verwaltet Aktivierung und
 * Einstellungen und stellt Plugin-Routen unter /api/v1/plugins/<id>/… bereit.
 * Aktivieren/Deaktivieren funktioniert ohne Neustart.
 */
export class PluginManager {
  private readonly s: Services;
  private readonly discovered = new Map<string, Discovered>();
  private readonly active = new Map<string, Active>();

  constructor(s: Services) {
    this.s = s;
  }

  scan(): void {
    this.discovered.clear();
    const dir = this.s.config.pluginsDir;
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const pluginDir = path.join(dir, entry.name);
      const manifestFile = path.join(pluginDir, 'plugin.json');
      if (!fs.existsSync(manifestFile)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as PluginManifest;
        if (!ID_RE.test(manifest.id ?? '')) throw new Error('Ungültige Plugin-ID (a–z, 0–9, -)');
        if (!manifest.name || !manifest.version) throw new Error('name und version sind Pflichtfelder');
        for (const f of [manifest.server, manifest.client]) {
          if (f && !isInside(pluginDir, path.resolve(pluginDir, f))) throw new Error('Ungültiger Dateipfad im Manifest');
        }
        for (const def of manifest.settings ?? []) {
          if (DANGEROUS_KEYS.has(def.key)) throw new Error(`Unzulässiger Einstellungsschlüssel: ${def.key}`);
        }
        this.discovered.set(manifest.id, { manifest, dir: pluginDir, error: null });
      } catch (err) {
        const id = entry.name.toLowerCase();
        this.discovered.set(id, {
          manifest: { id, name: entry.name, version: '?' },
          dir: pluginDir,
          error: `plugin.json fehlerhaft: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
    const now = nowIso();
    for (const id of this.discovered.keys()) {
      this.s.db.run('INSERT OR IGNORE INTO plugins (id, enabled, settings, installed_at, updated_at) VALUES (?, 0, ?, ?, ?)', id, '{}', now, now);
    }
  }

  async init(): Promise<void> {
    this.scan();
    const enabled = this.s.db.all<{ id: string }>('SELECT id FROM plugins WHERE enabled = 1');
    for (const { id } of enabled) {
      if (!this.discovered.has(id)) continue;
      try {
        await this.load(id);
      } catch (err) {
        this.s.log.error({ err, plugin: id }, 'Plugin konnte nicht geladen werden');
      }
    }
  }

  private settingsOf(id: string): Record<string, unknown> {
    const d = this.discovered.get(id);
    const row = this.s.db.get<{ settings: string }>('SELECT settings FROM plugins WHERE id = ?', id);
    const stored = parseJson<Record<string, unknown>>(row?.settings, {});
    const result: Record<string, unknown> = {};
    for (const def of d?.manifest.settings ?? []) {
      let value = stored[def.key] ?? def.default ?? (def.type === 'boolean' ? false : def.type === 'number' ? 0 : '');
      if (def.type === 'password' && typeof value === 'string' && value.startsWith('v1:')) {
        value = decryptSecret(this.s.config.secret, value) ?? '';
      }
      result[def.key] = value;
    }
    return result;
  }

  private async load(id: string): Promise<void> {
    const d = this.discovered.get(id);
    if (!d) throw notFound('Plugin nicht gefunden');
    if (d.error) throw badRequest(d.error);
    await this.unload(id);
    const routes: RouteEntry[] = [];
    const owner = `plugin:${id}`;
    const addRoute = (method: string) => (p: string, handler: PluginRouteHandler, options: PluginRouteOptions = {}) => {
      const { pattern, keys } = compileRoute(p);
      routes.push({ method, pattern, keys, handler, options });
    };
    const log = this.s.log.child({ plugin: id });
    const ctx: PluginContext = {
      id,
      manifest: d.manifest,
      log: {
        info: (msg, data) => log.info(data ?? {}, msg),
        warn: (msg, data) => log.warn(data ?? {}, msg),
        error: (msg, data) => log.error(data ?? {}, msg),
      },
      config: { baseUrl: this.s.config.baseUrl, version: this.s.config.version, dataDir: this.s.config.dataDir },
      settings: {
        get: <T>(key: string) => this.settingsOf(id)[key] as T,
        all: () => this.settingsOf(id),
      },
      storage: {
        get: <T>(key: string, fallback?: T) => {
          const row = this.s.db.get<{ value: string }>('SELECT value FROM plugin_storage WHERE plugin_id = ? AND key = ?', id, key);
          return row ? parseJson<T>(row.value, fallback as T) : fallback;
        },
        set: (key, value) => {
          this.s.db.run(
            `INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(plugin_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            id,
            key,
            JSON.stringify(value),
            nowIso(),
          );
        },
        delete: (key) => {
          this.s.db.run('DELETE FROM plugin_storage WHERE plugin_id = ? AND key = ?', id, key);
        },
        list: (prefix = '') =>
          this.s.db
            .all<{ key: string; value: string }>('SELECT key, value FROM plugin_storage WHERE plugin_id = ? AND key LIKE ? ORDER BY key', id, `${prefix}%`)
            .map((r) => ({ key: r.key, value: parseJson<unknown>(r.value, null) })),
      },
      hooks: {
        addFilter: (name, fn, priority) => {
          this.s.hooks.addFilter(name, fn, { priority, owner });
        },
      },
      events: {
        on: (pattern, handler) => {
          this.s.events.on(pattern, handler, owner);
        },
      },
      routes: { get: addRoute('GET'), post: addRoute('POST'), put: addRoute('PUT'), delete: addRoute('DELETE') },
      respond: (body, status = 200, headers = {}) => ({ __response: true, status, headers, body }),
      services: this.s,
    };
    let instance: PluginInstance | void = undefined;
    try {
      if (d.manifest.server) {
        const file = path.resolve(d.dir, d.manifest.server);
        const url = `${pathToFileURL(file).href}?v=${Date.now()}`;
        const mod = (await import(url)) as { default?: PluginRegister; register?: PluginRegister };
        const register = mod.default ?? mod.register;
        if (typeof register !== 'function') throw new Error('Das Server-Modul exportiert keine register-Funktion (export default)');
        instance = await register(ctx);
      }
    } catch (err) {
      this.s.hooks.removeByOwner(owner);
      this.s.events.removeByOwner(owner);
      d.error = err instanceof Error ? err.message : String(err);
      throw new HttpError(500, 'plugin_error', `Plugin „${d.manifest.name}“ konnte nicht geladen werden: ${d.error}`);
    }
    d.error = null;
    this.active.set(id, { instance, routes, loadedAt: nowIso() });
    log.info(`Plugin ${d.manifest.name} ${d.manifest.version} geladen`);
  }

  private async unload(id: string): Promise<void> {
    const a = this.active.get(id);
    if (!a) return;
    const owner = `plugin:${id}`;
    this.s.hooks.removeByOwner(owner);
    this.s.events.removeByOwner(owner);
    try {
      await a.instance?.dispose?.();
    } catch (err) {
      this.s.log.warn({ err, plugin: id }, 'Fehler beim Beenden des Plugins');
    }
    this.active.delete(id);
  }

  /** Manifest mit den Anzeigetexten der Sprache (`translations`), sonst unverändert */
  private localized(d: Discovered, locale: string | undefined): PluginManifest {
    const tr = locale ? d.manifest.translations?.[locale] : undefined;
    if (!tr) return d.manifest;
    return {
      ...d.manifest,
      name: tr.name ?? d.manifest.name,
      description: tr.description ?? d.manifest.description,
      settings: (d.manifest.settings ?? []).map((def) => {
        const t = tr.settings?.[def.key];
        if (!t) return def;
        return {
          ...def,
          label: t.label ?? def.label,
          help: t.help ?? def.help,
          options: def.options?.map((o) => ({ ...o, label: t.options?.[o.value] ?? o.label })),
        };
      }),
    };
  }

  private toDto(id: string, d: Discovered, locale?: string): PluginDto {
    const row = this.s.db.get<{ enabled: number }>('SELECT enabled FROM plugins WHERE id = ?', id);
    const settings = this.settingsOf(id);
    for (const def of d.manifest.settings ?? []) if (def.type === 'password' && settings[def.key]) settings[def.key] = '••••••••';
    const manifest = this.localized(d, locale);
    return {
      id,
      name: manifest.name,
      version: d.manifest.version,
      description: manifest.description ?? '',
      author: d.manifest.author ?? '',
      homepage: d.manifest.homepage ?? '',
      enabled: !!row?.enabled,
      loaded: this.active.has(id),
      error: d.error,
      hasServer: !!d.manifest.server,
      hasClient: !!d.manifest.client,
      settingsSchema: manifest.settings ?? [],
      settings,
    };
  }

  list(auth: AuthContext): PluginDto[] {
    this.s.perms.requireGlobal(auth, 'admin');
    return [...this.discovered.entries()].map(([id, d]) => this.toDto(id, d, auth.locale)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async rescan(auth: AuthContext): Promise<PluginDto[]> {
    this.s.perms.requireGlobal(auth, 'admin');
    this.scan();
    return this.list(auth);
  }

  async setEnabled(auth: AuthContext, id: string, enabled: boolean): Promise<PluginDto> {
    this.s.perms.requireGlobal(auth, 'admin');
    const d = this.discovered.get(id);
    if (!d) throw notFound('Plugin nicht gefunden');
    if (enabled) await this.load(id);
    else await this.unload(id);
    this.s.db.run('UPDATE plugins SET enabled = ?, updated_at = ? WHERE id = ?', enabled ? 1 : 0, nowIso(), id);
    this.s.emit(auth, { type: enabled ? 'plugin.enabled' : 'plugin.disabled', target: { type: 'plugin', id, label: d.manifest.name } });
    return this.toDto(id, d, auth.locale);
  }

  async updateSettings(auth: AuthContext, id: string, values: Record<string, unknown>): Promise<PluginDto> {
    this.s.perms.requireGlobal(auth, 'admin');
    const d = this.discovered.get(id);
    if (!d) throw notFound('Plugin nicht gefunden');
    const row = this.s.db.get<{ settings: string; enabled: number }>('SELECT settings, enabled FROM plugins WHERE id = ?', id);
    const stored = parseJson<Record<string, unknown>>(row?.settings, {});
    for (const def of this.localized(d, auth.locale).settings ?? []) {
      if (!Object.hasOwn(values, def.key)) continue;
      let v = values[def.key];
      if (def.type === 'password') {
        if (v === '••••••••') continue;
        v = typeof v === 'string' && v ? encryptSecret(this.s.config.secret, v) : '';
      } else if (def.type === 'number') v = Number(v);
      else if (def.type === 'boolean') v = !!v;
      else if (def.type === 'json' && typeof v === 'string') {
        try {
          v = JSON.parse(v);
        } catch {
          throw badRequest(`„${def.label}“ enthält kein gültiges JSON`);
        }
      } else v = v === null || v === undefined ? '' : String(v);
      if (def.required && (v === '' || v === null)) throw badRequest(`„${def.label}“ ist ein Pflichtfeld`);
      stored[def.key] = v;
    }
    this.s.db.run('UPDATE plugins SET settings = ?, updated_at = ? WHERE id = ?', JSON.stringify(stored), nowIso(), id);
    this.s.emit(auth, { type: 'plugin.settings_updated', target: { type: 'plugin', id, label: d.manifest.name }, data: { keys: Object.keys(values) } });
    if (row?.enabled) await this.load(id);
    return this.toDto(id, d, auth.locale);
  }

  /** Aktive Client-Plugins für den Browser. */
  clientPlugins(): { id: string; name: string; version: string; url: string; settings: Record<string, unknown> }[] {
    const result = [];
    for (const [id, d] of this.discovered) {
      if (!d.manifest.client || !this.active.has(id)) continue;
      const all = this.settingsOf(id);
      const publicSettings: Record<string, unknown> = {};
      for (const def of d.manifest.settings ?? []) if (def.public) publicSettings[def.key] = all[def.key];
      result.push({
        id,
        name: d.manifest.name,
        version: d.manifest.version,
        url: `/plugin-assets/${id}/${d.manifest.client.replace(/^\.?\//, '')}?v=${encodeURIComponent(d.manifest.version)}`,
        settings: publicSettings,
      });
    }
    return result;
  }

  /** Liefert eine statische Datei eines aktiven Plugins (Client-Modul oder assets/). */
  assetPath(id: string, file: string): string | null {
    const d = this.discovered.get(id);
    if (!d || !this.active.has(id)) return null;
    const target = path.resolve(d.dir, file);
    const clientFile = d.manifest.client ? path.resolve(d.dir, d.manifest.client) : null;
    const assetsDir = path.join(d.dir, 'assets');
    if (target !== clientFile && !isInside(assetsDir, target)) return null;
    return fs.existsSync(target) && fs.statSync(target).isFile() ? target : null;
  }

  async handle(req: FastifyRequest, reply: FastifyReply, id: string, subPath: string): Promise<unknown> {
    const a = this.active.get(id);
    if (!a) throw notFound('Plugin nicht aktiv');
    const method = req.method.toUpperCase();
    const pathname = '/' + subPath.replace(/^\/+/, '');
    for (const r of a.routes) {
      if (r.method !== method) continue;
      const m = pathname.match(r.pattern);
      if (!m) continue;
      if (r.options.auth !== false && !req.auth.user) throw unauthorized();
      if (r.options.admin && !req.auth.isAdmin) throw forbidden();
      const params: Record<string, string> = {};
      try {
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1] ?? '')));
      } catch {
        throw badRequest('Ungültige Adresse');
      }
      const pluginReq: PluginRequest = {
        method,
        path: pathname,
        params,
        query: (req.query ?? {}) as Record<string, string>,
        body: req.body,
        headers: req.headers,
        user: req.auth.user,
        isAdmin: req.auth.isAdmin,
      };
      const result = await r.handler(pluginReq);
      if (result && typeof result === 'object' && (result as { __response?: boolean }).__response === true) {
        const res = result as PluginResponse;
        reply.status(res.status ?? 200);
        for (const [k, v] of Object.entries(res.headers ?? {})) reply.header(k, v);
        return res.body ?? null;
      }
      return result ?? { ok: true };
    }
    throw notFound('Plugin-Route nicht gefunden');
  }

  loadedCount(): number {
    return this.active.size;
  }
}
