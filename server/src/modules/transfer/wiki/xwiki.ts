/**
 * XWiki-Import: XAR-Paket (Export aus „Administration → Inhalt → Export“).
 * Verschachtelte Seiten werden zur Hierarchie, Anhänge zu Anhängen der jeweiligen
 * Seite und Tags (XWiki.TagClass) zu Stichwörtern. Unterstützt XWiki-Syntax 2.x,
 * HTML und Markdown; Skript-Makros (Velocity, Groovy …) werden nur vermerkt.
 */
import { markdownToHtml } from '../../../core/markdown.ts';
import type { ArchiveEntries } from '../../../core/archive-entries.ts';
import {
  Protector,
  applyTagMarks,
  buildList,
  buildTable,
  callout,
  codeBlock,
  decodeXml,
  emptyResult,
  escapeHtml,
  isImage,
  isoDate,
  lazyMedia,
  mediaSrc,
  normalizeSource,
  tagMark,
  wikiHref,
  xmlChild,
  xmlElements,
  type ListItem,
  type TableCell,
  type WikiParseResult,
} from './common.ts';

const TEXT = new TextDecoder('utf-8');
/** Größte Seitendatei eines XAR-Pakets (samt eingebetteter Anhänge), die gelesen wird */
const MAX_DOCUMENT_BYTES = 256 * 1024 * 1024;
const TECHNICAL_SPACES = new Set(['XWiki', 'Panels', 'Scheduler', 'Stats', 'Invitation', 'AnnotationCode', 'ColorThemes', 'FlamingoThemes', 'SkinsCode', 'IconThemes', 'Mail', 'Help', 'AppWithinMinutes', 'Dashboard', 'XAppMenu']);

export interface XWikiOptions {
  includeTechnical?: boolean;
}

export function isXWikiArchive(entries: ArchiveEntries): boolean {
  if (entries.has('package.xml') && /<package[\s>]/.test(TEXT.decode(entries.head('package.xml', 2000)))) return true;
  return entries.names().some((name) => name.endsWith('.xml') && /<xwikidoc[\s>]/.test(TEXT.decode(entries.head(name, 600))));
}

/** Anhang aus dem XML einer Seite lösen (Base64 im Element <attachment>). */
function attachmentContent(xml: string, filename: string): Uint8Array {
  for (const attachment of xmlElements(xml, 'attachment')) {
    if (xmlChild(attachment.inner, 'filename') !== filename) continue;
    const base64 = attachment.inner.match(/<content>([\s\S]*?)<\/content>/)?.[1];
    if (base64) return Buffer.from(base64.replace(/\s+/g, ''), 'base64');
  }
  return new Uint8Array();
}

/** Referenz an nicht maskierten Punkten teilen („A\.B.C“ → ["A.B", "C"]). */
export function splitReference(ref: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (let i = 0; i < ref.length; i++) {
    if (ref[i] === '\\' && i + 1 < ref.length) {
      current += ref[i + 1];
      i++;
    } else if (ref[i] === '.') {
      parts.push(current);
      current = '';
    } else current += ref[i];
  }
  parts.push(current);
  return parts.filter((p) => p !== '');
}

export interface XwConvertContext {
  /** Bereichs-Segmente des aktuellen Dokuments */
  space: string[];
  docKey: string;
  resolveDoc: (reference: string) => string;
}

const MACRO_CALLOUTS: Record<string, 'info' | 'warning' | 'error' | 'success' | 'note'> = {
  info: 'info',
  warning: 'warning',
  error: 'error',
  success: 'success',
  box: 'note',
  note: 'note',
};

const SCRIPT_MACROS = new Set(['velocity', 'groovy', 'python', 'script', 'ruby', 'php', 'include', 'display', 'content', 'livetable', 'liveData', 'query', 'activity', 'dashboard', 'gadget']);

