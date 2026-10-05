import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToMarkdown, markdownToHtml } from '../src/core/markdown.ts';
import { htmlDiff, lineDiff } from '../src/core/diff.ts';
import { sanitizeRichText } from '../src/core/html.ts';
import { parseQuery, buildFtsQuery } from '../src/modules/search/service.ts';
import { fillPlaceholders } from '../src/modules/templates/service.ts';

test('Markdown → Editor-HTML', () => {
  const html = markdownToHtml('Text\n\n<!-- toc -->\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n```js\nconst a = 1 < 2;\n```\n\n> [!WARNING]\n> Achtung\n\n- [ ] offen\n- [x] fertig\n');
  assert.ok(html.includes('<div data-type="toc"></div>'));
  assert.ok(html.includes('data-type="mermaid"'));
  assert.ok(html.includes('A --&gt; B'), 'Mermaid-Code bleibt escaped im Attribut');
  assert.ok(html.includes('class="language-js"'));
  assert.ok(html.includes('data-variant="warning"'));
  assert.ok(html.includes('data-checked="true"'));
});

test('HTML → Markdown mit Makros', () => {
  const md = htmlToMarkdown(
    '<h2>Titel</h2><div data-type="callout" data-variant="warning"><p>Vorsicht</p></div><ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked></label><div><p>Erledigt</p></div></li></ul><div data-type="mermaid" data-code="graph TD; A--&gt;B"></div>',
  );
  assert.ok(md.includes('## Titel'));
  assert.ok(md.includes('> [!WARNING]'));
  assert.ok(md.includes('- [x] Erledigt'));
  assert.ok(md.includes('```mermaid'));
});

test('Sanitizer entfernt gefährliche Inhalte', () => {
  const out = sanitizeRichText('<p onclick="x()">Hi<script>alert(1)</script><a href="javascript:alert(1)">x</a><img src="x" onerror="y()"></p><iframe src="https://evil.example.com"></iframe>', ['www.youtube.com']);
  assert.ok(!out.includes('script'));
  assert.ok(!out.includes('onclick'));
  assert.ok(!out.includes('onerror'));
  assert.ok(!out.includes('javascript:'));
  assert.ok(!out.includes('evil.example.com'));
  const keep = sanitizeRichText('<div data-type="callout" data-variant="info"><p style="text-align: center; position: fixed">ok</p></div>', []);
  assert.ok(keep.includes('data-variant="info"'));
  assert.ok(keep.includes('text-align:center'));
  assert.ok(!keep.includes('position'));
});

test('Diff', () => {
  const d = htmlDiff('<p>Hallo Welt</p>', '<p>Hallo schöne Welt</p>');
  assert.match(d?.html ?? '', /<ins class="knowstead-diff-ins">schöne\s*<\/ins>/);
  assert.equal(d?.stats.added, 1);
  const l = lineDiff('a\nb\nc', 'a\nc\nd');
  assert.deepEqual(
    l.lines.map((x) => x.type),
    ['equal', 'del', 'equal', 'add'],
  );
});

test('Suchsyntax', () => {
  const p = parseQuery('backup "genaue phrase" -test space:dev label:Anleitung #status=erledigt #prio>2 author:@max in:title');
  assert.deepEqual(p.terms, ['backup']);
  assert.deepEqual(p.phrases, ['genaue phrase']);
  assert.deepEqual(p.excluded, ['test']);
  assert.deepEqual(p.space, ['DEV']);
  assert.deepEqual(p.labels, ['anleitung']);
  assert.deepEqual(p.authors, ['max']);
  assert.equal(p.props.length, 2);
  assert.equal(p.props[1].op, '>');
  assert.equal(p.inTitle, true);
  assert.equal(buildFtsQuery(parseQuery('a b')), '"a"* "b"*');
  assert.equal(buildFtsQuery(parseQuery('a -b')), '("a"*) NOT "b"');
});

test('Vorlagen-Platzhalter', () => {
  const d = new Date(2026, 8, 11, 14, 5);
  const out = fillPlaceholders('{{datum}} {{isodatum}} {{kw}} {{wochentag}} {{benutzer}} {{unbekannt}}', { user: { id: 1, displayName: 'Ada', username: 'ada' }, date: d });
  assert.equal(out, '11.09.2026 2026-09-11 37 Freitag Ada {{unbekannt}}');
});
