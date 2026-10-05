/**
 * Gemeinsames Bearbeiten in Echtzeit (Yjs über WebSocket).
 *
 * Protokoll kompatibel zu y-websocket: Nachrichtentyp 0 = Sync (y-protocols/sync),
 * 1 = Awareness (Cursor, Auswahl), 3 = Steuerung (JSON, Knowstead-spezifisch).
 *
 * Ablauf: Beim ersten Öffnen ist der gemeinsame Stand leer. Der Server beauftragt
 * genau einen verbundenen Client („init“), den veröffentlichten Seiteninhalt
 * einzuspielen – das Umwandeln von HTML in das Editor-Schema geschieht damit im
 * Browser, wo das Schema ohnehin vorliegt. Weitere Clients erhalten den Stand per
 * Sync. Der Stand wird laufend gespeichert und überlebt Neuladen und Abbrüche.
 * Veröffentlicht wird weiterhin über PUT /api/v1/pages/:id (mit `collab: true`);
 * danach setzt der Server die Basisversion des gemeinsamen Stands neu.
 */
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import type { Services } from '../../services.ts';
import type { AuthContext } from '../../core/permissions.ts';
import type { PageRow } from '../../core/types.ts';
import { nowIso } from '../../db/database.ts';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_CONTROL = 3;

const SAVE_DELAY_MS = 1500;
const SAVE_MAX_DELAY_MS = 8000;
const UNLOAD_DELAY_MS = 20_000;
const CHECK_INTERVAL_MS = 30_000;
const MAX_CONNECTIONS_PER_ROOM = 40;
const MAX_CONNECTIONS_PER_USER = 12;
const MAX_CLIENT_IDS_PER_CONNECTION = 4;
export const COLLAB_MAX_PAYLOAD = 16 * 1024 * 1024;

const COLORS = ['#2563eb', '#db2777', '#16a34a', '#ea580c', '#7c3aed', '#0891b2', '#ca8a04', '#dc2626', '#0d9488', '#4f46e5'];
const CONTENT_META_KEYS = new Set(['title', 'icon', 'labels', 'fullWidth']);

interface Connection {
  ws: WebSocket;
  auth: AuthContext;
  user: { id: number; name: string; color: string };
  clientIds: Set<number>;
  alive: boolean;
}

interface Room {
  pageId: number;
  doc: Y.Doc;
  meta: Y.Map<unknown>;
  awareness: awarenessProtocol.Awareness;
  connections: Map<WebSocket, Connection>;
  initialized: boolean;
  grantedTo: Connection | null;
  dirty: boolean;
  baseVersion: number;
  lastEditor: number | null;
  saveTimer: NodeJS.Timeout | null;
  pendingSince: number;
  unloadTimer: NodeJS.Timeout | null;
  /** Seit der letzten Größenprüfung empfangene Sync-Daten */
  receivedBytes: number;
}

export interface CollabStatus {
  editors: { id: number; name: string; color: string }[];
  unpublished: boolean;
}

