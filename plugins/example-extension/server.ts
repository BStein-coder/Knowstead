/**
 * Plugin „Beispiel-Erweiterung“ – Serverteil.
 *
 * Zeigt die drei Bausteine eines Server-Plugins:
 *  1. eigene REST-Route mit Rechteprüfung (`/api/v1/plugins/example-extension/stats/:id`),
 *  2. ein Ereignis-Abonnement mit Plugin-Speicher,
 *  3. einen `page.beforeSave`-Filter, der ein Seiten-Merkmal ergänzt.
 *
 * Ausführlich erklärt in docs/PLUGINS.md.
 */
import type { PluginRegister } from '../../server/src/plugins/types.ts';

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

const countWords = (text: string): number => (text.match(WORD_RE) ?? []).length;

const register: PluginRegister = (ctx) => {
  /* 1. Eigene Route: Statistik zu einer Seite (nur für Leseberechtigte). */
  ctx.routes.get('/stats/:id', (req) => {
    const row = req.user ? ctx.services.users.get(req.user.id) : undefined;
    const auth = row ? ctx.services.perms.forUser(row) : ctx.services.perms.anonymous();
    const { page } = ctx.services.pages.requireViewable(auth, Number(req.params.id));
    const words = countWords(page.content_text ?? '');
    const headings = (page.content.match(/<h[1-4][\s>]/gi) ?? []).length;
    const links = ctx.services.db.value<number>('SELECT COUNT(*) FROM page_links WHERE source_id = ?', page.id) ?? 0;
    const contributors = ctx.services.db.all<{ id: number; name: string; edits: number }>(
      `SELECT u.id, u.display_name AS name, COUNT(*) AS edits
         FROM page_revisions r JOIN users u ON u.id = r.author_id
        WHERE r.page_id = ? GROUP BY u.id ORDER BY edits DESC LIMIT 5`,
      page.id,
    );
    return {
      pageId: page.id,
      words,
      characters: (page.content_text ?? '').length,
      headings,
      links,
      version: page.version,
      updatedAt: page.updated_at,
      minutes: Math.max(1, Math.round(words / Math.max(60, ctx.settings.get<number>('wpm') || 220))),
      contributors,
    };
  });

  /* 2. Ereignisse zählen und im Plugin-Speicher ablegen. */
  ctx.events.on('page.*', (event) => {
    const key = `count:${event.type}`;
    ctx.storage.set(key, (ctx.storage.get<number>(key, 0) ?? 0) + 1);
  });

  ctx.routes.get('/counters', () => ({
    counters: ctx.storage.list('count:').map((e) => ({ type: e.key.slice(6), count: e.value })),
  }));

  /* 3. Filter: Beim Speichern die Wortzahl als Seiteneigenschaft bereitstellen. */
  ctx.hooks.addFilter<{ title: string; content: string; contentType: string }>('page.beforeSave', (value) => {
    ctx.storage.set('lastSavedWords', countWords(value.content.replace(/<[^>]+>/g, ' ')));
    return value;
  });

  ctx.log.info('Beispiel-Erweiterung bereit – Route /api/v1/plugins/example-extension/stats/:id');
};

export default register;
