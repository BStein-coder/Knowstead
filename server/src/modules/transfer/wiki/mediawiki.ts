/**
 * MediaWiki-Import: XML-Dump (Spezial:Exportieren oder dumpBackup.php), optional
 * als ZIP zusammen mit den hochgeladenen Dateien (z. B. aus dem images-Ordner).
 *
 * Übernommen werden Inhaltsnamensräume, Unterseiten („A/B“) als Hierarchie,
 * Kategorien als Stichwörter, Dateien als Anhänge, Weiterleitungen als Link-Aliase
 * und auf Wunsch die Versionsgeschichte. Vorlagen lassen sich nicht auswerten –
 * Hinweis-Vorlagen werden zu Hinweisboxen, alle anderen als Vermerk sichtbar.
 */
import fs from 'node:fs';
import { headingId } from '../../../core/html.ts';
import {
  Protector,
  applyTagMarks,
  buildList,
  buildTable,
  callout,
  calloutVariant,
  codeBlock,
  decodeEntities,
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

/** Kanonische Namensräume; lokalisierte Namen kommen aus dem Dump (siteinfo). */
const NS = { main: 0, user: 2, project: 4, file: 6, mediawiki: 8, template: 10, help: 12, category: 14 };
const FILE_NAMES = ['file', 'image', 'datei', 'bild'];
const CATEGORY_NAMES = ['category', 'kategorie'];
const MEDIA_NAMES = ['media', 'medium'];

export interface MediaWikiOptions {
  history: boolean;
  maxRevisions: number;
}

interface RawRevision {
  timestamp: string | null;
  author: string | null;
  comment: string;
  text: string;
}

interface RawPage {
  title: string;
  ns: number;
  revisions: RawRevision[];
}

/** Titel wie MediaWiki normalisieren: Unterstriche → Leerzeichen, erster Buchstabe groß. */
export function normalizeTitle(title: string): string {
  const t = title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

function mediaKey(name: string): string {
  return normalizeTitle(name.replace(/^.*[\\/]/, ''));
}

export function isMediaWikiDump(text: string): boolean {
  return /<mediawiki[\s>]/.test(text.slice(0, 4000));
}

/* ------------------------------ Dump lesen ------------------------------ */

/**
 * Ein MediaWiki-Dump in Stücken: erst der Kopf mit den Namensräumen, dann Seite für Seite. Ein Dump mit
 * Versionsgeschichte ist schnell mehrere hundert Megabyte groß – als eine Zeichenkette passte er weder in
 * den Speicher noch in die größte Zeichenkette, die Node.js anlegen kann.
 */
export interface DumpSource {
  /** Anfang der Datei bis zur ersten Seite (enthält <siteinfo>) */
  header: string;
  /** Inhalt jedes <page>-Elements – oder der Titel einer Seite, die zu groß ist, um sie zu lesen */
  pages(): Iterable<{ inner: string } | { tooLarge: string }>;
}

/** Größte einzelne Seite samt ihrer Versionen (Zeichen), die gelesen wird */
export const MAX_DUMP_PAGE_CHARS = 200 * 1024 * 1024;

export function stringDump(xml: string): DumpSource {
  const first = xml.search(/<page[\s>]/);
  return {
    header: first < 0 ? xml : xml.slice(0, first),
    *pages() {
      for (const page of xmlElements(xml, 'page')) yield { inner: page.inner };
    },
  };
}

/** Dump von der Platte lesen – im Speicher liegt immer nur die Seite, die gerade an der Reihe ist. */
export function fileDump(file: string, maxPageChars = MAX_DUMP_PAGE_CHARS): DumpSource {
  const chunks = function* (): Generator<string> {
    const fd = fs.openSync(file, 'r');
    try {
      const decoder = new TextDecoder('utf-8');
      const chunk = Buffer.allocUnsafe(1024 * 1024);
      for (;;) {
        const read = fs.readSync(fd, chunk, 0, chunk.length, null);
        if (read <= 0) break;
        yield decoder.decode(chunk.subarray(0, read), { stream: true });
      }
      const rest = decoder.decode();
      if (rest) yield rest;
    } finally {
      fs.closeSync(fd);
    }
  };
  let header = '';
  for (const text of chunks()) {
    header += text;
    const first = header.search(/<page[\s>]/);
    if (first >= 0) {
      header = header.slice(0, first);
      break;
    }
    if (header.length > 8 * 1024 * 1024) break;
  }
  return {
    header,
    *pages() {
      const CLOSE = '</page>';
      let buffer = '';
      // Bis hierhin wurde schon nach dem Ende der Seite gesucht – ein großer Puffer wird nicht immer wieder ganz durchsucht
      let searched = 0;
      // Titel einer übergroßen Seite, deren Rest bis zum Ende übersprungen wird
      let skipping: string | null = null;
      for (const text of chunks()) {
        buffer += text;
        for (;;) {
          if (skipping !== null) {
            const end = buffer.indexOf(CLOSE);
            if (end < 0) {
              buffer = buffer.slice(-CLOSE.length);
              break;
            }
            yield { tooLarge: skipping };
            skipping = null;
            buffer = buffer.slice(end + CLOSE.length);
            searched = 0;
            continue;
          }
          const start = buffer.search(/<page[\s>]/);
          if (start < 0) {
            // Der Anfang der nächsten Seite kann auf zwei Stücke verteilt sein
            buffer = buffer.slice(-8);
            searched = 0;
            break;
          }
          if (start > 0) {
            buffer = buffer.slice(start);
            searched = 0;
          }
          const end = buffer.indexOf(CLOSE, Math.max(0, searched - CLOSE.length));
          if (end < 0) {
            searched = buffer.length;
            if (buffer.length > maxPageChars) {
              skipping = decodeXml(xmlChild(buffer.slice(0, 4000), 'title') ?? '?');
              buffer = '';
              searched = 0;
            }
            break;
          }
          // Die Grenze gilt auch für Seiten, die ganz in einem gelesenen Stück liegen
          if (end > maxPageChars) yield { tooLarge: decodeXml(xmlChild(buffer.slice(0, 4000), 'title') ?? '?') };
          else yield { inner: buffer.slice(buffer.indexOf('>') + 1, end) };
          buffer = buffer.slice(end + CLOSE.length);
          searched = 0;
        }
      }
    },
  };
}

function readDump(source: DumpSource, options: MediaWikiOptions): { pages: RawPage[]; namespaces: Map<number, string>; tooLarge: string[] } {
  const namespaces = new Map<number, string>();
  const siteinfo = source.header.match(/<siteinfo>([\s\S]*?)<\/siteinfo>/)?.[1] ?? '';
  for (const ns of xmlElements(siteinfo, 'namespace')) {
    const key = Number(ns.attrs.match(/key="(-?\d+)"/)?.[1]);
    if (Number.isFinite(key)) namespaces.set(key, decodeXml(ns.inner).trim());
  }
  const pages: RawPage[] = [];
  const tooLarge: string[] = [];
  for (const page of source.pages()) {
    if ('tooLarge' in page) {
      tooLarge.push(page.tooLarge);
      continue;
    }
    const title = xmlChild(page.inner, 'title') ?? '';
    const ns = Number(xmlChild(page.inner, 'ns') ?? '0') || 0;
    const revisions: RawRevision[] = [];
    for (const rev of xmlElements(page.inner, 'revision')) {
      const contributor = rev.inner.match(/<contributor[^>]*>([\s\S]*?)<\/contributor>/)?.[1] ?? '';
      revisions.push({
        timestamp: isoDate(xmlChild(rev.inner, 'timestamp')),
        author: xmlChild(contributor, 'username') ?? xmlChild(contributor, 'ip'),
        comment: xmlChild(rev.inner, 'comment') ?? '',
        text: xmlChild(rev.inner, 'text') ?? '',
      });
    }
    revisions.sort((a, b) => (a.timestamp ?? '').localeCompare(b.timestamp ?? ''));
    if (!options.history && revisions.length > 1) revisions.splice(0, revisions.length - 1);
    else if (revisions.length > options.maxRevisions) revisions.splice(0, revisions.length - options.maxRevisions);
    if (title && revisions.length) pages.push({ title, ns, revisions });
  }
  return { pages, namespaces, tooLarge };
}

/* ------------------------------ Hilfen ------------------------------ */

/** Am Trennzeichen teilen, aber nicht innerhalb von [[…]] oder {{…}}. */
function splitTop(text: string, separator = '|'): string[] {
  const parts: string[] = [];
  let depthLink = 0;
  let depthTpl = 0;
  let current = '';
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2);
    if (two === '[[') {
      depthLink++;
      current += two;
      i++;
    } else if (two === ']]' && depthLink) {
      depthLink--;
      current += two;
      i++;
    } else if (two === '{{') {
      depthTpl++;
      current += two;
      i++;
    } else if (two === '}}' && depthTpl) {
      depthTpl--;
      current += two;
      i++;
    } else if (text[i] === separator && !depthLink && !depthTpl) {
      parts.push(current);
      current = '';
    } else current += text[i];
  }
  parts.push(current);
  return parts;
}

