import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/**
 * Zufällige, aber bei gleichem Startwert immer gleiche Abfolge von Seitenoperationen (anlegen, verschieben, kopieren,
 * löschen, wiederherstellen, endgültig löschen, ändern, beschriften, suchen). Nach je zehn Schritten müssen die
 * Zusammenhänge der Daten stimmen: Suchindex, Seitenbaum ohne Zyklen und über Bereichsgrenzen hinweg, Startseiten,
 * Papierkorb-Wurzeln, Labels, Fremdschlüssel. Für die Fehlersuche: `MODEL_SEED=7 MODEL_STEPS=1500 node --test …`.
 */
let seed = Number(process.env.MODEL_SEED ?? 1);
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];

test('Seitenoperationen bewahren den Zusammenhang der Daten (Suchindex, Baum, Papierkorb, Labels)', { timeout: 600000 }, async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    const db = ctx.s.db;
    const spaceKeys: string[] = [];
    for (const key of ['AAA', 'BBB', 'CCC']) {
      const res = await admin.post('/api/v1/spaces', { key, name: `Bereich ${key}` });
      assert.equal(res.status, 200, res.raw);
      spaceKeys.push(key);
    }
    const known: number[] = [];
    const problems: string[] = [];
    const log: string[] = [];
    const call = async (label: string, method: string, url: string, body?: unknown) => {
      const res = await admin.request(method, url, body);
      log.push(`${label} ${method} ${url} ${JSON.stringify(body ?? '')} → ${res.status}`);
      if (res.status >= 500) problems.push(`5xx: ${label} ${method} ${url} ${JSON.stringify(body)} → ${res.raw.slice(0, 200)}`);
      return res;
    };
    const word = () => pick(['alpha', 'beta', 'gamma', 'delta', 'omega', 'sigma', 'kappa', 'theta']);

    const check = (step: number) => {
      const pages = db.all<{ id: number; space_id: number; parent_id: number | null; status: string; deleted_at: string | null; trash_root_id: number | null; position: number }>(
        'SELECT id, space_id, parent_id, status, deleted_at, trash_root_id, position FROM pages',
      );
      const byId = new Map(pages.map((p) => [p.id, p]));
      const fts = new Set(db.all<{ rowid: number }>('SELECT rowid FROM pages_fts').map((r) => r.rowid));
      const wanted = new Set(pages.filter((p) => p.status === 'current' && !p.deleted_at).map((p) => p.id));
      for (const id of wanted) if (!fts.has(id)) problems.push(`Schritt ${step}: Seite ${id} fehlt im Suchindex`);
      for (const id of fts) if (!wanted.has(id)) problems.push(`Schritt ${step}: Suchindex enthält Seite ${id}, die nicht (mehr) durchsuchbar sein soll`);
      for (const p of pages) {
        if (p.parent_id !== null) {
          const parent = byId.get(p.parent_id);
          if (!parent) problems.push(`Schritt ${step}: Seite ${p.id} zeigt auf fehlende Elternseite ${p.parent_id}`);
          else {
            if (parent.space_id !== p.space_id) problems.push(`Schritt ${step}: Seite ${p.id} (Bereich ${p.space_id}) unter Elternseite ${parent.id} in Bereich ${parent.space_id}`);
            if (!p.deleted_at && parent.deleted_at) problems.push(`Schritt ${step}: lebende Seite ${p.id} unter gelöschter Elternseite ${parent.id}`);
          }
        }
        // Zyklen
        let cur: typeof p | undefined = p;
        for (let i = 0; cur && i < 200; i++) cur = cur.parent_id === null ? undefined : byId.get(cur.parent_id);
        if (cur) problems.push(`Schritt ${step}: Zyklus oder zu tiefe Kette bei Seite ${p.id}`);
        if (p.deleted_at && p.trash_root_id && !byId.has(p.trash_root_id)) problems.push(`Schritt ${step}: Papierkorb-Wurzel ${p.trash_root_id} von Seite ${p.id} fehlt`);
      }
      for (const sp of db.all<{ id: number; home_page_id: number | null }>('SELECT id, home_page_id FROM spaces')) {
        if (!sp.home_page_id) continue;
        const home = byId.get(sp.home_page_id);
        if (!home || home.space_id !== sp.id || home.deleted_at) problems.push(`Schritt ${step}: Startseite ${sp.home_page_id} von Bereich ${sp.id} ungültig`);
      }
      const orphanLabels = db.get<{ c: number }>('SELECT COUNT(*) AS c FROM labels WHERE id NOT IN (SELECT label_id FROM page_labels)')!.c;
      if (orphanLabels) problems.push(`Schritt ${step}: ${orphanLabels} Label ohne Seite`);
      const fk = db.all('PRAGMA foreign_key_check');
      if (fk.length) problems.push(`Schritt ${step}: Fremdschlüsselverletzungen ${JSON.stringify(fk.slice(0, 3))}`);
    };

    const STEPS = Number(process.env.MODEL_STEPS ?? 300);
    for (let step = 1; step <= STEPS; step++) {
      const op = rnd();
      const live = known.filter((id) => db.get('SELECT 1 FROM pages WHERE id = ? AND deleted_at IS NULL', id));
      const trashed = known.filter((id) => db.get('SELECT 1 FROM pages WHERE id = ? AND deleted_at IS NOT NULL', id));
      if (op < 0.22 || live.length < 3) {
        const parent = live.length && rnd() < 0.7 ? pick(live) : null;
        const space = parent ? db.get<{ key: string }>('SELECT s.key FROM pages p JOIN spaces s ON s.id = p.space_id WHERE p.id = ?', parent)!.key : pick(spaceKeys);
        const res = await call('anlegen', 'POST', '/api/v1/pages', {
          spaceKey: space,
          parentId: parent,
          title: `${word()} ${step}`,
          content: `<p>${word()} ${word()} Text ${step}</p>`,
          labels: rnd() < 0.5 ? [word(), word()] : [],
          status: rnd() < 0.15 ? 'draft' : 'current',
        });
        if (res.status === 200 || res.status === 201) known.push(res.body.id);
      } else if (op < 0.4) {
        const id = pick(live);
        const target = rnd() < 0.2 ? null : pick(live);
        await call('verschieben', 'POST', `/api/v1/pages/${id}/move`, {
          parentId: target,
          ...(rnd() < 0.4 ? { spaceKey: pick(spaceKeys) } : {}),
          ...(rnd() < 0.4 ? { index: Math.floor(rnd() * 4) } : {}),
        });
      } else if (op < 0.5) {
        const id = pick(live);
        const res = await call('kopieren', 'POST', `/api/v1/pages/${id}/copy`, {
          ...(rnd() < 0.5 ? { spaceKey: pick(spaceKeys) } : {}),
          ...(rnd() < 0.4 ? { parentId: pick(live) } : {}),
          includeChildren: rnd() < 0.6,
        });
        if (res.status === 200 || res.status === 201) known.push(res.body.id);
      } else if (op < 0.62) {
        await call('löschen', 'DELETE', `/api/v1/pages/${pick(live)}`);
      } else if (op < 0.72 && trashed.length) {
        await call('wiederherstellen', 'POST', `/api/v1/pages/${pick(trashed)}/restore`, {});
      } else if (op < 0.76 && trashed.length) {
        await call('endgültig', 'DELETE', `/api/v1/pages/${pick(trashed)}/purge`);
      } else if (op < 0.86) {
        const id = pick(live);
        const page = await call('lesen', 'GET', `/api/v1/pages/${id}`);
        if (page.status === 200) {
          await call('ändern', 'PUT', `/api/v1/pages/${id}`, { title: `${word()} neu ${step}`, content: `<p>${word()} geändert</p>`, version: page.body.version, labels: rnd() < 0.5 ? [word()] : [] });
        }
      } else if (op < 0.92) {
        await call('Beschriftung', 'PUT', `/api/v1/pages/${pick(live)}/labels`, { labels: rnd() < 0.3 ? [] : [word(), word()] });
      } else {
        const res = await call('suchen', 'GET', `/api/v1/search?q=${word()}`);
        if (res.status === 200) {
          for (const hit of res.body.items as { id: number }[]) {
            const p = db.get<{ status: string; deleted_at: string | null }>('SELECT status, deleted_at FROM pages WHERE id = ?', hit.id);
            if (!p || p.deleted_at || p.status !== 'current') problems.push(`Schritt ${step}: Suche liefert nicht sichtbare Seite ${hit.id}`);
          }
        }
      }
      if (step % 10 === 0 || step === STEPS) check(step);
      if (problems.length) break;
    }
    if (problems.length) {
      console.log('PROBLEME:\n' + problems.slice(0, 12).join('\n'));
      console.log('LETZTE SCHRITTE:\n' + log.slice(-6).join('\n'));
    } else {
      console.log(`in Ordnung nach ${STEPS} Schritten, Seiten: ${db.get<{ c: number }>('SELECT COUNT(*) AS c FROM pages')!.c}`);
    }
    assert.equal(problems.length, 0);
  } finally {
    await ctx.close();
  }
});

