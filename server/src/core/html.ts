import sanitizeHtml from 'sanitize-html';
import { parse, TextNode, type HTMLElement } from 'node-html-parser';
import { truncate, unique } from './util.ts';

const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|var\(--[a-z0-9-]+\)|inherit|transparent|[a-z]{3,20})$/i;
const LENGTH = /^\d+(\.\d+)?(px|%|em|rem)?$/;

/** Erlaubte Tags/Attribute für Rich-Text-Inhalte (Editor-Ausgabe inkl. Makros). */
function richTextOptions(iframeHosts: string[]): sanitizeHtml.IOptions {
  return {
    allowedTags: [
      'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'ins', 'mark', 'code', 'pre', 'kbd',
      'blockquote', 'sub', 'sup', 'small', 'span', 'div', 'a', 'img', 'figure', 'figcaption',
      'ul', 'ol', 'li', 'label', 'input', 'dl', 'dt', 'dd', 'abbr',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'colgroup', 'col', 'caption',
      'details', 'summary', 'iframe',
    ],
    allowedAttributes: {
      '*': ['data-*', 'style', 'title', 'class', 'dir', 'lang'],
      a: ['href', 'target', 'rel', 'name'],
      img: ['src', 'alt', 'width', 'height', 'loading', 'decoding'],
      input: ['type', 'checked', 'disabled'],
      td: ['colspan', 'rowspan', 'colwidth'],
      th: ['colspan', 'rowspan', 'colwidth', 'scope'],
      col: ['span', 'width'],
      ol: ['start', 'type', 'reversed'],
      details: ['open'],
      iframe: ['src', 'width', 'height', 'allow', 'allowfullscreen', 'frameborder', 'loading', 'referrerpolicy'],
    },
    allowedClasses: {
      code: ['language-*', 'lang-*'],
      pre: ['language-*'],
      // „doku-*“: Klassen in Seiten, die vor der Umbenennung gespeichert wurden (fehlende Verweise, Vorschläge)
      '*': ['knowstead-*', 'doku-*', 'details', 'is-open'],
    },
    allowedStyles: {
      '*': {
        'text-align': [/^(left|right|center|justify|start|end)$/],
        color: [COLOR],
        'background-color': [COLOR],
        width: [LENGTH],
        'min-width': [LENGTH],
        'max-width': [LENGTH],
        height: [LENGTH],
        'font-size': [LENGTH],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'data'] },
    allowProtocolRelative: false,
    // Der Editor erzeugt nie annähernd so tiefe Verschachtelungen. Ohne Grenze legen rund 20 000 ineinander geöffnete
    // Tags (100 KB) die Textumwandlung (kubische Laufzeit in der Tiefe) beim Speichern für Minuten lahm.
    nestingLimit: 100,
    allowedIframeHostnames: iframeHosts,
    allowIframeRelativeUrls: false,
    transformTags: {
      a: (tagName, attribs) => {
        const out = { ...attribs };
        if (out.target === '_blank') out.rel = 'noopener noreferrer';
        return { tagName, attribs: out };
      },
      input: (tagName, attribs) => {
        // Nur Checkboxen (Aufgabenlisten) zulassen.
        if (attribs.type !== 'checkbox') return { tagName: 'span', attribs: {} };
        return { tagName, attribs };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'input' && frame.attribs.type !== 'checkbox',
  };
}

let cachedHosts = '';
let cachedOptions: sanitizeHtml.IOptions | null = null;

export function sanitizeRichText(html: string, iframeHosts: string[] = []): string {
  const key = iframeHosts.join(',');
  if (!cachedOptions || key !== cachedHosts) {
    cachedOptions = richTextOptions(iframeHosts);
    cachedHosts = key;
  }
  return sanitizeHtml(html, cachedOptions);
}

/** Einfache Formatierung für Kommentare. */
const COMMENT_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'a', 'span'],
  allowedAttributes: { a: ['href', 'target', 'rel'], span: ['data-type', 'data-id', 'data-label', 'class'], code: ['class'] },
  allowedClasses: { span: ['mention'], code: ['language-*'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  nestingLimit: 30,
  transformTags: { a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' }) },
};

export function sanitizeComment(html: string): string {
  return sanitizeHtml(html, COMMENT_OPTIONS);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Klartext aus HTML (für Suche, Auszüge, Diffs). */
export function htmlToText(html: string): string {
  if (!html) return '';
  const root = parse(html, { blockTextElements: { script: false, style: false, pre: true, noscript: false } });
  // Codeblöcke: Der Parser liefert den Inhalt von <pre> als rohes HTML (samt <code class=…>) – nur den Text behalten.
  for (const pre of root.querySelectorAll('pre')) {
    pre.set_content(new TextNode(pre.innerHTML.replace(/<[^>]*>/g, ''), pre));
  }
  // Mathematische Formeln als Text erhalten.
  for (const el of root.querySelectorAll('[data-latex]')) {
    el.set_content(` ${el.getAttribute('data-latex') ?? ''} `);
  }
  return root.structuredText
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function makeExcerpt(text: string, length = 240): string {
  return truncate(text.replace(/\s+/g, ' ').trim(), length);
}

const PAGE_HREF = /\/s\/[^/?#]+\/p\/(\d+)/;

/** Interne Seitenverweise (Links, eingebundene Seiten). */
export function extractPageLinks(html: string): number[] {
  if (!html) return [];
  const root = parse(html);
  const ids: number[] = [];
  for (const a of root.querySelectorAll('a')) {
    const dataId = a.getAttribute('data-page-id');
    if (dataId && /^\d+$/.test(dataId)) ids.push(Number(dataId));
    const m = (a.getAttribute('href') ?? '').match(PAGE_HREF);
    if (m) ids.push(Number(m[1]));
  }
  for (const el of root.querySelectorAll('[data-type="include-page"]')) {
    const id = el.getAttribute('data-page-id');
    if (id && /^\d+$/.test(id)) ids.push(Number(id));
  }
  return unique(ids);
}

/** Erwähnte Benutzer-IDs (`<span data-type="mention" data-id="…">`). */
export function extractMentions(html: string): number[] {
  if (!html) return [];
  const root = parse(html);
  return unique(
    root
      .querySelectorAll('span[data-type="mention"]')
      .map((el) => Number(el.getAttribute('data-id')))
      .filter((n) => Number.isInteger(n) && n > 0),
  );
}

export interface Heading {
  level: number;
  text: string;
  id: string;
}

export function headingId(text: string, used: Map<string, number>): string {
  const base =
    text
      .toLowerCase()
      .replace(/[äöüß]/g, (c) => ({ ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' })[c] ?? c)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'abschnitt';
  const count = used.get(base) ?? 0;
  used.set(base, count + 1);
  return count ? `${base}-${count + 1}` : base;
}

export function extractHeadings(html: string): Heading[] {
  if (!html) return [];
  const root = parse(html);
  const used = new Map<string, number>();
  return root.querySelectorAll('h1, h2, h3, h4, h5, h6').map((el) => {
    const text = el.textContent.trim();
    return { level: Number(el.tagName.slice(1)), text, id: headingId(text, used) };
  });
}

/** Aufgaben in einer Seite zählen bzw. umschalten. */
export function toggleTaskItem(html: string, index: number, checked: boolean): string | null {
  const root = parse(html);
  const items = root.querySelectorAll('li[data-type="taskItem"]');
  const item = items[index] as HTMLElement | undefined;
  if (!item) return null;
  item.setAttribute('data-checked', checked ? 'true' : 'false');
  const input = item.querySelector('input[type="checkbox"]');
  if (input) {
    if (checked) input.setAttribute('checked', 'checked');
    else input.removeAttribute('checked');
  }
  return root.toString();
}

export function countTasks(html: string): { total: number; done: number } {
  if (!html) return { total: 0, done: 0 };
  const root = parse(html);
  const items = root.querySelectorAll('li[data-type="taskItem"]');
  return { total: items.length, done: items.filter((i) => i.getAttribute('data-checked') === 'true').length };
}
