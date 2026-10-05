#!/usr/bin/env node
/**
 * Entwicklungsmodus: startet den API-Server (mit Neustart bei Dateiänderungen)
 * und den Vite-Entwicklungsserver für die Oberfläche.
 *
 *   npm run dev            → API auf :3000, Oberfläche auf :5173
 *   npm run dev -- --port 4000
 *
 * Beenden mit Strg+C – beide Prozesse werden zusammen gestoppt.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

// Die Oberfläche läuft auf dem „sichtbaren“ Port (PORT, falls von außen gesetzt),
// die API daneben – sonst würden sich beide denselben Port teilen wollen.
const webPort = argValue('web-port', process.env.WEB_PORT ?? process.env.PORT ?? '5173');
const apiPort = argValue('port', process.env.KNOWSTEAD_API_PORT ?? (webPort === '3000' ? '3001' : '3000'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const children = [];
let stopping = false;

function run(name, command, commandArgs, env, color) {
  const child = spawn(command, commandArgs, {
    cwd: rootDir,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  });
  const prefix = `\u001b[${color}m${name.padEnd(6)}\u001b[0m │ `;
  const pipe = (stream, target) => {
    let rest = '';
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      const lines = (rest + chunk).split(/\r?\n/);
      rest = lines.pop() ?? '';
      for (const line of lines) target.write(`${prefix}${line}\n`);
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code, signal) => {
    if (stopping) return;
    process.stdout.write(`${prefix}beendet (${signal ?? code})\n`);
    stop(code ?? 0);
  });
  children.push(child);
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    try {
      child.kill();
    } catch {
      /* egal */
    }
  }
  setTimeout(() => process.exit(code), 200);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

console.log(`\nKnowstead – Entwicklungsmodus\n  API:         http://localhost:${apiPort}\n  Oberfläche:  http://localhost:${webPort}  ← hier arbeiten\n  API-Doku:    http://localhost:${apiPort}/api/docs\n`);

run('api', npm, ['run', 'dev', '-w', 'server'], { PORT: apiPort, LOG_LEVEL: process.env.LOG_LEVEL ?? 'debug' }, '36');
run('web', npm, ['run', 'dev', '-w', 'web', '--', '--port', webPort], { KNOWSTEAD_BACKEND: `http://localhost:${apiPort}` }, '35');
