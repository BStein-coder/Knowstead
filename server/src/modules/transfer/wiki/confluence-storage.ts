/**
 * Confluence-Speicherformat („storage format“, XHTML mit `ac:`- und `ri:`-Elementen) nach Knowstead-HTML.
 *
 * Unterstützt: Überschriften, Absätze, Listen, Tabellen, Code, Zitate, Seiten- und Anhangslinks,
 * Bilder, Personen-Erwähnungen, Aufgabenlisten, Emoticons, Layouts sowie die gängigen Makros
 * (info, tip, note, warning, panel, code, noformat, expand, toc, children, attachments, status,
 * excerpt, anchor, jira, include, view-file). Unbekannte Makros bleiben als Hinweis mit ihrem Inhalt.
 */
import { parse, TextNode, type HTMLElement, type Node } from 'node-html-parser';
import { callout, codeBlock, escapeHtml, mediaSrc, note, wikiHref } from './common.ts';

export interface StorageContext {
  /** Schlüssel der Seite, zu der Inhalt und Anhänge gehören */
  pageKey: string;
  spaceKey: string;
  /** Seite anhand von Bereich und Titel finden (Schlüssel oder null) */
  resolvePage: (title: string, spaceKey: string) => string | null;
  /** Anzeigename zu einem Confluence-Benutzerschlüssel */
  userName: (key: string) => string | null;
  /** Makros, die nicht übernommen werden konnten (für den Bericht) */
  unsupported: Set<string>;
  /** Sprache der Installation – bestimmt die Schreibweise eines Datums, das als Text übernommen wird */
  locale?: 'de' | 'en';
}

const EMOTICONS: Record<string, string> = {
  smile: '🙂', sad: '🙁', cheeky: '😛', laugh: '😄', wink: '😉', 'thumbs-up': '👍', 'thumbs-down': '👎', information: 'ℹ️', tick: '✅', cross: '❌',
  warning: '⚠️', plus: '➕', minus: '➖', question: '❓', 'light-on': '💡', 'light-off': '💡', 'yellow-star': '⭐', 'red-star': '⭐', 'green-star': '⭐',
  'blue-star': '⭐', heart: '❤️', 'broken-heart': '💔',
};

const CALLOUTS: Record<string, 'info' | 'success' | 'warning' | 'error' | 'note'> = { info: 'info', tip: 'success', note: 'warning', warning: 'error', panel: 'note' };
const STATUS_COLORS: Record<string, string> = { grey: 'gray', gray: 'gray', red: 'red', yellow: 'yellow', green: 'green', blue: 'blue', purple: 'purple' };

const KEEP_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'sub', 'sup', 'code', 'pre', 'blockquote', 'br', 'hr',
  'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'span', 'div', 'a', 'img', 'dl', 'dt', 'dd', 'small', 'mark',
]);
const UNWRAP_TAGS = new Set(['colgroup', 'col', 'font', 'center', 'section', 'article', 'header', 'footer', 'nav', 'main']);

/** CDATA-Abschnitte in maskierten Text verwandeln – der HTML-Parser kennt kein CDATA. */
export function flattenCdata(xml: string): string {
  return xml.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, text: string) => escapeHtml(text));
}

function param(el: HTMLElement, name: string): string | null {
  for (const child of el.childNodes) {
    if (child instanceof TextNode) continue;
    const c = child as HTMLElement;
    if (c.rawTagName?.toLowerCase() === 'ac:parameter' && c.getAttribute('ac:name') === name) return c.text.trim();
  }
  return null;
}

function childTag(el: HTMLElement, tag: string): HTMLElement | null {
  for (const child of el.childNodes) {
    if (child instanceof TextNode) continue;
    if ((child as HTMLElement).rawTagName?.toLowerCase() === tag) return child as HTMLElement;
  }
  return null;
}

function blockify(html: string): string {
  return /^\s*<(p|ul|ol|pre|table|h[1-6]|div|blockquote|details)\b/i.test(html) ? html : `<p>${html}</p>`;
}

export function storageToHtml(storage: string, ctx: StorageContext): string {
  const root = parse(flattenCdata(storage), { lowerCaseTagName: false, comment: false, blockTextElements: { pre: true } });
  return convertChildren(root, ctx).trim();
}

function convertChildren(el: HTMLElement, ctx: StorageContext): string {
  return el.childNodes.map((n) => convertNode(n, ctx)).join('');
}

