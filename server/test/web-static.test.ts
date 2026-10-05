import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestApp, Client } from './helpers.ts';

/**
 * Auslieferung der Weboberfläche: Programmdateien, die erst nach dem Start entstehen (neuer Build ohne
 * Neustart), muss der Rückfall im Not-Found-Handler ausliefern – auch wenn WEB_DIST_DIR in der .env
 * unnormalisiert steht (Schrägstrich am Ende, „..“, unter Windows Schrägstriche statt Backslashes).
 */
test('Weboberfläche: neue Dateien nach dem Start, fehlende Dateien, Seitenrouten, kein Ausbruch', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowstead-web-'));
  const dist = path.join(dir, 'web');
  fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Knowstead</title><div id="root"></div>');
  fs.writeFileSync(path.join(dist, 'assets', 'alt-abc.js'), 'console.log("alt")');
  fs.writeFileSync(path.join(dir, 'geheim.txt'), 'streng geheim');
  // Unnormalisierter Pfad, wie er schnell in einer .env steht
  const unnormalisiert = `${path.join(dist, 'assets', '..')}${path.sep}`;
  const ctx = await createTestApp({ dir, env: { WEB_DIST_DIR: unnormalisiert } });
  try {
    assert.equal(ctx.s.config.webDistDir, dist, 'Verzeichnis wird normalisiert');
    const c = new Client(ctx.app);

    const alt = await c.get('/assets/alt-abc.js');
    assert.equal(alt.status, 200);
    assert.equal(alt.raw, 'console.log("alt")');

    // Datei entsteht nach dem Start (neuer Build): Rückfall liefert sie mit richtigem Typ aus
    fs.writeFileSync(path.join(dist, 'assets', 'neu-def.js'), 'console.log("neu")');
    const neu = await c.get('/assets/neu-def.js');
    assert.equal(neu.status, 200, neu.raw);
    assert.match(String(neu.headers['content-type']), /javascript/);
    assert.equal(neu.raw, 'console.log("neu")');

    // Fehlende Programmdatei: 404 als Text, nie die HTML-Seite mit 200
    const fehlt = await c.get('/assets/fehlt-xyz.js');
    assert.equal(fehlt.status, 404);
    assert.match(String(fehlt.headers['content-type']), /text\/plain/);
    assert.equal(fehlt.headers['cache-control'], 'no-store');

    // Seitenroute der Oberfläche: index.html
    const seite = await c.get('/s/ABC/tasks?board=1&task=2');
    assert.equal(seite.status, 200);
    assert.match(String(seite.headers['content-type']), /text\/html/);
    assert.match(seite.raw, /id="root"/);

    // Kein Ausbruch aus dem Verzeichnis – weder direkt noch kodiert
    for (const url of ['/../geheim.txt', '/..%2Fgeheim.txt', '/assets/..%2F..%2Fgeheim.txt', '/%2e%2e/geheim.txt']) {
      const res = await c.get(url);
      assert.notEqual(res.raw.includes('streng geheim'), true, `${url} gibt nichts von außerhalb preis`);
    }
  } finally {
    await ctx.close();
  }
});
