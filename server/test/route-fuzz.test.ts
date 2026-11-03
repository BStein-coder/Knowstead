import test from 'node:test';
import assert from 'node:assert/strict';
import { Client, createTestApp } from './helpers.ts';

/**
 * Alle Routen der Schnittstelle (aus der OpenAPI-Beschreibung) mit passenden, falschen und überlangen Werten für
 * Pfad, Abfrage und Inhalt – angemeldet als Administration und anonym. Keine Anfrage darf mit 5xx enden oder eine
 * Ausnahme werfen; ungültige Eingaben sind Fehler der Anfrage (4xx). Gleicher Startwert = gleiche Anfragen; für die
 * Fehlersuche: `FUZZ_SEED=7 node --test …`.
 */
let seed = Number(process.env.FUZZ_SEED ?? 12345);
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pickOf = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];

/** Abmelden, Einrichtung, Wiederherstellung usw. würden die Testinstanz selbst verändern oder beenden. */
const SKIP = /logout|\/setup|restore|shutdown|password|\/auth\/|update-check|\/docs|\/backup/i;

type Json = Record<string, any>;

test('Keine Route der Schnittstelle antwortet bei falschen Eingaben mit einem Serverfehler', { timeout: 600000 }, async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: true });
    const spec = (ctx.app as any).swagger() as Json;
    const resolve = (schema: Json | undefined, depth = 0): Json => {
      if (!schema || depth > 6) return {};
      if (schema.$ref) {
        const name = String(schema.$ref).split('/').pop()!;
        return resolve(spec.components?.schemas?.[name], depth + 1);
      }
      return schema;
    };
    const value = (schema: Json | undefined, depth = 0): unknown => {
      const sc = resolve(schema, depth);
      if (sc.enum) return pickOf(sc.enum);
      if (sc.anyOf) return value(pickOf(sc.anyOf), depth + 1);
      if (sc.oneOf) return value(pickOf(sc.oneOf), depth + 1);
      switch (sc.type) {
        case 'string':
          if (sc.format === 'email') return 'a@example.com';
          if (sc.format === 'date-time') return new Date().toISOString();
          return pickOf(['a', 'Test', '2026-01-01', 'x'.repeat(300), '<script>alert(1)</script>', '', '%', '{{}}', '../../etc/passwd', 'ä\u0000b']);
        case 'integer':
        case 'number':
          return pickOf([0, 1, 2, 3, -1, 99999999999, 1.5]);
        case 'boolean':
          return rnd() > 0.5;
        case 'array':
          return depth > 4 ? [] : [value(sc.items, depth + 1), value(sc.items, depth + 1)];
        case 'object':
        default: {
          const out: Json = {};
          const props = sc.properties ?? {};
          for (const [k, v] of Object.entries<Json>(props)) if ((sc.required ?? []).includes(k) || rnd() > 0.4) out[k] = value(v, depth + 1);
          return out;
        }
      }
    };
    const wrong = (): unknown =>
      pickOf<unknown>([null, 'text', 42, [], [[]], { a: { b: { c: [1, 2, { d: null }] } } }, true, -1, 'x'.repeat(100000), Array.from({ length: 2000 }, (_, i) => i), { __proto__: { x: 1 } }, { constructor: { prototype: 1 } }]);

    // Pool bekannter Nummern und Schlüssel aus den Beispieldaten
    const db = ctx.s.db;
    const pools: Record<string, (string | number)[]> = {
      pageId: db.all<{ id: number }>('SELECT id FROM pages LIMIT 12').map((r) => r.id),
      spaceId: db.all<{ id: number }>('SELECT id FROM spaces').map((r) => r.id),
      spaceKey: db.all<{ key: string }>('SELECT key FROM spaces').map((r) => r.key),
      userId: db.all<{ id: number }>('SELECT id FROM users LIMIT 5').map((r) => r.id),
    };
    const junk = ['0', '-1', '99999999999', 'abc', '%00', '..%2f..', 'x'.repeat(400), '1e3', '1.5', ' ', '%'];
    const paramValue = (name: string): string => {
      if (rnd() < 0.3) return pickOf(junk);
      const n = name.toLowerCase();
      if (n.includes('key')) return String(pickOf(pools.spaceKey));
      if (n.includes('space')) return String(pickOf([...pools.spaceId, ...pools.spaceKey]));
      if (n.includes('user')) return String(pickOf(pools.userId));
      return String(pickOf([...pools.pageId, ...pools.spaceId, 1, 2, 3]));
    };

    const failures = new Map<string, { status: number; sample: string; count: number }>();
    let total = 0;
    const clients: [string, () => Client][] = [
      ['admin', () => admin],
      ['anonym', () => new Client(ctx.app)],
    ];
    for (const [who, make] of clients) {
      for (const [path, ops] of Object.entries<Json>(spec.paths)) {
        if (SKIP.test(path)) continue;
        for (const [method, op] of Object.entries<Json>(ops)) {
          if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue;
          const params: Json[] = op.parameters ?? [];
          const bodySchema = op.requestBody?.content?.['application/json']?.schema;
          for (let round = 0; round < 6; round++) {
            let url = path.replace(/\{(\w+)\}/g, (_, name) => {
              const raw = paramValue(name);
              return raw.includes('%') ? raw.replace(/%(?![0-9a-f]{2})/gi, '%25') : encodeURIComponent(raw);
            });
            const query: string[] = [];
            for (const p of params) {
              if (p.in !== 'query') continue;
              if (!p.required && rnd() > 0.5) continue;
              const v = rnd() < 0.3 ? wrong() : value(p.schema);
              query.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(typeof v === 'object' ? JSON.stringify(v) : String(v))}`);
            }
            if (query.length) url += `?${query.join('&')}`;
            let body: unknown;
            if (method !== 'get' && method !== 'delete') body = bodySchema ? (rnd() < 0.35 ? wrong() : value(bodySchema)) : {};
            total++;
            try {
              const res = await make().request(method.toUpperCase(), url, body);
              if (res.status >= 500) {
                const key = `${who} ${method.toUpperCase()} ${path}`;
                const f = failures.get(key) ?? { status: res.status, sample: `${url.slice(0, 160)} ${JSON.stringify(body)?.slice(0, 200)} → ${res.raw.slice(0, 200)}`, count: 0 };
                f.count++;
                failures.set(key, f);
              }
            } catch (e) {
              const key = `${who} ${method.toUpperCase()} ${path} (Ausnahme)`;
              const f = failures.get(key) ?? { status: 0, sample: `${url.slice(0, 160)} → ${String(e).slice(0, 300)}`, count: 0 };
              f.count++;
              failures.set(key, f);
            }
          }
        }
      }
    }
    const report = [...failures].map(([key, f]) => `[${f.status}] ${f.count}× ${key}\n    ${f.sample}`).join('\n');
    assert.equal(failures.size, 0, `${failures.size} Routen mit Serverfehler (${total} Anfragen):\n${report}`);
    assert.ok(total > 1000, 'es wurden Anfragen gestellt');
  } finally {
    await ctx.close();
  }
});