test('Labels, die keine Seite mehr trägt, verschwinden beim endgültigen Löschen und beim Löschen eines Bereichs', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    // Die Installation bringt eigene Seiten mit Labels mit; hier zählen nur die der Prüfung
    const mine = new Set(['einzel', 'geteilt', 'nur-b']);
    const names = () =>
      ctx.s.db
        .all<{ name: string }>('SELECT name FROM labels ORDER BY name')
        .map((r) => r.name)
        .filter((name) => mine.has(name));
    assert.equal((await admin.post('/api/v1/spaces', { key: 'AAA', name: 'A' })).status, 200);
    assert.equal((await admin.post('/api/v1/spaces', { key: 'BBB', name: 'B' })).status, 200);
    const one = (await admin.post('/api/v1/pages', { spaceKey: 'AAA', title: 'Eins', content: '<p>x</p>', labels: ['einzel', 'geteilt'] })).body.id as number;
    await admin.post('/api/v1/pages', { spaceKey: 'AAA', title: 'Zwei', content: '<p>x</p>', labels: ['geteilt'] });
    await admin.post('/api/v1/pages', { spaceKey: 'BBB', title: 'Drei', content: '<p>x</p>', labels: ['nur-b'] });
    assert.deepEqual(names(), ['einzel', 'geteilt', 'nur-b']);

    assert.equal((await admin.del(`/api/v1/pages/${one}`)).status, 200);
    assert.equal((await admin.del(`/api/v1/pages/${one}/purge`)).status, 200);
    assert.deepEqual(names(), ['geteilt', 'nur-b'], '„einzel“ trägt keine Seite mehr, „geteilt“ noch eine');

    assert.equal((await admin.del('/api/v1/spaces/BBB?confirm=BBB')).status, 200);
    assert.deepEqual(names(), ['geteilt']);
  } finally {
    await ctx.close();
  }
});
