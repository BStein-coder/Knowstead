/**
 * Zwischenmodell für Dokument-Exporte (PDF, Word).
 *
 * Das gespeicherte Seiten-HTML (nach statischer Makro-Auflösung) wird in eine
 * kleine Menge von Blöcken übersetzt, die beide Ausgabeformate verstehen. Externe
 * Bilder werden bewusst nicht nachgeladen (kein Serverzugriff auf fremde Adressen);
 * Anhänge werden nur eingebettet, wenn die exportierende Person sie sehen darf.
 */
import { HTMLElement, type Node, parse } from 'node-html-parser';
import type { ExportTemplateSettings } from '../../core/settings.ts';
import type { Locale } from '../../core/i18n.ts';

export interface Inline {
  text: string;
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  link?: string;
  sup?: boolean;
  sub?: boolean;
  mark?: boolean;
  br?: boolean;
}

export interface ImageData {
  data: Buffer;
  mime: 'image/png' | 'image/jpeg';
  width: number;
  height: number;
}

export type Block =
  | { type: 'heading'; level: number; inlines: Inline[] }
  | { type: 'paragraph'; inlines: Inline[]; align?: 'left' | 'center' | 'right' | 'justify' }
  | { type: 'list'; ordered: boolean; items: { blocks: Block[]; checked?: boolean }[] }
  | { type: 'code'; text: string; label?: string }
  | { type: 'quote'; blocks: Block[] }
  | { type: 'callout'; variant: string; blocks: Block[] }
  | { type: 'table'; rows: { header: boolean; cells: { blocks: Block[]; colspan: number }[] }[] }
  | { type: 'image'; image: ImageData; caption?: string }
  | { type: 'svg'; svg: string; width: number; height: number; caption?: string }
  | { type: 'hr' }
  | { type: 'note'; text: string };

export interface ModelContext {
  baseUrl: string;
  /** Bild eines Anhangs laden – `null`, wenn nicht vorhanden oder nicht sichtbar */
  attachmentImage: (id: number) => { data: Buffer; mime: string } | null;
}

const MAX_DEPTH = 40;

/* ------------------------------ Bilder ------------------------------ */