/** Parameter wie `language="java" title='x'` lesen. */
function macroParams(raw: string): Record<string, string> {
  const params: Record<string, string> = {};
  for (const m of raw.matchAll(/([\w.-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(\S+))/g)) {
    params[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').replace(/\\(.)/g, '$1');
  }
  return params;
}

export function xwikiToHtml(source: string, ctx: XwConvertContext, nested = false): string {
  const protect = new Protector();
  const blocks = new Set<string>();
  const footnotes: string[] = [];

  const blockToken = (html: string) => {
    const token = protect.put(html);
    blocks.add(token);
    return `\n${token}\n`;
  };

  let text = nested ? source : normalizeSource(source);
  text = text.replace(/\{\{\{([\s\S]*?)\}\}\}/g, (_, verbatim: string) => (verbatim.includes('\n') ? blockToken(codeBlock(verbatim)) : protect.put(`<code>${escapeHtml(verbatim)}</code>`)));
  text = text.replace(/~(.)/g, (_, char: string) => protect.put(escapeHtml(char)));

  // Makros: {{name …/}} und {{name …}}Inhalt{{/name}} (von innen nach außen)
  for (let round = 0; round < 8; round++) {
    const before = text;
    text = text.replace(/\{\{([\w.-]+)((?:\s[^}]*?)?)\s*\/\}\}/g, (_, name: string, params: string) => macro(name, macroParams(params), null));
    text = text.replace(/\{\{([\w.-]+)((?:\s[^}]*?)?)\}\}((?:(?!\{\{\1[\s}])[\s\S])*?)\{\{\/\1\}\}/g, (_, name: string, params: string, body: string) =>
      macro(name, macroParams(params), body),
    );
    if (text === before) break;
  }
  text = text.replace(/\(%[\s\S]*?%\)/g, '');

  function macro(rawName: string, params: Record<string, string>, body: string | null): string {
    const name = rawName.toLowerCase();
    if (name === 'code') {
      const code = (body ?? '').replace(/^\n|\n$/g, '');
      // Steht der Inhalt auf eigenen Zeilen, ist es ein Codeblock
      return (body ?? '').includes('\n') || body === null ? blockToken(codeBlock(code, params.language ?? params.lang)) : protect.put(`<code>${escapeHtml(code)}</code>`);
    }
    if (name === 'html') return blockToken(body ?? '');
    if (name === 'toc') return blockToken('<div data-type="toc"></div>');
    if (name === 'children' || name === 'documenttree' || name === 'tree') return blockToken('<div data-type="children" data-depth="2"></div>');
    if (name === 'formula' || name === 'mathjax' || name === 'latex') return blockToken(`<div data-type="block-math" data-latex="${escapeHtml((body ?? '').trim())}"></div>`);
    if (name === 'id' || name === 'comment' || name === 'putfootnotes') return '';
    if (name === 'footnote') {
      footnotes.push(body ?? '');
      return protect.put(`<sup>[${footnotes.length}]</sup>`);
    }
    if (MACRO_CALLOUTS[name]) {
      const inner = body !== null ? xwikiToHtml(body.trim(), ctx, true) : escapeHtml(params.title ?? '');
      return blockToken(callout(MACRO_CALLOUTS[name], params.title ? `<p><strong>${escapeHtml(params.title)}</strong></p>${inner}` : inner));
    }
    if (name === 'include' || name === 'display') {
      const ref = params.reference ?? params.document ?? params.page ?? '';
      return ref ? blockToken(`<p><em>Eingebunden: <a href="${wikiHref(ctx.resolveDoc(ref))}">${escapeHtml(ref)}</a></em></p>`) : '';
    }
    if (SCRIPT_MACROS.has(name) || body === null) return blockToken(`<p><em>[Makro „${escapeHtml(rawName)}“ nicht übernommen]</em></p>`);
    // Unbekannte Container-Makros: Inhalt übernehmen
    return blockToken(xwikiToHtml(body.trim(), ctx, true));
  }

  function reference(raw: string): { kind: 'url' | 'mail' | 'doc' | 'attach'; value: string } {
    const ref = raw.trim();
    if (/^url:/i.test(ref)) return { kind: 'url', value: ref.slice(4) };
    if (/^(https?|ftp):\/\//i.test(ref)) return { kind: 'url', value: ref };
    if (/^mailto:/i.test(ref)) return { kind: 'mail', value: ref };
    if (/^attach:/i.test(ref)) {
      const target = ref.slice(7);
      const at = target.lastIndexOf('@');
      return { kind: 'attach', value: at >= 0 ? `${ctx.resolveDoc(target.slice(0, at))}@${target.slice(at + 1)}` : `${ctx.docKey}@${target}` };
    }
    return { kind: 'doc', value: ctx.resolveDoc(ref) };
  }

  function image(raw: string, paramText: string): string {
    const params = macroParams(paramText);
    const ref = raw.trim();
    const width = params.width?.replace(/px$/, '');
    const size = width && /^\d+$/.test(width) ? ` width="${width}"` : '';
    if (/^(https?):\/\//i.test(ref)) return `<img src="${escapeHtml(ref)}" alt="${escapeHtml(params.alt ?? '')}"${size}>`;
    const at = ref.lastIndexOf('@');
    const key = at >= 0 ? `${ctx.resolveDoc(ref.slice(0, at))}@${ref.slice(at + 1)}` : `${ctx.docKey}@${ref}`;
    const name = key.slice(key.lastIndexOf('@') + 1);
    return isImage(name) ? `<img src="${mediaSrc(key)}" alt="${escapeHtml(params.alt ?? name)}"${size}>` : `<a href="${mediaSrc(key)}">${escapeHtml(name)}</a>`;
  }

  function link(body: string): string {
    const [main, paramText = ''] = body.split('||');
    if (/^image:/i.test(main.trim())) return image(main.trim().slice(6), paramText);
    const arrow = main.lastIndexOf('>>');
    const labelRaw = arrow >= 0 ? main.slice(0, arrow) : '';
    const target = reference(arrow >= 0 ? main.slice(arrow + 2) : main);
    const label = labelRaw ? inline(labelRaw) : '';
    switch (target.kind) {
      case 'url':
        return `<a href="${escapeHtml(target.value)}">${label || escapeHtml(target.value)}</a>`;
      case 'mail':
        return `<a href="${escapeHtml(target.value)}">${label || escapeHtml(target.value.replace(/^mailto:/i, ''))}</a>`;
      case 'attach':
        return `<a href="${mediaSrc(target.value)}">${label || escapeHtml(target.value.slice(target.value.lastIndexOf('@') + 1))}</a>`;
      default:
        return `<a href="${wikiHref(target.value)}">${label || escapeHtml(target.value.split('/').pop() ?? target.value)}</a>`;
    }
  }

  function inline(raw: string): string {
    let s = raw;
    s = s.replace(/##(.+?)##/g, (_, code: string) => protect.put(`<code>${escapeHtml(code)}</code>`));
    for (let round = 0; round < 3 && /\[\[/.test(s); round++) {
      s = s.replace(/\[\[((?:(?!\[\[|\]\])[\s\S])+)\]\]/g, (_, body: string) => protect.put(link(body)));
    }
    s = s.replace(/(^|\s)image:([^\s|]+\.[a-z0-9]{2,5})/gi, (_, lead: string, ref: string) => `${lead}${protect.put(image(ref, ''))}`);
    s = s.replace(/(^|[\s(])((?:https?|ftp):\/\/[^\s<>[\]"']+[^\s<>[\]"'.,;:!?)])/g, (_, lead: string, url: string) => `${lead}${protect.put(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`)}`);
    s = s.replace(/\*\*(.+?)\*\*/g, `${tagMark('strong')}$1${tagMark('/strong')}`);
    s = s.replace(/\/\/(.+?)\/\//g, `${tagMark('em')}$1${tagMark('/em')}`);
    s = s.replace(/__(.+?)__/g, `${tagMark('u')}$1${tagMark('/u')}`);
    s = s.replace(/--(.+?)--/g, `${tagMark('s')}$1${tagMark('/s')}`);
    s = s.replace(/\^\^(.+?)\^\^/g, `${tagMark('sup')}$1${tagMark('/sup')}`);
    s = s.replace(/,,(.+?),,/g, `${tagMark('sub')}$1${tagMark('/sub')}`);
    s = applyTagMarks(escapeHtml(s));
    return s.replace(/\\\\/g, '<br>');
  }

  /* ------------------------------ Blöcke ------------------------------ */

  const out: string[] = [];
  let paragraph: string[] = [];
  let list: ListItem[] = [];
  let quote: string[] = [];
  let table: string[] = [];

  const flush = () => {
    if (paragraph.length) out.push(`<p>${paragraph.map((l) => inline(l)).join('<br>')}</p>`);
    paragraph = [];
    if (list.length) out.push(buildList(list));
    list = [];
    if (quote.length) out.push(`<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join('')}</blockquote>`);
    quote = [];
    if (table.length) out.push(parseTable(table));
    table = [];
  };

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (blocks.has(trimmed)) {
      flush();
      out.push(trimmed);
      continue;
    }
    if (!trimmed) {
      flush();
      continue;
    }
    const heading = trimmed.match(/^(={1,6})\s*(.+?)\s*=*$/);
    if (heading) {
      flush();
      out.push(`<h${heading[1].length}>${inline(heading[2])}</h${heading[1].length}>`);
      continue;
    }
    if (/^-{4,}$/.test(trimmed)) {
      flush();
      out.push('<hr>');
      continue;
    }
    if (/^\|/.test(trimmed)) {
      if (!table.length) flush();
      table.push(trimmed);
      continue;
    }
    const item = trimmed.match(/^([*1]+)(\.?)\s+(.*)$/);
    if (item && (item[2] === '.' || !item[1].includes('1'))) {
      if (!list.length) flush();
      const ordered = item[2] === '.' && item[1].endsWith('1');
      list.push({ depth: item[1].length, kind: ordered ? 'ol' : 'ul', html: inline(item[3]) });
      continue;
    }
    const definition = trimmed.match(/^([;:])\s*(.*)$/);
    if (definition) {
      flush();
      out.push(definition[1] === ';' ? `<p><strong>${inline(definition[2])}</strong></p>` : `<blockquote><p>${inline(definition[2])}</p></blockquote>`);
      continue;
    }
    const q = trimmed.match(/^>+\s?(.*)$/);
    if (q) {
      if (!quote.length) flush();
      quote.push(q[1]);
      continue;
    }
    if (list.length || quote.length || table.length) flush();
    paragraph.push(trimmed);
  }
  flush();
  if (footnotes.length) out.push('<hr>', `<ol>${footnotes.map((f) => `<li><p>${inline(f)}</p></li>`).join('')}</ol>`);

  function parseTable(rows: string[]): string {
    const result: TableCell[][] = [];
    for (const row of rows) {
      const cells: string[] = [];
      let depth = 0;
      let current: string | null = null;
      for (let i = 0; i < row.length; i++) {
        const two = row.slice(i, i + 2);
        if (two === '[[' || two === '{{') {
          depth++;
          current = (current ?? '') + two;
          i++;
        } else if ((two === ']]' || two === '}}') && depth) {
          depth--;
          current = (current ?? '') + two;
          i++;
        } else if (row[i] === '|' && !depth) {
          if (current !== null) cells.push(current);
          current = '';
        } else current = (current ?? '') + row[i];
      }
      if (current !== null && current.trim()) cells.push(current);
      result.push(cells.map((cell) => (cell.startsWith('=') ? { header: true, html: inline(cell.slice(1).trim()) } : { header: false, html: inline(cell.trim()) })));
    }
    return buildTable(result);
  }

  return protect.restore(out.join('\n'));
}

/* ------------------------------ Import ------------------------------ */

interface RawDoc {
  /** Bereich (bei verschachtelten Seiten die Seite selbst) */
  web: string[];
  segments: string[];
  key: string;
  title: string;
  syntax: string;
  content: string;
  creator: string | null;
  author: string | null;
  created: string | null;
  updated: string | null;
  tags: string[];
}

const userName = (ref: string | null) => (ref ? (ref.split('.').pop() ?? ref).replace(/^XWiki\./, '') : null);

export function parseXWiki(entries: ArchiveEntries, options: XWikiOptions = {}): WikiParseResult {
  const result = emptyResult('xwiki');
  const docs: RawDoc[] = [];
  for (const name of entries.names()) {
    if (!name.endsWith('.xml') || name === 'package.xml') continue;
    let xml = TEXT.decode(entries.read(name, MAX_DOCUMENT_BYTES));
    if (!/<xwikidoc[\s>]/.test(xml)) continue;
    const web = xmlChild(xml, 'web') ?? '';
    const pageName = xmlChild(xml, 'name') ?? '';
    const locale = (xml.match(/<xwikidoc[^>]*\slocale="([^"]*)"/)?.[1] ?? xmlChild(xml, 'language') ?? '').trim();
    const segmentsWeb = splitReference(web);
    const segments = pageName === 'WebHome' ? segmentsWeb : [...segmentsWeb, pageName];
    const key = segments.join('/');
    if (locale || xmlChild(xml, 'translation') === '1') continue;
    if (!options.includeTechnical && (xmlChild(xml, 'hidden') === 'true' || TECHNICAL_SPACES.has(segmentsWeb[0] ?? ''))) {
      result.skipped.push({ title: key, reason: 'Technische oder versteckte Seite' });
      continue;
    }
    // Anhänge herauslösen, bevor der Seiteninhalt gelesen wird (Anhänge haben ein eigenes <content>)
    for (const attachment of xmlElements(xml, 'attachment')) {
      const filename = xmlChild(attachment.inner, 'filename');
      // Der Inhalt steckt im XML der Seite – beim Anhängen wird es noch einmal gelesen, statt alle Anhänge zu halten
      if (filename && /<content>[\s\S]*?<\/content>/.test(attachment.inner)) {
        result.media.set(`${key}@${filename}`, lazyMedia(filename, () => attachmentContent(TEXT.decode(entries.read(name, MAX_DOCUMENT_BYTES)), filename), key));
      }
    }
    const tags: string[] = [];
    for (const object of xmlElements(xml, 'object')) {
      if (xmlChild(object.inner, 'className') === 'XWiki.TagClass') {
        for (const value of xmlElements(object.inner.replace(/<class>[\s\S]*?<\/class>/g, ''), 'value')) tags.push(decodeXml(value.inner).trim());
      }
    }
    xml = xml.replace(/<attachment>[\s\S]*?<\/attachment>/g, '').replace(/<object>[\s\S]*?<\/object>/g, '').replace(/<class>[\s\S]*?<\/class>/g, '');
    const rawTitle = (xmlChild(xml, 'title') ?? '').trim();
    const fallback = segments[segments.length - 1] ?? key;
    docs.push({
      web: segmentsWeb,
      segments,
      key,
      title: rawTitle && !/[$#]/.test(rawTitle) ? rawTitle : fallback,
      syntax: xmlChild(xml, 'syntaxId') ?? 'xwiki/2.1',
      content: xmlChild(xml, 'content') ?? '',
      creator: userName(xmlChild(xml, 'creator')),
      author: userName(xmlChild(xml, 'author')),
      created: isoDate(xmlChild(xml, 'creationDate')),
      updated: isoDate(xmlChild(xml, 'date')),
      tags: tags.filter(Boolean),
    });
  }
  if (!docs.length) throw new Error('Das XAR-Paket enthält keine übernehmbaren Seiten');

  const keys = new Set(docs.map((d) => d.key));
  for (const doc of docs) {
    for (let d = 1; d < doc.segments.length; d++) {
      const folder = doc.segments.slice(0, d).join('/');
      if (!keys.has(folder)) result.folders.set(folder, { title: doc.segments[d - 1], parentKey: d > 1 ? doc.segments.slice(0, d - 1).join('/') : null });
    }
  }

  for (const doc of docs.sort((a, b) => a.key.localeCompare(b.key))) {
    const space = doc.web;
    const resolveDoc = (reference: string): string => {
      let ref = reference.trim().replace(/^[\w-]+:(?=[^/])/, (prefix) => (/^(doc|space|page):$/i.test(prefix) ? prefix : ''));
      let segments: string[];
      if (/^page:/i.test(ref)) segments = ref.slice(5).split('/').filter(Boolean);
      else {
        ref = ref.replace(/^(doc|space):/i, '');
        segments = splitReference(ref);
        if (segments[segments.length - 1] === 'WebHome') segments.pop();
      }
      const absolute = segments.join('/');
      const relative = [...space, ...segments].join('/');
      const sibling = [...space.slice(0, -1), ...segments].join('/');
      return [absolute, relative, sibling].find((candidate) => keys.has(candidate)) ?? absolute;
    };
    const ctx: XwConvertContext = { space, docKey: doc.key, resolveDoc };
    let html: string;
    if (doc.syntax.startsWith('xwiki/')) html = xwikiToHtml(doc.content, ctx);
    else if (doc.syntax.startsWith('html/')) html = doc.content;
    else if (doc.syntax.startsWith('markdown/')) html = markdownToHtml(doc.content);
    else {
      html = codeBlock(doc.content);
      result.warnings.push(`${doc.key}: Syntax ${doc.syntax} wurde als Text übernommen`);
    }
    result.documents.push({
      key: doc.key,
      title: doc.title,
      parentKey: doc.segments.length > 1 ? doc.segments.slice(0, -1).join('/') : null,
      html,
      labels: doc.tags,
      revisions: [],
      author: doc.author ?? doc.creator,
      createdAt: doc.created,
      updatedAt: doc.updated,
    });
  }
  return result;
}
