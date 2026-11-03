import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { UserRow, SpaceRow } from '../src/core/types.ts';
import { Client, createTestApp } from './helpers.ts';

/**
 * Rollen für viele Bereiche auf einmal (`preloadRoles`) müssen dasselbe ergeben wie die Einzelabfragen (`spaceRole`):
 * Vergleich über zufällig verteilte Rechte an Benutzer, Gruppen, „alle Angemeldeten“ und Anonyme, mit und ohne
 * anonymen Zugriff, mit persönlichem Bereich und für die Administration.
 */
let seed = 20261103;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};
const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];

test('Gebündelte Rollenabfrage ergibt dasselbe wie die Einzelabfragen', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    const db = ctx.s.db;

    const groupIds: number[] = [];
    for (const name of ['Vertrieb', 'Technik', 'Einkauf']) {
      const res = await admin.post('/api/v1/admin/groups', { name, description: '' });
      assert.equal(res.status, 200, res.raw);
      groupIds.push(res.body.id);
    }
    const userIds: number[] = [];
    for (let i = 0; i < 6; i++) {
      const groups = groupIds.filter(() => rnd() < 0.4);
      const res = await admin.post('/api/v1/admin/users', { username: `u${i}`, displayName: `Person ${i}`, password: 'geheim-geheim', email: `u${i}@example.com`, groupIds: groups });
      assert.equal(res.status, 200, res.raw);
      userIds.push(res.body.id);
    }
    const spaceIds: number[] = [];
    for (let i = 0; i < 14; i++) {
      const res = await admin.post('/api/v1/spaces', { key: `S${i}`, name: `Bereich ${i}` });
      assert.equal(res.status, 200, res.raw);
      spaceIds.push(res.body.id);
    }
    // Ein persönlicher Bereich gehört einer Person und ist für sie immer Verwaltung
    db.run("UPDATE spaces SET kind = 'personal', owner_id = ? WHERE id = ?", userIds[0], spaceIds[0]);

    const roles = ['viewer', 'commenter', 'editor', 'admin'];
    const regrant = () => {
      db.run('DELETE FROM space_permissions');
      for (const spaceId of spaceIds) {
        const add = (type: string, subjectId: number) => {
          if (rnd() < 0.3) db.run('INSERT OR REPLACE INTO space_permissions (space_id, subject_type, subject_id, role) VALUES (?, ?, ?, ?)', spaceId, type, subjectId, pick(roles));
        };
        add('authenticated', 0);
        add('anonymous', 0);
        for (const id of userIds) add('user', id);
        for (const id of groupIds) add('group', id);
      }
    };

    const allSpaces = () => db.all<SpaceRow>('SELECT * FROM spaces');
    const contexts = () => [
      { name: 'anonym', make: () => ctx.s.perms.anonymous() },
      { name: 'admin', make: () => ctx.s.perms.forUser(db.get<UserRow>("SELECT * FROM users WHERE username = 'admin'")!) },
      ...userIds.map((id) => ({ name: `Benutzer ${id}`, make: () => ctx.s.perms.forUser(db.get<UserRow>('SELECT * FROM users WHERE id = ?', id)!) })),
    ];

    let compared = 0;
    for (const anonymousAccess of [false, true]) {
      assert.equal((await admin.put('/api/v1/admin/settings', { anonymousAccess })).status, 200);
      for (let round = 0; round < 12; round++) {
        regrant();
        const spaces = allSpaces();
        for (const { name, make } of contexts()) {
          const single = make();
          const expected = spaces.map((s) => ctx.s.perms.spaceRole(single, s));
          const bundled = make();
          ctx.s.perms.preloadRoles(bundled, spaces);
          const actual = spaces.map((s) => ctx.s.perms.spaceRole(bundled, s));
          assert.deepEqual(actual, expected, `${name}, anonymer Zugriff ${anonymousAccess}, Runde ${round}`);
          // Auch die Liste der lesbaren Bereiche und eine Teilmenge (weniger als drei Bereiche: Einzelabfrage)
          assert.deepEqual(ctx.s.perms.viewableSpaceIds(make()), ctx.s.perms.viewableSpaceIds(single));
          const few = make();
          ctx.s.perms.preloadRoles(few, spaces.slice(0, 2));
          assert.deepEqual(spaces.map((s) => ctx.s.perms.spaceRole(few, s)), expected);
          compared += spaces.length;
        }
      }
    }
    assert.ok(compared > 2000, 'es wurde wirklich verglichen');
  } finally {
    await ctx.close();
  }
});
