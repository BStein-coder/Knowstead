import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { Client, createTestApp } from './helpers.ts';

interface Peer {
  ws: WebSocket;
  doc: Y.Doc;
  awareness: awarenessProtocol.Awareness;
  controls: { type: string; [key: string]: unknown }[];
  closed: Promise<number>;
  until: (check: () => boolean, label: string) => Promise<void>;
}

const cookieOf = (client: Client) => (client as unknown as { cookie: string }).cookie;

/** Minimaler Yjs-Client (entspricht dem Browser-Provider). */
function connect(url: string, cookie: string | null, origin?: string, authorization?: string): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;
    if (authorization) headers.authorization = authorization;
    const ws = new WebSocket(url, { headers });
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const controls: Peer['controls'] = [];
    const listeners = new Set<() => void>();
    const notify = () => listeners.forEach((l) => l());
    const send = (encoder: encoding.Encoder) => ws.readyState === ws.OPEN && ws.send(encoding.toUint8Array(encoder));
    const closed = new Promise<number>((done) => ws.on('close', (code) => done(code)));

    doc.on('update', (update: Uint8Array, source: unknown) => {
      if (source === ws) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeUpdate(encoder, update);
      send(encoder);
    });
    awareness.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, source: unknown) => {
      if (source === ws) return notify();
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, [...added, ...updated, ...removed]));
      send(encoder);
    });
    ws.on('message', (data: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(decoder);
      if (type === 0) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, 0);
        syncProtocol.readSyncMessage(decoder, encoder, doc, ws);
        if (encoding.length(encoder) > 1) send(encoder);
      } else if (type === 1) awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), ws);
      else if (type === 3) controls.push(JSON.parse(decoding.readVarString(decoder)));
      notify();
    });
    ws.on('open', () => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeSyncStep1(encoder, doc);
      send(encoder);
      resolve({
        ws,
        doc,
        awareness,
        controls,
        closed,
        until: (check, label) =>
          new Promise((done, fail) => {
            if (check()) return done();
            const timer = setTimeout(() => {
              listeners.delete(listener);
              fail(new Error(`Zeitüberschreitung: ${label}`));
            }, 3000);
            const listener = () => {
              if (!check()) return;
              clearTimeout(timer);
              listeners.delete(listener);
              done();
            };
            listeners.add(listener);
          }),
      });
    });
    // Awareness hält einen Timer – bei abgelehnten Verbindungen sofort aufräumen
    ws.on('unexpected-response', (_req, res) => {
      awareness.destroy();
      reject(Object.assign(new Error(`HTTP ${res.statusCode}`), { status: res.statusCode }));
    });
    ws.on('error', (err) => {
      awareness.destroy();
      reject(err);
    });
  });
}

const text = (doc: Y.Doc) => doc.getXmlFragment('default').toString();

