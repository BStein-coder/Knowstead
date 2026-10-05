/**
 * Textgewinnung aus Anhängen für die Volltextsuche.
 *
 * Läuft im Worker-Thread (siehe extract-worker.ts), damit große PDFs die
 * Anfragen anderer Personen nicht blockieren. Office-Formate (OOXML/ODF) sind
 * ZIP-Archive mit XML – dafür braucht es kein LibreOffice.
 */
import fs from 'node:fs';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';

/** Höchstens so viele Zeichen je Datei landen im Suchindex. */
export const MAX_TEXT = 2_000_000;
/** Größere Dateien werden nur mit Dateinamen indexiert. */
export const MAX_FILE_BYTES = 150 * 1024 * 1024;
/** Schutz vor ZIP-Bomben: einzelne entpackte Einträge höchstens so groß */
const MAX_ENTRY_BYTES = 60 * 1024 * 1024;

export type ExtractKind = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'vsdx' | 'odf' | 'text' | 'html' | 'rtf' | 'legacy';
export type ExtractStatus = 'done' | 'empty' | 'unsupported';

const TEXT_EXT = new Set([
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'xml', 'yaml', 'yml', 'log', 'ini', 'cfg', 'conf', 'properties', 'env',
  'sql', 'sh', 'bash', 'ps1', 'psm1', 'bat', 'cmd', 'py', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'java', 'kt', 'cs', 'go', 'rs',
  'php', 'rb', 'pl', 'c', 'h', 'cpp', 'hpp', 'css', 'scss', 'less', 'vue', 'svelte', 'toml', 'tf', 'hcl', 'dockerfile', 'eml', 'vtt', 'srt',
]);

export function extensionOf(filename: string): string {
  return path.extname(filename).slice(1).toLowerCase();
}

export function kindFor(filename: string, mime = ''): ExtractKind | null {
  const ext = extensionOf(filename);
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['docx', 'docm', 'dotx'].includes(ext)) return 'docx';
  if (['xlsx', 'xlsm', 'xltx'].includes(ext)) return 'xlsx';
  if (['pptx', 'pptm', 'ppsx', 'potx'].includes(ext)) return 'pptx';
  if (['vsdx', 'vsdm', 'vstx'].includes(ext)) return 'vsdx';
  if (['odt', 'ods', 'odp', 'odg', 'ott'].includes(ext)) return 'odf';
  if (['html', 'htm', 'xhtml'].includes(ext)) return 'html';
  if (ext === 'rtf') return 'rtf';
  if (['doc', 'xls', 'ppt', 'pps', 'vsd', 'vdx'].includes(ext)) return 'legacy';
  if (TEXT_EXT.has(ext) || /^text\//.test(mime) || mime === 'application/json') return 'text';
  return null;
}

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_m, entity: string) => {
    const e = entity.toLowerCase();
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    if (e === 'nbsp') return ' ';
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : ' ';
  });
}

export function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_TEXT);
}

/** XML zu Text: Absatz-Tags werden Zeilenumbrüche, übrige Tags entfallen. */
function xmlToText(xml: string, breaks: RegExp): string {
  return decodeEntities(xml.replace(breaks, '\n').replace(/<(w|a|text):tab\s*\/>/g, '\t').replace(/<[^>]+>/g, ''));
}

function numbered(names: string[], pattern: RegExp): string[] {
  const num = (n: string) => Number(n.match(/(\d+)\.xml$/)?.[1] ?? 0);
  return names.filter((n) => pattern.test(n)).sort((a, b) => num(a) - num(b));
}

function openZip(buf: Uint8Array, wanted: (name: string) => boolean): Record<string, string> {
  const files = unzipSync(buf, { filter: (f) => wanted(f.name) && f.originalSize <= MAX_ENTRY_BYTES });
  const out: Record<string, string> = {};
  for (const [name, data] of Object.entries(files)) out[name] = strFromU8(data);
  return out;
}

function docx(buf: Uint8Array): string {
  const files = openZip(buf, (n) => /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(n));
  const order = ['word/document.xml', ...Object.keys(files).filter((n) => n !== 'word/document.xml').sort()];
  return order
    .filter((n) => files[n])
    .map((n) => xmlToText(files[n].replace(/<w:instrText[^>]*>[\s\S]*?<\/w:instrText>/g, ''), /<\/w:p>|<w:br[^>]*\/>|<w:cr\s*\/>/g))
    .join('\n\n');
}

