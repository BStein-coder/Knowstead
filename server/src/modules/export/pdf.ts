/**
 * PDF-Export mit Firmenvorlage (pdfmake, ohne Browser und ohne LibreOffice):
 * Deckblatt, Inhaltsverzeichnis mit Seitenzahlen, Kopf- und Fußzeile.
 */
import { createRequire } from 'node:module';
import type { Block, ExportDocument, ExportTemplate, Inline } from './model.ts';
import { translator } from '../../core/i18n.ts';
import { fillPlaceholders, imageSize, normalizeSvg, svgSize } from './model.ts';
import { fontFiles, segments, svgTextForPdf } from './glyphs.ts';

const require = createRequire(import.meta.url);

interface PdfMake {
  setFonts: (fonts: Record<string, Record<string, string>>) => void;
  setUrlAccessPolicy: (fn: (url: string) => boolean) => void;
  setLocalAccessPolicy: (fn: (file: string) => boolean) => void;
  createPdf: (doc: Record<string, unknown>) => { getBuffer: () => Promise<Buffer> };
}

let engine: PdfMake | null = null;

/**
 * pdfmake einmalig vorbereiten. Schriften werden über ihren echten Pfad eingebunden
 * (SVG-Texte laden die Schrift direkt über PDFKit); lesen darf pdfmake ausschließlich
 * diese Schriftdateien – keine Pfade oder URLs aus Seiteninhalten.
 */
function pdfmake(): PdfMake {
  if (engine) return engine;
  const instance = require('pdfmake') as PdfMake;
  const { roboto, liberation } = fontFiles();
  const courier = { normal: 'Courier', bold: 'Courier-Bold', italics: 'Courier-Oblique', bolditalics: 'Courier-BoldOblique' };
  instance.setFonts({ Roboto: roboto, Liberation: liberation, Courier: courier });
  const allowed = new Set([...Object.values(roboto), ...Object.values(liberation), ...Object.values(courier)]);
  instance.setUrlAccessPolicy(() => false);
  instance.setLocalAccessPolicy((file) => allowed.has(file));
  engine = instance;
  return instance;
}

/** SVG-Warnungen (nicht unterstützte Elemente) nicht ins Serverlog schreiben. */
const SVG_OPTIONS = { warningCallback: () => undefined };

const CALLOUT: Record<string, { fill: string; border: string; label: string }> = {
  info: { fill: '#eff6ff', border: '#2563eb', label: 'Info' },
  note: { fill: '#f5f3ff', border: '#7c3aed', label: 'Notiz' },
  tip: { fill: '#f0fdf4', border: '#16a34a', label: 'Tipp' },
  success: { fill: '#f0fdf4', border: '#16a34a', label: 'Erfolg' },
  warning: { fill: '#fffbeb', border: '#d97706', label: 'Achtung' },
  error: { fill: '#fef2f2', border: '#dc2626', label: 'Wichtig' },
  danger: { fill: '#fef2f2', border: '#dc2626', label: 'Wichtig' },
};

type Content = Record<string, unknown> | string | Content[];

/** Text mit Ersatzschrift für fehlende Zeichen (siehe glyphs.ts). */
function txt(value: string, mono = false): Content {
  const parts = segments(value, mono);
  if (parts.length === 1 && !parts[0].fallback) return parts[0].text;
  if (!parts.length) return '';
  return parts.map((p) => (p.fallback ? { text: p.text, font: 'Liberation' } : p.text));
}

/** Grafik für pdfmake: Texte an die Schriften anpassen, Ersatzschrift ähnelt Helvetica/Arial aus Diagrammen. */
function svgNode(svg: string, width: number): Record<string, unknown> {
  return { svg: svgTextForPdf(svg), width, font: 'Liberation', options: SVG_OPTIONS };
}