/** Ziel eines `ri:`-Elements: Seite oder Anhang (auch an anderer Seite). */
function resourceTarget(res: HTMLElement, ctx: StorageContext): { href: string; label: string; image: boolean } | null {
  const tag = res.rawTagName.toLowerCase();
  if (tag === 'ri:page' || tag === 'ri:blog-post') {
    const title = res.getAttribute('ri:content-title') ?? '';
    const space = res.getAttribute('ri:space-key') ?? ctx.spaceKey;
    const key = ctx.resolvePage(title, space);
    return { href: key ? wikiHref(key) : wikiHref(`missing:${space}:${title}`), label: title, image: false };
  }
  if (tag === 'ri:attachment') {
    const filename = res.getAttribute('ri:filename') ?? '';
    const onPage = childTag(res, 'ri:page');
    const ownerKey = onPage ? ctx.resolvePage(onPage.getAttribute('ri:content-title') ?? '', onPage.getAttribute('ri:space-key') ?? ctx.spaceKey) : ctx.pageKey;
    return { href: mediaSrc(`${ownerKey ?? ctx.pageKey}@${filename}`), label: filename, image: /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(filename) };
  }
  if (tag === 'ri:url') {
    const value = res.getAttribute('ri:value') ?? '';
    return /^(https?:|mailto:)/i.test(value) ? { href: value, label: value, image: true } : null;
  }
  if (tag === 'ri:user') {
    const name = ctx.userName(res.getAttribute('ri:userkey') ?? res.getAttribute('ri:account-id') ?? '') ?? res.getAttribute('ri:username') ?? 'Person';
    return { href: '', label: `@${name}`, image: false };
  }
  return null;
}

/** Erstes Element mit dem Namen `tag` (auch tiefer verschachtelt, z. B. in `ac:parameter`). */
function findDeep(el: HTMLElement, test: (tag: string) => boolean): HTMLElement | null {
  for (const child of el.childNodes) {
    if (child instanceof TextNode) continue;
    const c = child as HTMLElement;
    if (c.rawTagName && test(c.rawTagName.toLowerCase())) return c;
    const found = findDeep(c, test);
    if (found) return found;
  }
  return null;
}

function firstResource(el: HTMLElement): HTMLElement | null {
  for (const child of el.childNodes) {
    if (child instanceof TextNode) continue;
    const c = child as HTMLElement;
    if (c.rawTagName?.toLowerCase().startsWith('ri:')) return c;
  }
  return null;
}

function convertNode(node: Node, ctx: StorageContext): string {
  if (node instanceof TextNode) return node.rawText;
  const el = node as HTMLElement;
  const tag = (el.rawTagName ?? '').toLowerCase();
  if (!tag) return convertChildren(el, ctx);

  switch (tag) {
    case 'ac:link': {
      const res = firstResource(el);
      const target = res ? resourceTarget(res, ctx) : null;
      const body = childTag(el, 'ac:link-body') ?? childTag(el, 'ac:plain-text-link-body');
      const anchor = el.getAttribute('ac:anchor');
      const label = body ? convertChildren(body, ctx) : escapeHtml(target?.label ?? anchor ?? '');
      if (!target) return anchor ? `<a href="#${escapeHtml(anchor)}">${label}</a>` : label;
      if (!target.href) return `<strong>${label}</strong>`;
      return `<a href="${escapeHtml(target.href)}${anchor && !target.href.includes('#') ? `#${encodeURIComponent(anchor)}` : ''}">${label}</a>`;
    }
    case 'ac:image': {
      const res = firstResource(el);
      const target = res ? resourceTarget(res, ctx) : null;
      if (!target) return '';
      const width = Number(el.getAttribute('ac:width'));
      const alt = escapeHtml(el.getAttribute('ac:alt') ?? target.label);
      return `<img src="${escapeHtml(target.href)}" alt="${alt}"${width > 0 ? ` width="${Math.min(width, 2000)}"` : ''}>`;
    }
    case 'ac:emoticon':
      return EMOTICONS[el.getAttribute('ac:name') ?? ''] ?? el.getAttribute('ac:emoji-fallback') ?? '';
    case 'ac:task-list': {
      const items = el.childNodes
        .filter((c) => !(c instanceof TextNode) && (c as HTMLElement).rawTagName?.toLowerCase() === 'ac:task')
        .map((task) => {
          const t = task as HTMLElement;
          const done = (childTag(t, 'ac:task-status')?.text.trim() ?? '') === 'complete';
          const body = childTag(t, 'ac:task-body');
          return `<li data-type="taskItem" data-checked="${done}">${blockify(body ? convertChildren(body, ctx) : '')}</li>`;
        });
      return `<ul data-type="taskList">${items.join('')}</ul>`;
    }
    case 'ac:layout':
    case 'ac:layout-section':
    case 'ac:layout-cell':
    case 'ac:rich-text-body':
      return convertChildren(el, ctx);
    case 'ac:placeholder':
    case 'ac:parameter':
    case 'ac:task-id':
    case 'ac:adf-fallback':
      return '';
    case 'time': {
      const value = el.getAttribute('datetime');
      return value ? escapeHtml(new Date(value).toLocaleDateString(ctx.locale === 'en' ? 'en-GB' : 'de-DE')) : '';
    }
    case 'ac:structured-macro':
    case 'ac:macro':
      return macro(el, ctx);
    case 'ac:inline-comment-marker':
      return convertChildren(el, ctx);
  }

  if (tag.startsWith('ac:') || tag.startsWith('ri:')) return convertChildren(el, ctx);
  if (UNWRAP_TAGS.has(tag)) return convertChildren(el, ctx);
  if (!KEEP_TAGS.has(tag)) return convertChildren(el, ctx);

  const inner = convertChildren(el, ctx);
  if (tag === 'br' || tag === 'hr') return `<${tag}>`;
  if (tag === 'a') {
    const href = el.getAttribute('href') ?? '';
    return /^(https?:|mailto:|#)/i.test(href) ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
  }
  if (tag === 'img') {
    const src = el.getAttribute('src') ?? '';
    return /^https?:/i.test(src) ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(el.getAttribute('alt') ?? '')}">` : '';
  }
  if (tag === 'td' || tag === 'th') {
    const span = ['colspan', 'rowspan'].map((a) => (Number(el.getAttribute(a)) > 1 ? ` ${a}="${Number(el.getAttribute(a))}"` : '')).join('');
    return `<${tag}${span}>${inner}</${tag}>`;
  }
  if (tag === 'pre') return codeBlock(el.text);
  if (tag === 'b') return `<strong>${inner}</strong>`;
  if (tag === 'i') return `<em>${inner}</em>`;
  if (tag === 'strike' || tag === 'del') return `<s>${inner}</s>`;
  if (tag === 'div' || tag === 'span') return inner;
  return `<${tag}>${inner}</${tag}>`;
}