function xlsx(buf: Uint8Array): string {
  const files = openZip(buf, (n) => n === 'xl/sharedStrings.xml' || n === 'xl/workbook.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const parts: string[] = [];
  const workbook = files['xl/workbook.xml'];
  if (workbook) {
    const names = [...workbook.matchAll(/<sheet\b[^>]*\bname="([^"]*)"/g)].map((m) => decodeEntities(m[1]));
    if (names.length) parts.push(names.join('\n'));
  }
  if (files['xl/sharedStrings.xml']) parts.push(xmlToText(files['xl/sharedStrings.xml'], /<\/si>/g));
  for (const name of numbered(Object.keys(files), /^xl\/worksheets\/sheet\d+\.xml$/)) {
    const inline = [...files[name].matchAll(/<is>([\s\S]*?)<\/is>/g)].map((m) => xmlToText(m[1], /<\/t>/g));
    if (inline.length) parts.push(inline.join('\n'));
  }
  return parts.join('\n\n');
}

function pptx(buf: Uint8Array): string {
  const files = openZip(buf, (n) => /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/.test(n));
  const slides = numbered(Object.keys(files), /^ppt\/slides\/slide\d+\.xml$/).map((n) => xmlToText(files[n], /<\/a:p>/g));
  const notes = numbered(Object.keys(files), /^ppt\/notesSlides\/notesSlide\d+\.xml$/).map((n) => xmlToText(files[n], /<\/a:p>/g));
  return [...slides, ...notes].join('\n\n');
}

function vsdx(buf: Uint8Array): string {
  const files = openZip(buf, (n) => /^visio\/pages\/page\d+\.xml$/.test(n) || n === 'visio/pages/pages.xml');
  const parts: string[] = [];
  const index = files['visio/pages/pages.xml'];
  if (index) parts.push([...index.matchAll(/<Page\b[^>]*\bName(?:U)?="([^"]*)"/g)].map((m) => decodeEntities(m[1])).join('\n'));
  for (const name of numbered(Object.keys(files), /^visio\/pages\/page\d+\.xml$/)) {
    parts.push([...files[name].matchAll(/<Text>([\s\S]*?)<\/Text>/g)].map((m) => xmlToText(m[1], /<(cp|pp|tp)\b[^>]*\/>/g)).join('\n'));
  }
  return parts.join('\n\n');
}

function odf(buf: Uint8Array): string {
  const files = openZip(buf, (n) => n === 'content.xml');
  return files['content.xml'] ? xmlToText(files['content.xml'], /<\/text:(p|h)>|<text:line-break\s*\/>/g) : '';
}

function decodeText(buf: Uint8Array): string {
  const bytes = buf.byteLength > MAX_TEXT * 4 ? buf.subarray(0, MAX_TEXT * 4) : buf;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\ufeff/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

function html(buf: Uint8Array): string {
  const source = decodeText(buf)
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>|<br\s*\/?>/gi, '\n');
  return decodeEntities(source.replace(/<[^>]+>/g, ' '));
}

function rtf(buf: Uint8Array): string {
  const source = new TextDecoder('latin1').decode(buf);
  return source
    .replace(/\{\\\*[^{}]*\}/g, ' ')
    .replace(/\\'([0-9a-f]{2})/gi, (_m, hex: string) => new TextDecoder('windows-1252').decode(new Uint8Array([parseInt(hex, 16)])))
    .replace(/\\u(-?\d+)\??/g, (_m, code: string) => String.fromCharCode((Number(code) + 65536) % 65536))
    .replace(/\\(par|line)\b ?/g, '\n')
    .replace(/\\tab\b ?/g, '\t')
    .replace(/\\[a-z]+-?\d* ?/gi, '')
    .replace(/\\([{}\\])/g, '$1')
    .replace(/[{}]/g, '');
}

async function pdf(buf: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: buf, disableFontFace: true, useSystemFonts: false, verbosity: 0 });
  let text = '';
  try {
    const doc = await task.promise;
    for (let i = 1; i <= Math.min(doc.numPages, 2000) && text.length < MAX_TEXT; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      for (const item of content.items) {
        if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
      }
      text += '\n\n';
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return text;
}

/** Text aus einer Datei gewinnen. Altformate (.doc, .xls, .ppt, .vsd) wandelt der Dienst vorher per LibreOffice in PDF um. */
export async function extractText(file: string, filename: string, mime: string): Promise<{ status: ExtractStatus; text: string }> {
  const kind = kindFor(filename, mime);
  if (!kind || kind === 'legacy') return { status: 'unsupported', text: '' };
  const stat = fs.statSync(file);
  if (stat.size > MAX_FILE_BYTES) return { status: 'unsupported', text: '' };
  const buf = new Uint8Array(fs.readFileSync(file));
  let raw: string;
  switch (kind) {
    case 'pdf':
      raw = await pdf(buf);
      break;
    case 'docx':
      raw = docx(buf);
      break;
    case 'xlsx':
      raw = xlsx(buf);
      break;
    case 'pptx':
      raw = pptx(buf);
      break;
    case 'vsdx':
      raw = vsdx(buf);
      break;
    case 'odf':
      raw = odf(buf);
      break;
    case 'html':
      raw = html(buf);
      break;
    case 'rtf':
      raw = rtf(buf);
      break;
    default:
      raw = decodeText(buf);
  }
  const text = tidy(raw);
  return { status: text ? 'done' : 'empty', text };
}