/** Äußerste Vorlagen {{…}} (verschachtelt) finden und ersetzen. */
function replaceTemplates(text: string, replace: (inner: string, block: boolean) => string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const start = text.indexOf('{{', i);
    if (start < 0) break;
    let depth = 0;
    let end = -1;
    for (let j = start; j < text.length - 1; j++) {
      if (text[j] === '{' && text[j + 1] === '{') {
        depth++;
        j++;
      } else if (text[j] === '}' && text[j + 1] === '}') {
        depth--;
        j++;
        if (depth === 0) {
          end = j + 1;
          break;
        }
      }
    }
    if (end < 0) break;
    const before = text.slice(i, start);
    const lineStart = before.lastIndexOf('\n') >= 0 ? before.slice(before.lastIndexOf('\n') + 1) : out.endsWith('\n') || !out ? before : null;
    const after = text.slice(end, text.indexOf('\n', end) < 0 ? text.length : text.indexOf('\n', end));
    const block = lineStart !== null && !lineStart.trim() && !after.trim();
    out += before + replace(text.slice(start + 2, end - 2), block);
    i = end;
  }
  return out + text.slice(i);
}

const ALLOWED_TAGS: Record<string, string | null> = {
  b: 'strong',
  strong: 'strong',
  i: 'em',
  em: 'em',
  u: 'u',
  ins: 'u',
  s: 's',
  strike: 's',
  del: 's',
  sup: 'sup',
  sub: 'sub',
  code: 'code',
  tt: 'code',
  kbd: 'kbd',
  var: 'em',
  samp: 'code',
  cite: 'em',
  mark: 'mark',
  small: null,
  big: null,
  span: null,
  font: null,
  center: null,
  div: null,
  abbr: null,
  p: null,
};

