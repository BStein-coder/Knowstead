/**
 * Öffentliche Typen für Knowstead-Plugins.
 *
 * Ein Plugin ist ein Ordner unter `plugins/` mit einer `plugin.json` und optional
 * einem Server-Einstiegspunkt (`server`) sowie einem Browser-Modul (`client`).
 * Siehe docs/PLUGINS.md für eine ausführliche Anleitung.
 */
import type { DomainEvent } from '../core/events.ts';
import type { AuthUser } from '../core/permissions.ts';
import type { Services } from '../services.ts';

export interface PluginSettingDef {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'password' | 'number' | 'boolean' | 'select' | 'json';
  default?: unknown;
  help?: string;
  required?: boolean;
  /** Wert wird auch an das Client-Modul ausgeliefert. */
  public?: boolean;
  options?: { value: string; label: string }[];
}

/** Anzeigetexte des Manifests in einer weiteren Sprache (Schlüssel der Einstellungen wie unter `settings`). */
export interface PluginTranslation {
  name?: string;
  description?: string;
  settings?: Record<string, { label?: string; help?: string; options?: Record<string, string> }>;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** Pfad zum Server-Modul (JS oder TS), relativ zum Plugin-Ordner. */
  server?: string;
  /** Pfad zum Browser-Modul (ES-Modul), relativ zum Plugin-Ordner. */
  client?: string;
  settings?: PluginSettingDef[];
  /** z. B. `{ "en": { "name": "…", "description": "…", "settings": { "url": { "label": "…" } } } }` */
  translations?: Record<string, PluginTranslation>;
}

export interface PluginLogger {
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

export interface PluginRequest {
  method: string;
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string | string[] | undefined>;
  user: AuthUser | null;
  isAdmin: boolean;
}

export interface PluginResponse {
  __response: true;
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export type PluginRouteHandler = (req: PluginRequest) => unknown | Promise<unknown>;

export interface PluginRouteOptions {
  /** Standard: true – nur angemeldete Benutzer. */
  auth?: boolean;
  /** Nur Administratoren. */
  admin?: boolean;
}

export interface PluginContext {
  id: string;
  manifest: PluginManifest;
  log: PluginLogger;
  config: { baseUrl: string; version: string; dataDir: string };
  settings: {
    get<T = unknown>(key: string): T;
    all(): Record<string, unknown>;
  };
  storage: {
    get<T = unknown>(key: string, fallback?: T): T | undefined;
    set(key: string, value: unknown): void;
    delete(key: string): void;
    list(prefix?: string): { key: string; value: unknown }[];
  };
  hooks: {
    addFilter<T, C = unknown>(name: string, fn: (value: T, context: C) => T | Promise<T>, priority?: number): void;
  };
  events: {
    on(pattern: string, handler: (event: DomainEvent) => void | Promise<void>): void;
  };
  routes: {
    get(path: string, handler: PluginRouteHandler, options?: PluginRouteOptions): void;
    post(path: string, handler: PluginRouteHandler, options?: PluginRouteOptions): void;
    put(path: string, handler: PluginRouteHandler, options?: PluginRouteOptions): void;
    delete(path: string, handler: PluginRouteHandler, options?: PluginRouteOptions): void;
  };
  /** Eigene HTTP-Antwort (Status, Header) aus einer Route zurückgeben. */
  respond(body: unknown, status?: number, headers?: Record<string, string>): PluginResponse;
  /** Voller Zugriff auf die internen Dienste (Plugins laufen vertrauenswürdig im Serverprozess). */
  services: Services;
}

export interface PluginInstance {
  dispose?: () => void | Promise<void>;
}

export type PluginRegister = (ctx: PluginContext) => void | PluginInstance | Promise<void | PluginInstance>;
