import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { Client, createTestApp } from './helpers.ts';

/** Liest Ereignisse aus einem Server-Sent-Events-Strom, bis die gesuchte Art dabei ist. */
async function waitForEvent(
  body: ReadableStream<Uint8Array>,
  event: string,
  match: (payload: Record<string, unknown>) => boolean = () => true,
  timeoutMs = 10_000,
): Promise<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline) {
      // Gegen die Zeitgrenze laufen lassen: Ohne Ereignis käme sonst erst das Lebenszeichen nach 25 s
      const next = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), Math.max(0, deadline - Date.now())))]);
      if (!next || next.done) break;
      const { value } = next;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        const block = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        const type = /^event: (.+)$/m.exec(block)?.[1];
        const data = /^data: (.+)$/m.exec(block)?.[1];
        if (type === event && data) {
          const payload = JSON.parse(data) as Record<string, unknown>;
          // Ältere Ereignisse aus der Warteschlange überspringen
          if (match(payload)) return payload;
        }
        index = buffer.indexOf('\n\n');
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new Error(`Kein Ereignis „${event}“ innerhalb von ${timeoutMs} ms`);
}

test('Live-Aktualisierung: Änderungen im Plan erreichen offene Browser', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
  const boardId = (await admin.post('/api/v1/spaces/TEAM/boards', { name: 'Live' })).body.id;

  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = ctx.app.server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;
  // Zweite Sitzung: der „andere Browser“, der den Plan offen hat
  const login = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Knowstead-Client': 'test' },
    body: JSON.stringify({ login: 'admin', password: 'geheim-geheim' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')!.split(';')[0];

  try {
    await t.test('Neue Aufgabe erscheint als Ereignis mit Bereich und Auslöser', async () => {
      const stream = await fetch(`${base}/api/v1/stream`, { headers: { cookie } });
      assert.equal(stream.status, 200);
      const event = waitForEvent(stream.body!, 'task', (p) => p.type === 'task.created');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const created = await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Von jemand anderem angelegt' });
      assert.equal(created.status, 200, created.raw);
      const payload = await event;
      assert.equal(payload.type, 'task.created');
      assert.equal(payload.spaceKey, 'TEAM');
      assert.equal(payload.taskId, created.body.id);
      assert.deepEqual((payload.actor as { displayName: string }).displayName, 'Ada');
    });

    await t.test('Auch Verschieben und Löschen melden sich', async () => {
      const task = (await admin.post(`/api/v1/boards/${boardId}/tasks`, { title: 'Wandert' })).body;
      const stream = await fetch(`${base}/api/v1/stream`, { headers: { cookie } });
      const moved = waitForEvent(stream.body!, 'task', (p) => p.type === 'task.updated');
      await new Promise((resolve) => setTimeout(resolve, 100));
      const buckets = (await admin.get(`/api/v1/boards/${boardId}`)).body.board.buckets as { id: string }[];
      await admin.post(`/api/v1/tasks/${task.id}/move`, { bucket: buckets[1].id, index: 0 });
      assert.equal((await moved).type, 'task.updated');

      const stream2 = await fetch(`${base}/api/v1/stream`, { headers: { cookie } });
      const deleted = waitForEvent(stream2.body!, 'task', (p) => p.type === 'task.deleted');
      await new Promise((resolve) => setTimeout(resolve, 100));
      await admin.del(`/api/v1/tasks/${task.id}`);
      assert.equal((await deleted).type, 'task.deleted');
    });

    await t.test('Ohne Zugriff auf den Bereich kein Ereignis', async () => {
      await admin.post('/api/v1/spaces', { key: 'GEHEIM', name: 'Geheim', preset: 'private' });
      const secretBoard = (await admin.post('/api/v1/spaces/GEHEIM/boards', { name: 'Intern' })).body.id;
      await admin.post('/api/v1/admin/users', { username: 'tom', displayName: 'Tom', password: 'geheim-geheim' });
      const tomLogin = await fetch(`${base}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Knowstead-Client': 'test' },
        body: JSON.stringify({ login: 'tom', password: 'geheim-geheim' }),
      });
      const tomCookie = tomLogin.headers.get('set-cookie')!.split(';')[0];
      const stream = await fetch(`${base}/api/v1/stream`, { headers: { cookie: tomCookie } });
      const event = waitForEvent(stream.body!, 'task', (p) => p.spaceKey === 'GEHEIM', 2000);
      await new Promise((resolve) => setTimeout(resolve, 100));
      await admin.post(`/api/v1/boards/${secretBoard}/tasks`, { title: 'Nicht für Tom' });
      await assert.rejects(event, /Kein Ereignis/);
    });
  } finally {
    await ctx.close();
  }
});