function macro(el: HTMLElement, ctx: StorageContext): string {
  const name = (el.getAttribute('ac:name') ?? '').toLowerCase();
  const rich = childTag(el, 'ac:rich-text-body');
  const plain = childTag(el, 'ac:plain-text-body');
  const body = rich ? convertChildren(rich, ctx).trim() : '';

  if (CALLOUTS[name]) {
    const title = param(el, 'title');
    return callout(CALLOUTS[name], `${title ? `<p><strong>${escapeHtml(title)}</strong></p>` : ''}${blockify(body || '&nbsp;')}`);
  }
  switch (name) {
    case 'code':
    case 'noformat':
    case 'code-block':
      return codeBlock(plain ? plain.text : (rich?.text ?? ''), param(el, 'language'));
    case 'expand': {
      const title = param(el, 'title') || 'Details';
      return `<details><summary>${escapeHtml(title)}</summary><div data-type="detailsContent">${blockify(body || '<p></p>')}</div></details>`;
    }
    case 'toc':
      return '<div data-type="toc"></div>';
    case 'children':
    case 'pagetree':
    case 'content-report-table':
      return `<div data-type="children" data-depth="${param(el, 'all') === 'true' ? 3 : Math.max(1, Math.min(3, Number(param(el, 'depth')) || 1))}"></div>`;
    case 'attachments':
      return '<div data-type="attachments"></div>';
    case 'status': {
      const color = STATUS_COLORS[(param(el, 'colour') ?? param(el, 'color') ?? 'grey').toLowerCase()] ?? 'gray';
      return `<span data-type="status" data-color="${color}">${escapeHtml((param(el, 'title') ?? '').toUpperCase() || 'STATUS')}</span>`;
    }
    case 'excerpt':
    case 'section':
    case 'column':
    case 'details':
    case 'div':
      return body;
    case 'anchor':
      return '';
    case 'jira': {
      const key = param(el, 'key');
      const server = param(el, 'server');
      return key ? `<span data-type="status" data-color="blue">${escapeHtml(key)}</span>${server ? ` <em>(${escapeHtml(server)})</em>` : ''}` : note('Jira-Abfrage aus Confluence (nicht übernommen)');
    }
    case 'include':
    case 'excerpt-include': {
      const res = findDeep(el, (t) => t === 'ri:page' || t === 'ri:blog-post');
      const title = res?.getAttribute('ri:content-title') ?? '';
      const key = title ? ctx.resolvePage(title, res?.getAttribute('ri:space-key') ?? ctx.spaceKey) : null;
      return title ? `<p><em>Eingebunden aus Confluence: <a href="${escapeHtml(key ? wikiHref(key) : wikiHref(`missing:${ctx.spaceKey}:${title}`))}">${escapeHtml(title)}</a></em></p>` : '';
    }
    case 'view-file':
    case 'viewpdf':
    case 'viewdoc':
    case 'viewppt':
    case 'viewxls':
    case 'multimedia':
    case 'widget': {
      const res = findDeep(el, (t) => t === 'ri:attachment' || t === 'ri:url');
      const target = res ? resourceTarget(res, ctx) : null;
      return target ? `<p><a href="${escapeHtml(target.href)}">${escapeHtml(target.label)}</a></p>` : '';
    }
  }
  ctx.unsupported.add(name || 'unbekannt');
  return `${note(`Confluence-Makro „${name || 'unbekannt'}“ wurde nicht übernommen.`)}${body}`;
}

