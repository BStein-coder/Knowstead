/**
 * Eine Wegwerf-Installation für Werkzeuge, die die Oberfläche von außen ansehen (english-scan.mjs, shots.mjs):
 * eigener Server mit frischer Datenbank in einem temporären Ordner, englisch eingerichtet, mit Beispielinhalten, drei
 * weiteren Konten und einem Aufgabenplan mit Terminen. Die Datenverzeichnisse der echten Installation bleiben unberührt.
 *
 *   const instance = await startInstance({ port: 3898 });
 *   … instance.base, instance.cookie, instance.ids …
 *   await instance.stop();
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const day = (offset) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

/**
 * @param {{ port?: string | number, ui?: 'de' | 'en' }} [options] `ui`: Sprache der Oberfläche (Profil); die Installation
 *   selbst ist immer englisch eingerichtet
 */
export async function startInstance({ port = 3898, ui = 'en' } = {}) {
  if (!fs.existsSync(path.join(root, 'web', 'dist', 'index.html'))) {
    throw new Error('Die Oberfläche ist nicht gebaut – bitte zuerst im Projektordner „npm run build“ ausführen.');
  }
  const base = `http://127.0.0.1:${port}`;
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-instance-'));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(DOKU_|KNOWSTEAD_)/.test(key)));
  Object.assign(env, {
    NODE_ENV: 'production',
    KNOWSTEAD_SKIP_ENV_FILE: '1',
    DATA_DIR: dataDir,
    PORT: String(port),
    HOST: '127.0.0.1',
    BASE_URL: base,
    WEB_DIST_DIR: path.join(root, 'web', 'dist'),
    PLUGINS_DIR: path.join(root, 'plugins'),
    LOG_LEVEL: 'warn',
    TRUST_PROXY: 'false',
    COOKIE_SECURE: 'false',
  });
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(root, 'server', 'src', 'index.ts')], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  server.stdout.on('data', (chunk) => (log += chunk));
  server.stderr.on('data', (chunk) => (log += chunk));

  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: { 'X-Knowstead-Client': 'instance', 'X-Knowstead-Locale': 'en', ...(cookie ? { cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`);
    try {
      return { json: JSON.parse(text), headers: res.headers };
    } catch {
      return { json: null, headers: res.headers };
    }
  };

  const stop = async () => {
    server.kill();
    await new Promise((resolve) => (server.exitCode === null ? server.once('exit', resolve) : resolve()));
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };

  try {
    for (let i = 0; ; i++) {
      if (server.exitCode !== null) throw new Error(`Der Server ist nicht gestartet:\n${log.slice(-800)}`);
      if (i > 120) throw new Error('Der Server antwortet nicht.');
      try {
        if ((await fetch(`${base}/api/v1/health`)).ok) break;
      } catch {
        /* noch nicht bereit */
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    // Das Kennwort der Wegwerf-Installation entsteht zufällig und wird nirgends ausgegeben
    const setup = await call('POST', '/api/v1/setup', {
      siteName: 'Knowstead',
      username: 'alex',
      displayName: 'Alex Morgan',
      email: 'alex@example.com',
      password: crypto.randomBytes(18).toString('base64url'),
      locale: 'en',
      sampleContent: true,
    });
    cookie = (setup.headers.get('set-cookie') ?? '').split(';')[0];
    // Ohne die Einführung, die sich sonst über jede Seite legt; die Sprache der Oberfläche folgt dem Profil
    await call('PATCH', '/api/v1/me/preferences', { onboarding: { tourDone: true, dismissed: true }, locale: ui });

    const me = (await call('GET', '/api/v1/auth/me')).json.user.id;
    const people = {};
    for (const [username, displayName] of [
      ['priya', 'Priya Sharma'],
      ['tom', 'Tom Becker'],
      ['lena', 'Lena Vogel'],
    ]) {
      const user = await call('POST', '/api/v1/admin/users', { username, displayName, email: `${username}@example.com`, password: crypto.randomBytes(18).toString('base64url') });
      people[username] = user.json.id;
    }

    const tree = (await call('GET', '/api/v1/spaces/TEAM/tree')).json;
    const page = tree.find((entry) => entry.parentId) ?? tree[0];
    const board = (await call('POST', '/api/v1/spaces/TEAM/boards', { name: 'Intranet launch', description: 'From content migration to go-live' })).json;
    const [todo, doing, , done] = board.buckets.map((b) => b.id);
    const task = async (body) => (await call('POST', `/api/v1/boards/${board.id}/tasks`, body)).json;
    const t1 = await task({ title: 'Agree on the page structure', bucket: done, status: 'done', progress: 100, assigneeId: me, startDate: day(-14), dueDate: day(-10), labels: ['concept'] });
    const t2 = await task({ title: 'Migrate the old wiki', bucket: doing, status: 'doing', progress: 60, assigneeId: people.priya, startDate: day(-9), dueDate: day(-1), labels: ['migration'], priority: 'high', predecessors: [{ taskId: t1.id, type: 'FS' }] });
    const t3 = await task({ title: 'Set up single sign-on', bucket: doing, status: 'doing', progress: 40, assigneeId: people.tom, startDate: day(-3), dueDate: day(4), labels: ['security'], priority: 'high' });
    const t4 = await task({ title: 'Review permissions per space', bucket: todo, assigneeId: people.lena, startDate: day(5), dueDate: day(9), labels: ['security'], predecessors: [{ taskId: t3.id, type: 'FS' }] });
    const t5 = await task({ title: 'Write the onboarding handbook', bucket: todo, assigneeId: me, startDate: day(2), dueDate: day(14), labels: ['content'], predecessors: [{ taskId: t2.id, type: 'FS' }] });
    await task({ title: 'Approval workflow for policies', bucket: todo, assigneeId: people.lena, startDate: day(10), dueDate: day(17), labels: ['quality'], predecessors: [{ taskId: t4.id, type: 'FS' }] });
    await task({ title: 'Pilot with the IT department', bucket: todo, assigneeId: people.priya, startDate: day(15), dueDate: day(22), labels: ['rollout'], priority: 'high', predecessors: [{ taskId: t5.id, type: 'FS' }] });
    await call('POST', `/api/v1/tasks/${t2.id}/comments`, { body: '<p>Two spaces are imported, history included. The attachments of the third one are still running.</p>' });
    return { base, cookie, ids: { pageId: page.id, boardId: board.id, taskId: t2.id }, call, stop };
  } catch (err) {
    await stop();
    throw err;
  }
}