test('Gemeinsames Bearbeiten in Echtzeit', async (t) => {
  const ctx = await createTestApp();
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = ctx.app.server.address() as AddressInfo;
  const admin = new Client(ctx.app);
  const tom = new Client(ctx.app);
  const eva = new Client(ctx.app);
  const peers: Peer[] = [];
  let pageId = 0;
  let url = '';

  try {
    await t.test('Einrichtung', async () => {
      assert.equal((await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false })).status, 200);
      for (const [username, displayName] of [['tom', 'Tom'], ['eva', 'Eva']]) await admin.post('/api/v1/admin/users', { username, displayName, password: 'geheim-geheim' });
      assert.equal((await tom.post('/api/v1/auth/login', { login: 'tom', password: 'geheim-geheim' })).status, 200);
      assert.equal((await eva.post('/api/v1/auth/login', { login: 'eva', password: 'geheim-geheim' })).status, 200);
      assert.equal((await admin.post('/api/v1/spaces', { key: 'TEAM', name: 'Team', preset: 'open' })).status, 200);
      const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Protokoll', content: '<p>Hallo</p>' });
      pageId = page.body.id;
      url = `ws://127.0.0.1:${port}/api/v1/collab/${pageId}`;
      // Eva darf lesen, aber nicht bearbeiten
      const users = (await admin.get('/api/v1/admin/users')).body;
      const list = (users.items ?? users) as { id: number; username: string }[];
      const ids = Object.fromEntries(list.map((u) => [u.username, u.id]));
      const restricted = await admin.put(`/api/v1/pages/${pageId}/restrictions`, { view: [], edit: [{ type: 'user', id: ids.admin }, { type: 'user', id: ids.tom }] });
      assert.equal(restricted.status, 200, restricted.raw);
    });

    await t.test('Zugriffsschutz beim Verbindungsaufbau', async () => {
      await assert.rejects(connect(url, null), (err: { status?: number }) => err.status === 401);
      await assert.rejects(connect(url, cookieOf(eva)), (err: { status?: number }) => err.status === 403, 'nur Leserecht');
      await assert.rejects(connect(url, cookieOf(admin), 'https://angreifer.example'), (err: { status?: number }) => err.status === 403, 'fremder Origin');
      await assert.rejects(connect(`ws://127.0.0.1:${port}/api/v1/collab/999999`, cookieOf(admin)), (err: { status?: number }) => err.status === 404);

      // API-Tokens: Lesen genügt nicht, Bearbeiten braucht den Umfang „write“ (eigene Seite, damit der Raum unberührt bleibt)
      const other = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Token-Test', content: '<p>x</p>' });
      const otherUrl = `ws://127.0.0.1:${port}/api/v1/collab/${other.body.id}`;
      const readToken = (await admin.post('/api/v1/me/tokens', { name: 'Nur lesen', scopes: ['read'] })).body.token as string;
      await assert.rejects(connect(otherUrl, null, undefined, `Bearer ${readToken}`), (err: { status?: number }) => err.status === 403, 'Token ohne Schreibumfang');
      const writeToken = (await admin.post('/api/v1/me/tokens', { name: 'Schreiben', scopes: ['read', 'write'] })).body.token as string;
      const viaToken = await connect(otherUrl, null, undefined, `Bearer ${writeToken}`);
      viaToken.ws.close();
      viaToken.awareness.destroy();
      await viaToken.closed;
    });

    await t.test('Erster Client spielt den Inhalt ein, zweiter erhält ihn per Sync', async () => {
      const a = await connect(url, cookieOf(admin), `http://127.0.0.1:${port}`);
      peers.push(a);
      await a.until(() => a.controls.some((c) => c.type === 'init'), 'Auftrag zum Einspielen');
      const init = a.controls.find((c) => c.type === 'init')!;
      assert.equal(init.version, 1);
      a.doc.transact(() => {
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.insert(0, [new Y.XmlText('Hallo')]);
        a.doc.getXmlFragment('default').insert(0, [paragraph]);
        const meta = a.doc.getMap('meta');
        meta.set('initialized', true);
        meta.set('baseVersion', 1);
        meta.set('title', 'Protokoll');
      });

      const b = await connect(url, cookieOf(tom));
      peers.push(b);
      await b.until(() => text(b.doc).includes('Hallo'), 'Inhalt beim zweiten Client');
      assert.ok(!b.controls.some((c) => c.type === 'init'), 'kein zweiter Einspiel-Auftrag');
      assert.equal(b.doc.getMap('meta').get('initialized'), true);
      const dto = await admin.get(`/api/v1/pages/${pageId}`);
      assert.equal(dto.body.collab.unpublished, false, 'Einspielen zählt nicht als Änderung');
      assert.deepEqual(dto.body.collab.editors.map((e: { name: string }) => e.name).sort(), ['Ada', 'Tom']);
    });

    await t.test('Änderungen, Cursor und geschützte Namen', async () => {
      const [a, b] = peers;
      const paragraph = b.doc.getXmlFragment('default').get(0) as Y.XmlElement;
      (paragraph.get(0) as Y.XmlText).insert(5, ' Welt');
      await a.until(() => text(a.doc).includes('Hallo Welt'), 'Änderung bei Ada');
      await a.until(() => a.doc.getMap('meta').get('dirty') === true, 'ungespeichert markiert');
      assert.equal((await admin.get(`/api/v1/pages/${pageId}`)).body.collab.unpublished, true);

      b.awareness.setLocalStateField('user', { name: 'Ada (gefälscht)', color: '#000' });
      await a.until(() => (a.awareness.getStates().get(b.doc.clientID) as { user?: { name: string } } | undefined)?.user?.name === 'Tom', 'Name vom Server');

      // Fremde Awareness-Einträge dürfen nicht überschrieben werden
      a.awareness.setLocalStateField('cursor', { anchor: 1 });
      await b.until(() => b.awareness.getStates().has(a.doc.clientID), 'Adas Cursor bei Tom');
      const forged = new awarenessProtocol.Awareness(new Y.Doc());
      forged.clientID = a.doc.clientID;
      forged.setLocalState({ user: { name: 'Tom' }, cursor: null });
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 1);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(forged, [a.doc.clientID], new Map([[a.doc.clientID, { ...forged.getLocalState()!, clock: 9999 }]]) as never));
      b.ws.send(encoding.toUint8Array(encoder));
      await new Promise((r) => setTimeout(r, 150));
      const seen = a.awareness.getStates().get(a.doc.clientID) as { cursor?: unknown };
      assert.deepEqual(seen.cursor, { anchor: 1 }, 'Adas eigener Zustand bleibt unverändert');
      forged.destroy();
    });

    await t.test('Veröffentlichen setzt Basisversion und Änderungsstatus zurück', async () => {
      const [a, b] = peers;
      const published = await admin.put(`/api/v1/pages/${pageId}`, { content: '<p>Hallo Welt</p>', baseVersion: 1, collab: true, changeNote: 'Gemeinsam' });
      assert.equal(published.status, 200, published.raw);
      await b.until(() => b.controls.some((c) => c.type === 'published' && c.version === 2 && c.by === 'Ada'), 'Hinweis an Tom');
      await a.until(() => a.doc.getMap('meta').get('baseVersion') === 2 && a.doc.getMap('meta').get('dirty') === false, 'Basisversion 2');
      const dto = await admin.get(`/api/v1/pages/${pageId}`);
      assert.equal(dto.body.collab.unpublished, false);
      assert.equal(dto.body.version, 2);
    });

    await t.test('Änderung außerhalb der Sitzung wird gemeldet, Verwerfen startet neu', async () => {
      const [a, b] = peers;
      ((b.doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Neu: ');
      await a.until(() => a.doc.getMap('meta').get('dirty') === true, 'wieder ungespeichert');
      const external = await admin.put(`/api/v1/pages/${pageId}`, { content: '<p>Per API geändert</p>', baseVersion: 2 });
      assert.equal(external.status, 200, external.raw);
      await a.until(() => a.controls.some((c) => c.type === 'outdated' && c.version === 3), 'Hinweis auf neuere Version');
      assert.equal(a.doc.getMap('meta').get('outdated'), 3);

      // Stand verwerfen: alle Verbindungen werden getrennt, gespeicherter Stand gelöscht
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 3);
      encoding.writeVarString(encoder, JSON.stringify({ type: 'reset' }));
      a.ws.send(encoding.toUint8Array(encoder));
      assert.equal(await b.closed, 4000);
      assert.ok(b.controls.some((c) => c.type === 'restart' && c.reason === 'reset' && c.by === 'Ada'));
      await a.closed;
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM collab_documents WHERE page_id = ?', pageId), 0);

      const fresh = await connect(url, cookieOf(tom));
      peers.push(fresh);
      await fresh.until(() => fresh.controls.some((c) => c.type === 'init' && c.version === 3), 'neuer Einspiel-Auftrag auf Version 3');
      fresh.ws.close();
      await fresh.closed;
    });

    await t.test('Gespeicherter Stand übersteht das Schließen aller Verbindungen', async () => {
      const a = await connect(url, cookieOf(admin));
      peers.push(a);
      await a.until(() => a.controls.some((c) => c.type === 'init'), 'Einspielen');
      a.doc.transact(() => {
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.insert(0, [new Y.XmlText('Per API geändert')]);
        a.doc.getXmlFragment('default').insert(0, [paragraph]);
        a.doc.getMap('meta').set('initialized', true);
        a.doc.getMap('meta').set('baseVersion', 3);
      });
      ((a.doc.getXmlFragment('default').get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(0, 'Entwurf: ');
      await new Promise((r) => setTimeout(r, 100));
      a.ws.close();
      await a.closed;
      await new Promise((r) => setTimeout(r, 100));
      const row = ctx.s.db.get<{ dirty: number; base_version: number }>('SELECT dirty, base_version FROM collab_documents WHERE page_id = ?', pageId);
      assert.deepEqual({ ...row }, { dirty: 1, base_version: 3 });
      assert.equal((await tom.get(`/api/v1/pages/${pageId}`)).body.collab.unpublished, true, 'Hinweis in der Seitenansicht');

      const b = await connect(url, cookieOf(tom));
      peers.push(b);
      await b.until(() => text(b.doc).includes('Entwurf: Per API geändert'), 'unveröffentlichter Stand wird geladen');
      assert.ok(!b.controls.some((c) => c.type === 'init'));

      // Seite in den Papierkorb: Sitzung wird beendet
      assert.equal((await admin.del(`/api/v1/pages/${pageId}`)).status, 200);
      assert.equal(await b.closed, 4000);
      assert.ok(b.controls.some((c) => c.type === 'restart' && c.reason === 'deleted'));
      assert.equal(ctx.s.db.value('SELECT COUNT(*) FROM collab_documents WHERE page_id = ?', pageId), 0);
    });

    await t.test('Zu große gemeinsame Dokumente werden getrennt statt den Speicher zu füllen', async () => {
      const limits = { ...ctx.s.collab.limits };
      Object.assign(ctx.s.collab.limits, { maxDocBytes: 64 * 1024, checkBytes: 8 * 1024 });
      try {
        const page = await admin.post('/api/v1/pages', { spaceKey: 'TEAM', title: 'Groß', content: '<p>klein</p>' });
        const big = await connect(`ws://127.0.0.1:${port}/api/v1/collab/${page.body.id}`, cookieOf(admin));
        peers.push(big);
        await big.until(() => big.controls.some((c) => c.type === 'init'), 'Einspielen');
        big.doc.transact(() => {
          const paragraph = new Y.XmlElement('paragraph');
          paragraph.insert(0, [new Y.XmlText('x'.repeat(200 * 1024))]);
          big.doc.getXmlFragment('default').insert(0, [paragraph]);
          big.doc.getMap('meta').set('initialized', true);
        });
        assert.equal(await big.closed, 1009);
        assert.ok(big.controls.some((c) => c.type === 'closed' && c.reason === 'too_large'));
      } finally {
        Object.assign(ctx.s.collab.limits, limits);
      }
    });
  } finally {
    for (const peer of peers) {
      peer.ws.terminate();
      peer.awareness.destroy();
    }
    await ctx.close();
  }
});
