import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/config.ts';
import { buildApp } from '../src/app.ts';
import type { App } from '../src/http.ts';
import type { Services } from '../src/services.ts';

export interface TestContext {
  app: App;
  s: Services;
  dir: string;
  /** Beendet die App; `keepDir` lässt das Datenverzeichnis für einen Neustart liegen. */
  close: (options?: { keepDir?: boolean }) => Promise<void>;
}

/** Testinstanz – neues Datenverzeichnis oder (für Neustart-/Update-Tests) ein vorhandenes. */
export async function createTestApp(options: { dir?: string; env?: Record<string, string> } = {}): Promise<TestContext> {
  const dir = options.dir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-test-'));
  process.env.KNOWSTEAD_SKIP_ENV_FILE = '1';
  const config = loadConfig({
    DATA_DIR: dir,
    PLUGINS_DIR: path.join(dir, 'plugins'),
    WEB_DIST_DIR: path.join(dir, 'web'),
    BASE_URL: 'http://localhost:3999',
    NODE_ENV: 'test',
    ...options.env,
  });
  const { app, services } = await buildApp(config, { logger: false, schedulers: false });
  await app.ready();
  return {
    app,
    s: services,
    dir,
    close: async (closeOptions = {}) => {
      await app.close();
      if (!closeOptions.keepDir) fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** Kleiner HTTP-Client um app.inject mit Cookie-Verwaltung. */
export class Client {
  private cookie = '';
  private readonly app: App;
  token: string | null = null;

  constructor(app: App) {
    this.app = app;
  }

  async request<T = any>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Record<string, unknown>; raw: string; bytes: Buffer }> {
    const res = await this.app.inject({
      method: method as 'GET',
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: {
        ...(this.token ? { authorization: `Bearer ${this.token}` } : { 'x-knowstead-client': 'test', ...(this.cookie ? { cookie: this.cookie } : {}) }),
        ...headers,
      },
    });
    const setCookie = res.headers['set-cookie'];
    if (setCookie) {
      const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      this.cookie = first.split(';')[0];
    }
    let parsed: unknown = res.body;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      /* kein JSON */
    }
    return { status: res.statusCode, body: parsed as T, headers: res.headers, raw: res.body, bytes: res.rawPayload };
  }

  get<T = any>(url: string) {
    return this.request<T>('GET', url);
  }
  post<T = any>(url: string, body?: unknown) {
    return this.request<T>('POST', url, body ?? {});
  }
  put<T = any>(url: string, body?: unknown) {
    return this.request<T>('PUT', url, body ?? {});
  }
  patch<T = any>(url: string, body?: unknown) {
    return this.request<T>('PATCH', url, body ?? {});
  }
  del<T = any>(url: string) {
    return this.request<T>('DELETE', url);
  }
}
