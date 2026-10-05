import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { RotatingLogStream } from '../src/core/logfile.ts';
import { packageBuiltAt } from '../src/config.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Protokolldatei rotiert nach Größe und behält nur die eingestellte Anzahl', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-log-'));
  try {
    const file = path.join(dir, 'logs', 'knowstead.log');
    const stream = new RotatingLogStream(file, { maxBytes: 200, keep: 2, mirror: null });
    for (let i = 0; i < 40; i++) stream.write(`{"msg":"Zeile ${String(i).padStart(3, '0')} ${'x'.repeat(20)}"}\n`);
    stream.close();
    const files = fs.readdirSync(path.dirname(file)).sort();
    assert.deepEqual(files, ['knowstead.log', 'knowstead.log.1', 'knowstead.log.2']);
    for (const name of files) assert.ok(fs.statSync(path.join(dir, 'logs', name)).size <= 200, name);
    assert.match(fs.readFileSync(file, 'utf8'), /Zeile 039/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Bauzeitpunkt des Installationspakets: erkannt, wenn vorhanden – sonst nichts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-build-'));
  try {
    // Aus dem Quelltext installiert: keine Paketdatei
    assert.equal(packageBuiltAt(dir), null);
    fs.writeFileSync(path.join(dir, '.knowstead-package.json'), JSON.stringify({ version: '1.6.0', platform: 'linux', builtAt: '2026-09-15T15:50:45.597Z' }));
    assert.equal(packageBuiltAt(dir), '2026-09-15T15:50:45.597Z');
    // Beschädigte oder unsinnige Angaben dürfen den Start nicht stören
    fs.writeFileSync(path.join(dir, '.knowstead-package.json'), '{kaputt');
    assert.equal(packageBuiltAt(dir), null);
    fs.writeFileSync(path.join(dir, '.knowstead-package.json'), JSON.stringify({ builtAt: 'irgendwann' }));
    assert.equal(packageBuiltAt(dir), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

test('Dienstbetrieb: Protokolldatei, sauberes Beenden per „cli stop“, Prüfung per „cli doctor“', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-service-'));
  const port = await freePort();
  const env = {
    ...process.env,
    KNOWSTEAD_SKIP_ENV_FILE: '1',
    DATA_DIR: dir,
    PORT: String(port),
    HOST: '127.0.0.1',
    BASE_URL: `http://127.0.0.1:${port}`,
    LOG_FILE: 'logs/knowstead.log',
    NODE_ENV: 'production',
    KNOWSTEAD_SERVICE: 'task',
  };
  const cli = (...args: string[]) =>
    spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/cli.ts', ...args], { cwd: ROOT, env, encoding: 'utf8', timeout: 60_000 });
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/index.ts'], { cwd: ROOT, env, stdio: 'ignore' });
  const exited = new Promise<number | null>((resolve) => server.once('exit', (code) => resolve(code)));
  const started: import('node:child_process').ChildProcess[] = [server];
  try {
    let healthy = false;
    for (let i = 0; i < 200 && !healthy; i++) {
      healthy = await fetch(`http://127.0.0.1:${port}/api/v1/health`).then((r) => r.ok).catch(() => false);
      if (!healthy) await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(healthy, 'Server erreichbar');
    const log = fs.readFileSync(path.join(dir, 'logs', 'knowstead.log'), 'utf8');
    assert.match(log, /läuft auf http:\/\/127\.0\.0\.1/);
    assert.match(log, /Einrichtungscode/);

    const running = JSON.parse(cli('doctor', '--json').stdout) as { ok: boolean; checks: { id: string; status: string; message: string }[] };
    assert.equal(running.checks.find((c) => c.id === 'server')?.message, 'läuft');
    assert.equal(running.checks.find((c) => c.id === 'setup')?.status, 'warn', 'Ersteinrichtung noch offen');
    assert.equal(running.checks.find((c) => c.id === 'log')?.status, 'ok');
    // Der echte Server hält beim Start fest, mit welchem Stand er läuft – die Prüfung daneben sieht: derselbe
    assert.equal(running.checks.find((c) => c.id === 'program'), undefined, 'kein Hinweis auf ein Update ohne Neustart');
    assert.equal(running.checks.find((c) => c.id === 'http')?.status, 'ok', 'der Server hält nicht nur die Datenbank, er antwortet auch');

    // Ersteinrichtung, dann Live-Verbindungen offen halten wie ein Browser: Benachrichtigungen (SSE) und
    // gemeinsames Bearbeiten (WebSocket). Beide enden nie von selbst – das Beenden muss sie trennen, sonst
    // wartet der HTTP-Server ewig und systemd bzw. die Aufgabenplanung brechen den Prozess hart ab.
    const base = `http://127.0.0.1:${port}`;
    const json = { 'Content-Type': 'application/json', 'X-Knowstead-Client': 'test' };
    const setup = await fetch(`${base}/api/v1/setup`, {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true }),
    });
    assert.equal(setup.status, 200, await setup.text());
    const cookie = setup.headers.get('set-cookie')!.split(';')[0];
    const page = await fetch(`${base}/api/v1/pages`, { method: 'POST', headers: { ...json, cookie }, body: JSON.stringify({ spaceKey: 'TEAM', title: 'Live' }) });
    const pageBody = await page.text();
    assert.equal(page.status, 200, pageBody);
    const pageId = (JSON.parse(pageBody) as { id: number }).id;
    const stream = await fetch(`${base}/api/v1/stream`, { headers: { cookie } });
    assert.equal(stream.status, 200);
    const hello = await stream.body!.getReader().read();
    assert.match(new TextDecoder().decode(hello.value), /event: hello/);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/v1/collab/${pageId}`, { headers: { cookie } });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    ws.on('error', () => {});
    const disconnected = new Promise<void>((resolve) => ws.once('close', () => resolve()));

    const stopBegan = Date.now();
    const stopped = cli('stop', '--timeout', '30');
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.match(stopped.stdout, /Server beendet/);
    assert.equal(await exited, 0, 'geordnet beendet');
    assert.ok(Date.now() - stopBegan < 8_000, `Beenden trotz offener Live-Verbindungen zügig (${Date.now() - stopBegan} ms)`);
    // „cli stop“ lief synchron – dieser Prozess hat das Ende der Verbindung noch nicht verarbeitet. Erst die
    // Ereignisschleife laufen lassen (unter Linux kommt das Ende des Serverprozesses sonst vor dem der Verbindung an).
    await Promise.race([disconnected, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    assert.equal(ws.readyState, WebSocket.CLOSED, 'WebSocket vom Server getrennt');
    assert.equal(fs.existsSync(path.join(dir, 'knowstead.stop')), false, 'Stopp-Datei aufgeräumt');
    assert.match(fs.readFileSync(path.join(dir, 'logs', 'knowstead.log'), 'utf8'), /Stopp-Anforderung empfangen/);

    assert.match(cli('stop').stdout, /läuft nicht/);
    const afterwards = JSON.parse(cli('doctor', '--json').stdout) as { checks: { id: string; message: string }[] };
    assert.match(afterwards.checks.find((c) => c.id === 'server')!.message, /läuft nicht – Port \d+ ist frei/);

    // Liegen gebliebene Stopp-Datei beendet einen neuen Start nicht sofort
    fs.writeFileSync(path.join(dir, 'knowstead.stop'), 'alt');
    const again = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server/src/index.ts'], { cwd: ROOT, env, stdio: 'ignore' });
    started.push(again);
    const againExit = new Promise<number | null>((resolve) => again.once('exit', (code) => resolve(code)));
    let up = false;
    for (let i = 0; i < 200 && !up; i++) {
      up = await fetch(`http://127.0.0.1:${port}/api/v1/health`).then((r) => r.ok).catch(() => false);
      if (!up) await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(again.exitCode, null, 'läuft weiter');
    assert.equal(cli('stop').status, 0);
    assert.equal(await againExit, 0);
  } finally {
    // Erst warten, bis die Prozesse weg sind – sonst verdeckt ein EPERM beim Aufräumen den eigentlichen Fehler
    for (const child of started) {
      if (child.exitCode === null && child.kill()) await new Promise((resolve) => child.once('exit', resolve));
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
