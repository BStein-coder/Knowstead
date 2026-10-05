/**
 * Word-Export (.docx) mit Firmenvorlage: Deckblatt, Inhaltsverzeichnis (Word-Feld,
 * wird beim Öffnen aktualisiert), Kopf- und Fußzeile mit Seitenzahlen.
 */
import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TabStopType,
  TextRun,
  WidthType,
} from 'docx';
import type { Block, ExportDocument, ExportTemplate, Inline } from './model.ts';
import { translator } from '../../core/i18n.ts';
import { fillPlaceholders, imageSize, normalizeSvg, svgSize } from './model.ts';

/** Transparentes 1×1-PNG als Ersatzbild für SVG (Word verlangt zusätzlich eine Rasterfassung). */
const FALLBACK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
/** Twips je Pixel (1 px = 1/96 Zoll, 1 Zoll = 1440 Twips). */
const TWIPS_PER_PX = 15;
const PAGE = { A4: { width: 11906, height: 16838 }, LETTER: { width: 12240, height: 15840 } };
const MARGIN = 1304; // 2,3 cm

const CALLOUT: Record<string, { fill: string; border: string; label: string }> = {
  info: { fill: 'EFF6FF', border: '2563EB', label: 'Info' },
  note: { fill: 'F5F3FF', border: '7C3AED', label: 'Notiz' },
  tip: { fill: 'F0FDF4', border: '16A34A', label: 'Tipp' },
  success: { fill: 'F0FDF4', border: '16A34A', label: 'Erfolg' },
  warning: { fill: 'FFFBEB', border: 'D97706', label: 'Achtung' },
  error: { fill: 'FEF2F2', border: 'DC2626', label: 'Wichtig' },
  danger: { fill: 'FEF2F2', border: 'DC2626', label: 'Wichtig' },
};

const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4, HeadingLevel.HEADING_5, HeadingLevel.HEADING_6];
const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const LINE = { style: BorderStyle.SINGLE, size: 4, color: 'D7DDE8' };

type Child = Paragraph | Table | TableOfContents;