/* ------------------------------ Konverter ------------------------------ */

export interface MwConvertContext {
  /** Dateinamensraum-Präfixe (klein) */
  filePrefixes: string[];
  categoryPrefixes: string[];
  mediaPrefixes: string[];
  /** Linkziel → Schlüssel (Weiterleitungen aufgelöst) */
  resolve: (title: string) => string;
  pageTitle: string;
}

export function mediaWikiToHtml(source: string, ctx: MwConvertContext, nested = false): { html: string; categories: string[] } {
  const protect = new Protector();
  const blocks = new Set<string>();
  const categories: string[] = [];
  const footnotes: string[] = [];
  const namedRefs = new Map<string, number>();
  let referencesPlaced = false;

  const blockToken = (html: string) => {
    const token = protect.put(html);
    blocks.add(token);
    return `\n${token}\n`;
  };

  let text = nested ? source : normalizeSource(source);
  text = text.replace(/<!--[\s\S]*?(-->|$)/g, '');
  text = text.replace(/<nowiki>([\s\S]*?)<\/nowiki>/gi, (_, inner: string) => protect.put(escapeHtml(inner)));
  text = text.replace(/<nowiki\s*\/>/gi, '');
  text = text.replace(/<(syntaxhighlight|source)\b([^<>]*)>([\s\S]*?)<\/\1>/gi, (_, _tag: string, attrs: string, code: string) => {
    const lang = attrs.match(/lang(?:uage)?\s*=\s*["']?([\w#+-]+)/i)?.[1];
    if (/\binline\b/i.test(attrs)) return protect.put(`<code>${escapeHtml(code)}</code>`);
    return blockToken(codeBlock(code, lang));
  });
  text = text.replace(/<pre\b[^<>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => blockToken(codeBlock(decodeXml(code))));
  text = text.replace(/<math\b([^<>]*)>([\s\S]*?)<\/math>/gi, (_, attrs: string, latex: string) => {
    const tex = escapeHtml(latex.trim());
    return /display\s*=\s*["']?block/i.test(attrs)
      ? blockToken(`<div data-type="block-math" data-latex="${tex}"></div>`)
      : protect.put(`<span data-type="inline-math" data-latex="${tex}"></span>`);
  });
  text = text.replace(/<gallery\b[^<>]*>([\s\S]*?)<\/gallery>/gi, (_, body: string) => {
    const items = body
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [file, ...rest] = splitTop(line);
        const colon = file.indexOf(':');
        const name = mediaKey(colon > 0 && ctx.filePrefixes.includes(file.slice(0, colon).trim().toLowerCase()) ? file.slice(colon + 1) : file);
        const caption = rest.filter((p) => !/^(alt|link|page|class)=/i.test(p)).pop()?.trim() ?? '';
        return { src: mediaSrc(name), alt: caption || name, caption };
      });
    if (!items.length) return '';
    return blockToken(`<div data-type="gallery" data-columns="3" data-items="${escapeHtml(JSON.stringify(items))}"></div>`);
  });

  // Einzelnachweise
  text = text.replace(/<ref\b([^<>]*?)\/>/gi, (_, attrs: string) => {
    const name = attrs.match(/name\s*=\s*["']?([^"'>\s]+)/i)?.[1];
    const n = name ? namedRefs.get(name) : undefined;
    return n ? protect.put(`<sup>[${n}]</sup>`) : '';
  });
  text = text.replace(/<ref\b([^<>]*)>([\s\S]*?)<\/ref>/gi, (_, attrs: string, body: string) => {
    const name = attrs.match(/name\s*=\s*["']?([^"'>\s]+)/i)?.[1];
    let n = name ? namedRefs.get(name) : undefined;
    if (!n) {
      footnotes.push(body);
      n = footnotes.length;
      if (name) namedRefs.set(name, n);
    }
    return protect.put(`<sup>[${n}]</sup>`);
  });
  text = text.replace(/<references\b[^<>]*(\/>|>[\s\S]*?<\/references>)/gi, () => {
    referencesPlaced = true;
    return '\n\u0003REFERENCES\u0003\n';
  });

  // Vorlagen und Zauberwörter
  text = text.replace(/__TOC__/g, () => blockToken('<div data-type="toc"></div>'));
  text = text.replace(/__[A-ZÄÖÜ]+__/g, '');
  text = replaceTemplates(text, (inner, block) => {
    const [rawName, ...params] = splitTop(inner);
    const name = rawName.trim();
    if (/^(toc|inhaltsverzeichnis)$/i.test(name)) return blockToken('<div data-type="toc"></div>');
    if (/^(pagename|seitenname)$/i.test(name)) return escapeHtml(ctx.pageTitle);
    if (name.startsWith('#') || /^[A-Z_]+(:|$)/.test(name) || /^(displaytitle|defaultsort|sortierung)\s*:/i.test(name)) return '';
    const variant = calloutVariant(name);
    const positional = params.filter((p) => !/^\s*[\w-]+\s*=/.test(p));
    const named = Object.fromEntries(params.filter((p) => /^\s*[\w-]+\s*=/.test(p)).map((p) => [p.slice(0, p.indexOf('=')).trim().toLowerCase(), p.slice(p.indexOf('=') + 1)]));
    const body = named.text ?? named.inhalt ?? named.content ?? named['1'] ?? positional[0];
    if (variant && body?.trim()) return blockToken(callout(variant, inline(body.trim())));
    const label = `[Vorlage „${escapeHtml(name.slice(0, 80))}“ nicht übernommen]`;
    return block ? blockToken(`<p><em>${label}</em></p>`) : protect.put(`<em>${label}</em>`);
  });

  // Kategorien entfernen und merken
  // Ohne „[“ in den Teilen: Bei einer Folge von „[[Datei:“ ohne Ende suchte sonst jeder Versuch bis zum Textende (quadratisch)
  text = text.replace(/\[\[\s*([^\][:|]+)\s*:([^\][|]*)(?:\|[^\][]*)?\]\]\n?/g, (m, prefix: string, name: string) => {
    if (!ctx.categoryPrefixes.includes(prefix.trim().toLowerCase())) return m;
    if (name.trim()) categories.push(name.trim());
    return '';
  });
  text = text.replace(/~{3,5}/g, '');

  /** Inline-Markup in HTML umwandeln. */
  function inline(raw: string): string {
    let s = raw;
    // Links von innen nach außen (Bildunterschriften dürfen Links enthalten)
    for (let round = 0; round < 6 && /\[\[[^[\]]+\]\]/.test(s); round++) {
      s = s.replace(/\[\[([^[\]]+)\]\]([a-zäöüß]*)/g, (_, body: string, trail: string) => protect.put(internalLink(body, trail)));
    }
    s = s.replace(/\[((?:https?|ftp):\/\/|mailto:)([^\s\][]+)(?:\s+([^\][]*))?\]/g,(_, scheme: string, rest: string, label?: string) => {
      const url = `${scheme}${rest}`;
      const text = label?.trim() ? label.trim() : url;
      return protect.put(`<a href="${escapeHtml(url)}">${escapeHtml(text)}</a>`);
    });
    s = s.replace(/(^|[\s(>])((?:https?|ftp):\/\/[^\s<>[\]"']+[^\s<>[\]"'.,;:!?)])/g, (_, lead: string, url: string) => `${lead}${protect.put(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`)}`);
    s = s.replace(/'''''(.+?)'''''/g, `${tagMark('strong')}${tagMark('em')}$1${tagMark('/em')}${tagMark('/strong')}`);
    s = s.replace(/'''(.+?)'''/g, `${tagMark('strong')}$1${tagMark('/strong')}`);
    s = s.replace(/''(.+?)''/g, `${tagMark('em')}$1${tagMark('/em')}`);
    return applyTagMarks(allowTags(s));
  }

  /** HTML maskieren, erlaubte Auszeichnungen (b, i, sup …) als bereinigte Tags behalten. */
  function allowTags(s: string): string {
    return s
      .split(/(<\/?[a-z]+\b[^<>]*\/?>)/gi)
      .map((part, index) => {
        if (index % 2 === 0) return escapeHtml(decodeEntities(part));
        const m = part.match(/^<(\/?)([a-z]+)\b[^<>]*?(\/?)>$/i);
        if (!m) return escapeHtml(part);
        const tag = m[2].toLowerCase();
        if (tag === 'br') return '<br>';
        if (!(tag in ALLOWED_TAGS)) return escapeHtml(part);
        const mapped = ALLOWED_TAGS[tag];
        return mapped ? `<${m[1]}${mapped}>` : '';
      })
      .join('');
  }

  function internalLink(body: string, trail: string): string {
    const [targetRaw, ...rest] = splitTop(body);
    let target = targetRaw.trim();
    const label = rest.length ? rest.join('|').trim() : '';
    const leadingColon = target.startsWith(':');
    if (leadingColon) target = target.slice(1).trim();
    const prefix = target.includes(':') ? target.slice(0, target.indexOf(':')).trim().toLowerCase() : '';

    if (!leadingColon && ctx.filePrefixes.includes(prefix)) return fileLink(target.slice(target.indexOf(':') + 1), rest);
    if (ctx.mediaPrefixes.includes(prefix)) {
      const name = mediaKey(target.slice(target.indexOf(':') + 1));
      return `<a href="${mediaSrc(name)}">${inlineLabel(label || name)}</a>`;
    }
    if (ctx.categoryPrefixes.includes(prefix)) return inlineLabel(label || target.slice(target.indexOf(':') + 1)) + escapeHtml(trail);
    if (/^(w|wikipedia)$/.test(prefix)) {
      const page = target.slice(target.indexOf(':') + 1).trim();
      return `<a href="https://de.wikipedia.org/wiki/${encodeURIComponent(page.replace(/ /g, '_'))}">${inlineLabel(label || page)}${escapeHtml(trail)}</a>`;
    }
    const [pagePart, anchor] = target.split('#');
    const text = (label || target) + trail;
    if (!pagePart.trim()) return `<a href="#${headingId(decodeAnchor(anchor ?? ''), new Map())}">${inlineLabel(text)}</a>`;
    return `<a href="${wikiHref(ctx.resolve(pagePart), anchor ? headingId(decodeAnchor(anchor), new Map()) : undefined)}">${inlineLabel(text)}</a>`;
  }

  function inlineLabel(label: string): string {
    return inline(label);
  }

  function fileLink(rawName: string, options: string[]): string {
    const name = mediaKey(rawName);
    let width: string | undefined;
    let alt = '';
    let caption = '';
    let framed = false;
    for (const option of options) {
      const o = option.trim();
      const size = o.match(/^(\d+)(?:x(\d+))?\s*px$/i);
      if (size) width = size[1];
      else if (/^x\d+\s*px$/i.test(o)) continue;
      else if (/^(thumb|thumbnail|mini|miniatur|frame|framed|gerahmt)$/i.test(o)) framed = true;
      else if (/^(frameless|rahmenlos|border|rand|left|links|right|rechts|center|zentriert|none|ohne|upright|hochkant)(=.*)?$/i.test(o)) continue;
      else if (/^alt=/i.test(o)) alt = o.slice(4);
      else if (/^(link|page|seite|class|lang|verweis)=/i.test(o)) continue;
      else if (o) caption = o;
    }
    if (!isImage(name)) return `<a href="${mediaSrc(name)}">${inline(caption || name)}</a>`;
    // Alternativtext ohne Auszeichnungen (die Bildunterschrift darf Links enthalten)
    const altText = alt ? escapeHtml(alt) : caption ? protect.restore(inline(caption)).replace(/<[^>]*>/g, '') : escapeHtml(name);
    const img = `<img src="${mediaSrc(name)}" alt="${altText}"${width ? ` width="${width}"` : ''}>`;
    return caption && framed ? `${img}<br><em>${inline(caption)}</em>` : img;
  }

  /* ------------------------------ Blöcke ------------------------------ */

  const lines = text.split('\n');
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: ListItem[] = [];
  let pre: string[] = [];

  const flushParagraph = () => {
    const joined = paragraph.join(' ').trim();
    if (joined) out.push(`<p>${inline(joined)}</p>`);
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) out.push(buildList(list));
    list = [];
  };
  const flushPre = () => {
    if (pre.length) out.push(codeBlock(pre.join('\n')));
    pre = [];
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
    flushPre();
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (blocks.has(trimmed)) {
      flushAll();
      out.push(trimmed);
      continue;
    }
    if (trimmed === '\u0003REFERENCES\u0003') {
      flushAll();
      if (footnotes.length) out.push(`<ol>${footnotes.map((f) => `<li><p>${inline(f)}</p></li>`).join('')}</ol>`);
      continue;
    }
    if (/^\{\|/.test(trimmed)) {
      flushAll();
      const tableLines: string[] = [];
      let depth = 0;
      for (; i < lines.length; i++) {
        const l = lines[i].trim();
        if (l.startsWith('{|')) depth++;
        if (l.startsWith('|}')) {
          depth--;
          if (depth === 0) break;
        }
        tableLines.push(lines[i]);
      }
      out.push(parseTable(tableLines.slice(1)));
      continue;
    }
    const heading = trimmed.match(/^(={1,6})\s*(.+?)\s*\1$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^-{4,}$/.test(trimmed)) {
      flushAll();
      out.push('<hr>');
      continue;
    }
    const listMatch = line.match(/^([*#:;]+)\s*(.*)$/);
    if (listMatch) {
      flushParagraph();
      flushPre();
      const markers = listMatch[1];
      const content = listMatch[2];
      const last = markers[markers.length - 1];
      if (!/[*#]/.test(markers)) {
        // ; Begriff : Erklärung  bzw. reine Einrückung mit :
        flushList();
        if (last === ';') {
          const [term, ...desc] = content.split(/\s:\s|:(?=\s)/);
          out.push(`<p><strong>${inline(term.trim())}</strong></p>`);
          if (desc.join(':').trim()) out.push(`<blockquote><p>${inline(desc.join(':').trim())}</p></blockquote>`);
        } else out.push(`<blockquote><p>${inline(content)}</p></blockquote>`);
        continue;
      }
      const depth = markers.replace(/[:;]/g, '').length || 1;
      list.push({ depth, kind: last === '#' ? 'ol' : 'ul', html: inline(content) });
      continue;
    }
    if (/^ \S/.test(line) || (pre.length && /^ /.test(line))) {
      flushParagraph();
      flushList();
      pre.push(line.slice(1));
      continue;
    }
    if (!trimmed) {
      flushAll();
      continue;
    }
    flushList();
    flushPre();
    paragraph.push(trimmed);
  }
  flushAll();
  if (footnotes.length && !referencesPlaced) {
    out.push('<hr>', `<ol>${footnotes.map((f) => `<li><p>${inline(f)}</p></li>`).join('')}</ol>`);
  }

  function parseTable(tableLines: string[]): string {
    const rows: TableCell[][] = [];
    let caption = '';
    let row: TableCell[] = [];
    let current: TableCell | null = null;
    const pushCell = (header: boolean, raw: string) => {
      const parts = splitTop(raw);
      let attrs = '';
      let content = raw;
      if (parts.length > 1 && /^\s*[a-z-]+\s*=/.test(parts[0])) {
        attrs = parts[0];
        content = parts.slice(1).join('|');
      }
      current = {
        header,
        html: content,
        colspan: Number(attrs.match(/colspan\s*=\s*["']?(\d+)/i)?.[1]) || undefined,
        rowspan: Number(attrs.match(/rowspan\s*=\s*["']?(\d+)/i)?.[1]) || undefined,
      };
      row.push(current);
    };
    for (const rawLine of tableLines) {
      const l = rawLine.trim();
      if (l.startsWith('|+')) caption = l.slice(2).trim();
      else if (l.startsWith('|-')) {
        if (row.length) rows.push(row);
        row = [];
        current = null;
      } else if (l.startsWith('!')) {
        for (const cell of l.slice(1).split(/!!|\|\|/)) pushCell(true, cell);
      } else if (l.startsWith('|')) {
        for (const cell of l.slice(1).split('||')) pushCell(false, cell);
      } else if (current) (current as TableCell).html += `\n${rawLine}`;
    }
    if (row.length) rows.push(row);
    for (const r of rows) {
      for (const cell of r) {
        const content = cell.html.trim();
        cell.html = content.includes('\n') ? mediaWikiToHtml(content, ctx, true).html : inline(content);
      }
    }
    return buildTable(rows, caption ? inline(caption) : undefined);
  }

  const html = protect.restore(out.join('\n'));
  return { html, categories: [...new Set(categories)] };
}

function decodeAnchor(anchor: string): string {
  return anchor.replace(/_/g, ' ').replace(/\.([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/* ------------------------------ Import ------------------------------ */

/**
 * `dump` ist der XML-Text oder – für große Dumps – eine Quelle, die ihn stückweise liefert (`fileDump`).
 * `files` sind die Mediendateien: Inhalt oder ein Zugriff, der ihn erst beim Anhängen lädt.
 */
export function parseMediaWiki(dump: string | DumpSource, files: Map<string, Uint8Array | (() => Uint8Array)>, options: MediaWikiOptions): WikiParseResult {
  const result = emptyResult('mediawiki');
  const { pages, namespaces, tooLarge } = readDump(typeof dump === 'string' ? stringDump(dump) : dump, options);
  if (!pages.length) throw new Error('Der MediaWiki-Dump enthält keine Seiten');
  for (const title of tooLarge) result.skipped.push({ title, reason: 'Seite samt Versionsgeschichte ist zu groß' });

  const prefixes = (id: number, canonical: string[]) => [...new Set([...canonical, (namespaces.get(id) ?? '').toLowerCase()].filter(Boolean))];
  const filePrefixes = prefixes(NS.file, FILE_NAMES);
  const categoryPrefixes = prefixes(NS.category, CATEGORY_NAMES);
  const mediaPrefixes = prefixes(-2, MEDIA_NAMES);
  const contentNamespace = (ns: number) => ns === NS.main || ns === NS.project || ns === NS.help || (ns >= 100 && ns % 2 === 0);

  for (const [name, data] of files) result.media.set(mediaKey(name), typeof data === 'function' ? lazyMedia(mediaKey(name), data) : { name: mediaKey(name), data });

  // Weiterleitungen und bekannte Titel
  const redirects = new Map<string, string>();
  const keys = new Set<string>();
  const imported: RawPage[] = [];
  for (const page of pages) {
    const title = normalizeTitle(page.title);
    const latest = page.revisions[page.revisions.length - 1].text;
    const redirect = latest.match(/^\s*#(?:REDIRECT|WEITERLEITUNG)\s*:?\s*\[\[([^\]|#]+)/i);
    if (redirect) {
      redirects.set(title, normalizeTitle(redirect[1]));
      continue;
    }
    if (!contentNamespace(page.ns)) {
      if (page.ns !== NS.file && page.ns !== NS.category) result.skipped.push({ title, reason: `Namensraum ${namespaces.get(page.ns) || page.ns} wird nicht übernommen` });
      continue;
    }
    keys.add(title);
    imported.push(page);
  }
  const resolve = (target: string) => {
    let key = normalizeTitle(target);
    for (let i = 0; i < 5 && redirects.has(key); i++) key = redirects.get(key)!;
    return key;
  };
  for (const [from, to] of redirects) result.aliases.set(from, resolve(to));

  for (const page of imported) {
    const key = normalizeTitle(page.title);
    const nsName = page.ns === NS.main ? '' : (namespaces.get(page.ns) ?? String(page.ns));
    const local = nsName && key.toLowerCase().startsWith(`${nsName.toLowerCase()}:`) ? key.slice(nsName.length + 1) : key;
    const segments = local.split('/').map((s) => s.trim()).filter(Boolean);
    const nsKey = nsName ? `ns:${page.ns}` : null;
    if (nsKey) result.folders.set(nsKey, { title: nsName, parentKey: null });
    // Unterseiten „A/B“: Elternschlüssel ist „A“ (im selben Namensraum)
    const prefix = nsName ? `${key.slice(0, nsName.length)}:` : '';
    let parentKey: string | null = nsKey;
    if (segments.length > 1) {
      parentKey = `${prefix}${segments.slice(0, -1).join('/')}`;
      for (let d = 1; d < segments.length; d++) {
        const folder = `${prefix}${segments.slice(0, d).join('/')}`;
        if (!keys.has(folder)) result.folders.set(folder, { title: segments[d - 1], parentKey: d === 1 ? nsKey : `${prefix}${segments.slice(0, d - 1).join('/')}` });
      }
    }
    const convert = (text: string) => mediaWikiToHtml(text, { filePrefixes, categoryPrefixes, mediaPrefixes, resolve, pageTitle: local });
    const latest = page.revisions[page.revisions.length - 1];
    const current = convert(latest.text);
    result.documents.push({
      key,
      title: segments[segments.length - 1] ?? key,
      parentKey,
      html: current.html,
      labels: current.categories,
      revisions: page.revisions.slice(0, -1).map((r) => ({ title: segments[segments.length - 1] ?? key, html: convert(r.text).html, author: r.author, comment: r.comment, timestamp: r.timestamp })),
      author: latest.author,
      createdAt: page.revisions[0].timestamp,
      updatedAt: latest.timestamp,
    });
  }
  // Ordner-Schlüssel für Unterseiten, deren Elternseite existiert, sind echte Seiten
  for (const doc of result.documents) result.folders.delete(doc.key);
  return result;
}