/** Abmessungen aus PNG- oder JPEG-Kopfdaten lesen (ohne Bildbibliothek). */
export function imageSize(data: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png' && data.length > 24 && data.readUInt32BE(12) === 0x49484452) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (mime === 'image/jpeg' && data[0] === 0xff && data[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < data.length) {
      if (data[offset] !== 0xff) return null;
      const marker = data[offset + 1];
      const length = data.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: data.readUInt16BE(offset + 5), width: data.readUInt16BE(offset + 7) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

/** Bildformat anhand der ersten Bytes bestimmen. */
export function sniffImage(data: Buffer): 'image/png' | 'image/jpeg' | 'image/svg+xml' | null {
  if (data.length > 8 && data.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (data.length > 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  // trimStart entfernt auch ein vorangestelltes BOM (U+FEFF)
  const head = data.subarray(0, 1024).toString('utf8').trimStart();
  if (/^(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE svg[^>]*>\s*)?<svg\b/i.test(head)) return 'image/svg+xml';
  return null;
}

/** SVG-Abmessungen aus width/height oder viewBox. */
export function svgSize(svg: string): { width: number; height: number } {
  const tag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? '';
  const num = (name: string) => {
    const m = tag.match(new RegExp(`\\b${name}="([\\d.]+)(px)?"`, 'i'));
    return m ? Number(m[1]) : NaN;
  };
  let width = num('width');
  let height = num('height');
  const viewBox = tag.match(/\bviewBox="([^"]+)"/i)?.[1].trim().split(/[\s,]+/).map(Number);
  if ((!width || !height) && viewBox?.length === 4) {
    width = width || viewBox[2];
    height = height || viewBox[3];
  }
  return { width: width > 0 ? width : 400, height: height > 0 ? height : 300 };
}

/**
 * SVG für PDF/Word vereinfachen: `<switch>` wie ein Betrachter ohne HTML-Unterstützung
 * auflösen (draw.io legt Beschriftungen als foreignObject mit Text-Ersatz ab) und
 * CSS-Funktionen entfernen, die Druck-Renderer nicht kennen (`var()`, `light-dark()`).
 */
export function normalizeSvg(svg: string): string {
  if (!/<switch\b|<script\b|var\(|light-dark\(/i.test(svg)) return svg;
  const root = parse(svg, { comment: false, blockTextElements: { style: true, script: false } });
  const walk = (node: HTMLElement) => {
    for (const child of [...node.childNodes]) {
      if (!isElement(child)) continue;
      const name = tag(child);
      if (name === 'script') {
        child.remove();
        continue;
      }
      if (name === 'switch') {
        const chosen = child.childNodes.find(
          (c): c is HTMLElement => isElement(c) && tag(c) !== 'foreignobject' && !c.hasAttribute('requiredFeatures') && !c.hasAttribute('requiredExtensions'),
        );
        if (!chosen || /Text is not SVG|svg-export-text-problems/i.test(chosen.toString())) child.remove();
        else {
          walk(chosen);
          child.replaceWith(`<g>${chosen.toString()}</g>`);
        }
        continue;
      }
      const style = child.getAttribute('style');
      if (style && /var\(|light-dark\(/i.test(style)) {
        const kept = style.split(';').filter((d) => d.trim() && !/var\(|light-dark\(/i.test(d));
        if (kept.length) child.setAttribute('style', kept.join(';'));
        else child.removeAttribute('style');
      }
      walk(child);
    }
  };
  walk(root);
  return root.toString();
}

function decodeDataUrl(src: string): { data: Buffer; mime: string } | null {
  const m = src.match(/^data:(image\/(?:png|jpeg|jpg|svg\+xml));base64,([a-z0-9+/=\s]+)$/i);
  if (!m) return null;
  const mime = m[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : m[1].toLowerCase();
  return { data: Buffer.from(m[2].replace(/\s+/g, ''), 'base64'), mime };
}

/** Ein Bild aus `src` als Block – Anhang, data-URL oder Hinweis. */
function imageBlock(src: string, alt: string, ctx: ModelContext, caption?: string): Block {
  let source: { data: Buffer; mime: string } | null = null;
  const attachment = src.match(/\/api\/v1\/attachments\/(\d+)\/(?:raw|preview)/);
  if (attachment) source = ctx.attachmentImage(Number(attachment[1]));
  else if (src.startsWith('data:')) source = decodeDataUrl(src);
  // Format am Inhalt erkennen – Dateiendung und Typangabe können falsch sein
  if (source) source = { data: source.data, mime: sniffImage(source.data) ?? 'application/octet-stream' };
  if (source?.mime === 'image/svg+xml') {
    const svg = source.data.toString('utf8');
    if (/<svg\b/i.test(svg)) return { type: 'svg', svg: normalizeSvg(svg), ...svgSize(svg), caption };
  }
  if (source && (source.mime === 'image/png' || source.mime === 'image/jpeg')) {
    const size = imageSize(source.data, source.mime);
    if (size) return { type: 'image', image: { data: source.data, mime: source.mime, ...size }, caption };
  }
  const label = caption || alt;
  return { type: 'note', text: label ? `Bild: ${label}` : 'Bild (in diesem Format nicht exportierbar)' };
}

/* ------------------------------ Text ------------------------------ */

function absoluteLink(href: string, baseUrl: string): string | undefined {
  if (/^(https?:|mailto:)/i.test(href)) return href;
  if (href.startsWith('/')) return `${baseUrl}${href}`;
  return undefined;
}

type Marks = Omit<Inline, 'text' | 'br'>;

function isElement(node: Node): node is HTMLElement {
  return node instanceof HTMLElement;
}

function tag(node: HTMLElement): string {
  return (node.rawTagName ?? '').toLowerCase();
}

function textOf(node: Node): string {
  return node.text ?? '';
}

function collectInlines(node: Node, marks: Marks, ctx: ModelContext, out: Inline[], depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (!isElement(node)) {
    const text = textOf(node).replace(/\s+/g, ' ');
    if (text) out.push({ text, ...marks });
    return;
  }
  const name = tag(node);
  if (name === 'br') {
    out.push({ text: '', br: true });
    return;
  }
  if (name === 'img' || name === 'script' || name === 'style') return;
  const next: Marks = { ...marks };
  if (name === 'strong' || name === 'b') next.bold = true;
  if (name === 'em' || name === 'i') next.italics = true;
  if (name === 'u') next.underline = true;
  if (name === 's' || name === 'del' || name === 'strike') next.strike = true;
  if (name === 'code' || name === 'kbd') next.code = true;
  if (name === 'sup') next.sup = true;
  if (name === 'sub') next.sub = true;
  if (name === 'mark') next.mark = true;
  if (name === 'a') {
    const link = absoluteLink(node.getAttribute('href') ?? '', ctx.baseUrl);
    if (link) next.link = link;
  }
  const type = node.getAttribute('data-type');
  if (type === 'status') {
    out.push({ text: `[${node.text.trim()}]`, ...next, bold: true });
    return;
  }
  if (type === 'mention') {
    out.push({ text: `@${(node.getAttribute('data-label') ?? node.text).replace(/^@/, '')}`, ...next, bold: true });
    return;
  }
  if (node.getAttribute('data-latex')) {
    out.push({ text: node.getAttribute('data-latex') ?? '', ...next, code: true });
    return;
  }
  for (const child of node.childNodes) collectInlines(child, next, ctx, out, depth + 1);
}

function trimInlines(inlines: Inline[]): Inline[] {
  const list = inlines.filter((i) => i.br || i.text);
  while (list.length && !list[0].br && !list[0].text.trim()) list.shift();
  while (list.length && (list[list.length - 1].br || !list[list.length - 1].text.trim())) list.pop();
  if (list.length) {
    if (!list[0].br) list[0] = { ...list[0], text: list[0].text.replace(/^\s+/, '') };
    const last = list.length - 1;
    if (!list[last].br) list[last] = { ...list[last], text: list[last].text.replace(/\s+$/, '') };
  }
  return list;
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'pre', 'blockquote', 'table', 'hr', 'div', 'section', 'article', 'details', 'figure', 'nav', 'img', 'iframe', 'header', 'footer', 'aside']);

/* ------------------------------ Blöcke ------------------------------ */

function listBlock(node: HTMLElement, ctx: ModelContext, depth: number): Block {
  const ordered = tag(node) === 'ol';
  const taskList = node.getAttribute('data-type') === 'taskList';
  const items: { blocks: Block[]; checked?: boolean }[] = [];
  for (const li of node.childNodes) {
    if (!isElement(li) || tag(li) !== 'li') continue;
    const hasBlocks = li.childNodes.some((c) => isElement(c) && BLOCK_TAGS.has(tag(c)));
    let blocks: Block[];
    if (hasBlocks) blocks = toBlocks(li, ctx, depth + 1);
    else {
      const inlines: Inline[] = [];
      for (const child of li.childNodes) collectInlines(child, {}, ctx, inlines);
      blocks = [{ type: 'paragraph', inlines: trimInlines(inlines) }];
    }
    items.push({ blocks, checked: taskList ? li.getAttribute('data-checked') === 'true' : undefined });
  }
  return { type: 'list', ordered, items };
}

function tableBlock(node: HTMLElement, ctx: ModelContext, depth: number): Block {
  const rows: { header: boolean; cells: { blocks: Block[]; colspan: number }[] }[] = [];
  for (const tr of node.querySelectorAll('tr')) {
    const cells = tr.childNodes.filter((c): c is HTMLElement => isElement(c) && (tag(c) === 'td' || tag(c) === 'th'));
    if (!cells.length) continue;
    rows.push({
      header: cells.every((c) => tag(c) === 'th') || tag(tr.parentNode as HTMLElement) === 'thead',
      cells: cells.map((cell) => ({
        colspan: Math.max(1, Math.min(20, Number(cell.getAttribute('colspan')) || 1)),
        blocks: toBlocks(cell, ctx, depth + 1),
      })),
    });
  }
  return { type: 'table', rows };
}

function macroBlocks(node: HTMLElement, ctx: ModelContext, depth: number): Block[] | null {
  const type = node.getAttribute('data-type');
  switch (type) {
    case 'callout':
      return [{ type: 'callout', variant: node.getAttribute('data-variant') ?? 'info', blocks: toBlocks(node, ctx, depth + 1) }];
    case 'drawio':
    case 'whiteboard': {
      const svg = node.getAttribute('data-svg') ?? '';
      const title = node.getAttribute('data-title') ?? '';
      return svg ? [imageBlock(svg, title, ctx, title || undefined)] : [{ type: 'note', text: `Diagramm${title ? `: ${title}` : ''}` }];
    }
    case 'gallery': {
      let items: { src?: string; caption?: string; alt?: string }[] = [];
      try {
        items = JSON.parse(node.getAttribute('data-items') ?? '[]');
      } catch {
        /* ungültige Galerie-Daten: nichts ausgeben */
      }
      return items.filter((i) => i.src).map((i) => imageBlock(i.src!, i.alt ?? '', ctx, i.caption || undefined));
    }
    case 'pdf':
    case 'file':
      return [{ type: 'note', text: `Anhang: ${node.getAttribute('data-name') || 'Datei'}` }];
    case 'task-list':
      return [{ type: 'note', text: 'Aufgaben aus dem Planer – aktuelle Liste in der Online-Ansicht' }];
    case 'embed':
    case 'api-data':
      return [{ type: 'note', text: `Eingebetteter Inhalt${node.getAttribute('data-src') ? `: ${node.getAttribute('data-src')}` : ''}` }];
    case 'math': {
      const latex = node.getAttribute('data-latex') ?? node.text;
      return [{ type: 'code', text: latex, label: 'Formel' }];
    }
    default:
      return null;
  }
}

export function toBlocks(node: HTMLElement, ctx: ModelContext, depth = 0): Block[] {
  const blocks: Block[] = [];
  if (depth > MAX_DEPTH) return blocks;
  let pending: Inline[] = [];
  const flush = () => {
    const inlines = trimInlines(pending);
    if (inlines.some((i) => i.br || i.text.trim())) blocks.push({ type: 'paragraph', inlines });
    pending = [];
  };

  for (const child of node.childNodes) {
    if (!isElement(child)) {
      collectInlines(child, {}, ctx, pending);
      continue;
    }
    const name = tag(child);
    if (!BLOCK_TAGS.has(name)) {
      collectInlines(child, {}, ctx, pending);
      continue;
    }
    flush();
    const macro = macroBlocks(child, ctx, depth);
    if (macro) {
      blocks.push(...macro);
      continue;
    }
    if (/^h[1-6]$/.test(name)) {
      const inlines: Inline[] = [];
      collectInlines(child, {}, ctx, inlines);
      blocks.push({ type: 'heading', level: Number(name.slice(1)), inlines: trimInlines(inlines) });
    } else if (name === 'p') {
      const inlines: Inline[] = [];
      collectInlines(child, {}, ctx, inlines);
      const style = child.getAttribute('style') ?? '';
      const align = style.match(/text-align:\s*(left|center|right|justify)/)?.[1] as 'left' | 'center' | 'right' | 'justify' | undefined;
      const trimmed = trimInlines(inlines);
      if (trimmed.length) blocks.push({ type: 'paragraph', inlines: trimmed, align });
      for (const img of child.querySelectorAll('img')) blocks.push(imageBlock(img.getAttribute('src') ?? '', img.getAttribute('alt') ?? '', ctx));
    } else if (name === 'ul' || name === 'ol') {
      blocks.push(listBlock(child, ctx, depth));
    } else if (name === 'pre') {
      const code = child.querySelector('code');
      const language = (code?.getAttribute('class') ?? '').match(/language-([\w-]+)/)?.[1];
      blocks.push({ type: 'code', text: (code ?? child).text.replace(/\n$/, ''), label: language === 'mermaid' ? 'Mermaid-Diagramm (Quelltext)' : language });
    } else if (name === 'blockquote') {
      blocks.push({ type: 'quote', blocks: toBlocks(child, ctx, depth + 1) });
    } else if (name === 'table') {
      blocks.push(tableBlock(child, ctx, depth));
    } else if (name === 'hr') {
      blocks.push({ type: 'hr' });
    } else if (name === 'img') {
      blocks.push(imageBlock(child.getAttribute('src') ?? '', child.getAttribute('alt') ?? '', ctx));
    } else if (name === 'iframe') {
      blocks.push({ type: 'note', text: `Eingebetteter Inhalt: ${child.getAttribute('src') ?? ''}` });
    } else if (name === 'nav' && child.classList.contains('toc')) {
      // Das Dokument hat ein eigenes Inhaltsverzeichnis.
    } else if (name === 'details') {
      const summary = child.querySelector('summary');
      if (summary) {
        const inlines: Inline[] = [];
        collectInlines(summary, { bold: true }, ctx, inlines);
        blocks.push({ type: 'paragraph', inlines: trimInlines(inlines) });
        summary.remove();
      }
      blocks.push(...toBlocks(child, ctx, depth + 1));
    } else {
      blocks.push(...toBlocks(child, ctx, depth + 1));
    }
  }
  flush();
  return blocks;
}

export function htmlToBlocks(html: string, ctx: ModelContext): Block[] {
  // <pre> wird normal geparst, damit <code class="language-…"> erkannt wird
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false } });
  return toBlocks(root, ctx);
}

/** Überschriften verschieben (Kapitel einer Seite liegen unter der Seitenüberschrift). */
export function shiftHeadings(blocks: Block[], by: number): Block[] {
  if (!by) return blocks;
  return blocks.map((b) => {
    if (b.type === 'heading') return { ...b, level: Math.min(6, b.level + by) };
    if (b.type === 'quote' || b.type === 'callout') return { ...b, blocks: shiftHeadings(b.blocks, by) };
    return b;
  });
}

/** Kleinste Überschriftenebene im Inhalt (0 = keine Überschriften). */
export function minHeadingLevel(blocks: Block[]): number {
  let min = 0;
  for (const b of blocks) {
    const level = b.type === 'heading' ? b.level : b.type === 'quote' || b.type === 'callout' ? minHeadingLevel(b.blocks) : 0;
    if (level && (!min || level < min)) min = level;
  }
  return min;
}

export interface ExportChapter {
  title: string;
  /** 1 = Hauptseite, 2+ = Unterseiten */
  level: number;
  blocks: Block[];
}

export interface ExportDocument {
  /** Sprache der festen Beschriftungen (Deckblatt, Inhaltsverzeichnis, Hinweise) */
  locale?: Locale;
  title: string;
  subtitle: string;
  author: string;
  owner: string;
  date: string;
  version: string;
  chapters: ExportChapter[];
}

export type ExportTemplate = ExportTemplateSettings;

/**
 * Unveränderte Vorgaben der Firmenvorlage folgen der Sprache des Dokuments – gleich, in welcher Sprache die
 * Vorlage gespeichert wurde (die Administration zeigt die Vorgabe in der Sprache der Oberfläche). Eigene Texte
 * bleiben, wie sie sind.
 */
const DEFAULT_TEMPLATE_TEXTS: Record<Locale, string>[] = [{ de: '{space} · Stand {date} · {version}', en: '{space} · Date {date} · {version}' }];

function templateText(template: string, locale: Locale): string {
  const builtIn = DEFAULT_TEMPLATE_TEXTS.find((text) => text.de === template || text.en === template);
  return builtIn ? builtIn[locale] : template;
}

/** Platzhalter in Kopf-/Fußzeilen ersetzen; Trennzeichen leerer Werte entfallen. */
export function fillPlaceholders(template: string, doc: ExportDocument, tpl: ExportTemplate): string {
  const text = templateText(template, doc.locale ?? 'de');
  const values: Record<string, string> = {
    company: tpl.company,
    title: doc.title,
    space: doc.subtitle,
    date: doc.date,
    version: doc.version,
    author: doc.author,
    owner: doc.owner,
    classification: tpl.classification,
  };
  return text
    .replace(/\{(\w+)\}/g, (m, key: string) => values[key] ?? m)
    .replace(/(\s+[·|•–])(\s+[·|•–])+(?=\s)/g, '$1')
    .replace(/^[\s·|•–]+|[\s·|•–]+$/g, '');
}
