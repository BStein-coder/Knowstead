/**
 * DokuWiki-Import: ZIP des Datenverzeichnisses (data/pages, data/media und – für die
 * Versionsgeschichte – data/attic und data/meta). Namensräume werden zur
 * Seitenhierarchie, Startseiten („start“) zu den Seiten der Namensräume.
 */
import { gunzipSync } from 'node:zlib';
import { headingId } from '../../../core/html.ts';
import type { ArchiveEntries } from '../../../core/archive-entries.ts';
import {
  Protector,
  applyTagMarks,
  buildList,
  buildTable,
  callout,
  codeBlock,
  emptyResult,
  escapeHtml,
  isImage,
  isoDate,
  lazyMedia,
  mediaSrc,
  normalizeSource,
  tagMark,
  wikiHref,
  type ListItem,
  type TableCell,
  type WikiParseResult,
  type WikiRevision,
} from './common.ts';

export interface DokuWikiOptions {
  history: boolean;
  maxRevisions: number;
}

const TEXT = new TextDecoder('utf-8');
/** Obergrenze für eine entpackte ältere Fassung (data/attic/*.txt.gz) */
const MAX_REVISION_BYTES = 32 * 1024 * 1024;
/** Größte Textdatei (Seite, Änderungsprotokoll), die gelesen wird */
const MAX_TEXT_BYTES = 64 * 1024 * 1024;

