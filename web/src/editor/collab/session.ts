/**
 * Verbindung zur gemeinsamen Bearbeitung (Yjs über WebSocket, y-websocket-Protokoll).
 * Stellt das Y.Doc und die Awareness (Cursor anderer Personen) bereit, verbindet
 * sich bei Abbrüchen selbstständig neu und meldet Steuernachrichten des Servers.
 */
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const MESSAGE_CONTROL = 3;

export type CollabStatus = 'connecting' | 'connected' | 'offline' | 'closed';

export interface CollabControl {
  type: 'welcome' | 'init' | 'published' | 'outdated' | 'restart' | 'closed' | string;
  [key: string]: unknown;
}

export interface CollabUser {
  id: number;
  name: string;
  color: string;
}

interface Callbacks {
  onStatus?: (status: CollabStatus) => void;
  onSynced?: () => void;
  onControl?: (message: CollabControl) => void;
  /** Verbindung wurde vom Server endgültig abgelehnt (Rechte, Einstellung, Seite gelöscht) */
  onRejected?: (code: number) => void;
}

export class CollabSession {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  readonly meta = this.doc.getMap<unknown>('meta');
  status: CollabStatus = 'connecting';
  synced = false;
  private ws: WebSocket | null = null;
  private attempts = 0;
  private retryTimer: number | null = null;
  private destroyed = false;
  private readonly url: string;
  private readonly callbacks: Callbacks;

  constructor(pageId: number, callbacks: Callbacks = {}) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${protocol}//${window.location.host}/api/v1/collab/${pageId}`;
    this.callbacks = callbacks;
    this.doc.on('update', this.onDocUpdate);
    this.awareness.on('update', this.onAwarenessUpdate);
    window.addEventListener('beforeunload', this.onUnload);
    this.connect();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.retryTimer) window.clearTimeout(this.retryTimer);
    window.removeEventListener('beforeunload', this.onUnload);
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'local');
    this.doc.off('update', this.onDocUpdate);
    this.awareness.off('update', this.onAwarenessUpdate);
    this.ws?.close(1000);
    this.ws = null;
    this.awareness.destroy();
    this.doc.destroy();
    this.setStatus('closed');
  }

  /** Steuernachricht an den Server (z. B. gemeinsamen Stand verwerfen). */
  sendControl(message: Record<string, unknown>): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_CONTROL);
    encoding.writeVarString(encoder, JSON.stringify(message));
    this.send(encoding.toUint8Array(encoder));
  }

  /** Andere Personen im Dokument (Namen vom Server bestätigt). */
  peers(): CollabUser[] {
    const users = new Map<number, CollabUser>();
    for (const [clientId, state] of this.awareness.getStates()) {
      const user = (state as { user?: CollabUser }).user;
      if (clientId !== this.doc.clientID && user?.id) users.set(user.id, user);
    }
    return [...users.values()];
  }

  private connect(): void {
    if (this.destroyed) return;
    this.setStatus('connecting');
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      this.attempts = 0;
      this.setStatus('connected');
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(encoder, this.doc);
      this.send(encoding.toUint8Array(encoder));
      if (this.awareness.getLocalState() !== null) {
        const aw = encoding.createEncoder();
        encoding.writeVarUint(aw, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(aw, awarenessProtocol.encodeAwarenessUpdate(this.awareness, [this.doc.clientID]));
        this.send(encoding.toUint8Array(aw));
      }
    };
    ws.onmessage = (event) => this.onMessage(new Uint8Array(event.data as ArrayBuffer));
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.synced = false;
      // Andere Cursor ausblenden, bis wieder verbunden
      const others = [...this.awareness.getStates().keys()].filter((id) => id !== this.doc.clientID);
      awarenessProtocol.removeAwarenessStates(this.awareness, others, this);
      if (this.destroyed) return;
      // 4000 = Neustart durch den Server (verworfen, gelöscht, extern geändert), 4003 = Rechte entzogen
      if (event.code === 4003 || (!opened && this.attempts >= 2 && event.code === 1006)) {
        this.setStatus('offline');
        this.callbacks.onRejected?.(event.code);
        if (event.code === 4003) return;
      }
      if (event.code === 4000) return;
      this.setStatus('offline');
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++);
      this.retryTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private onMessage(data: Uint8Array): void {
    const decoder = decoding.createDecoder(data);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_SYNC) {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_SYNC);
      const messageType = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
      if (encoding.length(encoder) > 1) this.send(encoding.toUint8Array(encoder));
      if (messageType === syncProtocol.messageYjsSyncStep2 && !this.synced) {
        this.synced = true;
        this.callbacks.onSynced?.();
      }
    } else if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), this);
    } else if (type === MESSAGE_CONTROL) {
      this.callbacks.onControl?.(JSON.parse(decoding.readVarString(decoder)) as CollabControl);
    }
  }

  private readonly onDocUpdate = (update: Uint8Array, origin: unknown) => {
    if (origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  private readonly onAwarenessUpdate = ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin === this) return;
    const changed = [...added, ...updated, ...removed].filter((id) => id === this.doc.clientID);
    if (!changed.length) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
    this.send(encoding.toUint8Array(encoder));
  };

  private readonly onUnload = () => {
    awarenessProtocol.removeAwarenessStates(this.awareness, [this.doc.clientID], 'unload');
  };

  private send(message: Uint8Array): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(message);
  }

  private setStatus(status: CollabStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatus?.(status);
  }
}
