import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { UserRef } from '../../core/types.ts';
import type { DomainEvent } from '../../core/events.ts';
import type { UserRow } from '../../core/types.ts';
import { nowIso } from '../../db/database.ts';
import { HttpError } from '../../core/errors.ts';

interface Client {
  id: string;
  auth: AuthContext;
  reply: FastifyReply;
}

interface Presence {
  user: UserRef;
  mode: 'view' | 'edit';
  at: number;
}

const PRESENCE_TTL = 70_000;
/** Offene Live-Verbindungen je Person (mehrere Tabs/Geräte) */
const MAX_CONNECTIONS_PER_USER = 20;

/**
 * Server-Sent-Events für Live-Aktualisierungen: Benachrichtigungen,
 * Seitenänderungen und Anwesenheit (wer liest/bearbeitet gerade).
 */
export class RealtimeHub {
  private readonly s: Services;
  private readonly clients = new Map<string, Client>();
  private readonly presence = new Map<number, Map<number, Presence>>();
  private timer: NodeJS.Timeout | null = null;

  constructor(s: Services) {
    this.s = s;
  }

  start(): void {
    const pageEvents = ['page.created', 'page.updated', 'page.moved', 'page.deleted', 'page.restored', 'comment.created', 'comment.resolved', 'comment.deleted', 'attachment.uploaded'];
    for (const type of pageEvents) this.s.events.on(type, (e) => this.onPageEvent(e));
    // Aufgabenplaner: Wer denselben Plan offen hat, sieht Änderungen ohne Neuladen
    const taskEvents = [
      'task.created',
      'task.updated',
      'task.completed',
      'task.deleted',
      'task.restored',
      'task.purged',
      'task.commented',
      'task.comment_updated',
      'task.comment_deleted',
      'task.board_created',
      'task.board_deleted',
    ];
    for (const type of taskEvents) this.s.events.on(type, (e) => this.onTaskEvent(e));
    this.timer = setInterval(() => {
      for (const c of [...this.clients.values()]) {
        // Rechte und Gültigkeit regelmäßig neu prüfen: abgemeldete, gesperrte oder aus Gruppen
        // entfernte Personen dürfen keine Ereignisse und Benachrichtigungen mehr erhalten.
        if (!this.refresh(c)) {
          this.close(c);
          continue;
        }
        this.write(c, ': ping\n\n');
      }
      this.cleanupPresence();
    }, 25_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.disconnectAll();
  }

  /**
   * Alle Live-Verbindungen beenden. Muss vor dem Schließen des HTTP-Servers geschehen: Der wartet auf
   * das Ende aller Verbindungen – diese hier enden aber nie von selbst. Die Browser verbinden sich neu.
   */
  disconnectAll(): void {
    for (const c of this.clients.values()) {
      try {
        c.reply.raw.end();
        c.reply.raw.socket?.end();
      } catch {
        /* Verbindung ist schon weg */
      }
    }
    this.clients.clear();
  }

  /** Sitzung bzw. Token noch gültig? Dann Rechte (Gruppen, Admin) neu laden. */
  private refresh(client: Client): boolean {
    const auth = client.auth;
    if (!auth.user) return false;
    const now = nowIso();
    if (auth.sessionId && !this.s.db.value('SELECT 1 FROM sessions WHERE id = ? AND expires_at > ?', auth.sessionId, now)) return false;
    if (auth.tokenId && !this.s.db.value('SELECT 1 FROM api_tokens WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)', auth.tokenId, now)) {
      return false;
    }
    const row = this.s.db.get<UserRow>('SELECT * FROM users WHERE id = ?', auth.user.id);
    if (!row || row.status !== 'active') return false;
    client.auth = this.s.perms.forUser(row, { via: auth.via, scopes: auth.scopes ?? undefined, sessionId: auth.sessionId, tokenId: auth.tokenId, ip: auth.ip, userAgent: auth.userAgent });
    return true;
  }

  private close(client: Client): void {
    this.clients.delete(client.id);
    try {
      client.reply.raw.end();
    } catch {
      /* Verbindung bereits zu */
    }
  }

  connect(req: FastifyRequest, reply: FastifyReply): void {
    const userId = req.auth.user?.id;
    let open = 0;
    for (const c of this.clients.values()) if (c.auth.user?.id === userId) open++;
    if (open >= MAX_CONNECTIONS_PER_USER) throw new HttpError(429, 'too_many_streams', 'Zu viele offene Live-Verbindungen');
    const id = crypto.randomUUID();
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const client: Client = { id, auth: req.auth, reply };
    this.clients.set(id, client);
    this.write(client, `retry: 5000\nevent: hello\ndata: ${JSON.stringify({ id, unread: this.s.notifications.unreadCount(req.auth) })}\n\n`);
    req.raw.on('close', () => {
      this.clients.delete(id);
    });
  }

  private write(client: Client, chunk: string): void {
    try {
      client.reply.raw.write(chunk);
    } catch {
      this.clients.delete(client.id);
    }
  }

  private send(client: Client, event: string, data: unknown): void {
    this.write(client, `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  sendToUser(userId: number, event: string, data: unknown): void {
    for (const c of this.clients.values()) if (c.auth.user?.id === userId) this.send(c, event, data);
  }

  private onPageEvent(e: DomainEvent): void {
    if (!e.pageId) return;
    const page = this.s.pages.get(e.pageId);
    if (!page) return;
    const space = this.s.spaces.get(page.space_id);
    if (!space) return;
    const payload = {
      type: e.type,
      pageId: page.id,
      spaceId: space.id,
      spaceKey: space.key,
      version: page.version,
      actor: e.actor ? { id: e.actor.id, displayName: e.actor.displayName } : null,
    };
    for (const c of this.clients.values()) {
      try {
        if (this.s.perms.canViewPage(c.auth, page, space, { includeDeleted: true })) this.send(c, 'page', payload);
      } catch {
        /* ignorieren */
      }
    }
  }

  /**
   * Änderung im Aufgabenplaner an alle senden, die den Bereich sehen dürfen. Die Nutzlast bleibt klein –
   * die Oberfläche lädt den Plan selbst nach, statt Aufgaben doppelt zu übertragen.
   */
  private onTaskEvent(e: DomainEvent): void {
    if (!e.spaceId) return;
    const space = this.s.spaces.get(e.spaceId);
    if (!space) return;
    const payload = {
      type: e.type,
      spaceId: space.id,
      spaceKey: space.key,
      // Die Kennung kommt aus dem Ereignisspeicher unter Umständen als Text zurück
      taskId: e.target?.type === 'task' ? Number(e.target.id) || null : null,
      boardId: e.target?.type === 'board' ? Number(e.target.id) || null : null,
      actor: e.actor ? { id: e.actor.id, displayName: e.actor.displayName } : null,
    };
    for (const c of this.clients.values()) {
      try {
        if (this.s.perms.canSpace(c.auth, space, 'view')) this.send(c, 'task', payload);
      } catch {
        /* ignorieren */
      }
    }
  }

  /* ------------------------------ Anwesenheit ------------------------------ */

  heartbeat(auth: AuthContext, pageId: number, mode: 'view' | 'edit' | 'leave'): Presence[] {
    const user = auth.user;
    if (!user) return this.presenceOf(pageId);
    let map = this.presence.get(pageId);
    if (!map) {
      map = new Map();
      this.presence.set(pageId, map);
    }
    const before = JSON.stringify(this.summary(map));
    if (mode === 'leave') map.delete(user.id);
    else {
      map.set(user.id, {
        user: { id: user.id, username: user.username, displayName: user.displayName, avatarColor: user.avatarColor },
        mode,
        at: Date.now(),
      });
    }
    const after = JSON.stringify(this.summary(map));
    if (before !== after) this.broadcastPresence(pageId);
    return this.presenceOf(pageId);
  }

  presenceOf(pageId: number): Presence[] {
    const map = this.presence.get(pageId);
    if (!map) return [];
    const now = Date.now();
    return [...map.values()].filter((p) => now - p.at < PRESENCE_TTL);
  }

  private summary(map: Map<number, Presence>) {
    return [...map.values()].map((p) => `${p.user.id}:${p.mode}`).sort();
  }

  private broadcastPresence(pageId: number): void {
    const list = this.presenceOf(pageId);
    for (const p of list) this.sendToUser(p.user.id, 'presence', { pageId, users: list.map((x) => ({ ...x.user, mode: x.mode })) });
  }

  private cleanupPresence(): void {
    const now = Date.now();
    for (const [pageId, map] of this.presence) {
      let changed = false;
      for (const [uid, p] of map) {
        if (now - p.at >= PRESENCE_TTL) {
          map.delete(uid);
          changed = true;
        }
      }
      if (!map.size) this.presence.delete(pageId);
      else if (changed) this.broadcastPresence(pageId);
    }
  }

  stats() {
    return { connections: this.clients.size, activePages: this.presence.size };
  }
}
