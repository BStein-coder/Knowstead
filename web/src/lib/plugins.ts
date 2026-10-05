/**
 * Laufzeit für Client-Plugins. Ein Plugin-Modul exportiert standardmäßig eine
 * Funktion `activate(api)` (oder `export default`). Siehe docs/PLUGINS.md.
 */
import { useSyncExternalStore } from 'react';
import { api as http } from '../api/client';

export interface PluginPageContext {
  page: { id: number; title: string; spaceKey: string; contentType: string; version: number; labels: string[]; url: string };
  /** Klartext des Seiteninhalts. */
  text: string;
}

export interface PluginMacroParam {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'textarea' | 'select' | 'boolean';
  options?: { value: string; label: string }[];
  default?: unknown;
}

export interface PluginMacro {
  plugin: string;
  name: string;
  label: string;
  description?: string;
  icon?: string;
  params?: PluginMacroParam[];
  render: (el: HTMLElement, params: Record<string, unknown>, ctx: { pageId: number | null; spaceKey: string | null; editable: boolean }) => void | (() => void);
}

export interface PluginPageAction {
  plugin: string;
  id: string;
  label: string;
  icon?: string;
  onClick: (ctx: PluginPageContext) => void | Promise<void>;
}

export interface PluginPageMeta {
  plugin: string;
  id: string;
  render: (ctx: PluginPageContext) => string | null;
}

export interface PluginPagePanel {
  plugin: string;
  id: string;
  title: string;
  render: (el: HTMLElement, ctx: PluginPageContext) => void | (() => void);
}

interface Registry {
  loaded: boolean;
  plugins: { id: string; name: string; version: string }[];
  macros: PluginMacro[];
  actions: PluginPageAction[];
  meta: PluginPageMeta[];
  panels: PluginPagePanel[];
  errors: { id: string; message: string }[];
}

let registry: Registry = { loaded: false, plugins: [], macros: [], actions: [], meta: [], panels: [], errors: [] };
const listeners = new Set<() => void>();

function update(patch: Partial<Registry>) {
  registry = { ...registry, ...patch };
  for (const l of listeners) l();
}

export function usePluginRegistry(): Registry {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => registry,
  );
}

export function getPluginMacro(plugin: string, name: string): PluginMacro | undefined {
  return registry.macros.find((m) => m.plugin === plugin && m.name === name);
}

type Toast = (message: string, kind?: 'success' | 'error' | 'info') => void;
let toastFn: Toast = (m) => console.info(m);
let navigateFn: (to: string) => void = (to) => {
  window.location.href = to;
};

export function bindPluginRuntime(toast: Toast, navigate: (to: string) => void) {
  toastFn = toast;
  navigateFn = navigate;
}

function createApi(id: string, settings: Record<string, unknown>) {
  return {
    id,
    settings,
    /** Sprache der Oberfläche (`de` oder `en`) – für eigene Beschriftungen */
    get locale(): 'de' | 'en' {
      return document.documentElement.lang === 'en' ? 'en' : 'de';
    },
    registerMacro: (def: Omit<PluginMacro, 'plugin'>) => update({ macros: [...registry.macros.filter((m) => !(m.plugin === id && m.name === def.name)), { ...def, plugin: id }] }),
    registerPageAction: (def: Omit<PluginPageAction, 'plugin'>) => update({ actions: [...registry.actions, { ...def, plugin: id }] }),
    registerPageMeta: (def: Omit<PluginPageMeta, 'plugin'>) => update({ meta: [...registry.meta, { ...def, plugin: id }] }),
    registerPagePanel: (def: Omit<PluginPagePanel, 'plugin'>) => update({ panels: [...registry.panels, { ...def, plugin: id }] }),
    /** Aufruf eigener Server-Routen: /api/v1/plugins/<id>/<pfad> */
    fetch: <T = unknown>(path: string, init: { method?: string; body?: unknown } = {}) => {
      const url = `/api/v1/plugins/${id}/${path.replace(/^\/+/, '')}`;
      const method = (init.method ?? 'GET').toUpperCase();
      if (method === 'GET') return http.get<T>(url);
      if (method === 'DELETE') return http.del<T>(url);
      if (method === 'PUT') return http.put<T>(url, init.body);
      return http.post<T>(url, init.body);
    },
    /** Zugriff auf die allgemeine REST-API (mit den Rechten des Benutzers). */
    http,
    toast: (message: string, kind?: 'success' | 'error' | 'info') => toastFn(message, kind),
    navigate: (to: string) => navigateFn(to),
  };
}

export type ClientPluginApi = ReturnType<typeof createApi>;

let loading: Promise<void> | null = null;

export function loadClientPlugins(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    try {
      const list = await http.get<{ id: string; name: string; version: string; url: string; settings: Record<string, unknown> }[]>('/api/v1/plugins/client');
      const errors: Registry['errors'] = [];
      for (const p of list) {
        try {
          const mod = (await import(/* @vite-ignore */ p.url)) as { default?: (api: ClientPluginApi) => void; activate?: (api: ClientPluginApi) => void };
          const activate = mod.activate ?? mod.default;
          if (typeof activate === 'function') await activate(createApi(p.id, p.settings));
        } catch (err) {
          console.error(`Plugin ${p.id} konnte nicht geladen werden`, err);
          errors.push({ id: p.id, message: err instanceof Error ? err.message : String(err) });
        }
      }
      update({ loaded: true, plugins: list.map(({ id, name, version }) => ({ id, name, version })), errors });
    } catch {
      update({ loaded: true });
    }
  })();
  return loading;
}
