import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { badRequest } from '../../core/errors.ts';
import { nowIso } from '../../db/database.ts';

/**
 * Hinweis auf neue Versionen (Administration → Über) – nur auf Wunsch (`Settings.updateCheck`, Standard: aus).
 *
 * Eingeschaltet fragt der Server die öffentliche Release-Schnittstelle des Projekts auf GitHub nach der neuesten
 * Version. Gesendet wird nur die übliche Verbindung samt Kennung „Knowstead-update-check“ – weder Name noch
 * Adresse noch Version der Installation. Die Antwort wird gemerkt (die Seite zeigt sie ohne neuen Abruf), und ein
 * Abruf höchstens einmal je Minute zugelassen. Die Adresse steht fest im Programm; die Administration stellt sie
 * nicht ein.
 */
export const UPDATE_ENDPOINT = 'https://api.github.com/repos/BStein-coder/Knowstead/releases/latest';
const SOURCE = 'github.com/BStein-coder/Knowstead';
const STORE_KEY = 'update-check';
const MIN_INTERVAL_MS = 60_000;
const TIMEOUT_MS = 8_000;
const MAX_BODY_BYTES = 256 * 1024;

export type UpdateErrorCode = 'unreachable' | 'http' | 'format';

interface Stored {
  latest: string | null;
  url: string | null;
  name: string | null;
  publishedAt: string | null;
  checkedAt: string | null;
  error: { code: UpdateErrorCode; detail: string } | null;
}

export interface UpdateInfo extends Stored {
  /** Ist die Suche eingeschaltet? */
  enabled: boolean;
  /** Version dieses Servers */
  current: string;
  /** Gibt es eine neuere Version als die laufende? */
  newer: boolean;
  /** Woher die Angabe stammt (zur Anzeige) */
  source: string;
}

const EMPTY: Stored = { latest: null, url: null, name: null, publishedAt: null, checkedAt: null, error: null };

/** −1, 0 oder 1 wie bei `Array.sort`; nur reine Versionen der Form 2.3.1. */
export function compareVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
  return 0;
}

export class UpdateService {
  private readonly s: Services;
  /** Abfrageadresse – nur für Tests veränderbar */
  endpoint = UPDATE_ENDPOINT;
  private lastAttempt = 0;
  private running: Promise<UpdateInfo> | null = null;

  constructor(s: Services) {
    this.s = s;
  }

  private enabled(): boolean {
    return this.s.settings.get('updateCheck') === true;
  }

  /** Gemerkter Stand – ohne Abruf. */
  info(auth: AuthContext): UpdateInfo {
    this.s.perms.requireGlobal(auth, 'admin');
    return this.snapshot();
  }

  private snapshot(): UpdateInfo {
    const stored = { ...EMPTY, ...this.s.settings.getInternal<Partial<Stored>>(STORE_KEY, {}) };
    const current = this.s.config.version;
    return {
      ...stored,
      enabled: this.enabled(),
      current,
      // Nach einem Update zeigt ein älterer Stand nicht mehr „neu“ – verglichen wird mit der laufenden Version
      newer: !!stored.latest && compareVersions(stored.latest, current) > 0,
      source: SOURCE,
    };
  }

  /** Jetzt bei GitHub nachsehen (höchstens einmal je Minute, sonst bleibt es beim gemerkten Stand). */
  async refresh(auth: AuthContext): Promise<UpdateInfo> {
    this.s.perms.requireGlobal(auth, 'admin');
    if (!this.enabled()) throw badRequest('Die Suche nach neuen Versionen ist ausgeschaltet');
    if (this.running) return this.running;
    if (Date.now() - this.lastAttempt < MIN_INTERVAL_MS) return this.snapshot();
    this.lastAttempt = Date.now();
    this.running = this.query().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async query(): Promise<UpdateInfo> {
    const stored = this.snapshot();
    let next: Stored;
    try {
      next = { ...(await this.fetchLatest()), checkedAt: nowIso(), error: null };
    } catch (err) {
      const failure = err instanceof UpdateFailure ? err : new UpdateFailure('unreachable', err instanceof Error ? ((err.cause as { code?: string } | undefined)?.code ?? err.name) : 'unbekannt');
      // Der letzte bekannte Stand bleibt stehen; nur der Fehler kommt dazu
      next = { latest: stored.latest, url: stored.url, name: stored.name, publishedAt: stored.publishedAt, checkedAt: nowIso(), error: { code: failure.code, detail: failure.detail } };
      this.s.log.info({ code: failure.code, detail: failure.detail }, 'Suche nach neuen Versionen fehlgeschlagen');
    }
    this.s.settings.setInternal(STORE_KEY, next);
    return this.snapshot();
  }

  private async fetchLatest(): Promise<Pick<Stored, 'latest' | 'url' | 'name' | 'publishedAt'>> {
    const res = await fetch(this.endpoint, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Knowstead-update-check' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Die Adresse steht fest; eine Weiterleitung auf anderes Ziel wäre nicht erwartet
      redirect: 'error',
    });
    if (!res.ok) throw new UpdateFailure('http', String(res.status));
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BODY_BYTES) {
          await reader.cancel();
          throw new UpdateFailure('format', 'zu groß');
        }
        chunks.push(value);
      }
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    } catch {
      throw new UpdateFailure('format', 'kein JSON');
    }
    const version = /^v?(\d+\.\d+\.\d+)$/.exec(String(data.tag_name ?? ''))?.[1];
    if (!version || data.draft === true || data.prerelease === true) throw new UpdateFailure('format', 'keine Version');
    // Die Adresse landet als Verweis in der Oberfläche: nur eine https-Seite von GitHub
    const url = typeof data.html_url === 'string' && /^https:\/\/github\.com\/[\w./-]+$/.test(data.html_url) ? data.html_url : null;
    const name = typeof data.name === 'string' ? data.name.slice(0, 120) : null;
    const publishedAt = typeof data.published_at === 'string' && !Number.isNaN(Date.parse(data.published_at)) ? new Date(data.published_at).toISOString() : null;
    return { latest: version, url, name, publishedAt };
  }
}

class UpdateFailure extends Error {
  readonly code: UpdateErrorCode;
  readonly detail: string;

  constructor(code: UpdateErrorCode, detail: string) {
    super(`${code}: ${detail}`);
    this.code = code;
    this.detail = detail;
  }
}
