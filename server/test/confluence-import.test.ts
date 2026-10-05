import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, zipSync } from 'fflate';
import { Client, createTestApp } from './helpers.ts';
import { entityObjects } from '../src/modules/transfer/wiki/confluence.ts';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const zip = (files: Record<string, Uint8Array | string>) => Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === 'string' ? strToU8(v) : v]))));
/** CDATA wie Confluence: „]]>“ im Inhalt wird auf zwei Abschnitte verteilt */
const cdata = (text: string) => `<![CDATA[${text.replace(/\]\]>/g, ']]]]><![CDATA[>')}]]>`;

function multipart(fields: Record<string, string>, file: { name: string; data: Buffer }) {
  const boundary = '----knowstead-confluence';
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: application/zip\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

const page = (id: number, title: string, props: string) => `<object class="Page" package="com.atlassian.confluence.pages">
<id name="id">${id}</id>
<property name="title">${cdata(title)}</property>
<property name="lowerTitle">${cdata(title.toLowerCase())}</property>
<property name="space" class="Space" package="com.atlassian.confluence.spaces"><id name="id">100</id></property>
<property name="creator" class="ConfluenceUserImpl" package="com.atlassian.confluence.user"><id name="key">u-1</id></property>
${props}
</object>`;
const body = (id: number, owner: number, storage: string, cls = 'Page') => `<object class="BodyContent" package="com.atlassian.confluence.core">
<id name="id">${id}</id>
<property name="body">${cdata(storage)}</property>
<property name="content" class="${cls}" package="com.atlassian.confluence.pages"><id name="id">${owner}</id></property>
<property name="bodyType">2</property>
</object>`;

const GUIDE = `<h2>Installation</h2>
<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:parameter ac:name="title">Wichtig</ac:parameter><ac:rich-text-body><p>Vorher sichern.</p></ac:rich-text-body></ac:structured-macro>
<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">xml</ac:parameter><ac:plain-text-body><![CDATA[<config value="a]]]]><![CDATA[>b"/>]]></ac:plain-text-body></ac:structured-macro>
<p>Zurück zur <ac:link><ri:page ri:content-title="Start" /><ac:plain-text-link-body><![CDATA[Startseite]]></ac:plain-text-link-body></ac:link>, siehe auch <ac:link><ri:page ri:content-title="Gibt es nicht" /></ac:link>.</p>
<p><ac:image ac:width="300"><ri:attachment ri:filename="bild.png" /></ac:image> <ac:emoticon ac:name="tick" /> Gefragt: <ac:link><ri:user ri:userkey="u-1" /></ac:link></p>
<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>Server bestellt</ac:task-body></ac:task><ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>Einrichten</ac:task-body></ac:task></ac:task-list>
<p>Stand: <ac:structured-macro ac:name="status"><ac:parameter ac:name="colour">Green</ac:parameter><ac:parameter ac:name="title">fertig</ac:parameter></ac:structured-macro></p>
<ac:structured-macro ac:name="expand"><ac:parameter ac:name="title">Details anzeigen</ac:parameter><ac:rich-text-body><p>Ausführlich</p></ac:rich-text-body></ac:structured-macro>
<ac:structured-macro ac:name="gadget"><ac:parameter ac:name="url">x</ac:parameter></ac:structured-macro>
<table><tbody><tr><th>Name</th><th colspan="2">Wert</th></tr><tr><td>A</td><td>1</td><td>2</td></tr></tbody></table>`;

const ENTITIES = `<?xml version="1.0" encoding="UTF-8"?>
<hibernate-generic datetime="2026-01-01 10:00:00">
<object class="Space" package="com.atlassian.confluence.spaces"><id name="id">100</id><property name="key">${cdata('DOC')}</property><property name="name">${cdata('Dokumentation')}</property><property name="homePage" class="Page" package="com.atlassian.confluence.pages"><id name="id">1001</id></property></object>
<object class="ConfluenceUserImpl" package="com.atlassian.confluence.user"><id name="key">u-1</id><property name="name">${cdata('admin')}</property><property name="lowerName">${cdata('admin')}</property></object>
${page(1001, 'Start', '<property name="version">2</property><property name="contentStatus">current</property><property name="position"/><property name="creationDate">2020-01-01 08:00:00.000</property><property name="lastModificationDate">2021-06-01 09:30:00.000</property>')}
${body(5001, 1001, '<p>Willkommen <ac:structured-macro ac:name="children" /></p>')}
${page(2001, 'Start (alt)', `<property name="version">1</property><property name="contentStatus">current</property><property name="originalVersion" class="Page" package="com.atlassian.confluence.pages"><id name="id">1001</id></property><property name="versionComment">${cdata('Erste Fassung')}</property>`)}
${body(5002, 2001, '<p>Alte Fassung</p>')}
${page(1002, 'Anleitung', '<property name="version">1</property><property name="contentStatus">current</property><property name="position">1</property><property name="parent" class="Page" package="com.atlassian.confluence.pages"><id name="id">1001</id></property><collection name="bodyContents" class="java.util.Collection"><element class="BodyContent" package="com.atlassian.confluence.core"><id name="id">5003</id></element></collection>')}
${body(5003, 1002, GUIDE)}
${page(1003, 'Zweite', '<property name="version">1</property><property name="contentStatus">current</property><property name="position">0</property><property name="parent" class="Page" package="com.atlassian.confluence.pages"><id name="id">1001</id></property>')}
${body(5004, 1003, '<p>Die zweite Seite</p>')}
${page(1004, 'Entwurf', '<property name="version">1</property><property name="contentStatus">draft</property>')}
<object class="BlogPost" package="com.atlassian.confluence.pages"><id name="id">1005</id><property name="title">${cdata('Neuigkeiten')}</property><property name="version">1</property><property name="contentStatus">current</property><property name="space" class="Space" package="com.atlassian.confluence.spaces"><id name="id">100</id></property></object>
${body(5005, 1005, '<p>Release 2.0 ist da</p>', 'BlogPost')}
<object class="Attachment" package="com.atlassian.confluence.pages"><id name="id">3001</id><property name="title">${cdata('bild.png')}</property><property name="version">1</property><property name="contentStatus">current</property><property name="containerContent" class="Page" package="com.atlassian.confluence.pages"><id name="id">1002</id></property></object>
<object class="Label" package="com.atlassian.confluence.labels"><id name="id">4001</id><property name="name">${cdata('anleitung')}</property><property name="namespace">${cdata('global')}</property></object>
<object class="Labelling" package="com.atlassian.confluence.labels"><id name="id">4002</id><property name="label" class="Label" package="com.atlassian.confluence.labels"><id name="id">4001</id></property><property name="content" class="Page" package="com.atlassian.confluence.pages"><id name="id">1002</id></property></object>
<object class="Comment" package="com.atlassian.confluence.pages"><id name="id">6001</id></object>
</hibernate-generic>`;

test('Import aus Confluence (XML- und HTML-Export)', async (t) => {
  const ctx = await createTestApp();
  const admin = new Client(ctx.app);
  const run = async (space: string, file: Buffer, fields: Record<string, string>) => {
    const form = multipart(fields, { name: 'export.zip', data: file });
    const res = await admin.request('POST', `/api/v1/spaces/${space}/import/wiki`, form.body, { 'content-type': form.type });
    assert.equal(res.status, 202, res.raw);
    await ctx.s.imports.idle();
    const job = await admin.get(`/api/v1/imports/${res.body.id}`);
    assert.equal(job.body.state, 'done', job.body.error ?? job.raw);
    return job.body.report;
  };
  const tree = async (space: string) => (await admin.get(`/api/v1/spaces/${space}/tree`)).body as { id: number; parentId: number | null; title: string; position: number }[];
  const content = async (id: number) => (await admin.get(`/api/v1/pages/${id}`)).body;

  try {
    await t.test('entities.xml wird CDATA-sicher gelesen', () => {
      const objects = [...entityObjects('<object class="BodyContent"><id name="id">1</id><property name="body"><![CDATA[<p>a</object>b</p>]]></property></object><object class="Space"><id name="id">2</id></object>')];
      assert.equal(objects.length, 2);
      assert.equal(objects[0].props.get('body'), '<p>a</object>b</p>');
      assert.equal(objects[1].id, '2');
    });

    await t.test('Einrichtung', async () => {
      await admin.post('/api/v1/setup', { siteName: 'Test', username: 'admin', displayName: 'Ada', password: 'geheim-geheim', sampleContent: false });
      await admin.post('/api/v1/spaces', { key: 'CONF', name: 'Aus Confluence', preset: 'open' });
      await admin.post('/api/v1/spaces', { key: 'HTML', name: 'Aus HTML', preset: 'open' });
    });

    await t.test('XML-Export: Hierarchie, Reihenfolge, Makros, Anhänge, Versionen, Stichwörter', async () => {
      const report = await run('CONF', zip({ 'entities.xml': ENTITIES, 'exportDescriptor.properties': 'spaceKey=DOC', 'attachments/1002/3001/1': PNG }), { format: 'auto', history: 'true' });
      assert.equal(report.format, 'confluence');
      assert.equal(report.pages, 4, 'Start, Anleitung, Zweite, Blogbeitrag');
      assert.equal(report.attachments, 1);
      assert.equal(report.revisions, 1);
      assert.ok(report.warnings.some((w: string) => /Kommentare/.test(w)));
      assert.ok(report.warnings.some((w: string) => /Entwürfe/.test(w)));
      assert.ok(report.warnings.some((w: string) => /Makros: gadget/.test(w)));

      const pages = await tree('CONF');
      const start = pages.find((p) => p.title === 'Start')!;
      const children = pages.filter((p) => p.parentId === start.id).sort((a, b) => a.position - b.position).map((p) => p.title);
      assert.deepEqual(children, ['Zweite', 'Anleitung'], 'Reihenfolge aus Confluence');
      assert.ok(pages.some((p) => p.title === 'Blog') && pages.some((p) => p.title === 'Neuigkeiten'));
      assert.ok(!pages.some((p) => p.title === 'Entwurf'));

      const guide = await content(pages.find((p) => p.title === 'Anleitung')!.id);
      const html = guide.content as string;
      assert.deepEqual(guide.labels, ['anleitung']);
      assert.match(html, /<div data-type="callout" data-variant="info"><p><strong>Wichtig<\/strong><\/p><p>Vorher sichern.<\/p><\/div>/);
      assert.match(html, /<pre><code class="language-xml">&lt;config value="a\]\]&gt;b"\/&gt;<\/code><\/pre>/, 'Code mit ]]> vollständig');
      assert.match(html, new RegExp(`<a href="/s/CONF/p/${start.id}/[^"]*">Startseite</a>`), 'Seitenlink aufgelöst');
      assert.match(html, /knowstead-missing-link[^>]*>Gibt es nicht</, 'fehlende Seite markiert');
      assert.match(html, /<img src="\/api\/v1\/attachments\/\d+\/raw" alt="bild.png" width="300" ?\/?>/);
      assert.match(html, /✅ Gefragt: <strong>@admin<\/strong>/);
      assert.match(html, /<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Server bestellt<\/p><\/li><li data-type="taskItem" data-checked="false">/);
      assert.match(html, /<span data-type="status" data-color="green">FERTIG<\/span>/);
      assert.match(html, /<details><summary>Details anzeigen<\/summary><div data-type="detailsContent"><p>Ausführlich<\/p><\/div><\/details>/);
      assert.match(html, /Confluence-Makro „gadget“ wurde nicht übernommen/);
      assert.match(html, /<th colspan="2">Wert<\/th>/);

      const revisions = (await admin.get(`/api/v1/pages/${start.id}/revisions`)).body.items as { changeNote: string }[];
      assert.equal(revisions.length, 2);
      assert.ok(revisions.some((v) => /Erste Fassung/.test(v.changeNote)), 'ältere Version übernommen');
      assert.match((await content(start.id)).content, /data-type="children"/);
    });

    await t.test('HTML-Export: Hierarchie aus den Brotkrumen, Makros und Anhänge', async () => {
      const shell = (title: string, crumbs: string, main: string) => `<!DOCTYPE html><html><head><title>Dokumentation : ${title}</title><meta name="generator" content="Confluence"></head><body>
<div id="breadcrumb-section"><ol id="breadcrumbs">${crumbs}</ol></div>
<h1 id="title-heading" class="pagetitle"><span id="title-text"> Dokumentation : ${title} </span></h1>
<div id="main-content" class="wiki-content group">${main}</div></body></html>`;
      const file = zip({
        'DOC/index.html': shell('Dokumentation', '', '<ul><li><a href="Start_1001.html">Start</a></li></ul>'),
        'DOC/Start_1001.html': shell('Start', '<li><a href="index.html">Dokumentation</a></li>', '<p>Hallo</p>'),
        'DOC/Anleitung_1002.html': shell(
          'Anleitung',
          '<li><a href="index.html">Dokumentation</a></li><li><a href="Start_1001.html">Start</a></li>',
          `<div class="confluence-information-macro confluence-information-macro-warning"><div class="confluence-information-macro-body"><p>Achtung</p></div></div>
           <div class="code panel pdl"><div class="codeContent panelContent pdl"><pre class="syntaxhighlighter-pre" data-syntaxhighlighter-params="brush: bash; gutter: false">echo hallo</pre></div></div>
           <p><a href="Start_1001.html">Zum Start</a> <img class="confluence-embedded-image" src="attachments/1002/3001.png" data-image-src="attachments/1002/3001.png"></p>`,
        ),
        'DOC/attachments/1002/3001.png': PNG,
      });
      const report = await run('HTML', file, { format: 'confluence' });
      assert.equal(report.pages, 2);
      assert.equal(report.attachments, 1);
      const pages = await tree('HTML');
      const start = pages.find((p) => p.title === 'Start')!;
      const guide = pages.find((p) => p.title === 'Anleitung')!;
      assert.equal(guide.parentId, start.id);
      const html = (await content(guide.id)).content as string;
      assert.match(html, /data-type="callout" data-variant="error"/);
      assert.match(html, /<pre><code class="language-bash">echo hallo<\/code><\/pre>/);
      assert.match(html, new RegExp(`href="/s/HTML/p/${start.id}/`));
      assert.match(html, /<img src="\/api\/v1\/attachments\/\d+\/raw"/);
    });
  } finally {
    await ctx.close();
  }
});
