import crypto from 'node:crypto';
import type { Services } from '../../services.ts';
import type { WebhookRow } from '../../core/types.ts';
import type { AuthContext } from '../../core/permissions.ts';
import { EVENT_TYPES, type DomainEvent } from '../../core/events.ts';
import { nowIso, parseJson } from '../../db/database.ts';
import { decryptSecret, encryptSecret, hmacSha256, randomToken } from '../../core/crypto.ts';
import { badRequest, notFound } from '../../core/errors.ts';
import { matchesPattern } from '../../core/util.ts';
import { pageUrl } from '../pages/service.ts';

export interface WebhookInput {
  name: string;
  url: string;
  events: string[];
  spaceId?: number | null;
  headers?: Record<string, string>;
  active?: boolean;
}

export interface WebhookDto {
  id: number;
  name: string;
  url: string;
  events: string[];
  spaceId: number | null;
  spaceKey: string | null;
  headers: Record<string, string>;
  active: boolean;
  failureCount: number;
  lastStatus: number | null;
  lastDeliveryAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookPayload {
  id: string;
  event: string;
  label: string;
  createdAt: string;
  instance: { name: string; url: string };
  actor: { id: number; username: string; displayName: string } | null;
  space: { id: number; key: string; name: string } | null;
  page: { id: number; title: string; url: string; version: number } | null;
  target: { type: string; id: string; label: string | null } | null;
  data: Record<string, unknown>;
}

const RETRY_DELAYS = [0, 10_000, 60_000, 300_000];
const MAX_ATTEMPTS = 4;
const AUTO_DISABLE_AFTER = 25;

export class WebhookService {
  private readonly s: Services;

  constructor(s: Services) {
    this.s = s;
  }

  start(): void {
    this.s.events.on('*', (event) => this.dispatch(event));
  }