export async function renderPdf(doc: ExportDocument, tpl: ExportTemplate): Promise<Buffer> {
  const tr = translator(doc.locale ?? 'de');
  const color = /^#[0-9a-f]{6}$/i.test(tpl.primaryColor) ? tpl.primaryColor : '#2563eb';
  const pageWidth = tpl.paper === 'LETTER' ? 612 : 595.28;
  const margins: [number, number, number, number] = [56, 72, 56, 64];
  const contentWidth = pageWidth - margins[0] - margins[2];
  const multi = doc.chapters.length > 1;

  const inlineContent = (inlines: Inline[]): Content[] =>
    inlines.flatMap((i): Content[] => {
      if (i.br) return ['\n'];
      const run: Record<string, unknown> = {};
      if (i.bold) run.bold = true;
      if (i.italics) run.italics = true;
      const decoration = [i.underline || i.link ? 'underline' : null, i.strike ? 'lineThrough' : null].filter(Boolean);
      if (decoration.length) run.decoration = decoration.length === 1 ? decoration[0] : decoration;
      if (i.code) Object.assign(run, { font: 'Courier', fontSize: 9.5, background: '#f1f3f8' });
      if (i.link) Object.assign(run, { link: i.link, color });
      if (i.sup) run.sup = true;
      if (i.sub) run.sub = true;
      if (i.mark) run.background = '#fff3a3';
      return segments(i.text, i.code).map((part) => ({ ...run, text: part.text, ...(part.fallback ? { font: 'Liberation' } : {}) }));
    });

  const blockContent = (blocks: Block[], width: number): Content[] => blocks.flatMap((b) => one(b, width));

  const one = (block: Block, width: number): Content[] => {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(block.level, 6);
        return [{ text: inlineContent(block.inlines), style: `h${Math.min(level, 4)}`, tocItem: level <= 3, tocMargin: [(level - 1) * 14, 2, 0, 2] }];
      }
      case 'paragraph':
        return [{ text: inlineContent(block.inlines), margin: [0, 0, 0, 7], alignment: block.align ?? 'left' }];
      case 'list': {
        const items = block.items.map((item) => {
          const inner = blockContent(item.blocks, width - 18);
          if (item.checked !== undefined) {
            const first = inner[0] as Record<string, unknown> | undefined;
            if (first && 'text' in first) {
              const rest = Array.isArray(first.text) ? (first.text as Content[]) : [first.text as Content];
              first.text = [{ text: item.checked ? '[x] ' : '[ ] ', font: 'Courier', fontSize: 9.5 }, ...rest];
            }
          }
          return inner.length === 1 ? inner[0] : { stack: inner };
        });
        return [{ [block.ordered ? 'ol' : 'ul']: items, margin: [0, 0, 0, 8], markerColor: color }];
      }
      case 'code':
        return [
          {
            table: {
              widths: ['*'],
              body: [
                [
                  {
                    stack: [
                      ...(block.label ? [{ text: txt(block.label), fontSize: 8, color: '#69728a', margin: [0, 0, 0, 3] }] : []),
                      { text: txt(block.text, true), font: 'Courier', fontSize: 8.8, preserveLeadingSpaces: true },
                    ],
                    fillColor: '#f6f8fc',
                  },
                ],
              ],
            },
            layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 8, paddingRight: () => 8, paddingTop: () => 6, paddingBottom: () => 6 },
            margin: [0, 2, 0, 10],
          },
        ];
      case 'quote':
        return [
          {
            table: { widths: ['*'], body: [[{ stack: blockContent(block.blocks, width - 20), italics: true, color: '#4a5365' }]] },
            layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => '#ccd3e0', paddingLeft: () => 12, paddingTop: () => 2, paddingBottom: () => 2 },
            margin: [0, 2, 0, 10],
          },
        ];
      case 'callout': {
        const look = CALLOUT[block.variant] ?? CALLOUT.info;
        return [
          {
            table: { widths: ['*'], body: [[{ stack: [{ text: tr(look.label), bold: true, color: look.border, fontSize: 9, margin: [0, 0, 0, 3] }, ...blockContent(block.blocks, width - 24)], fillColor: look.fill }]] },
            layout: { hLineWidth: () => 0, vLineWidth: (i: number) => (i === 0 ? 3 : 0), vLineColor: () => look.border, paddingLeft: () => 12, paddingRight: () => 10, paddingTop: () => 8, paddingBottom: () => 4 },
            margin: [0, 2, 0, 10],
          },
        ];
      }
      case 'table': {
        const columns = Math.max(1, ...block.rows.map((r) => r.cells.reduce((n, c) => n + c.colspan, 0)));
        const body = block.rows.map((row) => {
          const cells: Content[] = [];
          for (const cell of row.cells) {
            const content: Record<string, unknown> = { stack: blockContent(cell.blocks, contentWidth / columns), fontSize: 9.5 };
            if (row.header) Object.assign(content, { bold: true, fillColor: '#eef2f8' });
            if (cell.colspan > 1) content.colSpan = cell.colspan;
            cells.push(content);
            for (let i = 1; i < cell.colspan; i++) cells.push({});
          }
          while (cells.length < columns) cells.push('');
          return cells.slice(0, columns);
        });
        if (!body.length) return [];
        return [
          {
            table: { headerRows: block.rows[0]?.header ? 1 : 0, widths: Array(columns).fill('*'), body, dontBreakRows: false },
            layout: { hLineColor: () => '#d7dde8', vLineColor: () => '#d7dde8', hLineWidth: () => 0.6, vLineWidth: () => 0.6, paddingTop: () => 4, paddingBottom: () => 2 },
            margin: [0, 2, 0, 10],
          },
        ];
      }
      case 'image': {
        const fit = Math.min(width, block.image.width * 0.75);
        return [
          { image: `data:${block.image.mime};base64,${block.image.data.toString('base64')}`, width: fit, margin: [0, 2, 0, block.caption ? 2 : 10] },
          ...(block.caption ? [{ text: txt(block.caption), fontSize: 8.5, color: '#69728a', margin: [0, 0, 0, 10] }] : []),
        ];
      }
      case 'svg': {
        const fit = Math.min(width, block.width * 0.75);
        return [
          { ...svgNode(block.svg, fit), margin: [0, 2, 0, block.caption ? 2 : 10] },
          ...(block.caption ? [{ text: txt(block.caption), fontSize: 8.5, color: '#69728a', margin: [0, 0, 0, 10] }] : []),
        ];
      }
      case 'hr':
        return [{ canvas: [{ type: 'line', x1: 0, y1: 4, x2: width, y2: 4, lineWidth: 0.7, lineColor: '#d7dde8' }], margin: [0, 4, 0, 10] }];
      case 'note':
        return [{ text: txt(tr(block.text)), italics: true, color: '#69728a', fontSize: 9.5, margin: [0, 0, 0, 8] }];
      default:
        return [];
    }
  };

  const content: Content[] = [];

  // Deckblatt
  if (tpl.coverPage) {
    const logo = logoContent(tpl.logo, 160);
    const meta = [
      [tr('Stand'), doc.date],
      [tr('Version'), tr(doc.version)],
      doc.owner ? [tr('Verantwortlich'), doc.owner] : null,
      doc.author ? [tr('Zuletzt bearbeitet von'), doc.author] : null,
      tpl.classification ? [tr('Klassifizierung'), tpl.classification] : null,
    ].filter((row): row is string[] => !!row);
    content.push(
      { canvas: [{ type: 'rect', x: 0, y: 0, w: contentWidth, h: 5, color }], margin: [0, 0, 0, 36] },
      ...(logo ? [{ ...logo, margin: [0, 0, 0, 40] }] : []),
      ...(tpl.company ? [{ text: txt(tpl.company), fontSize: 12, color: '#69728a', margin: [0, logo ? 0 : 60, 0, 10] }] : []),
      { text: txt(doc.title), fontSize: 30, bold: true, color: '#0b1220', margin: [0, 0, 0, 10] },
      { text: txt(doc.subtitle), fontSize: 14, color, margin: [0, 0, 0, 50] },
      {
        table: { widths: [120, '*'], body: meta.map(([k, v]) => [{ text: k, color: '#69728a', fontSize: 10 }, { text: txt(v), fontSize: 10 }]) },
        layout: 'noBorders',
      },
      { text: '', pageBreak: 'after' },
    );
  }

  const hasHeadings = doc.chapters.some((c) => multi || c.blocks.some((b) => b.type === 'heading'));
  if (tpl.toc && hasHeadings) {
    content.push({ toc: { title: { text: tr('Inhaltsverzeichnis'), style: 'tocTitle' }, numberStyle: { color: '#4a5365' } } }, { text: '', pageBreak: 'after' });
  }

  doc.chapters.forEach((chapter, index) => {
    if (multi || !tpl.coverPage) {
      const level = multi ? Math.min(chapter.level, 3) : 1;
      content.push({
        text: txt(chapter.title),
        style: `h${level}`,
        tocItem: multi,
        tocMargin: [(level - 1) * 14, 2, 0, 2],
        pageBreak: index > 0 && chapter.level === 1 ? 'before' : undefined,
      });
    }
    content.push(...blockContent(chapter.blocks, contentWidth));
  });

  const header = txt(fillPlaceholders(tpl.headerText, doc, tpl));
  const footer = txt(fillPlaceholders(tpl.footerText, doc, tpl));
  const classification = txt(tpl.classification);
  const skip = (page: number) => tpl.coverPage && page === 1;

  const definition = {
    pageSize: tpl.paper === 'LETTER' ? 'LETTER' : 'A4',
    pageMargins: margins,
    info: { title: doc.title, author: tpl.company || doc.author, subject: doc.subtitle, creator: 'Knowstead' },
    header: (page: number) =>
      skip(page)
        ? null
        : {
            margin: [margins[0], 28, margins[2], 0],
            columns: [
              { text: header, fontSize: 8.5, color: '#69728a' },
              { text: classification, alignment: 'right', fontSize: 8.5, bold: true, color },
            ],
          },
    footer: (page: number, pages: number) =>
      skip(page)
        ? null
        : {
            margin: [margins[0], 22, margins[2], 0],
            columns: [
              { text: footer, fontSize: 8.5, color: '#69728a' },
              { text: tr(`Seite ${page} von ${pages}`), alignment: 'right', fontSize: 8.5, color: '#69728a' },
            ],
          },
    content,
    styles: {
      h1: { fontSize: 20, bold: true, color: '#0b1220', margin: [0, 14, 0, 8] },
      h2: { fontSize: 15, bold: true, color, margin: [0, 12, 0, 6] },
      h3: { fontSize: 12.5, bold: true, color: '#0b1220', margin: [0, 10, 0, 5] },
      h4: { fontSize: 11, bold: true, color: '#4a5365', margin: [0, 8, 0, 4] },
      tocTitle: { fontSize: 18, bold: true, color: '#0b1220', margin: [0, 0, 0, 12] },
    },
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.25, color: '#232936' },
  };

  const engine = pdfmake();
  try {
    return await engine.createPdf(definition).getBuffer();
  } catch (err) {
    // Einzelne fehlerhafte Grafiken sollen nicht den ganzen Export verhindern.
    if (!/svg|image/i.test(String(err))) throw err;
    return engine.createPdf({ ...definition, content: stripGraphics(definition.content) as Content[] }).getBuffer();
  }
}

/** Grafiken durch Hinweise ersetzen – Layout-Funktionen der Tabellen bleiben erhalten. */
function stripGraphics(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripGraphics);
  if (!node || typeof node !== 'object') return node;
  const record = node as Record<string, unknown>;
  if ('svg' in record || 'image' in record) return { text: 'Grafik konnte nicht eingebettet werden', italics: true, color: '#69728a', fontSize: 9 };
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) out[key] = typeof value === 'function' ? value : stripGraphics(value);
  return out;
}

/** Logo als pdfmake-Knoten (PNG, JPEG oder SVG aus einer data-URL). */
function logoContent(logo: string, maxWidth: number): Record<string, unknown> | null {
  const m = logo.match(/^data:(image\/(?:png|jpeg|svg\+xml));base64,([a-z0-9+/=]+)$/i);
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  if (m[1] === 'image/svg+xml') {
    const svg = normalizeSvg(data.toString('utf8'));
    return svgNode(svg, Math.min(maxWidth, svgSize(svg).width));
  }
  const size = imageSize(data, m[1]);
  return size ? { image: logo, width: Math.min(maxWidth, size.width) } : null;
}
