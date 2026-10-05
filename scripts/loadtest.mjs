#!/usr/bin/env node
/**
 * Lasttest: legt eine realistische Datenmenge an, startet den Server als eigenen
 * Prozess und simuliert gleichzeitig arbeitende Personen (Lesen, Suchen, Navigieren,
 * Speichern). Ausgabe: Durchsatz und Antwortzeiten (p50/p95/p99) je Laststufe.
 *
 *   node scripts/loadtest.mjs
 *   node scripts/loadtest.mjs --users 500 --pages 10000 --stages 25,50,100 --seconds 20
 *   node scripts/loadtest.mjs --keep        (Testdaten danach nicht löschen)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const options = {
  users: Number(arg('users', 500)),
  spaces: Number(arg('spaces', 40)),
  pages: Number(arg('pages', 8000)),
  stages: arg('stages', '25,50,100').split(',').map(Number),
  seconds: Number(arg('seconds', 15)),
  keep: args.includes('--keep'),
  /** CPU-Profil des Servers schreiben (Verzeichnis) */
  profile: arg('profile', ''),
};

const WORDS = ['Server', 'Backup', 'Firewall', 'Onboarding', 'Urlaub', 'Richtlinie', 'Datenschutz', 'Ticket', 'Netzwerk', 'Drucker', 'VPN', 'Rechnung', 'Projekt', 'Meilenstein', 'Wartung', 'Schulung', 'Prozess', 'Freigabe', 'Lieferant', 'Vertrag'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

function pageHtml(i) {
  const a = pick(WORDS);
  const b = pick(WORDS);
  return `<h2>${a} – Überblick</h2>
<p>Diese Seite beschreibt den Ablauf rund um <strong>${a}</strong> und <em>${b}</em> (Dokument ${i}). Verantwortlich ist das Team ${b}.</p>
<div data-type="callout" data-variant="info"><p>Bitte vor Änderungen die Freigabe durch das Team ${a} einholen.</p></div>
<h3>Schritte</h3>
<ol><li><p>Anfrage im Ticketsystem erfassen</p></li><li><p>${b} prüfen und dokumentieren</p></li><li><p>Ergebnis im Änderungsprotokoll festhalten</p></li></ol>
<table><tbody><tr><th><p>System</p></th><th><p>Zuständig</p></th><th><p>Prüfung</p></th></tr>
<tr><td><p>${a}-01</p></td><td><p>Team ${b}</p></td><td><p>monatlich</p></td></tr>
<tr><td><p>${b}-02</p></td><td><p>Team ${a}</p></td><td><p>quartalsweise</p></td></tr></tbody></table>
<pre><code class="language-bash">systemctl status ${a.toLowerCase()}</code></pre>
<p>${'Weitere Hinweise zu Wartungsfenstern, Ansprechpartnern und Eskalationswegen. '.repeat(8)}</p>`;
}

/* ------------------------------ Testdaten ------------------------------ */

async function seed(dataDir) {
  process.env.KNOWSTEAD_SKIP_ENV_FILE = '1';
  const { loadConfig } = await import(pathToFileURL(path.join(root, 'server/src/config.ts')).href);
  const { buildApp } = await import(pathToFileURL(path.join(root, 'server/src/app.ts')).href);
  const config = loadConfig({ DATA_DIR: dataDir, PLUGINS_DIR: path.join(dataDir, 'plugins'), WEB_DIST_DIR: path.join(dataDir, 'web'), NODE_ENV: 'test', LOG_LEVEL: 'error' });
  const { app, services: s } = await buildApp(config, { logger: false, schedulers: false });
  await app.ready();
  const started = Date.now();
  const setup = await app.inject({ method: 'POST', url: '/api/v1/setup', payload: { siteName: 'Lasttest', username: 'admin', displayName: 'Admin', password: 'lasttest-lasttest', sampleContent: false }, headers: { 'x-knowstead-client': 'loadtest' } });
  if (setup.statusCode !== 200) throw new Error(`Einrichtung fehlgeschlagen: ${setup.body}`);
  const adminRow = s.users.byUsername('admin');
  const adminAuth = s.perms.forUser(adminRow, { via: 'session' });

  const users = [adminRow];
  s.db.transaction(() => {
    for (let i = 1; i < options.users; i++) users.push(s.users.create({ username: `user${i}`, displayName: `Person ${i}` }));
  });

  const spaces = [];
  for (let i = 0; i < options.spaces; i++) {
    const isPrivate = i % 5 === 4;
    const space = await s.spaces.create(adminAuth, { key: `S${i}`, name: `Bereich ${i}`, preset: isPrivate ? 'private' : 'open' });
    spaces.push({ ...space, isPrivate });
  }
  const pages = [];
  const perSpace = Math.ceil(options.pages / options.spaces);
  for (const space of spaces) {
    const inSpace = [];
    for (let i = 0; i < perSpace && pages.length < options.pages; i++) {
      // Hierarchie: ein Drittel oberste Ebene, der Rest darunter
      const parent = inSpace.length && i % 3 ? pick(inSpace).id : null;
      const page = await s.pages.create(adminAuth, { spaceId: space.id, parentId: parent, title: `${pick(WORDS)} ${pick(WORDS)} ${pages.length}`, content: pageHtml(pages.length), silent: true, watch: false, labels: [pick(WORDS).toLowerCase()] });
      inSpace.push(page);
      pages.push({ id: page.id, space: space.key, private: space.isPrivate });
    }
  }
  // Sitzungen für die simulierten Personen (Cookie wie im Browser)
  const sessions = users.slice(0, Math.max(10, options.users)).map((u) => s.auth.createSession(u.id, s.perms.forUser(u, { via: 'session' }), true).token);
  const openPages = pages.filter((p) => !p.private);
  const info = { users: users.length, spaces: spaces.filter((sp) => !sp.isPrivate).map((sp) => sp.key), pages: openPages.map((p) => p.id), sessions, adminSession: sessions[0], seededMs: Date.now() - started };
  await app.close();
  return info;
}

/* ------------------------------ Last ------------------------------ */

const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function runStage(base, data, concurrency, seconds) {
  const stats = new Map();
  const record = (name, ms, ok) => {
    let entry = stats.get(name);
    if (!entry) stats.set(name, (entry = { times: [], errors: 0 }));
    entry.times.push(ms);
    if (!ok) entry.errors++;
  };
  const request = async (name, cookie, url, init = {}) => {
    const t0 = performance.now();
    try {
      const res = await fetch(base + url, { ...init, headers: { cookie: `knowstead_session=${cookie}`, 'x-knowstead-client': 'loadtest', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
      const body = await res.text();
      record(name, performance.now() - t0, res.ok || res.status === 409);
      return { status: res.status, body };
    } catch {
      record(name, performance.now() - t0, false);
      return { status: 0, body: '' };
    }
  };
  const scenarios = [
    [34, 'Seite lesen', (c) => request('Seite lesen', c, `/api/v1/pages/${pick(data.pages)}?render=true&view=true`)],
    [10, 'Seitenbaum', (c) => request('Seitenbaum', c, `/api/v1/spaces/${pick(data.spaces)}/tree`)],
    [8, 'Unterseiten/Kommentare/Anhänge', async (c) => {
      const id = pick(data.pages);
      await Promise.all([request('Unterseiten/Kommentare/Anhänge', c, `/api/v1/pages/${id}/children`), request('Unterseiten/Kommentare/Anhänge', c, `/api/v1/pages/${id}/comments`), request('Unterseiten/Kommentare/Anhänge', c, `/api/v1/pages/${id}/attachments`)]);
    }],
    [12, 'Suche', (c) => request('Suche', c, `/api/v1/search?q=${encodeURIComponent(pick(WORDS))}`)],
    [10, 'Startseite', async (c) => {
      await Promise.all([request('Startseite', c, '/api/v1/me/recent'), request('Startseite', c, '/api/v1/activity'), request('Startseite', c, '/api/v1/spaces')]);
    }],
    [8, 'Benachrichtigungen', (c) => request('Benachrichtigungen', c, '/api/v1/me/notifications')],
    [18, 'Speichern', async (c) => {
      const id = pick(data.pages);
      const current = await request('Speichern (laden)', c, `/api/v1/pages/${id}`);
      if (current.status !== 200) return;
      const page = JSON.parse(current.body);
      await request('Speichern', c, `/api/v1/pages/${id}`, {
        method: 'PUT',
        body: JSON.stringify({ title: page.title, content: `${page.content}<p>Ergänzung ${Date.now()}</p>`, baseVersion: page.version, minor: true }),
      });
    }],
  ];
  const total = scenarios.reduce((n, s) => n + s[0], 0);
  const choose = () => {
    let r = Math.random() * total;
    for (const s of scenarios) if ((r -= s[0]) < 0) return s;
    return scenarios[0];
  };
  const until = Date.now() + seconds * 1000;
  let operations = 0;
  const worker = async (index) => {
    const cookie = data.sessions[index % data.sessions.length];
    while (Date.now() < until) {
      await choose()[2](cookie);
      operations++;
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: concurrency }, (_, i) => worker(i)));
  const elapsed = (performance.now() - started) / 1000;
  const rows = [];
  let requests = 0;
  let errors = 0;
  for (const [name, entry] of stats) {
    const sorted = entry.times.sort((a, b) => a - b);
    requests += sorted.length;
    errors += entry.errors;
    rows.push({ Vorgang: name, Anfragen: sorted.length, 'p50 ms': Math.round(percentile(sorted, 50)), 'p95 ms': Math.round(percentile(sorted, 95)), 'p99 ms': Math.round(percentile(sorted, 99)), Fehler: entry.errors });
  }
  return { concurrency, seconds: elapsed, operations, requests, errors, rps: requests / elapsed, rows };
}

/* ------------------------------ Ablauf ------------------------------ */

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-last-'));
console.log(`Testdaten in ${dataDir}`);
console.log(`Lege ${options.users} Personen, ${options.spaces} Bereiche und ${options.pages} Seiten an …`);
const data = await seed(dataDir);
console.log(`Angelegt in ${(data.seededMs / 1000).toFixed(1)} s (${(fs.statSync(path.join(dataDir, 'knowstead.db')).size / 1024 / 1024).toFixed(1)} MB Datenbank)`);

const port = await freePort();
// Mit --profile beendet sich der Server auf „exit“ über stdin regulär, damit Node das CPU-Profil schreibt (auch unter Windows)
const serverArgs = options.profile
  ? ['--cpu-prof', `--cpu-prof-dir=${path.resolve(options.profile)}`, '-e', "process.stdin.on('data', (d) => String(d).includes('exit') && process.exit(0)); import('./server/src/index.ts');"]
  : ['server/src/index.ts'];
const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...serverArgs], {
  cwd: root,
  env: { ...process.env, KNOWSTEAD_SKIP_ENV_FILE: '1', DATA_DIR: dataDir, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'production', LOG_LEVEL: 'warn', BASE_URL: `http://127.0.0.1:${port}` },
  stdio: [options.profile ? 'pipe' : 'ignore', 'ignore', 'inherit'],
});
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${base}/api/v1/health`)).ok) break;
  } catch {
    /* Server startet noch */
  }
  await new Promise((r) => setTimeout(r, 200));
}

const summary = [];
try {
  // Aufwärmen (Statement-Cache, Dateisystem-Cache)
  await runStage(base, data, 10, 3);
  for (const concurrency of options.stages) {
    console.log(`\nLaststufe: ${concurrency} gleichzeitig arbeitende Personen, ${options.seconds} s`);
    const result = await runStage(base, data, concurrency, options.seconds);
    console.table(result.rows);
    console.log(`→ ${result.rps.toFixed(0)} Anfragen/s, ${result.errors} Fehler`);
    summary.push({ 'Gleichzeitig': concurrency, 'Anfragen/s': Math.round(result.rps), 'Fehler': result.errors, 'p95 Seite lesen (ms)': result.rows.find((r) => r.Vorgang === 'Seite lesen')?.['p95 ms'], 'p95 Speichern (ms)': result.rows.find((r) => r.Vorgang === 'Speichern')?.['p95 ms'], 'p95 Suche (ms)': result.rows.find((r) => r.Vorgang === 'Suche')?.['p95 ms'] });
  }
  console.log('\nZusammenfassung');
  console.table(summary);
  console.log(`System: ${os.cpus()[0]?.model ?? 'unbekannt'} · ${os.cpus().length} Kerne · ${(os.totalmem() / 1024 ** 3).toFixed(0)} GB RAM · Node ${process.version}`);
} finally {
  if (options.profile) child.stdin.write('exit\n');
  else child.kill();
  await new Promise((r) => setTimeout(r, options.profile ? 4000 : 500));
  if (!options.keep) fs.rmSync(dataDir, { recursive: true, force: true });
}