export async function renderDocx(doc: ExportDocument, tpl: ExportTemplate): Promise<Buffer> {
  const tr = translator(doc.locale ?? 'de');
  const color = (/^#[0-9a-f]{6}$/i.test(tpl.primaryColor) ? tpl.primaryColor : '#2563eb').slice(1).toUpperCase();
  const font = tpl.font || 'Calibri';
  const page = PAGE[tpl.paper === 'LETTER' ? 'LETTER' : 'A4'];
  const usable = page.width - 2 * MARGIN;
  const multi = doc.chapters.length > 1;
  let listInstance = 0;

  const runs = (inlines: Inline[]): (TextRun | ExternalHyperlink)[] =>
    inlines.map((i) => {
      if (i.br) return new TextRun({ break: 1 });
      const options = {
        text: i.text,
        bold: i.bold || undefined,
        italics: i.italics || undefined,
        underline: i.underline ? {} : undefined,
        strike: i.strike || undefined,
        superScript: i.sup || undefined,
        subScript: i.sub || undefined,
        highlight: i.mark ? ('yellow' as const) : undefined,
        font: i.code ? 'Consolas' : undefined,
        shading: i.code ? { type: ShadingType.CLEAR, fill: 'F1F3F8', color: 'auto' } : undefined,
      };
      if (i.link) return new ExternalHyperlink({ link: i.link, children: [new TextRun({ ...options, style: 'Hyperlink' })] });
      return new TextRun(options);
    });

  /** Einspaltige Tabelle als Kasten (Hinweise, Zitate) – Word kennt keine Rahmen um mehrere Absätze samt Tabellen. */
  const boxed = (inner: Child[], border: string, fill: string | undefined, width: number): Child[] => [
    new Table({
      width: { size: width, type: WidthType.DXA },
      columnWidths: [width],
      layout: TableLayoutType.FIXED,
      borders: { top: NONE, bottom: NONE, right: NONE, left: { style: BorderStyle.SINGLE, size: 24, color: border }, insideHorizontal: NONE, insideVertical: NONE },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: width, type: WidthType.DXA },
              shading: fill ? { type: ShadingType.CLEAR, fill, color: 'auto' } : undefined,
              margins: { top: 90, bottom: 30, left: 180, right: 140 },
              children: cellChildren(inner),
            }),
          ],
        }),
      ],
    }),
    new Paragraph({ spacing: { after: 60 } }),
  ];

  const image = (buffer: Buffer, type: 'png' | 'jpg' | 'svg', w: number, h: number, width: number, caption?: string): Child[] => {
    const scale = Math.min(1, width / TWIPS_PER_PX / Math.max(1, w));
    const transformation = { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
    const run =
      type === 'svg'
        ? new ImageRun({ type: 'svg', data: buffer, fallback: { type: 'png', data: FALLBACK_PNG }, transformation })
        : new ImageRun({ type, data: buffer, transformation });
    return [
      new Paragraph({ children: [run], spacing: { after: caption ? 40 : 160 } }),
      ...(caption ? [new Paragraph({ children: [new TextRun({ text: caption, size: 17, color: '69728A' })], spacing: { after: 160 } })] : []),
    ];
  };

  const convert = (blocks: Block[], width: number, nesting = 0): Child[] => blocks.flatMap((b) => one(b, width, nesting));

  const one = (block: Block, width: number, nesting: number): Child[] => {
    switch (block.type) {
      case 'heading':
        return [new Paragraph({ heading: HEADINGS[Math.min(Math.max(block.level, 1), 6) - 1], children: runs(block.inlines) })];
      case 'paragraph':
        return [
          new Paragraph({
            children: runs(block.inlines),
            alignment: block.align === 'center' ? AlignmentType.CENTER : block.align === 'right' ? AlignmentType.RIGHT : block.align === 'justify' ? AlignmentType.JUSTIFIED : undefined,
            spacing: { after: 120 },
          }),
        ];
      case 'list': {
        const instance = ++listInstance;
        const level = Math.min(nesting, 8);
        const out: Child[] = [];
        for (const item of block.items) {
          const [first, ...rest] = item.blocks;
          const prefix = item.checked === undefined ? [] : [new TextRun({ text: item.checked ? '☒ ' : '☐ ', font: 'Segoe UI Symbol' })];
          out.push(
            new Paragraph({
              children: [...prefix, ...(first?.type === 'paragraph' ? runs(first.inlines) : [])],
              ...(block.ordered ? { numbering: { reference: 'knowstead-ordered', level, instance } } : { bullet: { level } }),
              spacing: { after: 60 },
            }),
          );
          const remaining = first && first.type !== 'paragraph' ? item.blocks : rest;
          for (const child of remaining) out.push(...one(child, width, child.type === 'list' ? nesting + 1 : nesting));
        }
        return out;
      }
      case 'code': {
        const lines = block.text.split('\n');
        return [
          ...(block.label ? [new Paragraph({ children: [new TextRun({ text: block.label, size: 16, color: '69728A' })], spacing: { after: 20 } })] : []),
          ...lines.map(
            (line, index) =>
              new Paragraph({
                children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 18 })],
                shading: { type: ShadingType.CLEAR, fill: 'F6F8FC', color: 'auto' },
                spacing: { after: index === lines.length - 1 ? 160 : 0, line: 240 },
              }),
          ),
        ];
      }
      case 'quote':
        return boxed(convert(block.blocks, width - 400, nesting), 'CCD3E0', undefined, width);
      case 'callout': {
        const look = CALLOUT[block.variant] ?? CALLOUT.info;
        const label = new Paragraph({ children: [new TextRun({ text: tr(look.label), bold: true, color: look.border, size: 18 })], spacing: { after: 60 } });
        return boxed([label, ...convert(block.blocks, width - 400, nesting)], look.border, look.fill, width);
      }
      case 'table': {
        if (!block.rows.length) return [];
        const columns = Math.max(1, ...block.rows.map((r) => r.cells.reduce((n, c) => n + c.colspan, 0)));
        const column = Math.floor(width / columns);
        return [
          new Table({
            width: { size: column * columns, type: WidthType.DXA },
            columnWidths: Array(columns).fill(column),
            layout: TableLayoutType.FIXED,
            borders: { top: LINE, bottom: LINE, left: LINE, right: LINE, insideHorizontal: LINE, insideVertical: LINE },
            rows: block.rows.map(
              (row) =>
                new TableRow({
                  tableHeader: row.header,
                  children: row.cells.map((cell) => {
                    const cellWidth = column * cell.colspan;
                    return new TableCell({
                      columnSpan: cell.colspan > 1 ? cell.colspan : undefined,
                      width: { size: cellWidth, type: WidthType.DXA },
                      shading: row.header ? { type: ShadingType.CLEAR, fill: 'EEF2F8', color: 'auto' } : undefined,
                      margins: { top: 50, bottom: 10, left: 100, right: 100 },
                      children: cellChildren(convert(row.header ? emphasize(cell.blocks) : cell.blocks, cellWidth - 200, nesting)),
                    });
                  }),
                }),
            ),
          }),
          new Paragraph({ spacing: { after: 60 } }),
        ];
      }
      case 'image':
        return image(block.image.data, block.image.mime === 'image/png' ? 'png' : 'jpg', block.image.width, block.image.height, width, block.caption);
      case 'svg':
        return image(Buffer.from(block.svg, 'utf8'), 'svg', block.width, block.height, width, block.caption);
      case 'hr':
        return [new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D7DDE8', space: 4 } }, spacing: { after: 160 } })];
      case 'note':
        return [new Paragraph({ children: [new TextRun({ text: tr(block.text), italics: true, color: '69728A', size: 19 })], spacing: { after: 120 } })];
      default:
        return [];
    }
  };

  const children: Child[] = [];

  if (tpl.coverPage) {
    const logo = logoRun(tpl.logo);
    const meta = [
      [tr('Stand'), doc.date],
      [tr('Version'), tr(doc.version)],
      doc.owner ? [tr('Verantwortlich'), doc.owner] : null,
      doc.author ? [tr('Zuletzt bearbeitet von'), doc.author] : null,
      tpl.classification ? [tr('Klassifizierung'), tpl.classification] : null,
    ].filter((row): row is string[] => !!row);
    children.push(
      new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 36, color, space: 1 } }, spacing: { after: 600 } }),
      ...(logo ? [new Paragraph({ children: [logo], spacing: { after: 600 } })] : []),
      ...(tpl.company ? [new Paragraph({ children: [new TextRun({ text: tpl.company, size: 24, color: '69728A' })], spacing: { before: logo ? 0 : 1600, after: 200 } })] : []),
      new Paragraph({ children: [new TextRun({ text: doc.title, bold: true, size: 60, color: '0B1220' })], spacing: { before: tpl.company || logo ? 0 : 1600, after: 200 } }),
      new Paragraph({ children: [new TextRun({ text: doc.subtitle, size: 28, color })], spacing: { after: 1200 } }),
      ...meta.map(
        ([k, v]) =>
          new Paragraph({
            tabStops: [{ type: TabStopType.LEFT, position: 2600 }],
            children: [new TextRun({ text: k, color: '69728A', size: 20 }), new TextRun({ text: `\t${v}`, size: 20 })],
            spacing: { after: 60 },
          }),
      ),
      new Paragraph({ children: [new PageBreak()] }),
    );
  }

  const hasHeadings = doc.chapters.some((c) => multi || c.blocks.some((b) => b.type === 'heading'));
  if (tpl.toc && hasHeadings) {
    children.push(
      new Paragraph({ children: [new TextRun({ text: tr('Inhaltsverzeichnis'), bold: true, size: 36, color: '0B1220' })], spacing: { after: 240 } }),
      new TableOfContents(tr('Inhaltsverzeichnis'), { hyperlink: true, headingStyleRange: '1-3' }),
      new Paragraph({ children: [new PageBreak()] }),
    );
  }

  doc.chapters.forEach((chapter, index) => {
    if (multi || !tpl.coverPage) {
      children.push(
        new Paragraph({
          heading: HEADINGS[(multi ? Math.min(chapter.level, 3) : 1) - 1],
          pageBreakBefore: index > 0 && chapter.level === 1,
          children: [new TextRun(chapter.title)],
        }),
      );
    }
    children.push(...convert(chapter.blocks, usable));
  });
  if (!children.length) children.push(new Paragraph(''));

  const edge = { type: TabStopType.RIGHT, position: usable };
  const pageHeader = new Header({
    children: [
      new Paragraph({
        tabStops: [edge],
        children: [new TextRun({ text: fillPlaceholders(tpl.headerText, doc, tpl), size: 16, color: '69728A' }), new TextRun({ text: `\t${tpl.classification}`, size: 16, bold: true, color })],
      }),
    ],
  });
  const pageFooter = new Footer({
    children: [
      new Paragraph({
        tabStops: [edge],
        children: [
          new TextRun({ text: fillPlaceholders(tpl.footerText, doc, tpl), size: 16, color: '69728A' }),
          new TextRun({ children: ['\tSeite ', PageNumber.CURRENT, ' von ', PageNumber.TOTAL_PAGES], size: 16, color: '69728A' }),
        ],
      }),
    ],
  });

  const document = new Document({
    creator: tpl.company || 'Knowstead',
    title: doc.title,
    subject: doc.subtitle,
    description: tr(`Export aus Knowstead (${doc.version})`),
    features: { updateFields: tpl.toc && hasHeadings },
    styles: {
      default: {
        document: { run: { font, size: 21, color: '232936' }, paragraph: { spacing: { line: 276 } } },
        heading1: { run: { font, size: 34, bold: true, color: '0B1220' }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true } },
        heading2: { run: { font, size: 28, bold: true, color }, paragraph: { spacing: { before: 280, after: 110 }, keepNext: true } },
        heading3: { run: { font, size: 24, bold: true, color: '0B1220' }, paragraph: { spacing: { before: 220, after: 90 }, keepNext: true } },
        heading4: { run: { font, size: 22, bold: true, color: '4A5365' }, paragraph: { spacing: { before: 180, after: 80 }, keepNext: true } },
        heading5: { run: { font, size: 21, bold: true, color: '4A5365' }, paragraph: { spacing: { before: 160, after: 60 }, keepNext: true } },
        heading6: { run: { font, size: 21, italics: true, color: '4A5365' }, paragraph: { spacing: { before: 160, after: 60 }, keepNext: true } },
        hyperlink: { run: { color, underline: {} } },
      },
    },
    numbering: {
      config: [
        {
          reference: 'knowstead-ordered',
          levels: Array.from({ length: 9 }, (_, level) => ({
            level,
            format: level % 3 === 0 ? LevelFormat.DECIMAL : level % 3 === 1 ? LevelFormat.LOWER_LETTER : LevelFormat.LOWER_ROMAN,
            text: `%${level + 1}.`,
            alignment: AlignmentType.START,
            style: { paragraph: { indent: { left: 460 * (level + 1), hanging: 300 } } },
          })),
        },
      ],
    },
    sections: [
      {
        properties: {
          titlePage: tpl.coverPage,
          page: { size: page, margin: { top: MARGIN + 200, bottom: MARGIN, left: MARGIN, right: MARGIN, header: 560, footer: 560 } },
        },
        headers: { default: pageHeader, first: new Header({ children: [new Paragraph('')] }) },
        footers: { default: pageFooter, first: new Footer({ children: [new Paragraph('')] }) },
        children,
      },
    ],
  });
  return Buffer.from(await Packer.toBuffer(document));
}