  private toDto(row: WebhookRow): WebhookDto {
    const space = row.space_id ? this.s.spaces.get(row.space_id) : null;
    return {
      id: row.id,
      name: row.name,
      url: row.url,
      events: parseJson<string[]>(row.events, []),
      spaceId: row.space_id,
      spaceKey: space?.key ?? null,
      headers: parseJson<Record<string, string>>(row.headers, {}),
      active: !!row.active,
      failureCount: row.failure_count,
      lastStatus: row.last_status,
      lastDeliveryAt: row.last_delivery_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private require(id: number): WebhookRow {
    const row = this.s.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ?', id);
    if (!row) throw notFound('Webhook nicht gefunden');
    return row;
  }

  list(auth: AuthContext): WebhookDto[] {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    return this.s.db.all<WebhookRow>('SELECT * FROM webhooks ORDER BY name COLLATE NOCASE').map((r) => this.toDto(r));
  }

  private validate(input: WebhookInput): void {
    if (!input.name?.trim()) throw badRequest('Bitte einen Namen angeben');
    let url: URL;
    try {
      url = new URL(input.url);
    } catch {
      throw badRequest('Ungültige URL');
    }
    if (!['http:', 'https:'].includes(url.protocol)) throw badRequest('Nur http(s)-URLs sind erlaubt');
    if (!input.events?.length) throw badRequest('Bitte mindestens ein Ereignis auswählen');
    for (const e of input.events) {
      if (e !== '*' && !e.endsWith('.*') && !EVENT_TYPES[e]) throw badRequest(`Unbekanntes Ereignis: ${e}`);
    }
    for (const [k, v] of Object.entries(input.headers ?? {})) {
      if (!/^[A-Za-z0-9-]{1,64}$/.test(k) || /[\r\n]/.test(v)) throw badRequest(`Ungültiger Header: ${k}`);
    }
  }

  create(auth: AuthContext, input: WebhookInput): { webhook: WebhookDto; secret: string } {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    this.validate(input);
    const secret = `whsec_${randomToken(24)}`;
    const now = nowIso();
    const id = this.s.db.run(
      `INSERT INTO webhooks (name, url, secret, events, space_id, headers, active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      input.name.trim(),
      input.url.trim(),
      encryptSecret(this.s.config.secret, secret),
      JSON.stringify(input.events),
      input.spaceId ?? null,
      JSON.stringify(input.headers ?? {}),
      input.active === false ? 0 : 1,
      auth.user?.id ?? null,
      now,
      now,
    ).lastInsertRowid;
    this.s.emit(auth, { type: 'webhook.created', target: { type: 'webhook', id, label: input.name }, data: { url: input.url, events: input.events } });
    return { webhook: this.toDto(this.require(id)), secret };
  }

  update(auth: AuthContext, id: number, input: Partial<WebhookInput>): WebhookDto {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    const row = this.require(id);
    const merged: WebhookInput = {
      name: input.name ?? row.name,
      url: input.url ?? row.url,
      events: input.events ?? parseJson<string[]>(row.events, []),
      spaceId: input.spaceId === undefined ? row.space_id : input.spaceId,
      headers: input.headers ?? parseJson<Record<string, string>>(row.headers, {}),
      active: input.active ?? !!row.active,
    };
    this.validate(merged);
    this.s.db.run(
      `UPDATE webhooks SET name = ?, url = ?, events = ?, space_id = ?, headers = ?, active = ?, failure_count = CASE WHEN ? = 1 THEN 0 ELSE failure_count END, updated_at = ? WHERE id = ?`,
      merged.name.trim(),
      merged.url.trim(),
      JSON.stringify(merged.events),
      merged.spaceId ?? null,
      JSON.stringify(merged.headers ?? {}),
      merged.active ? 1 : 0,
      merged.active && !row.active ? 1 : 0,
      nowIso(),
      id,
    );
    this.s.emit(auth, { type: 'webhook.updated', target: { type: 'webhook', id, label: merged.name } });
    return this.toDto(this.require(id));
  }

  rotateSecret(auth: AuthContext, id: number): string {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    const row = this.require(id);
    const secret = `whsec_${randomToken(24)}`;
    this.s.db.run('UPDATE webhooks SET secret = ?, updated_at = ? WHERE id = ?', encryptSecret(this.s.config.secret, secret), nowIso(), id);
    this.s.emit(auth, { type: 'webhook.updated', target: { type: 'webhook', id, label: row.name }, data: { secretRotated: true } });
    return secret;
  }

  delete(auth: AuthContext, id: number): void {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    const row = this.require(id);
    this.s.db.run('DELETE FROM webhooks WHERE id = ?', id);
    this.s.emit(auth, { type: 'webhook.deleted', target: { type: 'webhook', id, label: row.name } });
  }

  deliveries(auth: AuthContext, id: number, limit = 50) {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    this.require(id);
    return this.s.db
      .all<{
        id: number;
        event_type: string;
        payload: string;
        status: number | null;
        response: string | null;
        error: string | null;
        duration_ms: number | null;
        attempt: number;
        success: number;
        created_at: string;
      }>('SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT ?', id, limit)
      .map((d) => ({
        id: d.id,
        eventType: d.event_type,
        payload: parseJson<unknown>(d.payload, null),
        status: d.status,
        response: d.response,
        error: d.error,
        durationMs: d.duration_ms,
        attempt: d.attempt,
        success: !!d.success,
        createdAt: d.created_at,
      }));
  }

  /** Test-Zustellung („ping“) – wartet auf das Ergebnis. */
  async test(auth: AuthContext, id: number) {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    const row = this.require(id);
    const payload: WebhookPayload = {
      id: crypto.randomUUID(),
      event: 'ping',
      label: 'Testereignis',
      createdAt: nowIso(),
      instance: { name: this.s.settings.get('siteName'), url: this.s.config.baseUrl },
      actor: auth.user ? { id: auth.user.id, username: auth.user.username, displayName: auth.user.displayName } : null,
      space: null,
      page: null,
      target: null,
      data: { message: 'Dies ist eine Testzustellung aus Knowstead.' },
    };
    return this.deliver(row, payload, 1, null, false);
  }

  async redeliver(auth: AuthContext, deliveryId: number) {
    this.s.perms.requireGlobal(auth, 'integrations.manage');
    const d = this.s.db.get<{ webhook_id: number; payload: string; event_id: number | null }>(
      'SELECT webhook_id, payload, event_id FROM webhook_deliveries WHERE id = ?',
      deliveryId,
    );
    if (!d) throw notFound('Zustellung nicht gefunden');
    return this.deliver(this.require(d.webhook_id), parseJson<WebhookPayload>(d.payload, {} as WebhookPayload), 1, d.event_id, false);
  }

  buildPayload(event: DomainEvent): WebhookPayload {
    const space = event.spaceId ? this.s.spaces.get(event.spaceId) : undefined;
    const page = event.pageId ? this.s.pages.get(event.pageId) : undefined;
    const pageSpace = page ? this.s.spaces.get(page.space_id) : undefined;
    return {
      id: `evt_${event.id}`,
      event: event.type,
      label: EVENT_TYPES[event.type]?.label ?? event.type,
      createdAt: event.createdAt,
      instance: { name: this.s.settings.get('siteName'), url: this.s.config.baseUrl },
      actor: event.actor ? { id: event.actor.id, username: event.actor.username, displayName: event.actor.displayName } : null,
      space: space ? { id: space.id, key: space.key, name: space.name } : null,
      page:
        page && pageSpace
          ? { id: page.id, title: page.title, url: this.s.config.baseUrl + pageUrl(pageSpace.key, page.id, page.title), version: page.version }
          : null,
      target: event.target,
      data: event.data,
    };
  }

  private dispatch(event: DomainEvent): void {
    const hooks = this.s.db.all<WebhookRow>('SELECT * FROM webhooks WHERE active = 1');
    if (!hooks.length) return;
    let payload: WebhookPayload | null = null;
    for (const hook of hooks) {
      const patterns = parseJson<string[]>(hook.events, []);
      if (!patterns.some((p) => matchesPattern(p, event.type))) continue;
      if (hook.space_id && hook.space_id !== event.spaceId) continue;
      // Webhooks werden von Administratoren eingerichtet und erhalten alle passenden Ereignisse –
      // auch zu eingeschränkten Seiten. Über den Bereichsfilter lässt sich das eingrenzen.
      payload ??= this.buildPayload(event);
      void this.deliver(hook, payload, 1, event.id, true);
    }
  }

  private async deliver(hook: WebhookRow, payload: WebhookPayload, attempt: number, eventId: number | null, retry: boolean) {
    const secret = decryptSecret(this.s.config.secret, hook.secret) ?? '';
    const body = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = hmacSha256(secret, `${timestamp}.${body}`);
    const delivery = crypto.randomUUID();
    const headers: Record<string, string> = {
      ...parseJson<Record<string, string>>(hook.headers, {}),
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': `Knowstead-Webhooks/${this.s.config.version}`,
      'X-Knowstead-Event': payload.event,
      'X-Knowstead-Delivery': delivery,
      'X-Knowstead-Timestamp': timestamp,
      'X-Knowstead-Signature': `sha256=${signature}`,
      // Übergangsweise zusätzlich unter den früheren Namen: Empfänger, die vor der Umbenennung eingerichtet
      // wurden, prüfen die Signatur noch an X-Doku-Signature. Entfällt mit Version 3.
      'X-Doku-Event': payload.event,
      'X-Doku-Delivery': delivery,
      'X-Doku-Timestamp': timestamp,
      'X-Doku-Signature': `sha256=${signature}`,
    };
    const started = Date.now();
    let status: number | null = null;
    let response = '';
    let error: string | null = null;
    try {
      const res = await fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000), redirect: 'manual' });
      status = res.status;
      response = await readStart(res, 2000);
    } catch (err) {
      error = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    }
    const duration = Date.now() - started;
    const success = status !== null && status >= 200 && status < 300;
    this.s.db.run(
      `INSERT INTO webhook_deliveries (webhook_id, event_id, event_type, payload, status, response, error, duration_ms, attempt, success, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      hook.id,
      eventId,
      payload.event,
      body,
      status,
      response,
      error,
      duration,
      attempt,
      success ? 1 : 0,
      nowIso(),
    );
    this.s.db.run(
      `DELETE FROM webhook_deliveries WHERE webhook_id = ? AND id NOT IN (SELECT id FROM webhook_deliveries WHERE webhook_id = ? ORDER BY id DESC LIMIT 200)`,
      hook.id,
      hook.id,
    );
    this.s.db.run(
      `UPDATE webhooks SET last_status = ?, last_delivery_at = ?, failure_count = CASE WHEN ? = 1 THEN 0 ELSE failure_count + 1 END WHERE id = ?`,
      status,
      nowIso(),
      success ? 1 : 0,
      hook.id,
    );
    if (!success) {
      const failures = this.s.db.value<number>('SELECT failure_count FROM webhooks WHERE id = ?', hook.id) ?? 0;
      if (failures >= AUTO_DISABLE_AFTER) {
        this.s.db.run('UPDATE webhooks SET active = 0 WHERE id = ?', hook.id);
        this.s.log.warn({ webhook: hook.name }, 'Webhook nach wiederholten Fehlern deaktiviert');
      } else if (retry && attempt < MAX_ATTEMPTS) {
        setTimeout(() => {
          const fresh = this.s.db.get<WebhookRow>('SELECT * FROM webhooks WHERE id = ? AND active = 1', hook.id);
          if (fresh) void this.deliver(fresh, payload, attempt + 1, eventId, true);
        }, RETRY_DELAYS[attempt]).unref();
      }
    }
    return { success, status, error, durationMs: duration, response };
  }
}

/**
 * Nur den Anfang einer Antwort lesen: Ein (kompromittiertes) Ziel könnte sonst beliebig große
 * Antworten schicken, die vollständig in den Speicher geladen würden.
 */
async function readStart(res: Response, maxChars: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '';
  try {
    while (text.length < maxChars) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return text.slice(0, maxChars);
}