export class CollabService {
  private readonly s: Services;
  /**
   * Obergrenzen gegen Speichererschöpfung: Ohne sie könnte eine bearbeitende Person das gemeinsame
   * Dokument mit großen Nachrichten beliebig anwachsen lassen. Die Größe wird nicht bei jeder Nachricht
   * berechnet, sondern jeweils nach `checkBytes` empfangenen Daten.
   */
  readonly limits = { maxDocBytes: 32 * 1024 * 1024, checkBytes: 4 * 1024 * 1024 };
  private readonly rooms = new Map<number, Room>();
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: COLLAB_MAX_PAYLOAD });
  private timer: NodeJS.Timeout | null = null;

  constructor(s: Services) {
    this.s = s;
  }

  start(): void {
    this.s.events.on('page.deleted', (e) => {
      const room = e.pageId ? this.rooms.get(e.pageId) : undefined;
      if (room) this.restart(room, 'deleted');
      if (e.pageId) this.s.db.run('DELETE FROM collab_documents WHERE page_id = ?', e.pageId);
    });
    this.timer = setInterval(() => this.check(), CHECK_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.disconnectAll();
    this.wss.close();
  }

  /**
   * Alle Verbindungen trennen und offene Bearbeitungsstände sichern. Vor dem Schließen des HTTP-Servers
   * nötig, weil der sonst auf die WebSockets wartet, die nie von selbst enden.
   */
  disconnectAll(): void {
    for (const room of [...this.rooms.values()]) {
      for (const conn of room.connections.values()) conn.ws.terminate();
      room.connections.clear();
      this.unload(room);
    }
  }

  /** Stand für die Seitenansicht: wer bearbeitet gerade, gibt es Unveröffentlichtes? */
  status(page: PageRow): CollabStatus {
    const room = this.rooms.get(page.id);
    if (room) {
      const editors = new Map<number, Connection['user']>();
      for (const conn of room.connections.values()) editors.set(conn.user.id, conn.user);
      return { editors: [...editors.values()], unpublished: room.dirty };
    }
    const dirty = this.s.db.value<number>('SELECT dirty FROM collab_documents WHERE page_id = ?', page.id);
    return { editors: [], unpublished: dirty === 1 };
  }

  /* ------------------------------ Verbindungsaufbau ------------------------------ */

  /** Wird vom HTTP-Server für jedes Upgrade aufgerufen; gehört die Adresse nicht hierher, passiert nichts. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const match = url.pathname.match(/^\/api\/v1\/collab\/(\d+)$/);
    if (!match) return false;
    const reject = (status: number, text: string) => {
      socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
      return true;
    };
    if (!this.s.settings.get('realtimeCollaboration')) return reject(503, 'Service Unavailable');
    if (!this.originAllowed(req)) return reject(403, 'Forbidden');
    // Nur bei TRUST_PROXY=true die erste weitergeleitete Adresse übernehmen (mit Adressliste: Socket-Adresse)
    const forwarded = this.s.config.trustProxy === true ? String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() : '';
    let auth: AuthContext;
    try {
      auth = this.s.auth.resolveHeaders(req.headers, forwarded || req.socket.remoteAddress || null);
    } catch {
      return reject(401, 'Unauthorized');
    }
    if (!auth.user) return reject(401, 'Unauthorized');
    // Gemeinsames Bearbeiten schreibt – API-Tokens brauchen den Umfang „write“ (die Umfangsprüfung
    // nach HTTP-Methode greift beim Upgrade nicht, es ist immer ein GET).
    if (auth.scopes && !auth.scopes.has('write') && !auth.scopes.has('admin')) return reject(403, 'Forbidden');
    const page = this.s.pages.get(Number(match[1]));
    const space = page ? this.s.spaces.get(page.space_id) : undefined;
    if (!page || !space || page.deleted_at || !this.s.perms.canViewPage(auth, page, space)) return reject(404, 'Not Found');
    if (!this.s.pages.access(auth, page, space).edit) return reject(403, 'Forbidden');
    if (page.content_type !== 'richtext' || page.status !== 'current') return reject(409, 'Conflict');
    let count = 0;
    for (const room of this.rooms.values()) for (const conn of room.connections.values()) if (conn.user.id === auth.user.id) count++;
    if (count >= MAX_CONNECTIONS_PER_USER) return reject(429, 'Too Many Requests');
    this.wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws, auth, page));
    return true;
  }

  /** Browser senden immer einen Origin – er muss zur eigenen Adresse passen (Schutz vor Cross-Site-WebSocket-Hijacking). */
  private originAllowed(req: IncomingMessage): boolean {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      const host = new URL(origin).host;
      return host === req.headers.host || host === (req.headers['x-forwarded-host'] as string | undefined) || new URL(origin).origin === new URL(this.s.config.baseUrl).origin;
    } catch {
      return false;
    }
  }

  private connect(ws: WebSocket, auth: AuthContext, page: PageRow): void {
    const room = this.room(page);
    if (room.connections.size >= MAX_CONNECTIONS_PER_ROOM) {
      ws.close(1013, 'Zu viele gleichzeitige Bearbeitende');
      return;
    }
    const user = auth.user!;
    const conn: Connection = {
      ws,
      auth,
      user: { id: user.id, name: user.displayName, color: user.avatarColor || COLORS[user.id % COLORS.length] },
      clientIds: new Set(),
      alive: true,
    };
    room.connections.set(ws, conn);
    if (room.unloadTimer) {
      clearTimeout(room.unloadTimer);
      room.unloadTimer = null;
    }
    ws.on('message', (data: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      try {
        this.onMessage(room, conn, new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      } catch (err) {
        this.s.log.warn({ err }, 'Ungültige Nachricht in der gemeinsamen Bearbeitung');
        ws.close(1007, 'Ungültige Nachricht');
      }
    });
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('close', () => this.disconnect(room, conn));
    ws.on('error', () => ws.terminate());

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    this.send(conn, encoding.toUint8Array(encoder));
    const states = room.awareness.getStates();
    if (states.size) this.send(conn, this.awarenessMessage(room, [...states.keys()]));
    this.control(conn, { type: 'welcome', user: conn.user, initialized: room.initialized });
    if (!room.initialized) this.grant(room);
  }

  private disconnect(room: Room, conn: Connection): void {
    if (!room.connections.delete(conn.ws)) return;
    if (conn.clientIds.size) awarenessProtocol.removeAwarenessStates(room.awareness, [...conn.clientIds], null);
    if (room.grantedTo === conn) {
      room.grantedTo = null;
      if (!room.initialized) this.grant(room);
    }
    if (!room.connections.size) {
      this.flush(room);
      room.unloadTimer = setTimeout(() => {
        if (!room.connections.size) this.unload(room);
      }, UNLOAD_DELAY_MS);
      room.unloadTimer.unref();
    }
  }

  /* ------------------------------ Räume ------------------------------ */

  private room(page: PageRow): Room {
    const existing = this.rooms.get(page.id);
    if (existing) return existing;
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState(null);
    const room: Room = {
      pageId: page.id,
      doc,
      meta: doc.getMap('meta'),
      awareness,
      connections: new Map(),
      initialized: false,
      grantedTo: null,
      dirty: false,
      baseVersion: page.version,
      lastEditor: null,
      saveTimer: null,
      pendingSince: 0,
      unloadTimer: null,
      receivedBytes: 0,
    };
    const stored = this.s.db.get<{ state: Uint8Array; base_version: number; dirty: number }>('SELECT state, base_version, dirty FROM collab_documents WHERE page_id = ?', page.id);
    if (stored && (stored.base_version === page.version || stored.dirty)) {
      Y.applyUpdate(doc, stored.state, 'load');
      room.initialized = room.meta.get('initialized') === true;
      room.baseVersion = stored.base_version;
      room.dirty = !!stored.dirty;
      if (stored.base_version !== page.version) doc.transact(() => room.meta.set('outdated', page.version), 'server');
    } else if (stored) {
      this.s.db.run('DELETE FROM collab_documents WHERE page_id = ?', page.id);
    }

    doc.on('update', (update: Uint8Array, origin: unknown) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);
      for (const conn of room.connections.values()) if (conn !== origin) this.send(conn, message);
      if (origin !== 'load') this.scheduleSave(room);
    });
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      const origin = tr.origin as Connection | string | null;
      const metaKeys = tr.changed.get(room.meta as unknown as Y.AbstractType<any>);
      if (metaKeys?.has('initialized') && room.meta.get('initialized') === true && !room.initialized) {
        room.initialized = true;
        room.grantedTo = null;
        const version = room.meta.get('baseVersion');
        if (typeof version === 'number') room.baseVersion = version;
        return;
      }
      if (!origin || typeof origin === 'string') return;
      const contentChanged = [...tr.changed.keys()].some((type) => type !== (room.meta as unknown)) || [...(metaKeys ?? [])].some((key) => key !== null && CONTENT_META_KEYS.has(key));
      if (!contentChanged) return;
      room.lastEditor = origin.user.id;
      if (!room.dirty) {
        room.dirty = true;
        doc.transact(() => room.meta.set('dirty', true), 'server');
      }
    });
    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const conn = origin as Connection | null;
      if (conn && typeof conn === 'object' && 'ws' in conn) {
        for (const id of added) conn.clientIds.add(id);
        for (const id of removed) conn.clientIds.delete(id);
        // Angezeigte Namen kommen vom Server, nicht aus der Nachricht des Clients
        for (const id of [...added, ...updated]) {
          const state = awareness.getStates().get(id);
          if (state) state.user = { ...conn.user };
        }
      }
      const changed = [...added, ...updated, ...removed];
      if (!changed.length) return;
      const message = this.awarenessMessage(room, changed);
      for (const other of room.connections.values()) if (other !== origin) this.send(other, message);
    });
    this.rooms.set(page.id, room);
    return room;
  }

  /** Genau einen Client beauftragen, den veröffentlichten Inhalt einzuspielen. */
  private grant(room: Room): void {
    if (room.initialized || room.grantedTo) return;
    const next = room.connections.values().next().value as Connection | undefined;
    if (!next) return;
    const page = this.s.pages.get(room.pageId);
    if (!page) return;
    room.grantedTo = next;
    room.baseVersion = page.version;
    this.control(next, { type: 'init', version: page.version });
  }

  private onMessage(room: Room, conn: Connection, data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      room.receivedBytes += data.byteLength;
      if (room.receivedBytes >= this.limits.checkBytes || data.byteLength >= this.limits.checkBytes) {
        room.receivedBytes = 0;
        if (Y.encodeStateAsUpdate(room.doc).byteLength + data.byteLength > this.limits.maxDocBytes) {
          this.s.log.warn({ pageId: room.pageId, user: conn.user.id }, 'Gemeinsames Dokument zu groß – Verbindung getrennt');
          this.control(conn, { type: 'closed', reason: 'too_large' });
          conn.ws.close(1009, 'Dokument zu groß');
          return;
        }
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, encoder, room.doc, conn);
      if (encoding.length(encoder) > 1) this.send(conn, encoding.toUint8Array(encoder));
    } else if (type === MESSAGE_AWARENESS) {
      const update = this.filterAwareness(room, conn, decoding.readVarUint8Array(decoder));
      if (update) awarenessProtocol.applyAwarenessUpdate(room.awareness, update, conn);
    } else if (type === MESSAGE_CONTROL) {
      const message = JSON.parse(decoding.readVarString(decoder)) as { type?: string };
      if (message.type === 'reset') {
        this.s.log.info({ pageId: room.pageId, user: conn.user.id }, 'Gemeinsamer Stand verworfen');
        this.restart(room, 'reset', conn.user.name);
      }
    }
  }

  /** Awareness-Einträge anderer Verbindungen dürfen nicht überschrieben werden. */
  private filterAwareness(room: Room, conn: Connection, update: Uint8Array): Uint8Array | null {
    const owner = new Map<number, Connection>();
    for (const other of room.connections.values()) for (const id of other.clientIds) owner.set(id, other);
    const decoder = decoding.createDecoder(update);
    const count = decoding.readVarUint(decoder);
    const entries: [number, number, string][] = [];
    for (let i = 0; i < count; i++) {
      const clientId = decoding.readVarUint(decoder);
      const clock = decoding.readVarUint(decoder);
      const state = decoding.readVarString(decoder);
      const current = owner.get(clientId);
      if (current && current !== conn) continue;
      if (!current && conn.clientIds.size >= MAX_CLIENT_IDS_PER_CONNECTION) continue;
      entries.push([clientId, clock, state]);
    }
    if (!entries.length) return null;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, entries.length);
    for (const [clientId, clock, state] of entries) {
      encoding.writeVarUint(encoder, clientId);
      encoding.writeVarUint(encoder, clock);
      encoding.writeVarString(encoder, state);
    }
    return encoding.toUint8Array(encoder);
  }

  private awarenessMessage(room: Room, clients: number[]): Uint8Array {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, clients));
    return encoding.toUint8Array(encoder);
  }

  private control(conn: Connection, payload: Record<string, unknown>): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_CONTROL);
    encoding.writeVarString(encoder, JSON.stringify(payload));
    this.send(conn, encoding.toUint8Array(encoder));
  }

  private send(conn: Connection, message: Uint8Array): void {
    if (conn.ws.readyState !== conn.ws.OPEN) return;
    conn.ws.send(message, (err) => {
      if (err) conn.ws.terminate();
    });
  }

  /* ------------------------------ Speichern ------------------------------ */

  private scheduleSave(room: Room): void {
    const now = Date.now();
    if (!room.pendingSince) room.pendingSince = now;
    if (room.saveTimer) clearTimeout(room.saveTimer);
    const delay = now - room.pendingSince > SAVE_MAX_DELAY_MS ? 0 : SAVE_DELAY_MS;
    room.saveTimer = setTimeout(() => this.flush(room), delay);
    room.saveTimer.unref();
  }

  private flush(room: Room): void {
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = null;
    room.pendingSince = 0;
    if (!room.initialized || !this.s.pages.get(room.pageId)) return;
    this.s.db.run(
      `INSERT INTO collab_documents (page_id, state, base_version, dirty, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(page_id) DO UPDATE SET state = excluded.state, base_version = excluded.base_version, dirty = excluded.dirty,
         updated_at = excluded.updated_at, updated_by = COALESCE(excluded.updated_by, collab_documents.updated_by)`,
      room.pageId,
      Y.encodeStateAsUpdate(room.doc),
      room.baseVersion,
      room.dirty ? 1 : 0,
      nowIso(),
      room.lastEditor,
    );
  }

  private unload(room: Room): void {
    if (room.unloadTimer) clearTimeout(room.unloadTimer);
    if (room.dirty) this.flush(room);
    else {
      if (room.saveTimer) clearTimeout(room.saveTimer);
      // Nichts Unveröffentlichtes: beim nächsten Öffnen frisch aus der veröffentlichten Fassung starten
      this.s.db.run('DELETE FROM collab_documents WHERE page_id = ?', room.pageId);
    }
    room.awareness.destroy();
    room.doc.destroy();
    this.rooms.delete(room.pageId);
  }

  /** Alle Verbindungen trennen und den gemeinsamen Stand verwerfen (Clients verbinden sich neu). */
  private restart(room: Room, reason: 'reset' | 'deleted' | 'updated', by?: string): void {
    for (const conn of room.connections.values()) {
      this.control(conn, { type: 'restart', reason, by: by ?? null });
      conn.ws.close(4000, reason);
    }
    room.connections.clear();
    room.dirty = false;
    if (room.saveTimer) clearTimeout(room.saveTimer);
    room.saveTimer = null;
    this.unload(room);
  }

  /* ------------------------------ Veröffentlichen ------------------------------ */

  /** Nach jedem Speichern einer Seite (PageService.save). */
  afterSave(pageId: number, version: number, by: string | null, fromCollab: boolean): void {
    const room = this.rooms.get(pageId);
    if (!room) {
      if (fromCollab) this.s.db.run('DELETE FROM collab_documents WHERE page_id = ?', pageId);
      else this.s.db.run('DELETE FROM collab_documents WHERE page_id = ? AND dirty = 0', pageId);
      return;
    }
    if (fromCollab) {
      room.baseVersion = version;
      room.dirty = false;
      room.doc.transact(() => {
        room.meta.set('baseVersion', version);
        room.meta.set('dirty', false);
        room.meta.delete('outdated');
      }, 'server');
      for (const conn of room.connections.values()) this.control(conn, { type: 'published', version, by });
      this.flush(room);
    } else if (version !== room.baseVersion) {
      if (room.dirty) {
        room.doc.transact(() => room.meta.set('outdated', version), 'server');
        for (const conn of room.connections.values()) this.control(conn, { type: 'outdated', version, by });
      } else this.restart(room, 'updated', by ?? undefined);
    }
  }

  /** Regelmäßig: tote Verbindungen schließen, entzogene Rechte durchsetzen. */
  private check(): void {
    for (const room of [...this.rooms.values()]) {
      const page = this.s.pages.get(room.pageId);
      for (const conn of [...room.connections.values()]) {
        if (!conn.alive) {
          conn.ws.terminate();
          continue;
        }
        conn.alive = false;
        conn.ws.ping();
        conn.auth.cache.clear();
        const user = this.s.users.get(conn.user.id);
        // Abgelaufene Sitzungen und widerrufene oder abgelaufene API-Tokens beenden die Verbindung
        const sessionValid = conn.auth.sessionId
          ? !!this.s.db.value('SELECT 1 FROM sessions WHERE id = ? AND expires_at > ?', conn.auth.sessionId, nowIso())
          : conn.auth.tokenId
            ? !!this.s.db.value('SELECT 1 FROM api_tokens WHERE id = ? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)', conn.auth.tokenId, nowIso())
            : true;
        const space = page ? this.s.spaces.get(page.space_id) : undefined;
        const allowed = !!page && !!space && !page.deleted_at && user?.status === 'active' && sessionValid && this.s.pages.access(conn.auth, page, space).edit;
        if (!allowed) {
          this.control(conn, { type: 'closed', reason: 'forbidden' });
          conn.ws.close(4003, 'forbidden');
        }
      }
    }
  }
}