/* ------------------------------------------------------------------ */
/* Gerendertes HTML aus dem HTML-Export                                */
/* ------------------------------------------------------------------ */

export interface RenderedContext {
  /** Dateiname einer Seite im Export → Schlüssel */
  pageForFile: (file: string) => string | null;
  /** Anhangspfad im Export (z. B. attachments/123/456.png) → Medienschlüssel */
  mediaForPath: (file: string) => string | null;
}

/** Gerendertes Confluence-HTML (HTML-Export) nach Knowstead-HTML. */
export function renderedToHtml(html: string, ctx: RenderedContext): string {
  const root = parse(html, { comment: false, blockTextElements: { pre: true, script: false, style: false } });
  for (const el of root.querySelectorAll('script, style, .hidden, .confluence-anchor-link')) el.remove();

  for (const box of root.querySelectorAll('.confluence-information-macro')) {
    const cls = box.getAttribute('class') ?? '';
    const variant = /macro-tip/.test(cls) ? 'success' : /macro-note/.test(cls) ? 'warning' : /macro-warning/.test(cls) ? 'error' : 'info';
    const body = box.querySelector('.confluence-information-macro-body')?.innerHTML ?? box.innerHTML;
    const title = box.querySelector('.title')?.text.trim();
    box.replaceWith(callout(variant, `${title ? `<p><strong>${escapeHtml(title)}</strong></p>` : ''}${blockify(body)}`));
  }
  for (const panel of root.querySelectorAll('.code.panel, .preformatted.panel')) {
    const pre = panel.querySelector('pre');
    const params = pre?.getAttribute('data-syntaxhighlighter-params') ?? '';
    const language = params.match(/brush:\s*([a-z0-9#+-]+)/i)?.[1] ?? null;
    panel.replaceWith(codeBlock(pre?.text ?? panel.text, language === 'text' ? null : language));
  }
  for (const expand of root.querySelectorAll('.expand-container')) {
    const title = expand.querySelector('.expand-control-text')?.text.trim() || 'Details';
    const body = expand.querySelector('.expand-content')?.innerHTML ?? '';
    expand.replaceWith(`<details><summary>${escapeHtml(title)}</summary><div data-type="detailsContent">${blockify(body)}</div></details>`);
  }
  for (const status of root.querySelectorAll('.status-macro')) {
    const cls = status.getAttribute('class') ?? '';
    const color = /aui-lozenge-error/.test(cls) ? 'red' : /aui-lozenge-success/.test(cls) ? 'green' : /aui-lozenge-current|aui-lozenge-moved/.test(cls) ? 'yellow' : /aui-lozenge-complete/.test(cls) ? 'blue' : 'gray';
    status.replaceWith(`<span data-type="status" data-color="${color}">${escapeHtml(status.text.trim())}</span>`);
  }
  for (const toc of root.querySelectorAll('.toc-macro, [data-macro-name="toc"]')) toc.replaceWith('<div data-type="toc"></div>');
  for (const img of root.querySelectorAll('img')) {
    const src = img.getAttribute('src') ?? '';
    const key = ctx.mediaForPath(src.split('?')[0]);
    if (key) img.setAttribute('src', mediaSrc(key));
    else if (!/^https?:/i.test(src)) img.remove();
    for (const attr of Object.keys(img.attributes)) if (!['src', 'alt', 'width'].includes(attr)) img.removeAttribute(attr);
  }
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (/^(https?:|mailto:|#)/i.test(href)) continue;
    const [file, anchor] = href.split('#');
    const media = ctx.mediaForPath(file.split('?')[0]);
    const page = media ? null : ctx.pageForFile(file.split('/').pop() ?? file);
    if (media) a.setAttribute('href', mediaSrc(media));
    else if (page) a.setAttribute('href', wikiHref(page, anchor));
    else a.setAttribute('href', wikiHref(`missing:${file}`));
  }
  return root.toString().trim();
}