/** Seiten-ID wie DokuWiki bereinigen (klein, Unterstriche, Doppelpunkte als Trenner). */
export function cleanId(id: string): string {
  return id
    .trim()
    .toLowerCase()
    .replace(/[/\\;]/g, ':')
    .replace(/\s+/g, '_')
    .replace(/[^\p{L}\p{N}_.:-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/:+/g, ':')
    .replace(/^[:._-]+|[:._-]+$/g, '');
}

/** Relative IDs (page, .:page, ..:page, :page) gegen den aktuellen Namensraum auflösen. */
export function resolveId(ns: string, raw: string): string {
  let id = raw.trim();
  const trailing = id.endsWith(':');
  if (id.startsWith('.')) {
    const base = ns ? ns.split(':') : [];
    const rest: string[] = [];
    for (const part of id.split(':')) {
      if (part === '.' || part === '') continue;
      if (part === '..') base.pop();
      else rest.push(part);
    }
    id = [...base, ...rest].join(':');
  } else if (id.startsWith(':')) id = id.slice(1);
  else if (!id.includes(':') && ns) id = `${ns}:${id}`;
  const clean = cleanId(id);
  return trailing ? `${clean}:` : clean;
}

function prettify(segment: string): string {
  const text = segment.replace(/_/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : segment;
}

const parentNs = (id: string) => (id.includes(':') ? id.slice(0, id.lastIndexOf(':')) : '');

export function isDokuWikiArchive(names: string[]): boolean {
  return names.some((n) => /(^|\/)pages\/.+\.txt$/i.test(n));
}

/* ------------------------------ Konverter ------------------------------ */

export interface DwConvertContext {
  ns: string;
  /** Seitenlink → Schlüssel; `relative` ist die Deutung relativ zum aktuellen Namensraum */
  page: (id: string, relative: string | null) => string;
  /** Mediendatei → Schlüssel (gleiche Regeln) */
  media: (id: string, relative: string | null) => string;
}

/** Links mit Namensraum sind in DokuWiki absolut – viele Wikis meinen sie aber relativ. */
function relativeAlternative(ns: string, raw: string): string | null {
  const id = raw.trim();
  return ns && id.includes(':') && !id.startsWith(':') && !id.startsWith('.') ? resolveId(ns, `.:${id}`) : null;
}

const NOTE_VARIANTS: Record<string, 'info' | 'note' | 'success' | 'warning' | 'error'> = {
  '': 'info',
  classic: 'info',
  info: 'info',
  tip: 'success',
  important: 'warning',
  warning: 'error',
  alert: 'error',
  help: 'note',
  todo: 'note',
  download: 'info',
};

const INTERWIKI: Record<string, string> = {
  wp: 'https://en.wikipedia.org/wiki/',
  wpde: 'https://de.wikipedia.org/wiki/',
  wpen: 'https://en.wikipedia.org/wiki/',
  doku: 'https://www.dokuwiki.org/',
  google: 'https://www.google.com/search?q=',
};

export function dokuWikiToHtml(source: string, ctx: DwConvertContext, nested = false): { html: string; firstHeading: string | null } {
  const protect = new Protector();
  const blocks = new Set<string>();
  const footnotes: string[] = [];
  let firstHeading: string | null = null;

  const blockToken = (html: string) => {
    const token = protect.put(html);
    blocks.add(token);
    return `\n${token}\n`;
  };

  let text = nested ? source : normalizeSource(source);
  text = text.replace(/<(code|file)(?:\s+([^\s>]+))?(?:\s+[^>]*)?>\n?([\s\S]*?)<\/\1>/g, (_, _tag: string, lang: string | undefined, code: string) =>
    blockToken(codeBlock(code, lang && lang !== '-' ? lang : null)),
  );
  text = text.replace(/<(php|PHP)>([\s\S]*?)<\/\1>/g, (_, _tag: string, code: string) => blockToken(codeBlock(code, 'php')));
  text = text.replace(/<HTML>([\s\S]*?)<\/HTML>/g, (_, html: string) => blockToken(html));
  text = text.replace(/<html>([\s\S]*?)<\/html>/g, (_, html: string) => protect.put(html));
  text = text.replace(/<nowiki>([\s\S]*?)<\/nowiki>/g, (_, inner: string) => protect.put(escapeHtml(inner)));
  text = text.replace(/%%([\s\S]*?)%%/g, (_, inner: string) => protect.put(escapeHtml(inner)));
  text = text.replace(/\$\$([^$\n]+)\$\$/g, (_, latex: string) => protect.put(`<span data-type="inline-math" data-latex="${escapeHtml(latex.trim())}"></span>`));
  text = text.replace(/~~[A-Z_]+(?::[^~]*)?~~/g, '');
  text = text.replace(/\{\{(?:indexmenu|nspages|pagelist|topic|nav)>[^}]*\}\}/gi, () => blockToken('<div data-type="children" data-depth="2"></div>'));
  text = text.replace(/\{\{[a-z0-9_]+>[^}]*\}\}/gi, (m) => protect.put(`<em>[Plugin ${escapeHtml(m.slice(2, m.indexOf('>')))} nicht übernommen]</em>`));

  // Hinweis- und WRAP-Kästen (verschachtelt von innen nach außen)
  for (let round = 0; round < 5; round++) {
    const before = text;
    text = text.replace(/<note(?:\s+([a-z]+))?>((?:(?!<note)[\s\S])*?)<\/note>/gi, (_, kind: string | undefined, body: string) =>
      blockToken(callout(NOTE_VARIANTS[(kind ?? '').toLowerCase()] ?? 'info', dokuWikiToHtml(body.trim(), ctx, true).html)),
    );
    text = text.replace(/<WRAP([^>]*)>((?:(?!<WRAP)[\s\S])*?)<\/WRAP>/g, (_, classes: string, body: string) => {
      const variant = classes
        .trim()
        .split(/\s+/)
        .map((c) => NOTE_VARIANTS[c.toLowerCase()])
        .find(Boolean);
      const inner = dokuWikiToHtml(body.trim(), ctx, true).html;
      return blockToken(variant ? callout(variant, inner) : inner);
    });
    if (text === before) break;
  }
  text = text.replace(/<\/?wrap[^>]*>/g, '');

  // Fußnoten
  text = text.replace(/\(\((.+?)\)\)/gs, (_, body: string) => {
    footnotes.push(body);
    return protect.put(`<sup>[${footnotes.length}]</sup>`);
  });

  function media(body: string): string {
    const [target, ...labelParts] = body.split('|');
    const caption = labelParts.join('|').trim();
    const [rawId, params = ''] = target.trim().split('?');
    const width = params.match(/(?:^|&)(\d+)(?:x\d+)?(?:&|$)/)?.[1];
    if (/^https?:\/\//i.test(rawId)) {
      const url = escapeHtml(rawId.trim());
      return isImage(rawId) ? `<img src="${url}" alt="${escapeHtml(caption)}"${width ? ` width="${width}"` : ''}>` : `<a href="${url}">${escapeHtml(caption || rawId)}</a>`;
    }
    const key = ctx.media(resolveId(ctx.ns, rawId.trim()), relativeAlternative(ctx.ns, rawId));
    const name = key.split(':').pop() ?? key;
    if (!isImage(name) || /(?:^|&)linkonly(?:&|$)/.test(params)) return `<a href="${mediaSrc(key)}">${escapeHtml(caption || name)}</a>`;
    return `<img src="${mediaSrc(key)}" alt="${escapeHtml(caption || name)}"${width ? ` width="${width}"` : ''}>`;
  }

  function link(body: string): string {
    const bar = body.indexOf('|');
    const target = (bar < 0 ? body : body.slice(0, bar)).trim();
    const rawLabel = bar < 0 ? '' : body.slice(bar + 1).trim();
    const label = rawLabel ? (/^\{\{.*\}\}$/.test(rawLabel) ? media(rawLabel.slice(2, -2)) : inline(rawLabel)) : '';
    if (/^(https?|ftp):\/\//i.test(target) || /^mailto:/i.test(target)) return `<a href="${escapeHtml(target)}">${label || escapeHtml(target)}</a>`;
    if (/^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(target)) return `<a href="mailto:${escapeHtml(target)}">${label || escapeHtml(target)}</a>`;
    const interwiki = target.match(/^([a-z]+)>(.+)$/i);
    if (interwiki) {
      const base = INTERWIKI[interwiki[1].toLowerCase()];
      return base ? `<a href="${escapeHtml(base + encodeURIComponent(interwiki[2]))}">${label || escapeHtml(interwiki[2])}</a>` : label || escapeHtml(interwiki[2]);
    }
    if (target.startsWith('\\\\')) return label || escapeHtml(target);
    const [pagePart, anchor] = target.split('#');
    if (!pagePart) return `<a href="#${headingId(anchor ?? '', new Map())}">${label || escapeHtml(anchor ?? '')}</a>`;
    const id = resolveId(ctx.ns, pagePart);
    const fallback = escapeHtml(prettify(id.replace(/:$/, '').split(':').pop() ?? id));
    return `<a href="${wikiHref(ctx.page(id, relativeAlternative(ctx.ns, pagePart)), anchor ? headingId(anchor.replace(/_/g, ' '), new Map()) : undefined)}">${label || fallback}</a>`;
  }

  function inline(raw: string): string {
    let s = raw;
    s = s.replace(/''(.+?)''/g, (_, code: string) => protect.put(`<code>${escapeHtml(code)}</code>`));
    s = s.replace(/\[\[(.+?)\]\]/g, (_, body: string) => protect.put(link(body)));
    s = s.replace(/\{\{(.+?)\}\}/g, (_, body: string) => protect.put(media(body)));
    s = s.replace(/(^|[\s(])((?:https?|ftp):\/\/[^\s<>[\]"']+[^\s<>[\]"'.,;:!?)])/g, (_, lead: string, url: string) => `${lead}${protect.put(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`)}`);
    s = s.replace(/\*\*(.+?)\*\*/g, `${tagMark('strong')}$1${tagMark('/strong')}`);
    s = s.replace(/\/\/(.+?)\/\//g, `${tagMark('em')}$1${tagMark('/em')}`);
    s = s.replace(/__(.+?)__/g, `${tagMark('u')}$1${tagMark('/u')}`);
    s = s.replace(/<(\/?)(del|sub|sup)>/g, (_, slash: string, tag: string) => tagMark(`${slash}${tag === 'del' ? 's' : tag}`));
    s = s
      .replace(/<->/g, '↔')
      .replace(/-->/g, '→')
      .replace(/<--/g, '←')
      .replace(/<=>/g, '⇔')
      .replace(/==>/g, '⇒')
      .replace(/<==/g, '⇐')
      .replace(/\(c\)/gi, '©')
      .replace(/\(r\)/gi, '®')
      .replace(/\(tm\)/gi, '™');
    s = applyTagMarks(escapeHtml(s));
    return s.replace(/\\\\(\s|$)/g, '<br>');
  }

  /* ------------------------------ Blöcke ------------------------------ */

  const lines = text.split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: ListItem[] = [];
  let pre: string[] = [];
  let quote: string[] = [];
  let table: string[] = [];

  const flush = () => {
    const joined = paragraph.join('\n').trim();
    if (joined) out.push(`<p>${inline(joined).replace(/\n/g, ' ')}</p>`);
    paragraph = [];
    if (list.length) out.push(buildList(list));
    list = [];
    if (pre.length) out.push(codeBlock(pre.join('\n')));
    pre = [];
    if (quote.length) out.push(`<blockquote>${quote.map((q) => `<p>${inline(q)}</p>`).join('')}</blockquote>`);
    quote = [];
    if (table.length) out.push(parseTable(table));
    table = [];
  };

  for (const line of lines) {
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
    const heading = trimmed.match(/^(={2,6})\s*(.+?)\s*={2,6}$/);
    if (heading) {
      flush();
      const level = Math.min(6, Math.max(1, 7 - heading[1].length));
      const content = heading[2];
      if (firstHeading === null && !out.length) firstHeading = content.replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').trim();
      out.push(`<h${level}>${inline(content)}</h${level}>`);
      continue;
    }
    if (/^-{4,}$/.test(trimmed)) {
      flush();
      out.push('<hr>');
      continue;
    }
    if (/^[\^|]/.test(trimmed)) {
      if (!table.length) flush();
      table.push(trimmed);
      continue;
    }
    const item = line.replace(/\t/g, '  ').match(/^( {2,})([*-])\s*(.*)$/);
    if (item) {
      if (!list.length) flush();
      list.push({ depth: Math.floor(item[1].length / 2), kind: item[2] === '-' ? 'ol' : 'ul', html: inline(item[3]) });
      continue;
    }
    const q = trimmed.match(/^>+\s?(.*)$/);
    if (q) {
      if (!quote.length) flush();
      quote.push(q[1]);
      continue;
    }
    if (/^( {2,}|\t)/.test(line)) {
      if (!pre.length) flush();
      pre.push(line.replace(/^( {2}|\t)/, ''));
      continue;
    }
    if (list.length || pre.length || quote.length || table.length) flush();
    paragraph.push(trimmed);
  }
  flush();
  if (footnotes.length) out.push('<hr>', `<ol>${footnotes.map((f) => `<li><p>${inline(f)}</p></li>`).join('')}</ol>`);

  function parseTable(rows: string[]): string {
    type Cell = TableCell & { col: number };
    const result: Cell[][] = [];
    for (const row of rows) {
      const cells: Cell[] = [];
      let depth = 0;
      let current = '';
      let separator: string | null = null;
      let column = 0;
      const finish = (next: string) => {
        if (separator !== null) {
          if (current === '' && cells.length) {
            // || ohne Inhalt: vorherige Zelle über diese Spalte ziehen
            cells[cells.length - 1].colspan = (cells[cells.length - 1].colspan ?? 1) + 1;
          } else if (current.trim() === ':::') {
            // Zeilenverbund: Ursprungszelle in derselben Spalte weiter oben verlängern
            for (let r = result.length - 1; r >= 0; r--) {
              const above = result[r].find((c) => c.col === column);
              if (above) {
                above.rowspan = (above.rowspan ?? 1) + 1;
                break;
              }
            }
          } else cells.push({ header: separator === '^', html: current, col: column });
          column++;
        }
        separator = next;
        current = '';
      };
      for (let i = 0; i < row.length; i++) {
        const two = row.slice(i, i + 2);
        if (two === '[[' || two === '{{') {
          depth++;
          current += two;
          i++;
        } else if ((two === ']]' || two === '}}') && depth) {
          depth--;
          current += two;
          i++;
        } else if ((row[i] === '^' || row[i] === '|') && !depth) finish(row[i]);
        else current += row[i];
      }
      result.push(cells);
    }
    return buildTable(
      result.filter((r) => r.length).map((r) => r.map((c) => ({ header: c.header, colspan: c.colspan, rowspan: c.rowspan, html: inline(c.html.trim()) }))),
    );
  }

  return { html: protect.restore(out.join('\n')), firstHeading };
}

/* ------------------------------ Import ------------------------------ */

export function parseDokuWiki(entries: ArchiveEntries, options: DokuWikiOptions): WikiParseResult {
  const result = emptyResult('dokuwiki');
  const names = entries.names().filter((n) => !n.endsWith('/'));
  const pageFiles = names.filter((n) => /(^|\/)pages\/.+\.txt$/i.test(n));
  if (!pageFiles.length) throw new Error('Im Archiv wurde kein DokuWiki-Ordner „pages“ gefunden');
  // Basisordner (…/data/) anhand der kürzesten Fundstelle bestimmen
  const base = pageFiles
    .map((n) => {
      const m = n.match(/(^|\/)pages\//)!;
      return n.slice(0, (m.index ?? 0) + m[1].length);
    })
    .sort((a, b) => a.length - b.length)[0];
  const under = (folder: string) => names.filter((n) => n.startsWith(`${base}${folder}/`)).map((n) => ({ name: n, rel: n.slice(base.length + folder.length + 1) }));

  // Nur die Namen – der Text jeder Seite wird erst beim Umwandeln gelesen
  const rawPages = under('pages')
    .filter((p) => p.rel.endsWith('.txt'))
    .map((p) => ({ id: cleanId(p.rel.slice(0, -4).replace(/\//g, ':')), name: p.name }));
  const ids = new Set(rawPages.map((p) => p.id));

  // Namensräume und Startseiten
  const namespaces = new Set<string>();
  for (const id of ids) {
    let ns = parentNs(id);
    while (ns) {
      namespaces.add(ns);
      ns = parentNs(ns);
    }
  }
  const keyOf = new Map<string, string>();
  for (const id of ids) keyOf.set(id, id);
  for (const ns of namespaces) {
    if (ids.has(ns)) continue;
    const last = ns.split(':').pop()!;
    const start = [`${ns}:start`, `${ns}:${last}`].find((candidate) => ids.has(candidate));
    if (start) {
      keyOf.set(start, ns);
      result.aliases.set(start, ns);
    } else result.folders.set(ns, { title: prettify(last), parentKey: parentNs(ns) || null });
  }
  const known = (id: string) => keyOf.has(id) || namespaces.has(id);
  const lookup = (id: string): string | null => {
    const clean = id.replace(/:$/, '');
    if (id.endsWith(':')) return keyOf.get(`${clean}:start`) ?? (namespaces.has(clean) ? clean : null);
    if (keyOf.has(clean)) return keyOf.get(clean)!;
    if (namespaces.has(clean)) return clean;
    // Link auf eine nicht vorhandene Startseite: Namensraum verwenden
    if (clean.endsWith(':start') && namespaces.has(clean.slice(0, -6))) return clean.slice(0, -6);
    return null;
  };
  const pageKey = (id: string, relative: string | null = null) => lookup(id) ?? (relative && known(relative.replace(/:$/, '')) ? (lookup(relative) ?? relative) : id.replace(/:$/, ''));

  // Mediendateien
  for (const file of under('media')) {
    const id = cleanId(file.rel.replace(/\//g, ':'));
    const ns = parentNs(id);
    const entryName = file.name;
    result.media.set(id, lazyMedia(id.split(':').pop() ?? id, () => entries.read(entryName), ns ? pageKey(ns) : undefined));
  }

  // Änderungsprotokolle (Autor, Kommentar je Zeitstempel)
  const changes = new Map<string, Map<number, { user: string; summary: string }>>();
  for (const file of under('meta').filter((f) => f.rel.endsWith('.changes'))) {
    const id = cleanId(file.rel.slice(0, -8).replace(/\//g, ':'));
    const map = new Map<number, { user: string; summary: string }>();
    for (const line of TEXT.decode(entries.read(file.name, MAX_TEXT_BYTES)).split('\n')) {
      const [ts, , , , user, summary] = line.split('\t');
      if (ts) map.set(Number(ts), { user: user ?? '', summary: summary ?? '' });
    }
    changes.set(id, map);
  }
  const attic = new Map<string, { ts: number; name: string }[]>();
  if (options.history) {
    for (const file of under('attic')) {
      const m = file.rel.match(/^(.*)\.(\d+)\.txt(\.gz)?$/);
      if (!m) continue;
      const id = cleanId(m[1].replace(/\//g, ':'));
      const list = attic.get(id) ?? [];
      list.push({ ts: Number(m[2]), name: file.name });
      attic.set(id, list);
    }
  }

  for (const page of rawPages.sort((a, b) => a.id.localeCompare(b.id))) {
    const key = keyOf.get(page.id) ?? page.id;
    const ns = parentNs(page.id);
    const ctx: DwConvertContext = { ns, page: pageKey, media: (id, relative) => (result.media.has(id) || !relative || !result.media.has(relative) ? id : relative) };
    const converted = dokuWikiToHtml(TEXT.decode(entries.read(page.name, MAX_TEXT_BYTES)), ctx);
    const fallbackTitle = prettify((key === page.id ? page.id : key).split(':').pop() ?? page.id);
    const title = converted.firstHeading || fallbackTitle;
    let html = converted.html;
    // Erste Überschrift ist der Seitentitel – nicht doppelt anzeigen
    if (converted.firstHeading) html = html.replace(/^<h[1-6]>[\s\S]*?<\/h[1-6]>\n?/, '');

    const log = changes.get(page.id);
    const logEntries = log ? [...log.entries()].sort((a, b) => a[0] - b[0]) : [];
    const revisions: WikiRevision[] = [];
    for (const old of (attic.get(page.id) ?? []).sort((a, b) => a.ts - b.ts).slice(-options.maxRevisions)) {
      try {
        const data = entries.read(old.name, MAX_REVISION_BYTES);
        const textContent = TEXT.decode(old.name.endsWith('.gz') ? gunzipSync(data, { maxOutputLength: MAX_REVISION_BYTES }) : data);
        const oldConverted = dokuWikiToHtml(textContent, ctx);
        const meta = log?.get(old.ts);
        revisions.push({
          title: oldConverted.firstHeading || fallbackTitle,
          html: oldConverted.firstHeading ? oldConverted.html.replace(/^<h[1-6]>[\s\S]*?<\/h[1-6]>\n?/, '') : oldConverted.html,
          author: meta?.user || null,
          comment: meta?.summary ?? '',
          timestamp: isoDate(old.ts * 1000),
        });
      } catch {
        result.warnings.push(`Ältere Version von ${page.id} konnte nicht gelesen werden`);
      }
    }
    // Die aktuelle Fassung liegt ebenfalls im Archiv (attic) – nicht doppelt übernehmen
    const lastLog = logEntries[logEntries.length - 1];
    if (revisions.length && lastLog && revisions[revisions.length - 1].timestamp === isoDate(lastLog[0] * 1000)) revisions.pop();

    result.documents.push({
      key,
      title,
      parentKey: key === page.id ? (ns ? pageKey(ns) : null) : parentNs(key) ? pageKey(parentNs(key)) : null,
      html,
      labels: [],
      revisions,
      author: lastLog?.[1].user || null,
      createdAt: logEntries.length ? isoDate(logEntries[0][0] * 1000) : null,
      updatedAt: lastLog ? isoDate(lastLog[0] * 1000) : null,
    });
  }
  return result;
}
