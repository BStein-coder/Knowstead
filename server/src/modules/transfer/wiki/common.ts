/**
 * Gemeinsame Bausteine der Wiki-Importer (MediaWiki, DokuWiki, XWiki).
 *
 * Die Konverter erzeugen Knowstead-HTML mit Platzhaltern: interne Links zeigen auf
 * `/__wiki/<Schlüssel>`, Bilder und Dateien auf `/__media/<Name>`. Nach dem
 * Anlegen aller Seiten ersetzt der Importer sie durch echte Seiten- und
 * Anhangsadressen.
 */
import { escapeHtml } from '../../../core/html.ts';

export { escapeHtml };

export interface WikiRevision {
  title: string;
  html: string;
  author: string | null;
  comment: string;
  timestamp: string | null;
}

export interface WikiDocument {
  /** eindeutiger Schlüssel innerhalb des Imports (Ziel interner Links) */
  key: string;
  title: string;
  /** Schlüssel der übergeordneten Seite (fehlende Ebenen legt der Importer an) */
  parentKey: string | null;
  html: string;
  labels: string[];
  /** ältere Versionen (älteste zuerst, ohne die aktuelle) */
  revisions: WikiRevision[];
  author: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** Reihenfolge unter Geschwistern */
  position?: number;
}

/** Mediendatei eines Imports. `data` darf ein Zugriff sein, der den Inhalt erst dann von der Platte liest. */
export interface WikiMedia {
  name: string;
  readonly data: Uint8Array;
  ownerKey?: string;
}

/**
 * Mediendatei, deren Inhalt erst beim Zugriff geladen wird – und bei jedem Zugriff neu. So liegen nie alle
 * Bilder und Dateien eines Wikis gleichzeitig im Speicher.
 */
export function lazyMedia(name: string, load: () => Uint8Array, ownerKey?: string): WikiMedia {
  return {
    name,
    ownerKey,
    get data() {
      return load();
    },
  };
}

export interface WikiParseResult {
  format: 'mediawiki' | 'dokuwiki' | 'xwiki' | 'confluence';
  documents: WikiDocument[];
  /** Mediendateien: normalisierter Name → Inhalt (optional mit Seite, zu der die Datei gehört) */
  media: Map<string, WikiMedia>;
  /** Ebenen ohne eigene Seite (z. B. DokuWiki-Namensräume) – werden als Ordnerseiten angelegt */
  folders: Map<string, { title: string; parentKey: string | null }>;
  /** weitere Schlüssel, die auf eine Seite zeigen (Weiterleitungen, Startseiten) */
  aliases: Map<string, string>;
  skipped: { title: string; reason: string }[];
  warnings: string[];
}

export function emptyResult(format: WikiParseResult['format']): WikiParseResult {
  return { format, documents: [], media: new Map(), folders: new Map(), aliases: new Map(), skipped: [], warnings: [] };
}

/* ------------------------------ Platzhalter ------------------------------ */

export function wikiHref(key: string, anchor?: string): string {
  return `/__wiki/${encodeURIComponent(key)}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}

export function mediaSrc(name: string): string {
  return `/__media/${encodeURIComponent(name)}`;
}

export const WIKI_HREF_RE = /\/__wiki\/([A-Za-z0-9%._~!*'()-]+)(?:#([A-Za-z0-9%._~!*'()-]*))?/g;
export const MEDIA_SRC_RE = /\/__media\/([A-Za-z0-9%._~!*'()-]+)/g;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
export const isImage = (name: string) => IMAGE_EXT.test(name);

/* ------------------------------ Schutz von Abschnitten ------------------------------ */

let protectorSeq = 0;

/**
 * Ersetzt fertige HTML-Stücke durch Marken, damit spätere Formatierungsregeln sie
 * nicht verändern. Jede Instanz hat eigene Marken – verschachtelte Umwandlungen
 * (Tabellenzellen, Hinweiskästen) lassen die Marken des äußeren Durchlaufs stehen.
 */
export class Protector {
  private readonly items: string[] = [];
  private readonly id = ++protectorSeq;

  put(html: string): string {
    this.items.push(html);
    return `\u0001${this.id}:${this.items.length - 1}\u0002`;
  }

  restore(text: string): string {
    let out = text;
    const own = new RegExp(`\u0001${this.id}:(\\d+)\u0002`, 'g');
    for (let i = 0; i < 5 && out.includes(`\u0001${this.id}:`); i++) {
      out = out.replace(own, (_, index: string) => this.items[Number(index)] ?? '');
    }
    return out;
  }
}

/** Eingabe vorbereiten: Zeilenenden vereinheitlichen, interne Markierungszeichen entfernen. */
export function normalizeSource(source: string): string {
  return source.replace(/\r\n?/g, '\n').replace(/[\u0001-\u0005]/g, '');
}

/* ------------------------------ Listen und Tabellen ------------------------------ */

export interface ListItem {
  depth: number;
  kind: 'ul' | 'ol' | 'dl-term' | 'dl-desc';
  html: string;
}

/** Verschachtelte Listen aus (Tiefe, Art, Inhalt) aufbauen. */
export function buildList(items: ListItem[]): string {
  let out = '';
  const stack: { tag: 'ul' | 'ol' | 'dl'; open: boolean }[] = [];
  const tagOf = (kind: ListItem['kind']): 'ul' | 'ol' | 'dl' => (kind === 'ol' ? 'ol' : kind === 'ul' ? 'ul' : 'dl');
  const closeTop = () => {
    const top = stack.pop()!;
    if (top.open) out += top.tag === 'dl' ? '' : '</li>';
    out += `</${top.tag}>`;
  };
  for (const item of items) {
    const depth = Math.max(1, Math.min(item.depth, 12));
    const tag = tagOf(item.kind);
    while (stack.length > depth) closeTop();
    if (stack.length === depth && stack[depth - 1].tag !== tag) closeTop();
    while (stack.length < depth) {
      const parent = stack[stack.length - 1];
      if (parent && parent.tag !== 'dl' && !parent.open) {
        out += '<li>';
        parent.open = true;
      }
      const levelTag = stack.length === depth - 1 ? tag : 'ul';
      out += `<${levelTag}>`;
      stack.push({ tag: levelTag, open: false });
    }
    const top = stack[depth - 1];
    if (tag === 'dl') {
      out += item.kind === 'dl-term' ? `<dt>${item.html}</dt>` : `<dd>${item.html}</dd>`;
      continue;
    }
    if (top.open) out += '</li>';
    out += `<li><p>${item.html}</p>`;
    top.open = true;
  }
  while (stack.length) closeTop();
  return out;
}

export interface TableCell {
  header: boolean;
  html: string;
  colspan?: number;
  rowspan?: number;
}

export function buildTable(rows: TableCell[][], caption?: string): string {
  const body = rows
    .filter((row) => row.length)
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => {
            const tag = cell.header ? 'th' : 'td';
            const span = `${cell.colspan && cell.colspan > 1 ? ` colspan="${cell.colspan}"` : ''}${cell.rowspan && cell.rowspan > 1 ? ` rowspan="${cell.rowspan}"` : ''}`;
            const html = cell.html.trim();
            return `<${tag}${span}>${BLOCK_START.test(html) ? html : `<p>${html}</p>`}</${tag}>`;
          })
          .join('')}</tr>`,
    )
    .join('');
  if (!body) return '';
  return `${caption ? `<p><strong>${caption}</strong></p>` : ''}<table><tbody>${body}</tbody></table>`;
}

