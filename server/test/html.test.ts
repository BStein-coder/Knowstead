import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText } from '../src/core/html.ts';
import { Client, createTestApp } from './helpers.ts';

test('Klartext aus Codeblöcken ohne HTML-Markup', () => {
  const text = htmlToText('<h2>Technik</h2><pre><code class="language-javascript">const a = 1 &lt; 2 &amp;&amp; b;\n<span class="x">log</span>(a);</code></pre><p>Danach &amp; weiter</p>');
  assert.equal(text, 'Technik\nconst a = 1 < 2 && b;\nlog(a);\nDanach & weiter');
});

test('Suchtexte werden nach einem Update einmalig neu berechnet', async () => {
  const ctx = await createTestApp();
  try {
    const admin = new Client(ctx.app);
    await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
    await admin.post('/api/v1/spaces', { key: 'CODE', name: 'Code', preset: 'open' });
    const page = await admin.post('/api/v1/pages', { spaceKey: 'CODE', title: 'Beispiel', content: '<pre><code class="language-javascript">const antwort = 42;</code></pre>' });
    assert.equal(page.status, 200, page.raw);
    assert.equal(ctx.s.db.value('SELECT content_text FROM pages WHERE id = ?', page.body.id), 'const antwort = 42;');

    // Stand einer älteren Version simulieren: Markup im Suchtext, Ableitung veraltet
    ctx.s.db.run('UPDATE pages SET content_text = ?, excerpt = ? WHERE id = ?', '<code class="language-javascript">const antwort = 42;</code>', '<code>…', page.body.id);
    ctx.s.search.reindexAll();
    ctx.s.settings.setInternal('search:textVersion', 1);

    assert.ok(ctx.s.search.refreshDerivedText() > 0);
    assert.equal(ctx.s.db.value('SELECT excerpt FROM pages WHERE id = ?', page.body.id), 'const antwort = 42;');
    const hits = await admin.get('/api/v1/search?q=antwort&space=CODE');
    assert.equal(hits.body.total, 1);
    assert.equal((await admin.get('/api/v1/search?q=language&space=CODE')).body.total, 0, 'kein Markup mehr im Index');
    assert.equal(ctx.s.search.refreshDerivedText(), 0, 'nur einmal');
  } finally {
    await ctx.close();
  }
});