/** Kopfzeilen von Tabellen fett darstellen. */
function emphasize(blocks: Block[]): Block[] {
  return blocks.map((b) => (b.type === 'paragraph' ? { ...b, inlines: b.inlines.map((i) => ({ ...i, bold: true })) } : b));
}

/** Tabellenzellen müssen mit einem Absatz enden; Inhaltsverzeichnisse gibt es darin nicht. */
function cellChildren(children: Child[]): (Paragraph | Table)[] {
  const list = children.filter((c): c is Paragraph | Table => !(c instanceof TableOfContents));
  if (!list.length || list[list.length - 1] instanceof Table) list.push(new Paragraph(''));
  return list;
}

function logoRun(logo: string): ImageRun | null {
  const m = logo.match(/^data:(image\/(?:png|jpeg|svg\+xml));base64,([a-z0-9+/=]+)$/i);
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  const size = m[1] === 'image/svg+xml' ? svgSize(data.toString('utf8')) : imageSize(data, m[1]);
  if (!size) return null;
  const scale = Math.min(1, 220 / size.width, 90 / size.height);
  const transformation = { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) };
  if (m[1] === 'image/svg+xml') return new ImageRun({ type: 'svg', data: Buffer.from(normalizeSvg(data.toString('utf8')), 'utf8'), fallback: { type: 'png', data: FALLBACK_PNG }, transformation });
  return new ImageRun({ type: m[1] === 'image/png' ? 'png' : 'jpg', data, transformation });
}