/* ------------------------------ Hilfen ------------------------------ */

const BLOCK_START = /^<(p|ul|ol|pre|table|h[1-6]|div|blockquote|hr)\b/i;

/** Sentinels für Auszeichnungen, die das Maskieren von HTML überstehen. */
export const tagMark = (tag: string) => `\u0004${tag}\u0005`;

export function applyTagMarks(html: string): string {
  return html.replace(/\u0004(\/?[a-z0-9]+)\u0005/g, '<$1>');
}

const ENTITIES: Record<string, string> = {
  nbsp: '\u00a0',
  ndash: '–',
  mdash: '—',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  hellip: '…',
  euro: '€',
  copy: '©',
  reg: '®',
  trade: '™',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  sbquo: '‚',
  lsquo: '‘',
  rsquo: '’',
  laquo: '«',
  raquo: '»',
  auml: 'ä',
  ouml: 'ö',
  uuml: 'ü',
  Auml: 'Ä',
  Ouml: 'Ö',
  Uuml: 'Ü',
  szlig: 'ß',
  middot: '·',
  bull: '•',
  deg: '°',
  times: '×',
  rarr: '→',
  larr: '←',
  harr: '↔',
  rArr: '⇒',
};

/** HTML-Entities aus Wiki-Quelltexten in Zeichen umwandeln (werden später wieder sicher maskiert). */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, entity: string) => {
    if (entity.startsWith('#')) {
      const code = entity[1] === 'x' || entity[1] === 'X' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[entity] ?? m;
  });
}

export function codeBlock(code: string, language?: string | null): string {
  const lang = (language ?? '').trim().toLowerCase().replace(/[^a-z0-9#+-]/g, '');
  return `<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(code.replace(/^\n+|\n+$/g, ''))}</code></pre>`;
}

export function callout(variant: 'info' | 'note' | 'success' | 'warning' | 'error', html: string): string {
  const inner = /^\s*<(p|ul|ol|pre|table|h[1-6]|div|blockquote)\b/i.test(html) ? html : `<p>${html}</p>`;
  return `<div data-type="callout" data-variant="${variant}">${inner}</div>`;
}

export function note(text: string): string {
  return `<p><em>${escapeHtml(text)}</em></p>`;
}

/** Callout-Variante aus einem Namen ableiten (Vorlagen, Makros, WRAP-Klassen). */
export function calloutVariant(name: string): 'info' | 'note' | 'success' | 'warning' | 'error' | null {
  const n = name.toLowerCase();
  if (/(warn|achtung|caution|vorsicht|important|wichtig)/.test(n)) return 'warning';
  if (/(error|fehler|danger|gefahr|alert)/.test(n)) return 'error';
  if (/(success|erfolg|done|ok\b|tip|tipp)/.test(n)) return 'success';
  if (/(note|notiz|hinweis|todo)/.test(n)) return 'note';
  if (/(info|information)/.test(n)) return 'info';
  return null;
}

/** Datum robust in ISO-Format bringen (null bei unlesbaren Angaben). */
export function isoDate(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = typeof value === 'number' || /^\d+$/.test(String(value)) ? new Date(Number(value)) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** XML-Entities dekodieren (für Dump-Formate ohne vollständigen XML-Parser). */
export function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (m, entity: string) => {
    const e = entity.toLowerCase();
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'amp') return '&';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/** Alle (nicht verschachtelten) Elemente eines Tags mit Attributen und Inhalt. */
export function* xmlElements(xml: string, tag: string): Generator<{ attrs: string; inner: string }> {
  const re = new RegExp(`<${tag}(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
  for (const m of xml.matchAll(re)) yield { attrs: m[1] ?? '', inner: m[2] ?? '' };
}

/** Text des ersten Kind-Elements (dekodiert) oder null. */
export function xmlChild(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</${tag}>)`));
  if (!m) return null;
  return decodeXml((m[1] ?? '').replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1'));
}
